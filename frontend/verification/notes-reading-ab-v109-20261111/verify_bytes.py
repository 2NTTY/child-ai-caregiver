"""Verify archived PN-READ01 bytes; optionally compare a complete source dist. No runtime or network."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os
import re

ROOT = Path(__file__).resolve().parent
PREFIX = 'experiments/private-notes-reading-pn01/'
CANDIDATE = '6e5feeb82130f9d324be71ab44e56ca3d108edb66db4df877928bcf70fee877c'
BASELINE = '4247734441586ff42b0ee8230210be9e1047eafdf3c37732dad21e6e81a6d166'
PINS = {'app.mjs': (2555, '1414696f8e8e80c5a4d90e23b16acf308932db67559195f3df90f0fcc546f2d8'), 'index.html': (1348, '299fa744b37e69e37dd4489cfd22e96e814a04f1c1ac2749416937815c6ee715'), 'notes-data.mjs': (1947, '8c00c68a0441b1fbb8ae30736743b55bf837e1a2ceffbf0d36ca6b155dbd7fc4'), 'notes-state.mjs': (662, '2efbf54ab91ee03d1cdfdbc5cebe2500aa8d62769241a91db56b5758feda4236'), 'notes-view.mjs': (2374, '26febc10098d15a04b20c38459c1075baf55ab2de67f3bfb7a2c2a0450e02085'), 'notes.css': (3888, 'be008f4d9db5cceb0d33db873e116503a12a97d86e6cd1966a7051302bb9184e')}
TEST_PINS = {'tests/dom-double.mjs': (2471, 'ef7eb4c01d49665556aa35d23bf32c10fe1261f32e19061e46a25ff49147be0d'), 'tests/state.test.mjs': (4164, '48f7f89b74d380d547e8bdfb52a3b56c31c404fd5c08c2258fd7a9346905e539'), 'tests/view.test.mjs': (7270, 'e2845150b3d108a6266be4afda598b944a8e0cc23100eaa2b8b1b544e88b2bec')}

def read_json(name, limit):
    path = ROOT / name
    assert path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, name
    return json.loads(path.read_text(encoding='utf-8'))

def canonical(rows):
    return hashlib.sha256(''.join(r['path'] + '\0' + r['sha256'] + '\n' for r in rows).encode()).hexdigest()

def listing(root, limit):
    assert root.is_dir() and not root.is_symlink(), 'Expected regular directory'
    files = []
    count = 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            count += 1
            assert count <= limit + 1000, 'Entry bound exceeded'
            path = Path(directory) / name
            assert not path.is_symlink(), 'Symlink forbidden'
            assert path.is_file() or path.is_dir(), 'Special file forbidden'
            if path.is_file():
                files.append(path.relative_to(root).as_posix())
                assert len(files) <= limit, 'File bound exceeded'
    return sorted(files, key=PurePosixPath)

def verify_file(path, row):
    assert path.is_file() and not path.is_symlink(), row['path']
    assert path.stat().st_size == row['bytes'], 'Size differs: ' + row['path']
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    assert digest.hexdigest() == row['sha256'], 'Hash differs: ' + row['path']

def verify(dist=None):
    full = read_json('FULL-MANIFEST.json', 200000)
    delta = read_json('SIX-ADD-DELTA.json', 10000)
    rows = full['files']
    assert full['fileCount'] == len(rows) == 516
    assert full['bytes'] == sum(r['bytes'] for r in rows) == 135547989
    paths = [r['path'] for r in rows]
    assert len(set(paths)) == 516 and paths == sorted(paths, key=PurePosixPath)
    for row in rows:
        parts = PurePosixPath(row['path']).parts
        assert parts and not PurePosixPath(row['path']).is_absolute() and '..' not in parts
        assert row['path'] == PurePosixPath(row['path']).as_posix() and '\\' not in row['path']
        assert isinstance(row['bytes'], int) and 0 <= row['bytes'] <= 136000000
        assert len(row['sha256']) == 64 and all(c in '0123456789abcdef' for c in row['sha256'])
    assert full['canonicalSha256'] == canonical(rows) == CANDIDATE
    added = [{'path': PREFIX + name, 'bytes': length, 'sha256': digest}
             for name, (length, digest) in sorted(PINS.items())]
    assert delta == {'baselineFileCount': 510, 'candidateFileCount': 516,
                     'addedBytes': 12774, 'added': added, 'modified': [], 'deleted': []}
    assert [r for r in rows if r['path'].startswith(PREFIX)] == added
    baseline = [r for r in rows if not r['path'].startswith(PREFIX)]
    assert len(baseline) == 510 and sum(r['bytes'] for r in baseline) == 135535215
    assert canonical(baseline) == BASELINE
    source = ROOT / 'public'
    assert listing(source, 6) == sorted(PINS, key=PurePosixPath)
    for row in added:
        verify_file(source / row['path'][len(PREFIX):], row)
    assert listing(ROOT / 'tests', 3) == sorted(n[6:] for n in TEST_PINS)
    for name, (length, digest) in TEST_PINS.items():
        verify_file(ROOT / name, {'path': name, 'bytes': length, 'sha256': digest})
    # Static inspection only: every supplied ESM import resolves in this archive
    # or is one of the two built-in modules. Product tests are not executed here.
    allowed = {'public/' + n for n in PINS} | set(TEST_PINS)
    closure = []
    for name in sorted(allowed):
        if not name.endswith('.mjs'):
            continue
        text = (ROOT / name).read_text(encoding='utf-8')
        assert not re.search(r'\bimport\s*\(', text)
        for dep in re.findall(r'\bfrom\s+[\"\']([^\"\']+)[\"\']', text):
            if dep.startswith('node:'):
                assert dep in ('node:test', 'node:assert/strict') and name.startswith('tests/')
                target = dep
            else:
                assert dep.startswith('./') or dep.startswith('../')
                resolved = (ROOT / name).parent.joinpath(dep).resolve()
                assert resolved.is_relative_to(ROOT.resolve())
                target = resolved.relative_to(ROOT.resolve()).as_posix()
                assert target in allowed
            closure.append({'from': name, 'import': dep, 'target': target})
    assert len(closure) == 15

    if dist is not None:
        dist = Path(dist)
        assert listing(dist, 516) == paths, 'Complete dist membership differs'
        for row in rows:
            verify_file(dist / row['path'], row)
    return {'status': 'PASS_BYTE_IDENTITY_ONLY', 'archivedSourceFiles': 6,
            'archivedSourceBytes': 12774, 'manifestFiles': 516,
            'manifestCanonicalSha256': CANDIDATE, 'baselineFiles': 510,
            'fullDistBytesCompared': dist is not None, 'runtimeExecuted': False,
            'liveHttpResponseBodiesCompared': False, 'testSourceFiles': 3,
            'testImportClosure': closure, 'testRuntimeExecuted': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', help='Optional complete official source dist directory')
    args = parser.parse_args()
    print(json.dumps(verify(args.dist), indent=2))
