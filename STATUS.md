# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **iOS 媒體程式就緒：[S12-W01](PLAN.md#s12-w01)。**基礎配置及共用入口已由 #272 合併（`9f500a5`）。HEIC 相容副本已接、3 項 adapter 檢查通過，錄音／檔案／分享復用既有接點；沒有 IPA／發布／真機證據。付費簽署團隊待定，下一包 APNs 與其後固定更新依 [iOS 計劃](PLAN.md#p3-ios) 接續，本輪只用 Astra。
- **附件回看來源已合併：**#259 已整合至 master `a84f349`，不回寫舊 #253。唯讀私人清單及簡潔詳情彈窗已接線，定向合成／DOM 有證據；型別檢查 exit137、build／GUI及實際 API／索引仍待驗，尚未部署。唯一接續點見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。

- **MODEL-SELF03 已發布，手機草稿捨棄補核通過。**新關注圖標出現後，捨棄模式／供應商草稿、離頁及返回恢復平台模式，零key輸入／保存／模型。精確裝置OTA ID與真key流程未驗。另將其餘原生底欄接回Web同一導航metadata，保留版面／手勢；兩項定向檢查通過，這批接線尚未發布，見 [MODEL03](PLAN.md#model-self03)。#269 準備單退出修正及 #259 附件回看已合併；#254／#262～#265 仍由協作者處理。
- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色聯合補驗依使用者指示延後：**等待四個Agent真正完成且協作者先自行檢查，再安排最後引用／審核及接續流程。本聊天不提前重跑或接管修改；`delivery_review_incomplete`失敗現場、單頁PDF已通過證據及長來源／多模態缺口保留。本地入口仍可供協作者使用，恢復條件及證據只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持現有 Gemini／1024維索引，可另填本人 key，不借平台額度。其他向量模型及 Vertex Express 直接向量接線不宣稱已完成。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成；Android 尚欠驗收不阻塞 iOS 開工。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-23 15:39 UTC 原站：**Web已更新為`model-draft-4bfdf98`（映像`241ffa8`），healthy，公開首頁hash與產物一致，API health為200。API／worker仍是`model-ui-1282e09`（映像`b9c358c`），沒有重啟或改設定；既有四個歷史索引結果沿用，不重建。零模型、通知、資料遷移及配額修改，見[本次交付](artifacts/verification/MODEL_SELF03_DRAFT_DELIVERY_20261023.json)。

**Android，2026-10-23 15:39 UTC發布／10月24日香港時間補核：**`4bfdf98`相容preview OTA群組`df51a917-ee74-4e03-8fbc-db472314007d`沿APK v2 runtime；手機先仍載入舊圖標，重開取得新圖標後草稿捨棄流程通過，登入保留。未取得精確裝置OTA ID、不宣稱其他頁面或真key驗收通過。[本次補核](artifacts/verification/SHARED_NATIVE_NAVIGATION_20261024.json)保留舊版觀察及XML擷取失敗；沒有新增APK／OTA、模型或通知。

**回退、備份與容量：**本次另存0600 Web配置副本並保留前版Web映像；API／worker相容reader不變，不退回更舊runtime。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。原生備份最新核對仍為2026-10-22 22:44 UTC READY、保留至11月5日；未還原。本次部署後可用空間約10.62 GiB，沒有擴容或刪除資料／備份。

**主機期限，2026-10-23 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
