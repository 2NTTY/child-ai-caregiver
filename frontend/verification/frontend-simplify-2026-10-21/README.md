# 2026-10-21 前端精簡驗證

以 `7b828dcbe967c92556673b97733c281d29db4386` 為基線，保留同一 draft PR、不合併或部署。產品差異限 `frontend/**`。可重現命令、分層結果、原紅及未驗界線見 `checks.json`；測試數重疊，不相加為全站驗收。

## 最新可審證據

- 表單／真頁／guard／日期呈現：48/48；回焦增量 consumer：34/34；最後讀取／首頁時間回歸：25/25。
- 真 PaperProvider＋RN Web Modal／FocusTrap＋SourceComposer/RHF／ProductionContext／TasksView：7/7。Safe area、外觀、JSDOM 幾何及 owner actions 為明示 ports，不當真 API 或像素驗收。
- Source／Photo 真 hooks 合成 ports：41/41；Documents 真 owner/API parser 的原 opId／UI draft token：3/3。
- Chat 鍵盤送出焦點 ticket DOM：4/4；呈現／互動回歸：10/10；另 Chat 輸入 DOM＋真 Profile owner/API parser 合成 transport：10/10。
- 本機背景與 Web/native storage ports：8/8；native 使用既有 expo-crypto，不依賴瀏覽器 global。
- frontend typecheck 仍只有基線 ContactConsentCard 兩錯。完整 Documents lifecycle 為 **34/36**；兩項 PDF URL 清理同步斷言也在隔離 HEAD 產品重現（同 harness 必要 ports），不是全綠，沒有改產品等待規則。
- snapshot09 Web export：524 來源 hash 前後一致、35 routes、62 artifacts。雲端 Chrome 已通過來源草稿、關注／準備／報告表單、欄位名稱、照片時間、unknown 恢復可達與聊天鍵盤回焦／閱讀不搶焦。Care 在 snapshot08 回新增按鈕；snapshot09 的 Tasks 首次快速／穩定頁捨棄都回待辦 heading，後續 GET 不丟焦、Tab 可繼續操作；首頁摘要分鐘／無時區後綴亦通過。

## 關鍵 browser 修補

snapshot03 的窄詳情裁字／zoom 側欄溢出／眼睛圖示，snapshot04 真畫面複驗修復；合成背景選圖、刷新持久、恢復、延遲登出遮罩及身份隔離亦過。snapshot05 發現 guard 被原表單遮住，request-time mount 後 snapshot06 真 hit-test／按壓通過。snapshot06 再發現 Paper Portal 令本地 guard context 遺失、來源草稿直接消失；移除重複 Portal、保留 RN Modal 後 snapshot07 真表單複驗通過。snapshot08 trace 確認 Tasks 原按鈕回焦後被背景 GET 停用而丟焦；snapshot09 改為同 scope 一次回穩定頁 heading，不改原讀寫／權限 gate，也不在讀取完成後搶焦。各版本圖不互相冒充，不宣稱全頁全狀態矩陣完成。

## 證據及未驗界線

原 log、完整 manifests、合成截圖及 browser 報告保留於授權雲端 workspace；PR 只納精簡索引、文件及可重現測試，不提交 bundle、截圖、私有路徑或家庭資料。log 名及 SHA256 是原證據索引，不表示 log 已提交。

Header attention、首頁重要提醒及通知正文收件箱仍缺後端語義 API，見 `ATTENTION_API_HANDOFF.md`，沒有假成功或正式 mock fallback。Android 真機／APK／OTA、真身份或服務 API、真模型、完整讀屏及全尺寸全狀態組合未驗；其他原有 harness 阻塞仍分列。
