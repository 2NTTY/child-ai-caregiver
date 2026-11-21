# 選配工作台：從首頁拍照給助手：先核對，尚未上傳或送出

第 82 題新增兩張獨立重繪的完整頁示意，累計 82 題／167 款。
- A 依 [Element X Android v26.11.0](https://github.com/element-hq/element-x-android/blob/5d1af53a6c8dd6234cbb51e44282d5902b6d4ff3/features/messages/impl/src/main/kotlin/io/element/android/features/messages/impl/messagecomposer/MessageComposerPresenter.kt#L200-L210)（相關程式採其 AGPL-3.0-only 選項），手機以較大畫面先檢視一張照片；上游的送出鍵未按下。
- B 依 [OpenClaw v2026.6.5](https://github.com/openclaw/openclaw/blob/5181e4f7c82bd373cb215a5619b0fa03c13862b7/ui/src/ui/views/chat.ts#L2000-L2081)（相關程式 MIT），對話仍可見，未送出的照片縮圖留在輸入區，旁邊可移除。

兩張都是非官方靜態示意，照片為原創物件圖。[育伴港的首頁帶入流程](https://github.com/2NTTY/child-ai-caregiver/blob/7d9a2026bc609f73979c8535182a69a7d3b8feb5/frontend/src/production/ProductionProvider.tsx#L137-L166) 只將一張相片帶到同一孩子的對話草稿，不會自動上傳、儲存或送出。產品放大預覽只有更換、移除和返回，跟 Element 的預覽內送出不同；OpenClaw 的檔案選擇也不是產品的拍照流程。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `2d86d1afa90c7bcc6694489dbd15945bcc48c8f32d160924d43fe0d19c187153`。
候選 HTML 603012 位元組，SHA-256 `77244809655bbc8e999180aefd7db04ca078fa2c50cda13edf957dfd84fc3d9c`。
原有 81 題、165 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 82 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。沒有實際拍照、上傳或送出。

四個純文字檔：本說明、`candidate-167/build.py`、`candidate-167/manifest.json`、`check-candidate167.cjs`。
完整還原包另行私人保存：170 個 ZIP 條目、169 筆 SHA-256 清單、168 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
