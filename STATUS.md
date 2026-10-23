# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **附件回看獨立候選：**#253 已合併；新增附件來源放獨立分支，不回寫舊 PR。唯讀私人清單及簡潔詳情彈窗已接線，定向合成／DOM 有證據；型別檢查 exit137、build／GUI及實際 API／索引仍待驗，尚未部署。唯一接續點見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。

- **MODEL-SELF03 已合併及發布。**#260 的 `1282e09` 已更新原站及 Android preview OTA；共用 v3 表單、相容 API 地址／key／模型 ID、獨立 Gemini 向量 key 及七項限制保留新設計。最低接線、建置及部署核對已通過；真 key 與新表單真機操作未驗，見 [MODEL03](PLAN.md#model-self03)。#254 與 #259 仍由協作者處理，沒有修改或合併其分支。
- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色未完成項：**官方 PDF 第3頁已整理、審核及本地發布；最終聊天引用新版的單次補驗因 `model_limit` 停止。長來源／圖片多模態仍欠角色能力，不以單頁 PDF 當全部通過；原失敗及協作者責任見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持現有 Gemini／1024維索引，可另填本人 key，不借平台額度。其他向量模型及 Vertex Express 直接向量接線不宣稱已完成。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4、iOS 暫緩。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-23 14:00 UTC 原站：**API／worker 為 `model-ui-1282e09`（映像 `b9c358c`），均 healthy；Web 同 tag（映像 `e9dd4c8`）運行，公開首頁 hash 與產物一致，API health 為200。四個訊息歷史索引 READY，API／worker 一致啟用歷史接線；沒有業務 backfill、模型／通知驗收或配額變更。詳見[交付證據](artifacts/verification/MODEL_SELF03_DELIVERY_20261023.json)。

**Android，2026-10-23 13:59 UTC：**同版 preview OTA 群組 `b18efe75-f8ed-4ced-9f66-a5e3b4d961ff` 已發布；APK versionCode 2、runtime `33699576537bf6f4081bddfb9c8807cd6bdef3ee` 不變，毋須新 APK。此次未做真機操作，不能假定手機已下載／套用。上一版平台設定保存／重開讀回的既有結果仍見[前次證據](artifacts/verification/MODEL_SELF02_DELIVERY_20261020.json)。

**回退、備份與容量：**切換前已保存0600配置副本，保留舊映像；新 runtime 已啟動，不能直接退回不認識新資料欄位的舊 API／worker。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。原生備份最新核對為2026-10-22 22:44 UTC READY、保留至11月5日；只讀 metadata，未還原。部署後可用空間約10.66 GiB，沒有擴容或刪除資料／備份。

**主機期限，2026-10-23 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
