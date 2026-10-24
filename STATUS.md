# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **Android 收尾交付已準備，接續來源狀態／附件畫面及頭像。**2026-10-24 [S16-W03](PLAN.md#s16-w03)：手機設定同值保存及重開讀回通過；唯一免費 APK v3 已成功，同簽署／runtime 核對通過，已提供安裝連結，真機覆蓋安裝仍待驗。master 新增 `d7ef061` 只有 README，不影響本批 `c58459a` 產品來源。下一步見[來源狀態](PLAN.md#source-readiness01)與[頭像](PLAN.md#avatar-01)。
- **iOS 本機接線與發佈工具已合併，TestFlight 等待 Apple 前置。**#272及#274～#278已合併；本機檢查、整合iOS匯出及APNs掛載配置核對通過。尚須Apple團隊／簽署／APNs配置、IPA與真機驗收；未部署或啟用通知。範圍保留於[iOS計劃](PLAN.md#p3-ios)，不因此重跑測試。
- **附件庫 API 已上線，Web 畫面及 APK 安裝待接續：**`a84f349` 的 11 檔清單接線已部署原 API／worker，兩索引 READY，候選與有界 SDK 查詢／health 通過。Web 仍是舊畫面包；APK v3 含新畫面但未驗安裝／清單。原失敗及 GUI／型別限制保留，見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。私人來源沒有自動向量索引作業，新增狀態標示會如實分清已保存及可檢索，不造假索引完成。

- **MODEL-SELF03 已發布，手機草稿捨棄補核通過。**新關注圖標出現後，捨棄模式／供應商草稿、離頁及返回恢復平台模式，零key輸入／保存／模型。精確裝置OTA ID與真key流程未驗。另將其餘原生底欄接回Web同一導航metadata，保留版面／手勢；兩項定向檢查通過，這批接線尚未發布，見 [MODEL03](PLAN.md#model-self03)。#269 準備單退出修正及 #259 附件回看已合併；#264 頭像來源亦已合併但維持停用；#254／#262／#263／#265／#273 仍由協作者處理。

- **頭像並行候選：**AVATAR-01 已按契約整合本人／孩子 UI 與 server source；本機真 operator 的 avatar partial-staging 中斷／恢復有合成證據。仍 `release=false`／`NOT_FULLY_RECOVERABLE`，domain／完整 TS、unknown recovery及原生部署門檻未通，未上線；精確接續見[AVATAR-01](PLAN.md#avatar-01)。

- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色聯合補驗依使用者指示延後：**等待四個Agent真正完成且協作者先自行檢查，再安排最後引用／審核及接續流程。本聊天不提前重跑或接管修改；`delivery_review_incomplete`失敗現場、單頁PDF已通過證據及長來源／多模態缺口保留。本地入口仍可供協作者使用，恢復條件及證據只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持現有 Gemini／1024維索引，可另填本人 key，不借平台額度。其他向量模型及 Vertex Express 直接向量接線不宣稱已完成。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成；Android 尚欠驗收不阻塞 iOS 開工。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-24 12:10 UTC 原站：**API／worker已更新為`attachment-a84f349`（映像`c75454d`），healthy，公開health HTTP200／Firestore；兩個附件索引READY並通過真SDK有界查詢。Web仍為`model-draft-4bfdf98`（映像`241ffa8`），沒有更新畫面。零模型、通知、資料遷移及配額修改，頭像仍停用，見[本次交付](artifacts/verification/ANDROID_MODEL_CLOSEOUT_20261024.json)。

**Android，2026-10-24：**原 APK v2 的`4bfdf98`設定保存／重開已補核；新 APK v3（build `c678d433`、source `c58459a`）於12:07 UTC完成並核同簽署及runtime。已交安裝連結，尚未覆蓋安裝；不發布不相容OTA，不把建置通過當畫面／模型通過。原[草稿與導航證據](artifacts/verification/SHARED_NATIVE_NAVIGATION_20261024.json)保留。

**回退、備份與容量：**保留原API映像`b9c358c`及0600的`compose.env.before-attachment-a84f349`；此清單包不改保存格式。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。最新原生備份為2026-10-23 22:53 UTC READY、保留至11月6日；未還原。部署前可用空間約10.6 GiB，沒有擴容或刪除資料／備份。

**主機期限，2026-10-23 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
