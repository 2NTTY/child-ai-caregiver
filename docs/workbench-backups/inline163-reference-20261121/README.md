# 選配工作台：開啟 Telegram 綁定步驟後，先核對，再確認

第 80 題新增兩張獨立重繪的完整頁示意，累計 80 題／163 款。
- A 依 [Keycloak 26.5.1](https://github.com/keycloak/keycloak/blob/228bc50913aaf8778aeb05c33b67c3fe4f5817e9/themes/src/main/resources/theme/base/login/template.ftl#L86-L124)（相關程式 Apache-2.0），整頁先核對所辨認的帳號，另一按鈕才進入既有帳號驗證。
- B 依 [KDE Connect Android v1.37.3](https://github.com/KDE/kdeconnect-android/blob/f82d035ddc93d41aa45bea3988a6db4265c5554f/src/main/java/org/kde/kdeconnect/ui/compose/screen/device/DevicePairingScreen.kt#L67-L132)（相關程式採其 GPL-3.0-only 選項），手機裝置頁先顯示待配對對象，接受鍵尚未按下。

兩張都是非官方靜態示意，使用虛構資料，沒有實際可用的驗證值。[育伴港現有畫面](https://github.com/2NTTY/child-ai-caregiver/blob/84dd99eecd757168ec3da7faa9ed898ad82b7a3d/frontend/src/components/notifications/ChannelCards.tsx#L320-L340) 要使用者回設定頁核對候選帳號，再明確確認，並非啟動就綁定；過期只能重新開始。登入身分或裝置配對不等於通知授權。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `9b74cfca8aaf5df1b5d1f4461fe295c34c19d472bf8d68ba9810f3826aa825c1`。
候選 HTML 590138 位元組，SHA-256 `82fc413fefb05971e4dcf5176fb26018e757ad872fa2e9844decd5607025d27e`。
原有 79 題、161 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 80 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。只測工作台，未操作任何帳號或裝置。

四個純文字檔：本說明、`candidate-163/build.py`、`candidate-163/manifest.json`、`check-candidate163.cjs`。
完整還原包另行私人保存：166 個 ZIP 條目、165 筆 SHA-256 清單、164 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
