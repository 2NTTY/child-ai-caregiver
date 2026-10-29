"""Small orchestration gates; product adapters own map/entry/fixture closure."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import zipfile
from build_inputs import verify as verify_build_inputs

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / 'orchestrator/manifest.json').read_text())
SECRET = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}')
PRIVATE = (b'/workspace/scratch/', b'/home/agent/', b'/tmp/private-', b'/workspace/shared/')


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args])


def safe_relative(value):
    path = PurePosixPath(value)
    need(not path.is_absolute() and '..' not in path.parts and '\\' not in value, 'Unsafe relative path')
    return path


def checked_files(root):
    rows = {}
    for path in sorted(root.rglob('*')):
        need(not path.is_symlink(), 'Symlink in output or recipe')
        if path.is_file():
            data = path.read_bytes()
            rows[path.relative_to(root).as_posix()] = {'bytes': len(data), 'sha256': digest(data)}
    return rows


def source_snapshot(source):
    rows = {}
    for name in git(source, 'ls-files', '-z').decode().split('\0'):
        if not name:
            continue
        safe_relative(name)
        path = source / name
        need(path.is_file() and not path.is_symlink(), 'Tracked source missing or symlinked')
        data = path.read_bytes()
        rows[name] = {'bytes': len(data), 'sha256': digest(data)}
    return rows


def candidate_check(key, source):
    product = MANIFEST['products'][key]
    identity = verify_build_inputs(source, key)
    need(identity['buildCommit'] == product['buildCommit'], 'Wrong published build commit')
    need(identity['buildTree'] == product['buildTree'], 'Wrong published build tree')
    need(identity['originalProductCommit'] == product['commit'] and identity['originalProductTree'] == product['tree'], 'Original product provenance differs')
    need(identity['manifestSha256'] == product['buildInputsManifestSha256'], 'Wrong projected input manifest')
    need(digest((source / 'package-lock.json').read_bytes()) == MANIFEST['lockSha256'], 'Lock changed')
    for directory in (source, source / 'frontend'):
        need(not (directory / '.npmrc').exists(), 'Product npm configuration forbidden')
        metadata = json.loads((directory / 'package.json').read_text())
        need(metadata['packageManager'] == 'npm@11.8.0', 'Unexpected package manager')
        need(not any(k in metadata['scripts'] for k in ('preinstall', 'install', 'postinstall')), 'Lifecycle contract changed')
    frontend = json.loads((source / 'frontend/package.json').read_text())
    need(frontend['scripts']['typecheck'] == 'tsc --noEmit', 'Typecheck contract changed')
    need(frontend['scripts']['build:web'] == 'expo export --platform web', 'Export contract changed')
    need(json.loads((source / 'frontend/app.json').read_text())['expo']['web']['output'] == 'static', 'SSG contract changed')
    config = git(source, 'config', '--local', '--list').lower()
    need(b'extraheader' not in config and b'credential' not in config, 'Checkout retained credential configuration')
    return product


def runtime_identity(source):
    """Digest installed namespace/content, retaining no machine-private paths."""
    tree = source / 'node_modules'; result = hashlib.sha256(); count = 0
    for base, dirs, names in os.walk(tree, followlinks=False):
        dirs.sort(); names.sort()
        for name in sorted([*dirs, *names]):
            path = Path(base) / name
            relative = path.relative_to(source).as_posix()
            if path.is_symlink():
                target = path.resolve()
                need(target.is_relative_to(source), 'Installed link escapes checkout')
                value = 'link:' + target.relative_to(source).as_posix()
            elif path.is_file():
                with path.open('rb') as stream:
                    value = hashlib.file_digest(stream, 'sha256').hexdigest()
            else:
                continue
            result.update((relative + '\0' + value + '\n').encode()); count += 1
    need(count > 100, 'Installed runtime closure is unexpectedly empty')
    return {'filesAndLinks': count, 'sha256': result.hexdigest()}


def capacity(source):
    memory = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    disk = shutil.disk_usage(source).free
    need(memory >= MANIFEST['caps']['runnerMemAvailableBytes'], 'Remote available-memory preflight failed')
    need(disk >= MANIFEST['caps']['runnerDiskAvailableBytes'], 'Remote free-disk preflight failed')
    return {'memAvailableBytes': memory, 'diskAvailableBytes': disk}


def main():
    stage, key, source_arg, out_arg = sys.argv[1:]
    source, out = Path(source_arg).resolve(), Path(out_arg).resolve()
    product = MANIFEST['products'][key]
    state = out.parent / 'preview-source-state.json'
    if stage == 'prepare':
        need(product['recipeReady'] is True, 'Recipe source bundle is incomplete')
        need(product.get('recipeFiles'), 'Recipe input pins missing')
        safe_relative(product['adapter'])
        need(product['adapter'].startswith(('orchestrator/care/' if key == 'care' else key + '/')), 'Adapter outside product recipe')
        for name, expected in product['recipeFiles'].items():
            safe_relative(name)
            need(digest((ROOT / name).read_bytes()) == expected, 'Recipe source pin changed')
        capacity(source)
        need(not git(source, 'status', '--porcelain'), 'Product checkout is not pristine')
        candidate_check(key, source)
        state.write_text(json.dumps(source_snapshot(source), sort_keys=True))
        return
    candidate_check(key, source)
    need(source_snapshot(source) == json.loads(state.read_text()), 'Tracked source mutated after prepare')
    if stage == 'before':
        (out.parent / 'preview-runtime.json').write_text(json.dumps(runtime_identity(source)))
        capacity_snapshot = capacity(source)
        (out.parent / 'preview-capacity.json').write_text(json.dumps(capacity_snapshot))
        for command in product.get('preflight', []):
            subprocess.run([sys.executable, '-B', str(ROOT / command[0]), *command[1:], '--source', str(source)], check=True)
        for package, version in [('typescript', '6.0.3'), ('expo', '57.0.24'), ('expo-sharing', '57.0.21')]:
            need(json.loads((source / 'node_modules' / package / 'package.json').read_text())['version'] == version, 'Installed runtime version mismatch')
        return
    need(stage == 'after', 'Unknown stage')
    runtime = runtime_identity(source)
    need(runtime == json.loads((out.parent / 'preview-runtime.json').read_text()), 'Installed runtime mutated during export')
    expo = source / 'frontend/.expo'
    need(not expo.exists() or sum(p.stat().st_size for p in expo.rglob('*') if p.is_file()) <= 2097152, 'Generated Expo metadata exceeds 2 MiB')
    raw, site = out.parent / 'preview-raw-private', out / 'site'
    raw_rows, site_rows = checked_files(raw), checked_files(site)
    need(raw_rows and site_rows and any(n.endswith('.map') for n in raw_rows), 'Missing raw/maps/site')
    need(not any(n.endswith('.map') for n in site_rows), 'Source maps leaked into site')
    raw_bytes = sum(x['bytes'] for x in raw_rows.values())
    site_bytes = sum(x['bytes'] for x in site_rows.values())
    need(all(row['bytes'] <= MANIFEST['caps']['rawFileBytes'] for row in raw_rows.values()), 'Raw file exceeds remote per-file cap')
    need(raw_bytes <= MANIFEST['caps']['rawBytes'], 'Raw size gate exceeded; never prune raw')
    need(site_bytes <= MANIFEST['caps']['siteBytes'], 'Site size gate exceeded')
    need(all(row['bytes'] <= MANIFEST['caps']['siteFileBytes'] for row in site_rows.values()), 'Site file exceeds 32 MiB')
    for directory, rows in [(site, site_rows)]:
        for name in rows:
            safe_relative(name)
            need(not any(p.startswith('.') and p != '.routes.json' for p in PurePosixPath(name).parts), 'Hidden output forbidden')
            data = (directory / name).read_bytes()
            need(not SECRET.search(data) and not any(x in data for x in PRIVATE), 'Credential or private local path in artifact')
    adapter = Path(os.environ['TMPDIR']) / 'adapter-proof.json'
    need(adapter.is_file(), 'Adapter proof absent')
    adapter_data = adapter.read_bytes()
    need(not SECRET.search(adapter_data) and not any(x in adapter_data for x in (*PRIVATE, b'/home/runner/', b'/tmp/')),  'Adapter proof contains private material')
    # Raw/maps remain runner-local and are never included in public artifacts.
    proof = {'format': 'frontend-preview-export-provenance-v1', 'product': key,
             'sourceCommit': product['commit'], 'sourceTree': product['tree'],
             'originalProductCommit': product['commit'], 'originalProductTree': product['tree'],
             'publishedBuildCommit': product['buildCommit'], 'publishedBuildTree': product['buildTree'],
             'buildInputsManifestSha256': product['buildInputsManifestSha256'],
             'projectedInputRowsSha256': json.loads(Path(os.environ['PREVIEW_BUILD_INPUT_MANIFEST']).read_text())['products'][key]['inputRowsSha256'],
             'orchestrationCommit': os.environ['ORCHESTRATION_SHA'], 'node': MANIFEST['node'], 'npm': MANIFEST['npm'],
             'lockSha256': MANIFEST['lockSha256'], 'sourceOverlay': [], 'candidateChanges': product['candidateChanges'], 'recipeOnlyTests': product.get('recipeOnlyTests', []),
             'remotePreflight': json.loads((out.parent / 'preview-capacity.json').read_text()), 'installedRuntime': runtime,
             'trackedSourceManifestSha256': digest(state.read_bytes()), 'trackedSourceCount': len(json.loads(state.read_text())),
             'recipeFiles': product['recipeFiles'], 'normalFrontendTypecheck': 'PASS', 'normalExpoStaticMinifiedExternalMaps': 'PASS',
             'isolatedNetwork': 'unshare; loopback down; no routes; no capabilities; no-new-privs',
             'raw': raw_rows, 'site': site_rows, 'rawBytes': raw_bytes, 'siteBytes': site_bytes,
             'rawRetention': 'RUNNER_LOCAL_ONLY_EPHEMERAL_NOT_UPLOADED', 'adapterProofSha256': digest(adapter_data),
             'nativeBrowser': 'NOT_RUN', 'publication': 'NOT_RUN',
             'careJsdomTests': 'NOT_RERUN_REMOTE; earlier exact-source local receipts are not new CI passes' if key == 'care' else 'NOT_APPLICABLE'}
    (out / 'provenance.json').write_text(json.dumps(proof, indent=2) + '\n')
    shutil.copyfile(adapter, out / 'adapter-proof.json')
    need({p.name for p in out.iterdir()} == {'site', 'provenance.json', 'adapter-proof.json'}, 'Unexpected artifact-root content')
    probe = out.parent / 'preview-zip-size-check.zip'
    with zipfile.ZipFile(probe, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zip:
        for path in sorted(out.rglob('*')):
            if path.is_file():
                zip.write(path, path.relative_to(out).as_posix())
    estimated_zip = probe.stat().st_size
    expanded = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
    # GitHub's actual ZIP metadata is checked again before download/extraction.
    need(estimated_zip + 1048576 <= MANIFEST['caps']['artifactZipBytes'], 'Artifact ZIP estimate exceeds cap/margin')
    need(estimated_zip + 1048576 + expanded <= MANIFEST['caps']['localZipPlusExpandedBytes'], 'Local acquisition/extraction budget exceeded')
    probe.unlink()
    print(json.dumps({'product': key, 'rawBytes': raw_bytes, 'siteBytes': site_bytes,
                      'rawUploaded': False, 'estimatedZipBytes': estimated_zip,
                      'expandedBytes': expanded, 'actualArtifactZipMetadataRequiredBeforeDownload': True}))


if __name__ == '__main__':
    main()
