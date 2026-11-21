# 選配工作台：單項待辦改期／轉派：先核對誰接手、何時到期，再保存

第 88 題新增兩張獨立重繪的完整頁示意，累計 88 題／179 款。
- A 依 [MantisBT 2.28.1](https://github.com/mantisbt/mantisbt/blob/61082fb5bc65fbc35973a4b08d63d7e9db1e3f97/bug_update_page.php#L157-L197)（相關程式 GPL-2.0-or-later），在可編輯既有工作的一頁同列顯示負責人與到期日；附註選填，原始提交未按下。
- B 依 [OpenProject 17.9.8](https://github.com/opf/openproject/blob/3f94937cd2d24d053167c5fee25ff84934ea8ff2/docs/user-guide/work-packages/work-package-views/README.md#L44-L52)（相關程式 GPL-3.0-only），保留工作清單，在右側檢視選定項目的日期和負責人，可逐欄修改。

兩張都是非官方靜態示意，使用虛構工作。[育伴港的改期／轉派](https://github.com/2NTTY/child-ai-caregiver/blob/c59f0611c9319003691b294a24f7d4a3e9be5acc/frontend/src/components/tasks/TaskForm.tsx#L67-L105) 要選合資格的接手人、日期時間和時區，填原因並明確確認才保存。同一待辦仍保持未完成；保存不等於送達通知。上游的權限、選填附註和各欄保存不同於產品。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `63b3ef9a9f3a4738cf3de97c76cbecf89277f144fc803ec7acb565c4c19e3e0f`。
候選 HTML 637181 位元組，SHA-256 `ff97b8bd5d2b877f97dd5f51b73e71927d387e87cfe3b44d667de7eb79ab6385`。
原有 87 題、177 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 88 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。未改期、轉派、保存或發送通知。

四個純文字檔：本說明、`candidate-179/build.py`、`candidate-179/manifest.json`、`check-candidate179.cjs`。
完整還原包另行私人保存：182 個 ZIP 條目、181 筆 SHA-256 清單、180 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
