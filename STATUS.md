# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **PR 收束：**#229／#234～#239 由原 Android 主責帳號合併，#241／#242／#244 由本地／模型工作主責帳號交付。使用者於 2026-10-20 明確批准先合併、剩餘手機／真模型驗收改為後續追蹤；原作者、失敗及未驗證據保留，沒有新增部署或測試。現行次序見 [PLAN](PLAN.md#active)。
- **本地開發入口可用：**`npm run agent:local` 啟動目前分支的正式 Web／API／四角色接點及隔離持久資料。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；方法見[本地入口](docs/AGENT_LOCAL.md)。本地環境交付與角色完整品質分開，不需先部署 GCP。
- **角色未完成項：**官方 PDF 第3頁已整理、審核及本地發布；最終聊天引用新版的單次補驗因 `model_limit` 停止，原用量和失敗保留。長來源／圖片多模態仍欠角色能力，不能以單頁 PDF 當全部通過；見 [DEV02](PLAN.md#dev-agent02)。
- **下一步：個人模型設定交付。**Web／Android 共用供應商模型目錄、限制與原操作查回已接線；本地 Web 保存及原生 session API 同版讀回有證據。真 Gemini key metadata 回 `region_unavailable`，沒有生成／embedding 成功；ADC 本地成功維持分開。Android 設定實機及正式部署仍待驗，見 [MODEL-SELF01／02](PLAN.md#model-self01)。
- **Android 已合併，未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 有證據；正常有來源聊天／重開、撤銷／切身份、跨端與媒體／附件完整流程、照護通知完成停止及 OTA 回退仍按 [S04～S17](PLAN.md#s04-w01) 追蹤，不以合併當成品完成。
- **其他邊界：**正式資料已使用 Firestore；家庭多人留 P4、iOS 暫緩。OPT／LAY 既有成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)仍未完成。只補最低必要驗證，不全量、Computer Use 或重做前端設計。

<a id="deployment"></a>
## 本分支保留的部署觀察（歷史，非現網最新狀態）

**2026-10-18 11:58 UTC 原站：**API／worker為`policy-adaf08f`（映像`fc7ae7e`），Web為`retry-adaf08f`（映像`373477f`）；服務健康，公開HTML hash與同版產物一致，Web切換未重啟API／worker。管理員政策由v2經原服務明確保存為v3：每日每人200／全站400，每輪8生成／16工具／4查詢，互動300秒、單次90秒、最多額外3次有計量重試；帳目未變、沒有資料遷移。舊政策缺欄位仍按原90秒／30秒／零重試讀取，避免部署默改歷史設定。

**Android：**APK v0.1.0／versionCode 2不變；相容OTA群組`a209afce-39ac-47fc-821b-d13ff949ac87`已發布，來源`adaf08f`、runtime `33699576537bf6f4081bddfb9c8807cd6bdef3ee`。毋須覆蓋安裝，最新裝置接收仍待核。部署及失敗／未驗證據見[S04 EV](artifacts/verification/S04_W01_ANDROID_FOUNDATION_20261015.json)；語音／附件與通知詳情沿[S12 EV](artifacts/verification/S12_CHAT_FILES_20261018.json)、[S13 EV](artifacts/verification/S13_ANDROID_PUSH_PREPARATION_20261018.json)。

回退保留既有映像及受保護Compose副本；新政策、附件、語音與通知資料寫入後，必須使用相容reader／worker，不能直接退回不認識新欄位的舊API。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。只讀最近READY原生備份metadata（2026-10-17 22:05 UTC，保留至10月31日），未還原，舊失敗證據不改寫。

VM仍為e2-small，自動停止期限 **2026-10-23 13:33:50 香港時間**；未新增續期或雲端架構，未取得新帳單，不宣稱免費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：未有最新百分比，餘額未知。
