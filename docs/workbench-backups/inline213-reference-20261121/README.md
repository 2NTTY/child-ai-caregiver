# 選配工作台：照顧記錄：按文字和種類搜尋

第 105 題新增兩張獨立重繪的完整頁示意，累計 105 題／213 款。
- A 依 [BookStack v26.09.3](https://github.com/BookStackApp/BookStack/blob/bf680915b6dbaf93eee5234ec72dc33bc5abafbf/resources/views/search/all.blade.php#L1-L30)（相關程式 MIT），完整搜尋頁左欄放條件，右欄放結果及分頁。
- B 依 [Zotero 7.0.32](https://github.com/zotero/zotero/blob/188c54c186fbbaa6889145986d43ba64160a44fa/chrome/content/zotero/advancedSearch.xhtml#L15-L53)（相關搜尋程式 AGPL-3.0-or-later），用完整桌面搜尋視窗，上方放條件、下方放結果。

兩張都是非官方靜態示意。[育伴港的照顧記錄搜尋](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/frontend/src/components/care/CareSavedRecordsView.tsx#L32-L61) 只查同一孩子已保存的現行記錄，文字和所選種類須同時符合。[後端按批次搜尋](https://github.com/2NTTY/child-ai-caregiver/blob/7286b87b279486a997310ef511760bd482926085/server/firestore-care.ts#L369-L376)，這一頁沒有結果仍可能有下一頁。「這一頁未有符合；可繼續查閱」是建議文案，尚未套用。上游的總數和進階條件並非育伴港功能。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `aa1a9204ad4402b17a4d718ade26f310cf8d9e44fb8deb236be786bf8db7d01e`。
候選 HTML 727087 位元組，SHA-256 `12c3374b346b80c1da52ebccea3844720b9808466f193347cc85e99f02c840e2`。
原有 104 題、211 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 105 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未搜尋或讀取真正照顧記錄。

四個純文字檔：本說明、`candidate-213/build.py`、`candidate-213/manifest.json`、`check-candidate213.cjs`。
完整還原包另行私人保存：216 個 ZIP 條目、215 筆 SHA-256 清單、214 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
