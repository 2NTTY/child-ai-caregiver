# 選配工作台：概況：切換孩子，下一頁仍沿用

第 109 題新增兩張獨立重繪的完整頁示意，累計 109 題／221 款。
- A 依 [Sentry 26.11.0](https://github.com/getsentry/sentry/blob/c54c3cec809a38cc3a72d6a51e303f35b35b8b5e/static/app/views/issueList/overview.tsx#L990-L1026)（相關程式 FSL-1.1-Apache-2.0），桌面列表上方直接標示及改選範圍。可多選項目是 Sentry 的功能，不是育伴港功能。
- B 依 [Home Assistant Android 2026.11.1](https://github.com/home-assistant/android/blob/743db58e8749709c187d33b2192be9fcc149997b/app/src/main/kotlin/io/homeassistant/companion/android/settings/server/ServerChooser.kt#L74-L144)（相關程式 Apache-2.0），手機從底部選單辨認目前的伺服器。上游切換後載入所選伺服器的預設頁。

兩張都是非官方靜態示意。[育伴港的孩子切換](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/production/ProductionProvider.tsx#L153-L161) 只選已有權限的一位孩子：切換後留在概況並重新讀取，再打開「關注與準備」會沿用同一位。不會混合兩人的資料或改變權限，也不保證保留捲動位置。沒有切換真實孩子或伺服器。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `c20e10e5484fcb396703e6cf88896be598e75793c83a77e2d3c90c57e39923a6`。
候選 HTML 748980 位元組，SHA-256 `ae8a2d051ae0449c79cd43ec9ed0f900909f8f49291d912664ecabebc7ba0ed1`。
原有 108 題、219 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 109 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未切換真實孩子、帳戶或伺服器。

四個純文字檔：本說明、`candidate-221/build.py`、`candidate-221/manifest.json`、`check-candidate221.cjs`。
完整還原包另行私人保存：224 個 ZIP 條目、223 筆 SHA-256 清單、222 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
