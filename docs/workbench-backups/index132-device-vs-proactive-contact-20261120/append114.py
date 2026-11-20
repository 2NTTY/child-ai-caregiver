#!/usr/bin/env python3
"""Append comparison #114; preserve all existing archive records and runtime."""
import hashlib
import json
from pathlib import Path
import re
import sys

BASE = '10d7b4f77053c046bcf890adc189dd7709ec3785766e22537e9c77560a9178be'
PREVIOUS = '準備單改成「帶兩盒彩筆」，昨天打的勾還算嗎？'
digest = lambda data: hashlib.sha256(data).hexdigest()

def assemble(data, spec):
    if digest(data) != BASE:
        raise ValueError('Unexpected #113 baseline')
    html = data.decode()
    m, = re.finditer(r'<script type="application/json" id="records">(.*?)</script>', html, re.S)
    raw = m[1]
    prior = json.loads(raw)
    g = spec['group']
    assert len(prior['groups']) == 113 and len(g['choices']) == 2
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
    marker = f'<button type="button" data-latest="112">第 113 頁：{PREVIOUS}</button>'
    count = '全部 133 款只提供外部參考；合計 229 款可選，離線圖片共 165 張。'
    assert markup.count(marker) == markup.count(count) == 1 and markup.count('113 個主題') == 3
    markup = markup.replace(marker, marker+f'<button type="button" data-latest="113">第 114 頁：{title}</button>')
    markup = markup.replace('113 個主題', '114 個主題').replace(count, '全部 135 款只提供外部參考；合計 231 款可選，離線圖片共 165 張。')
    output = (markup + result + html[m.end(1):]).encode()
    if spec.get('expectedSha256') and digest(output) != spec['expectedSha256']:
        raise ValueError('Unexpected #114 output')
    return output

if __name__ == '__main__':
    src, spec, output = map(Path, sys.argv[1:])
    bs = assemble(src.read_bytes(), json.loads(spec.read_bytes()))
    with output.open('xb') as f:
        f.write(bs)
    print(len(bs), digest(bs))
