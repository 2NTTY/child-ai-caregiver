# FE-W40 合併來源／建置驗證

- 版本：PR #89 最終 head `193affe2b2b8a2956cf976c1d3d3e11d9d4dadb7` 對應的 frozen cleanup v46，加四份已覆核 patch；獨立工作區，未修改基線
- 合併：38 個來源／測試檔案，兩個共享檔案均只套用獨立 hunks，zero-fuzz；沒有手動解衝突。另按主模型批准同步一個已被新按壓呈現取代的測試斷言；五份規範／交接／計劃文件由主模型親寫
- 最終檢查：disclosure 定向 11/11、typecheck、aggregate 292/292、唯一 fresh web export 37 routes 通過
- 首輪 aggregate：291/292，唯一失敗是 disclosure 按住仍要求透明底的舊斷言。立即停批；主模型覆核後改為已批准的 `pressedOverlay`，新增完整 opacity／border／disabled-held 不變條件，沒有改產品來遷就測試。原 `aggregate.log`、`checks-initial.json`、owner 原失敗 logs 均保留
- Source／build-input fingerprint：`459128602754492d317b4b801e0ddba790b829788ce225786236873f78217d34`；凍結至 export 完成沒有漂移
- Export fingerprint：`dc93ed68afbf7b44b51f802dc01d96c3aefe895f61136124eb6c3ec8c2dc7bf4`
- Entry：`_expo/static/js/web/entry-36913f917a02548acd5964af9674b1d3.js`；SHA-256 `d8f6e3498fb6b388ab0ed5ba07e05bc79e4fc533459ef2e6c0602d2d3accbec6`
- 194 份原歷史證據逐檔保留；使用者 hero PNG 在 source 與 export 均為 SHA-256 `2d6831182f397c2388f0f6239be093b7480eef2c70fe4ff4894cdcb1dee13c29`

完整來源／文件 diff 見 `combined-source-docs.patch`；逐檔 fingerprint 見 `source-manifest.json`，輸出 hashes 見 `export-manifest.json`，命令及原 logs 見 `checks.json`。`combined-implementation.patch` 保留最初四 patch 合併時的內容，最終已批准 assertion 同步由完整 diff 反映。

## 限制

本執行者沒有 browser、Git 或 Sites 操作；build 與純測試不代表 held-press、響應式佈局或逐幀無閃動已視覺驗收。保存的 button baseline 畫面只支持舊版本、原範圍。Paper ripple／busy／vendor clock／原有 animations 未修改，真 API、持久化及原生裝置未驗。後續 mobile active-indicator／droplet 是另一批，未混入這次凍結。
