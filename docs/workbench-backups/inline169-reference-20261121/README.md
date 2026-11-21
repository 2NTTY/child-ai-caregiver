# 選配工作台：更正已保存的照顧記錄：先核對原因和擬共享內容

第 83 題新增兩張獨立重繪的完整頁示意，累計 83 題／169 款。
- A 依 [DokuWiki 2026-07-14](https://github.com/dokuwiki/dokuwiki/blob/70c54a601cfa85941896cff7a15014a9af4872dc/lib/tpl/dokuwiki/main.php#L35-L69)（相關程式 GPL v2），同頁保留編輯和摘要欄，下方另顯示未保存的排版。
- B 依 [Drupal 11.3.0](https://github.com/drupal/drupal/blob/ac5da07ad88571dbb31dfb52f055bb0d4063f598/core/modules/node/src/Controller/NodePreviewController.php#L53-L63)（相關程式 GPL-2.0-or-later），另外開閱讀預覽頁，再返回原表單；預覽不是儲存。

兩張都是非官方靜態示意，使用虛構日常文字。[育伴港的更正流程](https://github.com/2NTTY/child-ai-caregiver/blob/4a17d6206bb0b0518c2c9c7b0ddb886f36bc42a0/frontend/src/components/care/CareRecordForm.tsx#L77-L89) 要填原因、先核對擬家庭共享內容，明確確認才新增一個更正版；舊版仍可查閱。上游的選填摘要、獨立頁面或權限不代表產品有相同流程。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `77244809655bbc8e999180aefd7db04ca078fa2c50cda13edf957dfd84fc3d9c`。
候選 HTML 608743 位元組，SHA-256 `67e1487c338be02d53d12f3fbb9f5f25ed5eac69b23a55db6849f6829652bedf`。
原有 82 題、167 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 83 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。未改動、儲存或分享記錄。

四個純文字檔：本說明、`candidate-169/build.py`、`candidate-169/manifest.json`、`check-candidate169.cjs`。
完整還原包另行私人保存：172 個 ZIP 條目、171 筆 SHA-256 清單、170 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
