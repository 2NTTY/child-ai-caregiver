"""Exact manifest-only assembly; strict in-process patching with no fuzz/offset search."""
from pathlib import Path
import argparse,json,re,subprocess
from controls import *
HERE=Path(__file__).resolve().parent

def exact_patch(root,data,changed):
    need(data.endswith(b'\n'),'unterminated patch stream');lines=data.splitlines(keepends=True);i=0;seen=[]
    expected={x['path']:x for x in changed};need(len(expected)==len(changed),'duplicate change')
    while i<len(lines):
        need(lines[i].startswith(b'--- '),'missing old header');old=lines[i][4:-1].decode();i+=1
        need(i<len(lines)and lines[i].startswith(b'+++ b/'),'missing new header');name=path_name(lines[i][6:-1].decode());i+=1
        need(name in expected and name not in seen,'unknown/duplicate patch target');seen.append(name)
        add=expected[name]['origin']=='add';need(old==('/dev/null'if add else 'a/'+name),'source mismatch/escape')
        dest=root/name
        if add:need(not dest.exists()and not dest.is_symlink(),'addition exists');before=[]
        else:before=regular(root,name).read_bytes().splitlines(keepends=True)
        out=[];cursor=0;hunks=0
        while i<len(lines)and lines[i].startswith(b'@@ '):
            m=re.fullmatch(rb'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n',lines[i]);need(m is not None,'bad hunk header');i+=1
            os_,oc,ns,nc=int(m[1]),int(m[2]or 1),int(m[3]),int(m[4]or 1)
            pos=os_-1 if oc else os_;need(cursor<=pos<=len(before),'overlap/invalid exact offset')
            out.extend(before[cursor:pos]);cursor=pos
            need((ns-1 if nc else ns)==len(out),'new hunk offset mismatch')
            a=b=0
            while a<oc or b<nc:
                need(i<len(lines)and lines[i][:1]in (b' ',b'+',b'-')and lines[i].endswith(b'\n'),'truncated hunk')
                lead,body=lines[i][:1],lines[i][1:];i+=1
                if i<len(lines)and lines[i]==b'\\ No newline at end of file\n':body=body[:-1];i+=1
                if lead in (b' ',b'-'):
                    need(cursor<len(before)and before[cursor]==body,'exact context mismatch; no fuzz/offset');cursor+=1;a+=1
                if lead in (b' ',b'+'):out.append(body);b+=1
                need(a<=oc and b<=nc,'hunk count overflow')
            hunks+=1
        need(hunks>0,'empty patch member');out.extend(before[cursor:]);dest.parent.mkdir(parents=True,exist_ok=True)
        # Every ancestor originates from the fresh projector; still reject symlink drift.
        for p in [dest,*dest.parents]:need(not p.is_symlink(),'patch symlink')
        dest.write_bytes(b''.join(out))
    need(seen==list(expected),'delta member order/census mismatch')
    return {'members':len(seen),'fuzz':0,'offset':0}

def load_manifest(path=HERE/'inputs.json'):
    data=json.loads(Path(path).read_text());need(data['schema']=='relative-execution-inputs-v1'and data['repository']==REPOSITORY,'manifest identity')
    need(set(data['variants'])==set(BASES),'variant census')
    for name,v in data['variants'].items():
        source=rows(v['sourceProjection']);supp=rows(v['supplementalInputs']);runtime=rows(v['portableRuntimeInputs'])
        need(v['publicBaseCommit']==BASES[name],'wrong pinned public base')
        need(len(source)==v['sourceFileCount']==(593 if name=='fourth'else 623),'source scope/count')
        need(sum(x['bytes']for x in source.values())==v['sourceBytes'],'source byte count')
        required={'package-lock.json'}|{'frontend/scripts/'+x for x in ['date-time.test.mts','profile-form.test.mts','family-preview.test.mjs','memory-preview.test.mjs','task-forms.test.mjs']}
        need(set(supp)==required and not set(source)&set(supp),'supplement scope/overlap')
        need(supp['package-lock.json']['sha256']=='42c936ee3bef938c7def0ef376a724ac0bf21470981ef9dbd2b9a3eeb181e119','lock pin drift')
        for r in v['sourceProjection']:
            need(r['origin']in ('public-baseline','replace','add'),'unknown source origin')
            need((r['baselineSha256']is None)==(r['origin']=='add'),'baseline identity missing/extra')
            if r['origin']!='add':need(re.fullmatch('[0-9a-f]{64}',r['baselineSha256'])is not None,'invalid baseline hash')
        need([r['path']for r in v['sourceProjection']if r['origin']!='public-baseline']==v['delta']['files'],'delta scope')
        roots=[p for p in source if p.startswith(('frontend/app/','frontend/src/'))and p.endswith(('.ts','.tsx'))]
        need(roots==v['directRoots']and len(roots)==(479 if name=='fourth'else 500),'full direct-root scope')
        need(len(runtime)==(9 if name=='fourth'else 7),'portable input count')
    return data

def verify_payload(here=HERE, expected_digest=None):
    data=regular(here,'checksums.json').read_bytes()
    if expected_digest is not None:need(re.fullmatch('[0-9a-f]{64}',expected_digest or '') is not None and sha(data)==expected_digest,'reviewed control manifest digest mismatch')
    spec=json.loads(data);expected=rows(spec['files']);actual=census(here)
    actual.pop('checksums.json',None);need(actual==expected,'public control payload drift/unknown member')
    return sha(canonical(spec))

def assemble(v,base,out,here=HERE):
    base=absolute(base);out=absolute(out);need(not out.exists(),'assembly destination exists');out.mkdir(mode=0o700)
    for r in v['sourceProjection']:
        path_name(r['path'])
        if r['origin']=='add':need(not (base/r['path']).exists()and not (base/r['path']).is_symlink(),'new source already exists in public base');continue
        b=regular(base,r['path']).read_bytes();need(sha(b)==r['baselineSha256'],'baseline hash drift')
        p=out/r['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
    d=v['delta'];delta=regular(here,d['path']).read_bytes();need(row(d['path'],delta)=={k:d[k]for k in ('path','bytes','sha256')},'delta hash/bytes drift')
    patch=exact_patch(out,delta,[r for r in v['sourceProjection']if r['origin']!='public-baseline'])
    source=match(out,v['sourceProjection'])
    for r in v['supplementalInputs']:
        b=regular(base,r['path']).read_bytes();need(row(r['path'],b)==r,'supplement hash drift')
        p=out/r['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
    result=match(out,v['sourceProjection']+v['supplementalInputs']);check_scope(out)
    for r in v['portableRuntimeInputs']:need(row(r['path'],regular(here,r['path']).read_bytes())==r,'portable bytes drift')
    return {'kind':'relative-source-execution-assembly-not-compiled','baseCommit':v['publicBaseCommit'],'source':source,'assembly':result,'patch':patch,'harbourCompiledAdmission':'OPEN'}

def main():
    p=argparse.ArgumentParser();p.add_argument('variant',choices=BASES);p.add_argument('--base',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--receipt',type=Path,required=True);a=p.parse_args()
    verify_payload();m=load_manifest();v=m['variants'][a.variant]
    actual=subprocess.check_output(['git','-C',str(a.base),'rev-parse','HEAD'],text=True).strip();need(actual==v['publicBaseCommit'],'checkout not fixed public base')
    write_json(a.receipt,assemble(v,a.base,a.out))
if __name__=='__main__':
    try:main()
    except Refused as e:raise SystemExit('REFUSED: '+str(e))
