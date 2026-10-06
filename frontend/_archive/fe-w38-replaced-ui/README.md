# FE-W38 已取代介面及驗證原文

這裏保存 8 個已無 runtime consumer 的舊介面／helper、舊照片 handoff 原檔、2 份原測試及4份舊browser runner／flow。共15份原文逐位元保留；檔名加上 .snapshot，避免被 Router、TypeScript 或 Node 測試探索當作現行程式。

## 來源與校驗

- 專案：[2NTTY/child-ai-caregiver](https://github.com/2NTTY/child-ai-caregiver)
- 清理前來源：[PR #88 head 7119b4d3f291c98ac0b7c9259604e4404efd6fdf](https://github.com/2NTTY/child-ai-caregiver/tree/7119b4d3f291c98ac0b7c9259604e4404efd6fdf)。這是清理前的來源 commit，並非本清理工作的 merge commit
- 更早復原基線為 2a64fdd7eae52c37c4f42f39ea286b4d3acd8630 加已核對 staged blobs；先前保存的9份snapshot與上述清理前版本bytes相同
- 每份snapshot的原路徑、完整Git blob SHA、SHA-256、byte數及替代用途見 [manifest.json](manifest.json)
- 下表為完整索引。原路徑相對於專案根目錄；snapshot內的相對import按原目錄理解

## 完整原文索引

| 原路徑／原文 | 類型 | Git blob（短碼） |
|---|---|---|
| [frontend/src/components/HomeRecentRecords.tsx](src/components/HomeRecentRecords.tsx.snapshot) | 已取代UI／helper | b91a41650da5 |
| [frontend/src/components/PreviewTodoCard.tsx](src/components/PreviewTodoCard.tsx.snapshot) | 已取代UI／helper | 518cf92e9d9a |
| [frontend/src/components/growth/GrowthAttentionCard.tsx](src/components/growth/GrowthAttentionCard.tsx.snapshot) | 已取代UI／helper | 9e70546fb873 |
| [frontend/src/components/growth/GrowthTopicCard.tsx](src/components/growth/GrowthTopicCard.tsx.snapshot) | 已取代UI／helper | efff5b1d21c1 |
| [frontend/src/components/growth/growth-form.ts](src/components/growth/growth-form.ts.snapshot) | 已取代UI／helper | dacf777dbfd4 |
| [frontend/src/components/growth/growth-motion.ts](src/components/growth/growth-motion.ts.snapshot) | 已取代UI／helper | 8df995ae829c |
| [frontend/src/components/memory/MemoryCards.tsx](src/components/memory/MemoryCards.tsx.snapshot) | 已取代UI／helper | 9e4a147a4a1d |
| [frontend/src/components/memory/MemoryEditor.tsx](src/components/memory/MemoryEditor.tsx.snapshot) | 已取代UI／helper | 6bbd0fb41a73 |
| [frontend/src/components/growth/growth-form.test.mjs](src/components/growth/growth-form.test.mjs.snapshot) | 原測試全文 | 9d2d33f039a3 |
| [frontend/src/home-agent-entry.ts](src/home-agent-entry.ts.snapshot) | 局部helper被取代，原檔保留其他用途 | 16588b33839c |
| [frontend/scripts/home-agent-entry.test.mts](scripts/home-agent-entry.test.mts.snapshot) | 原測試全文 | 9c89a8725fcc |
| [frontend/scripts/verify-ui.mjs](scripts/verify-ui.mjs.snapshot) | 過期browser驗證，待遷移 | d26068fcfa33 |
| [frontend/scripts/flows/growth.mjs](scripts/flows/growth.mjs.snapshot) | 過期browser驗證，待遷移 | 3070729f0cdf |
| [frontend/scripts/flows/tasks-memory.mjs](scripts/flows/tasks-memory.mjs.snapshot) | 過期browser驗證，待遷移 | d62edfbacb42 |
| [frontend/scripts/flows/summary.mjs](scripts/flows/summary.mjs.snapshot) | 過期browser驗證，待遷移 | f49f98423f6d |

## 現行替代及閱讀條件

- 首頁／右欄：[HomeFocus與HomeActionSummary](../../src/components/HomeFocus.tsx)、[RightRailContent](../../src/components/RightRailContent.tsx)
- 成長：[GrowthConcernTimeline](../../src/components/growth/GrowthConcernTimeline.tsx)、[GrowthArchive](../../src/components/growth/GrowthArchive.tsx)；[GrowthOperationRecovery](../../src/components/growth/GrowthOperationRecovery.tsx)繼續保留舊操作查核
- 記憶：[MemoryReferenceView](../../src/components/memory/MemoryReferenceView.tsx)；原資料owner沒有移除
- 媒體草稿：[createAssistantDraftOwner與photoAttachment](../../src/assistant-draft.ts)保留唯一owner、scope及資源釋放；[homeAgentScope](../../src/home-agent-entry.ts)仍在原檔
- 現行[growth-form.test.mjs](../../src/components/growth/growth-form.test.mjs)保留HTTPS來源安全檢查；[home-agent-entry.test.mts](../../scripts/home-agent-entry.test.mts)保留scope檢查，原照片handoff斷言由當前owner測試承接有用的資源釋放語義

只有追查舊呈現、取捨、表單或原驗收條件時才需要閱讀。snapshot是歷史記錄，並非可直接執行的獨立副本。

## Browser coverage缺口與入口

- care、tasks、memory、growth、growth-text、summary、summary-text的舊flow依賴已被替代的頁面／selector，目前標為unsupported pending migration
- [verification-flow-policy](../../scripts/verification-flow-policy.mjs)集中列出可執行runner、目前layout路由及上述缺口。可執行不代表新版本已驗證；每次仍須通過真實斷言
- 不帶選項的舊aggregate、過期選項或未知選項會明確失敗，且不啟動browser、不產生假的成功證據。沒有用略過測試換取成功
- 只在需要並獲准時明確選擇可執行runner，例如 npm run verify:web -- layout；新版browser coverage仍以實際所測版本／範圍為準
- [preview-browser](../../scripts/preview-browser.mjs)沿既有FirstScreenGate readiness，無須展開純說明disclosure；沒有移除API呼叫偵測、console/pageerror檢查或overflow斷言
- 舊summary操作的相容產品入口仍是 /summary?tab=legacy-preparation；本次沒有把舊大型flow假稱已移植或通過

## 沒有移除的內容

原資料owner、來源與版本、歷史記錄、unknown原操作恢復、權限／孩子隔離、legacy-preparation相容路由、求助／安全能力與無障礙結構均維持於現行程式。舊畫面不再使用，不代表相應資料或契約可被刪除。

本歸檔沒有改寫既有verification證據。
