"""Verify archived GD01 bytes; optionally compare a complete source dist. No runtime or network."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import os

ROOT = Path(__file__).resolve().parent
PREFIX = 'experiments/guide-reading-gd01/'
CANDIDATE = '4247734441586ff42b0ee8230210be9e1047eafdf3c37732dad21e6e81a6d166'
BASELINE = '60c4f508cf34ce04b1fd87c4bb748d67f821b4bf820da8af3a608c146ac536a4'
PINS = {
    'app.mjs': (1709, '31f61f5e5f5549668747add28c946d2d581ba288a356ecba2ca8a0025e764645'),
    'guide-data.mjs': (2381, '7913254a8828dd5b97309e5a75dd5c47cbb6f24b269e200cc294b2ec52276e6a'),
    'guide-state.mjs': (1009, '53dd4cf26482cee72610a932ededdf53b12439ff0814e588649138febb86fd2d'),
    'guide-view.mjs': (1520, '5d155e02dcab46a9600fb34d12e059c0335551171c91f09ecaa1a453c32b508b'),
    'guide.css': (3010, '34e358eca7c81999ac41e5a3d49bd2b90416ba031719b3f64d6ffc75685639d3'),
    'index.html': (2058, '28ca1f707157ca1329d009cbd5982a5f0e2108c06eb4f022377958d8acd346be'),
}

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
    assert full['fileCount'] == len(rows) == 510
    assert full['bytes'] == sum(r['bytes'] for r in rows) == 135535215
    paths = [r['path'] for r in rows]
    assert len(set(paths)) == 510 and paths == sorted(paths, key=PurePosixPath)
    for row in rows:
        parts = PurePosixPath(row['path']).parts
        assert parts and not PurePosixPath(row['path']).is_absolute() and '..' not in parts
        assert row['path'] == PurePosixPath(row['path']).as_posix() and '\\' not in row['path']
        assert isinstance(row['bytes'], int) and 0 <= row['bytes'] <= 136000000
        assert len(row['sha256']) == 64 and all(c in '0123456789abcdef' for c in row['sha256'])
    assert full['canonicalSha256'] == canonical(rows) == CANDIDATE
    added = [{'path': PREFIX + name, 'bytes': length, 'sha256': digest}
             for name, (length, digest) in sorted(PINS.items())]
    assert delta == {'baselineFileCount': 504, 'candidateFileCount': 510,
                     'addedBytes': 11687, 'added': added, 'modified': [], 'deleted': []}
    assert [r for r in rows if r['path'].startswith(PREFIX)] == added
    baseline = [r for r in rows if not r['path'].startswith(PREFIX)]
    assert len(baseline) == 504 and sum(r['bytes'] for r in baseline) == 135523528
    assert canonical(baseline) == BASELINE
    source = ROOT / 'source'
    assert listing(source, 6) == [r['path'] for r in added]
    for row in added:
        verify_file(source / row['path'], row)
    if dist is not None:
        dist = Path(dist)
        assert listing(dist, 510) == paths, 'Complete dist membership differs'
        for row in rows:
            verify_file(dist / row['path'], row)
    return {'status': 'PASS_BYTE_IDENTITY_ONLY', 'archivedSourceFiles': 6,
            'archivedSourceBytes': 11687, 'manifestFiles': 510,
            'manifestCanonicalSha256': CANDIDATE, 'baselineFiles': 504,
            'fullDistBytesCompared': dist is not None, 'runtimeExecuted': False,
            'liveHttpResponseBodiesCompared': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', help='Optional complete official source dist directory')
    args = parser.parse_args()
    print(json.dumps(verify(args.dist), indent=2))
