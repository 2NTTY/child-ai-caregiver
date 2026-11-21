# 選配工作台：關閉照顧記錄詳情，回到原來那張卡

第 85 題新增兩張獨立重繪的完整頁示意，累計 85 題／173 款。
- A 依 [Roundcube Webmail 1.6.15](https://github.com/roundcube/roundcubemail/blob/9d18d524f3cc211003fc99e2e54eed09a2f3da88/skins/elastic/templates/message.html#L1-L26)（相關程式 GPL-3.0-or-later），閱讀頁佔滿窄畫面，返回清單時，若仍有原郵件識別碼且能找到該列，可再選中原項目。
- B 依 [Calibre 8.16.2](https://github.com/kovidgoyal/calibre/blob/77587e4bb585e228920ce18d208171c825fd432d/src/calibre/gui2/init.py#L550-L572)（相關程式 GPL v3），保留原本清單和選中項目，另外浮出一個詳情視窗。

兩張都是非官方靜態示意，使用虛構內容。[育伴港的照顧記錄](https://github.com/2NTTY/child-ai-caregiver/blob/1a2028452f06c4f6141063e5d1219cb40a8749ab/frontend/src/components/care/CareSavedRecordsView.tsx#L22-L67) 保留原清單；Web 關閉詳情時，只有在孩子、篩選和分頁不變、原卡仍可用時才回到該卡且不跳動。兩個上游版式不保證相同的捲動或鍵盤焦點行為。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `36a0bcc2ad16b7895ab8e49234a0f88fabaf24db88c34840c48097c807b2b3d2`。
候選 HTML 619727 位元組，SHA-256 `e1ce24e00cf7eb3ac376cdbadeab24411400e5f160aa44e20bd8e2dcd9a3267d`。
原有 84 題、171 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 85 題並排顯示兩個來源，已核對 A 重新載入須有原識別碼；兩圖可分別放大並以 Escape／暗處關閉、回復原按鈕焦點。只驗收工作台，未操作照顧記錄。

四個純文字檔：本說明、`candidate-173/build.py`、`candidate-173/manifest.json`、`check-candidate173.cjs`。
完整還原包另行私人保存：176 個 ZIP 條目、175 筆 SHA-256 清單、174 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
