# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **P4 統一文檔包接線中（2026-10-28）：**#362 持久匯出後端與 #363 共用 Web／Android 設定入口已合併未部署。正在接匯入驗包／固定內容續讀，再接台帳與領域保存；目前尚無可用的正式匯入。班級／期間與完整備份範圍仍待接，不算 HANDOVER01 完成。已通過的[匯出 UI 證據](artifacts/verification/P4_HANDOVER_UI_20261028.json)不重跑；AUTH01、Android 分享新 APK、iOS、P3／P5 與 D 的原待辦保留。

- **Web 語音驗收暫緩；本人 Vertex 代表流程已核：**語音修正已交付原站，但使用者仍回報有問題，並指示待 Agent 完成才驗收；具體新症狀未核，不再要求重試，恢復條件見 [S16](PLAN.md#s16-w03)。本人 key 經正式共用設定／聊天 client 保存及新會話讀回後，以 3 次生成／1 次向量完成官方引用、獨立審核、保存及原 run 讀回。全部記本人，平台增加 0；臨時 key／權限及本地 key 已清理。先前失敗仍保留，手機本人 key 輸入／跨端畫面及四 Agent 聯合品質未因此代驗，見 [MODEL03](PLAN.md#model-self03)／[S16](PLAN.md#s16-w03)。歷史情境干擾及並發資料變動缺口仍待原責任接續。

- **P3 原收尾證據與未驗項保留：**[S16 收尾](PLAN.md#s16-w03)的頭像、附件保存／下載／重開、原檔名及個人 Vertex key 短生成已有證據。2026-10-25 新增 v4 真機 OTA 回退／恢復，以及手機建待辦→Web 完成→手機原頁自動顯示完成／提醒停止。Web 撤銷後手機回到登入頁、重開不復活亦已核。通知遺漏指定待辦 ID 已局部修正，共用按鈕改為「重設密碼」；單項檢查及兩端匯出通過，已交付原 Web／相容 OTA。仍欠手機本人 key 輸入、跨端 Agent／確認接續、另一身份的真機隔離及照護通知目標核權；四 Agent／協作者 PR 不動。

- **四項指定修補已獲准正常合併，真機驗收仍待補。**PR #286 已保留 #288／#289 照片聊天接線及最新交付記錄；受影響照片恢復／client 契約補驗通過，沿獨立覆核及遠端保護規則完成來源合併，不部署、不把空 CI 或合併當真機通過。精確版本與保留失敗見 [FIX-FOUR01](PLAN.md#four-fix01)。

- **共用互動修正已收束發布。**2026-10-26，B 已合併 #328／#329；`330a905` 修正準備單舊保存提示及 Web 聊天縮放下的閱讀錨點，Web／v4 相容 Android OTA 已更新。沿用原 PR 驗證，不重跑功能／設備測試；3 秒合併保存及其他既有成果保留，詳見[共用互動](PLAN.md#shared-interaction01)。API／worker 及協作者 Agent PR 未改動。
- **iOS 本機接線與發佈工具已合併，TestFlight 等待 Apple 前置。**#272及#274～#278已合併；本機檢查、整合iOS匯出及APNs掛載配置核對通過。尚須Apple團隊／簽署／APNs配置、IPA與真機驗收；未部署或啟用通知。範圍保留於[iOS計劃](PLAN.md#p3-ios)，不因此重跑測試。
- **附件庫 Android 檔名修正已交付：**#308／`35ad214` 的同一匯出資產經確認的直接 TLS 上傳完成，preview OTA group `39974363` 已發布；手機選檔保留原檔名通過，未送出測試草稿已清理。先前 EAS 兩次逾時保留，不重跑已驗保存／下載；Web 原證據保留，見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。

- **MODEL-SELF03 已發布，手機草稿捨棄補核通過。**新關注圖標出現後，捨棄模式／供應商草稿、離頁及返回恢復平台模式，零key輸入／保存／模型。精確裝置OTA ID與真key流程未驗。另將其餘原生底欄接回Web同一導航metadata，保留版面／手勢；兩項定向檢查通過，這批接線已隨 `382d217` 發布、裝置效果待核，見 [MODEL03](PLAN.md#model-self03)。#269 準備單退出修正及 #259 附件回看已合併；頭像啟用狀態見下項；#254／#262／#263／#265／#273 仍由協作者處理。

- **照片聊天及欄位提示已發布：**#287／#288 接通照片直接送出、原圖重讀及附件庫同 ID 重用；原生單行空欄位改用 placeholder，減少等待浮動標籤量度。原站與 Android OTA 已發布，真機效果／真模型照片品質未驗；其後 #286 的已合併 Server 恢復修正已隨 `652edad` 同版組裝部署，前端真機結論仍未補。詳見[CHAT-PHOTO01](PLAN.md#chat-photo01)。
- **頭像已在原站啟用：**#300／`0ebfbfa` 的 API／worker 同版部署、release flag／寫入 true 及健康讀回通過。Web 保存／重開／移除、Android v4 選圖／裁切／EXIF／取消已有證據；未向真孩子保存測試頭像。已有還原／清理證據復用，見[AVATAR-01](PLAN.md#avatar-01)。

- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色聯合補驗依使用者指示延後：**等待四個Agent真正完成且協作者先自行檢查，再安排最後引用／審核及接續流程。本聊天不提前重跑或接管修改；`delivery_review_incomplete`失敗現場、單頁PDF已通過證據及長來源／多模態缺口保留。本地入口仍可供協作者使用，恢復條件及證據只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型 Vertex 向量補接已發布：**使用者批准最小增補；共用 v4 設定可選本人 Vertex key／專案／地區，沿原模型及 1024 維索引，沒有平台回退。限定設定／SDK／表單檢查及 Web／Android 匯出通過；一次真 key 向量返回 1024 維／2 input tokens，臨時 key／新增權限已清理。先前 Gemini 向量地區拒絕保留，不泛化為所有用戶限制。PR #317／`34f80a9` 已更新 API／worker／Web 及同 runtime Android OTA；使用者已確認手機出現 Vertex AI 選項；一條正式 routing／gateway 離線核對亦確認設定重讀、本人用量及原嘗試不重送；本人 Vertex 完整 Agent／RAG 已由 MODEL03 的後續真模型補核；手機 key 輸入仍待人工，四 Agent 聯合驗收繼續延後。[證據](artifacts/verification/PERSONAL_VERTEX_EMBEDDING_20261025.json)。
- **Android 未全數驗收：**APK v4 覆蓋安裝、原登入／資料保留、附件、相容 OTA 回退／恢復及一項跨端待辦已有證據；一則指定 FCM 沿原結果，終態不重發復用既有 Firestore 核對。其餘精確未驗項只見 [S16](PLAN.md#s16-w03)，不重跑已通過流程，不以合併或發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成；Android 尚欠驗收不阻塞 iOS 開工。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-26 01:23 香港時間：**`14e0f60` 已更新 API／worker 至 `663125d`，只將搜尋工具固定額度說明改為當輪實際餘額；保留前批語音修正／Prompt Pack 0.1.55。候選正式組裝及公開 health 通過。該批 Web、Android、頭像開關及配額保持原值；零模型／通知／資料遷移。前版 `d5be355` 與 0600 配置供回退；[精確交付及腳本編碼失敗](artifacts/verification/KNOWLEDGE_RETRIEVAL_CHECK_20261026.json)。Web／Android 最新觀察見下項。

**2026-10-26 14:12 香港時間，Web／Android：**`330a905` 的 #328／#329 已交付；Web `27a5c90` 公開 index hash／health 通過，API／worker 保持上項 `663125d`。Android preview OTA group `4f3f95a3`／update `01a176d6` 已發布，31 檔約 13.09 MiB，沿 APK v4 runtime `0c5c868…`，毋須重裝。發布未代驗設備效果；[同一交付證據](artifacts/verification/SHARED_READING_DELIVERY_20261024.json)保存原批及本批結果。

**已有 Android 證據保留：**使用者已確認個人模型表單有 Vertex AI 選項；v4 回退／恢復、附件、跨端待辦及撤權已核，不重測。本人 key 輸入／跨端表單及其餘未驗項仍見 [S16](PLAN.md#s16-w03)，不因本次 OTA 改寫為通過。

**回退、備份與容量：**本次保留前版 Web `e813692` 及 0600 的 Compose 配置。API／worker 沒有更換，回退仍須保留 v4 個人設定 reader，不能用舊資料覆蓋新設定／收據。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。原生備份最近觀察仍為 2026-10-23 READY、未還原；本批部署前約 10.28 GiB 可用，未擴容／清正式資料。

**主機期限，2026-10-26 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
