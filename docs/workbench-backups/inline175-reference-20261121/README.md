# 選配工作台：導出成長報告前，先核對期間、版次和附錄

第 86 題新增兩張獨立重繪的完整頁示意，累計 86 題／175 款。
- A 依 [Chromium 141.0.7390.108](https://github.com/chromium/chromium/blob/79abd1fdb9fb181f228c16000a90806ceaa09fc5/chrome/browser/resources/print_preview/ui/app.html.ts#L25-L53)（相關程式 BSD-3-Clause），左邊顯示待列印的頁面，右側保留版面選項及尚未按下的儲存。
- B 依 [OpenRefine 3.10.0](https://github.com/OpenRefine/OpenRefine/blob/457290dbda77d8c5ed5776ac2b3cee8517934aa6/main/webapp/modules/core/scripts/project.js#L148-L175)（相關程式 BSD-3-Clause），先在內容分頁勾選欲輸出的欄位；預覽示例及下載在另一分頁。

兩張都是非官方靜態示意，使用虛構展板內容。[育伴港的報告導出](https://github.com/2NTTY/child-ai-caregiver/blob/1a2028452f06c4f6141063e5d1219cb40a8749ab/frontend/src/components/growth/GrowthArchive.tsx#L324-L344) 先選期間和要附的記錄或說明，再核對相應版次；用途只改副標題，不遮蓋正文、不代為分享。內容預覽不是最終 PDF 分頁。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `e1ce24e00cf7eb3ac376cdbadeab24411400e5f160aa44e20bd8e2dcd9a3267d`。
候選 HTML 625276 位元組，SHA-256 `9399efb18637dde5c79489d7727a5f452be6f1e2104c7a99ecbb2f7b91025e76`。
原有 85 題、173 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 86 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。未導出、下載或分享報告。

四個純文字檔：本說明、`candidate-175/build.py`、`candidate-175/manifest.json`、`check-candidate175.cjs`。
完整還原包另行私人保存：178 個 ZIP 條目、177 筆 SHA-256 清單、176 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
