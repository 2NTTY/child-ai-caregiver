"""Fixed public receipt schema. Scratch JSON/logs are untrusted data, never echoed.
No file contents, environment, test titles, exception strings or absolute paths
are copied to the public object. Every variable string comes from a closed enum,
a manifest-known relative path, or a strictly validated digest.
"""
from pathlib import Path,PurePosixPath
import hashlib,json,math,os,re,stat
from controls import BASES,BRANCH,REPOSITORY,canonical,sha,rows,command_plan
SCHEMA='preview-hf-safe-terminal-v1'
MAX_JSON=4*1024*1024
MAX_LOG=256*1024
MAX_PROGRAM=20000
MAX_DIAGNOSTICS=64
MAX_RECEIPT=1024*1024
OUTCOMES={'success','failure','cancelled','skipped','unknown'}
SETUP=['assembly','node-version','npm-bootstrap','npm-version','locked-install']
TOOLS=['node','npm','tool-resolution']
BOOTSTRAP={'namespace-entry','private-root','readonly-mounts','output-mounts','device-mounts','privilege-drop'}

def number(x,maximum=2**40):return type(x)in (int,float) and math.isfinite(x) and 0<=x<=maximum
def integer(x,maximum=10**7):return type(x)is int and 0<=x<=maximum
def zero(x):return type(x)is int and x==0
def digest(x,n=64):return x if isinstance(x,str)and re.fullmatch('[0-9a-f]{'+str(n)+'}',x)else None
def relative(x):
    return isinstance(x,str)and 0<len(x)<=256 and not x.startswith('/')and '\\'not in x and ':'not in x and all(32<=ord(c)<127 for c in x)and all(p not in ('','.','..','.git','.npmrc')and not p.startswith('.env')for p in x.split('/'))and str(PurePosixPath(x))==x

def read_bytes(root,rel,limit=MAX_JSON):
    if not relative(rel):return None
    p=Path(root)/rel
    try:
        for q in [p,*p.parents]:
            if q.is_symlink():return None
        if not p.is_file()or p.stat().st_size>limit:return None
        with p.open('rb')as f:b=f.read(limit+1)
        return b if len(b)<=limit else None
    except (OSError,ValueError):return None

def read_object(root,rel,limit=MAX_JSON):
    b=read_bytes(root,rel,limit)
    try:r=json.loads(b)if b is not None else None
    except (ValueError,UnicodeError):return None
    return r if type(r)is dict else None

# Exact npm 11 error-code labels only. Recognition is not cause attribution.
NPM_ERROR_CODES={'EUSAGE','ERESOLVE','EINTEGRITY','EFBIG','ENOSPC','EACCES','EPERM','ENOENT','E401','E403','E404','ETIMEDOUT','ECONNRESET','ENOTFOUND','EAI_AGAIN'}

def locked_install_diagnostic(setup,terminal):
    result={'scope':'observed-npm-code-not-root-cause','status':'unavailable','code':None}
    terminal=terminal if type(terminal)is dict else {};exit=terminal.get('exitCode');meta=terminal.get('rawLog')
    if type(exit)is not int or not -255<=exit<=255 or exit==0 or type(meta)is not dict:return result
    if meta.get('path')!='output.raw'or not integer(meta.get('bytes'),32*1024*1024)or not digest(meta.get('sha256')):return result
    raw=read_bytes(setup,'locked-install/output.raw',32*1024*1024)
    if raw is None or len(raw)!=meta['bytes']or sha(raw)!=meta['sha256']:return result
    # A partial scan cannot establish a unique code. Never print the prefix/tail.
    if len(raw)>MAX_LOG:return {**result,'status':'truncated'}
    lines=[line for line in raw.split(b'\n')if line.startswith(b'npm error code ')]
    if len(lines)>1:return {**result,'status':'ambiguous'}
    if len(lines)==1 and raw.endswith(b'\n'):
        for code in NPM_ERROR_CODES:
            if lines[0]==b'npm error code '+code.encode('ascii'):return {**result,'status':'recognized','code':code}
    return {**result,'status':'unknown'}

def safe_process(x):
    x=x if type(x)is dict else {};exit=x.get('exitCode');elapsed=x.get('wallSeconds')
    bfields=['timedOut','groupEmpty','allOwnedReaped','lingeringChildrenAfterLeader']
    result={'exitCode':exit if type(exit)is int and -255<=exit<=255 else None,'wallSeconds':round(elapsed,6)if number(elapsed,3600)else None}
    result.update({k:x.get(k)if type(x.get(k))is bool else None for k in bfields})
    signals=x.get('signals');result['signals']=[s for s in signals if s in ('SIGTERM','SIGKILL')][:8]if type(signals)is list else []
    result['resources']={k:x.get(k)if number(x.get(k),2**40)else None for k in ('sampledAggregatePeakRssKiB','wait4LeaderMaxRssKiB')}
    result['resourceLabels']={'sampledAggregatePeakRssKiB':'sampled-owned-process-tree-not-cgroup-peak','wait4LeaderMaxRssKiB':'wait4-os-accounted-usage-not-aggregate-tree-peak'}
    result['processGroup']=x.get('processGroup')if integer(x.get('processGroup'),2**31)else None
    for field in ('observedPids','reapedPids'):
        value=x.get(field);result[field]=value[:128]if type(value)is list and all(integer(n,2**31)for n in value)else []
    result['complete']=all(result[k]is not None for k in ('exitCode','wallSeconds',*bfields))and all(v is not None for v in result['resources'].values())and type(signals)is list and len(signals)<=8 and all(s in ('SIGTERM','SIGKILL')for s in signals)
    result['complete']=result['complete']and result['processGroup']is not None and result['processGroup']>0 and all(type(x.get(k))is list and len(x[k])<=128 for k in ('observedPids','reapedPids'))and result['processGroup']in result['observedPids']and result['processGroup']in result['reapedPids']
    return result

def process_pass(r):return r['complete']and zero(r['exitCode']) and r['timedOut']is False and r['groupEmpty']is True and r['allOwnedReaped']is True and r['lingeringChildrenAfterLeader']is False

def counts(x,expected=None):
    names=('tests','suites','pass','fail','cancelled','skipped','todo');x=x if type(x)is dict else {}
    r={k:x.get(k)if integer(x.get(k))else None for k in names};r['complete']=all(r[k]is not None for k in names)
    r['successful']=r['complete']and r['tests']>0 and r['pass']==r['tests']and all(r[k]==0 for k in ('fail','cancelled','skipped','todo'))and (expected is None or r['tests']==expected)
    return r

def counts_from_text(text,expected=None):
    data={}
    for key in ('tests','suites','pass','fail','cancelled','skipped','todo'):
        values=re.findall(r'^(?:#|ℹ) '+key+r' (\d{1,7})\s*$',text,re.M)
        if len(values)==1:data[key]=int(values[0])
    return counts(data,expected)

def safe_host(obj):
    obj=obj if type(obj)is dict else {};mem=obj.get('meminfo');m=re.search(r'^MemAvailable:\s+(\d+) kB$',mem,re.M)if type(mem)is str else None
    return {'scope':'host-or-job-cgroup-at-setup-not-stage-hard-envelope','memAvailableBytes':int(m[1])*1024 if m and int(m[1])<2**50 else None,'diskAvailableBytes':obj.get('diskAvailableBytes')if integer(obj.get('diskAvailableBytes'),2**60)else None,'cgroupCurrentBytes':int(obj['memory.current'].strip())if type(obj.get('memory.current'))is str and re.fullmatch(r'\d{1,18}\s*',obj['memory.current'])else None,'cgroupPeakBytes':int(obj['memory.peak'].strip())if type(obj.get('memory.peak'))is str and re.fullmatch(r'\d{1,18}\s*',obj['memory.peak'])else None}

def diagnostics(text,sources,suite):
    result={'typescript':[],'testFailures':[],'unknownDiagnosticCount':0,'truncated':False}
    for line in text.splitlines():
        m=re.match(r'^(.+?)\((\d{1,7}),(\d{1,7})\):\s+error TS(\d{1,7}):',line)
        if m:
            path=m[1];path=path[len('/project/'):]if path.startswith('/project/')else path
            known=path if path in sources else 'frontend/'+path if 'frontend/'+path in sources else None
            nums=[int(m[i])for i in (2,3,4)]
            if known and relative(known)and all(1<=n<=10**7 for n in nums):result['typescript'].append({'path':known,'line':nums[0],'column':nums[1],'code':nums[2]})
            else:result['unknownDiagnosticCount']+=1
        elif re.search(r'\berror TS\d+\b',line):result['unknownDiagnosticCount']+=1
        t=re.match(r'^\s*not ok (\d{1,7})\b',line)
        if t and 1<=int(t[1])<=10**7:result['testFailures'].append({'suite':suite,'ordinal':int(t[1])})
    for key in ('typescript','testFailures'):
        if len(result[key])>MAX_DIAGNOSTICS:result['truncated']=True;result[key]=result[key][:MAX_DIAGNOSTICS]
    result['unknownDiagnosticCount']=min(result['unknownDiagnosticCount'],10**7)
    return result

def installed_packages(project,lock,setup_dep,isolated_dep):
    # Reuse the fresh install's hidden lock and already recorded metadata; no tree
    # census or dependency copy. Scratch receipts alone cannot admit a member.
    if type(setup_dep)is not dict or setup_dep!=isolated_dep:return {}
    raw=read_bytes(project,'node_modules/.package-lock.json');hidden=read_object(project,'node_modules/.package-lock.json')
    if raw is None or not hidden or sha(raw)!=digest(setup_dep.get('installedLockSha256'))or hidden.get('lockfileVersion')!=3:return {}
    ps=hidden.get('packages');expected=(lock or {}).get('packages')
    if type(ps)is not dict or type(expected)is not dict or not integer(setup_dep.get('installedEntries'),10000)or len(ps)!=setup_dep['installedEntries']:return {}
    for path,meta in ps.items():
        if not relative(path)or path not in expected or type(meta)is not dict or type(expected[path])is not dict:return {}
        if any(meta.get(k)!=expected[path].get(k)for k in ('version','resolved','integrity','link')):return {}
    return {p:x for p,x in ps.items()if not x.get('link')and (p.startswith('node_modules/')or p.startswith('frontend/node_modules/'))}

def package_owner(rel,packages):
    if not relative(rel):return None
    candidates=[p for p in packages if rel==p or rel.startswith(p+'/')]
    if not candidates:return None
    owner=max(candidates,key=len)
    # A missing nested package cannot be admitted by its parent's prefix.
    return owner if 'node_modules'not in rel[len(owner):].split('/')else None

def dependency_member(project,rel,packages):
    if project is None or not package_owner(rel,packages):return None
    project=Path(project)
    try:
        if not project.is_absolute()or any(p.is_symlink()for p in [project,*project.parents]):return None
        roots=[project/p for p in ('node_modules','frontend/node_modules')]
        def within(p):return any(p==r or p.is_relative_to(r)for r in roots)
        # Check every symlink hop, not only the final resolved target. Even an
        # outside link which later points back inside is refused.
        def resolve(p,hops=0):
            if hops>40 or not within(p):return None
            relp=p.relative_to(project);current=project
            for part in relp.parts:
                if part=='..':
                    current=current.parent
                    if not current.is_relative_to(project):return None
                    continue
                current=current/part
                if current.is_symlink():
                    if current in roots:return None
                    target=current.parent/os.readlink(current)
                    if not within(target):return None
                    resolved=resolve(target,hops+1)
                    if resolved is None:return None
                    current=resolved
                elif not current.exists():return None
            return current if within(current)else None
        actual=resolve(project/rel)
        if actual is None or actual!=(project/rel).resolve(strict=True)or not within(actual)or not package_owner(actual.relative_to(project).as_posix(),packages)or not stat.S_ISREG(actual.stat().st_mode):return None
        return actual
    except (OSError,ValueError,RuntimeError):return None

def source_member(project,rel,sources):
    expected=sources.get(rel)if type(sources)is dict else None
    if not expected or not integer(expected.get('bytes'),2**40):return False
    data=read_bytes(project,rel,expected['bytes'])if project is not None else None
    return data is not None and len(data)==expected['bytes']and sha(data)==expected.get('sha256')

def file_digest(path,limit=64*1024*1024):
    # Tool entry bytes are hashed, never emitted. A cap is incomplete, not pass.
    try:
        if path is None or path.stat().st_size>limit:return None
        h=hashlib.sha256();total=0
        with path.open('rb')as f:
            while chunk:=f.read(65536):
                total+=len(chunk)
                if total>limit:return None
                h.update(chunk)
        return h.hexdigest()
    except OSError:return None

def safe_program(obj,sources,packages,required_roots=None,project=None):
    obj=obj if type(obj)is dict else {};names=obj.get('files');required=set(sources if required_roots is None else required_roots)
    normalized=[];unknown=0
    if type(names)is not list:names=[];unknown+=1
    capped=len(names)>MAX_PROGRAM
    for name in names[:MAX_PROGRAM]:
        rel=name[9:]if isinstance(name,str)and name.startswith('/project/')else None
        good=relative(rel)and (source_member(project,rel,sources)if rel in sources else dependency_member(project,rel,packages)is not None)
        if good:normalized.append(rel)
        else:unknown+=1
    valid=not unknown and not capped and integer(obj.get('count'),MAX_PROGRAM)and integer(obj.get('directRoots'),MAX_PROGRAM)and len(set(normalized))==len(normalized)and obj.get('count')==len(names)>0 and obj.get('directRoots')==len(required)and required<=set(normalized)
    return {'complete':valid,'count':len(names),'reportedCount':len(normalized),'members':normalized,'membersSha256':sha(canonical(normalized))if valid else None,'requiredDirectRoots':len(required),'unknownMembers':unknown,'truncated':capped}

def semantic(root,stage,result):
    expected={'collector':{'actual-retirement.json','concurrent-completion.json'},'session':{'wire-success.json'}}.get(stage,set())
    listing=(result or {}).get('semanticEvidence');safe=[];ok=type(listing)is list and len(listing)==len(expected)
    seen=set()
    for r in listing if type(listing)is list else []:
        if type(r)is not dict or r.get('path')not in expected or r['path']in seen:ok=False;continue
        seen.add(r['path']);data=read_bytes(root,'stage-'+stage+'/evidence/'+r['path'])
        parsed=read_object(root,'stage-'+stage+'/evidence/'+r['path'])
        # Original wire output may be an array; validate JSON without printing it.
        try:json.loads(data)if data is not None else (_ for _ in ()).throw(ValueError())
        except (ValueError,UnicodeError,TypeError):ok=False;continue
        if not integer(r.get('bytes'),MAX_JSON)or len(data)!=r['bytes']or digest(r.get('sha256'))!=sha(data):ok=False;continue
        safe.append({'stage':stage,'file':r['path'],'bytes':len(data),'sha256':sha(data)})
    if seen!=expected:ok=False
    # Directory membership, not only the result's assertion, determines scope.
    directory=Path(root)/('stage-'+stage)/'evidence'
    try:ok=ok and not directory.is_symlink()and {p.name for p in directory.iterdir()}==expected
    except OSError:ok=False
    return safe,bool(ok)

def safe_bundle(obj):
    obj=obj if type(obj)is dict else {};files=obj.get('files');valid=type(files)is list and 0<len(files)<=50000;clean=[]
    for r in files if type(files)is list else []:
        if type(r)is not dict or not relative(r.get('path'))or not integer(r.get('bytes'),2**40)or not digest(r.get('sha256')):valid=False;continue
        clean.append({k:r[k]for k in ('path','bytes','sha256')})
    clean.sort(key=lambda x:x['path']);valid=valid and len({x['path']for x in clean})==len(clean)and digest(obj.get('membersSha256'))==sha(canonical(clean))
    return {'complete':bool(valid),'files':len(clean),'bytes':sum(x['bytes']for x in clean),'membersSha256':obj.get('membersSha256')if valid else None,'publication':'OPEN_NOT_UPLOADED'}

def bounded_emit(result,limit=MAX_RECEIPT):
    text=json.dumps(result,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
    if len(text.encode())<=limit:return text
    result={**result,'status':'INCOMPLETE','evidenceComplete':False,'reason':'receipt_size_cap','compiler':None,'diagnostics':[],'truncation':{'receiptBytes':True}}
    text=json.dumps(result,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
    if len(text.encode())>limit:
        result={'schema':SCHEMA,'status':'INCOMPLETE','evidenceComplete':False,'reason':'receipt_size_cap','stages':[],'compiler':None,'truncation':{'receiptBytes':True}};text=json.dumps(result,separators=(',',':'))
    return text

def terminal_exit_code(encoded):
    obj=json.loads(encoded);return 0 if obj.get('status')=='PASS'and obj.get('evidenceComplete')is True else 1

def base_receipt(variant,event_sha,control_sha,outcomes):
    return {'schema':SCHEMA,'repository':REPOSITORY,'branch':BRANCH,'variant':variant if variant in BASES else None,'eventSha':digest(event_sha,40),'checkoutSha':None,'controlManifestSha256':digest(control_sha),'publicBase':BASES.get(variant),'inputManifestSha256':None,'lockSha256':None,'inputIdentityScope':'reviewed-manifest-expectations','assembly':None,'assemblyObserved':False,'finalSourceMatched':False,'status':'INCOMPLETE','reason':'mandatory_evidence_missing','evidenceComplete':False,'workflow':{k:v if v in OUTCOMES else 'unknown'for k,v in outcomes.items()if k in ('checkout','base','node','setup','offline')},'stages':[],'compiler':None,'bundle':None,'semanticEvidence':[],'diagnostics':[],'lockedInstallDiagnostic':None,'truncation':{'rawLog':False,'receiptBytes':False},'harbourCompiledAdmission':'OPEN','bundlePublication':'OPEN_NOT_UPLOADED','originalIntegrationExecuted':False,'rootSuiteExecuted':False}

def collect(area,here,variant,event_sha,checkout_sha,control_sha,outcomes):
    result=base_receipt(variant,event_sha,control_sha,outcomes)
    manifest=read_object(here,'inputs.json');v=(manifest or {}).get('variants',{}).get(variant)
    if not v or not digest(event_sha,40)or checkout_sha!=event_sha:return {**result,'reason':'identity_unavailable'}
    result['checkoutSha']=checkout_sha;result['inputManifestSha256']=sha(read_bytes(here,'inputs.json'))
    if v.get('publicBaseCommit')!=BASES[variant]:return {**result,'reason':'identity_unavailable'}
    entries=v['sourceProjection']+v['supplementalInputs'];sources={x['path']for x in v['sourceProjection']};known={x['path']for x in entries}
    expected={'files':len(entries),'bytes':sum(x['bytes']for x in entries),'membersSha256':sha(canonical([rows(entries)[p]for p in sorted(rows(entries))]))}
    result['assembly']=expected
    result['sourceOnly']={'files':v['sourceFileCount'],'bytes':v['sourceBytes'],'membersSha256':sha(canonical([rows(v['sourceProjection'])[p]for p in sorted(rows(v['sourceProjection']))]))}
    result['lockSha256']=next(digest(x.get('sha256'))for x in v['supplementalInputs']if x.get('path')=='package-lock.json')
    work=Path(area)/'work';setup=Path(area)/'setup';complete=True
    admission=read_object(work,'admission.json');complete=complete and admission=={'repository':REPOSITORY,'branch':BRANCH,'sha':event_sha}
    setup_progress=read_object(work,'setup-progress.json')or {};inner_progress=read_object(work,'runner-progress.json')or {}
    allowed=SETUP+['event-admission','tree-admission','public-base-admission','setup-finalization','isolation']+TOOLS+[s['id']for s in command_plan(variant)]
    active=inner_progress.get('phase')if inner_progress.get('phase')in allowed else setup_progress.get('phase')if setup_progress.get('phase')in allowed else None
    done=set(x for x in inner_progress.get('completed',[])if x in allowed)if type(inner_progress.get('completed'))is list else set()
    setup_done=set(x for x in setup_progress.get('completed',[])if x in SETUP)if type(setup_progress.get('completed'))is list else set()
    setup_record=read_object(work,'setup.json');isolation=read_object(work,'isolated-inputs.json');final_source=read_object(work,'final-source.json')
    for stage in SETUP:
        terminal=read_object(setup,stage+'/terminal.json')if stage!='assembly'else None
        passed=stage in setup_done
        process=safe_process(terminal)if terminal is not None else None
        if stage=='assembly':a=read_object(work,'assembly.json');passed=passed and (a or {}).get('assembly')==expected and (a or {}).get('baseCommit')==BASES[variant]
        else:passed=passed and process is not None and process_pass(process)
        if stage=='assembly':result['assemblyObserved']=bool(passed)
        state='passed'if passed else 'failed'if active==stage or terminal is not None else 'not-run'
        result['stages'].append({'id':stage,'status':state,'process':process,'counts':None});complete=complete and passed
        if stage=='locked-install'and state=='failed'and process is not None and type(process['exitCode'])is int and process['exitCode']!=0:
            result['lockedInstallDiagnostic']=locked_install_diagnostic(setup,terminal)
    bootstrap=read_object(work,'sandbox-terminal.json');bootphase=(read_object(work,'bootstrap-progress.json')or {}).get('phase')
    result['bootstrapPhase']=bootphase if bootphase in BOOTSTRAP else None
    code=(bootstrap or {}).get('sandboxExitCode');result['bootstrapExitCode']=code if type(code)is int and -255<=code<=255 else None
    iso_ok=isolation is not None and isolation.get('sha')==event_sha and isolation.get('variant')==variant and isolation.get('assembly')==expected
    iso_contract=(isolation or {}).get('isolation',{})
    iso_ok=iso_ok and isolation.get('inputManifestSha256')==result['inputManifestSha256']and isolation.get('lockSha256')==result['lockSha256']
    iso_ok=iso_ok and all(iso_contract.get(k)is True for k in ('capabilitiesZero','noNewPrivileges','inputMountsReadOnly'))and zero(iso_contract.get('externalRoutes')) and iso_contract.get('interfaces')==['lo DOWN']
    result['stages'].append({'id':'isolation','status':'passed'if iso_ok else 'failed'if bootstrap else 'not-run','process':None,'counts':None});complete=complete and iso_ok
    failed_program=None
    for stage in TOOLS+[s['id']for s in command_plan(variant)]:
        prefix=('version-'+stage if stage in ('node','npm')else stage if stage=='tool-resolution'else 'stage-'+stage)
        terminal=read_object(work,prefix+'/terminal.json');process=safe_process(terminal)if terminal is not None else None
        stage_result=read_object(work,prefix+'/result.json')if stage not in TOOLS else None
        required=next((s.get('cases')for s in command_plan(variant)if s['id']==stage),None)
        test_stage=stage=='forms'or required is not None
        c=counts((stage_result or {}).get('counts'),required)if test_stage else None
        passed=stage in done and process is not None and process_pass(process)and (not test_stage or c['successful'])
        if stage not in TOOLS:passed=passed and (stage_result or {}).get('id')==stage and zero((stage_result or {}).get('exitCode'))
        state='passed'if passed else 'failed'if active==stage or terminal is not None else 'not-run'
        result['stages'].append({'id':stage,'status':state,'process':process,'counts':c});complete=complete and passed
        if required is not None:
            hashes,valid=semantic(work,stage,stage_result);result['semanticEvidence']+=hashes;complete=complete and valid
        if not passed and terminal is not None:
            raw=read_bytes(work,prefix+'/output.raw',32*1024*1024)
            if raw is not None:
                result['truncation']['rawLog']|=len(raw)>MAX_LOG
                text=raw[:MAX_LOG].decode('utf-8',errors='replace')
                if test_stage:result['stages'][-1]['counts']=counts_from_text(text,required)
                if stage=='typecheck':
                    files=[x for x in raw.decode('utf-8',errors='replace').splitlines()if x.startswith('/')]
                    failed_program={'files':files,'count':len(files),'directRoots':len(set(v['directRoots'])&{x[9:]for x in files if x.startswith('/project/')})}
                localized=diagnostics(text,sources,stage)
                result['diagnostics'].append({'stage':stage,**localized})
    project=Path(area)/'project';lock=read_object(project,'package-lock.json');lockbytes=read_bytes(project,'package-lock.json')
    dep=(setup_record or {}).get('installedMetadata',{});packages={}
    if lock and lockbytes and sha(lockbytes)==result['lockSha256']:packages=installed_packages(project,lock,dep,(isolation or {}).get('dependency'))
    if not packages:complete=False
    result['compiler']=safe_program(read_object(work,'stage-typecheck/full-program.json')or failed_program,rows(entries),packages,v['directRoots'],project)
    result['bundle']=safe_bundle(read_object(work,'stage-export/bundle-census.json'))
    result['dependencyIdentity']={'installedLockSha256':digest(dep.get('installedLockSha256'))if type(dep)is dict else None,'installedEntries':dep.get('installedEntries')if type(dep)is dict and integer(dep.get('installedEntries'),10000)else None}
    complete=complete and (setup_record or {}).get('source')==expected and all(result['dependencyIdentity'].values())
    result['hostResources']=safe_host(read_object(work,'host-resources.json'))
    tool=read_object(work,'tool-resolution.json')or {};versions={'typescript':'6.0.3','expo':'57.0.24','react':'19.2.3','react-native':'0.86.3','@expo/metro-config':'57.0.12','@expo/cli':'57.0.26'}
    result['tools']={};tools_ok=True
    for name,version in versions.items():
        package='node_modules/'+('expo/node_modules/'+name if name=='@expo/cli'else name);package_json=package+'/package.json'
        entry=tool.get(name);meta=read_object(project,package_json)if packages else None;raw=read_bytes(project,package_json)if meta else None
        recorded=dep.get('resolvedToolMetadata',{}).get(package.removeprefix('node_modules/'),{})if type(dep)is dict else {}
        valid=type(entry)is dict and entry.get('version')==version and entry.get('packageJson')=='/project/'+package_json
        valid=valid and package in packages and packages[package].get('version')==version and meta is not None and meta.get('name')==name and meta.get('version')==version
        valid=valid and recorded=={'path':'/project/'+package_json,'version':version,'packageJsonSha256':sha(raw)if raw is not None else None}
        safe={'version':version if valid else None,'packageJson':package_json if valid else None,'packageJsonSha256':sha(raw)if valid else None,'entry':None,'entrySha256':None}
        path=entry.get('entry')if type(entry)is dict else None;rel=path[9:]if type(path)is str and path.startswith('/project/')else None
        member=dependency_member(project,rel,packages)if valid and package_owner(rel,packages)==package else None
        entry_hash=file_digest(member)if member is not None and package_owner(member.relative_to(project).as_posix(),packages)==package else None
        if entry_hash:safe['entry']=rel;safe['entrySha256']=entry_hash
        result['tools'][name]=safe;tools_ok=tools_ok and bool(valid and entry_hash)
    result['tools']['node']={'version':'v24.22.1'if (setup_record or {}).get('nodeVersion')=='v24.22.1'else None,'binarySha256':digest((setup_record or {}).get('nodeBinarySha256'))}
    result['tools']['npm']={'version':'11.8.0'if (setup_record or {}).get('npmVersion')=='11.8.0'else None,'packageJsonSha256':digest((setup_record or {}).get('npmPackageJsonSha256'))}
    tools_ok=tools_ok and all(result['tools'][n]['version']and list(result['tools'][n].values())[1]for n in ('node','npm'))
    complete=complete and tools_ok
    summary=read_object(work,'sanitized-summary.json');stages=[s['id']for s in command_plan(variant)]
    summary_ok=summary is not None and summary.get('sha')==event_sha and summary.get('variant')==variant and [x.get('id')for x in summary.get('stages',[])if type(x)is dict]==stages
    complete=complete and result['compiler']['complete']and result['bundle']['complete']and final_source==expected and summary_ok and setup_record is not None and all(outcomes.get(k)=='success'for k in ('checkout','base','node','setup','offline'))and zero(result['bootstrapExitCode'])
    result['finalSourceMatched']=final_source==expected
    result['evidenceComplete']=bool(complete);result['status']='PASS'if complete else 'FAIL'if any(x['status']=='failed'for x in result['stages'])or 'failure'in outcomes.values()else 'INCOMPLETE'
    if complete:result['reason']='complete'
    elif outcomes.get('checkout')!='success':result['reason']='checkout_unavailable'
    elif outcomes.get('base')!='success':result['reason']='public_base_unavailable'
    elif outcomes.get('node')!='success':result['reason']='toolchain_bootstrap_unavailable'
    elif outcomes.get('setup')!='success':result['reason']='setup_failed'
    elif not iso_ok:result['reason']='isolation_failed'
    elif active:result['reason']='stage_failed_or_evidence_incomplete'
    result['activeStage']=active
    return result
