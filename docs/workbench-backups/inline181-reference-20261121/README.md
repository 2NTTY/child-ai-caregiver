# 選配工作台：手機首頁錄音：停止後先試聽，再加入未送出草稿

第 89 題新增兩張獨立重繪的完整頁示意，累計 89 題／181 款。
- A 依 [Moodle 5.3.0](https://github.com/moodle/moodle/blob/42622298fe06f9626d988d60b2bf589bd8f850e8/public/mod/forum/post.php#L1094-L1111)（相關程式 GPL-3.0-or-later），用編輯器上方的錄音視窗先試聽，另按附件鍵才會上載到 Moodle 編輯器；這不代表已發帖。
- B 依 [Telegram Android 11.4.2](https://github.com/TelegramMessenger/Telegram-Android/blob/fb2e545101f41303f1e2712de2e7611a9335f1c3/gradle.properties#L16-L17)（所引程式 GPL-2.0-or-later），在對話底部就地顯示暫停後的本機音訊條、試聽與送出入口；沒有送出。

兩張都是非官方靜態示意，沒有錄音或音訊檔。[育伴港的首頁錄音](https://github.com/2NTTY/child-ai-caregiver/blob/313dbff07abcbfe89f2eacc4dfb6912b0aa79e7d/frontend/src/components/agent/VoiceCapture.tsx#L88-L114) 停止後可手動試聽或捨棄；要按「使用錄音」才帶入本機草稿，不會因此上載或送出。兩個上游的附件及送出操作不等於產品。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `ff97b8bd5d2b877f97dd5f51b73e71927d387e87cfe3b44d667de7eb79ab6385`。
候選 HTML 643388 位元組，SHA-256 `0d66bb9f45ae9c2e1056945e2b58932b4f1dbd4a753637b7844a2a8411570a60`。
原有 88 題、179 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 89 題並排顯示兩個來源，兩圖可分別放大並以 Escape／暗處關閉，各自回復原按鈕焦點。沒有錄音、音訊或傳送。

四個純文字檔：本說明、`candidate-181/build.py`、`candidate-181/manifest.json`、`check-candidate181.cjs`。
完整還原包另行私人保存：184 個 ZIP 條目、183 筆 SHA-256 清單、182 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
