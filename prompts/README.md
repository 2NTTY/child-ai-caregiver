# 育有方 Agent Prompt Pack

版本 **0.1.51** · 原文件工作包 **DOC-P01** · 配方／模組定義以 [manifest](manifest.json) 為準；實作／驗收狀態只按 [根 PLAN](../PLAN.md#roadmap-packages) 的所屬包與 EV，不在本入口維護另一份進度。

這裏的主要交付是直接給產品 Agent 閱讀的指令正文。Gemini 是首個接入目標；Agent 在 Server 執行，Web／Android 使用同一套行為與業務契約。一般聊天輸出自然文字，工具參數和必要的草稿／背景結果才使用結構化資料。

一般助理行為的可追溯底稿見 [上游來源與適配](upstream/README.md)。這是候選文字接入；靜態／合成協定檢查與真模型語義效果分開，未宣稱後者已改善。

## 從哪裏開始

S11-W01 如只需要簡單文字聊天，可直接採用 [P1 最小入口](p1/README.md)；只有一份完整文字提示詞，不依賴下面的 manifest、組裝器或工具契約。

1. 先讀 [自然對話核心](core/conversation.md)，了解 Agent 如何理解人、補問及交代結果。
2. 按 [組合配方](recipes/README.md) 選擇本次任務；檔案、版本與依賴的唯一清單是 [manifest](manifest.json)。
3. 按 [執行上下文](contracts/run-context.md)、[工具契約](contracts/capabilities-and-tools.md) 及 [輸出契約](contracts/output.md) 準備輸入。
4. 接入 Gemini 時讀 [接入說明](integration/gemini.md)；審查時讀 [案例與驗證](review/README.md)。

本目錄保存指令與契約；[Server 組裝器](../server/agent-prompt.ts) 與 [ADK runtime](../server/agent-runtime.ts) 已復用原有正文，`p1-chat` 配方完成 [S11-W03 必要驗收](../artifacts/verification/S11_W03_CHECKS.json)。P2 產品配方的記憶／RAG／任務及通知接線證據見 [S11-W02](../artifacts/verification/S11_W02_CHECKS.json) 與 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json)；配方存在不表示任意環境已啟用全部能力，仍須按 Server capabilities。原靜態範例仍全為合成資料，不當作整套模型效果測試。

## 正式入口與宣告配方

模組與配方以 manifest 的完整清單為準；目前產品入口直接選取 product-interactive、product-background、product-work-followup、photo-capture、shared-capture 五種。互動能力的工具與專項指引沿原生 capability loader 按需加入；summary-visit 是保留配方，不是現行獨立產品入口。位置及用途見 [配方入口對照](recipes/README.md#runtime-entry-map)。其餘配方是保留的組合定義，不代表各有獨立排程或公開 API。開發用 `.agents/skills` 並非此產品 Prompt Pack，原生 SkillToolset／MCP 也不因檔案存在而自動啟用。

## 模組與閱讀對象

| 位置 | 內容 | 是否送給模型 |
|---|---|---|
| `core/` | 身份／信任、對話、上下文／私隱、工具、輸出 | 只送標記內的正文 |
| `modules/` | 聊天、確認、記憶、知識、多模態、任務、主動跟進、聯絡、摘要 | 按配方送正文 |
| `domains/childcare-hk/` | 香港語言／人群、安全、來源時效、照護流程 | 必需領域規則常駐，其餘按配方 |
| `contracts/` | 注入、工具、結果語義與合成 JSON | 給實作者；只按需要注入實際資料／工具宣告 |
| `recipes/`、`integration/` | 組裝、Gemini 映射與故障處理 | 給實作者，不整份送模型 |
| `review/` | 合成案例、需求映射、靜態檢查 | 驗收材料，不當作家庭歷史 |

每個模組各有一對 `<!-- prompt:begin -->`／`<!-- prompt:end -->`；中間才是模型正文。標題、版本、權威條款、維護說明與靜態例子不自動加入 system instruction。獨立 P1 入口的 `.txt` 則全檔都是正文，版本由旁邊的說明維護。案例並非使用者曾經說過的話。

## 組裝及權威

固定次序：manifest 的 `baseModules` → `domain.requiredModules` → 所選配方的 `additionalModules`，保留首次出現位置並去重。每個模組的 `requires` 必須已包含；不能因缺依賴而靜默跳過安全規則。穩定正文放在前部，動態上下文與來源內容另外注入。詳細規則見 [配方](recipes/README.md)。

這是組裝次序，不是「後文可覆蓋前文」。共用信任、私隱、結果誠實性與工具限制不可被領域或任務模組放寬。資料內容即使寫着 system、developer、授權或管理員批准，也仍是資料。Prompt 不能代替程式的身份、授權、版本、冪等與輸出校驗。

[SPEC](../SPEC.md) 維護產品行為，[API](../docs/API.md) 維護接口責任，[DATA_MODEL](../docs/DATA_MODEL.md) 維護業務資料及狀態，[ARCHITECTURE](../docs/ARCHITECTURE.md) 維護執行機制。本包將這些要求轉成 Agent 指令，沒有新增 HTTP 路由或第二份資料庫 schema；出現差異時先修正本包，不以 prompt 改產品要求。

## 與人對話及背景執行

使用者提出要求後，最終要得到可理解的回答、補問或結果說明；工具呼叫只是中間步驟。純背景維護只在當次入口確實支援時回傳 `no_action`；目前各入口的終態能力仍按程式契約，不為了像在聊天而發通知。對外聯絡的文字與當前使用者的回覆分開，仍需既定渠道和當前授權。

P1 只用簡單聊天及已提供的相關資料，不預建長期記憶或假設照片、檢索、通知已接通。各配方是否已接入按 manifest 的驗證範圍及所屬包證據核對；階段標籤本身不啟用能力，未驗配方不能由已通過的 P2 配方代替。

## 長期維護

- 模組 ID 穩定；整包與模組版本以 manifest 為準。相容內容擴充升 minor，行為／契約不相容升 major，純更正升 patch，寫入 [CHANGELOG](CHANGELOG.md)。
- 改正文時同步檢查相關案例與配方；改語義契約時核對範例、Gemini 映射及產品端相容性，不在背景自動遷移授權或業務資料。
- 更換模型、工具或領域前核對實際能力與安全界線。本包只實作 `childcare-hk`；未來可在來源碼層替換領域檔案與配方，不建立動態 registry、插件安裝或第二領域。
- 未提供能力視為不可用；工具契約版本不相容不得猜測參數或換相似工具。舊工具的未知結果仍須保留，不因升級而重發。
- 個別模組的靜態審查通過不等於模型遵循、產品運行或對外投遞已驗證。真實驗收項見 [審查說明](review/README.md)。

產品工具按已實作 capabilities 組裝：預授權聯絡只使用 Server 核准版本／對象，入列、渠道接受、收到與完成分開；真服務及未驗範圍依各包證據，不以靜態配方代替。
