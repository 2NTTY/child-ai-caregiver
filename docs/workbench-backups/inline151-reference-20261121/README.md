# 選配工作台：減少動畫：跟隨系統，還是只在這個瀏覽器開啟？

第 74 題新增兩張獨立重繪的完整頁示意，累計 74 題／151 款。
- A 依 [Code – OSS 1.107.1](https://github.com/microsoft/vscode/blob/994fd12f8d3a5aa16f17d42c041e5809167e845a/src/vs/workbench/browser/workbench.contribution.ts#L664-L675)（相關程式 MIT），搜尋後以三態下拉選單呈現，預設跟隨系統。
- B 依 [Mastodon v4.4.5](https://github.com/mastodon/mastodon/blob/dc6d8f882528803c06b2a71c23d6c1467880a7e1/app/views/settings/preferences/appearance/show.html.haml#L48-L62)（相關程式 AGPL-3.0-or-later），在外觀設定表單分列自動播放 GIF 和減少動畫，另有儲存動作。

兩張是非官方靜態示意，沒有更改任何設定。上游軟件的行為不等於育伴港：[育伴港目前的開關](https://github.com/2NTTY/child-ai-caregiver/blob/bf72dd7eff25c31ceebde01c01e2de17dbf426b9/frontend/src/components/appearance/MotionSettings.tsx#L11-L31) 只能在系統未開啟減少動畫時額外在本瀏覽器開啟，不能強行關閉系統設定，不會跨裝置同步。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `b89fe0738bfbd4a7eb96a4834ba0d9c4ef89a7ae9b10ec1e38aa290d23e7f301`。
候選 HTML 552866 位元組，SHA-256 `8a3be885baa9affd0cf4a590fbfe0330b31a83a661b441a146ac4cd3af280b8c`。
原有 73 題、149 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 74 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。

四個純文字檔：本說明、`candidate-151/build.py`、`candidate-151/manifest.json`、`check-candidate151.cjs`。
完整還原包另行私人保存：154 個 ZIP 條目、153 筆 SHA-256 清單、152 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
