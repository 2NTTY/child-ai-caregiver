"""Package an already successful official export. No build, publish or product edits.

Fresh Git checkout replaces only local materialization; old local grants/receipts
are not imported. Exact fixture/carrier bytes remain unchanged. Output is a
journal-only contribution, not a complete four-candidate comparison website.
"""
from pathlib import Path, PurePosixPath
from collections import Counter
import argparse
import hashlib
import json
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'orchestrator'))
from build_inputs import verify as verify_build_inputs
COMMIT = 'bc308157a48c3f2448898533dcf722385ee57f03'
TREE = 'c73aece2a1539ef6dbe9fc680167f159282aea25'
CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src 'self'"
SHELL = b'<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><script src="/experiments/dispatch.js"></script></head></html>\n'
SECRET = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}')
GENERATED = {'__prelude__', '\0polyfill:external-require', '\0polyfill:environment-variables', '\0polyfill:assets-registry', '\0shim:react-native-web/dist/exports/AppRegistry/AppContainer.js', '\0shim:react-native-web/dist/exports/BackHandler/index.js'}
IMAGE = {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.ttf', '.otf', '.woff', '.woff2', '.ico'}

def need(value, message):
    if not value:
        raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def files(root, max_file_bytes=33554432):
    result = {}
    for path in sorted(root.rglob('*')):
        need(not path.is_symlink(), 'Output contains a symbolic link')
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            need(path.stat().st_size <= max_file_bytes, 'Per-file remote artifact cap exceeded')
            data = path.read_bytes()
            result[rel] = {'bytes': len(data), 'sha256': digest(data)}
    return result

def safe_public(name, data):
    p = PurePosixPath(name)
    need(not p.is_absolute() and '..' not in p.parts and '\\' not in name, 'Unsafe public path')
    need(not any(part in {'.git', '.env', 'evidence', 'verification', 'private-export'} for part in p.parts), 'Private output path')
    need(p.suffix not in {'.map', '.pem', '.key', '.log', '.zip', '.tgz', '.tar'}, 'Forbidden public output type')
    if p.suffix in {'.js', '.html', '.css', '.json'}:
        need(not SECRET.search(data), 'Credential-like public content')
        need(all(x not in data for x in [b'/workspace/', b'/home/', b'/tmp/', b'sourceMappingURL=']), 'Private path or map reference in public content')

def raw_allowed(name):
    p = PurePosixPath(name)
    return (p.suffix == '.html' or name == 'favicon.ico' or name == '_expo/.routes.json'
            or name.startswith('_expo/static/') and p.suffix in {'.js', '.css', '.map'}
            or name.startswith('assets/') and p.suffix.lower() in IMAGE)

def source_path(root, name):
    """Metro names are repo-relative with a leading slash, or checkout-absolute.
    No resolution into an older checkout, ancestor dependency tree or tmp alias.
    """
    direct = Path(name)
    path = direct if direct.is_absolute() and direct.is_relative_to(root) else root / name.lstrip('/')
    path = path.resolve()
    need(path.is_relative_to(root), 'Map source escapes checkout')
    need(path.is_file(), 'Mapped physical input missing')
    return path

def verify_maps(root, raw, inventory, tracked, build_commit):
    maps = sorted(raw.rglob('*.map'))
    need(maps, 'External official maps are required')
    merged = {}
    map_rows = []
    for path in maps:
        value = json.loads(path.read_text())
        need(value.get('version') == 3 and not value.get('sourceRoot'), 'Unsupported source map format/root')
        need(len(value['sources']) == len(value['sourcesContent']), 'Incomplete sourcesContent')
        for name, content in zip(value['sources'], value['sourcesContent']):
            need(name not in merged or merged[name] == content, 'Different content for identical mapped source')
            merged[name] = content
        map_rows.append({'path': path.relative_to(raw).as_posix(), **inventory[path.relative_to(raw).as_posix()]})
    closure = []
    contexts = []
    exported_hashes = {row['sha256'] for row in inventory.values()}
    for name, content in merged.items():
        if name in GENERATED:
            need(content is None or isinstance(content, str), 'Invalid generated source')
            closure.append({'path': name.replace('\0', 'generated:'), 'kind': 'metro-generated', 'sha256': None if content is None else digest(content.encode())})
            continue
        if name.startswith('/frontend/app?ctx='):
            need(isinstance(content, str), 'Missing router context body')
            targets = re.findall(r'require\("([^\"]+)"\)', content)
            need(targets, 'Empty router context')
            relative = []
            for target in targets:
                p = source_path(root, target)
                rel = p.relative_to(root).as_posix()
                need(p.is_relative_to(root / 'frontend/app') and rel in tracked, 'Context references non-pinned route')
                need(p.read_bytes() == git(root, 'show', build_commit + ':' + rel), 'Context route drift')
                relative.append(rel)
            contexts.append({'path': '/frontend/app?ctx', 'kind': 'router-context', 'targets': relative, 'sha256': digest(content.encode())})
            continue
        p = source_path(root, name)
        rel = p.relative_to(root).as_posix()
        data = p.read_bytes()
        dependency = 'node_modules' in p.relative_to(root).parts
        if not dependency:
            need(rel in tracked and data == git(root, 'show', build_commit + ':' + rel), 'Mapped product is not pinned Git content')
        if p.suffix.lower() in IMAGE:
            need(digest(data) in exported_hashes, 'Mapped asset absent from official export')
            kind = 'dependency-asset' if dependency else 'product-asset'
        else:
            need(content is not None and data == content.encode(), 'Mapped input byte mismatch')
            kind = 'dependency' if dependency else 'product'
        closure.append({'path': rel, 'kind': kind, 'sha256': digest(data)})
    need(len(contexts) == 1, 'Exactly one current app router context required')
    mapped_product = {row['path'] for row in closure if row['kind'] == 'product'}
    for required in ['frontend/index.js', 'frontend/src/entry/Application.tsx', 'frontend/src/production/ProductionProvider.tsx', 'frontend/src/preview/browser-history-events.ts']:
        need(required in mapped_product, 'Missing current custom entry/owner in official map')
    return {'maps': map_rows, 'closure': closure, 'contexts': contexts}

def verify_entry(root, raw):
    """Retained original source-map VLQ/module-edge check, portable checkout paths."""
    sha = digest
    p=next((raw/'_expo/static/js/web').glob('index-*.js'));m=json.loads(Path(str(p)+'.map').read_text());code=p.read_text();lines=code.splitlines();srcs=m['sources'];contents=dict(zip(srcs,m['sourcesContent']));select={
    'index':'/frontend/index.js','application':'/frontend/src/entry/Application.tsx','owner':'/frontend/src/production/ProductionProvider.tsx','platform':'/frontend/src/platform/runtime.ts','history':'/frontend/src/preview/browser-history-events.ts','layout':'/frontend/app/_layout.tsx','profile':'/frontend/app/(dashboard)/profile.tsx',
    'metro':'/@expo/metro-runtime/src/index.ts','ctx':'/expo-router/_ctx.web.js','expo':'/expo-router/build/index.js','exporoot':'/expo-router/build/ExpoRoot.js','head':'/expo-router/head.js','refresh':'/expo-router/build/fast-refresh.js','render':'/expo-router/build/renderRootComponent.js'}
    selected={}
    for key,suffix in select.items():
     matches=[x for x in srcs if x.endswith(suffix)];assert len(matches)==1,(key,matches);selected[key]=matches[0]
    needed={srcs.index(x)for x in selected.values()};mappedlines={x:set()for x in needed};alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';vals={c:i for i,c in enumerate(alphabet)};source_index=0
    for line_no,line in enumerate(m['mappings'].split(';')):
     for segment in line.split(','):
      if not segment:continue
      fields=[];value=shift=0
      for char in segment:
       v=vals[char];value+=(v&31)<<shift
       if v&32:shift+=5
       else:
        fields.append(-(value>>1)if value&1 else value>>1);value=shift=0
      assert len(fields)in [1,4,5]
      if len(fields)>1:
       source_index+=fields[1]
       if source_index in needed:mappedlines[source_index].add(line_no)
    modules={}
    for key,src in selected.items():
     rows=[]
     for number in sorted(mappedlines[srcs.index(src)]):
      line=lines[number]
      found=re.search(r'},(\d+),(\[.*\])\);?$',line)
      if found and line.startswith('__d('):rows.append({'line':number+1,'id':int(found[1]),'dependencies':json.loads(found[2]),'generatedCodeSha256':sha(line.encode()),'code':line})
     if key=='platform' and not rows:
      # Exact web runtime is an intentionally empty TS module. Metro emits no mapped spans.
      assert contents[src].strip()=='export {};' or re.sub(r'//[^\n]*|/\*.*?\*/', '', contents[src], flags=re.S).strip()=='export {};',contents[src]
      moduleid=modules['index']['dependencies'][1]
      matches=[(i,x)for i,x in enumerate(lines)if re.search(r'},'+str(moduleid)+r',\[\]\);?$',x)]
      assert len(matches)==1;number,line=matches[0];assert re.fullmatch(r'__d\(function\([^)]*\)\{\},'+str(moduleid)+r',\[\]\);?',line)
      rows=[{'line':number+1,'id':moduleid,'dependencies':[],'generatedCodeSha256':sha(line.encode()),'code':line,'mappingException':'Intentionally empty web runtime source maps to no statements; actual index dependency slot1 targets this exact empty module.'}]
     assert len(rows)==1,(key,len(rows));row=rows[0];row.update(source=src,sourceSha256=sha(contents[src].encode()));modules[key]=row
    index=modules['index'];app=modules['application'];owner=modules['owner']
    assert index['dependencies'][:5]==[modules[k]['id']for k in ['metro','platform','history','application','render']]
    assert f'__r({index["id"]});'in code and 'renderRootComponent)(n.App)'in index['code']
    assert app['dependencies'][1:6]==[modules[k]['id']for k in ['ctx','expo','head','refresh','owner']]
    assert 'wrapper:'in app['code'] and '.ProductionOwnerHost'in app['code'] and '.ExpoRoot'in app['code'] and '.ctx'in app['code'] and '.Provider'in app['code']
    assert 'ProductionOwnerHost'in owner['code'] and 'ProductionProvider'in owner['code'];assert 'wrapper'in modules['exporoot']['code']
    return {key: {k: (str(source_path(root, v).relative_to(root)) if k == 'source' else v) for k, v in row.items() if k != 'code'} for key, row in modules.items()}

def main():
    parser = argparse.ArgumentParser()
    for key in ['source', 'raw', 'out', 'proof']:
        parser.add_argument('--' + key, required=True, type=Path)
    args = parser.parse_args()
    root, raw, out, proof = [getattr(args, key).resolve() for key in ['source', 'raw', 'out', 'proof']]
    need(root.is_dir() and raw.is_dir(), 'Missing checkout/export')
    need(not out.exists() and not proof.exists(), 'Preserve existing output; fresh paths required')
    need(not any(a == b or a.is_relative_to(b) for a, b in [(out, root), (out, raw), (proof, out), (proof, root), (proof, raw)]), 'Outputs must be separate from checkout/raw/public')
    recipe = json.loads((HERE / 'recipe.json').read_text())
    identity = verify_build_inputs(root, 'handbook')
    need(identity['originalProductCommit'] == COMMIT and identity['originalProductTree'] == TREE, 'Original Handbook provenance differs')
    build_commit = identity['buildCommit']
    tracked = set(identity['files'])
    for name, expected in recipe['sourcePins'].items():
        need(digest((root / name).read_bytes()) == expected, 'Build input pin changed: ' + name)
    for name, expected in recipe['overlayPins'].items():
        need(digest((HERE / 'overlay' / name).read_bytes()) == expected, 'Overlay pin changed: ' + name)
    # Same-design binary inputs are pinned independently of file extensions.
    for name, expected in recipe['assetInputPins'].items():
        p = source_path(root, name)
        need(digest(p.read_bytes()) == expected, 'Pinned binary source/runtime input changed: ' + name)
        if 'node_modules' not in PurePosixPath(name).parts:
            need(name in tracked and p.read_bytes() == git(root, 'show', build_commit + ':' + name), 'Binary product input is not pinned Git content')
    inventory = files(raw, recipe['rawPerFileMaxBytes'])
    actual_binary_counts = Counter(row['sha256'] for name, row in inventory.items() if name.startswith('assets/'))
    need(dict(actual_binary_counts) == recipe['binaryAssetHashCounts'], 'Extra, missing or changed public binary asset')
    favicon = recipe['generatedFavicon']
    need(inventory.get(favicon['path']) == {'bytes': favicon['bytes'], 'sha256': favicon['sha256']}, 'Unreviewed generated favicon')
    need(inventory and all(raw_allowed(name) for name in inventory), 'Unexpected official output: review before packaging')
    need(sum(row['bytes'] for row in inventory.values()) <= recipe['rawMaxBytes'], 'Raw budget exceeded; no retry or pruning')
    routes = sorted(name[:-5] for name in inventory if name.endswith('.html'))
    need(routes == recipe['routeKeys'], 'Official route set changed')
    closure = verify_maps(root, raw, inventory, tracked, build_commit)
    entry_proof = verify_entry(root, raw)
    initial = [name for name in inventory if re.fullmatch(r'_expo/static/js/web/index-[0-9a-f]+\.js', name)]
    need(len(initial) == 1, 'Exactly one official index chunk required')
    payloads, transforms = [], []
    public = {}
    injection = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="referrer" content="no-referrer"><script src="/experiments/fixtures/journal.js"></script>'
    for name in inventory:
        data = (raw / name).read_bytes()
        if name.endswith('.map'):
            continue
        if name.endswith('.html'):
            html = data.decode()
            need('<!DOCTYPE html>' in html and 'lang="zh-Hant"' in html and initial[0] in html, 'Unexpected official SSG document')
            need(html.count('<head>') == 1 and 'Content-Security-Policy' not in html, 'Ambiguous HTML injection boundary')
            prepared = html.replace('<head>', '<head>' + injection, 1)
            need(prepared.replace(injection, '', 1) == html, 'Non-reversible HTML transform')
            payload = 'experiments/payload/journal/' + name[:-5] + '.js'
            public[payload] = ('document.write(' + json.dumps(prepared, ensure_ascii=True) + ');\n').encode()
            public[name] = SHELL
            payloads.append({'route': name, 'payload': payload, 'rawSha256': digest(data), 'injectedSha256': digest(prepared.encode()), 'payloadSha256': digest(public[payload])})
            continue
        if name.endswith('.js'):
            matches = list(re.finditer(rb'(?m)^//# sourceMappingURL=([^\r\n]+)\n?', data))
            if matches:
                need(len(matches) == 1 and matches[0].start() > len(data) - 400, 'Nonterminal/ambiguous source map reference')
                match = matches[0]
                clean = data[:match.start()] + data[match.end():]
                need(clean[:match.start()] + match.group() + clean[match.start():] == data, 'Non-reversible map stripping')
                transforms.append({'path': name, 'offset': match.start(), 'removedUtf8': match.group().decode(), 'rawSha256': digest(data), 'publicSha256': digest(clean)})
                data = clean
        public[name] = data
    need(transforms, 'Official map comments not found; do not assume map-free provenance')
    for name in recipe['overlayPins']:
        public[name] = (HERE / 'overlay' / name).read_bytes()
    need(sum(len(data) for data in public.values()) <= recipe['publicMaxBytes'], 'Public budget exceeded')
    for name, data in public.items():
        safe_public(name, data)
    # Check all original SSR local references against the emitted candidate set.
    refs = 0
    for name in inventory:
        if not name.endswith('.html'):
            continue
        for target in re.findall(r'(?:src|href)="([^\"]+)"', (raw / name).read_text()):
            if target.startswith(('data:', '#')):
                continue
            parsed = urlsplit(target)
            need(not parsed.scheme and not parsed.netloc, 'External HTML resource')
            rel = unquote(parsed.path).lstrip('/')
            need(rel in public or rel + '.html' in public or rel + '/index.html' in public, 'Unresolved local HTML resource')
            refs += 1
    out.mkdir(parents=True)
    for name, data in sorted(public.items()):
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        need(target.read_bytes() == data, 'Public write readback differs')
    need(not git(root, 'diff', '--name-only', 'HEAD', '--'), 'Checkout drift after packaging')
    need(verify_build_inputs(root, 'handbook') == identity, 'Published Handbook input closure changed')
    result = {'publishedBuildCommit': identity['buildCommit'], 'publishedBuildTree': identity['buildTree'], 'buildInputsManifestSha256': identity['manifestSha256'], 'status': 'PACKAGED_STATIC_CHECKS_ONLY_NOT_BROWSER_ACCEPTED', 'productCommit': COMMIT, 'productTree': TREE, 'variant': 'journal', 'entry': '/?experiment=journal&previewScenario=core-journeys', 'raw': inventory, 'public': files(out), 'mapClosure': closure, 'entryModuleProof': entry_proof, 'payloads': payloads, 'mapRemoval': transforms, 'localHtmlReferences': refs, 'overlayPins': recipe['overlayPins'], 'sourcePins': recipe['sourcePins'], 'sourceProductDelta': [], 'assetInputPins': recipe['assetInputPins'], 'binaryAssetHashCounts': recipe['binaryAssetHashCounts'], 'generatedFavicon': recipe['generatedFavicon'], 'remainingGates': recipe['remainingGates'], 'artifactRetention': recipe['artifactRetention'], 'publicationAuthorizedByThisScript': False}
    proof.parent.mkdir(parents=True, exist_ok=True)
    proof.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'productCommit': COMMIT, 'publicFiles': len(public), 'routes': len(routes), 'proofSha256': digest(proof.read_bytes())}))

if __name__ == '__main__':
    main()
