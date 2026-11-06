"""NETWORK SETUP PHASE ONLY. For an authorized fresh ephemeral GitHub runner.
No source lifecycle script runs. Output/log sharing is disabled.
"""
from pathlib import Path
import argparse,json,os,subprocess
from controls import *
from assemble import load_manifest,verify_payload,assemble
from runner import supervise,installed_metadata
HERE=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser();p.add_argument('variant',choices=BASES);p.add_argument('--base',type=Path,required=True);p.add_argument('--area',type=Path,required=True);p.add_argument('--candidate-checkout',type=Path,required=True);p.add_argument('--node',type=Path,required=True);a=p.parse_args()
    need(os.getuid()!=0,'do not install as root');verify_payload(expected_digest=os.environ.get('EXPECTED_CONTROL_MANIFEST_SHA256',''));m=load_manifest();checkout=absolute(a.candidate_checkout)
    area=absolute(a.area);need(not area.exists(),'runner area already exists');area.mkdir(mode=0o700)
    work=new_dir(area,'work')
    completed=[]
    def phase(name):write_progress(work,'setup-progress.json',name,completed)
    def done(name):completed.append(name);phase(name)
    phase('event-admission')
    actual=subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'],text=True).strip()
    admission=admit_event(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()),os.environ.get('EXPECTED_SHA'),actual,os.environ.get('GITHUB_EVENT_NAME'))
    write_json(work/'admission.json',admission);phase('tree-admission')
    need(not subprocess.check_output(['git','-C',str(checkout),'status','--porcelain','--untracked-files=all'],text=True).strip(),'candidate checkout drift/unknown paths')
    phase('public-base-admission');base=absolute(a.base);need(subprocess.check_output(['git','-C',str(base),'rev-parse','HEAD'],text=True).strip()==BASES[a.variant],'wrong public base HEAD')
    phase('assembly')
    write_json(work/'assembly.json',assemble(m['variants'][a.variant],base,area/'project'));done('assembly')
    project=area/'project';node=absolute(a.node);need(node.is_file(),'missing official setup node');toolchain=node.parent.parent
    bootstrap=regular(toolchain,'lib/node_modules/npm/bin/npm-cli.js')
    scratch=new_dir(area,'setup');home=new_dir(scratch,'home');tmp=new_dir(scratch,'tmp');cache=new_dir(scratch,'cache');empty=scratch/'empty-global.npmrc';empty.write_bytes(b'')
    env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(home),'TMPDIR':str(tmp),'CI':'true','TZ':'UTC','LC_ALL':'C.UTF-8','npm_config_update_notifier':'false','npm_config_audit':'false','npm_config_fund':'false','npm_config_cache':str(cache)}
    def run(name,argv,limit=600):
        phase(name);d=new_dir(scratch,name);r=supervise(argv,project,env,d,limit)
        need(r['exitCode']==0 and not r['timedOut']and r['groupEmpty']and r['allOwnedReaped']and not r['lingeringChildrenAfterLeader'],'setup stage failed: '+name)
        return (d/'output.raw').read_text()
    need(run('node-version',[str(node),'--version'],20).strip()=='v24.22.1','Node pin mismatch');done('node-version')
    flags=['--ignore-scripts','--no-audit','--no-fund','--userconfig','/dev/null','--globalconfig',str(empty),'--registry','https://registry.npmjs.org']
    # Same official registry, exact npm release, lifecycle disabled; no npx fallback.
    run('npm-bootstrap',[str(node),str(bootstrap),'install','--global','--prefix',str(area/'npm'),*flags,'npm@11.8.0']);done('npm-bootstrap')
    npm=regular(area/'npm','lib/node_modules/npm/bin/npm-cli.js')
    need(run('npm-version',[str(node),str(npm),'--version'],20).strip()=='11.8.0','npm pin mismatch');done('npm-version')
    policy=check_scope(project);run('locked-install',[str(node),str(npm),'ci',*flags])
    v=m['variants'][a.variant];match(project,v['sourceProjection']+v['supplementalInputs'],installed=True)
    metadata=installed_metadata(project);done('locked-install');phase('setup-finalization')
    # Empty declared output dirs are created once; only these writable overlays enter chroot.
    for rel in ('frontend/dist','frontend/.expo'):
        target=project/rel;need(not target.exists()and not target.is_symlink(),'output already exists');target.mkdir()
    for name in ('dist','expo','home','tmp'):new_dir(work,name)
    write_json(work/'setup.json',{'nodeVersion':'v24.22.1','npmVersion':'11.8.0','nodeBinarySha256':sha(node.read_bytes()),'npmPackageJsonSha256':sha(regular(area/'npm','lib/node_modules/npm/package.json').read_bytes()),'lockPolicy':policy,'installedMetadata':metadata,'source':match(project,v['sourceProjection']+v['supplementalInputs'],installed=True)})
    host={'kernel':os.uname().release,'machine':os.uname().machine,'imageOS':os.environ.get('ImageOS'),'imageVersion':os.environ.get('ImageVersion'),'runnerOS':os.environ.get('RUNNER_OS'),'runnerArch':os.environ.get('RUNNER_ARCH'),'meminfo':Path('/proc/meminfo').read_text(),'diskAvailableBytes':os.statvfs(area).f_bavail*os.statvfs(area).f_frsize,'cgroupMembership':Path('/proc/self/cgroup').read_text(),'limits':'heap 1536 MiB full stages, heap 256 MiB portable; wall bounds; no claimed cgroup memory envelope'}
    for name in ('memory.max','memory.current','memory.peak','memory.events'):
        f=Path('/sys/fs/cgroup')/name
        if f.is_file():host[name]=f.read_text()
    write_json(work/'host-resources.json',host)
    with open(os.environ['GITHUB_OUTPUT'],'a')as f:f.write('area='+str(area)+'\ntoolchain='+str(toolchain)+'\n')
    print('SETUP PASS exact source assembly and lifecycle-disabled locked install; outputs private')
if __name__=='__main__':
    try:main()
    except BaseException as e:
        print('HF_SETUP_FAILED_PRIVATE_DETAILS_REDACTED');raise SystemExit(1)
