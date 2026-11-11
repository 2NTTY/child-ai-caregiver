"""Verify exact archive/test inputs and, optionally, a separately supplied full dist.
No Node/browser/network execution. --prepare copies into a NEW local directory only.
"""
from pathlib import Path
import argparse, hashlib, json, shutil
P=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def check(root, records, exact=False):
    paths=[]
    for row in records:
        rel=Path(row['path']);assert not rel.is_absolute() and '..' not in rel.parts
        f=root/rel;assert f.is_file() and not f.is_symlink(),row['path']
        data=f.read_bytes();assert len(data)==row['bytes'] and sha(data)==row['sha256'],row['path']
        paths.append(rel.as_posix())
    if exact:
        all_files=[]
        for f in root.rglob('*'):
            assert not f.is_symlink(), 'Symlinks are not an exact source checkout'
            if f.is_file():all_files.append(f.relative_to(root).as_posix())
        assert sorted(all_files)==sorted(paths),'Full dist must contain exactly the manifested files'
args=argparse.ArgumentParser();args.add_argument('--dist',type=Path);args.add_argument('--prepare',type=Path);a=args.parse_args()
r=json.loads((P/'REPLAY-INPUTS.json').read_text());check(P,r['inputs'])
assert r['cases']==len(r['caseNames'])==42 and r['standaloneWithoutFullDist'] is False
source=P/'SOURCE.json'
if source.exists():
    m=json.loads(source.read_text());assert len(m['files'])==m['fileCount']==504
    canonical=sha(''.join(x['path']+'\0'+x['sha256']+'\n' for x in m['files']).encode())
    assert canonical==m['canonicalSha256']==r['candidateCanonicalSha256']
if a.dist:
    assert source.exists(),'Finalized SOURCE.json is required for a supplied full dist'
    check(a.dist,m['files'],exact=True);check(a.dist,r['externalSourceAssetsReadByTest'])
    for row in r['inputs']:
        if row['path'].startswith('dist/'):
            assert (P/row['path']).read_bytes()==(a.dist/row['path'][5:]).read_bytes()
if a.prepare:
    assert a.dist and not a.prepare.exists(),'--prepare requires --dist and a new destination'
    # This only materializes verified bytes; it never invokes a test or server.
    assert a.prepare.resolve()!=P and P not in a.prepare.resolve().parents
    assert a.dist.resolve()!=a.prepare.resolve() and a.dist.resolve() not in a.prepare.resolve().parents, 'Replay destination must be outside the supplied dist'
    shutil.copytree(P,a.prepare)
    shutil.copytree(a.dist,a.prepare/'dist',dirs_exist_ok=True)
    check(a.prepare,r['inputs']);check(a.prepare/'dist',m['files'],exact=True)
print(json.dumps({'status':'FULL_DIST_VERIFIED' if a.dist else 'ARCHIVE_INPUTS_VERIFIED_FULL_DIST_REQUIRED','cases':42,'archiveReplayExecuted':False,'fullDistVerified':bool(a.dist),'freshReplayDirectoryPrepared':bool(a.prepare)}))
