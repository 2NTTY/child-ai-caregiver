"""Verify this experiment's raw Expo export against its frozen local sources.
No browser, network, model, or runtime fixture is executed.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

repo = Path(__file__).resolve().parents[3]
raw = Path(sys.argv[1]).resolve()
receipt = Path(__file__).with_name('artifact-verification.json')
freeze_path = Path(__file__).with_name('product-source-freeze.json')
freeze = json.loads(freeze_path.read_text())['files']
sha = lambda data: hashlib.sha256(data).hexdigest()
for name, digest in freeze.items():
    assert sha((repo / name).read_bytes()) == digest, f'Source drift: {name}'
maps = list(raw.rglob('*.js.map'))
assert len(maps) == 1, f'Expected one web source map, got {len(maps)}'
source_map = json.loads(maps[0].read_text())
matched = {}
for source, content in zip(source_map['sources'], source_map['sourcesContent'], strict=True):
    name = source.lstrip('/')
    if not name.startswith(('frontend/src/', 'frontend/app/', 'src/')) and name != 'frontend/index.js':
        continue
    assert name in freeze, f'Unfrozen first-party source: {name}'
    assert content is not None, f'Missing source content: {name}'
    digest = sha(content.encode())
    assert digest == freeze[name], f'Artifact/source mismatch: {name}'
    matched[name] = digest
for name in ['frontend/src/components/HomeWelcome.tsx', 'frontend/src/components/HomeAgentImportant.tsx',
             'frontend/src/components/navigation/MoreNavButton.tsx', 'frontend/src/screens/moreScreen.tsx',
             'frontend/src/startup/imageReadiness.ts', 'frontend/src/components/AppShell.tsx',
             'frontend/app/(dashboard)/_layout.tsx', 'frontend/src/production/ProductionProvider.tsx',
             'frontend/src/preview/PreviewNavigationGuard.tsx', 'frontend/src/components/HomeFocus.tsx',
             'frontend/src/components/HomeGuideCallout.tsx', 'frontend/src/components/HomeOngoing.tsx',
             'frontend/src/components/HomeOverviewItems.tsx', 'frontend/src/components/HomeQuickActions.tsx',
             'frontend/src/components/workspace/HomeWorkspace.tsx', 'frontend/src/components/navigation/app-navigation.ts',
             'frontend/src/components/navigation/quick-input-gesture.ts']:
    assert name in matched, f'Required real product module absent: {name}'
assert not any('RecordsNavButton' in source for source in source_map['sources'])
assert len(matched) >= 400, f'Unexpectedly incomplete first-party map: {len(matched)}'
files = {str(p.relative_to(raw)): {'sha256': sha(p.read_bytes()), 'bytes': p.stat().st_size}
         for p in sorted(raw.rglob('*')) if p.is_file()}
html = [name for name in files if name.endswith('.html')]
for name in html:
    roots = re.findall(r'<html\b[^>]*>', (raw / name).read_text(), re.I)
    assert len(roots) == 1 and re.search(r'\blang="zh-Hant"', roots[0]), f'Wrong document language: {name}'
assert 'frontend/app/+html.tsx' in freeze  # Server-only document; not a client map module.
assert 'frontend/src/components/OperationNotice.tsx' in matched
for route in ['', 'chat', 'care', 'tasks', 'growth', 'summary', 'profile', 'photos', 'sources', 'memory',
              'history', 'family', 'contact', 'settings', 'guide', 'more', 'login', 'admin']:
    options = ['index.html'] if not route else [route + '.html', route + '/index.html']
    assert any(option in files for option in options), f'Missing route: {route}'
result = {'status': 'passed', 'sourceFreezeSha256': sha(freeze_path.read_bytes()),
          'frozenSourceFiles': len(freeze), 'mappedFirstPartyFiles': len(matched),
          'htmlDocuments': len(html), 'rawExport': str(raw), 'sourceMap': str(maps[0].relative_to(raw)),
          'sourceMatches': matched, 'artifacts': files,
          'limits': ['Raw local export includes a private verification source map; not a publication package.',
                     'No browser or native-device evidence. No live backend or model calls.']}
receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: result[k] for k in ['status', 'frozenSourceFiles', 'mappedFirstPartyFiles', 'htmlDocuments', 'sourceFreezeSha256']}))
