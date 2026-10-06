import datetime, hashlib, json, os, pathlib, subprocess, sys
ROOT=pathlib.Path('/workspace/shared/caregiver_preparations_update')
FE=ROOT/'frontend'
RUN=FE/'verification/next-release-2026-10-05T16-06Z-single-worker-recovery'
META=pathlib.Path('/workspace/shared/caregiver_layout_redesign_metadata')
BUILD=pathlib.Path('/workspace/shared/caregiver_preparations_update_builds/next-release-2026-10-05T16-06Z-single-worker-recovery')
FREEZE=os.environ.get('ROOT_SOURCE_FREEZE')
if not FREEZE: raise SystemExit('ROOT_SOURCE_FREEZE is required; no verification has started')
BASELINE=pathlib.Path('/workspace/shared/caregiver_preparations_update/frontend/verification/next-release-2026-10-05T16-00Z/source-manifest.json')
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
save('source-manifest.json',{'capturedAt':now(),'priorRemoteHeadReference':'65f8cf37bceeb15b05f46326c49e0370349ae3a5','remoteHeadVerification':'Reference from the preceding handoff only, not a claim of current remote head. Root owns Git review; actual frozen source bytes are recorded here.','files':before,'readOnlyDependency':{'path':'src/shared/family.ts','sha256':family_hash}})
save('preserved-evidence-manifest.json',evidence)
prior_source=json.loads(BASELINE.read_text())
prior_runtime=runtime(prior_source['files']); current_runtime=runtime(before)
save('runtime-delta-from-initial-next-freeze.json',{'priorManifest':str(BASELINE),'currentRootFreeze':FREEZE,'priorManifestSha256':sha(BASELINE),'changes':[{'path':p,'priorSha256':prior_runtime.get(p),'sha256':current_runtime.get(p)} for p in sorted(set(prior_runtime)|set(current_runtime)) if prior_runtime.get(p)!=current_runtime.get(p)]})
result={'startedAt':now(),'priorRemoteHeadReference':'65f8cf37bceeb15b05f46326c49e0370349ae3a5','scope':'One approved export-only recovery with fresh cache and max-workers 1 for the final NEXT child overview, multipurpose preparation/archive/history, legacy summary recovery, six-item multi-chat important-pending record review, expired-operation guard and fill-or-outline button integration. Owners focused evidence is reused, not rerun. Original browser failures and all earlier evidence are preserved. No browser actions until root publishes and hands off the exact artifact.','rootSourceFreeze':FREEZE,'cwd':str(FE),'sourceManifestSha256':sha(RUN/'source-manifest.json'),'runtimeManifestSha256':hashlib.sha256(json.dumps(runtime(before),sort_keys=True).encode()).hexdigest(),'environmentSource':'Root-specified known Expo variables with a new isolated TMPDIR; previous shared-cache script was not sourced','environment':{k:os.environ.get(k) for k in ['TMPDIR','EXPO_NO_TELEMETRY','EXPO_OFFLINE','__UNSAFE_EXPO_HOME_DIRECTORY']},'dependencyTarget':str((FE/'node_modules').resolve()),'buildPath':str(BUILD),'commands':[],'status':'running','notRun':['Browser: awaits root publication handoff of this exact artifact; v38 ChildPicker/footer pointer failures remain unresolved','Owners focused tests and comprehensive action-source audit are reused; no blanket rerun','Prior full frontend matrix or screenshot uploads','Real backend/model/family data/camera/microphone/native devices','Git, Sites or authoritative documentation changes']}
ready=json.loads((META/'dependency-readiness.json').read_text())
delta_paths=sorted(p for p in set(prior_runtime)|set(current_runtime) if prior_runtime.get(p)!=current_runtime.get(p))
result['deltaFromInitialNextFreeze']={'actual':delta_paths,'priorManifest':str(BASELINE),'priorManifestSha256':sha(BASELINE)}
result['browserAcceptance']='Pending publication. Four-width changed-page geometry, runtime button and status flows remain distinct from source-only audit; prior pointer failures are not converted into passes.'
errors=[]
expected_delta=['frontend/src/components/care/CareRecordsView.tsx']
expected_care_sha='6c7571d05d2f94c9ef19f374a0736ccfad2e56fc7315b12774528cfb7e226486'
if delta_paths!=expected_delta: errors.append('Unexpected runtime delta after initial aggregate typecheck: '+str(delta_paths))
if sha(FE/'src/components/care/CareRecordsView.tsx')!=expected_care_sha: errors.append('Final CareRecordsView does not match root freeze hash')
result['aggregateTypecheckReuse']={'path':'frontend/verification/next-release-2026-10-05T16-00Z/build-checks.json','sha256':sha(FE/'verification/next-release-2026-10-05T16-00Z/build-checks.json'),'result':'Complete aggregate typecheck exit 0 on initial freeze; final source differs at only expected CareRecordsView.tsx runtime path','currentDelta':delta_paths,'expectedDelta':expected_delta,'scopedSemantic':'Owner reported zero scoped semantic diagnostics plus six guards passed for moving the unchanged manual input button into the existing collapsed secondary area; not rerun or represented as verifier stdout'}
result['originalExportFailure']={'path':'frontend/verification/next-release-2026-10-05T16-00Z/export-failure-diagnosis.json','result':'Exit 137 Killed; cause unknown, OOM not established; original evidence preserved'}
for p,k in [('package.json','package_json_sha256'),('package-lock.json','lockfile_sha256')]:
    if sha(FE/p)!=ready[k]: errors.append('Dependency readiness hash mismatch: '+p)
if not (FE/'node_modules').is_symlink(): errors.append('Expected existing node_modules symlink')
if BUILD.exists(): errors.append('New export directory already exists')
care_owner_path=FE/'verification/records-next-integration-2026-10-05/multi-chat-review-checks.json'
care_owner=json.loads(care_owner_path.read_text())
care_drift=[p for p,h in care_owner['files'].items() if not(FE/p).is_file() or sha(FE/p)!=h]
result['careOwnerManifest']={'path':str(care_owner_path),'sha256':sha(care_owner_path),'sourceSetSha256':care_owner['sourceSetSha256'],'expectedSourceSetSha256':'b0f5e30ad2568d8bcf99888f843c75781f8b67e7cb19ee05b735495e78c2c826','fileDrift':care_drift}
if care_drift: errors.append('Final Care owner per-file manifest mismatch: '+str(care_drift))
if care_owner['sourceSetSha256']!='b0f5e30ad2568d8bcf99888f843c75781f8b67e7cb19ee05b735495e78c2c826': errors.append('Unexpected Care source collection')
router_code="const path=require('path');const root=process.cwd();const router=require(root+'/node_modules/expo/node_modules/@expo/cli/build/src/start/server/metro/router.js');const entry=require.resolve('expo-router/entry',{paths:[root]});const relative=router.getAppRouterRelativeEntryPath(root);console.log(JSON.stringify({projectRoot:root,routerEntry:entry,routerDirectory:router.getRouterDirectory(root),appRootRelativeToRouterEntry:relative,resolvedAppRoot:path.resolve(path.dirname(entry),relative)}));"
router_proc=subprocess.run(['node','-e',router_code],cwd=FE,env={**os.environ,'DEBUG':''},capture_output=True,text=True)
if router_proc.returncode: errors.append('Router app root inspection failed: '+router_proc.stderr)
else:
    router=json.loads(router_proc.stdout); save('router-app-root.json',router)
    if router['resolvedAppRoot']!=str(FE/'app'): errors.append('Router app root is not exact NEXT/app')
    result['routerAppRootEvidence']={'path':'router-app-root.json','sha256':sha(RUN/'router-app-root.json')}
result['focusedEvidenceReuse']={'care':str(care_owner_path),'reportedPasses':{'overlap':6,'query':1,'child':7,'preparation':21,'composition':8,'buttons':11},'qualification':'Owner/root-reported focused passes; not rerun or claimed as verifier stdout'}
result['preflight']={'status':'failed' if errors else 'passed','errors':errors,'sourceFiles':len(before),'runtimeFiles':len(runtime(before)),'preservedEvidenceFiles':len(evidence),'existingTestFiles':sum('.test.' in x['path'] for x in before),'installedPackages':False}

def finalize(status):
    after=snapshot(); post=runtime(after); pre=runtime(before)
    drift=sorted(p for p in set(pre)|set(post) if pre.get(p)!=post.get(p))
    all_before={x['path']:x['sha256'] for x in before}; all_after={x['path']:x['sha256'] for x in after}
    all_drift=sorted(p for p in set(all_before)|set(all_after) if all_before.get(p)!=all_after.get(p))
    if sha(family)!=family_hash: drift.append('src/shared/family.ts')
    old_evidence_drift=sorted(p for p,h in evidence.items() if not(ROOT/p).is_file() or sha(ROOT/p)!=h)
    save('post-check-source-manifest.json',{'capturedAt':now(),'files':after})
    result['integrity']={'status':'failed' if drift or all_drift or old_evidence_drift else 'passed','runtimeDrift':drift,'allSourceDrift':all_drift,'preservedEvidenceDrift':old_evidence_drift}
    result['status']='stopped-on-first-failure' if drift or all_drift or old_evidence_drift else status
    result['finishedAt']=now(); save('build-checks.json',result)
    return bool(drift or all_drift or old_evidence_drift)

save('build-checks.json',result)
if errors:
    finalize('stopped-on-first-failure'); print(json.dumps(result,ensure_ascii=False,indent=2),flush=True); sys.exit(1)
for name,cmd in [('web-export',['npm','run','build:web','--','--clear','--max-workers','1','--output-dir',str(BUILD)])]:
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
entry_text='\n'.join((BUILD/x['path']).read_text() for x in result['webEntry'])
# Minifiers may emit literal Unicode or \u escapes. Match both without changing generated code.
def marker(text): return text in entry_text or json.dumps(text,ensure_ascii=True)[1:-1] in entry_text
checks={'historyRouteExported':(BUILD/'history.html').is_file(),'summaryRouteExported':(BUILD/'summary.html').is_file(),'historyInClientRouteMap':'./(dashboard)/history.tsx' in entry_text,'newChildOverview':marker('孩子概況與準備'),'multipurposePreparation':marker('合成準備單示例'),'archiveAction':marker('使用完畢，歸檔'),'importantPendingFirst':marker('重要內容，仍待你確認'),'crossChatSemantics':marker('聊完幾次再回來，可一起查看留下了甚麼。普通已保存內容不用逐筆確認，有誤才更正；重要待確認會持續保留。'),'noOldCheckoutAssetRoot':'/assets/__caregiver_layout_redesign/' not in entry_text and '/assets/__caregiver_agent_first_update/' not in entry_text}
result['exportSourceIntegrity']={'status':'passed' if all(checks.values()) else 'failed','checks':checks,'method':'Observed fixed source strings checked in literal or minified Unicode-escape form; authoritative installed Expo router resolver confirms exact NEXT app root. Not browser proof.'}
failed=finalize('passed-next-local-build-browser-pending' if all(checks.values()) else 'stopped-on-export-source-integrity-failure')
failed=failed or not all(checks.values())
print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
sys.exit(1 if failed else 0)
