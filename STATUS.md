# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **當前收 Android／頭像／附件庫／個人模型：**[S16 收尾](PLAN.md#s16-w03)的頭像成熟裁切已合併 #305、更新原 Web；保存／重開／移除及附件庫下載沿已有證據。包含原生裁切、圖標及 splash 修正的 APK v4 已一次建置並核對同簽署；使用者已覆蓋安裝；v4 登入／孩子資料、原生裁切／EXIF／預覽及取消已核，沒有向 v3 強推 OTA。一份 TXT 的保存、聊天／附件庫下載至系統分享及重開讀回已核；檔名修正仍待 Expo 發布，個人 key 成功流程仍待可用憑證／環境。四 Agent／協作者 PR 不動。

- **四項指定修補已獲准正常合併，真機驗收仍待補。**PR #286 已保留 #288／#289 照片聊天接線及最新交付記錄；受影響照片恢復／client 契約補驗通過，沿獨立覆核及遠端保護規則完成來源合併，不部署、不把空 CI 或合併當真機通過。精確版本與保留失敗見 [FIX-FOUR01](PLAN.md#four-fix01)。

- **共用介面及準備單背景保存已發布。**2026-10-24 master `015deb8`（#284）已相容更新 API／worker／Web 及 Android OTA。連點不鎖、約 3 秒合併及離頁背景保存有定向證據；來源狀態、附件庫畫面、聊天分頁及直接錄音等前批成果保留。手機實際效果待核，詳見[共用互動](PLAN.md#shared-interaction01)。照片聊天已隨下述批次交付；接續[頭像](PLAN.md#avatar-01)，保留協作者未合併 Agent 修改。
- **iOS 本機接線與發佈工具已合併，TestFlight 等待 Apple 前置。**#272及#274～#278已合併；本機檢查、整合iOS匯出及APNs掛載配置核對通過。尚須Apple團隊／簽署／APNs配置、IPA與真機驗收；未部署或啟用通知。範圍保留於[iOS計劃](PLAN.md#p3-ios)，不因此重跑測試。
- **附件庫 Android 檔名修正已合併，發布受阻：**#308／`35ad214` 沿既有 SDK 保留選取檔名；必要檢查、匯出及 v4 runtime 相容通過。EAS 兩次資產處理逾時，查回確認未發布，停止重試；本人解鎖後，原 v4 保存／下載／重開讀回已通過，只欠修正版檔名真機核對。Web 原證據保留，見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。

- **MODEL-SELF03 已發布，手機草稿捨棄補核通過。**新關注圖標出現後，捨棄模式／供應商草稿、離頁及返回恢復平台模式，零key輸入／保存／模型。精確裝置OTA ID與真key流程未驗。另將其餘原生底欄接回Web同一導航metadata，保留版面／手勢；兩項定向檢查通過，這批接線已隨 `382d217` 發布、裝置效果待核，見 [MODEL03](PLAN.md#model-self03)。#269 準備單退出修正及 #259 附件回看已合併；頭像啟用狀態見下項；#254／#262／#263／#265／#273 仍由協作者處理。

- **照片聊天及欄位提示已發布：**#287／#288 接通照片直接送出、原圖重讀及附件庫同 ID 重用；原生單行空欄位改用 placeholder，減少等待浮動標籤量度。原站與 Android OTA 已發布，真機效果／真模型照片品質未驗；其後 #286 的已合併 Server 恢復修正已隨 `652edad` 同版組裝部署，前端真機結論仍未補。詳見[CHAT-PHOTO01](PLAN.md#chat-photo01)。
- **頭像已在原站啟用：**#300／`0ebfbfa` 的 API／worker 同版部署、release flag／寫入 true 及健康讀回通過。Web 保存／重開／移除、Android v4 選圖／裁切／EXIF／取消已有證據；未向真孩子保存測試頭像。已有還原／清理證據復用，見[AVATAR-01](PLAN.md#avatar-01)。

- **本地開發入口可用：**`npm run agent:local` 使用目前分支的正式 Web／API／四角色接點及隔離持久資料，不需部署 GCP。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；新增相容模型與獨立向量 key 路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。
- **角色聯合補驗依使用者指示延後：**等待四個Agent真正完成且協作者先自行檢查，再安排最後引用／審核及接續流程。本聊天不提前重跑或接管修改；`delivery_review_incomplete`失敗現場、單頁PDF已通過證據及長來源／多模態缺口保留。本地入口仍可供協作者使用，恢復條件及證據只見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型：**由用戶提供憑證與模型 ID 自行嘗試，沒有地域或 metadata 預驗門檻。聊天可用 Google 或相容接口；向量維持 Gemini／1024維索引，可另填本人 key，不借平台額度。2026-10-25 對既有測試 key 補正式香港 VM 核對，仍返回 `model_region_unavailable`，未呼叫 embedding 或改設定；成功流程仍待可用憑證／環境，不推論所有用戶 key 均不可用。[本次結果](artifacts/verification/ANDROID_PICKER_FILENAME_20261025.json)。
- **Android 未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 已有證據；跨端、媒體／附件、照護通知完成停止、OTA 回退及各包餘下真機項按 [S04～S17](PLAN.md#s04-w01) 追蹤。使用者已允許先合併、未驗項後續追蹤，不以合併或 OTA 發布當真機通過。
- **其他邊界：**正式資料使用 Firestore；家庭多人留 P4。OPT／LAY 成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)未完成；Android 尚欠驗收不阻塞 iOS 開工。只補必要驗證，不全量、Computer Use 或重做設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-25 10:23 UTC 原站：**Web 已更新 `avatar-crop-1f07fab`（映像 `0da4e1f`），公開 index hash／API health 通過；API／worker 維持 `avatar-enable-0ebfbfa`（`c3b149c`），頭像已啟用，APNs 未啟用。[本批交付](artifacts/verification/AVATAR_CROP_DELIVERY_20261025.json)。零模型／通知／資料遷移／配額修改，保留前版 Web 回退。

**Android，2026-10-25：**APK v4 已覆蓋安裝（build `9f43f925`，source `1f07fab`）；同簽署、runtime `0c5c868…`、登入／孩子資料及原生裁切已核，新圖標／splash 資源有靜態證據，實際啟動畫面效果未另驗。[APK](https://expo.dev/artifacts/eas/tqzvvQXmWmc7RqelWQgCcJoXiTrfBmDEKET4fjyLda8.apk)。檔名修正 `35ad214` 的相容 OTA 尚未發布成功，現場仍為原 v4；v3 runtime 不同，沒有強推更新。詳見[設備證據](artifacts/verification/ANDROID_V4_DEVICE_20261025.json)及[本次阻塞](artifacts/verification/ANDROID_PICKER_FILENAME_20261025.json)。

**回退、備份與容量：**本次保留相容 API／worker `4159605` 及 0600 的 `compose.env.before-avatar-enable-0ebfbfa`。關寫入仍保留頭像 reader／cleanup；已開放新 schema／journal，不能回退至 `e23de93` 等舊讀取器。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#avatar-deployment-gate)。最近原生備份觀察仍為 2026-10-23 READY，未還原；前批部署前約 10.5 GiB 可用，未擴容／清正式資料。

**主機期限，2026-10-25 核對：**原 e2-small VM 仍運行，自動停止時間維持 **2026-11-06 13:33:50 香港時間**；本次沒有續期或修改規格。舊 SQL 容器為停止狀態，正式 API／worker 使用 Firestore。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：使用者於2026-10-23回報剩餘90%，當時距重置不到五小時；未自行推算目前餘額或重置狀態。
