#!/usr/bin/env python3
# Rebuild the exact #98 HTML using the unchanged #97 baseline and both pinned original images.
# Inputs in order: baseline97.html BabyRecord.jpg Lotties.webp target98.html
import base64, hashlib, json, re, sys
from pathlib import Path
BASE='c38ca7d014e6f84c88a82ac211f33fc1eec2f8e589af6d39e14ced9dbcd877c9'
TARGET='e9de4d56ba052f1fee0b4eccaae59ca8eaba667192b87d800aab41c2ab3b7710'
GROUP={'id': 'manual-feeding-single-quantity-prepared-drunk', 'title': '手動記錄餵奶量：填一個奶量，還是分開記準備和喝下？', 'index': 'embedded-comparison', 'readerNote': '兩張原圖都在填單次餵奶，不是每日合計，也不是育伴港已實作的專用畫面。圖上的預設、快捷數字與舊提示都只是來源示例，不能當作餵奶建議。兩張都未顯示儲存成功。', 'choices': [{'name': '餵奶記錄-01｜選奶類，填一個奶量', 'note': '時間、奶類與奶量列在同一頁。原圖一個奶量下拉，再另按「保存记录」。所見 120 mL 是表單預設，並非家長填報或孩子實際喝下。', 'source': 'https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/docs/%E5%96%82%E5%85%BB%E8%AF%A6%E6%83%85%E9%A1%B5.jpg', 'sourceNotes': [{'label': '原作者文件所列畫面', 'url': 'https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/README.md#L219-L221'}, {'label': '同版表單預設值', 'url': 'https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/apps/frontend/src/views/record/FeedingRecordView.vue#L22-L31'}, {'label': '奶量選單和保存按鈕', 'url': 'https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/apps/frontend/src/views/record/FeedingRecordView.vue#L71-L100'}, {'label': '原作者 MIT 聲明', 'url': 'https://github.com/runtime-exception/baby-record/blob/b40587871c702e340728dde67afde878f5b8c644/README.md#L253-L255'}, {'label': 'MIT 英文標準條款', 'url': 'https://opensource.org/license/mit'}, {'label': '育伴港原版：共享記錄先預覽再確認', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/care/CareRecordForm.tsx#L61-L90'}], 'version': 'Baby Record 原作者文件，固定提交 b40587871c702e340728dde67afde878f5b8c644；未標示圖中 build。', 'rights': 'runtime-exception / baby-record；固定原作者 README 標示 MIT，未見獨立 LICENSE。原圖未改，附英文 MIT 條款。', 'externalOnly': False, 'images': [{'short': 'Baby Record 原圖：新建餵奶記錄及單一奶量欄', 'label': 'Baby Record 原圖：新建餵奶記錄及單一奶量欄', 'width': 960, 'height': 1738, 'sha256': '437fbc579915d069eeeeea5aff25553d54e4a31dc5582117c51dbae8eb0df9dd', 'gitBlob': 'ed83cd0fd5a3fe21257cdd1ac85edde8d3907744'}]}, {'name': '餵奶記錄-02｜分開準備量和喝下量', 'note': '原圖切到 Bottle 後，把 Amount prepared 和 Amount drunk 分開。準備量有增減和快捷選項；喝下量的標題可見，控制項大部分在此畫面下方。不要把準備量當成喝下量。', 'source': 'https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/code/web/public/showcase/log-feed-light-en.webp', 'sourceNotes': [{'label': '原作者合成示例說明', 'url': 'https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/docs/showcase-media.md#L3-L13'}, {'label': '原作者擷取 Bottle 表單的程式', 'url': 'https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/tests/e2e/showcase/capture.review.ts#L34-L38'}, {'label': '原作者完整 AGPL 條款', 'url': 'https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/LICENSE'}, {'label': '圖示、插畫及字型署名', 'url': 'https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/CREDITS.md#L46-L53'}, {'label': 'Tabler MIT 署名', 'url': 'https://github.com/lotties-app/lotties.app/blob/47d9257d52437ea0ec53e05ee43e8d86f33a97f6/THIRD_PARTY_NOTICES.md#L476-L503'}, {'label': '育伴港原版：共享記錄先預覽再確認', 'url': 'https://github.com/2NTTY/child-ai-caregiver/blob/c5334be942df12c672c15a2ebe653e9614998a58/frontend/src/components/care/CareRecordForm.tsx#L61-L90'}], 'version': 'Lotties 開發示範，固定提交 47d9257d52437ea0ec53e05ee43e8d86f33a97f6，英文淺色；未另標圖中 build。', 'rights': 'Lotties contributors（AGPL-3.0）、Tabler Icons / Paweł Kuna（MIT）、Fraunces 作者（OFL-1.1）；合成原圖未改，不含程式或字型檔。', 'externalOnly': False, 'images': [{'short': 'Lotties 官方合成原圖：準備奶量與喝下奶量分開', 'label': 'Lotties 官方合成原圖：準備奶量與喝下奶量分開', 'width': 780, 'height': 1688, 'sha256': '61ef5dfedf98263cda82d75722065229921f5658ad731e326620c0693d97af46', 'gitBlob': '5dfef0837d38fe646c0c1d1373f08c234b865ed9'}]}], 'notices': [{'name': '98A｜Baby Record MIT 英文條款', 'key': 'babb7a07eea281fae2c894a48fdc7d11943cb71b6b5d1bf7ed91eb4cd397f466'}, {'name': '98B｜Lotties 原版 LICENSE', 'key': '247da2f77004397c245c069c3b01c8d5471af61e5b30c23f1c0e4d4cc7012318'}, {'name': '98B｜Tabler Icons MIT 署名', 'key': 'b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db'}]}
def digest(blob):
    return hashlib.sha256(blob).hexdigest()

def main(argv):
    if len(argv)!=4:
        raise SystemExit("Usage: python3 rebuild98.py BASELINE_97 BABY_RECORD_JPG LOTTIES_WEBP OUTPUT")
    base, a, b, output=map(Path,argv)
    raw=base.read_bytes()
    if digest(raw)!=BASE:
        raise ValueError("Wrong baseline; no output written")
    for choice, path, mime in zip(GROUP["choices"], (a,b), ("jpeg","webp")):
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
    combined=payload.replace(anchor,','+json.dumps(GROUP,ensure_ascii=False,separators=(',',':'))+anchor,1)
    source=source[:m.start(1)]+combined+source[m.end(1):]
    last='<button type="button" data-latest="96">第 97 頁：換尿片記錄：預選類型，還是留空讓家長選？</button>'
    source=source.replace(last,last+'<button type="button" data-latest="97">第 98 頁：'+GROUP["title"]+'</button>')
    source=source.replace('97 個主題','98 個主題')
    source=source.replace('合計 197 款可選，離線圖片共 152 張。','合計 199 款可選，離線圖片共 154 張。')
    final=source.encode("utf-8")
    if digest(final)!=TARGET:
        raise ValueError("Reconstruction differs from the checked release; no output written")
    with output.open("xb") as f:
        f.write(final)
    print(TARGET)

if __name__=="__main__":
    main(sys.argv[1:])
