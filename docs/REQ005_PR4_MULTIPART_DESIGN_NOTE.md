# REQ-005 PR 4: 多段摘要進度管理（Multi-Part Summary Progression）架構備忘錄

**文件性質**：技術設計備忘錄（Design Note / Proposal）  
**對應路線圖**：`docs/REQ005_CONVERSATION_PROGRESSION_ROADMAP.md` §4.1「進度與資料契約的候選方向」  
**關聯代碼分支**：`codex/req005-multipart-progression`（本地分支，未經使用者指令不予推送）

---

## 1. 背景與設計動機

在 REQ-005 的整體規劃中，超長訊息（例如單條訊息超過 5,000 字元、或包含大量逸出字元的訊息）無法在單次 Agent 請求的 32,000 字元硬性上限內完成摘要。

為解決此問題，Roadmap §4.1 提出了「單訊息多段進度（Multi-part progression）」方向：將超長訊息安全切分為多個切片（parts），分輪次進行摘要處理。

在代碼審核與架構分析中，指出了本機制合入主庫前必須在架構層面解決兩項核心問題與多項契約規範：
1. **前段切片摘要語意保留問題**：各切片單獨摘要時，如何確保前段切片的摘要不會在投影中遺失。
2. **Rollback 相容性與存儲物理隔離**：master 分支採用 `.strict()` Schema，在多段進度進行中若發生版本回滾，如何避免既有 reader 拋出 500 錯誤。
3. **Roadmap §4.1–§4.3 開放問題規範**：Hash 驗證規則、Offset 單位與強制性、生命週期（Erasure / Restore / Tombstone）、併發防重與動態容量適配。

本備忘錄詳細分析上述架構問題，提出候選方案與權衡矩陣，並記錄防護架構設計。

---

## 2. 核心架構挑戰一：前段摘要保留與組合策略

### 2.1 問題現狀分析
若將超長訊息 $M$ 切分為 $K$ 個切片 $C_0, C_1, \dots, C_{K-1}$：
* 若每個切片單獨呼叫模型生成獨立摘要 $S_i = \text{LLM}(C_i)$。
* 當推進到最後一個切片 $C_{K-1}$ 時，若僅將 $S_{K-1}$ 作為最終 Batch 寫入並標記 `currentBatch: true`，則只有切片 $K-1$ 的摘要會進入 `initialConversationSummary`（見 `server/firestore-memory.ts`）。
* 前段切片 $S_0, \dots, S_{K-2}$ 雖然已產出，但由於 `currentBatch: false`，在提示詞投影中將無法呈現。
* 然而，最終 Batch 的 `coveredMessageIds` 卻宣告了訊息 $M$ 已完全覆蓋，造成語意空缺（Semantic Loss）。

### 2.2 候選解決方案

#### 方案 A：鏈式滾動摘要（Incremental Rollup Chaining）——【建議採納】
* **運作機制**：
  * 切片 0：輸入切片 0 原文 $C_0$，模型輸出切片摘要 $S_0$。
  * 切片 1：輸入切片 1 原文 $C_1$ **加上前段累積摘要 $S_0$**，引導模型產出包含前文脈絡的累積摘要 $S_{0..1} = \text{LLM}(C_1, S_0)$。
  * 切片 $k$：輸入 $C_k$ 與前段累積摘要 $S_{0..k-1}$，產出累積摘要 $S_{0..k}$。
  * 最終切片 $K-1$ 產出之摘要 $S_{0..K-1}$ 即代表**整條超長訊息 $M$ 的完整語意摘要**。
* **優點**：
  * 投影端零變更：`initialConversationSummary` 依然只投影最後一個 Batch，自然具備完整語意。
  * 提示詞容量可控：各切片只滾動文字摘要（摘要本身受限在 200–500 字元），不會造成上下文膨脹。
* **開銷評估（Cost Analysis）**：
  * 每處理一個切片，需要將上一段的中間摘要注入 Prompt，模型調用次數為 $K$ 次。
  * 每次調用額外消耗數百 tokens 的輸入容量，累積執行時間增加，此成本納入 Root Run 的 `AgentBudget` 考量。

#### 方案 B：多切片批次投影（Multi-batch Sub-items Projection）
* **運作機制**：
  * 每個切片產生獨立的子批次摘要，並全數標記為可投影項目。
  * 投影端修改 `initialConversationSummary`，允許投影同一個訊息的多個切片摘要項目。
* **缺點**：
  * 修改了投影消費端結構與資料契約。
  * 多個子批次會快速消耗 3,000 字元的投影預算，擠佔其他正常歷史批次的空間。

#### 方案比較矩陣
| 維度 | 方案 A：鏈式滾動摘要（Rollup） | 方案 B：多切片批次投影 |
| :--- | :--- | :--- |
| **投影端變更** | **零變更**（相容現有 `initialConversationSummary`） | 需要修改投影消費邏輯 |
| **語意完整度** | **高**（最後一個 Part 自然涵蓋全文） | 中（多個碎片化摘要，可能重複） |
| **Prompt 預算消耗** | **低**（單一緊湊摘要） | 高（多個 Batch 佔用 3,000 字元上限） |
| **實作複雜度** | 中（需在 Maintenance 傳遞前段摘要） | 高（需重構批次結構與投影格式） |

### 2.3 安全防護設計：防止中間切片提示詞注入（Prompt Injection Defense）
在多切片滾動摘要中，前段切片的摘要（`cumulativeSummary`）來源於用戶不可信文本的先前處理結果。若用戶訊息包含對抗性提示（Prompt Injection / Jailbreak），中間摘要可能攜帶惡意指令試圖影響後續切片的生成行為。

**安全防護設計考量**：
1. **結構化資料欄位隔離（Untrusted Prose Isolation）**：
   - 拒絕直接字串拼接：不得將上一輪的 `cumulativeSummary` 直接以模板字串形式拼入系統指令（System Instructions）。
   - 採用結構化隔離：在請求 payload 中，將累積摘要定義為結構化資料欄位，與指示詞模板嚴格分開。
2. **語意角色與資料邊界界定**：
   - 累積摘要作為上下文參考輸入傳入模型，明確約束其僅作為歷史事實摘要參考，不作為控制流指令。
3. **受限專用工具調用**：
   - 私有摘要維護運行於受限的 Agent Runner 環境，僅開放單一專用工具 `stage_private_summary` 用於提交結構化摘要結果，不提供任意檔案存取、外部網路或特權系統操作權限，阻斷提權與側信道外洩路徑。
4. **服務端連續性防偽守衛**：
   - 服務端透過 G1–G9 守衛（特別是 G1 來源雜湊驗證、G2 續段進度記錄存在性驗證、G3 索引連續性驗證、G5–G7 及 G9 偏移量連續校驗）嚴格防禦偽造或竄改的中間摘要請求。

---

## 3. 核心架構挑戰二：Rollback 相容性與存儲物理隔離

### 3.1 問題現狀分析
* master 分支的 `savedSummarySchema` 採用 Zod 的 `.strict()` 校驗：
  ```typescript
  const savedSummarySchema = z.object({
    summary: summarySchema,
    basis: z.string().regex(/^[a-f0-9]{64}$/u),
    validUntil: time.nullable(),
    lastSortKey: z.string().regex(/^[0-9]{19}$/u),
    batch: summaryBatchSchema.optional()
  }).strict();
  ```
* 若將 `part` 欄位直接寫入 `conversation-summary-head` 文件，在多段進度進行中（未完成全部切片前），若生產環境發生 Rollback 回滾至 master：
  * master 讀取 `conversation-summary-head` 時，會因無法識別 `part` 欄位而拋出 Schema 驗證錯誤（500 domainReject），導致用戶記憶功能受阻。

### 3.2 候選解決方案

#### 方案 1：獨立進度文件隔離（Isolated Progress Document）——【建議採納】
* **運作機制**：
  * 保持 `conversation_summary_heads` 中的文件結構**完全符合 master 的 strict schema**。
  * 多段切片的中間狀態（`partIndex`、`partTotal`、`prevOffsets`、`cumulativeSummary`）寫入獨立的集合/文件：
    `conversation_summary_heads/conversation-summary-progress/{ownerUserId!childId}`。
  * 當切片全部完成（`isLast: true`）時，才一次性將最終完整摘要寫入 `conversation_summary_heads`，並在同事務中清理獨立進度文件。
* **優點**：
  * **向後相容**：即使在多段處理中途回滾至 master，master 讀取 head 文件不會因額外欄位發生 schema 衝突。
  * 關注點分離：進行中的中間運算狀態與已完成的正式摘要物理隔離。

#### 方案 2：寬鬆化 Schema 遷移（Permissive Schema Evolution）
* **運作機制**：
  * 在 master 與後續分支中，將 `savedSummarySchema` 改為 `passthrough()` 或預先加入可選 `part` 欄位。
* **缺點**：
  * 需要先提交一個專門的 Schema 寬鬆化 PR 併入 master，增加發布依賴與維護負擔。

---

## 4. Roadmap §4.1–§4.3 開放問題規格設計

### 4.1 Hash 生成、核對與來源變更規則（§4.1）
1. **Hash 生成演算法**：
   - 採用 SHA-256 對原始待摘要訊息的完整文本（`message.text`）計算十六進制摘要：
     $$\text{sourceHash} = \text{sha256}(M.\text{text})$$
2. **切片核對不變量**：
   - 每個切片在提交時必須包含此 `sourceHash`。
   - 服務端驗證：當前切片的 `sourceHash` 必須與該訊息實時計算的 hash 完全一致，且在切片遞增過程中（$i > 0$）必須與上一段的 `prevPart.sourceHash` 完全一致。
3. **來源變更處置（Source Mutation / Deletion）**：
   - 若用戶在切片進行中途編輯或撤回了該條超長訊息，下一次切片請求抵達時，因 `sourceHash` 比對失敗，服務端明確拋出 `summary_coverage_changed`。
   - 系統隨即清理 `conversation-summary-progress` 中間狀態，放棄先前部分切片成果，重新自變更後的起點開始評估。

### 4.2 偏移量（Offset）單位、連續性與強制性規則（§4.1）
1. **Offset 單位**：
   - 明確定義為 **UTF-16 code units**（即 JavaScript 的 `string.length` 與 `string.slice()` 索引），與 Firestore 儲存層及 Node.js 運行時保持一致。
2. **強制性規則（防止省略繞過）**：
   - 若 `part.total > 1`，客戶端**必須**傳入 `startOffset`、`endOffset` 與 `sourceHash`，嚴禁因欄位省略而繞過伺服器校驗。
3. **連續性與邊界校驗**：
   - Part 0：`startOffset === 0`。
   - Part $i$（$i > 0$）：`startOffset === prevPart.endOffset` 且 `prevPart.total === part.total`（強制無縫接合，不允許空洞或重疊）。
   - 邊界約束：`0 <= startOffset < endOffset <= message.text.length`。
4. **服務端切片邊界一致性核對**：
   - 服務端核對客戶端傳入的 offsets 必須與服務端調用 `splitMessageIntoSafeChunks(message)` 切出的安全切片邊界相吻合，防止客戶端任意截斷字元或規避序列化長度限制。

### 4.3 切片常數選取、在線耗時與版本演進適配（§4.2）
1. **常數選取依據（5,000 / 10,000）**：
   - `SUMMARY_SAFE_PART_TARGET_CHARS = 5000`：原始訊息字元目標上限。
   - `SUMMARY_SAFE_PART_SERIALIZED_CHARS = 10000`：序列化 JSON 字元安全包絡。
   - **選取理由**：JSON 逸出擴展效應在極端場景（例如連續 `\u0001` 逸出產生 6 倍擴展，或雙引號 `\"` 產生 2 倍擴展）下，5,000 字元經安全切分後約束在 10,000 字元序列化包絡內，低於 Gateway 32,000 字元硬性總上限，為系統提示詞、工具定義、現有對話輪次及模型輸出保留餘額。
2. **在線存續時間（In-Flight Duration）**：
   - 每個切片維護輪次通常在數百毫秒內完成。一般 2–4 段切片訊息在排程 worker 週期內會在數秒至數十秒內完成推進並清除進度記錄。
3. **常數變更與版本遷移處置**：
   - 若未來版本調整切片常數，任何進行中的舊切片進度在提交下一段時，會被服務端守衛（`serverChunks.length !== part.total` 或 `prevPart.total !== part.total`）拒絕。
   - `summaryInput` 在檢測到 `progress.total !== chunks.length` 時，自動於事務中刪除過期的 progress 文件，並重設為 Part 0 重新切分推進，不造成狀態污染。

### 4.4 併發防重與工作計量（§4.1）
1. **併發控制（CAS）**：
   - 依賴 Firestore 事務機制的讀寫鎖。讀取進度文件時校驗預期版本號（`expectedVersion`）；若有多個 Runner 併發嘗試處理同一用戶的維護任務，後抵達的事務會因版本衝突（409 conflict）自動退出，避免重複呼叫模型。
2. **計量與配額（Budget Accounting）**：
   - 切片生成的每次模型呼叫，其 tokens 與耗時精確計入當次 Run 的 `AgentBudget`，嚴禁繞過 Gateway 計費。

### 4.5 存儲隔離之生命週期覆蓋與 Rollback 限制（Restore, Progress Cleanup）
採納「方案 1：獨立進度文件隔離（`conversation-summary-progress`）」，該實體納入完整生命週期管理：
1. **在線進度自然排乾與清理（Progress Completion & Erasure）**：
   - 正常完成清理：當切片全部完成（`isLast: true`）時，於提交事務中原子刪除 `conversation-summary-progress`。
   - 來源變更清理：當訊息被編輯、切片常數變更或訊息被刪除時，`summaryInput` 檢測到雜湊或總數不符，自動於事務中刪除陳舊 progress 文件，無殘留進行中狀態。
   - （註：`server/firestore-content-erasure.ts` 專門負責 `care`、`profile`、`fact`、`topic` 歷史修訂版本之 GDPR 清除，對話摘要 head/progress 儲存於 `conversation_summary_heads`，依賴上述事務清理路徑管理）。
2. **資料庫備份與還原（Firestore Restore Codec）**：
   - `server/firestore-restore-core-records.ts` 明確將 `conversation-summary-progress` 登記於 `conversation_summary_heads` 集合後綴之恢復 Schema 中，確保進度可還原。
   - **Rollback 限制說明**：若將包含 `conversation-summary-progress` 記錄的備份還原至尚未包含 PR 4 代碼的舊版 master，舊版 restore codec 會因無法識別該記錄而拋出驗證拒絕。運維防範措施為：進行跨版本備份還原至舊版前，應確認在線進度已完全排乾（drained）或在還原過濾器中略過該暫存記錄。
3. **過期與殘留進度清理機制**：
   - 目前實作於每次維護觸發時，透過 `summaryInput` 即時比對訊息雜湊（`sourceHash`）及切片總數（`chunks.length`）；當訊息內容被編輯、切片常數變更或訊息被刪除時，主動於 Firestore 事務中清理過期的 `conversation-summary-progress` 記錄。未來若需要離線批次過期，可於 Schema 擴充可選之 `expiresAt` 欄位並配置 TTL 策略。

### 4.6 異常恢復與重試邊界（§4.3）
* 若切片處理在調用 LLM 時發生 `unknown`、`deadline` 或進程重啟：
  - 系統不進行盲目的即時重試（防止死循環消耗配額）。
  - 保留當前已持久化的進度索引，等待下一次由排程或用戶觸發的 maintenance 週期平滑恢復。
  - 在所有切片完成前，持久化記錄不宣稱覆蓋完整性（`sourceCoverageComplete: false`）。

---

## 5. 總結與提案狀態

1. **代碼狀態**：
   - PR 4 本地分支保持乾淨單一 commit，未經使用者指令絕不向遠端 origin 推送。
   - 伺服器校驗守衛 G1–G9 完整涵蓋來源雜湊驗證、進度記錄存在性、連續索引、訊息變更重設、切片邊界（start/end）、切片總數、修復請求隔離及續段偏移量接續（`part.startOffset === prevPart.endOffset`）；`prevPart.total === part.total` 作為深度防禦檢查，由第 522 行及第 415 行先期切片長度核對共同保護。
   - 測試套件包含 40 個完整用例（40/40 通過），涵蓋所有邊界守衛、常數中途變更重設、獨立變更測試及 final `sourcePeriod` 保存。
2. **與 Upstream 的相容性**：
   - 兼容主庫 master（`b5340962`，包含 PR #446、#445、#444、#443、#442、#441、#440、#439、#438、#437、#436、#435、#434、#433、#432、#431、#430、#429、#428，接續已合入之 #427、#426、#425、#412、#411）。
   - 最終 head 寫入時完整保留 `sourcePeriod` 計算，與主庫時間戳機制保持相容。
3. **審核狀態**：
   - 本設計備忘錄作為 PR 4 技術架構提案，完整記錄切片常數、連續性防偽、Rollback 隔離與語意保留之技術權衡，提交至主庫供專案負責人（Owner）審核與歸檔。
