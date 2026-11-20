#!/usr/bin/env python3
"""Append comparison #121; preserve all existing archive records and runtime."""
import hashlib
import json
from pathlib import Path
import re
import sys

BASE = 'd354e5c4c1a613889f408e305e55e730598820a4e30627851f1783ba9d26a83b'
PREVIOUS = '刪掉一條舊記憶後，為甚麼昨天的助手回答還看得到？'
digest = lambda data: hashlib.sha256(data).hexdigest()

def assemble(data, spec):
    if digest(data) != BASE:
        raise ValueError('Unexpected #120 baseline')
    html = data.decode()
    m, = re.finditer(r'<script type="application/json" id="records">(.*?)</script>', html, re.S)
    raw = m[1]
    prior = json.loads(raw)
    g = spec['group']
    assert len(prior['groups']) == 120 and len(g['choices']) == 2
    assert g['index'] == 'external-comparison' and not g['notices'] and not spec['notices']
    assert all(g['id'] != old['id'] and g['title'] != old['title'] for old in prior['groups'])
    assert len({c['source'] for c in g['choices']}) == len({c['name'] for c in g['choices']}) == 2
    for c in g['choices']:
        assert c['externalOnly'] is True and c['images'] == []
        assert c['source'].startswith('https://') and c['sourceNotes'] and c['version'] and c['rights']
    enc = json.dumps(g, ensure_ascii=False, separators=(',', ':'))
    anchor = '],"notices":{'
    assert raw.count(anchor) == 1 and '</script' not in enc.lower()
    result = raw.replace(anchor, ',' + enc + anchor)
    assert json.loads(result) == dict(prior, groups=prior['groups'] + [g])
    markup = html[:m.start(1)]
    title = g['title']
    assert not any(ch in title for ch in '<>&')
    marker = f'<button type="button" data-latest="119">第 120 頁：{PREVIOUS}</button>'
    count = '全部 147 款只提供外部參考；合計 243 款可選，離線圖片共 165 張。'
    assert markup.count(marker) == markup.count(count) == 1 and markup.count('120 個主題') == 3
    markup = markup.replace(marker, marker+f'<button type="button" data-latest="120">第 121 頁：{title}</button>')
    markup = markup.replace('120 個主題', '121 個主題').replace(count, '全部 149 款只提供外部參考；合計 245 款可選，離線圖片共 165 張。')
    output = (markup + result + html[m.end(1):]).encode()
    if spec.get('expectedSha256') and digest(output) != spec['expectedSha256']:
        raise ValueError('Unexpected #121 output')
    return output

if __name__ == '__main__':
    src, spec, output = map(Path, sys.argv[1:])
    bs = assemble(src.read_bytes(), json.loads(spec.read_bytes()))
    with output.open('xb') as f:
        f.write(bs)
    print(len(bs), digest(bs))
