"""Reconstruct reviewed UTF-8 source from inert tracked parts; never execute parts."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

PREFIX = 'preview-publish-20261029/'
SCHEMES = {'harbour', 'handbook', 'fourth', 'orchestrator'}
BOOTSTRAP = PREFIX + 'orchestrator/materialize_transport.py'
ACTIVE_WORKFLOW = '.github/workflows/frontend-preview-export.yml'
MANIFEST = PREFIX + 'orchestrator/TRANSPORT_MANIFEST.json'


def need(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def relative(value):
    need(isinstance(value, str) and value, 'Missing relative path')
    p = PurePosixPath(value)
    need(not p.is_absolute() and not any(x in {'.', '..', '.git'} for x in p.parts)
         and '\\' not in value and p.as_posix() == value, 'Unsafe relative path')
    return value


def part_path(row, part_index):
    pieces = PurePosixPath(row['destination']).parts
    need(len(pieces) >= 3 and pieces[0] == PREFIX.rstrip('/') and pieces[1] in SCHEMES, 'Part destination outside scheme')
    return f"{PREFIX}{pieces[1]}/.transport/{row['sha256']}/{part_index:04d}.part"


def file_at(root, name):
    path = root / relative(name)
    cursor = root
    for segment in PurePosixPath(name).parts:
        cursor = cursor / segment
        need(not cursor.is_symlink(), 'Symlink path rejected')
    return path


def read_exact(root, name, expected_size, expected_sha):
    path = file_at(root, name)
    need(path.is_file() and path.stat().st_size == expected_size, 'Missing file or byte length mismatch')
    data = path.read_bytes()
    need(sha(data) == expected_sha, 'File SHA-256 mismatch')
    data.decode('utf-8', errors='strict')
    return data


def materialize(root, orchestration_sha):
    root = Path(root).resolve(strict=True)
    need(re.fullmatch('[0-9a-f]{40}', orchestration_sha), 'Invalid orchestration SHA')
    git = lambda *args: subprocess.check_output(['git', '-C', str(root), *args])
    need(git('rev-parse', 'HEAD').decode().strip() == orchestration_sha, 'Wrong physical transport commit')
    need(not git('status', '--porcelain'), 'Physical checkout must start clean')
    manifest_path = file_at(root, MANIFEST)
    need(manifest_path.is_file() and manifest_path.stat().st_size <= 40000, 'Transport manifest envelope exceeded')
    raw = manifest_path.read_bytes()
    expected_manifest_sha = sha(raw)
    doc = json.loads(raw)
    need(doc['schema'] == 'reviewed-utf8-source-transport-v1' and doc['partMaxBytes'] == 40000, 'Unknown transport contract')
    need(re.fullmatch('[0-9a-f]{64}', doc['logicalAllowlistSha256']) and len(doc['files']) == 39, 'Expected complete reviewed logical inventory')
    read_exact(root, BOOTSTRAP, doc['bootstrap']['bytes'], doc['bootstrap']['sha256'])
    expected_physical = {BOOTSTRAP, MANIFEST}
    logical = set()
    generated = []
    for index, row in enumerate(doc['files']):
        destination = relative(row['destination'])
        need(destination.startswith(PREFIX) or destination == ACTIVE_WORKFLOW, 'Unexpected logical destination')
        need('.transport' not in PurePosixPath(destination).parts and destination not in {BOOTSTRAP, MANIFEST}, 'Reserved logical destination')
        need(destination not in logical, 'Duplicate logical destination')
        logical.add(destination)
        need(type(row['bytes']) is int and row['bytes'] >= 0 and re.fullmatch('[0-9a-f]{64}', row['sha256']), 'Invalid logical pin')
        parts = row['parts']
        need(isinstance(parts, list), 'Invalid part list')
        if not parts:
            need(row['bytes'] <= 40000, 'Large source must use inert transport')
            read_exact(root, destination, row['bytes'], row['sha256'])
            expected_physical.add(destination)
            continue
        need(not file_at(root, destination).exists(), 'Generated destination already exists; never overwrite tracked/source files')
        full_hash = hashlib.sha256(); total = 0
        for part_index, part in enumerate(parts):
            need(type(part['offset']) is int and part['offset'] == total, 'Part order/offset mismatch')
            need(type(part['bytes']) is int and 0 < part['bytes'] <= 40000, 'Part size exceeded')
            name = part_path(row, part_index)
            need(name not in expected_physical, 'Duplicate transport part')
            body = read_exact(root, name, part['bytes'], part['sha256'])
            expected_physical.add(name); full_hash.update(body); total += len(body)
        need(total == row['bytes'] and full_hash.hexdigest() == row['sha256'], 'Whole logical source mismatch')
        generated.append((index, row))
    tracked = set(git('ls-files', '-z').decode().split('\0')) - {''}
    scoped_tracked = {x for x in tracked if x.startswith(PREFIX) or x.startswith('.github/workflows/')}
    need(scoped_tracked == expected_physical, 'Unexpected/missing tracked transport files')
    scoped_physical = set()
    namespace = file_at(root, PREFIX.rstrip('/'))
    for path in namespace.rglob('*'):
        need(not path.is_symlink(), 'Symlink transport entry')
        if path.is_file():
            scoped_physical.add(path.relative_to(root).as_posix())
        else:
            need(path.is_dir() and any(x.startswith(path.relative_to(root).as_posix() + '/') for x in expected_physical), 'Unexpected directory or nonregular transport entry')
    workflows = file_at(root, '.github/workflows')
    for path in workflows.rglob('*'):
        need(not path.is_symlink(), 'Symlink workflow entry')
        if path.is_file():
            scoped_physical.add(path.relative_to(root).as_posix())
        else:
            need(path.is_dir() and any(x.startswith(path.relative_to(root).as_posix() + '/') for x in expected_physical), 'Unexpected workflow directory')
    need(scoped_physical == expected_physical, 'Unexpected/missing physical transport files')
    # All parts and the complete original 39-file hash inventory are verified first.
    for index, row in generated:
        target = file_at(root, row['destination'])
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            for part_index, part in enumerate(row['parts']):
                output.write(read_exact(root, part_path(row, part_index), part['bytes'], part['sha256']))
        read_exact(root, row['destination'], row['bytes'], row['sha256'])
    for row in doc['files']:
        read_exact(root, row['destination'], row['bytes'], row['sha256'])
    after_files = {path.relative_to(root).as_posix() for path in namespace.rglob('*') if path.is_file()}
    need(after_files == {x for x in expected_physical | logical if x.startswith(PREFIX)}, 'Unexpected post-materialization files')
    need(not git('diff', '--name-only', 'HEAD'), 'Tracked transport source changed')
    result = {'status': 'EXACT_REVIEWED_LOGICAL_SOURCE_MATERIALIZED', 'physicalCommit': orchestration_sha,
              'transportManifestSha256': expected_manifest_sha, 'logicalAllowlistSha256': doc['logicalAllowlistSha256'],
              'logicalFiles': len(logical), 'generatedFromTrackedUtf8Parts': [
                  {'path': row['destination'], 'bytes': row['bytes'], 'sha256': row['sha256']} for _, row in generated],
              'partsExecuted': False, 'trackedFilesOverwritten': False}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--orchestration-sha', required=True)
    args = parser.parse_args()
    print(json.dumps(materialize(args.root, args.orchestration_sha), sort_keys=True))
