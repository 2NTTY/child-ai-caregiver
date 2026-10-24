# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **四項指定修補已交草稿 PR #286，仍待正式驗收。**照片草稿／讀取提示、APNs 過時失效及原生 PDF 的原碼與 #284 fixture 已覆核；本次正常合入 master #285／#287；本修補碼測不變，照片後端原碼／記錄原樣保留、不代驗，原紅與未驗不改。維持草稿、不合併或部署；精確結果及下一步見 [FIX-FOUR01](PLAN.md#four-fix01)。

- **共用介面及準備單背景保存已發布。**2026-10-24 master `015deb8`（#284）已相容更新 API／worker／Web 及 Android OTA。連點不鎖、約 3 秒合併及離頁背景保存有定向證據；來源狀態、附件庫畫面、聊天分頁及直接錄音等前批成果保留。手機實際效果待核，詳見[共用互動](PLAN.md#shared-interaction01)。接續[照片聊天](PLAN.md#chat-photo01)不重疊接點及[頭像](PLAN.md#avatar-01)，保留協作者未合併 Agent 修改。
- **iOS 本機接線與發佈工具已合併，TestFlight 等待 Apple 前置。**#272及#274～#278已合併；本機檢查、整合iOS匯出及APNs掛載配置核對通過。尚須Apple團隊／簽署／APNs配置、IPA與真機驗收；未部署或啟用通知。範圍保留於[iOS計劃](PLAN.md#p3-ios)，不因此重跑測試。
- **附件庫 API 及畫面已交付，實際清單待驗：**`a84f349` 清單 API／兩索引沿原部署，Web／APK v3 相容 OTA 已含新畫面。原失敗及 GUI／型別限制保留，見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。私人來源沒有自動向量索引作業，畫面分清保存、可讀及未建立向量索引。

- **MODEL-SELF03 已發布，手機草稿捨棄補核通過。**新關注圖標出現後，捨棄模式／供應商草稿、離頁及返回恢復平台模式，零key輸入／保存／模型。精確裝置OTA ID與真key流程未驗。另將其餘原生底欄接回Web同一導航metadata，保留版面／手勢；兩項定向檢查通過，這批接線已隨 `382d217` 發布、裝置效果待核，見 [MODEL03](PLAN.md#model-self03)。#269 準備單退出修正及 #259 附件回看已合併；#264 頭像來源亦已合併但維持停用；#254／#262／#263／#265／#273 仍由協作者處理。

- **照片聊天接線中：**使用者已允許照片專用 runtime／產品 Agent 修改，保留協作者 PR。後端原圖與審核接線已有定向合成證據，前端傳送及發布待完成；手機欄位說明延遲併入共用前端修正。詳見[CHAT-PHOTO01](PLAN.md#chat-photo01)。
- **頭像並行候選：**AVATAR-01 已按契約整合本人／孩子 UI 與 server source；本機真 operator 的 avatar partial-staging 中斷／恢復有合成證據。仍 `release=false`／`NOT_FULLY_RECOVERABLE`，domain／完整 TS、unknown recovery及原生部署門檻未通，未上線；精確接續見[AVATAR-01](PLAN.md#avatar-01)。

- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色聯合補驗依使用者指示延後：**等待四個Agent真正完成且協作者先自行檢查，再安排最後引用／審核及接續流程。本聊天不提前重跑或接管修改；`delivery_review_incomplete`失敗現場、單頁PDF已通過證據及長來源／多模態缺口保留。本地入口仍可供協作者使用，恢復條件及證據只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持現有 Gemini／1024維索引，可另填本人 key，不借平台額度。其他向量模型及 Vertex Express 直接向量接線不宣稱已完成。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成；Android 尚欠驗收不阻塞 iOS 開工。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-24 13:32 UTC 原站：**API／worker／Web 已切至`preparation-015deb8`（API映像`f83cb54`、Web映像`4c665eb`），先核相容 API 健康再更新客戶端。公開首頁 hash 與交付包相同，首頁／API health HTTP200；沒有模型、通知、資料遷移或配額修改，頭像仍停用。[本次交付](artifacts/verification/PREPARATION_BACKGROUND_DELIVERY_20261024.json)保留回退及原失敗；較早[附件 API 證據](artifacts/verification/ANDROID_MODEL_CLOSEOUT_20261024.json)不改寫。

**Android，2026-10-24 13:37 UTC：**APK v3（build `c678d433`）已安裝，`015deb8`相容 OTA group `a46b49b0`發布至preview；runtime與v3相同，毋須重裝。首次 Expo 資產處理逾時、查無新發布後補送同產物一次成功。未強制重啟手機，實際套用及新畫面效果未驗。下次 APK 處理品牌 icon／splash，原[草稿與導航證據](artifacts/verification/SHARED_NATIVE_NAVIGATION_20261024.json)保留。

**回退、備份與容量：**本次保留API映像`c75454d`、Web映像`6d4bff9`及兩份0600的`before-preparation-015deb8`配置備份；新增批次命令不改保存格式，舊單項命令相容。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。最後核對原生備份為2026-10-23 22:53 UTC READY、保留至11月6日；未還原。部署前可用空間約10.6 GiB，沒有擴容或刪除資料／備份。

**主機期限，2026-10-23 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
