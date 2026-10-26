"""Package already-verified raw export using the unchanged, reviewed v4 boundary.

No browser, server, network or product runtime is started. Raw maps remain private.
Refuses to overwrite either intermediate or final artifact directories.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

raw, mapfree, safe, boundary = (Path(value).resolve() for value in sys.argv[1:])
evidence = Path(__file__).parent
sha = lambda data: hashlib.sha256(data).hexdigest()
expected_fixture = 'e3fc5b9af380991f25434cd8dae4430ed01f34a71b1dbacac9a84d6d9b67358d'
assert not mapfree.exists() and not safe.exists(), 'Refuse to overwrite an artifact'
assert len({raw, mapfree, safe}) == 3
receipt = json.loads((evidence / 'artifact-verification.json').read_text())
assert receipt['status'] == 'passed' and receipt['rawExport'] == str(raw)
assert sha((boundary / 'preview-fixture.js').read_bytes()) == expected_fixture
raw_files = {str(path.relative_to(raw)): path for path in raw.rglob('*') if path.is_file()}
assert not any(path.is_symlink() for path in raw.rglob('*')), 'Symlink in export'
assert set(raw_files) == set(receipt['artifacts'])
for name, path in raw_files.items():
    assert sha(path.read_bytes()) == receipt['artifacts'][name]['sha256'], name

mapfree.mkdir()
removed_maps, stripped_comments = [], {}
for name, path in sorted(raw_files.items()):
    if name.endswith('.map'):
        removed_maps.append(name)
        continue
    data = path.read_bytes()
    if path.suffix == '.js' and b'sourceMappingURL=' in data:
        # Expo emits one trailing map directive, optionally before a debugId.
        # Preserve the debugId and all product bytes; remove only that line.
        match = re.search(rb'(?m)^//# sourceMappingURL=[^\r\n]+(?:\r?\n|$)', data)
        assert match and data.count(b'sourceMappingURL=') == 1, name
        assert re.fullmatch(rb'(?://# debugId=[a-f0-9-]+(?:\r?\n)?)?', data[match.end():]), name
        stripped_comments[name] = {'offset': match.start(), 'comment': match.group().decode()}
        data = data[:match.start()] + data[match.end():]
        assert data[:match.start()] + match.group() + data[match.start():] == path.read_bytes()
    target = mapfree / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
assert len(removed_maps) == 1 and len(stripped_comments) == 1
subprocess.run(['node', str(boundary / 'install-preview.mjs'), str(mapfree), str(safe)], check=True)

manifest_path = safe / '__preview/artifact-manifest.json'
manifest = json.loads(manifest_path.read_text())
assert manifest['fixtureSha256'] == expected_fixture
assert sha((safe / '__preview/preview-fixture.js').read_bytes()) == expected_fixture
assert manifest['htmlCount'] == receipt['htmlDocuments'] == 36
assert len(manifest['requiredRoutes']) == 18
injection = None
for name in raw_files:
    if name.endswith('.map'):
        assert not (safe / name).exists()
        continue
    original, packaged = (mapfree / name).read_bytes(), (safe / name).read_bytes()
    if name.endswith('.html'):
        pattern = rb'(<head(?:\s[^>]*)?>)(<meta http-equiv="Content-Security-Policy"[^>]+><meta name="referrer"[^>]+><meta name="harbour-preview-contracts"[^>]+><script src="/__preview/preview-fixture.js"></script>)'
        matches = list(re.finditer(pattern, packaged, re.I))
        assert len(matches) == 1, name
        candidate = matches[0].group(2)
        if injection is None:
            injection = candidate
        assert candidate == injection and b"connect-src 'none'" in candidate
        assert packaged.replace(candidate, b'', 1) == original, name
    else:
        assert original == packaged, name
for item in manifest['files']:
    assert sha((safe / item['file']).read_bytes()) == item['sha256']
safe_files = {str(path.relative_to(safe)): {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
              for path in sorted(safe.rglob('*')) if path.is_file()}
assert set(safe_files) == {item['file'] for item in manifest['files']} | {'__preview/artifact-manifest.json'}
assert not any(name.endswith('.map') for name in safe_files)
assert not any(b'sourceMappingURL=' in (safe / name).read_bytes() for name in safe_files if name.endswith(('.js', '.html')))
result = {
    'status': 'passed', 'rawPrivateExport': str(raw), 'mapFreeExport': str(mapfree), 'safePackage': str(safe),
    'sourceFreezeSha256': receipt['sourceFreezeSha256'],
    'rawEvidenceSha256': sha((evidence / 'artifact-verification.json').read_bytes()),
    'fixtureSha256': expected_fixture,
    'installerSha256': sha((boundary / 'install-preview.mjs').read_bytes()),
    'publicManifestSha256': sha(manifest_path.read_bytes()),
    'removedPrivateMaps': removed_maps, 'reversibleBundleCommentsRemoved': stripped_comments,
    'htmlDocuments': manifest['htmlCount'], 'requiredRoutes': manifest['requiredRoutes'], 'files': safe_files,
    'limits': ['Packaging/static integrity only; browser acceptance remains pending.',
               'Uses exact reviewed v4 fictional data boundary; no new fixture behavior.',
               'Raw source maps are private evidence and must not be published.'],
}
(evidence / 'safe-package-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: result[key] for key in ('status', 'safePackage', 'fixtureSha256', 'publicManifestSha256', 'htmlDocuments')}, ensure_ascii=False))
