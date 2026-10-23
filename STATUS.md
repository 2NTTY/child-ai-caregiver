# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **附件回看獨立候選：**#253 已合併；新增附件來源放獨立分支，不回寫舊 PR。唯讀私人清單及簡潔詳情彈窗已接線，定向合成／DOM 有證據；型別檢查 exit137、build／GUI及實際 API／索引仍待驗，尚未部署。唯一接續點見 [ATTACHMENT-READ01](PLAN.md#attachment-read01)。

- **目前：MODEL-SELF03後端已接，畫面待整合。**2026-10-23同步master `7b828dc`並接回未完快照；相容API地址／key／模型ID、獨立Gemini向量key及具體錯誤分類已有本機接線與必要合成證據。#253正修改同一模型設定畫面，#254修改Agent；依使用者要求未接管／修改／合併兩者。現有client保持v2，新v3表單及部署仍待承接，不能宣稱已可在網站輸入相容服務。唯一接續點見[MODEL03](PLAN.md#model-self03)。

- **PR 收束：**#229／#234～#239 由原 Android 主責帳號合併，#241／#242／#244 由本地／模型工作主責帳號交付。使用者於 2026-10-20 明確批准先合併、剩餘手機／真模型驗收改為後續追蹤；原作者、失敗及未驗證據保留。該合併批次沒有新增測試，後續部署見下方。現行次序見 [PLAN](PLAN.md#active)。
- **本地開發入口可用：**`npm run agent:local` 啟動目前分支的正式 Web／API／四角色接點及隔離持久資料。真聊天／引用、編製／獨立審核／同文件保存及重啟讀回已有證據；已補相容模型與獨立向量key的本地配置接線，這條新增路由只有合成證據。方法見[本地入口](docs/AGENT_LOCAL.md)。本地環境交付與角色完整品質分開，不需先部署 GCP。
- **角色未完成項：**官方 PDF 第3頁已整理、審核及本地發布；最終聊天引用新版的單次補驗因 `model_limit` 停止，原用量和失敗保留。長來源／圖片多模態仍欠角色能力，不能以單頁 PDF 當全部通過；見 [DEV02](PLAN.md#dev-agent02)。
- **個人模型共用入口及直接選型已交付。**#246 的 `d53c203` 已更新原站及Android OTA；Android原平台設定保存／重開讀回已有證據，個人模式及真key仍待驗。依最新要求由用戶提供憑證，沒有地域或metadata前置閘，不再為取得驗收key或逐模型試用阻擋入口。單次Developer API的`region_unavailable`不代表其他用戶或Vertex不可用；Vertex本身支援向量，現有個人Express adapter的向量仍是接線缺口，不能標為完成。後續及證據只見 [MODEL-SELF01／02](PLAN.md#model-self01)。
- **Android 已合併，未全數驗收：**APK v2 覆蓋安裝、原登入／資料保留及一則指定 FCM 有證據；正常有來源聊天／重開、撤銷／切身份、跨端與媒體／附件完整流程、照護通知完成停止及 OTA 回退仍按 [S04～S17](PLAN.md#s04-w01) 追蹤，不以合併當成品完成。
- **其他邊界：**正式資料已使用 Firestore；家庭多人留 P4、iOS 暫緩。OPT／LAY 既有成果保留，STR01 及[原生備份真還原](PLAN.md#p2-backup-followup)仍未完成。只補最低必要驗證，不全量、Computer Use 或重做前端設計。

<a id="deployment"></a>
## 最近部署觀察

**2026-10-20 14:07 UTC 原站：**API／worker為`model-d53c203`（映像`93ebfdc`），Web同tag（映像`209c0e1`）；服務健康，公開HTML hash與同版產物一致。未改業務資料、配額、用量或索引，沒有模型／通知驗收。原站更新及回退邊界見[交付證據](artifacts/verification/MODEL_SELF02_DELIVERY_20261020.json)。

**2026-10-20 14:22 UTC 磁碟：**歷次未淘汰的映像及上傳包令可用空間降至約417 MiB；已清除61個過時映像（69個標籤）及9個舊安裝包，可用空間增至約10.81 GiB，釋放約10.40 GiB。保留現行及兩組回退候選映像、全部資料卷／備份／密鑰，沒有重啟或擴容；容器未變、首頁及API健康均200。後續交付沿[有界保留](docs/PRODUCTION_FRONTEND.md#firestore-deployment)，回退仍須核對資料相容；實際清單及結果留同份交付證據。

**Android，2026-10-20 14:38 UTC觀察：**14:11發布的`d53c203` preview OTA群組`cfe20c62-9816-4d8e-8b5c-06bcf74ab266`之新模型ID欄位已在手機顯示；APK v0.1.0／versionCode 2及runtime `33699576537bf6f4081bddfb9c8807cd6bdef3ee`不變，毋須覆蓋安裝。原平台設定只保存一次，版本0→1，完全重開後仍登入並讀到同版；沒有key輸入、限額修改、模型或通知呼叫。真key／Android個人模式及限制保存仍待驗，首次匯出漏身份配置的失敗保留於交付證據。

回退保留既有映像及受保護Compose副本；新政策、附件、語音與通知資料寫入後，必須使用相容reader／worker，不能直接退回不認識新欄位的舊API。方法見[部署交接](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。備份只讀metadata，未還原，舊失敗證據不改寫。

**2026-10-20 12:55 UTC 續期觀察：**依使用者要求在原期限增加14天，VM維持e2-small，自動停止期限改為 **2026-11-06 13:33:50 香港時間**。依GCP要求短暫停止後已重新啟動，首頁與API健康入口均返回200；首次開機連線未就緒的結果保留。未變更映像、規格、資料或配額，未取得新帳單，不宣稱免費。最近核對的READY原生備份為2026-10-19 22:25 UTC，保留至11月2日；只讀metadata，沒有還原。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定LOG／EV；前端入口為[frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN](frontend/PLAN.md#active)。master、draft與部署版本分開，舊批准不當成尚未使用額度。

Codex額度：未有最新百分比，餘額未知。
