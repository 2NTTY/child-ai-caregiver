#!/usr/bin/env python3
"""Portable source/normalization steps; no install, export, server or publication.
Adapted from the existing prepare-sut.py / prepare-artifact.py transformation.
The caller owns one-attempt export, resource supervision and native-browser gates.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, unquote
import argparse, hashlib, json, os, re, subprocess, sys

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE / 'PINS.json').read_text())
sys.path.insert(0, str(HERE.parent / 'orchestrator'))
from build_inputs import verify as verify_build_inputs
TEXT_EXT = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'}
BINARY_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.ttf', '.ico'}
CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src 'self'"
INJECTION = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="referrer" content="no-referrer"><meta name="harbour-preview-contracts" content="harbour-private-boundary-fixtures-v5-r6-task-history-read-20261027"><script src="/experiments/fixtures/harbour.js"></script>'
PRIVATE = re.compile(r'/workspace/|/home/agent/|/home/runner/|/tmp/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}')

def require(condition, label):
    if not condition:
        raise ValueError(label)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(262144), b''):
            h.update(block)
    return h.hexdigest()

def regular(path):
    require(path.is_file() and not path.is_symlink(), 'Expected regular file')

def source_pins(source, git_required=True):
    source = source.resolve(strict=True)
    require(digest(HERE / 'source-pins.json') == PINS['sourcePinsSha256'], 'Source pin manifest changed')
    rows = json.loads((HERE / 'source-pins.json').read_text())['records']
    if git_required:
        identity = verify_build_inputs(source, 'harbour')
        require(identity['originalProductCommit'] == PINS['sourceCommit'] and identity['originalProductTree'] == PINS['tree'], 'Original Harbour provenance differs')
    by = {r['path']: r for r in rows}
    for name, row in by.items():
        p = source / name
        regular(p)
        require(p.stat().st_size == row['bytes'] and digest(p) == row['sha256'], 'Source bytes changed: ' + name)
        require(bool(p.stat().st_mode & 0o111) == (row['mode'] == '100755'), 'Source executable mode changed')
    for name, row in PINS['shared'].items():
        p = HERE / 'shared' / name
        regular(p)
        require(p.stat().st_size == row['bytes'] and digest(p) == row['sha256'], 'Shared fixture/carrier changed')
    return by

def inventory(root):
    result = []
    for p in sorted(root.rglob('*')):
        require(not p.is_symlink(), 'Symlink in output')
        if p.is_dir():
            continue
        regular(p)
        result.append({'path': p.relative_to(root).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)})
    return result

def check_maps(source, raw, source_rows):
    maps = sorted(raw.rglob('*.map'))
    require(len(maps) == 3, 'Expected current three exported JS maps')
    sources = {}
    for p in maps:
        data = json.loads(p.read_text())
        require(len(data['sources']) == len(data['sourcesContent']), 'Map source/content arity')
        for name, content in zip(data['sources'], data['sourcesContent']):
            require(name not in sources or sources[name] == content, 'Inconsistent repeated source')
            sources[name] = content
    outputs = {digest(p) for p in raw.rglob('*') if p.is_file()}
    counts = dict(firstParty=0, dependencies=0, binaryRegistries=0, routerContexts=0, generated=0)
    mapped_first = set()
    for name, content in sources.items():
        rel = name.lstrip('/')
        p = source / rel
        if rel in source_rows:
            row = source_rows[rel]
            if p.suffix in TEXT_EXT:
                require(content is not None and sha(content.encode()) == row['sha256'], 'First-party map mismatch: ' + rel)
                mapped_first.add(rel)
                counts['firstParty'] += 1
            else:
                require(p.suffix.lower() in BINARY_EXT and row['sha256'] in outputs, 'Unmatched first-party asset')
                counts['binaryRegistries'] += 1
        elif name.startswith('/frontend/app?ctx='):
            targets = re.findall(r'require\("([^\"]+)"\)', content or '')
            require(bool(targets), 'Empty Router context')
            for target in targets:
                q = Path(target).resolve(strict=True)
                require(q.is_relative_to(source / 'frontend/app'), 'Router context escaped source')
                require(q.relative_to(source).as_posix() in source_rows, 'Unpinned Router route')
            counts['routerContexts'] += 1
        elif rel.startswith(('node_modules/', 'frontend/node_modules/')):
            q = p.resolve(strict=True)
            require(q.is_relative_to(source) and 'node_modules' in q.parts, 'Dependency escaped fresh checkout')
            if p.suffix.lower() in BINARY_EXT:
                require(digest(q) in outputs, 'Unmatched dependency asset')
                counts['binaryRegistries'] += 1
            else:
                require(content is not None and q.read_bytes() == content.encode(), 'Dependency map mismatch')
                counts['dependencies'] += 1
        else:
            require(name == '__prelude__' or name.startswith(('\x00polyfill:', '\x00shim:')), 'Unclassified map source')
            counts['generated'] += 1
    required = {'frontend/index.js', 'frontend/src/entry/Application.tsx',
                'frontend/src/production/useFamilyDocuments.ts',
                'frontend/src/workspaces/PreparationWorkspace.tsx',
                'frontend/src/production/preparation-check-buffer.ts',
                'frontend/src/components/preparations/PreparationWorkspace.tsx'}
    require(required <= mapped_first, 'Current entry/latest preparation code absent from maps')
    require(counts['routerContexts'] == 1 and counts['dependencies'] > 0, 'Source-map closure incomplete')
    return counts

def verify_graph(source, raw):
    """Remote-only retained v3 full-AST/VLQ closure; no product JS execution."""
    require(digest(HERE / 'verify_graph.mjs') == PINS['graphVerifier']['sha256'], 'Graph verifier source changed')
    result = subprocess.run(['node', '--max-old-space-size=4096', str(HERE / 'verify_graph.mjs'), str(source), str(raw)], capture_output=True, timeout=180, check=False)
    require(result.returncode == 0, 'Remote module-edge verifier failed; raw remains runner-local')
    require(len(result.stdout) <= 1024**2 and not result.stderr, 'Graph verifier output envelope')
    value = json.loads(result.stdout)
    require(value['status'] == 'REMOTE_FULL_FACTORY_AST_AND_MODULE_EDGE_CLOSURE_NOT_BROWSER' and value['exactFullByteCoverage'] and value['inputPrePostHashes'], 'Graph closure proof incomplete')
    require(PRIVATE.search(result.stdout.decode()) is None, 'Private path in graph proof')
    return value

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
    def handle_starttag(self, tag, attrs):
        self.refs.extend(v for k, v in attrs if k in ('src', 'href') and v is not None)

def normalize(source, raw, output):
    source = source.resolve(strict=True)
    raw = raw.resolve(strict=True)
    require(not output.exists(), 'Output must be fresh; no overwrite/retry')
    source_rows = source_pins(source)
    before = inventory(raw)
    require(sum(r['bytes'] for r in before) <= PINS['remoteContract']['rawMaximumBytes'], 'Raw export exceeded approved envelope')
    require(all(r['bytes'] <= PINS['remoteContract']['rawPerFileMaximumBytes'] for r in before), 'Raw file exceeded remote per-file envelope')
    proof = check_maps(source, raw, source_rows)
    graph_proof = verify_graph(source, raw)
    require({r['path'] for r in before if r['path'].endswith('.html')} == set(PINS['routes']), 'Route set drift')
    js = [r['path'] for r in before if r['path'].endswith('.js')]
    require(len(js) == 3 and all(any(Path(n).name.startswith(prefix) for n in js) for prefix in ('index-', 'AdminScreenContent-', 'AvatarCropPreviewContent-')), 'Entry/optional chunk set drift')
    output.mkdir(parents=True)
    overlay = output / 'overlay'
    overlay.mkdir()
    transforms, payloads = [], []
    binary = {(r['bytes'], r['sha256']) for r in PINS['binaryAssets']}
    def write(name, data):
        path = overlay / name
        require(not path.exists(), 'Overlay path collision')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    for row in before:
        name = row['path']
        p = raw / name
        if p.suffix == '.map':
            continue
        data = p.read_bytes()
        if p.suffix == '.html':
            html = data.decode()
            require('<head>' in html and 'Content-Security-Policy' not in html, 'Unexpected raw HTML')
            require(re.search(r'<html\b[^>]*\blang="zh-Hant"', html) is not None, 'HTML language missing')
            require(not re.search('maximum-scale|user-scalable=no', html), 'Zoom restriction')
            prepared = html.replace('<head>', '<head>' + INJECTION, 1)
            require(prepared.replace(INJECTION, '', 1) == html, 'Non-reversible HTML injection')
            target = 'experiments/payload/harbour/' + str(Path(name).with_suffix('.js'))
            body = ('document.write(' + json.dumps(prepared, ensure_ascii=True) + ');\n').encode()
            write(target, body)
            payloads.append({'route': name, 'payload': target, 'rawSha256': sha(data), 'preparedSha256': sha(prepared.encode()), 'payloadSha256': sha(body)})
            continue
        require(p.suffix in PINS['publicExtensions'], 'Unapproved public extension')
        require(name == 'favicon.ico' or name == '_expo/.routes.json' or name.startswith(('_expo/static/', 'assets/')), 'Unapproved public namespace')
        require(not re.search(r'___(?!node_modules/)', name) and not re.search(r'(^|/)(\.git|\.env|evidence|verification|private-export)(/|$)', name), 'Private output namespace')
        if p.suffix in BINARY_EXT:
            require((len(data), sha(data)) in binary, 'Binary asset is not the pinned same-design public asset')
        if p.suffix == '.js':
            matches = list(re.finditer(rb'(?m)^//# sourceMappingURL=([^\r\n]+)\n?', data))
            require(len(matches) == 1 and matches[0].start() > len(data) - 400, 'Expected unique trailing external-map comment')
            match = matches[0]
            after = data[:match.start()] + data[match.end():]
            require(after[:match.start()] + match.group() + after[match.start():] == data, 'Map strip not reversible')
            transforms.append({'path': name, 'beforeSha256': sha(data), 'afterSha256': sha(after), 'removedUtf8': match.group().decode(), 'offset': match.start()})
            data = after
        write(name, data)
    for name in PINS['shared']:
        write(name, (HERE / 'shared' / name).read_bytes())
    # Check only normalized Harbour/shared paths; do not import old sibling bundles.
    for row in inventory(overlay):
        p = overlay / row['path']
        if p.suffix in {'.js', '.css', '.html', '.json'}:
            value = p.read_text()
            require(PRIVATE.search(value) is None and 'sourceMappingURL=' not in value, 'Private text/map reference in public output')
            require(str(source) not in value and str(raw) not in value, 'Build path leaked into public output')
    for item in payloads:
        payload = (overlay / item['payload']).read_text()
        html = json.loads(payload[len('document.write('):-3])
        parser = Links()
        parser.feed(html)
        for ref in parser.refs:
            if ref.startswith(('data:', '#')):
                continue
            u = urlparse(urljoin('https://preview.example.invalid/' + item['route'], ref))
            require(u.scheme == 'https' and u.netloc == 'preview.example.invalid', 'External HTML reference')
            target = unquote(u.path).lstrip('/')
            require((overlay / target).is_file() or target in PINS['routes'] or target + '.html' in PINS['routes'], 'Missing HTML reference')
    source_pins(source)
    require(inventory(raw) == before, 'Raw export changed during normalization')
    public_files = inventory(overlay)
    require(sum(r['bytes'] for r in public_files) <= PINS['remoteContract']['siteMaximumBytes'], 'Public overlay exceeded remote site envelope')
    require(all(r['bytes'] <= PINS['remoteContract']['sitePerFileMaximumBytes'] for r in public_files), 'Public file exceeded remote per-file envelope')
    identity = verify_build_inputs(source, 'harbour')
    receipt = {'publishedBuildCommit': identity['buildCommit'], 'publishedBuildTree': identity['buildTree'], 'buildInputsManifestSha256': identity['manifestSha256'], 'format': 'harbour-overlay-manifest-v1', 'sourceCommit': PINS['sourceCommit'], 'tree': PINS['tree'], 'files': public_files, 'fixturePathTransform': PINS['fixturePathTransform'], 'sourceMapCounts': proof, 'moduleEdgeProof': graph_proof, 'mapTransforms': transforms, 'payloads': payloads, 'newProductSourceEdits': 0, 'sourceMapsPublished': False, 'browserValidated': False, 'publicationAllowed': False}
    receipt_text = json.dumps(receipt, ensure_ascii=False, indent=2) + '\n'
    require(PRIVATE.search(receipt_text) is None, 'Private content in sanitized receipt')
    (output / 'manifest.json').write_text(receipt_text)
    print(json.dumps({'status': 'NORMALIZED_SOURCE_BOUND_ONLY_NOT_BROWSER_OR_PUBLICATION_ALLOW', 'files': len(receipt['files']), 'bytes': sum(r['bytes'] for r in receipt['files']), 'manifestSha256': digest(output / 'manifest.json')}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['preflight', 'normalize'])
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--raw', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--physical-only', action='store_true')
    args = parser.parse_args()
    if args.command == 'preflight':
        result = source_pins(args.source, not args.physical_only)
        print(json.dumps({'status': 'SOURCE_PIN_CHECK_ONLY', 'sourceCommit': PINS['sourceCommit'], 'files': len(result), 'gitChecked': not args.physical_only}))
    else:
        require(not args.physical_only and args.raw is not None and args.output is not None, 'Normalize requires source Git identity, raw and output')
        normalize(args.source, args.raw, args.output)
