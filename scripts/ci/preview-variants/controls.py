"""Fail-closed controls shared by the candidate assembler and runner.
No import-time actions. No input JavaScript execution. Publication is not enabled.
"""
from pathlib import Path, PurePosixPath
import base64, hashlib, json, os, re, stat
from urllib.parse import urlsplit
REPOSITORY='2NTTY/child-ai-caregiver'
BRANCH='codex/preview-hf-offline-ci-20261106'
BASES={'fourth':'76493c5e0747cb5da908fdb708879fd96509d093','harbour':'4050c0a16d0a9735923434abc9749ecd416d7926'}
GENERATED={'node_modules','frontend/node_modules','frontend/dist','frontend/.expo'}
FORMS='node --test scripts/date-time.test.mts scripts/profile-form.test.mts scripts/family-preview.test.mjs scripts/memory-preview.test.mjs scripts/task-forms.test.mjs'
INCLUDES=['app/**/*.ts','app/**/*.tsx','src/**/*.ts','src/**/*.tsx']
RUNTIME='frontend/src/preview/synthetic-preview-runtime.mjs'
BOOTSTRAP='frontend/src/preview/workbench-normal-read/src/synthetic-preview-read-bootstrap.mjs'
class Refused(Exception): pass
def need(ok,msg):
    if not ok: raise Refused(msg)
def sha(data): return hashlib.sha256(data).hexdigest()
def canonical(obj): return json.dumps(obj,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def row(path,data):return {'path':path,'bytes':len(data),'sha256':sha(data)}
def write_json(path,obj):
    with Path(path).open('x') as f:json.dump(obj,f,indent=2,ensure_ascii=False);f.write('\n')
def write_progress(root,name,phase,completed):
    # Private fixed-state receipt, replaced atomically between child commands.
    root=absolute(root);path_name(name);need('/'not in name,'progress path scope')
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w',dir=root,prefix='.progress-',delete=False)as f:
        json.dump({'phase':phase,'completed':list(completed)},f);tmp=f.name
    os.replace(tmp,root/name)

def path_name(name):
    need(isinstance(name,str) and name and not name.startswith('/') and '\\'not in name and ':'not in name,'unsafe relative path')
    need(all(ord(c)>=32 and ord(c)!=127 for c in name),'control path')
    parts=name.split('/')
    need(all(x not in ('','.','..','.git','.npmrc') and not x.startswith('.env') for x in parts),'forbidden path component')
    need(str(PurePosixPath(name))==name,'noncanonical path')
    return name
def absolute(path):
    p=Path(path);need(p.is_absolute() and '..'not in p.parts,'absolute path required')
    for x in [p,*p.parents]:need(not x.is_symlink(),'symlink ancestor')
    need(str(p)==str(p.resolve()),'noncanonical absolute path')
    return p
def regular(root,name):
    root=absolute(root);path_name(name);p=root/name
    for x in [p,*list(p.parents)[:len(p.relative_to(root).parts)-1]]:need(not x.is_symlink(),'symlink member')
    need(p.is_file() and stat.S_ISREG(p.lstat().st_mode),'missing/nonregular member: '+name)
    return p
def new_dir(root,name):
    root=absolute(root);path_name(name);need('/'not in name,'stage directory must be immediate child')
    need(root.is_dir() and root.stat().st_uid==os.getuid(),'unowned/missing evidence parent')
    p=root/name;need(not p.exists() and not p.is_symlink(),'evidence destination exists')
    p.mkdir(mode=0o700)
    # Creating this probe proves writable, and leaves the stage empty before invocation.
    probe=p/'write-probe';probe.write_bytes(b'');probe.unlink()
    need(not list(p.iterdir()),'nonempty evidence destination')
    return p
def rows(items):
    out={}
    for r in items:
        path_name(r['path']);need(r['path']not in out,'duplicate member')
        need(type(r['bytes'])is int and r['bytes']>=0 and re.fullmatch('[a-f0-9]{64}',r['sha256'])is not None,'invalid digest/size')
        out[r['path']]={k:r[k]for k in ('path','bytes','sha256')}
    for p in out:need(not any('/'.join(p.split('/')[:i])in out for i in range(1,len(p.split('/')))),'file/directory overlap')
    return out
def census(root,installed=False):
    root=absolute(root);out={}
    def walk(d):
        for p in sorted(d.iterdir()):
            rel=p.relative_to(root).as_posix();path_name(rel)
            need(not p.is_symlink(),'source/output symlink: '+rel)
            if installed and rel in GENERATED:
                need(p.is_dir(),'generated path is not directory');continue
            if p.is_dir():walk(p)
            else:out[rel]=row(rel,regular(root,rel).read_bytes())
    walk(root);return out
def match(root,entries,installed=False):
    expected=rows(entries);actual=census(root,installed)
    parents={'/'.join(p.split('/')[:i])for p in expected for i in range(1,len(p.split('/')))}
    def directories(d):
        for p in d.iterdir():
            rel=p.relative_to(root).as_posix()
            if p.is_dir():
                if installed and rel in GENERATED:continue
                need(rel in parents,'unknown source directory: '+rel);directories(p)
    directories(root)
    need(set(actual)==set(expected),'source census membership mismatch')
    need(actual==expected,'source byte drift')
    return {'files':len(actual),'bytes':sum(x['bytes']for x in actual.values()),'membersSha256':sha(canonical([actual[x]for x in sorted(actual)]))}
def admit_event(event,expected,actual,event_name):
    need(event_name=='pull_request','only pull_request entry admitted')
    need(re.fullmatch('[a-f0-9]{40}',expected or '')is not None and expected==actual,'missing/wrong exact event HEAD')
    pr=event.get('pull_request',{});head=pr.get('head',{})
    need(event.get('repository',{}).get('full_name')==REPOSITORY,'wrong repository')
    need(pr.get('base',{}).get('repo',{}).get('full_name')==REPOSITORY,'wrong base repository')
    need(head.get('repo',{}).get('full_name')==REPOSITORY and head.get('ref')==BRANCH and head.get('sha')==expected,'wrong PR head repository/branch/SHA')
    need(event.get('action')in ('opened','synchronize','reopened'),'unsupported PR action')
    return {'repository':REPOSITORY,'branch':BRANCH,'sha':expected}
def validate_lock(lock,root,front):
    need(lock.get('lockfileVersion')==3 and isinstance(lock.get('packages'),dict),'lock v3 required')
    need(root.get('workspaces')==['frontend'],'workspace scope changed')
    ps=lock['packages'];need(''in ps and 'frontend'in ps,'missing package entries')
    for name,pkg in [('',root),('frontend',front)]:
        for k in ('name','version','engines','workspaces','dependencies','devDependencies','optionalDependencies'):
            need(pkg.get(k)==ps[name].get(k),'lock/package mismatch: '+name+':'+k)
        need(not ps[name].get('link') and 'resolved'not in ps[name],'invalid root/workspace lock')
        need(not any(k in pkg.get('scripts',{})for k in ('preinstall','install','postinstall','prepare')),'root/workspace lifecycle scripts')
    links=[];registry=0;scripts=[]
    for name,x in ps.items():
        if name in ('','frontend'):continue
        path_name(name);need(name.startswith('node_modules/')or name.startswith('frontend/node_modules/'),'unknown locked scope')
        if x.get('link'):
            need(name=='node_modules/'+front['name']and x.get('resolved')=='frontend','unknown workspace link');links.append(name);continue
        u=urlsplit(x.get('resolved',''))
        need(u.scheme=='https' and u.netloc=='registry.npmjs.org' and not u.query and not u.fragment and u.path.endswith('.tgz'),'nonofficial registry source')
        integrity=x.get('integrity','');need(integrity.startswith('sha512-'),'missing sha512 integrity')
        try:b=base64.b64decode(integrity[7:],validate=True)
        except Exception:raise Refused('malformed integrity')
        need(len(b)==64,'bad sha512 length');registry+=1
        if x.get('hasInstallScript'):scripts.append(name)
    need(links==['node_modules/'+front['name']],'workspace link count')
    return {'registryPackages':registry,'workspaceLinks':links,'installScriptsKeptDisabled':scripts}
def check_scope(project):
    root=json.loads(regular(project,'package.json').read_text());front=json.loads(regular(project,'frontend/package.json').read_text())
    cfg=json.loads(regular(project,'frontend/tsconfig.json').read_text())
    need(front['scripts'].get('typecheck')=='tsc --noEmit','typecheck narrowed/changed')
    need(front['scripts'].get('test:forms')==FORMS,'forms scope changed')
    need(front['scripts'].get('build:web')=='expo export --platform web','export scope changed')
    need(cfg.get('include')==INCLUDES and 'exclude'not in cfg and cfg.get('extends')=='expo/tsconfig.base','tsconfig scope changed')
    return validate_lock(json.loads(regular(project,'package-lock.json').read_text()),root,front)
def program_list(text,direct_roots):
    files=[x for x in text.splitlines()if x.startswith('/')]
    need(files and len(files)==len(set(files)),'missing/duplicate compiler program list')
    need(all('/project/'+p in files for p in direct_roots),'compiler omitted full original direct roots')
    return {'files':files,'count':len(files),'directRoots':len(direct_roots)}
def tap_counts(text,expected=None):
    result={}
    for k in ('tests','suites','pass','fail','cancelled','skipped','todo'):
        hits=re.findall(r'^(?:#|ℹ) '+k+r' (\d+)\s*$',text,re.M);need(len(hits)==1,'missing/duplicate TAP '+k);result[k]=int(hits[0])
    need(result['tests']>0 and result['pass']==result['tests'],'empty/incomplete suite')
    need(not any(result[k]for k in ('fail','cancelled','skipped','todo')),'failed/skipped cases')
    if expected is not None:need(result['tests']==expected,'case count mismatch')
    need(not re.search(r'^not ok\b',text,re.M),'TAP failure')
    return result
BASE_ENV={'PATH':'/toolchain/bin:/usr/bin:/bin:/usr/sbin:/sbin','CI':'true','TZ':'UTC','LC_ALL':'C.UTF-8','EXPO_OFFLINE':'1','EXPO_NO_TELEMETRY':'1','EXPO_NO_DOTENV':'1','npm_config_update_notifier':'false','npm_config_audit':'false','npm_config_fund':'false','npm_config_userconfig':'/dev/null','npm_config_globalconfig':'/etc/empty-global.npmrc'}
def validate_stage_env(env,portable=False):
    expected=set(BASE_ENV)|{'HOME','TMPDIR','NODE_OPTIONS'}
    if portable:expected|={'PROJECT_UNDER_TEST','RUNTIME_UNDER_TEST','BOOTSTRAP_UNDER_TEST','RED_BASE','INTEGRATION_EVIDENCE'}
    need(set(env)==expected,'missing/unknown stage environment key')
    need(all(env[k]==v for k,v in BASE_ENV.items()),'stage environment policy drift')
    for k in ('HOME','TMPDIR'):
        need(env[k].startswith('/work/')and '..'not in Path(env[k]).parts,'wrong scratch directory')
    need(env['NODE_OPTIONS']==('--max-old-space-size=256'if portable else '--max-old-space-size=1536'),'wrong heap envelope')
    if portable:
        need(env['PROJECT_UNDER_TEST']=='/project'and env['RUNTIME_UNDER_TEST']=='/project/'+RUNTIME and env['BOOTSTRAP_UNDER_TEST']=='/project/'+BOOTSTRAP and env['RED_BASE']=='0','wrong runtime target')
        need(env['INTEGRATION_EVIDENCE'].startswith('/work/')and '..'not in Path(env['INTEGRATION_EVIDENCE']).parts,'invalid evidence environment')
    return env
def command_plan(variant):
    need(variant in BASES,'unknown variant')
    npm=['/toolchain/bin/node','/npm/lib/node_modules/npm/bin/npm-cli.js']
    plan=[{'id':'typecheck','argv':npm+['run','typecheck','--workspace','frontend','--','--listFiles','--extendedDiagnostics'],'timeout':300},
          {'id':'forms','argv':npm+['run','test:forms','--workspace','frontend'],'timeout':180},
          {'id':'export','argv':npm+['run','build:web','--workspace','frontend','--','--max-workers','1'],'timeout':600}]
    stages={'fourth':[('port',2),('runtime',21),('bootstrap',5),('closed',2),('observation',2),('gc',1)],'harbour':[('facade',16),('collector',20),('session',19),('regression',21)]}
    for name,cases in stages[variant]:
        plan.append({'id':name,'argv':['/toolchain/bin/node','--max-old-space-size=256','--test','--test-concurrency=1','--test-reporter=tap','/candidate/runtime/'+variant+'/'+name+'.test.mjs'],'timeout':20,'cases':cases})
    return plan
