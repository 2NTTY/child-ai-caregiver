#!/usr/bin/env python3
"""Care-only contribution from a fresh official export; no build or publication.

Retains the R7 reversible fixture injection, current custom-entry proof and exact
R3 fixture bytes. The two authorized Task files are a NEW candidate overlay.
"""
from pathlib import Path, PurePosixPath
from html.parser import HTMLParser
from collections import Counter
from urllib.parse import unquote, urljoin, urlsplit
import argparse
import hashlib
import json
import os
import re
import subprocess

HERE = Path(__file__).resolve().parent
RECIPE = json.loads((HERE / 'recipe.json').read_text())
COMMIT = RECIPE['sourceCommit']
TREE = RECIPE['sourceTree']
CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; manifest-src 'self'"
INJECTION = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="referrer" content="no-referrer"><script src="/experiments/fixtures/care.js"></script>'
IMAGE = {'.png', '.jpg', '.jpeg', '.webp', '.svg', '.ttf', '.otf', '.woff', '.woff2', '.ico'}
PRIVATE = re.compile(rb'file://[^/]*?/+(?:workspace|home|tmp)/|(?<![A-Za-z0-9_./-])/(?:workspace|home|tmp)/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}')
GENERATED = {'__prelude__', '\0polyfill:external-require', '\0polyfill:environment-variables', '\0polyfill:assets-registry', '\0shim:react-native-web/dist/exports/AppRegistry/AppContainer.js', '\0shim:react-native-web/dist/exports/BackHandler/index.js'}


def need(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def git(root, *args):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1',
               GIT_ALLOW_PROTOCOL='', GIT_TERMINAL_PROMPT='0')
    return subprocess.check_output(['git', '-C', str(root), *args], env=env)


def files(root):
    rows = {}
    for path in sorted(root.rglob('*')):
        need(not path.is_symlink(), 'Symbolic link in export/output')
        if path.is_file():
            data = path.read_bytes()
            rows[path.relative_to(root).as_posix()] = {'bytes': len(data), 'sha256': digest(data)}
    return rows


def safe_public(name, data):
    path = PurePosixPath(name)
    need(not path.is_absolute() and '..' not in path.parts and '\\' not in name, 'Unsafe public path')
    need(not any(x.startswith('.') and x != '.routes.json' for x in path.parts), 'Hidden public path')
    need(path.suffix not in {'.map', '.pem', '.key', '.log', '.zip', '.tgz', '.tar'}, 'Forbidden public type')
    need(not PRIVATE.search(data), 'Private or credential-like content')
    if path.suffix in {'.js', '.css', '.html', '.json'}:
        need(b'sourceMappingURL=' not in data, 'Source map reference in public content')


def raw_allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        return False
    return (path.suffix == '.html' or name in {'favicon.ico', '_expo/.routes.json'}
            or name.startswith('_expo/static/') and path.suffix in {'.js', '.css', '.map'}
            or name.startswith('assets/') and path.suffix.lower() in IMAGE)


def source_path(root, name):
    direct = Path(name)
    path = direct if direct.is_absolute() and direct.is_relative_to(root) else root / name.lstrip('/')
    path = path.resolve()
    need(path.is_relative_to(root) and path.is_file(), 'Mapped source escapes checkout or is missing')
    return path


def verify_binary_inventory(inventory):
    counts = Counter(row['sha256'] for name, row in inventory.items() if name.startswith('assets/'))
    need(dict(counts) == RECIPE['binaryAssetHashCounts'], 'Unapproved, missing or duplicated output binary asset')
    favicon = RECIPE['generatedFavicon']
    need(inventory.get('favicon.ico') == {'bytes': favicon['bytes'], 'sha256': favicon['sha256']},
         'Generated favicon differs from exact approved bytes')
    return {'hashCounts': dict(counts), 'favicon': inventory['favicon.ico']}


def verify_asset_inputs(root, tracked):
    for name, expected in RECIPE['assetInputPins'].items():
        path = source_path(root, name)
        data = path.read_bytes()
        need(digest(data) == expected, 'Approved binary input drift')
        if 'node_modules' not in path.relative_to(root).parts:
            expected_product_hash(name, data, tracked)
    return RECIPE['assetInputPins']


def expected_product_hash(name, data, tracked):
    overlay = next((x for x in RECIPE['overlays'] if x['destination'] == name), None)
    if overlay:
        need(digest(data) == overlay['sha256'], 'Authorized Task overlay drift')
    else:
        need(name in tracked and git_blob(data) == tracked[name], 'Product bytes differ from pinned Git blob')
    return digest(data)


def source_check(root):
    # The common pinned helper admits the entire clean published build projection.
    # Original local IDs remain provenance, never a pretend remotely fetched HEAD.
    import sys
    sys.path.insert(0, str(HERE.parent))
    from build_inputs import verify
    verified = verify(root, 'care')
    need(verified['originalProductCommit'] == COMMIT and verified['originalProductTree'] == TREE,
         'Original candidate provenance differs from Care recipe')
    need(re.fullmatch(r'[0-9a-f]{40}', verified['buildCommit']) is not None,
         'Missing explicit published build commit')
    need(git(root, 'rev-parse', 'HEAD').decode().strip() == verified['buildCommit'],
         'Published build HEAD differs from verified projection')
    need(not git(root, 'diff', '--name-only', 'HEAD'), 'Published checkout changed')
    tracked = {name: row['gitBlob'] for name, row in verified['files'].items()}
    for name, expected in RECIPE['sourcePins'].items():
        path = root / name
        need(path.is_file() and not path.is_symlink() and digest(path.read_bytes()) == expected,
             'Build/source pin drift')
        expected_product_hash(name, path.read_bytes(), tracked)
    for name, expected in RECIPE['recipeInputs'].items():
        need(digest((HERE / name).read_bytes()) == expected, 'Fixture/overlay recipe drift')
    provenance = {key: verified[key] for key in ['originalProductCommit', 'originalProductTree',
                  'buildCommit', 'buildTree', 'manifestSha256']}
    return tracked, provenance


def verify_maps(root, raw, inventory, tracked):
    maps = [name for name in inventory if name.endswith('.map')]
    need(maps, 'Official external source maps are required')
    merged = {}
    for name in maps:
        value = json.loads((raw / name).read_text())
        need(value.get('version') == 3 and not value.get('sourceRoot'), 'Unsupported map format/root')
        need(isinstance(value.get('mappings'), str) and value['mappings'], 'Missing mappings')
        need(len(value['sources']) == len(value['sourcesContent']), 'Incomplete map content')
        for source, content in zip(value['sources'], value['sourcesContent']):
            need(source not in merged or merged[source] == content, 'Conflicting repeated map source')
            merged[source] = content
    closure, contexts = [], []
    exported_hashes = {row['sha256'] for row in inventory.values()}
    for name, content in merged.items():
        if name in GENERATED:
            need(content is None or isinstance(content, str), 'Invalid generated source')
            closure.append({'path': name.replace('\0', 'generated:'), 'kind': 'metro-generated',
                            'sha256': None if content is None else digest(content.encode())})
            continue
        if name.startswith('/frontend/app?ctx='):
            need(isinstance(content, str), 'Missing Router context')
            targets = re.findall(r'require\("([^\"]+)"\)', content)
            need(targets, 'Empty Router context')
            relatives = []
            for target in targets:
                path = source_path(root, target)
                relative = path.relative_to(root).as_posix()
                need(path.is_relative_to(root / 'frontend/app'), 'Router context escaped app')
                expected_product_hash(relative, path.read_bytes(), tracked)
                relatives.append(relative)
            contexts.append({'kind': 'router-context', 'targets': relatives, 'sha256': digest(content.encode())})
            continue
        path = source_path(root, name)
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        dependency = 'node_modules' in path.relative_to(root).parts
        if not dependency:
            expected_product_hash(relative, data, tracked)
        if path.suffix.lower() in IMAGE:
            need(digest(data) in exported_hashes, 'Mapped asset absent from export')
            kind = 'dependency-asset' if dependency else 'product-asset'
        else:
            need(isinstance(content, str) and data == content.encode(), 'Mapped input differs from physical candidate')
            kind = 'dependency' if dependency else 'product'
        closure.append({'path': relative, 'kind': kind, 'sha256': digest(data)})
    need(len(contexts) == 1, 'Exactly one current Router context required')
    mapped = {x['path'] for x in closure if x['kind'] == 'product'}
    need(set(RECIPE['requiredMappedProduct']) <= mapped, 'Current entry/owner/Task overlay absent from maps')
    return {'maps': {name: inventory[name] for name in maps}, 'closure': closure, 'contexts': contexts}


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

def html_payload(data):
    html = data.decode()
    need(html.count('<head>') == 1 and 'Content-Security-Policy' not in html,
         'Ambiguous or pre-injected HTML')
    prepared = html.replace('<head>', '<head>' + INJECTION, 1)
    need(prepared.replace(INJECTION, '', 1) == html, 'HTML inverse differs')
    payload = ('document.write(' + json.dumps(prepared, ensure_ascii=True) + ');\n').encode()
    return payload, {'rawHtmlSha256': digest(data), 'injectedHtmlSha256': digest(prepared.encode()),
                     'payloadSha256': digest(payload), 'inverseExact': True, 'injection': INJECTION}


def strip_map(name, data, inventory):
    matches = list(re.finditer(rb'(?m)^//# sourceMappingURL=([^\r\n]+)\n?', data))
    if not matches:
        need(name + '.map' not in inventory, 'Missing official map comment')
        return data, None
    need(len(matches) == 1, 'Ambiguous map comment')
    match = matches[0]
    tail = data[match.end():]
    need(not tail or re.fullmatch(rb'//# debugId=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\n?', tail),
         'Nonterminal map comment outside official debug-id trailer')
    target = match.group(1).decode()
    need(target in {PurePosixPath(name).name + '.map', '/' + name + '.map'} and name + '.map' in inventory,
         'Map comment target mismatch')
    clean = data[:match.start()] + tail
    need(clean[:match.start()] + match.group() + clean[match.start():] == data, 'Map inverse differs')
    return clean, {'path': name, 'offset': match.start(), 'removedUtf8': match.group().decode(),
                   'rawSha256': digest(data), 'publicSha256': digest(clean), 'inverseExact': True}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []

    def handle_starttag(self, tag, attrs):
        self.refs.extend(value for key, value in attrs if key in {'src', 'href'} and value is not None)


def assemble(root, raw, out, proof):
    root, raw, out, proof = [p.resolve() for p in (root, raw, out, proof)]
    need(root.is_dir() and raw.is_dir(), 'Missing checkout/export')
    need(not out.exists() and not proof.exists(), 'Fresh output/proof required; preserve partials')
    paths = [root, raw, out, proof]
    need(all(not a.is_relative_to(b) and not b.is_relative_to(a)
             for i, a in enumerate(paths) for b in paths[i + 1:]), 'Paths overlap')
    tracked, build_provenance = source_check(root)
    inventory = files(raw)
    need(inventory and all(raw_allowed(name) for name in inventory), 'Unexpected export file')
    need(sum(x['bytes'] for x in inventory.values()) <= RECIPE['rawMaxBytes'], 'Raw budget exceeded')
    need(all(x['bytes'] <= RECIPE['rawMaxFileBytes'] for x in inventory.values()), 'Raw per-file budget exceeded')
    binary_proof = verify_binary_inventory(inventory)
    binary_proof['inputPins'] = verify_asset_inputs(root, tracked)
    routes = sorted(name[:-5] for name in inventory if name.endswith('.html'))
    need(routes == sorted(RECIPE['routeKeys']), 'Official route set changed')
    initial = [name for name in inventory if re.fullmatch(r'_expo/static/js/web/index-[0-9a-f]+\.js', name)]
    need(len(initial) == 1, 'Exactly one official initial entry required')
    closure = verify_maps(root, raw, inventory, tracked)
    entry = verify_entry(root, raw)
    public, transforms, payloads = {}, [], []
    for name in inventory:
        data = (raw / name).read_bytes()
        if name.endswith('.map'):
            continue
        if name.endswith('.html'):
            need(b'<!DOCTYPE html>' in data and b'lang="zh-Hant"' in data and initial[0].encode() in data,
                 'Unexpected official SSG HTML')
            target = 'experiments/payload/care/' + name[:-5] + '.js'
            public[target], row = html_payload(data)
            payloads.append({'route': name, 'payload': target, **row})
        else:
            if name.endswith('.js'):
                data, row = strip_map(name, data, inventory)
                if row:
                    transforms.append(row)
            public[name] = data
    need(transforms, 'No reversible map removal observed')
    public[RECIPE['fixturePublicPath']] = (HERE / 'fixtures/care.js').read_bytes()
    need(sum(len(x) for x in public.values()) <= RECIPE['publicMaxBytes'], 'Public budget exceeded')
    need(all(len(x) <= RECIPE['publicMaxFileBytes'] for x in public.values()), 'Public per-file budget exceeded')
    for name, data in public.items():
        safe_public(name, data)
    references = 0
    for name in inventory:
        if not name.endswith('.html'):
            continue
        parser = Links()
        parser.feed((raw / name).read_text())
        for ref in parser.refs:
            if ref.startswith(('data:', '#')):
                continue
            url = urlsplit(urljoin('https://preview.example.invalid/' + name, ref))
            need(url.scheme == 'https' and url.netloc == 'preview.example.invalid', 'External HTML reference')
            target = unquote(url.path).lstrip('/')
            need(target in public or target in inventory or target + '.html' in inventory or target == '',
                 'Missing local HTML reference')
            references += 1
    need(files(raw) == inventory, 'Raw export changed during adaptation')
    need(source_check(root) == (tracked, build_provenance), 'Source changed during adaptation')
    result = {'format': 'care-preview-contribution-v1', 'status': 'STATIC_CANDIDATE_ONLY_NOT_BROWSER_ACCEPTED',
              'sourceCommit': COMMIT, 'sourceTree': TREE, 'sourceOverlay': RECIPE['overlays'],
              'publishedBuild': build_provenance, 'overlayAppliedByAdapter': False,
              'taskTestDisposition': 'Pinned recipe-only; not installed or executed remotely',
              'sourcePins': RECIPE['sourcePins'], 'lockSha256': RECIPE['lockSha256'],
              'fixtureSha256': RECIPE['fixtureSha256'], 'fixturePublicPath': RECIPE['fixturePublicPath'],
              'variant': 'care', 'entryUrl': '/?experiment=care&previewScenario=core-journeys',
              'raw': inventory, 'mapClosure': closure, 'entryModuleProof': entry,
              'binaryAssets': binary_proof,
              'mapRemoval': transforms, 'payloads': payloads, 'localHtmlReferences': references,
              'contributionOnly': True, 'sharedDispatcherAndWrappers': 'Unchanged common scaffold supplied by assembly',
              'historicalR7CoversTaskOverlay': False, 'nativeBrowser': 'NOT_RUN', 'publication': 'NOT_RUN',
              'remainingGates': RECIPE['remainingGates'], 'publicationAuthorizedByThisScript': False}
    # Scan before writing so a private build path cannot slip into the receipt.
    need(not PRIVATE.search(json.dumps(result).encode()), 'Private material in adapter proof')
    out.mkdir(parents=True)
    for name, data in sorted(public.items()):
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        need(target.read_bytes() == data, 'Output write readback differs')
    result['public'] = files(out)
    proof.parent.mkdir(parents=True, exist_ok=True)
    with proof.open('x') as output:
        output.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'files': len(public), 'routes': len(routes),
                      'proofSha256': digest(proof.read_bytes())}))


def main():
    parser = argparse.ArgumentParser()
    for key in ['source', 'raw', 'out', 'proof']:
        parser.add_argument('--' + key, type=Path, required=True)
    args = parser.parse_args()
    assemble(args.source, args.raw, args.out, args.proof)


if __name__ == '__main__':
    main()
