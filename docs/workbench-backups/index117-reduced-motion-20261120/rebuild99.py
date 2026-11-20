#!/usr/bin/env python3
# Rebuild the exact #99 HTML using the unchanged #98 baseline and both pinned original images.
# Inputs in order: baseline98.html Elementary.png Zeron.png target99.html
import base64, hashlib, json, re, sys
from pathlib import Path
BASE='e9de4d56ba052f1fee0b4eccaae59ca8eaba667192b87d800aab41c2ab3b7710'
TARGET='1b2e20410416d2845ca021febab2192b397a03e44509114e21481fb69c7a525c'
GROUP={'id': 'reduce-motion-preference-system-and-app', 'title': '減少動畫：裝置設定和 App 選項有甚麼分別？', 'index': 'embedded-comparison', 'readerNote': '99A 是裝置的開關；99B 是 App 內的選擇，並列出目前系統是否允許動畫。兩張都不是育伴港畫面。育伴港會優先跟隨系統：系統已要求減少動畫時，站內不能開回動畫；關掉個人減動偏好只是回到跟隨系統。兩款原圖都沒有展示育伴港的鎖定狀態。', 'choices': [{'name': '動態偏好-01｜在系統設定寫清影響範圍', 'note': 'elementary OS 的 Appearance 頁把 Reduce Motion 和顏色等項目分開，並說明影響視窗管理員和部分介面元素。原圖開關是關閉，不是灰掉不能操作。不能從這張圖推斷所有 App 都會跟隨。', 'source': 'https://github.com/elementary-Inc/blog/blob/4a8b85e7df2eacf6bfbb231934f587856ecc5095/images/updates-for-april-2023/settings-appearance.png', 'sourceNotes': [{'label': '原作者固定發布文與畫面說明', 'url': 'https://github.com/elementary-Inc/blog/blob/4a8b85e7df2eacf6bfbb231934f587856ecc5095/_posts/2023/2023-05-05-updates-for-april-2023.md#L34-L44'}, {'label': '原始發布頁', 'url': 'https://blog.elementary.io/updates-for-april-2023/'}, {'label': '發布頁的固定 CC BY-SA 4.0 聲明', 'url': 'https://github.com/elementary-Inc/blog/blob/4a8b85e7df2eacf6bfbb231934f587856ecc5095/_includes/license.html#L1-L5'}, {'label': 'CC BY-SA 4.0 許可', 'url': 'https://creativecommons.org/licenses/by-sa/4.0/'}, {'label': '育伴港：系統優先與站內偏好', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/appearance/MotionSettings.tsx#L11-L31'}], 'version': 'elementary OS 7，2023-05-05 發布文；固定提交 4a8b85e7df2eacf6bfbb231934f587856ecc5095，原圖未標 build。', 'rights': 'Danielle Foré / elementary, Inc.，New features and settings, improved performance, and fewer bugs（2023-05-05）。原圖未改，CC BY-SA 4.0；以原授權收錄一張獨立參考圖，不代表背書。', 'externalOnly': False, 'images': [{'short': 'elementary OS 7 原圖：系統外觀設定', 'label': 'elementary OS 7 原圖：完整外觀設定，Reduce Motion 關閉。', 'width': 2202, 'height': 1538, 'sha256': 'c12c503314f70e22bb43f1e7ae079fce010f60837e739ebb71b924b386426afc', 'gitBlob': 'df739ffb00d3b0ee86f029fa9bc9e52b5f2ca336'}]}, {'name': '動態偏好-02｜站內列出目前跟隨哪個設定', 'note': 'Zeron 在 Appearance 的 Motion 區把選單設為 System，並在選單旁解釋目前系統允許動畫。下方另有平滑捲動等選項。這張圖沒有顯示系統要求減動時的鎖定，也不替育伴港決定哪些項目受影響。', 'source': 'https://github.com/zeronsh/zeron/blob/3d2f1e64af3b40ec1354ca199fbe439c666f3681/docs/media/smooth-scroll/settings-light.png', 'sourceNotes': [{'label': '原作者合併說明及擷取方法', 'url': 'https://github.com/zeronsh/zeron/pull/1005'}, {'label': '上游同版 MIT 授權', 'url': 'https://github.com/zeronsh/zeron/blob/3d2f1e64af3b40ec1354ca199fbe439c666f3681/LICENSE'}, {'label': '同版開啟減動的局部示例（不是另一個完整頁）', 'url': 'https://github.com/zeronsh/zeron/blob/3d2f1e64af3b40ec1354ca199fbe439c666f3681/docs/media/smooth-scroll/settings-reduced-motion.png'}, {'label': '育伴港：系統優先與站內偏好', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/appearance/MotionSettings.tsx#L11-L31'}], 'version': 'Zeron 原作者實際視窗，固定提交 3d2f1e64af3b40ec1354ca199fbe439c666f3681；不是育伴港或此次實機重跑。', 'rights': 'Zeron／Copyright (c) 2026 Wing，MIT。原作者文件原圖未改；附上游原版 MIT 條款。', 'externalOnly': False, 'images': [{'short': 'Zeron 原圖：跟隨系統的站內動態設定', 'label': 'Zeron 外觀頁完整視窗：Motion 選 System，文字顯示目前系統允許動畫。', 'width': 2000, 'height': 1440, 'sha256': '5cd7f91aef60d4c988016c86a46497717a2b376337679182947782eb690b3846', 'gitBlob': '589977aea9df2edd48eb0c2e7feec1f92def6fcd'}]}], 'notices': [{'name': '99B｜Zeron 原版 MIT 條款', 'key': 'e776600f641baae3fd37387829b40fe2d7c12d01785dc8b846658b7cbb0342e3'}]}
NOTICE='MIT License\n\nCopyright (c) 2026 Wing\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n'
def digest(blob):
    return hashlib.sha256(blob).hexdigest()

def main(argv):
    if len(argv)!=4:
        raise SystemExit("Usage: python3 rebuild99.py BASELINE_98 ELEMENTARY_PNG ZERON_PNG OUTPUT")
    base, a, b, output=map(Path,argv)
    raw=base.read_bytes()
    if digest(raw)!=BASE:
        raise ValueError("Wrong baseline; no output written")
    for choice, path, mime in zip(GROUP["choices"], (a,b), ("png","png")):
        image,=choice["images"]
        blob=path.read_bytes()
        if digest(blob)!=image["sha256"]:
            raise ValueError("Wrong upstream image; no output written")
        image["data"]="data:image/"+mime+";base64,"+base64.b64encode(blob).decode()
    source=raw.decode("utf-8")
    m=re.search(r'<script type="application/json" id="records">(.*?)</script>',source,re.S)
    payload=m[1]
    anchor='],"notices":{'
    assert payload.count(anchor)==1
    combined=payload.replace(anchor,','+json.dumps(GROUP,ensure_ascii=False,separators=(',',':'))+anchor+json.dumps(GROUP['notices'][0]['key'])+':'+json.dumps(NOTICE,ensure_ascii=False)+',',1)
    source=source[:m.start(1)]+combined+source[m.end(1):]
    last='<button type="button" data-latest="97">第 98 頁：手動記錄餵奶量：填一個奶量，還是分開記準備和喝下？</button>'
    source=source.replace(last,last+'<button type="button" data-latest="98">第 99 頁：'+GROUP["title"]+'</button>')
    source=source.replace('98 個主題','99 個主題')
    source=source.replace('合計 199 款可選，離線圖片共 154 張。','合計 201 款可選，離線圖片共 156 張。')
    final=source.encode("utf-8")
    if digest(final)!=TARGET:
        raise ValueError("Reconstruction differs from the checked release; no output written")
    with output.open("xb") as f:
        f.write(final)
    print(TARGET)

if __name__=="__main__":
    main(sys.argv[1:])
