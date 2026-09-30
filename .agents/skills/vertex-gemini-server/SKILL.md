---
name: vertex-gemini-server
description: 實作或修改 Node/TypeScript Server 的 Vertex AI Gemini 呼叫、ADC、配額、重試、逾時或用量統計時使用；不適用純 UI 或產品提示詞編寫。
---

# Vertex Gemini Server 接入

適用：Node 24、Vertex AI generateContent v1；SDK 固定版本 @google/genai 2.24.0。最後核對：2026-09-23。
證據：以下官方文件已核對；SDK 2.24.0 已安裝並核對型別／原始碼，adapter 單元檢查及獲准的 global／gemini-3.1-flash-lite 三次合成真服務驗收已通過（2026-09-23）。此證據不延伸至其他模型／地點／身份。先看專案 lockfile／既有 adapter，不能把官方 main 分支當作已固定版本的行為證據。

- 使用 Server ADC；Google Cloud 正式部署優先附加最小權限的 user-managed service account。本機 ADC 與 gcloud CLI 登入憑據不同，不因 CLI 已登入便假定 ADC 可用。不把 service-account key 或完整 credentials 複製到客戶端、工程或日誌。[ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
- Google SDK 2.x 官方範例使用 `GoogleGenAI({enterprise:true, project, location, apiVersion:"v1"})`；預設 API 可能是 beta。實作時以所安裝版本型別及原始碼核對構造參數、逾時及重試設定，不能混用 Developer API key 模式。[固定版本 README](https://github.com/googleapis/js-genai/blob/v2.24.0/README.md)
- 由單一應用層管理有限重試，SDK／HTTP adapter 不可暗中再重試而繞過配額。2.24.0 的 `httpOptions.retryOptions.attempts: 1` 包括首次嘗試，因此關閉 SDK 自動重試；同層設定 `timeout`，generate config 傳入 `abortSignal`。官方建議重試不超過兩次，起始至少一秒，其後指數退避；400／403／404 應修正輸入／權限／資源，不盲重試。專案可採更嚴限制。[API errors](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/api-errors)
- 逾時／AbortSignal 只代表客戶端停止等候，不保證服務端停止處理或免收費。POST 沒有可證明的重播保證時，把斷線／未知結果視為未知，不自動重送或退回可能已消耗的配額。設定真正 request timeout／abort，不能只有 UI 計時器。[SDK 型別與 AbortSignal 說明](https://github.com/googleapis/js-genai/blob/v2.24.0/src/types.ts)
- `systemInstruction` 與 `contents` 的 user／model 角色分開；傳送前由 Server 篩選授權內容。SDK chat 物件只是本機對話狀態，不能代替持久儲存或權限檢查。[SDK](https://github.com/googleapis/js-genai/blob/v2.24.0/README.md)
- 只抽取 `usageMetadata` 的必要數值；完整 response 含候選正文，不可當統計日誌。缺失 token 記未知，不能冒充零或快取命中；拒絕空回答、非預期工具／內容及無效數值。[Response](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/GenerateContentResponse)
- 型別／單元檢查只驗證接線及邊界；ADC 權限、模型可用性與帳單須靠獲准的最小真服務驗證，不能以 mock 宣稱已通過。

當次模型資料：`gemini-3.1-flash-lite` 模型頁列出 GA 及 `global`／`us`／`eu`。這是有日期的可用性證據；切換地點、模型或遇到 404 時局部重核，不推論所有模型均可用所有地點。[模型頁](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite)

產品與安全決策仍以 [ARCHITECTURE](../../../docs/ARCHITECTURE.md#section-3-6)、[API](../../../docs/API.md#p1-ai-boundary) 及 [AGENTS](../../../AGENTS.md#technical-skills) 為準。發現衝突先指出影響，不用本 Skill 改寫已確認架構。
影像接入補充（2026-09-29 文件已核對，真照片辨識待驗）：Vertex `inlineData` 使用 MIME＋base64；先依模型頁核對格式及單檔限制，不能把通用 API 的上限當產品額度。`gemini-3.1-flash-lite` 支援 JPEG／PNG，官方 inline 上限 7 MB。二進位設獨立 byte／張數上限，文字／tool schema／opaque parts 仍完整計入文字預算；不把 base64 當普通文字截斷。圖片 token 已計入 usageMetadata 的 prompt 用量，不能以字數推算費用。不使用 Developer API Files API 代替現有 Vertex ADC。[模型規格](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite)／[Content parts](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/inference)
