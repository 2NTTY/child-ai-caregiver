# 頁型與安靜讀取：source36／artifactfix1

2026-10-23。本目錄為**公開工程摘要／摘錄**，不是私有原始收據的逐 byte 副本。各摘要保留原收據 SHA-256；[索引](evidence-index.json)另計本公開版本的 hash。三張合成原圖保留原始 bytes，沒有重畫、裁切或修改。

## 本地交付範圍

相對 `5a39776f703bc436528b858f393621bcf8030b03` 的 source31，精確 **89 檔＝45 產品＋44 測試**，詳見[逐檔前後 hash](receipts/source-scope.json)。包含頁面專屬歷史卡／閱讀彈窗、概況四區與最近 7 日初始範圍、記憶共用入口／本地分頁、確認輸入作用域、唯讀關閉，以及同範圍背景讀取的舊內容／控制保留。真正 identity／scope／權限失效仍清除敏感內容，不延長寫入能力。

訊息歷史完整性修補的 server/client 源碼有納入交付，**不代表已部署後端**。本包不包含另行進行的 avatar／附件工作、不修改需求文件；預覽只用合成資料，沒有真家庭資料、照片、模型或正式刪除。此摘要封存時為本地待交付，尚未更新公開站點或遠端 PR。

## source → artifact 身份

- 559 個 build inputs／131 個累積來源範圍前後無漂移；131 包含較早批次項目，不是本次新增 89 檔數。
- [來源 gate](receipts/source-provenance.json)核對全部 **417 個實際輸出的第一方文字來源**；PNG 則核來源 hash、PNG 尺寸、唯一 asset registry URI 與輸出原 bytes，不把二進位當 UTF-8 `sourcesContent`。未輸出的 inputs 不冒稱已逐一出現在 bundle。
- Preparation 的來源內容精確對應本次 hash，六項編譯語義吻合；[Router context](receipts/router-context.json)只指向本版，沒有其他 snapshot 的依賴。
- 新建置曾兩次 exit137（原因未確診），其後隔離 cache 的替代執行環境 export exit0；[逐次結果](receipts/export-attempts.json)保留失敗，不稱全程一次成功。
- 公開 bundle 僅移除**唯一末尾 sourceMappingURL 行**；[逆轉收據](receipts/bundle-sanitization.json)可還原 raw bytes，編譯模組未改。不能聲稱 raw／public whole-JS byte 相等。source maps 不在公開包內。
- 原 snapshot36 曾因共享 cache 帶入 snapshot35 舊模組；該 artifact [已撤回](receipts/retracted-artifact36.json)，原 GUI 紅保留，但不能當成正確 source36 修補失敗。

最終公開 bundle SHA-256：`00b168eda1e95d0e2a05c03d8e6e54dd6e1d2e876ab8089516f77a145cd4fa1b`；合成 fixture：`9d507a2d46b1da27f5ec64e242e53cab2d5748c2bf6f4e054e77c9b4f6c59e6f`；archive：`c257b9c381cb031acc4815d1e9811f6178dbf7475aa95a510e4f9abb00877f3e`。[完整身份](receipts/artifact-identity.json)及 [143 檔 archive readback](receipts/archive-integrity.json)均已核；安全 validator 保留 CSP `connect-src 'none'`、非讀取寫入 405 及精確 fixture 逆轉。

## 驗證分層

source36 的兩個必要 scripts **30／30** 通過（[收據](receipts/targeted-source36.json)）；artifactfix1 沒有改源碼，沒有為重包重跑這批。32／33／34／35 的 184／66／79／16 是各自版本內去重結果，**不可相加**，也不是全部在36重跑。[分版本摘要](receipts/versioned-history.json)保留原失敗、修補與 NOT_RUN。Fixture/parser 檢查不混入產品測試數。

[本次 GUI 報告](receipts/qa-report.json)為 **PASS_BOUNDED_SETTLED503_TARGET**，只覆驗 Preparation 已有五個 checkbox → 同 owner 503 settled：

1. 原五個節點、勾選值與單項尺寸保留，全部 disabled；舊正文及重試提示可見。
2. 原生 pointer、Space、Enter 各一次沒有 mutation，第二項保持焦點。
3. 已聚焦後再次同錯誤讀取，原節點、焦點、scroll 及高度保留。

實際 iframe 為 **1023×600 CSS px**；三張原圖為 1364×1024 pixels，包含瀏覽器介面，**不是 fullpage／手機圖**。首次錯誤新增提示使 workspace 高度增加 69.6875 CSS px、scroll 增加37.5；沒有宣稱整個 workspace 零位移。首次注入錯誤的按鈕本身取得焦點，焦點保留結論只屬第3項。100ms 有界樣本不是逐幀絕對不閃保證。

| ready | settled 503 | focused same-error read |
| --- | --- | --- |
| [原圖](images/01-ready-focused-0.jpg) | [原圖](images/02-error-retained-0.jpg) | [原圖](images/03-error-focused-0.jpg) |

[72 檔 closing integrity](receipts/qa-close-integrity.json)與原圖 hash 均對應此 artifact。沒有真刪除、真模型或資料寫入；既有唯讀 Care/search POST 不當 mutation。

## 尚未通過／未驗

完整 TypeScript 仍 **NOT_PASS**：歷史兩環境 exit137、沒有完成診斷，原因未確診；本版未盲重跑（[界線](receipts/full-typecheck-boundary.json)）。CI 未重新查證。本次未重驗自然 OS app-switch、Android/native runtime、完整讀屏／四尺寸／全站矩陣及真後端。實際 iframe blur/focus 與明示合成延遲 refresh 分開記錄，不冒稱 OS 切換證據。此前版本已核的正常／慢讀、Memory 真503與權威 empty、孩子確認等有界結果仍屬原版本，不借本包改寫為全站全綠。
