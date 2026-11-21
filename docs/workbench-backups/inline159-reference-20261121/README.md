# 選配工作台：歷史報告仍列在索引，來源失效後不顯示正文

第 78 題新增兩張獨立重繪的完整頁示意，累計 78 題／159 款。
- A 依 [MediaWiki 1.44.1](https://github.com/wikimedia/mediawiki/blob/02f60e14ba59bfe6d4533054d7951887bc5f3702/includes/actions/HistoryAction.php#L302-L338)（相關程式 GPL-2.0-or-later），可讀修訂的日期仍可進入，正文隱藏的一列保留日期但不能打開。
- B 依 [OSF Angular 26.19.0](https://github.com/CenterForOpenScience/angular-osf/blob/4e6fe442a807a3cfb683dfff76d04044be69bc67/src/app/features/preprints/pages/preprint-details/preprint-details.component.html#L1-L22)（相關程式 Apache-2.0），保留版本等書目資料，撤回後不再顯示 PDF；通用圖示不是可下載的證據。

兩張都是非官方靜態示意，使用虛構資料。[育伴港伺服器](https://github.com/2NTTY/child-ai-caregiver/blob/077d05722522fd3c393824ac308c063e8fa88cc6/server/firestore-family-documents.ts#L511-L536) 仍會為有權查閱索引的人顯示失效版本的日期和版本，正文不回傳；不等於永久刪除、整個模組的權限被撤回或靜默切換至新版。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `75e8cd1c85b863d1c3a9840215259aedd75861aa91a123adfcc5e43527fe7f57`。
候選 HTML 577851 位元組，SHA-256 `fa555fa9dcfa73d9dc6ea187def68beceb1b4ccd8bb2b2ccbb7913aa15c9bf66`。
原有 77 題、157 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 78 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。

四個純文字檔：本說明、`candidate-159/build.py`、`candidate-159/manifest.json`、`check-candidate159.cjs`。
完整還原包另行私人保存：162 個 ZIP 條目、161 筆 SHA-256 清單、160 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
