# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **四項指定修補已獲准正常合併，真機驗收仍待補。**PR #286 已保留 #288／#289 照片聊天接線及最新交付記錄；受影響照片恢復／client 契約補驗通過，沿獨立覆核及遠端保護規則完成來源合併，不部署、不把空 CI 或合併當真機通過。精確版本與保留失敗見 [FIX-FOUR01](PLAN.md#four-fix01)。

- **共用介面及準備單背景保存已發布。**2026-10-24 master `015deb8`（#284）已相容更新 API／worker／Web 及 Android OTA。連點不鎖、約 3 秒合併及離頁背景保存有定向證據；來源狀態、附件庫畫面、聊天分頁及直接錄音等前批成果保留。手機實際效果待核，詳見[共用互動](PLAN.md#shared-interaction01)。照片聊天已隨下述批次交付；接續[頭像](PLAN.md#avatar-01)，保留協作者未合併 Agent 修改。
- **iOS 本機接線與發佈工具已合併，TestFlight 等待 Apple 前置。**#272及#274～#278已合併；本機檢查、整合iOS匯出及APNs掛載配置核對通過。尚須Apple團隊／簽署／APNs配置、IPA與真機驗收；未部署或啟用通知。範圍保留於[iOS計劃](PLAN.md#p3-ios)，不因此重跑測試。
- **附件庫 API 及畫面已交付，實際清單待驗：**`a84f349` 清單 API／兩索引沿原部署，Web／APK v3 相容 OTA 已含新畫面。原失敗及 GUI／型別限制保留，見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。私人來源沒有自動向量索引作業，畫面分清保存、可讀及未建立向量索引。

- **MODEL-SELF03 已發布，手機草稿捨棄補核通過。**新關注圖標出現後，捨棄模式／供應商草稿、離頁及返回恢復平台模式，零key輸入／保存／模型。精確裝置OTA ID與真key流程未驗。另將其餘原生底欄接回Web同一導航metadata，保留版面／手勢；兩項定向檢查通過，這批接線已隨 `382d217` 發布、裝置效果待核，見 [MODEL03](PLAN.md#model-self03)。#269 準備單退出修正及 #259 附件回看已合併；#264 頭像來源亦已合併但維持停用；#254／#262／#263／#265／#273 仍由協作者處理。

- **照片聊天及欄位提示已發布：**#287／#288 接通照片直接送出、原圖重讀及附件庫同 ID 重用；原生單行空欄位改用 placeholder，減少等待浮動標籤量度。原站與 Android OTA 已發布，真機效果／真模型照片品質未驗；其後 #286 恢復修正由協作者合併，尚未隨本批部署。詳見[CHAT-PHOTO01](PLAN.md#chat-photo01)。
- **頭像接續：**claim 查回、匯出及 Linux codec 核對已完成；隔離還原新增有界放棄／副本清理入口，防止遲到寫入重建已放棄副本，來源保持不變。受影響 strict 型別、連貫合成流程，以及一次真 Firestore／Storage 副本競爭／放棄／遲到寫入核對通過，原失敗保留。仍 `release=false`，產品准入／清理及完整隔離恢復與設備門檻未通、未上線；精確接續見[AVATAR-01](PLAN.md#avatar-01)。

- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色聯合補驗依使用者指示延後：**等待四個Agent真正完成且協作者先自行檢查，再安排最後引用／審核及接續流程。本聊天不提前重跑或接管修改；`delivery_review_incomplete`失敗現場、單頁PDF已通過證據及長來源／多模態缺口保留。本地入口仍可供協作者使用，恢復條件及證據只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持現有 Gemini／1024維索引，可另填本人 key，不借平台額度。其他向量模型及 Vertex Express 直接向量接線不宣稱已完成。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成；Android 尚欠驗收不阻塞 iOS 開工。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-24 14:32 UTC 原站：**API／worker／Web 已切至 `chat-photo-9012933`（API映像`e23de93`、Web映像`c09400c`）；正式組裝及公開首頁hash／API health通過。照片 runtime 以現網組裝加兩項注入，頭像／APNs保持原來未啟用狀態；首次候選缺依賴及 Dockerfile 修正均保留於[交付證據](artifacts/verification/CHAT_PHOTO_DELIVERY_20261024.json)。零模型／通知／資料遷移／配額修改。

**Android，2026-10-24 14:35 UTC：**相容 OTA group `327ad4ca` 已一次發布至preview，runtime沿APK v3，毋須重裝。手機連線但鎖屏，沒有強制重啟或改草稿，實際套用與提示文字時序未驗。下次新APK的品牌icon／splash配置已備妥並本機核對；尚未建置，v3不會靠OTA改變原生圖標。

**回退、備份與容量：**保留API映像`f83cb54`、Web映像`4c665eb`及兩份0600的`before-chat-photo-9012933`配置；前端變更依賴相容照片API，回退須成套處理。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。最近核對原生備份仍為2026-10-23 22:53 UTC READY、保留至11月6日，未還原；部署前磁碟約11 GiB可用，未擴容或刪資料／備份。

**主機期限，2026-10-23 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
