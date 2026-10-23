# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **MODEL-SELF03 及局部修正已發布。**#267的`4bfdf98`已更新Web及Android OTA，修正草稿捨棄及共用關注圖標；兩項針對性React檢查通過。手機先前已見相容服務、獨立向量key及七項限制；最新修正版真機補核、真key保存／呼叫未驗，見 [MODEL03](PLAN.md#model-self03)。#254／#259及#262～#265仍由協作者處理。
- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色未完成項：**2026-10-23新隔離環境的官方 PDF 第3頁已真整理、獨立審核及發布；最後聊天讀文件及搜尋成功，但引用修正耗盡當輪額度，停於 `delivery_review_incomplete`，沒有重送。原快照缺失與本次失敗分開記錄，先接協作者審核／預算修正再補一條聊天；長來源／圖片多模態仍欠角色能力。證據及下一步只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持現有 Gemini／1024維索引，可另填本人 key，不借平台額度。其他向量模型及 Vertex Express 直接向量接線不宣稱已完成。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4、iOS 暫緩。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-23 15:39 UTC 原站：**Web已更新為`model-draft-4bfdf98`（映像`241ffa8`），healthy，公開首頁hash與產物一致，API health為200。API／worker仍是`model-ui-1282e09`（映像`b9c358c`），沒有重啟或改設定；既有四個歷史索引結果沿用，不重建。零模型、通知、資料遷移及配額修改，見[本次交付](artifacts/verification/MODEL_SELF03_DRAFT_DELIVERY_20261023.json)。

**Android，2026-10-23 15:39 UTC：**`4bfdf98`相容preview OTA群組`df51a917-ee74-4e03-8fbc-db472314007d`已發布，runtime仍為`33699576537bf6f4081bddfb9c8807cd6bdef3ee`，毋須新APK。15:08的手機核對證明前次新版欄位可見並發現草稿問題；最新修正版尚未真機補核，不假定已套用。原失敗及清理見[補核證據](artifacts/verification/MODEL_SELF03_DRAFT_RESET_20261023.json)，沒有真key／模型驗收。

**回退、備份與容量：**本次另存0600 Web配置副本並保留前版Web映像；API／worker相容reader不變，不退回更舊runtime。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。原生備份最新核對仍為2026-10-22 22:44 UTC READY、保留至11月5日；未還原。本次部署後可用空間約10.62 GiB，沒有擴容或刪除資料／備份。

**主機期限，2026-10-23 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
