"""Dedicated Linux PID/network/mount namespace runner. Never run on a shared host.
Local controls may call pure helpers/supervisor with synthetic Python commands only.
The main entry point refuses to run outside the prepared isolated PID-1 environment.
"""
from pathlib import Path
import ctypes,json,os,re,resource,signal,subprocess,time
from controls import *
from assemble import load_manifest,verify_payload

def process_table():
    out={}
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            text=(p/'stat').read_text();parts=text[text.rfind(')')+2:].split();pid=int(p.name)
            out[pid]={'ppid':int(parts[1]),'pgrp':int(parts[2]),'state':parts[0],'rssKiB':int(parts[21])*os.sysconf('SC_PAGE_SIZE')//1024}
        except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError):pass
    return out

def descendants(table,parent):
    result=set();changed=True
    while changed:
        old=len(result);result|={p for p,v in table.items()if v['ppid']==parent or v['ppid']in result};changed=len(result)!=old
    return result

def supervise(argv,cwd,env,directory,wall):
    """Own one process group, reap adopted descendants, and retain raw logs privately."""
    directory=absolute(directory);need(not (directory/'output.raw').exists(),'refuse log overwrite')
    need(not descendants(process_table(),os.getpid()),'preexisting owned child process')
    # Per-process child adoption, not a host setting; all descendants belong to this stage.
    libc=ctypes.CDLL(None,use_errno=True);need(libc.prctl(36,1,0,0,0)==0,'cannot set subreaper')
    fd=os.open(directory/'output.raw',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);start=time.monotonic();pid=os.fork()
    if pid==0:
        try:
            os.setsid();os.chdir(cwd);os.dup2(fd,1);os.dup2(fd,2);os.close(fd)
            resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(32*1024**2,32*1024**2))
            os.closerange(3,4096);os.execve(argv[0],argv,env)
        except BaseException:os._exit(127)
    os.close(fd);timed=False;signals=[];leader=None;rusage=None;peak=0;observed={pid};stray=False;reaped=[]
    def kill_owned(sig):
        table=process_table();owned=descendants(table,os.getpid());observed.update(owned)
        try:os.killpg(pid,sig)
        except ProcessLookupError:pass
        for child in owned:
            try:os.kill(child,sig)
            except ProcessLookupError:pass
        signals.append(signal.Signals(sig).name)
    while leader is None:
        table=process_table();owned=descendants(table,os.getpid());observed.update(owned);peak=max(peak,sum(table[x]['rssKiB']for x in owned if x in table))
        got,status,usage=os.wait4(pid,os.WNOHANG)
        if got:leader=os.waitstatus_to_exitcode(status);rusage=usage;reaped.append(got);break
        if time.monotonic()-start>wall and not timed:timed=True;kill_owned(signal.SIGTERM);deadline=time.monotonic()+2
        if timed and time.monotonic()>deadline:kill_owned(signal.SIGKILL);deadline=time.monotonic()+2
        time.sleep(0.02)
    remaining=descendants(process_table(),os.getpid())
    if remaining:stray=True;kill_owned(signal.SIGTERM);time.sleep(0.05);kill_owned(signal.SIGKILL)
    end=time.monotonic()+3
    while time.monotonic()<end:
        try:
            got,status,usage=os.wait4(-1,os.WNOHANG)
            if got:reaped.append(got);continue
        except ChildProcessError:break
        time.sleep(0.02)
    table=process_table();remaining=descendants(table,os.getpid());groups=[p for p,x in table.items()if x['pgrp']==pid]
    result={'argv':argv,'cwd':str(cwd),'environment':env,'exitCode':leader,'wallSeconds':time.monotonic()-start,'timedOut':timed,'signals':signals,'processGroup':pid,'observedPids':sorted(observed),'reapedPids':reaped,'lingeringChildrenAfterLeader':stray,'groupEmpty':not groups,'allOwnedReaped':not remaining,'remainingPids':sorted(remaining),'sampledAggregatePeakRssKiB':peak,'rssSamplingIntervalSeconds':0.02,'wait4LeaderMaxRssKiB':rusage.ru_maxrss if rusage else None,'userSeconds':rusage.ru_utime if rusage else None,'systemSeconds':rusage.ru_stime if rusage else None,'rawLog':row('output.raw',(directory/'output.raw').read_bytes())}
    write_json(directory/'terminal.json',result);return result

def isolation_contract(env):
    keys={'PATH','HOME','TMPDIR','CI','TZ','LC_ALL','EXPECTED_SHA','PARENT_NETNS','VARIANT'}
    need(set(env)==keys,'missing/unknown runner environment')
    need(re.fullmatch('[0-9a-f]{40}',env['EXPECTED_SHA'])is not None and env['VARIANT']in BASES,'missing identity')
    need(os.getuid()!=0 and os.getpid()==1,'runner requires unprivileged PID-1 in dedicated namespace')
    need(os.readlink('/proc/self/ns/net')!=env['PARENT_NETNS'],'inherited network namespace')
    status=Path('/proc/self/status').read_text();need(re.search(r'^NoNewPrivs:\s+1$',status,re.M)is not None,'privilege escalation not disabled')
    caps=re.findall(r'^Cap(?:Inh|Prm|Eff|Bnd|Amb):\s+([0-9a-f]+)$',status,re.M);need(len(caps)==5 and all(int(x,16)==0 for x in caps),'capabilities remain')
    def ip(*args):return subprocess.check_output(['/usr/sbin/ip',*args],env={'PATH':'/usr/sbin:/usr/bin:/bin'},text=True)
    links=ip('-o','link','show').strip().splitlines();need(len(links)==1 and re.search(r'^[0-9]+: lo:.*state DOWN',links[0]),'network interfaces/loopback not isolated')
    need(not ip('-4','route','show','table','all').strip()and not ip('-6','route','show','table','all').strip(),'network routes remain')
    allowed={'usr','bin','sbin','lib','lib64','proc','dev','tmp','work','project','candidate','toolchain','npm','etc'}
    need(set(os.listdir('/'))<=allowed,'unexpected root mount/credential path')
    for p in ('/project','/candidate','/toolchain','/npm'):need(os.statvfs(p).f_flag&os.ST_RDONLY,'input mount writable')
    need(not Path('/home').exists()and not Path('/run').exists()and not Path('/sys').exists(),'host directories exposed')
    return {'networkNamespace':os.readlink('/proc/self/ns/net'),'pidNamespace':os.readlink('/proc/self/ns/pid'),'mountNamespace':os.readlink('/proc/self/ns/mnt'),'uid':os.getuid(),'capabilitiesZero':True,'noNewPrivileges':True,'interfaces':['lo DOWN'],'externalRoutes':0,'inputMountsReadOnly':True}

def check_semantic_evidence(variant,stage,directory):
    expected={'collector':{'actual-retirement.json','concurrent-completion.json'},'session':{'wire-success.json'}}.get(stage,set())if variant=='harbour'else set()
    got=census(directory);need(set(got)==expected,'missing/unexpected semantic evidence')
    for name in expected:json.loads(regular(directory,name).read_text())
    return list(got.values())

def bundle_census(directory):
    result=census(directory);need(result and 'index.html'in result,'missing exported web output')
    return {'files':list(result.values()),'membersSha256':sha(canonical([result[p]for p in sorted(result)])),'sourceMaps':[p for p in result if p.endswith('.map')],'publicAdmission':'DISABLED_PENDING_WHITELIST_NOTICES_RIGHTS_MAP_SANITIZATION'}

def installed_metadata(project):
    lock=json.loads(regular(project,'package-lock.json').read_text())['packages'];hidden=json.loads(regular(project,'node_modules/.package-lock.json').read_text())
    need(hidden.get('lockfileVersion')==3,'installed lock version')
    for name,x in hidden['packages'].items():
        need(name in lock,'unknown installed package')
        for k in ('version','resolved','integrity','link'):need(x.get(k)==lock[name].get(k),'installed lock drift: '+name)
    versions={}
    pinned={'typescript':'6.0.3','expo':'57.0.24','react':'19.2.3','react-native':'0.86.3','@expo/metro-config':'57.0.12','expo/node_modules/@expo/cli':'57.0.26'}
    for name,version in pinned.items():
        p='node_modules/'+name+'/package.json';meta=json.loads(regular(project,p).read_text());need(meta['version']==version,'toolchain metadata mismatch: '+name);versions[name]={'path':'/project/'+p,'version':version,'packageJsonSha256':sha(regular(project,p).read_bytes())}
    # Installed symlinks are legitimate only within dependency trees or the sole workspace link.
    links=[];workspace='node_modules/'+json.loads(regular(project,'frontend/package.json').read_text())['name']
    for top in ('node_modules','frontend/node_modules'):
        root=project/top
        if not root.exists():continue
        need(not root.is_symlink(),'dependency root link')
        for parent,dirs,files in os.walk(root,followlinks=False):
            for name in dirs+files:
                p=Path(parent)/name
                if not p.is_symlink():continue
                rel=p.relative_to(project).as_posix();target=p.resolve(strict=True)
                if rel==workspace:need(target==project/'frontend','workspace target drift')
                else:need(any(target.is_relative_to(project/t)for t in ('node_modules','frontend/node_modules')),'dependency link escape')
                links.append({'path':rel,'target':os.readlink(p)})
    return {'resolvedToolMetadata':versions,'installedEntries':len(hidden['packages']),'dependencyLinks':links,'installedLockSha256':sha(regular(project,'node_modules/.package-lock.json').read_bytes())}

def main():
    env=dict(os.environ);isolation=isolation_contract(env);variant=env['VARIANT'];project=Path('/project');work=Path('/work');candidate=Path('/candidate')
    verify_payload(candidate);manifest=load_manifest(candidate/'inputs.json');v=manifest['variants'][variant];entries=v['sourceProjection']+v['supplementalInputs']
    admission=json.loads(regular(work,'admission.json').read_text());need(admission['sha']==env['EXPECTED_SHA']and admission['repository']==REPOSITORY and admission['branch']==BRANCH,'admission receipt mismatch')
    source=match(project,entries,installed=True);check_scope(project);dependency=installed_metadata(project)
    write_json(work/'isolated-inputs.json',{'sha':env['EXPECTED_SHA'],'variant':variant,'assembly':source,'inputManifestSha256':sha((candidate/'inputs.json').read_bytes()),'lockSha256':sha((project/'package-lock.json').read_bytes()),'dependency':dependency,'isolation':isolation,'kernel':os.uname().release})
    complete=[];completed=[]
    def phase(name):write_progress(work,'runner-progress.json',name,completed)
    def done(name):completed.append(name);phase(name)
    phase('isolation');done('isolation')
    for tool,argv,expected in [('node',['/toolchain/bin/node','--version'],'v24.22.1'),('npm',['/toolchain/bin/node','/npm/lib/node_modules/npm/bin/npm-cli.js','--version'],'11.8.0')]:
        phase(tool);d=new_dir(work,'version-'+tool);home=new_dir(d,'home');tmp=new_dir(d,'tmp');e={**BASE_ENV,'HOME':str(home),'TMPDIR':str(tmp),'NODE_OPTIONS':'--max-old-space-size=1536'};validate_stage_env(e)
        r=supervise(argv,project,e,d,20);need(r['exitCode']==0 and (d/'output.raw').read_text().strip()==expected,'tool version mismatch');done(tool)
    phase('tool-resolution');d=new_dir(work,'tool-resolution');home=new_dir(d,'home');tmp=new_dir(d,'tmp');e={**BASE_ENV,'HOME':str(home),'TMPDIR':str(tmp),'NODE_OPTIONS':'--max-old-space-size=1536'};validate_stage_env(e)
    r=supervise(['/toolchain/bin/node','/candidate/resolve-tools.cjs'],project,e,d,20);need(r['exitCode']==0 and r['groupEmpty'] and r['allOwnedReaped'],'tool resolution failed')
    resolved=json.loads((d/'output.raw').read_text());pins={'typescript':'6.0.3','expo':'57.0.24','react':'19.2.3','react-native':'0.86.3','@expo/metro-config':'57.0.12','@expo/cli':'57.0.26'}
    need(set(resolved)==set(pins),'resolved tool scope')
    for name,version in pins.items():
        need(resolved[name]['version']==version,'resolved tool version drift')
        for field in ('packageJson','entry'):need(resolved[name][field].startswith(('/project/node_modules/','/project/frontend/node_modules/')),'tool resolution escape')
    write_json(work/'tool-resolution.json',resolved);done('tool-resolution')
    for stage in command_plan(variant):
        phase(stage['id']);match(project,entries,installed=True);d=new_dir(work,'stage-'+stage['id']);home=new_dir(d,'home');tmp=new_dir(d,'tmp');evidence=new_dir(d,'evidence');portable='cases'in stage
        e={**BASE_ENV,'HOME':str(home),'TMPDIR':str(tmp),'NODE_OPTIONS':'--max-old-space-size='+('256'if portable else '1536')}
        if portable:e.update(PROJECT_UNDER_TEST='/project',RUNTIME_UNDER_TEST='/project/'+RUNTIME,BOOTSTRAP_UNDER_TEST='/project/'+BOOTSTRAP,RED_BASE='0',INTEGRATION_EVIDENCE=str(evidence))
        validate_stage_env(e,portable);r=supervise(stage['argv'],project,e,d,stage['timeout'])
        need(r['exitCode']==0 and not r['timedOut']and r['groupEmpty']and r['allOwnedReaped']and not r['lingeringChildrenAfterLeader'],'stage process failure: '+stage['id'])
        text=(d/'output.raw').read_text(errors='strict');result={'id':stage['id'],'exitCode':0,'wallSeconds':r['wallSeconds']}
        if stage['id']=='typecheck':write_json(d/'full-program.json',program_list(text,v['directRoots']))
        if stage['id']=='forms'or portable:result['counts']=tap_counts(text,stage.get('cases'))
        if portable:result['semanticEvidence']=check_semantic_evidence(variant,stage['id'],evidence)
        if stage['id']=='export':write_json(d/'bundle-census.json',bundle_census(project/'frontend/dist'))
        match(project,entries,installed=True);write_json(d/'result.json',result);complete.append(result);done(stage['id'])
    need(sum(x.get('counts',{}).get('tests',0)for x in complete[3:])==v['portableCases'],'portable total mismatch')
    write_json(work/'final-source.json',match(project,entries,installed=True))
    write_json(work/'sanitized-summary.json',{'schema':'offline-frontend-result-v1','sha':env['EXPECTED_SHA'],'variant':variant,'stages':[{'id':s['id'],'exitCode':s['exitCode'],'counts':s.get('counts')}for s in complete],'originalIntegrationExecuted':False,'rootSuiteExecuted':False,'harbourCompiledAdmission':'OPEN','artifactUpload':'DISABLED','publicPreviewAvailable':False})
    print('PASS offline frontend candidate='+env['EXPECTED_SHA']+' variant='+variant+' portableCases='+str(v['portableCases'])+' artifactUpload=DISABLED compiledAdmission=OPEN')
if __name__=='__main__':
    try:main()
    except BaseException as e:
        if os.getpid()==1 and os.getuid()!=0 and Path('/work').is_dir() and Path('/work').stat().st_uid==os.getuid():
            try:write_json(Path('/work/failure.json'),{'exceptionType':type(e).__name__,'message':str(e)})
            except Exception:pass
        # No raw output, ambient env, private paths, or test error body enters public workflow logs.
        print('FAIL offline verification; private receipt retained; exception='+type(e).__name__)
        raise SystemExit(1)
