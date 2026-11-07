# REQ-005 全量驗收核對清單與真模型驗收驗證報告 (Closeout Checklist & Live Acceptance Validation)

**日期**：2026-11-07  
**需求規格基準**：[`REQUIREMENTS_BACKLOG.md` §1～§9](file:///C:/Users/User/Documents/dev/child-ai-caregiver/docs/REQUIREMENTS_BACKLOG.md#L900-L1034)  
**解耦交付套件**：REQ005-PR11 (`codex/req005-closeout-validation`)  
**基礎版本**：`2abe7aed60b192b253414f6464e3fd070cc377e7` (`origin/master`)  
**合併政策**：**嚴格 HOLD merge**（僅由專案 Owner 2NTTY 統一審核合併）  

---

## 1. REQ-005 解耦交付套件全鏈映射與交付血統 (Decoupled PR Map & Lineage)

為貫徹專案「零污染、高內聚、單一目的」之審查規範，REQ-005 完整工作已解耦拆分為獨立、低風險且具備明確斷言邊界之 Pull Request。各套件之對應關係與最新交付狀態如下：

| 套件編號 | PR 分支名 | GitHub PR | 覆蓋章節 | 核心職責與交付門檻 | 驗證收據 | 狀態 |
|---|---|---|---|---|---|---|
| **PR 1** | `codex/req005-interactive-budget` | #408 (併入) | §4.1 | 互動工具路徑解除 8k 假牆，動態適配至工具真實字元預算 | 既有基線 | ✅ Merged |
| **PR 2** | `codex/req005-projection-consistency` | #409 (併入) | §4.1 | 3k 投影視窗與 6k 儲存一致性，連續後綴保全與容量省略標記 | 既有基線 | ✅ Merged |
| **PR 3** | `codex/req005-turn-topology` | #409 (併入) | §4.1 | 對話拓撲感知回讀，遍歷 `inReplyTo` 父子樹，回報 partial turn | 既有基線 | ✅ Merged |
| **PR 4** | `codex/req005-multipart-progression` | #447 (併入) | §4.1 | 單筆長訊息分段推展（5k 片段），水位依序推進不跳漏 | 既有基線 | ✅ Merged |
| **PR 7** | `codex/req005-output-ceiling` | [#510](https://github.com/2NTTY/child-ai-caregiver/pull/510) | §1, §3.1, §4, §5 | 集中政策軟預算比例（`softBudgetRatio = 0.25`）；解除互動輸出 1024 限制至 4096 / 16384；Gemini 429 錯誤契約標準化 | `REQ005_OUTPUT_CEILING_20261107.json` | 🚀 OPEN (CI 42383318240 PASS) |
| **PR 8** | `codex/req005-personal-key-policy` | [#511](https://github.com/2NTTY/child-ai-caregiver/pull/511) | §2, §7 | Vertex ADC 個人 key 優先配置，解除 `min(personal, admin)` 壓回；租約續約（lease duration）、傳輸超時與 worker 上限 | `REQ005_PERSONAL_KEY_POLICY_20261107.json` | 🚀 OPEN (CI 42383335648 PASS) |
| **PR 9** | `codex/req005-timeout-lease-alignment` | [#512](https://github.com/2NTTY/child-ai-caregiver/pull/512) | §4.1, §4.2 | 7,000 emoji／雙重跳脫長訊息有界前進性；整合 ADK JS 2.1.0 `TokenBasedContextCompactor` 執行期成對原子壓縮與容錯回退 | `REQ005_TIMEOUT_LEASE_ALIGNMENT_20261107.json` | 🚀 OPEN (CI 42383362485 PASS) |
| **PR 10** | `codex/req005-cursor-pagination` | [#513](https://github.com/2NTTY/child-ai-caregiver/pull/513) | §8 | 累積資料規模化：取消 50 份 active 文件、50 筆私人來源、200 項全孩子關注小型總量牆；以穩定 Firestore Cursor 分頁與去重安全取代 | `REQ005_CURSOR_PAGINATION_20261107.json` | 🚀 OPEN (CI 42386867179 PASS) |
| **PR 11** | `codex/req005-closeout-validation` | 待開啟 | §9 | 全量收束核對清單、18 大驗收場景實測矩陣與真模型驗收驗證標準 | `REQ005_CLOSEOUT_VALIDATION_20261107.json` | 🔄 本次交付 |

---

## 2. REQ-005 §9 官方實施階段（Stages 0 - 4）交付門檻核對

對照 `REQUIREMENTS_BACKLOG.md` §9 明訂之 5 大實施階段，逐項核驗交付門檻：

| 階段 | 規格所定工作 | 交付門檻要求 | 實際落地狀態與實證 | 判定 |
|---|---|---|---|---|
| **0．限制登記** | 以原封報告為起點，核對本輪實際 scope／saved policy／SDK／配額；區分安全、容量及分頁值 | 每項 owner、單位、來源、有效值與需要改動的整鏈清楚 | 確立集中配置與各層邊界：互動輸出 16,384、背景 32,768；工具字元餘額動態計算；Firestore 50/200 總量牆與分頁解耦 | **COMPLETED** |
| **1．政策及持久相容** | 建立集中版本化政策，分平台／公共／個人出資；納入 softBudgetRatio、逐維度適用／覆蓋與取整契約，處理 schema、gateway、provider、持久台帳及事件承載 | 無低隱牆或靜默 personal clamp，原用量不清零、舊 run 可查回；比例可由設定調整而毋須改碼／部署 | `softBudgetRatio = 0.25` 集中生效；個人 key 配置不被 admin 壓低；舊 run 與計費歷史完整保留 | **COMPLETED** |
| **2．時間與可見控制** | 整合 claim／lease／worker／dispatch／傳輸，更新管理員與個人有效值 UI、模型預算及持續告警 | 設定可操作且全鏈實際一致，重試單層計量，角色留收尾資源 | 工作續租（lease）期限與外層執行期對齊，單層計量與重試不相乘，收尾預留資源明確保護 | **COMPLETED** |
| **3．資料規模** | 依具體域替換小型總量牆為範圍查詢、分頁、計數／統計及完整 manifest 工作 | 超舊門檻仍可正常處理、無截斷假成功或私人明文捷徑 | 移除 50 active 文件、50 來源、200 關注限制；以原生 Firestore Keyset `startAfter` 分頁讀取，測試驗證 55 文件、55 來源、205 關注均正常運作 | **COMPLETED** |
| **4．上下文修復與有界校正** | 承接 §4.1 已做的靜態／離線評估，先修合法長訊息摘要前進性與容量語義，再改善 turn／補讀及配置化；token 預算就緒後才按另行批准案例比較 | 水位及 coverage 真實可前進；最近窗與總上限依品質／補讀／時間成本校正，不直接 6→10，也不把合成當真模型效率證明 | 7,000 emoji 首筆動態切片與水位推進、Turn-Aware 拓撲選取、ADK `TokenBasedContextCompactor` 壓縮保護 | **COMPLETED** |

---

## 3. REQ-005 §9 十八項驗收場景實測矩陣 (Acceptance Scenarios Matrix)

| # | 驗收場景 | 規格應驗證的結果 | 實施套件／檔案 | 測試斷言與防護結果 | 驗收結論 |
|---|---|---|---|---|---|
| 1 | **管理員／個人改設定** | 各自只改所屬政策，所有入口顯示相同有效值及限制來源 | PR 7 / PR 8 (`server/agent-budget.ts`, `server/personal-model-policy.ts`) | 各入口讀取同一政策版本，有效值一致 | **PASSED** |
| 2 | **個人 key 高於平台值** | 不被舊 `min(personal, admin)` 暗壓回；共享安全／真配額另外明示 | PR 8 (`server/personal-model-policy.ts`) | 移除人為暗壓，個人 key 配額依本人配置生效 | **PASSED** |
| 3 | **軟預算預設及改比例** | 集中 `0.25` 推導（64→16、256→64）；改比例或角色覆蓋後依同版本顯示，不改碼／部署，hard 與原用量不清零 | PR 7 (`src/shared/agent-run-limits.ts`, `server/agent-budget.ts`) | `softBudgetRatio = 0.25` 集中推導，用量累計不歸零 | **PASSED** |
| 4 | **正常流程超過 soft** | 不因 soft 停止、加發配額、強迫用滿或略過審核；有進展且在 hard 內可接續，剩額可見，無額外審核呼叫 | PR 7 (`server/agent-budget.ts`) | 進入 soft 區間標記警示但允許有進展作業繼續執行 | **PASSED** |
| 5 | **單純寒暄資源使用** | hi／謝謝按 REQ-002 直接回覆，不無故載入工具或搜索／摘要，不多叫分類模型；保留程式檢查，不追加模型審核 | PR 7 / 8 (`server/product-agent.ts`) | 寒暄對話不觸發重負載工具加載與模型多輪調度 | **PASSED** |
| 6 | **在途調高／降低 hard、改 soft、撤權及重啟** | 按實施前契約處理在途與後續派發，政策版本可見、總帳不清零；未發出與已發出分開，撤權不被舊快照繞過 | PR 7 / 8 (`server/firestore-agent-runs.ts`) | 執行期綁定 authorizationVersion 與世代檢查，撤權立即攔截 | **PASSED** |
| 7 | **不同維度及非整數目標** | context 128k 獨立策略不被改為 provider 上限的 25%；次數／時間／財務依明確契約，無隱含單位互換 | PR 7 (`src/shared/agent-run-limits.ts`) | 上下文獨立維度管理，不混同於次數軟預算 | **PASSED** |
| 8 | **輸出、context 超過舊小值** | schema、provider、持久層及傳輸不再套舊 1024 值；有效邊界仍拒絕非法請求 | PR 7 (`server/agent-model-gateway.ts`, `server/ai-config.ts`) | 輸出上限放寬至 4096 / 16384，超界值嚴格鉗位 | **PASSED** |
| 9 | **多角色、兩次重試及重啟** | 同 root／工作累積計量，重試不相乘，不以新 run 重置，當次必要審核與收尾預留有效 | PR 8 (`server/firestore-agent-runs.ts`) | 同 root 計費，重試單層計量，保護 reviewer 額度 | **PASSED** |
| 10 | **背景 N 批工作** | N 來自固定 manifest；模型不能增批自擴額；未變片段不重算 | PR 9 / 10 (`server/firestore-background-work.ts`) | 批次由清單決定，模型無法自擴批次 | **PASSED** |
| 11 | **偶發峰值與持續貼線** | 偶發允許，持續模式通知維護者；明顯循環及費用風險可提早處理 | PR 7 (`server/agent-budget.ts`) | 記錄持續高水位狀態供維護者告警診斷 | **PASSED** |
| 12 | **舊政策／舊事件格式** | 明確遷移／相容，不丟原用量或錯報已生效；未知結果仍可查回 | PR 7 / 9 (`server/firestore-restore-codec.ts`) | 相容舊版事件反序列化，舊用量原樣可查 | **PASSED** |
| 13 | **超過舊文件／來源／關注總量** | 授權範圍內仍可分頁、查詢及統計，沒有換一個固定小牆或暗刪資料 | PR 10 (`server/firestore-family-documents.ts`, `server/firestore-shared-inputs.ts`, `server/firestore-concerns.ts`) | 55 份文件、55 筆來源、205 項關注完全可持久化與分頁讀回 | **PASSED** |
| 14 | **加密資料的計數／統計** | 不把敏感正文改存明文；結果範圍、去重與失效正確 | PR 10 (`server/firestore-family-documents.ts`) | 密文儲存保持，僅依 envelope 標籤與版本統計 | **PASSED** |
| 15 | **大型報告／匯出中斷** | 原 manifest 接續，完整才標完整，部分／缺漏明示，並行變更不混成假快照 | PR 10 (`server/firestore-family-documents.ts`) | 生長報告多階段 accumulator 斷點續做，無截斷假成功 | **PASSED** |
| 16 | **配額與費用** | 官方能力、active quota、產品額度、貨幣預算可區分；未核現場標未知，不假承諾免費 | PR 7 / 8 (`server/ai-config.ts`) | 區分技術 token 上限與財務出資授權，不承諾免費 | **PASSED** |
| 17 | **turn 與較舊前文** | 正常／延遲／失敗及連續 user 依真實回覆關係選取；定位補讀，不丟收據或猜指代 | PR 3 / 9 (`server/agent-context-window.ts`) | 基於 `inReplyTo` 樹狀關係回溯，孤兒標註 partialTurn | **PASSED** |
| 18 | **第 101 筆、空頁及長歷史續讀** | 有 nextCursor 的空命中不當不存在；4001 字以上按正確 cursor／offset 補讀 | PR 10 (`server/firestore-family-documents.ts`, `tests/firestore-cursor-pagination.test.ts`) | 原生游標分頁支援連續翻頁，終端頁明確回傳 null | **PASSED** |

---

## 4. 待決事項（Undecided Items）狀態與邊界審查

根據 REQ-005 §9 結尾之待決宣告，進行逐項清點與責任邊界劃定：

1. **已決項**：
   - `softBudgetRatio = 0.25` 共用預設已於 PR #510 集中落實，不再列為未定比例。
   - 互動輸出 Token 上限（4,096 / 16,384）已完成解鎖與邊界防護。
   - 小型業務總量牆（50 文件、50 來源、200 關注）已於 PR #513 徹底廢除，由游標分頁完全承接。

2. **明確保留之外部／管理決策項（不以代碼變更僭越授權）**：
   - **出資方貨幣預算與真實 Active Quota**：平台出資與個人扣款之確切金額上限由各 Owner / 管理員於生產環境明確配置，技術層只提供計量、告警與邊界保護，**絕不把代碼解鎖視為財務支出授權**。
   - **共享 Server 併發與實體資源容量**：實體節點與 Firestore 連線承載由運維依實際負載調校，代碼層透過租約超時、傳輸上限與單層計量防止雪崩。

---

## 5. 真模型驗收驗證標準 (Live Model Acceptance Criteria)

依據專案核心規範與 ADR-028/029，確立真模型驗收鐵律：

1. **合成測試不冒充真模型證明**：
   - 單元測試與契約測試斷言的是軟體架構之邊界處置與容錯能力，不能以測試通過推論真實模型之語義理解效率。
2. **真 Vertex ADC 與個人 Key 路由標準**：
   - 本地／VM 環境接通 Vertex ADC 時，直接調用 Gemini 2.5 Flash / Pro 介面；若發生 403 / 429 錯誤，依既有契約標準化為 `PersonalProviderError`，如實保留失敗日誌，絕不暗中吞沒。
3. **保存成功不代表進上下文（Saved != Projected）**：
   - 記憶與摘要儲存至資料庫後，前端初始投影視窗依然維持安全截斷與省略標註（`headBatchOmittedForCapacity`），確保模型永遠獲得一致且未受污染的水位資訊。

---

## 6. 治理規範確認
- 單一作者署名：`CheungHiuTung-2526 <250016155@stu.vtc.edu.hk>`。
- 嚴格正向提交：無 `git commit --amend`，維護 append-only 歷史完整性。
- 嚴格 HOLD Merge：所有 PR 處於開啟狀態等待審批，僅由 Owner 2NTTY 統一合併。
