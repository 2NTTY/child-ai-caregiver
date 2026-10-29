#!/usr/bin/env python3
"""Package the exact fourth export, with no product-code patch and no network access."""
import argparse, hashlib, json, pathlib, re, shutil, sys, subprocess
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from verify_source import verify
sha = lambda data: hashlib.sha256(data).hexdigest()
IMAGE = {'.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.ttf','.otf','.woff','.woff2'}
TEXT = {'.html','.js','.css','.json','.svg'}
FAVICON = {'bytes':14510,'sha256':'0f30b4db3949836cf593141baaf312febbcf8b63ed937b1dbef830dbc708e7f8'}
PRIVATE = re.compile(rb'/workspace/|/tmp/|/home/|sourceMappingURL=|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}')
CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src 'self'"
HEAD = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="referrer" content="no-referrer"><meta name="fourth-preview-source" content="f1c60c6ae2928e5407dabccbd04a504f691e39cf"><script src="/experiments/fourth-preview-fixture.js"></script><script src="/experiments/fourth-file-safety.js"></script>'
ROUTES = ['(dashboard)/care', '(dashboard)/chat', '(dashboard)/contact', '(dashboard)/family', '(dashboard)/growth', '(dashboard)/guide', '(dashboard)/history', '(dashboard)/index', '(dashboard)/memory', '(dashboard)/more', '(dashboard)/photos', '(dashboard)/profile', '(dashboard)/settings', '(dashboard)/sources', '(dashboard)/summary', '(dashboard)/tasks', '+not-found', '_sitemap', 'admin', 'care', 'chat', 'contact', 'family', 'growth', 'guide', 'history', 'index', 'login', 'memory', 'more', 'photos', 'profile', 'settings', 'sources', 'summary', 'tasks']

def raw_allowed(name):
    p=pathlib.PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or '\\' in name:return False
    return (name in {route+'.html' for route in ROUTES} or name=='favicon.ico' or name=='_expo/.routes.json'
            or re.fullmatch(r'_expo/static/(?:js/web/[^/]+\.js(?:\.map)?|css/[^/]+\.css(?:\.map)?)',name) is not None
            or name.startswith('assets/') and p.suffix.lower() in IMAGE)

def scan_public(name,data):
    p=pathlib.PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or '\\' in name or any(part in {'.git','.env','evidence','verification'} for part in p.parts):raise ValueError('Unsafe public path: '+name)
    if p.suffix.lower() in TEXT and PRIVATE.search(data):raise ValueError('Private public content: '+name)
    if p.suffix.lower() not in TEXT|IMAGE:raise ValueError('Unexpected final output type: '+name)


def strip_map_comment(data):
    matches=list(re.finditer(rb'^//# sourceMappingURL=([^\r\n]+)(?:\r?\n|$)',data,re.M))
    if not matches:
        if b'sourceMappingURL=' in data:raise ValueError('Unknown embedded map reference')
        return data,None
    if len(matches)!=1:raise ValueError('Multiple source map comments')
    match=matches[0];target=match.group(1)
    if not re.fullmatch(rb'(?:/_expo/static/js/web/)?[A-Za-z0-9_.-]+\.js\.map',target):raise ValueError('Unexpected source map comment target')
    trailer=data[match.end():]
    if trailer.strip() and not re.fullmatch(rb'(?://# debugId=[0-9a-fA-F-]{36}\r?\n?)?\s*',trailer):raise ValueError('Unexpected content after map comment')
    output=data[:match.start()]+trailer
    if output[:match.start()]+match.group()+output[match.start():]!=data:raise ValueError('Non-reversible map line removal')
    return output,{'offset':match.start(),'mapTarget':target.decode('ascii'),'lineEnding':'CRLF' if match.group().endswith(b'\r\n') else 'LF' if match.group().endswith(b'\n') else 'NONE','removedCommentBytes':len(match.group()),'removedCommentSha256':sha(match.group()),'trailerBytesPreserved':len(trailer)}


def inventory(root):
    rows=[]
    for path in sorted(root.rglob('*')):
        if path.is_symlink(): raise ValueError('Symlink output rejected')
        if path.is_file(): rows.append({'path':path.relative_to(root).as_posix(),'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())})
    return rows

def verify_overlay():
    fixture=(HERE/'overlay/experiments/fourth-preview-fixture.js').read_text()
    patches=json.loads((HERE/'adapter/fixture-patches.json').read_text())
    for row in reversed(patches['patches']):
        if fixture.count(row['new']) != 1: raise ValueError('Non-reversible fixture adapter')
        fixture=fixture.replace(row['new'],row['old'])
    if sha(fixture.encode()) != patches['baseSha256']: raise ValueError('Combined business core drift')
    return {'baseSha256':patches['baseSha256'],'reversibleChanges':len(patches['patches']),'businessCoreUnchanged':True}

def asset_family(source,file,pins):
    """Only the exact mapped base and its physical @Nx siblings; no unrelated directory assets."""
    base=re.sub(r'@[0-9]+(?:\.[0-9]+)?x$','',file.stem)
    pattern=re.compile(re.escape(base)+r'(?:@[0-9]+(?:\.[0-9]+)?x)?'+re.escape(file.suffix)+r'$')
    rows=[]
    for candidate in sorted(file.parent.iterdir()):
        if not pattern.fullmatch(candidate.name):continue
        if candidate.is_symlink() or not candidate.is_file():raise ValueError('Non-file scale-family input')
        candidate=candidate.resolve()
        if not candidate.is_relative_to(source):raise ValueError('Escaped scale-family input')
        relative=candidate.relative_to(source).as_posix();data=candidate.read_bytes();dependency='node_modules' in candidate.relative_to(source).parts
        if not dependency and (relative not in pins or sha(data)!=pins[relative]['sha256']):raise ValueError('Unpinned product scale-family input')
        rows.append({'mappedBase':file.relative_to(source).as_posix(),'path':relative,'sha256':sha(data),'bytes':len(data),'dependency':dependency})
    if not rows:raise ValueError('Empty asset scale family')
    return rows


def audit_maps(source,raw):
    maps=list(raw.rglob('*.map'))
    if not maps: raise ValueError('External source maps required for private closure proof')
    known_generated={'__prelude__','\0polyfill:external-require','\0polyfill:environment-variables','\0polyfill:assets-registry','\0shim:react-native-web/dist/exports/AppRegistry/AppContainer.js','\0shim:react-native-web/dist/exports/BackHandler/index.js'}
    pins={row['path']:row for row in json.loads((HERE/'PRODUCT_INPUTS.json').read_text())['files']}
    exported={sha(file.read_bytes()) for file in raw.rglob('*') if file.is_file()}
    matched=[];generated=[];contexts=[];families=[];merged={}
    def physical(name):
        clean=name.removeprefix('file://');direct=pathlib.Path(clean)
        candidate=direct if direct.is_absolute() and direct.is_relative_to(source) else source/clean.lstrip('/')
        candidate=candidate.resolve()
        if not candidate.is_relative_to(source) or not candidate.is_file():raise ValueError('Unresolved or escaped mapped source: '+name)
        return candidate
    for file in maps:
        data=json.loads(file.read_text())
        if data.get('version')!=3 or data.get('sourceRoot') or 'sections' in data: raise ValueError('Unsupported source map format')
        sources=data.get('sources',[]);contents=data.get('sourcesContent',[])
        if len(sources)!=len(contents):raise ValueError('Source contents absent')
        for name,content in zip(sources,contents):
            if name in merged and merged[name]!=content:raise ValueError('Conflicting mapped source')
            merged[name]=content
    for name,content in merged.items():
        if name in known_generated:
            if content is not None and not isinstance(content,str):raise ValueError('Invalid generated source')
            generated.append({'name':name.replace('\0','generated:'),'sha256':None if content is None else sha(content.encode())});continue
        if name.startswith('/frontend/app?ctx='):
            if not isinstance(content,str):raise ValueError('Missing router context')
            targets=re.findall(r'require\("([^"]+)"\)',content)
            if not targets:raise ValueError('Empty router context')
            rows=[]
            for target in targets:
                file=physical(target);relative=file.relative_to(source).as_posix()
                if not relative.startswith('frontend/app/') or relative not in pins or sha(file.read_bytes())!=pins[relative]['sha256']:raise ValueError('Unpinned router context target')
                rows.append(relative)
            contexts.append({'path':'/frontend/app?ctx','sha256':sha(content.encode()),'targets':rows});continue
        file=physical(name);relative=file.relative_to(source).as_posix();actual=file.read_bytes();dependency='node_modules' in file.relative_to(source).parts
        if not dependency and (relative not in pins or sha(actual)!=pins[relative]['sha256']):raise ValueError('Mapped source outside fixed product inventory: '+relative)
        asset=file.suffix.lower() in IMAGE
        if asset:
            family=asset_family(source,file,pins);families.extend(family)
            if not any(row['sha256'] in exported for row in family):raise ValueError('Mapped asset family not exported: '+relative)
        elif not isinstance(content,str) or actual!=content.encode():raise ValueError('Mapped source content drift: '+relative)
        matched.append({'path':relative,'sha256':sha(actual),'dependency':dependency,'asset':asset})
    if len(contexts)!=1:raise ValueError('One exact fourth router context required')
    required={'frontend/index.js','frontend/src/preview/PreviewNavigationGuard.tsx','frontend/src/preview/browser-history-events.ts','frontend/src/production/ProductionProvider.tsx','frontend/app/_layout.tsx'}
    if not required.issubset({row['path'] for row in matched}):raise ValueError('Fourth original entry/owner/guard absent from maps')
    return {'matched':matched,'generated':generated,'contexts':contexts,'assetFamilies':families,'mapFiles':len(maps)}

def audit_entry(source,raw):
    """Remote-only AST/VLQ full module graph; no line-only module approximation."""
    recipe=json.loads((HERE/'recipe.json').read_text());verifier=HERE/'verify_graph.mjs'
    if sha(verifier.read_bytes())!=recipe['graphVerifierSha256']:raise ValueError('Graph verifier source drift')
    result=subprocess.run(['node','--max-old-space-size=4096',str(verifier),str(source),str(raw)],capture_output=True,timeout=180,check=False)
    if result.returncode!=0:raise ValueError('Fourth full graph verifier failed, exit '+str(result.returncode)+'; raw parser stderr is not copied into public proof')
    if result.stderr or len(result.stdout)>1024*1024:raise ValueError('Unexpected graph proof output')
    scan_public('graph-proof.json',result.stdout);return json.loads(result.stdout)


def main():
    parser=argparse.ArgumentParser()
    for key in ['source','raw','out','proof']:parser.add_argument('--'+key,type=pathlib.Path,required=True)
    args=parser.parse_args();source=args.source.resolve();raw=args.raw.resolve();out=args.out.resolve();proof=args.proof.resolve()
    if out.exists() or proof.exists():raise ValueError('Fresh output and proof paths required')
    if any(a==b or a.is_relative_to(b) for a,b in [(out,source),(out,raw),(proof,out),(proof,source),(proof,raw)]):raise ValueError('Output/proof must be outside source/raw/public')
    receipt=verify(source);receipt['fixture']=verify_overlay()
    entries=inventory(raw)
    if not entries or any(not raw_allowed(row['path']) for row in entries):raise ValueError('Unexpected official raw namespace')
    if max(row['bytes'] for row in entries)>128*1024*1024 or sum(row['bytes'] for row in entries)>256*1024*1024:raise ValueError('Raw/file size budget exceeded')
    closure=audit_maps(source,raw);edges=audit_entry(source,raw)
    asset_hashes={row['sha256'] for row in closure['assetFamilies']}
    if any(b'_expo/.routes.json' in (raw/row['path']).read_bytes() for row in entries if pathlib.Path(row['path']).suffix in {'.html','.js','.css'}):raise ValueError('Runtime references omitted Expo route metadata')
    html={row['path'][:-5] for row in entries if row['path'].endswith('.html')}
    if html!=set(ROUTES):raise ValueError('Unexpected fourth export route set')
    out.mkdir(parents=True);transforms=[];payloads=[]
    for row in entries:
        rel=row['path'];data=(raw/rel).read_bytes()
        if rel.endswith('.map') or rel=='_expo/.routes.json':continue
        if rel=='favicon.ico':
            if len(data)!=FAVICON['bytes'] or sha(data)!=FAVICON['sha256']:raise ValueError('Unreviewed generated favicon')
        elif pathlib.Path(rel).suffix.lower() in IMAGE and sha(data) not in asset_hashes:raise ValueError('Unmapped or unpinned public binary: '+rel)
        if rel.endswith('.html'):
            text=data.decode();lang_before='<html  lang="en">';lang_after='<html lang="zh-Hant">'
            if text.count('<head>')!=1 or '/experiments/' in text:raise ValueError('Unexpected raw HTML')
            language_changed=lang_before in text
            prepared=text.replace(lang_before,lang_after).replace('<head>','<head>'+HEAD)
            reversed_html=prepared.replace(HEAD,'',1)
            if language_changed:reversed_html=reversed_html.replace(lang_after,lang_before,1)
            if reversed_html!=text:raise ValueError('HTML not reversible')
            scan_public(rel,prepared.encode())
            target='experiments/payload/uiux-upgrade/'+rel[:-5]+'.js'
            payload=('document.write('+json.dumps(prepared,ensure_ascii=True)+');\n').encode()
            p=out/target;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(payload)
            payloads.append({'path':target,'route':rel[:-5],'rawHtmlSha256':row['sha256'],'preparedHtmlSha256':sha(prepared.encode()),'payloadSha256':sha(payload),'languageChanged':language_changed})
            wrapper='<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+CSP+'"><script src="/experiments/fourth-standalone-dispatch.js"></script></head><body></body></html>\n'
            p=out/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(wrapper)
            continue
        if rel.endswith('.js'):
            data,change=strip_map_comment(data)
            if change:transforms.append({'path':rel,'rawSha256':row['sha256'],'publicSha256':sha(data),**change})
        p=out/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    shutil.copytree(HERE/'overlay',out,dirs_exist_ok=True)
    for file in out.rglob('*'):
        if file.is_file():scan_public(file.relative_to(out).as_posix(),file.read_bytes())
    public_files=inventory(out)
    if max(row['bytes'] for row in public_files)>32*1024*1024 or sum(row['bytes'] for row in public_files)>32*1024*1024:raise ValueError('Site/file size budget exceeded')
    closure_bytes=json.dumps(closure,sort_keys=True,separators=(',',':')).encode();edge_bytes=json.dumps(edges,sort_keys=True,separators=(',',':')).encode()
    receipt.update({'format':'fourth-public-safe-export-proof-v2','closure':{'sha256':sha(closure_bytes),'sources':len(closure['matched']),'generated':len(closure['generated']),'contexts':len(closure['contexts']),'mapsValidatedRemotely':closure['mapFiles'],'verifiedScaleFamilyInputs':len(closure['assetFamilies'])},'entryEdges':{'sha256':sha(edge_bytes),'modules':edges['registeredModules'],'edges':edges['numericEdges'],'asyncPaths':edges['asyncPaths']},'rawInventorySha256':sha(json.dumps(entries,sort_keys=True,separators=(',',':')).encode()),'rawFiles':len(entries),'rawBytes':sum(row['bytes'] for row in entries),'payloads':payloads,'mapFreeTransforms':transforms,'publicFiles':public_files,'finalTextScan':True,'binaryHashesBound':True,'standaloneOnly':True,'canonicalOriginalReturn':'NOT_INCLUDED_PARENT_MUST_RETAIN_V94','rawMapDisposition':'RUNNER_LOCAL_ONLY_UNTIL_TEARDOWN_NOT_UPLOADED','nativeBrowser':'NOT_RUN','publication':'NOT_AUTHORIZED_BY_THIS_RECEIPT'})
    proof_data=(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n').encode();scan_public('public-safe-proof.json',proof_data)
    proof.parent.mkdir(parents=True,exist_ok=True);proof.write_bytes(proof_data)
    print(json.dumps({'productCommit':receipt['productCommit'],'payloads':len(payloads),'publicFiles':len(receipt['publicFiles']),'publicBytes':sum(row['bytes'] for row in receipt['publicFiles']),'browser':'NOT_RUN'}))

if __name__=='__main__':main()
