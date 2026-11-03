# REQ-005 對話歷史摘要前進性與長訊息分段方案草案

**文件版本**：v1.2.1

**核對日期**：2026-11-03（UTC）

**範圍**：REQ-005 §4.1 的摘要前進性子工作；不代表整個 REQ-005 完成

**關聯 PR**：[PR #408](https://github.com/2NTTY/child-ai-caregiver/pull/408)、[PR #409](https://github.com/2NTTY/child-ai-caregiver/pull/409)

## 1. 文件地位、版本及問題

本文件整理現有候選修復、尚欠產品結果及待討論方案，不新增已批准政策、持久資料契約或交付承諾。權威需求與完成門檻仍見 [REQUIREMENTS_BACKLOG v0.11](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/docs/REQUIREMENTS_BACKLOG.md#L848-L1034)，工作包、現況及契約分別沿 [PLAN](../PLAN.md)、[STATUS](../STATUS.md) 及既有資料／API 文件。

### 1.1 本次審閱固定版本

| 對象 | 固定版本及觀察 |
|---|---|
| master／需求基線 | `9ca338882ed21a3b01d534581d7a6e532c72da2a` |
| #408 原候選實作 | `d1fca9f3da4e4b7bfea9cabca20ba0dd31f70869`；2026-11-03 本輪核對時仍 open、未合併 |
| #409 原文件 | `b99c46cc444d4838ee0ba372696829a0887cf3e5`；同時仍 open、未合併，本版修正其狀態及範圍敘述 |

以下對 #408 的程式及測試描述均指表內原候選版本，不把其後修改、合併或部署推定為已發生。更新實作後，須以新的精確 head 與驗證結果另行核對。

舊版將摘要視為完整訊息的有序 prefix；背景選取的 raw JSON 目標為 12,000 UTF-16 code units。7,000 個 emoji 的正文已佔 14,000 code units，符合輸入的 code-point 限制，卻可令首筆無法納入，後續重試仍停在同一水位。原 9,000 個 ASCII 字案例在背景可容納，但互動路徑先受 8k raw JSON prefix 限制，即使後續工具餘額充裕也不能納入該首筆，不能混為同一案例。原問題及範圍見 [REQ-005 §4.1](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/docs/REQUIREMENTS_BACKLOG.md#L921-L939)。

### 1.2 原需求要求的產品結果

- 每個合法單訊息可經有界首筆容納或訊息內分段持續處理，不能永遠 defer 同一長首筆，也不能跳過它或虛報 coverage。
- 完整覆蓋後才推進訊息水位；背景、互動、修復、保存／投影／包裝的容量與覆蓋語義須一致。
- 保留身份／孩子／模式隔離、來源版本、原操作收據、撤權及當次適用的審核／收尾資源；接續不重置原 root／工作總帳。
- 合成測試證明程式契約的範圍，不能代替真模型品質、正式服務或設備驗收。

本文件原稱「Phase 1／2／3」的是摘要子工作的提案分組，並非原 REQ-005 §9 的正式階段。原階段 1 是政策及持久相容，摘要修復屬階段 4；下文改用「候選修復／後續方案／額外研究」，避免混算完成度。

## 2. 當前容量語義與證據限制

### 2.1 Gateway 使用當次產品預算

[Gateway](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/server/agent-model-gateway.ts#L159-L178) 比較完整請求的 `agentRequestCharacters(request)` 與 `budget.limits.inputCharacters`，超額才停止於 `input_limit`。這是產品的 logical JSON UTF-16 字元保護，不是 Gemini 或所有模型的官方 token／物理能力上限。

[本版預算](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/server/agent-budget.ts#L8-L22) 的 worker 基線為 32,000；互動預設為 64,000，可由可信 Server 設定於 32,000–64,000 範圍內選取。這些是所核對程式的現況，不是本文件批准提高或永久固定的政策。

純文字摘要請求的計數包括 `contents` 與 `config`，涵蓋 system instructions、tool schema、來源訊息、instruction、coverage IDs 及 `currentSources`。`agentRequestCharacters` 對已驗證媒體另有 bounded marker 處理，不能把純文字公式無條件套到所有媒體請求。

### 2.2 Raw JSON、payload 估算與完整 request 不同

訊息先被序列化為提示文字，再進入完整 request 的 JSON 計數，故原文字數不等於最終請求字元數。例如單個雙引號在兩層 JSON 中可貢獻四個 code units；emoji 通常佔兩個 UTF-16 code units。總量還取決於實際欄位、metadata 及包裝，不能只用正文長度推定通過。

原 #408 的 [helper](https://github.com/2NTTY/child-ai-caregiver/blob/d1fca9f3da4e4b7bfea9cabca20ba0dd31f70869/server/summary-window-helper.ts#L1-L78) 採用：

- 普通多訊息累積目標 `SUMMARY_BATCH_TARGET_CHARS = 12,000`。
- 固定預留 `SUMMARY_GATEWAY_RESERVE_CHARS = 10,500`。
- 估算 payload 門檻 `SUMMARY_SAFE_REQUEST_CEILING = 32,000 - 10,500 = 21,500`。

這是原候選的工程估算，**不是已證明適用所有合法 metadata、修復來源及 runtime 的安全上界**。helper 的序列化形狀並非完整 worker request，修復來源在實際請求中的包裝位置亦須逐項核對。不能用少量 fixture 測得的開銷，推出任意請求「絕不超過 32k」或「保證生產安全」。

原文的固定 payload 常數、5,301–5,559 引號回歸區間及精確 request 長度並無在本文件中保留為通用門檻。此類邊界須固定訊息完整形狀、metadata、prompt/schema、currentSources、runtime 與程式 head，透過實際組裝及同一 gateway 計數核實。

### 2.3 互動 read_context 的兩道容量限制

互動路徑先呼叫 [uncoveredConversation](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/server/product-agent-tools.ts#L84-L98)，以固定 8,000 raw JSON code units 選完整訊息 prefix；首筆不 fit 便停止，不受後續動態工具餘額變大影響。`read_context` 在第 283 行先取得此 `loaded`，後續只會再縮減其訊息，不能把已排除的 9,000 ASCII 或 7,000 emoji 首筆補回。

其後才進行整份工具結果的第二道檢查：[AgentBudget](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/server/agent-budget.ts#L204-L220) 由完整請求、模型回覆及保留量計算 `toolResponseCharacters`；未準備動態預算時才 fallback 至 8,000。[read_context](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/server/product-agent-tools.ts#L279-L327) 再使用 `max(0, budget.toolResponseCharacters - 512)` 量度整份工具結果。

因此 7,488 只是第二道檢查在 fallback 情況的 allowance，並非所有讀取的固定硬上限；前置 8k raw prefix 則是此版本仍存在的獨立限制。這是 Server Agent 工具路徑，不是前端畫面改動；選取、分段及 metadata 都要服從當次有效餘額，不能承諾任何餘額下單次便返回全部語義。

## 3. #408 原候選修復與未完成項

| 原候選行為 | 可合理聲稱的範圍 | 仍未完成／未證明 |
|---|---|---|
| 首筆 raw JSON 超過 12k，但估算 payload 在 21.5k 內時整筆納入 | 背景有界首筆容納；例如原測試的 7,000 emoji | 全部合法訊息、全部 metadata 及完整 request 的安全前進性 |
| 後續訊息同時檢查 raw 目標與估算 payload | 有序前綴的大小防護，不跳過中間長訊息 | 不等於完整 request 的所有開銷已受相同估算約束 |
| 首筆超過估算門檻時回 `message_requires_continuation` | 明確停止，沒有假 coverage | 未實作 continuation cursor／分段進度；同一首筆仍可永久停滯 |
| `repairInput` 改用估算門檻，超額回 `null` | 繼續隱藏失效批次 | 隱藏不是修復成功；超額修復沒有分段接續 |
| 保存既有完整 prefix 後推進水位 | 保留原完整訊息保存檢查 | 未有部分訊息的持久 coverage／防重協定 |
| `product-agent-tools.ts` 未修改 | 無互動路徑新增交付 | 互動長首筆的選取及摘要 coverage 仍須補齊 |

來源：[原候選 prepareMaintenance 選取](https://github.com/2NTTY/child-ai-caregiver/blob/d1fca9f3da4e4b7bfea9cabca20ba0dd31f70869/server/firestore-memory.ts#L570-L584)、[原候選修復／保存](https://github.com/2NTTY/child-ai-caregiver/blob/d1fca9f3da4e4b7bfea9cabca20ba0dd31f70869/server/firestore-memory.ts#L393-L453)、[背景停止路徑](https://github.com/2NTTY/child-ai-caregiver/blob/d1fca9f3da4e4b7bfea9cabca20ba0dd31f70869/server/private-summary-maintenance.ts#L8-L29)。

**結論：原 #408 是局部候選修復，尚未達成 REQ-005 §9「合法長單訊息摘要前進性」整列驗收；#409 只修改文件，沒有實作後續功能。**其他 REQ-005 的集中政策、turn-aware recent、歷史定位、投影相容、完整 token budget 及同 run compaction 不在這兩個原 PR 的新增實作內，不能計作已交付。

## 4. 後續分段方案：待定案，未實作

本節保留原方案的可用方向，作需求範圍內的討論材料。以下欄位、儲存位置及演算法均未成為權威 schema；實施前須回到既有 PLAN／資料／API 契約定案，不能照此草案直接遷移 Firestore。

### 4.1 進度與資料契約的候選方向

原稿提出 `sourceMessageId`、`partIndex`、`totalParts`、`startOffset`、`endOffset` 及 `isLastPart`。這些只是候選欄位；光有 index／offset 不能證明來源版本、完整覆蓋或安全恢復。仍須明定：

- 分段綁定的來源訊息／版本及內容 hash、身份／孩子／模式、授權狀態及摘要 basis；hash 的生成、核對及來源變更規則須先定案。
- Offset 的單位、區間邊界、相鄰片段無缺口／無重複的連續性及完整性驗證；動態餘額下是否能預先確定 `totalParts`。
- 部分成果的持久格式、舊 reader 相容、完成標記、併發／防重與原工作計量。
- 普通摘要與修復摘要的來源依賴、更正／撤權／刪除／到期，以及部分成果失效時如何安全重建；並行修復的原子替換／提交邊界尚待定案。

這些是待解的實作問題，不在本文件新增一份可直接寫入的 TypeScript／Firestore 契約。

### 4.2 容量與切分順序

先以當次有效容量及完整包裝，找出可容納且有進展的候選片段，再在可容納範圍內選段落、換行、標點或安全文字邊界。不得切斷 UTF-16 surrogate pair，也不能為追求語義邊界而越過容量。切分與完整訊息的合法輸入判斷仍須分開。

原稿的「10,000–12,000 raw 字元兜底」不能用作安全規則：escape-heavy 內容經兩層序列化後可能超額。10,000 個引號亦不預先規定必須切成三段；片段數及 offset 應由已核對的包裝、metadata、當次餘額與切分策略決定。

### 4.3 前進、恢復與修復

1. 保存已驗證的片段 coverage 及原工作進度；未完整覆蓋訊息前，不把整條訊息標成完成或跨過其水位。
2. 重啟／重試先讀原進度與原結果，核版本及授權後才接續；unknown 結果不盲重送，不另開帳重置消耗。
3. 最後片段完整且來源仍有效時，才按已定案的一致性協定完成摘要及推進水位。
4. 修復須依當前有效來源重建完整 coverage；不能復活已刪、到期或失權內容，也不能丟失來源依賴以硬塞容量。部分修復不可對外宣稱完整。
5. 互動讀取須讓返回內容、`privateSummaryInput` 及保存時核對的 coverage 一致，並如實標示尚未涵蓋部分；獨立 history 補讀不自動代表摘要已覆蓋。

這些對應原需求的不變條件，具體交易／恢復方法及所需驗收仍待實作方案確認。

## 5. 額外研究提案與驗證安排

### 5.1 未採納的額外政策

原稿的 token 密度調窗、重試熔斷／告警及摘要 rollup 可供後續研究，但不是本輪已批准或已實作政策。本版移除 9k–14k 窗口、三次失敗隔離、45 秒／120 秒逾時及 50 批自動 rollup 的指定值，亦不以固定字元／token 比例代替指定模型的實際用量或明示估算。

若日後採納，須依 [REQ-005 中央政策](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/docs/REQUIREMENTS_BACKLOG.md#L867-L917) 明定 owner、單位、soft／hard、來源、版本、有效值與原工作計量；不能藉分段自行增批加額、改付款身份或引入未批准開支。重試、告警、逾時及 rollup 不在此文取得執行授權。

摘要壓縮不等於清理原始歷史。原訊息、來源、收據及 unknown 狀態仍按既有保留／刪除／授權契約處理；不因本草案自動清理冷資料，不延長保留期，也不從失效摘要復活內容，見 [REQ-005 §4.2](https://github.com/2NTTY/child-ai-caregiver/blob/9ca338882ed21a3b01d534581d7a6e532c72da2a/docs/REQUIREMENTS_BACKLOG.md#L943-L952)。

### 5.2 現有測試定義與尚欠驗收

下表描述 [原 #408 測試原碼](https://github.com/2NTTY/child-ai-caregiver/blob/d1fca9f3da4e4b7bfea9cabca20ba0dd31f70869/tests/summary-progress.test.ts)，**不是本文件修訂重新執行產品測試的成績單**。

| 範圍 | 原測試定義／尚欠結果 |
|---|---|
| 背景 7,000 emoji 與保存後水位 | 原 tests 1–2 有局部容納／推進斷言；不涵蓋所有合法訊息 |
| 逃逸正文及多訊息累積 | 原 tests 3–4 有放行／停止邊界；停止超額首筆不是前進性成功 |
| 完整 worker 組裝 | 原 tests 5、7 經 `maintainSummary` 組裝請求，以 scripted provider 捕獲並量度；沒有呼叫真模型或驗收正式環境 |
| 失效批次修復 | 原 test 6 檢查 14k 修復輸入的 repairOf／message ID 並呼叫保存；超額案例只斷言 `prepareMaintenance(...) === null`，未直接驗證投影隱藏、provider 請求或超額接續 |
| 合法長訊息／最大 metadata／修復 currentSources | 須核對完整 request 的實際序列化及有效預算；不以固定 reserve 或極簡 fixture 取代 |
| 訊息內分段、重啟、防重及最後水位 | 原 #408 未實作；須有連續完整 coverage、版本／撤權／取消及 unknown 證據 |
| 互動與背景一致 | 須測工具餘額充裕但 9,000 ASCII 先被 raw 8k prefix 擋下的案例，以及動態餘額不足、首筆容納／分段、保存 coverage、metadata-only 及 metadata 本身超額；明示未涵蓋／省略，不固定期待 7,488 或三個 parts |
| 保存／投影／包裝 | 原需求指出可保存 6k 摘要卻有 3k 整批投影及另一層包裝限制；須核對省略／補讀與容量相容，不能以保存成功推論已進模型 context |
| recent 與歷史定位 | turn-aware 選取、partial turn、已知 ID／相鄰 turn 及原資源續讀仍按原需求驗收，未由本輪候選交付 |
| 額外政策及 rollup | 未採納、未實作；不列為本輪通過測試或既定交付門檻 |

## 6. 交付及協作界線

本次文件修正只校準候選狀態、容量單位、證據層級及方案地位。後續程式修改、測試通過、合併與部署須分開記錄精確版本；不得將「已寫測試」「安全停止」「保持失效內容隱藏」改寫成整個需求已完成。

下一步先修及核實 #408 的確定問題，保留剩餘產品缺口；分段及政策工作按已確認需求另行定案。文件、PR 描述或局部合成測試不授權真模型、真家庭資料、正式部署或網站更新，也不取代必要 review、分支保護及驗收。
