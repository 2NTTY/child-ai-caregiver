"""Read-only byte verification. This script does not execute tests or fetch a runtime."""
from pathlib import Path
import argparse
import hashlib
import json
import re

P = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--full-dist', type=Path, help='Optional complete published dist directory to verify')
parser.add_argument('--source-manifest', type=Path, default=P / 'SOURCE.json',
                    help='Full source manifest; defaults to the adjacent SOURCE.json')
args = parser.parse_args()
replay = json.loads((P / 'REPLAY-INPUTS.json').read_text())
assert replay['cases'] == len(replay['caseNames']) == 46
assert len(replay['inputs']) == 24
for row in replay['inputs']:
    relative = Path(row['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    data = (P / relative).read_bytes()
    assert len(data) == row['bytes'] and sha(data) == row['sha256'], row['path']
source = json.loads(args.source_manifest.read_text())
assert len(source['files']) == source['fileCount'] == 504
assert len({r['path'] for r in source['files']}) == 504
canonical = sha(''.join(r['path'] + '\0' + r['sha256'] + '\n' for r in source['files']).encode())
assert canonical == source['canonicalSha256'] == replay['candidateCanonicalSha256']
source_map = {r['path']: r for r in source['files']}
for row in replay['inputs']:
    if row['path'].startswith('dist/'):
        assert {**row, 'path': row['path'][5:]} == source_map[row['path'][5:]]
for pin in json.loads((P / 'checks/chat-sources.json').read_text()):
    assert source_map[pin['main']]['sha256'] == pin['mainSha256']
    assert source_map[pin['payloadPath']]['sha256'] == pin['payloadSha256']
# Static import closure for executable modules. HTML is parsed for IDs by the
# controlled harness; its script/style assets are not loaded by these tests.
imports = []
for row in replay['inputs']:
    file = P / row['path']
    if file.suffix not in ['.mjs', '.js']:
        continue
    for target in re.findall(r"^import .*? from ['\"]([^'\"]+)['\"]", file.read_text(), re.M):
        if target.startswith('node:'):
            continue
        assert target.startswith('./') or target.startswith('../'), target
        resolved = (file.parent / target).resolve()
        assert resolved.is_relative_to(P) and resolved.is_file(), target
        imports.append({'from': row['path'], 'to': resolved.relative_to(P).as_posix()})
if args.full_dist:
    actual = [{'path': f.relative_to(args.full_dist).as_posix(), 'bytes': f.stat().st_size,
               'sha256': sha(f.read_bytes())}
              for f in sorted(args.full_dist.rglob('*')) if f.is_file()]
    assert actual == source['files'], 'Full dist does not equal the published manifest'
print(json.dumps({'status': 'PASS', 'pinnedInputs': 24, 'controlledTestCasesIncluded': 46,
                  'fullSuiteCasesIncluded': False, 'staticRelativeImportsResolved': len(imports),
                  'completeDistVerified': bool(args.full_dist), 'testsExecuted': False}))
