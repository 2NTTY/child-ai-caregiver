# P4 接手清單

P4 已於 11 月 18 日恢復，目標涵蓋 S16 驗收與 S17 交付。[開啟原站](https://ex-machina.eu.org)後，個人沿「更多 → 本人多孩對話」，老師從班級名冊進入。查詢已選孩子的照護與待辦、一次確認一批待辦、匯出及收取整段對話已有接線。原工作包與 AC 留在 [PLAN](../PLAN.md#p4-packages)。

**多孩照護原文入口的發布紀錄為 2026-11-11 23:11（香港）的 `p4-group-2f442c36`。** 新回覆中的「照護記錄 N」可以點開原文；原件已更正、刪除或失去權限時會顯示相應結果。舊回覆只有 hash，匯入副本也沒有來源房間的點讀權。已核合成登入流程及原站版本、健康、未登入保護；正式家庭帳號點讀與 Android 真機留待使用時核對。[原站發布與驗證紀錄](../artifacts/verification/P4_CARE_CITATION_DELIVERY_20261111.json)

## 下次從哪開始

Web、API、worker 已有正式收據，Android 第 8 版亦已收到相容的 preview OTA 發布。Expo 以該版 APK 的 runtime 和通道回傳更新 `01a1ebc6`。裝置是否已下載，要在裝置上確認。[Android 交付收據](../artifacts/verification/P4_ANDROID_DELIVERY_20261118.json)

**下一次驗收用同一組測試資料。** 先備兩個有權使用的測試帳號、一部 Android 和一份無私人資料的文件；下面只補真人步驟。每項記錄結果、原操作或資源識別及平台即可。

1. 成員甲在家庭附件庫上傳文件；成員乙在另一端讀同一原件。撤回乙對該模組的權限後，從原入口重開，確認無法再讀。教師在自己的裝置開一次班級待辦通知，再驗一項指派給該教師的待辦到期、手機實收及點開定位。
2. 本人從「匯入資料」選自己的簽署備份，先看較新修改及已刪項目的差異，只在測試資料中選一項明確恢復。重開後查原操作及還原的聊天附件。簽章、版本衝突和原操作重播已有[原件](../tests/handover-original-backup.test.ts)及[附件](../tests/handover-original-attachments.test.ts)檢查。
3. 從「更多 → 本人多孩對話」查所選孩子的一份記憶或文件，點「孩子資料 N」核對孩子及版本。用同一份測試文件在 Android 從外部 App 分享到草稿；ZIP 選匯入入口。再從一份已生成報告開「預覽匯出內容」和系統 PDF 分享面板。
4. Google／Apple 正式配置就緒後，以既有測試帳號連結並重新驗證，記錄同一 UID；Apple 隱藏電郵另核原邀請接續。原生分享接收器已以 Xcode 16.4、iPhoneOS 18.5 SDK、最低目標 iOS 16.4 編譯成 arm64 物件。帶 App Group 的簽署 App 和 iPhone 系統收件仍待驗。[iPhone SDK 編譯收據](https://github.com/2NTTY/child-ai-caregiver/actions/runs/44198716579/job/134446904604)。另一位組員可從乾淨 checkout 依 [README](../README.md) 啟動共用前端，按[部署手冊](DEPLOYMENT.md)的 `status` 對回原站版本，再從本頁執行一條未驗流程。把版本、結果及收據補入下方 S16／S17 對照。

**原站已發布第④組、私人聊天還原及報告預覽。** 香港原站 Web、API、worker 同為 `9463f452`，對外兩個版本端點一致，API／worker 均可寫公共 ZIP 暫存目錄。[正式收據 r44189921005-2](https://github.com/2NTTY/child-ai-caregiver/actions/runs/44189921005/attempts/2)。 公共 ZIP 的[上傳接口 #612](https://github.com/2NTTY/child-ai-caregiver/pull/612)與[Web 選檔 #613](https://github.com/2NTTY/child-ai-caregiver/pull/613)已合併。多孩對話的[記憶與文件查詢 #614](https://github.com/2NTTY/child-ai-caregiver/pull/614)沿正式工具及審核契約，依所選孩子返回有效事實及當前文件；點「孩子資料 N」可查回當時版本。已核合成資料、來源更改及班級撤權，[共用結果點讀 #615](https://github.com/2NTTY/child-ai-caregiver/pull/615) 已隨同版發布；真人操作仍待驗。

**本人備份與還原。** 本人私人聊天還原已合併[後端 #610](https://github.com/2NTTY/child-ai-caregiver/pull/610)及[共用介面 #611](https://github.com/2NTTY/child-ai-caregiver/pull/611)。 從 [本人原件比較與還原](../server/handover-original-backup.ts) 接續。新本人備份保存訊息在原對話的位置。已用簽署包核對缺少的訊息回到原處、保留後來的訊息、找回原附件、把保留中的訊息重連到明確恢復的照片，以及相同批次重播；已隨 `9463f452` 發布，真人跨端操作待核。

**共享持續關注已合併。** 家庭及班級的可寫成員從原頁安排跟進，到點時由既有工作台帳在該關注留下一則事件。指定老師收手機提醒請用班級待辦。已有後端定向證據涵蓋跨成員讀取、原操作重播、撤權和連結範圍；[後端 #604](https://github.com/2NTTY/child-ai-caregiver/pull/604) 及[共用畫面 #605](https://github.com/2NTTY/child-ai-caregiver/pull/605) 已合併，共用前端已核分域權限及失聯後原操作；本次 API、worker 和 Web 的[發布收據](https://github.com/2NTTY/child-ai-caregiver/actions/runs/44167678924)為 `r44167678924-1`、版本 `f2d347cd`。

**班級待辦的負責人及每部裝置提醒已接通。** [負責人與撤權 #598](https://github.com/2NTTY/child-ai-caregiver/pull/598) 已合併。老師可在個別裝置啟用，接收指派給自己的班級待辦。發送前重查目前指派、班級權限及安靜時段；點擊後重新核權定位同一待辦。[按裝置派送 #599](https://github.com/2NTTY/child-ai-caregiver/pull/599) 已合併，已核合成裝置、重播、撤權及班級重新加入教師空間。[共用前端 #603](https://github.com/2NTTY/child-ai-caregiver/pull/603) 涵蓋老師選單、裝置開關及點通知定位；已隨 `f2d347cd` 發布，指定老師的手機實收待驗。

**家庭附件庫直接上傳已合併。** 選定家庭和孩子後，owner／caregiver 可直接加入照片、錄音及文件，viewer 可讀取已保存的原件。[後端 #596](https://github.com/2NTTY/child-ai-caregiver/pull/596) 已合併；正式 HTTP 與合成物件服務已驗三種媒體、文件跨成員讀回、途中撤權及照片失聯後沿原操作完成。[Web／Android 上傳入口 #597](https://github.com/2NTTY/child-ai-caregiver/pull/597) 已合併。已隨 `f2d347cd` 發布，真實成員跨端驗收待核。沿用上傳預留、私人 Storage、Firestore 及收據。

各包的現況及餘項見下表。[主動助手及手機示範](../PLAN.md#proactive-notifications)已交付。以下保留 Agent 搜索示範的獨立入口。

**先從 Web 試一條家長自然會問的問題**，例如「我個 BB 差唔多半歲，點知佢準備好開始食固體？」選現有核准來源涵蓋的問題，按[需求文件 v0.11.0 的 A、B](REQUIREMENTS_BACKLOG.md#2-跨包的首交付切片與依賴)核對同一次回答：查到哪段原文、是否適用、點開引用能否讀到同版依據，以及畫面能否顯示真實進度、斷線後查回結果。用第一處具體缺口決定要修哪個接點。此示例供下次實作驗收。

**現有公共查詢從兩個工具接起。** `search_knowledge` 搜尋已發布的官方資料，`read_knowledge_context` 按命中片段續讀同版原文。先沿用 Firestore 向量與關鍵詞混合檢索、來源版本及片段身份；依實際缺口調整查詢、續讀或引用呈現。[檢索契約](P2_KNOWLEDGE.md#firestore-maintenance) · [工具說明](../server/agent-knowledge-tool-descriptions.ts) · [本地 Agent 啟動](AGENT_LOCAL.md)

下表保留各組的實作入口及未驗項。合併後沿香港時間每日 04:17 的發布流程核對正式收據，再記錄已上線。

| 組別 | 下一段工作與第一個入口 | 復用證據與剩餘門檻 |
|---|---|---|
| ① 家庭與班級 | 沿[共享授權](../server/firestore-sharing.ts)、[家庭 owner](../frontend/src/production/useProductionFamily.ts) 核對附件上載成員、跟進時重新授權，以及指定老師的裝置通知。記錄／概況／待辦／記憶沿原業務交易；文件及關注沿領域服務，成長頁讀取同源投影。 | 記錄、待辦、記憶、文件已有分域接線。[附件讀取／刪除](../artifacts/verification/P4_SHARED_ATTACHMENT_PAGES_20261027.json)。正式成員的跨端效果仍須核對。 |
| ② 本人備份與交接 | 從[本人原件差異與還原](../server/handover-original-backup.ts)及[匯入 owner](../frontend/src/production/HandoverImportOwner.ts)核對本人私聊原件還原；用一份簽署包走完整帳戶差異、衝突及刪除後明確恢復。 | 成長還原、附件原件及通知偏好已有局部成果；整段混合對話收件是獨立副本。[附件證據](../artifacts/verification/P4_ORIGINAL_ATTACHMENTS_20261108.json) · [通知偏好](../artifacts/verification/P4_ACCOUNT_PREFERENCES_20261108.json)。 |
| ③ 快捷登入與系統分享 | 沿[登入契約](API.md#p4-auth-providers)補正式 Google／Apple 配置、真人連結及重新驗證；沿[系統分享](../PLAN.md#s12-w02)核對已交付 Android 的實機接收；Apple 團隊就緒後再簽署並用 iPhone 收件。 | 身份連結已有合成驗證；iOS 已核工程生成、合成收件和正式分享接收器的 Swift 編譯。11 月 18 日正式 Firebase 的 Google／Apple 配置均回覆 404（CONFIGURATION_NOT_FOUND），網站網域已獲授權；Android 已註冊套件尚無 OAuth client。先備 Google Web OAuth client 與 Apple 團隊的 Services ID／簽署，再按[各平台公開配置](PRODUCTION_FRONTEND.md#p4-原生快捷登入配置未開放)開放登入。Android 第 8 版已核對 EAS 產物 SHA-256 及 AAPT2 manifest，MainActivity 接受 SEND 及 SEND_MULTIPLE（*/*）。由其他 App 分享入草稿／ZIP 仍待實機，不需要為此另建相同 APK。 |
| ④ 助手查詢與公共知識 | 公共語料的日常大量匯入、重建及效能排在家庭附件及交接之後。現有 [CLI](../scripts/knowledge-transfer-operations.mjs) 可匯入 ZIP，[Web 後台](../frontend/src/components/admin/AdminKnowledgeTransfers.tsx)可查收據、停止及恢復，Web 選檔沿相同台帳接續，已核本機 HTTP 上傳、斷線查回與指紋不符拒絕；[分組重建 #616](https://github.com/2NTTY/child-ai-caregiver/pull/616)沿既有 worker 及收據處理，管理員可跨頁選最多 400 個版本，以首批編號查回整組，暫停、恢復及查看逐項失敗。已核 151 個合成版本分成四批，以及 Web 失聯時查回相同目標；[官方種子重建](../artifacts/verification/P4_KNOWLEDGE_REBUILD_20261118.json)在本機跑完五個版本共 20 頁，交易處理 2.17 秒，連排程等待 98.61 秒。正式庫唯讀點算有 12 個版本；未在正式庫重建全站語料。私人跨孩記憶／文件使用同一套[正式工具](../server/product-agent-tools.ts)的 `search_selected_materials`；照護記錄沿 `search_selected_care`。 | [公共 ZIP 維運](P2_KNOWLEDGE.md#公共知識版本的批量移轉)。私人多孩已有[照護查詢與審核](../artifacts/verification/P4_SELECTED_CARE_VERTEX_20261111.json)、[待辦查詢與批次](../artifacts/verification/P4_GROUP_TASK_VERTEX_20261111.json)及[部分衝突與恢復](../tests/mixed-task-batch.test.mjs)證據。 |
| ⑤ 報告、可靠性與交付 | [報告預覽 #618](https://github.com/2NTTY/child-ai-caregiver/pull/618) 與 PDF 共用同一版本、內容選項及權限。從 Web／Android「導出報告 → 預覽匯出內容」核對，原生保存及分享沿舊入口。其後按[跨端可靠性](../PLAN.md#s07-w02-p4)、[集中服務災難恢復](../PLAN.md#s15-w02-p4)處理附件中斷、撤權、[隔離還原](../server/firebase-restore-apply.ts)、刪除重放及保留新寫入的回退。 | [趨勢及同版資料](../artifacts/verification/P4_SOURCE_ERASURE_REPORT_TRENDS_20261105.json)已有發布證據。11 月 18 日已核原版 PDF 輸出、雙端預覽的合成操作及切換選項清除舊內容，正式站收據見上，裝置分享面板仍待核。[香港隔離庫原生還原](../artifacts/verification/P4_CENTRAL_RECOVERY_20261118.json)已走完整流程，附件刪除、原件位元組及回到保有新待辦的來源均已核實。跨端證據齊後，才結算 [S16 驗收](../PLAN.md#s16-w04-p4)及 [S17 交付](../PLAN.md#s17-w04-p4)。 |

<a id="p4-acceptance"></a>
## S16 驗收與 S17 交付索引

從下表找對應的驗收證據。原測試的範圍、失敗及未驗項保留在各份紀錄；同一項驗收只補仍缺的環節。

| [P4 驗收條件](../SPEC.md#ac-p4-p5) | 已有證據 | 收尾時要核對的環節 |
|---|---|---|
| 01 個人／獨立班級、02 按模組共享 | [班級匯入與原批次接續](../artifacts/verification/P4_HANDOVER_CLASS_ENROLMENT_20261104.json)、[家庭授權](../artifacts/verification/P4_FAMILY_AUTHORITY_FOUNDATION_20261027.json)、[共享同步](../artifacts/verification/P4_SHARED_SYNC_20261027.json) | 用兩個有權帳號走一次已發布的家庭附件庫上傳／讀回。 |
| 03 完整性與直接匯入、05 全批次結果、06 來源及衝突 | [包驗證](../tests/handover-archive.test.ts)、[原操作台帳](../artifacts/verification/P4_HANDOVER_JOBS_20261028.json)、[逐項衝突](../artifacts/verification/P4_HANDOVER_CONFLICT_RESULTS_20261029.json)、[來源鏈](../artifacts/verification/P4_HANDOVER_PROVENANCE_20261029.json) | 同一個簽署包保留其版本、操作編號及匯入結果。 |
| 04 本人私人資料差異恢復 | [原件備份服務](../server/handover-original-backup.ts)、[私人聊天還原 #610](https://github.com/2NTTY/child-ai-caregiver/pull/610) | 以同一個包覆核已發布前端的附件、保留較新修改、明確恢復及重開。 |
| 07 三種登入、連結及重新驗證 | [Web 身份契約](../artifacts/verification/P4_AUTH_PROVIDER_20261027.json)、[原生身份接線](../artifacts/verification/P4_AUTH_NATIVE_20261027.json) | 正式 Google／Apple provider 配置與本人同 UID 連結。 |
| 08 名冊及批次、09 混合聊天 | [正式模型及批次服務](../artifacts/verification/P4_GROUP_TASK_VERTEX_20261111.json)、[部分成功](../tests/mixed-task-batch.test.mjs)、[混合對話匯入](../tests/mixed-history-import.test.mjs) | 查詢所選孩子的記憶／文件後，實際在對話點讀引用版本。 |
| 10 轉交、解散、退出及撤權 | [家庭管理權](../artifacts/verification/P4_FAMILY_CONTROL_20261027.json)、[班級管理權](../artifacts/verification/P4_CLASS_CONTROL_20261028.json) | 沿同批跨端驗收核對撤權後的舊入口。 |
| 11 集中服務維運及交付 | [報告統計與來源失效](../artifacts/verification/P4_SOURCE_ERASURE_REPORT_TRENDS_20261105.json)、[原站發布與回退](DEPLOYMENT.md)、[知識維運](P2_KNOWLEDGE.md) | 獨立記錄發布收據、還原演練、實機分享／推送及組員重現結果。 |

## 恢復工作前只核對三件事

1. 核對最新 master、未合併 PR 和所選列的接線，保留其他人的修改；提交時按本機協作文件核對身份。
2. 對照上方最後交付的版本與實測界線；若追查照護查詢本身，另看[上一版發布](../artifacts/verification/P4_SELECTED_CARE_DELIVERY_20261111.json)。原站 VM 自動關機期限最後記錄為 **2026-12-08 22:32 香港時間**，重新發布前核對實際主機狀態。
3. 只補所選差異的必要驗收；合成、真模型、原站、真機分開記。P3 的四 Agent 聯合驗收／iOS TestFlight 及 P5 的自選 Server／搬遷沿原包追蹤。
