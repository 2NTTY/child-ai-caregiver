# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **當前：Android交付收束，尚未全數驗收／合併。** 原站及APK v2已接聊天、跨端原運行查回、語音、照片、通用附件、FCM及固定更新入口；使用者已確認覆蓋安裝後正常開啟、登入及原資料保留。相機開啟／取消、Word草稿選取、錄音預聽及一則指定FCM顯示已有證據，不能擴成完整流程通過。
- **504修正已部署。** 管理員政策v3：每人每日200／全站400；每輪8生成／16工具／4查詢、互動300秒；單次模型90秒、最多額外3次重試。每次重試仍計入原run及每日額度，不重做已成功工具或未知副作用。原用量未清零，沒有重送舊訊息、真模型或通知；本機必要流程通過不代表Google服務已恢復。
- **餘下Android門檻：**使用者首條正常聊天及重開讀回；Web／Android接續與確認；Web錄音／選檔、跨端播放與附件下載／PDF分享；照護通知目標／完成停止；相容OTA回退及draft #229／#234～#239依賴合併。最新OTA及前景網絡修正已發布，手機鎖定而未追加驗證。詳細gate只見PLAN各包。
- **既有成果：**正式前後端共同使用Firestore、執行退出SQL；P2 review修正及Web管理後台已部署。家庭多人留P4，OPT／LAY既有成果保留；STR01與協作者#214～#216不接管。[原生每日備份真還原](PLAN.md#p2-backup-followup)按使用者要求延後，沒有把備份metadata核對當成還原通過。
- **收尾邊界：**完成Android後先報告及停下；本人key／自選模型／限額、本地正式Agent測試入口待使用者另行定案，iOS暫緩。只做最低必要檢查，不全量、Computer Use或重做設計；需本人／手機的項目保留待驗。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-18 11:58 UTC 原站：**API／worker為`policy-adaf08f`（映像`fc7ae7e`），Web為`retry-adaf08f`（映像`373477f`）；服務健康，公開HTML hash與同版產物一致，Web切換未重啟API／worker。管理員政策由v2經原服務明確保存為v3，生效值見上文；帳目未變、沒有資料遷移。舊政策缺欄位仍按原90秒／30秒／零重試讀取，避免部署默改歷史設定。

**Android：**APK v0.1.0／versionCode 2不變；相容OTA群組`a209afce-39ac-47fc-821b-d13ff949ac87`已發布，來源`adaf08f`、runtime `33699576537bf6f4081bddfb9c8807cd6bdef3ee`。毋須覆蓋安裝，最新裝置接收仍待核。部署及失敗／未驗證據見[S04 EV](artifacts/verification/S04_W01_ANDROID_FOUNDATION_20261015.json)；語音／附件與通知詳情沿[S12 EV](artifacts/verification/S12_CHAT_FILES_20261018.json)、[S13 EV](artifacts/verification/S13_ANDROID_PUSH_PREPARATION_20261018.json)。

回退保留既有映像及受保護Compose副本；新政策、附件、語音與通知資料寫入後，必須使用相容reader／worker，不能直接退回不認識新欄位的舊API。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。只讀最近READY原生備份metadata（2026-10-17 22:05 UTC，保留至10月31日），未還原，舊失敗證據不改寫。

VM仍為e2-small，自動停止期限 **2026-10-23 13:33:50 香港時間**；未新增續期或雲端架構，未取得新帳單，不宣稱免費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：未有最新百分比，餘額未知。
