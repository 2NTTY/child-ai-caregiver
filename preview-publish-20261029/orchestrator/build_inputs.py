"""Verify a clean published projection without mislabelling it its local origin."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess


def need(condition, message):
    if not condition:
        raise ValueError(message)


def relative(value):
    path = PurePosixPath(value)
    need(isinstance(value, str) and not path.is_absolute() and '..' not in path.parts and '\\' not in value, 'Unsafe build-input path')
    return value


def verify(source, key):
    source = Path(source).resolve()
    commit = os.environ.get('PREVIEW_BUILD_COMMIT', '')
    need(re.fullmatch('[0-9a-f]{40}', commit), 'Exact published build commit is required')
    manifest = Path(os.environ['PREVIEW_BUILD_INPUT_MANIFEST'])
    data = manifest.read_bytes()
    manifest_sha = hashlib.sha256(data).hexdigest()
    need(manifest_sha == os.environ['PREVIEW_BUILD_INPUT_MANIFEST_SHA256'], 'Build-input manifest pin changed')
    doc = json.loads(data)
    need(doc['schema'] == 'four-clean-build-projections-v1', 'Unknown input manifest schema')
    product = doc['products'][key]
    def git(*args):
        return subprocess.check_output(['git', '-C', str(source), *args])
    need(git('rev-parse', 'HEAD').decode().strip() == commit, 'Published checkout SHA mismatch')
    tree = git('rev-parse', 'HEAD^{tree}').decode().strip()
    parents = re.findall(r'^parent ([0-9a-f]{40})$', git('cat-file', '-p', 'HEAD').decode(), re.M)
    need(parents == [product['expectedPublicParent']], 'Published build is not the reviewed single-parent fast-forward')
    # Original source commit/tree are provenance; never pretend they are this new Git HEAD.
    records = {}
    for path_index, blob_index in product['inputs']:
        need(isinstance(path_index, int) and 0 <= path_index < len(doc['paths']) and isinstance(blob_index, int) and 0 <= blob_index < len(doc['blobs']), 'Invalid projected input index')
        name = relative(doc['paths'][path_index])
        need(name not in records, 'Duplicate projected input')
        mode, blob, sha, size = doc['blobs'][blob_index]
        need(mode in ['100644', '100755'] and re.fullmatch('[0-9a-f]{40}', blob) and re.fullmatch('[0-9a-f]{64}', sha), 'Invalid input pin')
        records[name] = {'mode': mode, 'gitBlob': blob, 'sha256': sha, 'bytes': size}
    prefixes = [relative(x).rstrip('/') for x in doc['namespaces']['prefixes']]
    exact = {relative(x) for x in doc['namespaces']['exactPaths']}
    def in_scope(name):
        return name in exact or any(name == prefix or name.startswith(prefix + '/') for prefix in prefixes)
    need(records and all(in_scope(name) for name in records), 'Input outside declared namespaces')
    tracked = {}
    all_tracked = set()
    for row in git('ls-tree', '-r', '-z', 'HEAD').split(b'\0'):
        if not row:
            continue
        header, raw_name = row.split(b'\t', 1)
        mode, kind, blob = header.decode().split()
        name = raw_name.decode()
        all_tracked.add(name)
        if in_scope(name):
            need(kind == 'blob', 'Non-file in build namespace')
            tracked[name] = (mode, blob)
    need(set(tracked) == set(records), 'Tracked projected namespace differs (extra/stale/missing source)')
    rows = [[name, row['mode'], row['gitBlob'], row['sha256'], row['bytes']] for name, row in sorted(records.items())]
    rows_sha = hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    need(rows_sha == product['inputRowsSha256'], 'Projected input row digest mismatch')
    discovery = doc['configDiscovery']
    config_roots = set(discovery['roots'])
    need(config_roots == {'.', 'frontend'}, 'Unexpected config-discovery roots')
    pattern = re.compile(discovery['fileNameRegex'])
    def config_path(name):
        path = PurePosixPath(name)
        return str(path.parent) in config_roots and pattern.fullmatch(path.name)
    expected_configs = {name for name in records if config_path(name)}
    need({name for name in all_tracked if config_path(name)} == expected_configs, 'Tracked build config presence/absence differs')
    discovered = set()
    for name in config_roots:
        for path in (source / name).iterdir():
            if pattern.fullmatch(path.name):
                need(path.is_file() and not path.is_symlink(), 'Nonregular discovered build config')
                discovered.add(path.relative_to(source).as_posix())
    need(discovered == expected_configs, 'Physical build config presence/absence differs')
    physical = set()
    for prefix in prefixes:
        parent = source / prefix
        if parent.exists():
            need(not parent.is_symlink(), 'Symlink build namespace')
            for path in ([parent] if parent.is_file() else parent.rglob('*')):
                need(not path.is_symlink(), 'Symlink within build namespace')
                if path.is_file():
                    physical.add(path.relative_to(source).as_posix())
    for name in exact:
        path = source / name
        need(not path.is_symlink(), 'Symlink exact build input')
        if path.is_file():
            physical.add(name)
    need(physical == set(records), 'Physical projected namespace differs (including untracked inputs)')
    for name, row in records.items():
        path = source / name
        body = path.read_bytes()
        need(tracked[name] == (row['mode'], row['gitBlob']), 'Published Git input blob/mode differs')
        need(len(body) == row['bytes'] and hashlib.sha256(body).hexdigest() == row['sha256'], 'Physical build input bytes differ')
        need(bool(path.stat().st_mode & 0o111) == (row['mode'] == '100755'), 'Build input executable mode differs')
        need(hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == row['gitBlob'], 'Input blob identity differs')
    need(not git('diff', '--name-only', 'HEAD'), 'Tracked published checkout changed')
    return {'buildCommit': commit, 'buildTree': tree,
            'originalProductCommit': product['originalProductCommit'], 'originalProductTree': product['originalProductTree'],
            'manifestSha256': manifest_sha, 'inputRowsSha256': rows_sha, 'files': records}
