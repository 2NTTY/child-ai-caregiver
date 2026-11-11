# PC01 v1.0.1 · 助手對話完整桌面參考

入口 `candidate/index.html`。這是 assistant-ui 官方 Weather in Tokyo 示意圖的 HTML/CSS 靜態結構重建，用於編號比較，未入選，不是育伴港真正前端。

## 原作、作者與權利

作者 assistant-ui / AgentbaseAI Inc.；[固定 README](https://github.com/assistant-ui/assistant-ui/blob/3e04e44f33f8313356305f0b01e2321133228632/README.md) 連結該原圖，固定提交 `3e04e44f33f8313356305f0b01e2321133228632`。

[固定原圖](https://github.com/assistant-ui/assistant-ui/blob/3e04e44f33f8313356305f0b01e2321133228632/.github/assets/generative-ui-light.png)，2280 × 1580，SHA-256 `5eec1d863f074a18cb19776b5db85833dc9a734b0519a2e5eb6576b445087efd`。

[固定版本 MIT 授權](https://github.com/assistant-ui/assistant-ui/blob/3e04e44f33f8313356305f0b01e2321133228632/LICENSE)，Copyright (c) 2026 AgentbaseAI Inc.，全文保存於 `reference/LICENSE`。原圖與授權逐 byte 保留，引用不表示作者背書。

## 忠實範圍與已知差異

完整保留單一桌面視窗、提問、工具狀態、天氣卡、回覆與底部輸入框構圖及所有原英文示例，不融入育伴港舊設計。固定畫布 1140 × 790，為原圖 50% 比例。外部中文編號／來源說明不是原作。

字體為系統 sans-serif；圖示、尾角、陰影以 HTML/CSS/SVG 重繪，因此不是逐像素一致。正文第一行實測文字寬 702.359375 px，字型度量與原圖不同，但保持原圖兩行，未裁切。窄窗只捲動固定桌面圖，不代表手機版。所有控件裝飾性，不發送訊息或呼叫工具。

## 獨立驗收：2026-11-11 UTC

- 靜態原圖 hash／資產／CSP／無腳本或表單／原文結構檢查通過。
- v1.0 首次 Chromium 實際呈現發現正文三行、與操作圖示列重疊 12 px，沒有把失敗算成通過。
- v1.0.1 只以 `white-space:nowrap` 保留原圖明確 `<br>`；字型、字級、行高、框寬與位置不變。定向靜態檢查通過。
- 同 viewport 1180 × 757、DPR 1 再次實際完整頁呈現：正文 2 行／52 px，操作列前有 14 px 間隔；最右文字 x956.359375 在白視窗右邊 x1130 之內，無重疊、裁切。
- 未驗互動、手機、讀屏或真正前端，不宣稱上述完成。

公開 copy 僅將外部說明的「尚未做瀏覽器畫面核對」更新為準確驗收狀態，原作畫布 HTML/CSS 與已驗 v1.0.1 相同。沒有原版修改、選擇寫入、API、模型、家庭資料、GCP、master 合併或 Sites 發布。
