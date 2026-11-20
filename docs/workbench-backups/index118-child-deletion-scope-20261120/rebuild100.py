#!/usr/bin/env python3
# Rebuild the exact #100 HTML using the unchanged #99 baseline and both pinned original images.
# Inputs in order: baseline99.html Docker.png Warehouse.png Docker-LICENSE Warehouse-LICENSE target100.html
import base64, hashlib, json, re, sys
from pathlib import Path
BASE='1b2e20410416d2845ca021febab2192b397a03e44509114e21481fb69c7a525c'
TARGET='165e8c5e148d4d2d0ee385059c99b1d79f7f8de20571cc5281bffb67552642f1'
GROUP={'id': 'child-profile-vs-child-deletion-scope', 'title': '刪除孩子檔案，還是刪除整位孩子？', 'index': 'embedded-comparison', 'readerNote': '在育伴港，刪檔案會連同其更正歷史刪除，孩子及照顧記錄仍在。刪除整位孩子影響孩子及其關聯資料，須另行核對。兩張原圖都是其他產品借來比較層級；不代表育伴港可復原、提供保留子項選擇或已執行刪除。', 'choices': [{'name': '刪除範圍-01｜每個操作各寫清會移除甚麼', 'note': 'Docker 將清除磁碟資料、重設設定與資料、解除安裝分成幾列，各有說明和按鈕。原圖不顯示確認或處理結果；不要把重設讀成只刪資料而保留所有設定。', 'source': 'https://github.com/docker/docs/blob/aaa4fb6225077bd526831f9b8572f40cebb6632c/docker-for-mac/images/menu/troubleshoot.png', 'sourceNotes': [{'label': '原作者固定文件與畫面位置', 'url': 'https://github.com/docker/docs/blob/aaa4fb6225077bd526831f9b8572f40cebb6632c/docker-for-mac/troubleshoot.md#L13-L33'}, {'label': 'Docker 文件署名', 'url': 'https://github.com/docker/docs/blob/aaa4fb6225077bd526831f9b8572f40cebb6632c/README.md#L448-L448'}, {'label': 'Docker 原版 Apache 2.0 條款', 'url': 'https://github.com/docker/docs/blob/aaa4fb6225077bd526831f9b8572f40cebb6632c/LICENSE'}, {'label': '育伴港：刪除檔案及更正歷史', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/profile/ProfileView.tsx#L86-L96'}, {'label': '育伴港：刪除整位孩子前核對', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/DeleteChildDialog.tsx#L29-L60'}], 'version': 'Docker Desktop for Mac 官方文件修訂 aaa4fb6225077bd526831f9b8572f40cebb6632c（2020-03-25），並非現行版本；圖中未標軟件 build。', 'rights': 'Copyright 2017 Docker, Inc.；官方文件 Apache 2.0，原圖未改。不表示 Docker 背書。', 'externalOnly': False, 'images': [{'short': 'Docker 官方原圖：Troubleshoot 完整視窗', 'label': 'Docker 官方原圖：Troubleshoot 完整視窗', 'width': 1044, 'height': 616, 'sha256': 'ba30dfbbc20ba10cfd295256501fc4bd24a93e2edad17b4fee71974aa33be405', 'gitBlob': 'c986f1f3059a1ce160fa4b2f84c784b671d32791'}]}, {'name': '刪除範圍-02｜把移除對象和清理資料放在不同層級', 'note': 'Warehouse 在應用名稱下方顯示 Uninstall；User Data 一列另有垃圾桶圖示。只清資料不解除安裝；解除安裝時是否保留資料另行選擇，畫面沒展示那個對話框。這裡的垃圾桶不代表育伴港的刪除可復原。', 'source': 'https://github.com/flattool/warehouse/blob/61e48a3bcd060970ac769e5e4e2e72290acc9f7a/app_page_screeshots/propteries_page_skinny.png', 'sourceNotes': [{'label': '原作者登錄完整窄窗原圖', 'url': 'https://github.com/flattool/warehouse/blob/61e48a3bcd060970ac769e5e4e2e72290acc9f7a/data/io.github.flattool.Warehouse.metainfo.xml.in#L43-L51'}, {'label': '同版垃圾桶按鈕及作用', 'url': 'https://github.com/flattool/warehouse/blob/61e48a3bcd060970ac769e5e4e2e72290acc9f7a/src/properties_page/properties_page.blp#L84-L132'}, {'label': '同版清理資料確認', 'url': 'https://github.com/flattool/warehouse/blob/61e48a3bcd060970ac769e5e4e2e72290acc9f7a/src/properties_page/properties_page.py#L163-L194'}, {'label': '同版解除安裝保留資料選項', 'url': 'https://github.com/flattool/warehouse/blob/61e48a3bcd060970ac769e5e4e2e72290acc9f7a/src/packages_page/uninstall_dialog.blp#L5-L24'}, {'label': 'Warehouse 原版 GPL-3.0 條款', 'url': 'https://github.com/flattool/warehouse/blob/61e48a3bcd060970ac769e5e4e2e72290acc9f7a/LICENSE'}, {'label': '圖中 Eyedropper 圖示及署名', 'url': 'https://github.com/FineFindus/eyedropper/blob/96409ee7bc2e5a57c5154733cec1987fb797321f/src/widgets/about_window.rs#L9-L17'}, {'label': '育伴港：刪除檔案及更正歷史', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/profile/ProfileView.tsx#L86-L96'}, {'label': '育伴港：刪除整位孩子前核對', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/DeleteChildDialog.tsx#L29-L60'}], 'version': 'Warehouse 固定提交 61e48a3bcd060970ac769e5e4e2e72290acc9f7a（2024-10-28）；2.0.1 是畫面上被管理的 Eyedropper，不是 Warehouse 版號。', 'rights': 'Warehouse / Flattool contributors，© 2023 Heliguy，GPL-3.0-only；圖示 Eyedropper © 2022–2023 FineFindus，bertob／Brage Fuglseth。完整上游截圖未改，沒有匯入應用程式。', 'externalOnly': False, 'images': [{'short': 'Warehouse 官方原圖：窄窗應用屬性，解除安裝與使用者資料操作分列', 'label': 'Warehouse 官方原圖：窄窗應用屬性，解除安裝與使用者資料操作分列', 'width': 525, 'height': 713, 'sha256': '090e465fa70f03bb0620f785540108e53bd55bc047ab629b3a7dd79318718caa', 'gitBlob': '00cf2732a8719bf059ca6de54115bd674217d2ab'}]}], 'notices': [{'name': '100A｜Docker 原版 Apache 2.0 條款', 'key': '089009c932d3cc296355e429fa9d6faf80ac89597da866e2424b4ea09add64b1'}, {'name': '100B｜Warehouse 原版 GPL-3.0 條款', 'key': '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'}]}
def digest(blob):
    return hashlib.sha256(blob).hexdigest()

def main(argv):
    if len(argv)!=6:
        raise SystemExit("Usage: python3 rebuild100.py BASELINE_99 DOCKER_PNG WAREHOUSE_PNG DOCKER_LICENSE WAREHOUSE_LICENSE OUTPUT")
    base, a, b, la, lb, output=map(Path,argv)
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
    current=json.loads(payload)
    extra={}
    for note, path in zip(GROUP["notices"], (la,lb)):
        material=path.read_bytes()
        key=note["key"]
        if digest(material)!=key:
            raise ValueError("Wrong original license; no output written")
        if key not in current["notices"]:
            extra[key]=material.decode()
    suffix=json.dumps(extra,ensure_ascii=False,separators=(',',':'))[1:-1]+',' if extra else ''
    combined=payload.replace(anchor,','+json.dumps(GROUP,ensure_ascii=False,separators=(',',':'))+anchor+suffix,1)
    source=source[:m.start(1)]+combined+source[m.end(1):]
    last='<button type="button" data-latest="98">第 99 頁：減少動畫：裝置設定和 App 選項有甚麼分別？</button>'
    source=source.replace(last,last+'<button type="button" data-latest="99">第 100 頁：'+GROUP["title"]+'</button>')
    source=source.replace('99 個主題','100 個主題')
    source=source.replace('合計 201 款可選，離線圖片共 156 張。','合計 203 款可選，離線圖片共 158 張。')
    final=source.encode("utf-8")
    if digest(final)!=TARGET:
        raise ValueError("Reconstruction differs from the checked release; no output written")
    with output.open("xb") as f:
        f.write(final)
    print(TARGET)

if __name__=="__main__":
    main(sys.argv[1:])
