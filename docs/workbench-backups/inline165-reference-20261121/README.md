# 選配工作台：本機應用背景：看清內容、換圖或恢復預設

第 81 題新增兩張獨立重繪的完整頁示意，累計 81 題／165 款。
- A 依 [Signal Android v7.56.1](https://github.com/signalapp/Signal-Android/blob/21868878cf2307465ceb38525cd6b3607c3f294b/app/src/main/res/layout/chat_wallpaper_fragment.xml#L20-L44)（相關程式 AGPL-3.0），現有圖像只放在設定頁的小型聊天預覽裡，下方可換圖或重設。
- B 依 [Firefox 148.0](https://github.com/mozilla-firefox/firefox/blob/b2a8a4ec986ce61fd15ab1db980381d04ba85ada/browser/extensions/newtab/content-src/components/Base/Base.jsx#L948-L969)（相關程式 MPL-2.0），已套用圖片出現在實際新分頁內容後方，右側面板提供選圖和重設。

兩張都是非官方靜態示意，桌布均為自製幾何圖。[育伴港現有畫面](https://github.com/2NTTY/child-ai-caregiver/blob/7d9a2026bc609f73979c8535182a69a7d3b8feb5/frontend/src/components/appearance/BackgroundSettings.tsx#L19-L34) 顯示目前背景與文字範例，只存於本裝置。Signal 的聊天背景及 Firefox 的新分頁背景不等於育伴港整個介面，也不暗示產品提供裁剪或另按儲存。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `82fc413fefb05971e4dcf5176fb26018e757ad872fa2e9844decd5607025d27e`。
候選 HTML 596680 位元組，SHA-256 `2d86d1afa90c7bcc6694489dbd15945bcc48c8f32d160924d43fe0d19c187153`。
原有 80 題、163 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 81 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。未更換背景或上載圖片。

四個純文字檔：本說明、`candidate-165/build.py`、`candidate-165/manifest.json`、`check-candidate165.cjs`。
完整還原包另行私人保存：168 個 ZIP 條目、167 筆 SHA-256 清單、166 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
