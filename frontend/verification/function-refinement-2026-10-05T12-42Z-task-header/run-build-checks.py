import datetime, hashlib, json, os, pathlib, subprocess, sys
ROOT=pathlib.Path('/workspace/shared/caregiver_layout_redesign')
FE=ROOT/'frontend'
RUN=FE/'verification/function-refinement-2026-10-05T12-42Z-task-header'
META=pathlib.Path('/workspace/shared/caregiver_layout_redesign_metadata')
BUILD=pathlib.Path('/workspace/shared/caregiver_layout_redesign_builds/function-refinement-2026-10-05T12-42Z-task-header')
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name,value): (RUN/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def snapshot():
    items=[]
    for parent,dirs,names in os.walk(FE,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in ['node_modules','verification','.expo','.expo-home','.npm-cache','.git'] and not d.startswith('dist'))
        for name in sorted(names):
            p=pathlib.Path(parent)/name
            if p.is_symlink(): continue
            items.append({'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':sha(p),'runtime':p.suffix.lower()!='.md' and '/.agents/' not in str(p)})
    return items
def previous_evidence():
    return {str(p.relative_to(ROOT)):sha(p) for p in (FE/'verification').rglob('*') if p.is_file() and RUN not in p.parents}
def runtime(items): return {x['path']:x['sha256'] for x in items if x['runtime']}
before=snapshot(); evidence=previous_evidence(); family=ROOT/'src/shared/family.ts'
family_hash=sha(family)
save('source-manifest.json',{'capturedAt':now(),'priorRemoteHeadReference':'2a64fdd7eae52c37c4f42f39ea286b4d3acd8630','remoteHeadVerification':'Reference from the preceding handoff only, not a claim of current remote head. Root owns Git review; actual frozen source bytes are recorded here.','files':before,'readOnlyDependency':{'path':'src/shared/family.ts','sha256':family_hash}})
save('preserved-evidence-manifest.json',evidence)
prior_source=json.loads((FE/'verification/function-refinement-2026-10-05T12-32Z-more-fix/source-manifest.json').read_text())
prior_runtime=runtime(prior_source['files']); current_runtime=runtime(before)
save('runtime-delta-from-v37.json',{'priorManifest':'frontend/verification/function-refinement-2026-10-05T12-32Z-more-fix/source-manifest.json','currentRootFreeze':'2026-10-05T12:59:20Z','changes':[{'path':p,'priorSha256':prior_runtime.get(p),'sha256':current_runtime.get(p)} for p in sorted(set(prior_runtime)|set(current_runtime)) if prior_runtime.get(p)!=current_runtime.get(p)]})
result={'startedAt':now(),'priorRemoteHeadReference':'2a64fdd7eae52c37c4f42f39ea286b4d3acd8630','scope':'One semantic typecheck and one Web export for the three-file Tasks presentation change and two-file Growth chapter close-then-scroll fix after the v37 persistent chapter navigation failure. Original partial browser evidence is preserved. No browser actions during this build; targeted published-artifact verification awaits root handoff.','cwd':str(FE),'sourceManifestSha256':sha(RUN/'source-manifest.json'),'runtimeManifestSha256':hashlib.sha256(json.dumps(runtime(before),sort_keys=True).encode()).hexdigest(),'environmentFile':str(META/'expo-environment.sh'),'environmentFileSha256':sha(META/'expo-environment.sh'),'environment':{k:os.environ.get(k) for k in ['TMPDIR','EXPO_NO_TELEMETRY','EXPO_OFFLINE','__UNSAFE_EXPO_HOME_DIRECTORY']},'dependencyTarget':str((FE/'node_modules').resolve()),'buildPath':str(BUILD),'commands':[],'status':'running','notRun':['Browser: paused after v37 Growth chapter navigation failure; a targeted published-build handoff is required before resuming','verify-home-introduction.mjs: obsolete greeting/large-child-card assertions were not run or edited','Prior full frontend matrix or screenshot uploads','Real backend/model/family data/camera/microphone/native devices','Git, Sites or authoritative documentation changes']}
ready=json.loads((META/'dependency-readiness.json').read_text())
delta_paths=sorted(p for p in set(prior_runtime)|set(current_runtime) if prior_runtime.get(p)!=current_runtime.get(p))
expected_delta=sorted(['frontend/src/components/tasks/TasksView.tsx','frontend/src/components/tasks/TaskDetail.tsx','frontend/src/components/tasks/TaskContent.tsx','frontend/src/components/ui.tsx','frontend/src/components/growth/GrowthArchive.tsx'])
result['deltaFromV37']={'actual':delta_paths,'expected':expected_delta,'matches':delta_paths==expected_delta}
result['growthVisualAcceptance']='Prior v37 four-width geometry and partial coverage/PDF truth evidence retained; chapter navigation failed, repair pending focused browser recheck. Dirty/scope and guide checks remain unrun.'
errors=[]
if delta_paths!=expected_delta: errors.append('Frozen runtime delta differs from the five authorized Tasks/Growth files: '+str(delta_paths))
for p,k in [('package.json','package_json_sha256'),('package-lock.json','lockfile_sha256')]:
    if sha(FE/p)!=ready[k]: errors.append('Dependency readiness hash mismatch: '+p)
if not (FE/'node_modules').is_symlink(): errors.append('Expected existing node_modules symlink')
if BUILD.exists(): errors.append('New export directory already exists')
result['preflight']={'status':'failed' if errors else 'passed','errors':errors,'sourceFiles':len(before),'runtimeFiles':len(runtime(before)),'preservedEvidenceFiles':len(evidence),'existingTestFiles':sum('.test.' in x['path'] for x in before),'installedPackages':False}

def finalize(status):
    after=snapshot(); post=runtime(after); pre=runtime(before)
    drift=sorted(p for p in set(pre)|set(post) if pre.get(p)!=post.get(p))
    if sha(family)!=family_hash: drift.append('src/shared/family.ts')
    old_evidence_drift=sorted(p for p,h in evidence.items() if not(ROOT/p).is_file() or sha(ROOT/p)!=h)
    save('post-check-source-manifest.json',{'capturedAt':now(),'files':after})
    result['integrity']={'status':'failed' if drift or old_evidence_drift else 'passed','runtimeDrift':drift,'preservedEvidenceDrift':old_evidence_drift}
    result['status']='stopped-on-first-failure' if drift or old_evidence_drift else status
    result['finishedAt']=now(); save('build-checks.json',result)
    return bool(drift or old_evidence_drift)

save('build-checks.json',result)
if errors:
    finalize('stopped-on-first-failure'); print(json.dumps(result,ensure_ascii=False,indent=2),flush=True); sys.exit(1)
for name,cmd in [('typecheck',['npm','run','typecheck']),('web-export',['npm','run','build:web','--','--output-dir',str(BUILD)])]:
    rec={'name':name,'argv':cmd,'startedAt':now(),'log':name+'.log'}
    result['commands'].append(rec); save('build-checks.json',result)
    print('RUN '+name+': '+' '.join(cmd),flush=True)
    with (RUN/rec['log']).open('w') as log:
        proc=subprocess.run(cmd,cwd=FE,env=os.environ.copy(),stdout=log,stderr=subprocess.STDOUT)
    rec.update(exitCode=proc.returncode,finishedAt=now(),logSha256=sha(RUN/rec['log']))
    print((RUN/rec['log']).read_text()[-16000:],flush=True)
    save('build-checks.json',result)
    if proc.returncode:
        finalize('stopped-on-first-failure'); sys.exit(proc.returncode)
    # Runtime integrity is independent of command success; stop before next stage on drift.
    if finalize('running'):
        print(json.dumps(result['integrity'],ensure_ascii=False),flush=True); sys.exit(1)
built=[{'path':str(p.relative_to(BUILD)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(BUILD.rglob('*')) if p.is_file()]
save('build-manifest.json',{'buildPath':str(BUILD),'files':built})
result['buildManifestSha256']=sha(RUN/'build-manifest.json'); result['exportedFileCount']=len(built)
result['webEntry']=[x for x in built if x['path'].startswith('_expo/static/js/web/entry-')]
failed=finalize('passed-local-build-tasks-growth-browser-recheck-pending')
print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
sys.exit(1 if failed else 0)
