import datetime, hashlib, json, os, pathlib, subprocess, sys, time
ROOT=pathlib.Path('/workspace/shared/caregiver_layout_redesign')
FRONTEND=ROOT/'frontend'
RUN=FRONTEND/'verification/function-layout-integration-2026-10-04T18-58Z-baseline-retry'
META=pathlib.Path('/workspace/shared/caregiver_layout_redesign_metadata')
BUILD=pathlib.Path('/workspace/shared/caregiver_layout_redesign_builds/function-layout-2026-10-04T18-58Z')
BASE='65f8cf37bceeb15b05f46326c49e0370349ae3a5'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def save(name,value): (RUN/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def snapshot():
    files=[]
    for parent, dirs, names in os.walk(FRONTEND,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in ['node_modules','verification','.expo','.expo-home','.npm-cache','.git'] and not d.startswith('dist'))
        for name in sorted(names):
            p=pathlib.Path(parent)/name
            if p.is_symlink(): continue
            files.append({'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':sha(p),'runtime':p.suffix.lower() not in ['.md'] and '/.agents/' not in str(p)})
    return files
def existing_evidence():
    return {str(p.relative_to(ROOT)):sha(p) for p in (FRONTEND/'verification').rglob('*') if p.is_file() and RUN not in p.parents}
result={'baseline':BASE,'startedAt':now(),'cwd':str(FRONTEND),'environmentFile':str(META/'expo-environment.sh'),'environmentFileSha256':sha(META/'expo-environment.sh'),'environment':{k:os.environ.get(k) for k in ['TMPDIR','EXPO_NO_TELEMETRY','EXPO_OFFLINE','__UNSAFE_EXPO_HOME_DIRECTORY']},'dependencySymlink':str(FRONTEND/'node_modules'),'dependencyTarget':str((FRONTEND/'node_modules').resolve()),'buildPath':str(BUILD),'commands':[],'scope':'One semantic typecheck then one Web export after source freeze. No browser, real backend, model, camera/microphone, native devices or full regression.','status':'running'}
result['retryAuthorization']='Root authorized one typecheck retry after materializing the unchanged baseline src/shared/family.ts dependency; first failure is preserved in the 18-56Z run.'
contract=ROOT/'src/shared/family.ts'
contract_bytes=contract.read_bytes()
contract_blob=hashlib.sha1(b'blob '+str(len(contract_bytes)).encode()+b'\0'+contract_bytes).hexdigest()
result['readOnlyBaselineDependency']={'path':'src/shared/family.ts','gitBlobSha1':contract_blob,'expectedGitBlobSha1':'5f605fac7d982748ca2e90c38964ce6458adbf9b','sha256':sha(contract)}
save('build-checks.json',result)
before=snapshot(); evidence_before=existing_evidence(); baseline=json.loads((META/'baseline-path-manifest.json').read_text()); basepaths={x['path']:x for x in baseline['paths']}; current={x['path']:x for x in before}
save('source-manifest.json',{'baseline':BASE,'capturedAt':now(),'files':before})
save('existing-evidence-manifest.json',evidence_before)
result['sourceManifestSha256']=sha(RUN/'source-manifest.json')
result['runtimeManifestSha256']=hashlib.sha256(json.dumps([x for x in before if x['runtime']],sort_keys=True).encode()).hexdigest()
changes=[]
for p,v in current.items():
    b=basepaths.get(p)
    if not b or b.get('sha256')!=v['sha256']: changes.append({'path':p,'sha256':v['sha256'],'baselineSha256':b.get('sha256') if b else None,'status':'modified' if b else 'new','runtime':v['runtime']})
save('source-delta.json',{'baseline':BASE,'files':changes,'sparseWorkspace':True,'missingNonMaterializedPathsAreNotDeletions':True})
errors=[]
if contract_blob!='5f605fac7d982748ca2e90c38964ce6458adbf9b': errors.append('Baseline contract Git blob mismatch')
for p,b in basepaths.items():
    if b.get('materialized') and p.startswith('frontend/') and ('.test.' in p or p.startswith('frontend/verification/')):
        if p not in current: errors.append('Materialized baseline test/evidence absent: '+p)
        elif current[p]['sha256']!=b['sha256']: errors.append('Existing baseline test/evidence changed: '+p)
ready=json.loads((META/'dependency-readiness.json').read_text())
for file,key in [('package.json','package_json_sha256'),('package-lock.json','lockfile_sha256')]:
    if sha(FRONTEND/file)!=ready[key]: errors.append('Dependency readiness hash mismatch: '+file)
if BUILD.exists(): errors.append('New export target already exists: '+str(BUILD))
result['preflight']={'status':'failed' if errors else 'passed','errors':errors,'preservedMaterializedBaselineTestCount':sum(b.get('materialized',False) and p.startswith('frontend/') and '.test.' in p for p,b in basepaths.items()),'existingEvidenceFiles':len(evidence_before),'sourceFiles':len(before),'runtimeFiles':sum(x['runtime'] for x in before)}
save('build-checks.json',result)
if errors:
    result.update(status='stopped-on-first-failure',finishedAt=now()); save('build-checks.json',result); print(json.dumps(result,ensure_ascii=False,indent=2),flush=True); sys.exit(1)
for label,cmd in [('typecheck',['npm','run','typecheck']),('web-export',['npm','run','build:web','--','--output-dir',str(BUILD)])]:
    rec={'name':label,'argv':cmd,'startedAt':now(),'log':label+'.log'}; result['commands'].append(rec); save('build-checks.json',result)
    print('RUN '+label+': '+' '.join(cmd),flush=True)
    with (RUN/rec['log']).open('w') as log:
        proc=subprocess.run(cmd,cwd=FRONTEND,env=os.environ.copy(),stdout=log,stderr=subprocess.STDOUT)
    rec.update(exitCode=proc.returncode,finishedAt=now(),logSha256=sha(RUN/rec['log']))
    print((RUN/rec['log']).read_text()[-16000:],flush=True)
    save('build-checks.json',result)
    if proc.returncode:
        result.update(status='stopped-on-first-failure',finishedAt=now()); save('build-checks.json',result); sys.exit(proc.returncode)
after=snapshot(); before_runtime={x['path']:x['sha256'] for x in before if x['runtime']}; after_runtime={x['path']:x['sha256'] for x in after if x['runtime']}
source_drift=sorted(p for p in set(before_runtime)|set(after_runtime) if before_runtime.get(p)!=after_runtime.get(p))
if sha(contract)!=result['readOnlyBaselineDependency']['sha256']: source_drift.append('src/shared/family.ts')
evidence_drift=sorted(p for p,v in evidence_before.items() if not (ROOT/p).is_file() or sha(ROOT/p)!=v)
result['postBuildIntegrity']={'runtimeDrift':source_drift,'oldEvidenceDrift':evidence_drift,'status':'failed' if source_drift or evidence_drift else 'passed'}
save('post-build-source-manifest.json',{'capturedAt':now(),'files':after})
built=[{'path':str(p.relative_to(BUILD)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(BUILD.rglob('*')) if p.is_file()]
save('build-manifest.json',{'buildPath':str(BUILD),'files':built}); result['buildManifestSha256']=sha(RUN/'build-manifest.json'); result['exportedFileCount']=len(built)
result.update(status='stopped-on-first-failure' if source_drift or evidence_drift else 'passed-bounded-build-checks',finishedAt=now())
save('build-checks.json',result); print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
sys.exit(1 if source_drift or evidence_drift else 0)
