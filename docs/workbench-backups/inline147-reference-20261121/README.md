# 選配工作台：等上一則回覆時的待送追問

第 72 題加入兩張獨立重繪的非官方示意，總數 72 題／147 款。
A 依 [DeepSeek Harness 0.2.2-rc.5 的網頁快照](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/snapshots/web/queue-actions/ui.expected.md)（MIT），把待送追問及編輯、移除、即時引導放在輸入框上方的一列。
B 依 [Codex CLI 0.149.0 的終端快照](https://github.com/openai/codex/blob/758ef40f50c1a458425c7cfbf1eb12cbc07af0b0/codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__tests__status_with_details_and_queued_messages_snapshot.snap)（Apache-2.0），在執行中狀態下方另列斜體待送追問及 macOS 編輯提示。
兩張圖均未發送、未執行命令，不表示伺服器已保存或排定發送。授權屬所列版本的程式，不是官方圖像授權。

## 核對

凍結基準 HTML SHA-256：`8a94bea6a0a95606a90241f8f539649307db2afbc1618ac3998b2995b1ba736f`。
本候選 HTML 541101 位元組，SHA-256 `668b35e44f30e493d123af0605915d39a09c973eb945b09a278461a6efa86f3b`。
原有 71 題與 145 張圖片原封不動。候選來源清單 `7527b79e16c18b971ea6817418ed353e29332982bf16eade51142af2fbefcd25`；獨立來源與全尺寸圖片複核、離線差異及焦點檢查、Chrome 內同頁查看／放大、Escape 及暗處關閉均通過。
備份四個純文字檔：本說明、`candidate-147/build.py`、`candidate-147/manifest.json`、`check-candidate147.cjs`。

## 還原

此 GitHub 分支只含來源與核對文字，不含圖片、私人原件、憑證或取件資料。完整私人還原包有 150 個 ZIP 條目及 149 筆 SHA-256；核對後在獨立位置保留 `out/index.html` 與全部 `out/visuals/`，共 148 檔。不部署、不合併產品主線。
