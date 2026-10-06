# Mobile／dark ripple 合併來源與建置驗證

- 基線：已凍結的 v47 source、五份主模型文件及完整畫面證據；758 個基線檔案複製前後逐檔一致。這是獨立下一批，沒有回寫 v47 source／dist／QA
- 改動：Mobile 9-file patch 與 AppButton dark-ripple 3-file patch，共 12 檔，互不重疊；zero-fuzz 套用，各自 postimage 與 owner 最終來源一致
- 內容：手機底欄持續 selected 標示、Records current／selected 語義、72px decorative corner surface 配原 56px hitbox；只有 AppButton primary／danger 改為黑色 alpha 0.12 ripple，其他角色與 unavailable／busy 行為保留
- Combined typecheck、300/300 aggregate、唯一 fresh web export 37 routes 全部首輪通過，沒有本輪失敗、斷言同步或產品重試
- Source／build-input fingerprint：`81cb84068fa95ae59687e2b18a2ec08ea1f96ac92803c0de8911dc628fe7e089`；凍結至 export 完成沒有漂移
- Export fingerprint：`b9b9acaa0b2cd745d3a16195751abfe8bcf5bbf58e05c395cd22685843c1c18c`
- Entry：`_expo/static/js/web/entry-306b54fd51461813a9e0d6c05558433b.js`；SHA-256 `61dcbb1097cc316a3330879617d96edd90a8c484c009a5a0e571b26a200a4150`
- 322 份 v47及更早歷史證據保持原 bytes；使用者 hero PNG 在 source/export 均為 `2d6831182f397c2388f0f6239be093b7480eef2c70fe4ff4894cdcb1dee13c29`

原 owner patch、檢查、hash 與 geometry-only 示意保存在 `contributors/`；完整命令與 logs 見 `checks.json`，來源及輸出 hashes 分別見 `source-manifest.json`、`export-manifest.json`。主模型本輪 Markdown 更新會納入 `combined-source-docs.patch`，runtime 不隨文件刷新而重建。

## 限制

本執行者沒有 browser、Git 或 Sites 操作。Geometry-only 圖及純測試不是瀏覽器 hit testing／焦點／像素驗收；原生裝置、真相機及每幀無閃動亦未驗。歷史 v47 QA 只支持其原版本及範圍，不當作新 ripple 或 mobile shape 已視覺驗收。其他 Paper roles、vendor clock、busy／scope／原動畫保持不變。

## 主模型確認的後續畫面驗收

主模型已親讀 `browser-qa/v48-browser-report.md` 並查看實際手機截圖，接受限定通過：primary／danger 共八個按住樣本保持全不透明白字、黑色 state layer；390／320 的持續選中、72px 裝飾與 56px hitbox 抽樣命中、長按／Escape 及文字方向拖曳通過。原「Unknown CDP tab 9」helper 失敗保留，經主模型批准的單次修正後原 probe 通過。這是 browser owner 的 v48 證據，並非本整合執行者親自操作；不擴成逐幀、原生、真相機或真資料驗收。
