# REQ-005 全量驗收核對清單與真模型驗收驗證標準 (Closeout Checklist & Acceptance Matrix)

**日期**：2026-11-08  
**需求規格基準**：[REQUIREMENTS_BACKLOG.md §1～§9](REQUIREMENTS_BACKLOG.md#L900-L1034)  
**解耦交付套件**：REQ005-PR11 (`codex/req005-closeout-validation`)  
**基礎版本**：`2abe7aed60b192b253414f6464e3fd070cc377e7` (`origin/master`)  
**當前 PR**：[#514](https://github.com/2NTTY/child-ai-caregiver/pull/514)  
**合併政策**：**嚴格 HOLD merge**（僅由專案負責人 2NTTY 統一審核合併）  

> [!IMPORTANT]
> **文件治理與權威目的地規範聲明 (`AGENTS.md#document-updates`)**：  
> 依據 `AGENTS.md#document-updates` 規範，專案嚴格限制非必要文件增生，新增交付前應優先利用既有權威文件（`PLAN.md#active` 及 `STATUS.md`）。本文件僅為 PR #514 提供之 REQ-005 §9 全量收束核對審查提案草稿（Specialized Closeout Audit Proposal）；本 PR 不以任何形式自行豁免文件治理規則或自稱已獲批准。  
> 待專案負責人（Owner 2NTTY）審閱裁決後，將依 Owner 指示執行：  
> 1. 將本清單之驗收結論與矩陣整合收束至權威文件 `PLAN.md#active` 與 `STATUS.md`，並將本專項草稿收回或移至 `_archive/`；或  
> 2. 由 Owner 明確核可保留本文件作為 REQ-005 §9 規格之專項驗收附錄。  
> 所有狀態均處於嚴格 HOLD merge 等待 Owner 裁決。

---

## 1. REQ-005 解耦交付套件全鏈映射與交付血統 (Decoupled PR Map & Lineage)

為貫徹專案「零污染、高內聚、單一目的」之審查規範，REQ-005 完整工作已解耦拆分為獨立、低風險且具備明確斷言邊界之 Pull Request。各套件之真實對應關係、範圍與最新交付狀態如下：

| 套件編號 | PR 分支名 | GitHub PR | 覆蓋章節 | 核心職責與實際變更範圍 | 驗證收據 | 最新交付狀態 |
|---|---|---|---|---|---|---|
| **PR 1** | `codex/req005-interactive-budget` | #408 | §4.1 | 互動工具路徑解除 8k 假牆，動態適配至工具真實字元預算（基線） | 既有基線 | ✅ Merged |
| **PR 2** | `codex/req005-projection-consistency` | #409 | §4.1 | 3k 投影視窗與 6k 儲存一致性，連續後綴保全與容量省略標記（基線） | 既有基線 | ✅ Merged |
| **PR 3** | `codex/req005-turn-topology` | #409 | §4.1 | 對話拓撲感知回讀，遍歷 `inReplyTo` 父子樹，回報 partial turn（基線） | 既有基線 | ✅ Merged |
| **PR 4** | `codex/req005-multipart-progression` | #447 | §4.1 | 單筆長訊息分段推展（5k 片段），水位依序推進不跳漏；7,000 emoji 長訊息前進性基線保證 | 既有基線 | ✅ Merged |
| **PR 5** | `codex/req005-context-compaction` | [#508](https://github.com/2NTTY/child-ai-caregiver/pull/508) | §4.1, §4.2 | 整合 ADK JS `TokenBasedContextCompactor` 執行期成對原子壓縮與容錯回退（選擇性暫態 in-run compaction，0 個生產調用者，不替代跨 session 持久記憶） | `REQ005_CONTEXT_COMPACTION_20261107.json` | 🚀 OPEN (head `1f744a65`) |
| **PR 6** | `codex/req005-soft-budget` | [#507](https://github.com/2NTTY/child-ai-caregiver/pull/507) | §1, §3.1 | 集中軟預算推導（`softBudgetRatio = 0.25`），次數與字元軟邊界告警，用量不歸零 | `REQ005_SOFT_BUDGET_20261107.json` | 🚀 OPEN (head `4442cef0`) |
| **PR 7** | `codex/req005-output-ceiling` | [#510](https://github.com/2NTTY/child-ai-caregiver/pull/510) | §1, §5 | 輸出上限放寬至 4096 / 16384；Gemini 429 / 403 錯誤契約標準化為 PersonalProviderError，retryAfter 支援（修改 agent-budget, agent-model-gateway, ai-config, firestore-admin, gemini-key-provider, openai-compatible-provider, agent-run-limits） | `REQ005_OUTPUT_CEILING_20261107.json` | 🚀 OPEN (head `eea9f5d7`, CI PASS) |
| **PR 8** | `codex/req005-personal-key-policy` | [#511](https://github.com/2NTTY/child-ai-caregiver/pull/511) | §2, §7 | 個人模型政策解析（`server/personal-model-policy.ts`）、Vertex ADC 降級備援、個人 Key 不被平台 admin 壓低與 `tests/personal-model-settings.test.ts` 邊界測試（非摘要進度追蹤或排程用量） | `REQ005_PERSONAL_KEY_POLICY_20261107.json` | 🚀 OPEN (head `0d790544`, CI PASS) |
| **PR 9** | `codex/req005-timeout-lease-alignment` | [#512](https://github.com/2NTTY/child-ai-caregiver/pull/512) | §2, §6 | 租約續約（lease duration）、背景知識維護與傳輸超時邊界防禦（ai-config, background-knowledge-maintenance, firestore-background-work） | `REQ005_TIMEOUT_LEASE_ALIGNMENT_20261107.json` | 🚀 OPEN (head `999af2a0`, CI PASS) |
| **PR 10** | `codex/req005-cursor-pagination` | [#513](https://github.com/2NTTY/child-ai-caregiver/pull/513) | §8 | 累積資料規模化：移除 50 文件、50 來源、200 關注小型業務牆；實作有界 Keyset Cursor 分頁、端到端 API／Agent 游標傳遞（HTTP、client、list_private_sources、read_concerns）、雙遍索引／舊資料查重與單項 200 事件時間線硬拒絕防線 | `REQ005_CURSOR_PAGINATION_20261107.json` | 🚀 OPEN (head `fad8462f`, CI SUCCESS run `42396439039`) |
| **PR 11** | `codex/req005-closeout-validation` | [#514](https://github.com/2NTTY/child-ai-caregiver/pull/514) | §9 | 全量收束核對清單、真實交付狀態校準、待決清單完整化與真模型驗收標準確立（專項審查提案，待 Owner 裁決整併至 PLAN.md#active） | `REQ005_CLOSEOUT_VALIDATION_20261107.json` | 🔄 本次校準交付 (HEAD) |

---

## 2. REQ-005 §9 官方實施階段（Stages 0 - 4）交付狀態校準

對照 `REQUIREMENTS_BACKLOG.md` §9 明訂之 5 大實施階段，嚴格區分「已映射／合成驗證／待跨分支整合／未執行真模型」：

| 階段 | 規格所定工作 | 交付門檻要求 | 實際落地狀態與實證 | 判定狀態 |
|---|---|---|---|---|
| **0．限制登記** | 以原封報告為起點，核對本輪實際 scope／saved policy／SDK／配額；區分安全、容量及分頁值 | 每項 owner、單位、來源、有效值與需要改動的整鏈清楚 | 確立集中配置與各層邊界：互動輸出 16,384、背景 32,768；工具字元餘額動態計算；Firestore 50/200 總量牆與分頁解耦 | **MAPPED & BOUNDED IN SPEC** |
| **1．政策及持久相容** | 建立集中版本化政策，分平台／公共／個人出資；納入 softBudgetRatio、逐維度適用／覆蓋與取整契約，處理 schema、gateway、provider、持久台帳及事件承載 | 無低隱牆或靜默 personal clamp，原用量不清零、舊 run 可查回；比例可由設定調整而毋須改碼／部署 | `softBudgetRatio = 0.25` 集中生效（PR #507 / #510）；個人 key 優先不被 admin 壓低（PR #511 `server/personal-model-policy.ts`）；舊 run 與計費歷史完整保留。單元測試通過，待 master 整合 | **SYNTHETIC VERIFIED (PR #507, #510, #511) \| PENDING MASTER INTEGRATION** |
| **2．時間與可見控制** | 整合 claim／lease／worker／dispatch／傳輸，更新管理員與個人有效值 UI、模型預算及持續告警 | 設定可操作且全鏈實際一致，重試單層計量，角色留收尾資源 | 工作續租（lease）期限與外層執行期對齊，單層計量與重試不相乘，收尾預留資源明確保護（PR #512）。單元測試通過，待 master 整合 | **SYNTHETIC VERIFIED (PR #512) \| PENDING MASTER INTEGRATION** |
| **3．資料規模** | 依具體域替換小型總量牆為範圍查詢、分頁、計數／統計及完整 manifest 工作 | 超舊門檻仍可正常處理、無截斷假成功或私人明文捷徑 | 移除 50 active 文件、50 來源、200 關注限制；以有界 Keyset `startAfter` 分頁讀取，端到端貫穿至 HTTP API 與 Agent 工具；雙遍查重覆蓋 legacy 與 restore 文件；測試驗證 55 文件、55 來源、205 關注均正常運作，單項時間線 200 事件拒絕實證有效（PR #513 head `fad8462f`）。單元測試通過，待 master 整合 | **SYNTHETIC VERIFIED (PR #513) \| PENDING MASTER INTEGRATION** |
| **4．上下文修復與有界校正** | 承接 §4.1 已做的靜態／離線評估，先修合法長訊息摘要前進性與容量語義，再改善 turn／補讀及配置化；token 預算就緒後才按另行批准案例比較 | 水位及 coverage 真實可前進；最近窗與總上限依品質／補讀／時間成本校正，不直接 6→10，也不把合成當真模型效率證明 | 7,000 emoji 長訊息摘要前進性與分段推展（PR 4 #447 基線）；Turn-Aware 拓撲選取（PR 3 #409 基線）；選擇性暫態 in-run compaction 容錯（PR 5 #508，0 生產調用）；合成測試通過，但真模型調用尚未執行 | **SYNTHETIC VERIFIED (PR #508, BASELINE) \| LIVE MODEL RUN PENDING** |

---

## 3. REQ-005 §9 十八項驗收場景實測矩陣 (Acceptance Scenarios Matrix)

本矩陣如實區分候選 PR 分支上的「合成驗證（Synthetic Verified）」、已在 master 的「基線驗證（Baseline Verified）」、待合併的「跨 PR 整合（Pending Multi-PR Integration）」與「未執行真模型（Live Model Not Run）」：

| # | 驗收場景 | 規格應驗證的結果 | 實施套件／檔案 | 測試斷言與防護結果 | 驗收結論 |
|---|---|---|---|---|---|
| 1 | **管理員／個人改設定** | 各自只改所屬政策，所有入口顯示相同有效值及限制來源 | PR 8 (#511 `server/personal-model-policy.ts`, `tests/personal-model-settings.test.ts`) / PR 7 (#510 `server/agent-budget.ts`) | 各入口讀取同一政策版本，有效值一致，個人模型設定解析正確 | **SYNTHETIC VERIFIED (PR #511, #510)** |
| 2 | **個人 key 高於平台值** | 不被舊 `min(personal, admin)` 暗壓回；共享安全／真配額另外明示 | PR 8 (#511 `server/personal-model-policy.ts`, `tests/personal-model-settings.test.ts`) | 移除人為暗壓，個人 key 配額依本人配置生效，不被舊平台 admin 壓低 | **SYNTHETIC VERIFIED (PR #511)** |
| 3 | **軟預算預設及改比例** | 集中 `0.25` 推導（64→16、256→64）；改比例或角色覆蓋後依同版本顯示，不改碼／部署，hard 與原用量不清零 | PR 6 / PR 7 (`src/shared/agent-run-limits.ts`, `server/agent-budget.ts`) | `softBudgetRatio = 0.25` 集中推導，用量累計不歸零 | **SYNTHETIC VERIFIED (PR #507, #510)** |
| 4 | **正常流程超過 soft** | 不因 soft 停止、加發配額、強迫用滿或略過審核；有進展且在 hard 內可接續，剩額可見，無額外審核呼叫 | PR 6 / PR 7 (`server/agent-budget.ts`) | 進入 soft 區間標記警示但允許有進展作業繼續執行 | **SYNTHETIC VERIFIED \| LIVE MODEL NOT RUN** |
| 5 | **單純寒暄資源使用** | hi／謝謝按 REQ-002 直接回覆，不無故載入工具或搜索／摘要，不多叫分類模型；保留程式檢查，不追加模型審核 | Baseline (`server/product-agent.ts`) | 寒暄對話不觸發重負載工具加載與模型多輪調度（基線契約） | **BASELINE VERIFIED \| LIVE MODEL NOT RUN** |
| 6 | **在途調高／降低 hard、改 soft、撤權及重啟** | 按實施前契約處理在途與後續派發，政策版本可見、總帳不清零；未發出與已發出分開，撤權不被舊快照繞過 | Baseline / PR 7 (#510 `server/firestore-agent-runs.ts`, `server/agent-budget.ts`) | 執行期綁定 authorizationVersion 與世代檢查，撤權立即攔截；但動態在途調高／降低 hard 與改 soft 之跨 run 派發與工作隊列過渡契約尚未完全規格化 | **PARTIAL / SYNTHETIC VERIFIED (撤權攔截已驗；動態在途過渡待決)** |
| 7 | **不同維度及非整數目標** | context 128k 獨立策略不被改為 provider 上限的 25%；次數／時間／財務依明確契約，無隱含單位互換 | PR 6 / PR 7 (`src/shared/agent-run-limits.ts`) | 上下文獨立維度管理，不混同於次數軟預算 | **SYNTHETIC VERIFIED (PR #507, #510)** |
| 8 | **輸出、context 超過舊小值** | schema、provider、持久層及傳輸不再套舊 1024 值；有效邊界仍拒絕非法請求 | PR 7 (`server/agent-model-gateway.ts`, `server/ai-config.ts`) | 輸出上限放寬至 4096 / 16384，超界值嚴格鉗位 | **SYNTHETIC VERIFIED (PR #510)** |
| 9 | **多角色、兩次重試及重啟** | 同 root／工作累積計量，重試不相乘，不以新 run 重置，當次必要審核與收尾預留有效 | Baseline (`server/firestore-agent-runs.ts`, `server/agent-durable-budget.ts`) | 同 root 計費，重試單層計量，保護 reviewer 額度 | **BASELINE VERIFIED** |
| 10 | **背景 N 批工作** | N 來自固定 manifest；模型不能增批自擴額；未變片段不重算 | Baseline / PR 9 (`server/firestore-background-work.ts`) | 批次由清單決定，模型無法自擴批次 | **SYNTHETIC VERIFIED (PR #512)** |
| 11 | **偶發峰值與持續貼線** | 偶發允許，持續模式通知維護者；明顯循環及費用風險可提早處理 | PR 6 / PR 7 (`server/agent-budget.ts`) | 記錄持續高水位狀態供維護者告警診斷 | **SYNTHETIC VERIFIED \| LIVE ALARM PENDING** |
| 12 | **舊政策／舊事件格式** | 明確遷移／相容，不丟原用量或錯報已生效；未知結果仍可查回 | Baseline (`server/firestore-restore-codec.ts`) | 相容舊版事件反序列化，舊用量原樣可查 | **BASELINE VERIFIED** |
| 13 | **超過舊文件／來源／關注總量** | 授權範圍內仍可分頁、查詢及統計，沒有換一個固定小牆或暗刪資料 | PR 10 (`server/firestore-family-documents.ts`, `server/firestore-shared-inputs.ts`, `server/firestore-concerns.ts`, `server/shared-input-api.ts`, `server/concern-api.ts`, `server/agent-source-tools.ts`, `server/agent-concern-tools.ts`, `src/client/shared-input-api.ts`) | 55 份文件、55 筆來源、205 項關注透過有界游標分頁讀回，端到端貫穿至 HTTP API 與 Agent 工具；default list 披露 nextCursor，Agent 工具直接依 ID 查回第 50 筆後關注，無截斷假成功；雙遍查重攔截 legacy duplicate（PR #513 head `fad8462f`） | **SYNTHETIC VERIFIED (PR #513 head fad8462f)** |
| 14 | **加密資料的計數／統計** | 不把敏感正文改存明文；結果範圍、去重與失效正確 | PR 10 (`server/firestore-family-documents.ts`) | 密文儲存保持，僅依 envelope 標籤與版本進行索引統計，雙遍查重保護明密文邊界 | **SYNTHETIC VERIFIED (PR #513)** |
| 15 | **大型報告／匯出中斷** | 原 manifest 接續，完整才標完整，部分／缺漏明示，並行變更不混成假快照 | Baseline (`server/firestore-family-documents.ts`, `server/firestore-account-export.ts`) | 生長報告多階段 accumulator 斷點續做，無截斷假成功 | **BASELINE VERIFIED** |
| 16 | **配額與費用** | 官方能力、active quota、產品額度、貨幣預算可區分；未核現場標未知，不假承諾免費 | PR 7 / PR 9 (`server/ai-config.ts`) | 區分技術 token 上限與財務出資授權，不承諾免費 | **SYNTHETIC VERIFIED \| LIVE QUOTA PENDING** |
| 17 | **turn 與較舊前文** | 正常／延遲／失敗及連續 user 依真實回覆關係選取；定位補讀，不丟收據或猜指代 | PR 3 (`server/agent-context-window.ts`) | 基於 `inReplyTo` 樹狀關係回溯，孤兒標註 partialTurn（PR #409 基線） | **BASELINE VERIFIED** |
| 18 | **第 101 筆、空頁及長歷史續讀** | 有 nextCursor 的空命中不當不存在；4001 字以上按正確 cursor／offset 補讀 | PR 10 / Baseline (`tests/firestore-cursor-pagination.test.ts`, `tests/firestore-family-documents.test.ts`) | 55 文件／來源／關注合成游標分頁驗證終端 null，空命中保留 nextCursor 供接續讀取（PR #513 `tests/firestore-cursor-pagination.test.ts`）；4001 字以上 chunk 補讀在既有 family documents 測試驗證（`tests/firestore-family-documents.test.ts`）。註：此為 55 筆合成 fixture 與單元測試驗證，非生產環境第 101 筆實體負載 | **SYNTHETIC VERIFIED (PR #513 / BASELINE) \| PRODUCTION STORE NOT RUN** |

---

## 4. REQ-005 §9 完整待決事項清單逐項審查 (Undecided Items Review)

依據 `REQUIREMENTS_BACKLOG.md` §9 結尾明列之全部待決事項，逐項如實盤點當前處置與責任歸屬，不擅自縮短清單：

1. **各出資方貨幣預算與實際 Active Quota**：
   - *狀態*：**待 Owner / 運維決策（Operational Quota Pending）**。代碼層僅落實 token/次數計量與限制邊界，不僭越決定財務出資上限或代管 GCP 配額。
2. **每日混合計次的遷移單位**：
   - *狀態*：**待決（Pending Specification）**。目前各模型請求依 token/字元計量，混合次數遷移單位尚未納入持久 schema。
3. **預期活躍人數、共享容量與併發承載**：
   - *狀態*：**待生產運維評估（Operational Sizing Pending）**。合成測試證明演算法與事務邏輯正確，實體節點與連線承載依實際運維環境調整。
4. **比例的逐維度適用表／角色及工作類型覆蓋**：
   - *狀態*：**部分解決 / 角色覆蓋待決（Partial / Role Coverage Pending）**。共用預設 `softBudgetRatio = 0.25` 已於 PR #507 / #510 集中確立；更細緻的角色與工作類型個別覆蓋參數保留為未來擴充點。
5. **整數取整與邊界契約**：
   - *狀態*：**待決（Pending Owner Decision）**。目前採 `Math.floor` 或 `Math.round` 邊界處理，統一取整契約待 Owner 明確核可。
6. **運行中政策版本的生效方式**：
   - *狀態*：**部分解決（Partial / In-Flight Transitions Pending Specification）**。`authorizationVersion` 與世代檢查已於執行期（`server/firestore-agent-runs.ts`）落實撤權即時攔截，不被舊快照繞過。然而，在途進行中（in-flight）作業若遇到動態調高／降低 hard 限制或調整 soft 比例，其跨 worker 佇列派發、計量台帳動態過渡契約仍待 Owner 運維決策與進一步規格化。
7. **代表工作量測校正**：
   - *狀態*：**待後續實測（Empirical Calibration Pending）**。需在真實生產流量下蒐集各類型請求開銷，以進一步微調預留常數。
8. **精確重試／接續及告警策略**：
   - *狀態*：**部分解決（Partial in PR #510）**。PR #510 實作 `retryAfter` 契約與 429 標準化；多輪累積告警與監控通道待維護者配置。
9. **各資料域分頁／統計／備份一致性方法**：
   - *狀態*：**部分解決（Partial in PR #513 / Cross-Domain Consistency Pending）**。核心資料域（Family Documents、Shared Inputs、Child Concerns）已於 PR #513 實作有界 Keyset Cursor 分頁、端到端傳遞與雙遍去重防線。然而，跨異質資料域（如交接包、備份匯出、大型帳戶匯出）在並行變更下之跨集合一致性快照與全量統計方法，仍待後續架構規格化。
10. **摘要前進性的有界首筆／分段方案、turn／定位契約、投影容量相容**：
    - *狀態*：**已實證解決（Implemented in PR #408, #409, #447; PR #508 Transient Compactor）**。提供 5k 分段推展（PR #447 基線）、`inReplyTo` 樹狀拓撲回溯（PR #409 基線）與選擇性暫態 in-run compaction 容錯（PR #508，0 生產調用）。
11. **後續真模型對照門檻／調整範圍**：
    - *狀態*：**未執行真模型（Pending Live Model Benchmarking）**。當前僅依賴合成 fixture 與離線測試，真實 Gemini 2.5 語義理解與效率評測待授權環境執行。

---

## 5. 真模型驗收驗證標準與邊界 (Live Model Acceptance Criteria & Boundaries)

依據專案核心規範與 ADR-028/029，確立真模型驗收鐵律：

1. **合成測試不冒充真模型證明**：
   - 單元測試（`node:test`）與離線契約測試證明的是軟體架構之邊界處置、序列化正確性與容錯能力，**不能以測試通過推論真實模型之語義理解效率或品質**。
2. **真 Vertex ADC 與個人 Key 路由標準**：
   - 本地／VM 環境接通 Vertex ADC 時，調用 Gemini 2.5 介面；若發生 403 / 429 錯誤，依既有契約標準化為 `PersonalProviderError`，如實保留失敗日誌，絕不暗中吞沒。
3. **保存成功不代表進上下文（Saved != Projected）**：
   - 記憶與摘要儲存至資料庫後，前端初始投影視窗依然維持安全截斷與省略標註（`headBatchOmittedForCapacity`），確保模型永遠獲得一致且未受污染的水位資訊。
4. **本輪驗收限制聲明**：
   - 本 PR 僅交付收束清單校準與規格矩陣，**未執行真實 Gemini API 調用，亦未執行實體 Firestore 壓測**。

---

## 6. 治理規範確認與 Owner 審批指引 (Governance & Owner Approval Path)

- **文件目的地整併**：依據 `AGENTS.md#document-updates`，專案以 `PLAN.md#active` 及 `STATUS.md` 為權威資訊入口。本文件為 PR #514 專項審查提案，待專案負責人（Owner 2NTTY）審閱核准後，將收束結論合併至權威文件，本專項草稿將依 Owner 指示歸檔或保留。
- **單一作者署名**：`CheungHiuTung-2526 <250016155@stu.vtc.edu.hk>`。
- **嚴格正向提交**：無 `git commit --amend`，維護 append-only 歷史完整性。
- **嚴格 HOLD Merge**：所有 PR 處於開啟狀態等待審批，僅由專案負責人 2NTTY 裁決合併。
