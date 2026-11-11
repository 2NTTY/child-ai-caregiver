# P4 接手清單

P4 暫停於 Web 示範可用階段。[開啟原站](https://ex-machina.eu.org)後，個人沿「更多 → 本人多孩對話」，老師從班級名冊進入。查詢已選孩子的照護與待辦、一次確認一批待辦、匯出及收取整段對話已有接線。原工作包與 AC 留在 [PLAN](../PLAN.md#p4-packages)。

**最後交付為 2026-11-11 23:11（香港）的 `p4-group-2f442c36`。** 新回覆中的「照護記錄 N」可以點開原文；原件已更正、刪除或失去權限時會顯示相應結果。舊回覆只有 hash，匯入副本也沒有來源房間的點讀權。已核合成登入流程及原站版本、健康、未登入保護；正式家庭帳號點讀與 Android 真機留待使用時核對。[原站發布與驗證紀錄](../artifacts/verification/P4_CARE_CITATION_DELIVERY_20261111.json)

## 下次從哪開始

若回來是為了**改善助手示範**，直接從下表④開始。在自己的分支按[本地 Agent 指引](AGENT_LOCAL.md)執行 `npm run agent:local`，用兩個合成孩子、一條現有工具答不了的示範問題，定位欠的是記憶、文件、檢索排序，還是原文閱讀。照護與待辦查詢已有兩條真 Gemini 證據可作對照。[照護查詢與審核](../artifacts/verification/P4_SELECTED_CARE_VERTEX_20261111.json) · [待辦查詢與批次](../artifacts/verification/P4_GROUP_TASK_VERTEX_20261111.json)

若回來是為了**完成 P4 產品**，可以先接①的共享附件上傳。家庭選擇、原件讀取及部分刪除都已具備，可用同一名成員完成上傳、讓同家庭另一成員讀回，再撤權核對。這一段可獨立進行。之後按②、③、⑤補其餘功能及交付。下表各列均保留未完成狀態。

| 組別 | 下一段工作與第一個入口 | 復用證據與剩餘門檻 |
|---|---|---|
| ① 家庭與班級 | 沿[共享授權](../server/firestore-sharing.ts)、[家庭 owner](../frontend/src/production/useProductionFamily.ts) 補共享附件上傳、剩餘模組寫入、背景工作撤權及班級通知。 | 記錄、待辦、記憶、文件已有分域接線。[附件讀取／刪除](../artifacts/verification/P4_SHARED_ATTACHMENT_PAGES_20261027.json)。正式成員的跨端效果仍須核對。 |
| ② 本人備份與交接 | 從[還原寫入](../server/firebase-restore-apply.ts)及[匯入 owner](../frontend/src/production/HandoverImportOwner.ts)核對本人私聊原件還原；用一份簽署包走完整帳戶差異、衝突及刪除後明確恢復。 | 成長還原、附件原件及通知偏好已有局部成果；整段混合對話收件是獨立副本。[附件證據](../artifacts/verification/P4_ORIGINAL_ATTACHMENTS_20261108.json) · [通知偏好](../artifacts/verification/P4_ACCOUNT_PREFERENCES_20261108.json)。 |
| ③ 快捷登入與系統分享 | 沿[登入契約](API.md#p4-auth-providers)補正式 Google／Apple 配置、真人連結及重新驗證；沿[系統分享](../PLAN.md#s12-w02)批量交付 Android，Apple 團隊就緒後再簽署及用 iPhone 收件。 | 身份連結已有合成驗證；iOS 已生成工程及驗本機收件。仍欠正式 provider／設備結果。APK 留到需要使用時集中建置。 |
| ④ 助手查詢與公共知識 | 從[正式工具](../server/product-agent-tools.ts)的 `search_selected_care` 及[照護查詢測試](../tests/selected-care-context.test.mjs)接跨孩記憶、文件召回。公共語料的日常大量匯入／重建與效能另從[後台](../frontend/src/components/admin/AdminKnowledgeTransfers.tsx)接。 | 多孩照護和待辦、逐項收據、部分結果接續已有證據。合成查詢已驗模型與獨立審核；新增召回需證明每個孩子的權限和出處。現有[公共 ZIP 維護入口](P2_KNOWLEDGE.md#公共知識版本的批量移轉)可查進度／停止／恢復。 |
| ⑤ 報告、可靠性與交付 | 從[報告](../PLAN.md#s14-w02)補原生分享與雙端預覽，再按[跨端可靠性](../PLAN.md#s07-w02-p4)、[集中服務災難恢復](../PLAN.md#s15-w02-p4)處理附件中斷、撤權、隔離還原、刪除重放及保留新寫入的回退。 | [趨勢及同版資料](../artifacts/verification/P4_SOURCE_ERASURE_REPORT_TRENDS_20261105.json)已有發布證據。正式還原與跨端證據齊後，才結算 [S16 驗收](../PLAN.md#s16-w04-p4)及 [S17 交付](../PLAN.md#s17-w04-p4)。 |

## 恢復工作前只核對三件事

1. 核對最新 master、未合併 PR 和所選列的接線，保留其他人的修改。B 接共用前端／手機，C 接後端；提交時按本機協作文件核對身份。
2. 對照上方最後交付的版本與實測界線；若追查照護查詢本身，另看[上一版發布](../artifacts/verification/P4_SELECTED_CARE_DELIVERY_20261111.json)。原站 VM 自動關機期限最後記錄為 **2026-12-08 22:32 香港時間**，重新發布前核對實際主機狀態。
3. 只補所選差異的必要驗收；合成、真模型、原站、真機分開記。P3 的四 Agent 聯合驗收／iOS TestFlight 及 P5 的自選 Server／搬遷沿原包追蹤。
