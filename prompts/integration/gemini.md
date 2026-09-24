# Gemini／Vertex AI 接入說明

這是 S06／S11 的接入契約；S11-W03 已完成 [ADK 基礎及最小真工具循環驗收](../../artifacts/verification/S11_W03_CHECKS.json)，不代表全部配方或產品能力已驗收。沿用 [現行架構](../../docs/ARCHITECTURE.md#section-3-6)：Server 接入 Gemini，provider 憑據不進 Web／Android；模型和能力須按實際接入版本核實，集中配置，不寫入 prompt 正文。

## 請求怎樣組裝

| Prompt Pack／應用資料 | Gemini 接入責任 |
|---|---|
| manifest／所選 recipe 的正文 | 放入 `systemInstruction`（各 SDK 的名稱映射依版本）；只取 prompt 標記內文字，保留安全核心與正確順序 |
| 當前輸入與相關歷史 | 使用 `contents`／chat history 的正確角色與內容 parts；使用者、模型、工具結果不可混成一段高權限文字 |
| 當前可信 runtime metadata | 由應用清楚封裝身份／範圍／版本／能力，與不可信正文分開；不直接複製用戶聲稱的「權限」 |
| 檢索／附件／轉錄 | 作有來源、權限、版本和可用狀態的資料；圖片須用實際支援的 multimodal part，不靠檔名假裝模型看過 |
| 可用 operation | 以原生 function declarations 提供參數及用途，只暴露本次允許工具；執行處理器統一經 Server 檢查 |
| 結構化任務輸出 | 在請求設定提供 response MIME type／schema；使用所選模型／端點支援的 schema 子集，不把完整 schema 再貼進 prompt |

Google 官方建議用 system instructions 定義角色、語言與語氣；本包的核心正文採這種直接對模型說話的方式。[System instructions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/prompts/system-instructions)

## 文字、工具及結構化模式

1. **一般對話**：自然文字。工具選擇使用允許自然文字回覆的模式，不為了讓工具看似活躍強制每輪呼叫。若本次沒有工具，就不提供虛構宣告。
2. **有工具的對話**：模型提出 function call；Server 檢查資料、授權、當前狀態及配額後才執行；實際 function response 回到同一對話，再以自然語言收尾。工具呼叫不是對外投遞證據。
3. **記錄／摘要／背景結果**：只在配方需要時使用結構化輸出；人機互動包含可展示的 `replyText`，背景無動作可以為 null。Native function calling 和 response schema 能否同次組合，按所選端點／模型實際支援核對；不支援時保留有界工具循環與獨立的必要任務結果步驟，不能默默丟失候選或工具請求。

官方 function calling 文件說明，`AUTO` 可按上下文選擇工具呼叫或自然文字；宣告工具不等於模型自己執行操作。[Function calling](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling)

不要強制所有聊天套完整 JSON 外層，也不要為每輪純聊天固定增加第二次模型調用。工具執行後若不需新的推理，應用可依真實結果用簡短文字收尾；最終文字失敗不重做副作用。需要重新生成文字時，帶入已確認結果並維持原操作識別。

## 歷史、工具循環及私隱

- 保存業務原始聊天與授權記憶，按需組裝上下文；不是每次把整個聊天庫交給 Gemini。記憶恢復依 Server，provider cache 不作權威記憶。
- 多步工具循環須保留必要的原始模型 response parts、呼叫關聯及 provider 所需 opaque metadata；不能把所有回覆壓成 `.text` 再繼續工具循環。若所選模型回傳 thought signatures，依官方協定原樣保留與傳回，不自行偽造、解讀、改寫或顯示給使用者。[Thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
- Provider 協定續接資料與家庭事實／摘要分開管理；前者不是可給使用者閱讀的內部推理，也不寫入一般工程／成本日誌。只保留續接所需的範圍，受相同私隱及存取控制。
- 摘要壓縮不能切斷尚未完成的 call／response 配對。需要截斷、換模型或新會話時，先處理／核對未完成操作，再由權威資料重建；不把未知外發遺失後當作未送出。
- 每個 function response 對應原呼叫；多個呼叫逐項返回實際結果。並行副作用是否合法由 Server 決定，不由模型的並列輸出自動批准。
- SDK 如提供自動 function execution，也必須使用經授權檢查的 handler；不把資料庫／通知 SDK 直接作為無檢查的模型工具。

## Schema 與校驗

用精簡、清楚、有描述的欄位，避免把整個業務模型塞成一個巨型 schema。缺資料用相容的未知／空集合／補問語義；不能因 required 欄位而鼓勵模型捏造值。輸出範例若作 few-shot，其欄位、順序及能力必須與該次 schema 相符。

官方文件指出 structured output 僅支援部分 schema 能力，複雜 schema 可能出錯，並建議不要在 prompt 重複完整 schema。格式正確仍要做來源、權限及業務驗證。[Structured output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)

本包不固定 temperature、thinking、token 門檻或 SDK 版本。後續按選定模型及驗收需要設置有界配置，不要求輸出 chain-of-thought。機器只記必要使用量、延遲、錯誤和版本；不記家庭正文／附件／憑據。含家庭內容的顯式模型快取沿用現行預設關閉規則。

## 錯誤及降級

| 情況 | 應用必須保留的行為 |
|---|---|
| 模型／網絡不可用 | 保留當前輸入，清楚說尚未處理；不假稱保存或承諾跨關閉草稿 |
| 非法 schema／未知工具／參數不足 | 不執行；只在 Server 配額內修正，否則有界結束 |
| 工具缺失或版本不相容 | 限制相關動作；可繼續不依賴該能力的回答，不猜替代工具 |
| 權限／終態在推理期間改變 | 執行／顯示前拒絕過期輸出，重取必要上下文；不沿用舊許可 |
| 寫入／投遞結果未知 | 核對原操作，不盲重做；核對不可用就保留待處理 |
| 工具成功但文字串流中斷 | 用已確認台帳交代；不重做工具，不把未校驗文字當完成狀態 |
| 背景無新事件或無動作 | 確定性邏輯不喚起模型；如已被呼叫可返回 no_action，不額外通知 |

## 已核對來源與待驗證

2026-09-22（Asia/Hong_Kong）在本次規劃中只讀核對上述 Google 官方 system instructions、function calling、structured output 及 thought signatures 文件；Vertex AI 舊文件入口轉到現行官方頁面。這是文件依據，未驗證本產品 SDK、部署或模型可用性。

接入時仍須驗證：選定 Gemini 型號／地區可用性、schema／多模態／工具組合、歷史續接、粵語理解、來源引用、干擾內容、權限 gate、串流中斷及成本。這些留在原產品工作包，依 [驗證制度](../../PLAN.md#verification) 另行取得高成本驗收決定。
