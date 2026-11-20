#!/usr/bin/env python3
"""Build an additive, reproducible Workbench 110 archive, from pinned references."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import sys
from PIL import Image

BASE = '3355a65908afeb00a1a77c16785ef1d048ac2363d937b97768f40b154f3b8b8a'
TITLE109 = '週二安排的待辦，週五才回報完成：要從哪一天找？'
IMAGES = {'png': 'PNG', 'jpeg': 'JPEG', 'webp': 'WEBP'}
dumps = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
hash256 = lambda v: hashlib.sha256(v).hexdigest()
gitblob = lambda v: hashlib.sha1(f'blob {len(v)}\0'.encode()+v).hexdigest()

def assemble(baseline: bytes, spec: dict, assets: Path) -> bytes:
    if hash256(baseline) != BASE:
        raise ValueError('Unexpected baseline #109')
    s = baseline.decode('utf-8')
    m, = list(re.finditer(r'<script type="application/json" id="records">(.*?)</script>', s, re.S))
    raw = m[1]
    prior = json.loads(raw)
    g = spec['group']
    assert len(prior['groups']) == 109 and len(g['choices']) == 2
    assert not any(k['id'] == g['id'] or k['title'] == g['title'] for k in prior['groups'])
    assert len({c['name'] for c in g['choices']}) == 2
    found_sources = set()
    nimages = ext = 0
    for choice in g['choices']:
        assert choice['source'].startswith('https://') and choice['source'] not in found_sources
        found_sources.add(choice['source'])
        assert choice['sourceNotes'] and choice['version'] and choice['rights']
        assert bool(choice['externalOnly']) != bool(choice['images'])
        ext += bool(choice['externalOnly'])
        for image in choice['images']:
            path = assets / image.pop('file')
            data = path.read_bytes()
            mime = image.pop('mime')
            assert hash256(data) == image['sha256']
            if image.get('gitBlob'):
                assert gitblob(data) == image['gitBlob']
            elif image.get('gitLfsSha256'):
                assert image['gitLfsSha256'] == image['sha256']
            elif image.get('officialImageUrl'):
                assert image['officialImageUrl'].startswith('https://')
                assert image['officialImageUrl'] in {n['url'] for n in choice['sourceNotes']}
            else:
                pdf = image.pop('sourceFile')
                assert hash256((assets / pdf).read_bytes()) == image['sourcePdfSha256']
            with Image.open(io.BytesIO(data)) as inspected:
                assert inspected.size == (image['width'], image['height']) and inspected.format == IMAGES[mime]
                inspected.verify()
            image['data'] = f'data:image/{mime};base64,' + base64.b64encode(data).decode('ascii')
            nimages += 1
    extra = {}
    for item in spec['notices']:
        notice = (assets / item['file']).read_bytes()
        if 'gitBlob' in item:
            assert gitblob(notice) == item['gitBlob']
        else:
            assert hash256(notice) == item['sha256']
        k = hash256(notice)
        t = notice.decode('utf-8')
        if k in prior['notices']:
            assert prior['notices'][k] == t
        else:
            extra[k] = t
        g['notices'].append({'name': item['name'], 'key': k})
    anchor = '],"notices":{'
    assert raw.count(anchor) == 1
    group = dumps(g)
    extras = dumps(extra)
    assert '</script' not in (group+extras).lower()
    result = raw.replace(anchor, ','+group+anchor+(extras[1:-1]+',' if extra else ''), 1)
    assert json.loads(result) == dict(prior, groups=prior['groups'] + [g], notices={**prior['notices'], **extra})
    markup = s[:m.start(1)]
    title = g['title']
    assert not any(ch in title for ch in '<>&')
    marker = f'<button type="button" data-latest="108">第 109 頁：{TITLE109}</button>'
    count = '全部 125 款只提供外部參考；合計 221 款可選，離線圖片共 165 張。'
    assert markup.count(marker) == 1 and markup.count('109 個主題') == 3 and markup.count(count) == 1
    markup = markup.replace(marker, marker+f'<button type="button" data-latest="109">第 110 頁：{title}</button>')
    markup = markup.replace('109 個主題','110 個主題').replace(count,f'全部 {125+ext} 款只提供外部參考；合計 223 款可選，離線圖片共 {165+nimages} 張。')
    return (markup + result + s[m.end(1):]).encode('utf-8')

if __name__ == '__main__':
    src, spec, output = map(Path, sys.argv[1:])
    bs = assemble(src.read_bytes(), json.loads(spec.read_bytes()), spec.parent)
    # Standalone remains intact; the private ZIP transport has its own strict size gate.
    wanted = json.loads(spec.read_bytes()).get('expectedSha256')
    if wanted and hash256(bs) != wanted:
        raise ValueError('Rebuilt candidate differs from verified #110; no output written')
    with output.open('xb') as f:
        f.write(bs)
    print(len(bs), hash256(bs))
