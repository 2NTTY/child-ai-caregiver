# P4 接手清單

P4 已於 11 月 18 日恢復，目標涵蓋 S16 驗收與 S17 交付。[開啟原站](https://ex-machina.eu.org)後，個人沿「更多 → 本人多孩對話」，老師從班級名冊進入。查詢已選孩子的照護與待辦、一次確認一批待辦、匯出及收取整段對話已有接線。原工作包與 AC 留在 [PLAN](../PLAN.md#p4-packages)。

**多孩照護原文入口的發布紀錄為 2026-11-11 23:11（香港）的 `p4-group-2f442c36`。** 新回覆中的「照護記錄 N」可以點開原文；原件已更正、刪除或失去權限時會顯示相應結果。舊回覆只有 hash，匯入副本也沒有來源房間的點讀權。已核合成登入流程及原站版本、健康、未登入保護；正式家庭帳號點讀與 Android 真機留待使用時核對。[原站發布與驗證紀錄](../artifacts/verification/P4_CARE_CITATION_DELIVERY_20261111.json)

## 下次從哪開始

**目前接共享持續關注。** 家庭及班級的可寫成員從原頁安排跟進，到點時由既有工作台帳在該關注留下一則事件。指定老師收手機提醒請用班級待辦。已有後端定向證據涵蓋跨成員讀取、原操作重播、撤權和連結範圍；共用畫面、正式發布收據仍待核。

**班級待辦的負責人及每部裝置提醒已接通。** [負責人與撤權 #598](https://github.com/2NTTY/child-ai-caregiver/pull/598) 已合併。老師可在個別裝置啟用，接收指派給自己的班級待辦。發送前重查目前指派、班級權限及安靜時段；點擊後重新核權定位同一待辦。[按裝置派送 #599](https://github.com/2NTTY/child-ai-caregiver/pull/599) 已合併，已核合成裝置、重播、撤權及班級重新加入教師空間。[共用前端 #603](https://github.com/2NTTY/child-ai-caregiver/pull/603) 涵蓋老師選單、裝置開關及點通知定位；正式發布、手機實收仍待驗。

**家庭附件庫直接上傳已合併。** 選定家庭和孩子後，owner／caregiver 可直接加入照片、錄音及文件，viewer 可讀取已保存的原件。[後端 #596](https://github.com/2NTTY/child-ai-caregiver/pull/596) 已合併；正式 HTTP 與合成物件服務已驗三種媒體、文件跨成員讀回、途中撤權及照片失聯後沿原操作完成。[Web／Android 上傳入口 #597](https://github.com/2NTTY/child-ai-caregiver/pull/597) 已合併。正式發布收據及真實成員驗收待核。沿用上傳預留、私人 Storage、Firestore 及收據。

其後依次完成家庭／班級協作、本人備份與交接、第④組助手查詢與公共知識、快捷登入／系統分享／報告，以及集中服務恢復與 S16／S17。[主動助手及手機示範](../PLAN.md#proactive-notifications)已交付。以下保留 Agent 搜索示範的獨立入口。

**先從 Web 試一條家長自然會問的問題**，例如「我個 BB 差唔多半歲，點知佢準備好開始食固體？」選現有核准來源涵蓋的問題，按[需求文件 v0.11.0 的 A、B](REQUIREMENTS_BACKLOG.md#2-跨包的首交付切片與依賴)核對同一次回答：查到哪段原文、是否適用、點開引用能否讀到同版依據，以及畫面能否顯示真實進度、斷線後查回結果。用第一處具體缺口決定要修哪個接點。此示例供下次實作驗收。

**現有公共查詢從兩個工具接起。** `search_knowledge` 搜尋已發布的官方資料，`read_knowledge_context` 按命中片段續讀同版原文。先沿用 Firestore 向量與關鍵詞混合檢索、來源版本及片段身份；依實際缺口調整查詢、續讀或引用呈現。[檢索契約](P2_KNOWLEDGE.md#firestore-maintenance) · [工具說明](../server/agent-knowledge-tool-descriptions.ts) · [本地 Agent 啟動](AGENT_LOCAL.md)

下表保留各組的實作入口及未驗項。合併後沿香港時間每日 04:17 的發布流程核對正式收據，再記錄已上線。

| 組別 | 下一段工作與第一個入口 | 復用證據與剩餘門檻 |
|---|---|---|
| ① 家庭與班級 | 沿[共享授權](../server/firestore-sharing.ts)、[家庭 owner](../frontend/src/production/useProductionFamily.ts) 補剩餘模組寫入、背景工作撤權及班級通知的閉環驗收。 | 記錄、待辦、記憶、文件已有分域接線。[附件讀取／刪除](../artifacts/verification/P4_SHARED_ATTACHMENT_PAGES_20261027.json)。正式成員的跨端效果仍須核對。 |
| ② 本人備份與交接 | 從[本人原件差異與還原](../server/handover-original-backup.ts)及[匯入 owner](../frontend/src/production/HandoverImportOwner.ts)核對本人私聊原件還原；用一份簽署包走完整帳戶差異、衝突及刪除後明確恢復。 | 成長還原、附件原件及通知偏好已有局部成果；整段混合對話收件是獨立副本。[附件證據](../artifacts/verification/P4_ORIGINAL_ATTACHMENTS_20261108.json) · [通知偏好](../artifacts/verification/P4_ACCOUNT_PREFERENCES_20261108.json)。 |
| ③ 快捷登入與系統分享 | 沿[登入契約](API.md#p4-auth-providers)補正式 Google／Apple 配置、真人連結及重新驗證；沿[系統分享](../PLAN.md#s12-w02)批量交付 Android，Apple 團隊就緒後再簽署及用 iPhone 收件。 | 身份連結已有合成驗證；iOS 已生成工程及驗本機收件。仍欠正式 provider／設備結果。APK 留到需要使用時集中建置。 |
| ④ 助手查詢與公共知識 | 公共語料的日常大量匯入、重建及效能排在家庭附件及交接之後。現有 [CLI](../scripts/knowledge-transfer-operations.mjs) 可匯入 ZIP，[Web 後台](../frontend/src/components/admin/AdminKnowledgeTransfers.tsx)可查收據、停止及恢復，Web 選檔上傳仍待開發。私人跨孩記憶／文件召回另從[正式工具](../server/product-agent-tools.ts)的 `search_selected_care` 接續，逐孩核對權限及出處。 | [公共 ZIP 維運](P2_KNOWLEDGE.md#公共知識版本的批量移轉)。私人多孩已有[照護查詢與審核](../artifacts/verification/P4_SELECTED_CARE_VERTEX_20261111.json)、[待辦查詢與批次](../artifacts/verification/P4_GROUP_TASK_VERTEX_20261111.json)及[部分衝突與恢復](../tests/mixed-task-batch.test.mjs)證據。 |
| ⑤ 報告、可靠性與交付 | 從[報告](../PLAN.md#s14-w02)補原生分享與雙端預覽，再按[跨端可靠性](../PLAN.md#s07-w02-p4)、[集中服務災難恢復](../PLAN.md#s15-w02-p4)處理附件中斷、撤權、[隔離還原](../server/firebase-restore-apply.ts)、刪除重放及保留新寫入的回退。 | [趨勢及同版資料](../artifacts/verification/P4_SOURCE_ERASURE_REPORT_TRENDS_20261105.json)已有發布證據。正式還原與跨端證據齊後，才結算 [S16 驗收](../PLAN.md#s16-w04-p4)及 [S17 交付](../PLAN.md#s17-w04-p4)。 |

## 恢復工作前只核對三件事

1. 核對最新 master、未合併 PR 和所選列的接線，保留其他人的修改；提交時按本機協作文件核對身份。
2. 對照上方最後交付的版本與實測界線；若追查照護查詢本身，另看[上一版發布](../artifacts/verification/P4_SELECTED_CARE_DELIVERY_20261111.json)。原站 VM 自動關機期限最後記錄為 **2026-12-08 22:32 香港時間**，重新發布前核對實際主機狀態。
3. 只補所選差異的必要驗收；合成、真模型、原站、真機分開記。P3 的四 Agent 聯合驗收／iOS TestFlight 及 P5 的自選 Server／搬遷沿原包追蹤。
