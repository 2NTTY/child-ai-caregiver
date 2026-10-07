# 輸出契約與結構化例子

本文件的合成輸出語義版本為 `0.1.1`；當前 Prompt Pack 版本以 manifest 為準。本文件固定本包範例的語義；**不是產品 HTTP response 或資料庫 schema**。正式 ModelGateway 按所選 Gemini 能力提供精簡 response schema／function declarations，並在 Server 校驗輸出。

## 三種輸出通道

| 模式 | 內容 | 使用者看到甚麼 |
|---|---|---|
| 一般聊天 | 自然文字及有根據的引用 | 回答／補問／結果說明，不包 JSON |
| 原生工具循環 | provider 工具請求 → Server 檢查／執行 → 實際 function response | 必要的真實進度與最終自然回覆，不展示工具協定 |
| 結構化任務結果 | 指定 schema 的 `AgentResult` 語義 | 互動時只呈現已校驗的 `replyText`；背景可以不呈現 |

不得以從自然語言解析出「已完成」取代工具狀態。不得把一段文字加上 JSON 印在聊天中當作 function call。配方明確指定模式；模型不能自行切換到不存在的結構。任何配方選擇 `structured` 時，`outputContract` 與相應 schema 都是條件必需輸入；缺少時由應用在請求前選擇受支援的文字降級或回報錯誤，不能要求模型猜測。純文字模式不需 schema。

## 產品 tool_cycle 展示接點

當 capabilities 有 present_answer，該工具是 Server 驗證展示文字／引用的入口；純 provider final 不能替代。已保存候選或直接操作收據是独立結果，收尾失敗時仍須保留並按台帳呈現，不重做保存。此規則不要求 P1 text 模式呼叫不存在的工具，也不把未驗證文字自動當成功。

## AgentResult 語義

以下為合成範例使用的共同外層。八個欄位均列出，沒有內容的集合使用空陣列；只有背景且無需人類文字時 `replyText` 可以為 `null`。識別由程式提供，不由模型任意生成。

| 欄位 | 語義 |
|---|---|
| `contractVersion` | 範例語義版本 `0.1.1`；產品只接受當次宣告的版本 |
| `decision` | `reply`、`clarify`、`propose`、`no_action`、`blocked`、`reconcile`；只是本次模型結果，不是任務持久狀態 |
| `replyText` | 給當前互動者的自然文字；不是對第三人的投遞指令，也不能提前宣稱候選已保存 |
| `candidates` | 待核對的事件／事實／記憶／任務／報告候選；包含種類、對象與來源參照、擬議內容及缺項，不包含模型偽造的確認人／保存結果 |
| `actionRequests` | 對本次實際 operation 的受限請求；參數、既有對象／版本與確認／授權參照按該 operation schema；提交不等於批准 |
| `questions` | 必要補問與所指待確認項；區分資訊、資料／任務／完成確認、外發授權，不以一個含糊 `confirmed` 表示全部 |
| `sourceRefs` | 本次允許引用且支持說法的來源；不得引用未注入／未取得或接收者不可見的識別 |
| `limitations` | 具體資料／能力／結果限制，供程式與對話呈現；不得夾帶不必要私人正文 |

集合欄位為 `candidates`、`actionRequests`、`questions`、`sourceRefs`、`limitations`。下游必須按實際 schema 檢查欄位，不能靠這份說明猜測型別。

`decision` 是本次主要處理方向；一個結果可以同時包含有用文字與未確認候選。各 action 的權限與結果獨立核對，不能用主要 decision 替全部 action 授權。`no_action` 不等於任務取消，`blocked` 不等於事情完成，`reconcile` 不等於未發送。

## 確認與成功的分離

- 使用者確認候選內容 → 尚須 Server 權限／版本／業務校驗和保存。
- 使用者同意建立任務 → 不等於授權向任何人、任何渠道透露全部內容。
- 工具接受投遞 → 不等於送達、已讀或照護事項完成。
- 使用者說「搞掂」→ 先正確綁定原事項及核實權限；Server 完成確認成功後才說任務已完成。
- 工具成功但最終文字生成失敗 → 讀台帳並回報已確認結果，不能再次執行副作用。

## Server 的驗證責任

檢查格式、契約版本、允許欄位／工具、必填參數、來源及對象關聯、當前身份／授權、內容版本／世代、終態、重試／跟進上限。以白名單映射 candidate／action kind，不讓任意 `kind`、正文或模型構造的方法名執行程式。

Structured output 可以約束格式，不能證明事實、引用、權限或業務合法。非法輸出不執行；有界修正後仍失敗，就保留真實狀態與可理解的失敗說明，不把失敗吞掉或改成成功。

流式內容如尚未通過必要驗證，不得成為最終保存／完成狀態；實際顯示時機由 UI／Server 處理。本包不實作串流 UI。

## 範例與接入

[examples.json](examples.json) 提供純聊天輸入、確認成功／失敗／未知、背景無動作及聯絡能力變更等合成 fixture。預期輸出是人工指定的例子，**不是模型跑過的結果**。出現的 `example-only.*` 只為對照契約，不是啟用中的工具名稱。

傳給 Gemini 的正式 schema 留在請求設定，prompt 正文不重複整份 schema。範例若被挑選作 few-shot，須和本次 schema、欄位順序及能力相符，並明確隔離合成示例與真實對話。[Gemini 接入說明](../integration/gemini.md)。
