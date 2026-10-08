---
name: adk-typescript-runtime
description: 接入或修改 Google ADK TypeScript 的 Runner、模型 adapter、工具循環、取消及診斷私隱時使用；不適用純 UI、產品提示詞編寫或知識庫內容整理。
---

# ADK TypeScript 接入

適用：`@google/adk 2.1.0`、`@google/genai 2.24.0`、Zod 4、Node 24。最後核對：2026-10-08（本次補原生按需工具集合；其餘依既有核對日期）。
證據：固定 tag 與安裝套件型別／原碼已核對；真 Runner 搭配 scripted model 的兩步工具、原生 parts 配對、權限／參數拒絕、取消及限額已實測。另經批准以既有 ADC／global／gemini-3.1-flash-lite 完成兩次真模型呼叫及一次工具循環；此證據不延伸至其他模型或工具。

- 先看固定版本的公開型別及現有 adapter。`BaseLlm.generateContentAsync(request, stream?, abortSignal?)` 是模型擴充點；公開 Gemini 類別名為 `Gemini`。`Runner.runAsync` 接受 `abortSignal`，但工具自身仍須停止新操作並傳遞取消。`maxLlmCalls` 只限制模型呼叫，不能代替工具／embedding／共用期限控制；預設值寬鬆，應明確設定。[BaseLlm](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/models/base_llm.ts)／[Runner](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/runner/runner.ts)／[RunConfig](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/run_config.ts)
- 自訂模型 adapter 保留完整 `Content.parts`、function call／response 關聯及 provider 所需 opaque metadata，不能壓成文字再續跑。模型內部推理與 signatures 不供 UI 展示；回傳用量只取必要數值。Vertex ADC、重試與逾時沿用 [Vertex Skill](../vertex-gemini-server/SKILL.md)，每次實際 API 呼叫各自記帳。
- `FunctionTool` 的 GenAI `Schema` 只是宣告，不構成執行時校驗；Zod object 才會 parse。按工具契約決定額外鍵政策，權限相關輸入通常用 `.strict()`。`beforeToolCallback` 先收到原始 args，不能假定 Zod 已驗證；返回非空結果會跳過 handler，適合回傳已校驗的拒絕語義。Server 身份、資源範圍及授權不可取自模型 args。[FunctionTool](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/tools/function_tool.ts)／[呼叫流程](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/functions.ts)
- `FunctionTool` 的 Zod 4 轉換輸出仍須符合 Vertex v1 的 `Schema` 子集。整數正值使用等價 `.int().min(1)`；`.positive()` 會產生該 API 未列支援的 `exclusiveMinimum`。先檢查實際 declaration，不以 Zod parse 或 scripted model 通過推定真 API 接受；執行端仍保留嚴格 Zod 驗證。2026-09-29 已核對固定套件輸出及 [Vertex Schema](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/Schema)；局部修正後真生成及工具呼叫成功，不代表整條產品流程已驗收。
- 2.1.0 的未知工具可能生成錯誤 function response 並繼續循環；模型錯誤亦可轉為帶 `errorCode` 的事件，不一定 throw 到 Runner 消費端。消費事件時處理錯誤，保留應用自己的安全停止原因，不能將沒有正文一律當普通空回答。失敗、被拒絕及未知工具也需要計數。工具已成功或結果 unknown 時，不由收尾文字重做副作用。[LlmAgent](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/llm_agent.ts)
- ADK session／event 是協定上下文，並非業務事實或權限台帳。每次工具執行與結果呈現前依業務服務重新核對；跨 run 確認、冪等、終態及恢復交由專案權威服務，不靠模型摘要或 framework session 代替。
- `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS` 在 2.1.0 預設開啟，會序列化模型及工具正文。含私人資料的流程明確設為 `false`；`setLogger(null)` 可停用 ADK 預設 logger，改由應用輸出允許的 metadata。核對實際 exporter、GenAI SDK 和其他診斷接線，不能假定一個環境變數關掉所有 telemetry。[Tracing](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/telemetry/tracing.ts)／[Logger](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/utils/logger.ts)
- 必要檢查使用真 Runner 配 scripted model，覆蓋多步 parts 續接、非法參數、越權、上限、取消、工具成功後收尾失敗及 unknown 不盲重試。只有真服務驗收能證明 ADC／模型工具協定相容；兩者分開記錄。


- 按需工具使用原生 `BaseToolset.getTools()`：2.1.0 每個模型步重新解析工具集合，可在同一 run 的受信 loader 更新可見集合；不要靠末句 regex 或解析思考文字選工具。loader 經同一參數／授權／計數／取消管線，載入本身不取得業務授權；載入集合隔離於 run，同 batch 尚未提供的 schema 不可先執行。多個 loader 串行合併單調集合，避免並發遺失。Server 定義的 prompt module IDs 沿 manifest 白名單、依賴及去重組裝，不能由模型提供路徑；指令 provider 按已載集合快取，仍計完整 request 預算。保留 terminal 工具供安全收尾，repair 階段不能重開能力。[BaseToolset](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/tools/base_toolset.ts)／[LlmAgent](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/llm_agent.ts)。2026-10-08：固定套件型別及真 Runner 搭 scripted provider 已核對此接線、授權／取消／上限及 unknown；新按需流程尚未單獨真 Gemini 驗證，不延伸為產品理解品質證明。

產品配方、初始限額、記憶與確認流程以 [ARCHITECTURE](../../../docs/ARCHITECTURE.md#p2-agent-runtime)／[API](../../../docs/API.md#agent-runtime-contract) 為準；本 Skill 不自行調整專案決策。
