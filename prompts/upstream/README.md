# 助理提示詞上游來源與適配

本目錄不進模型指令。2026-10-09 固定 OpenClaw `175146de74ad5103aa97f2a04c4d06423a84df56`（MIT）及 Gemini CLI `2ce1a6963e9e53a04afaf76111e4527cfa7c5dd7`（Apache-2.0）的選定原始片段；保留版權及授權全文、原始檔 SHA-256、行號、原文節錄及衍生段落映射於 provenance.json。這些是當時 main 快照，不聲稱穩定 release。

實際接入位置為 core/conversation.md 的模型正文；OpenClaw 作一般助理底稿，Gemini 只補意圖／補問／工具後收尾。翻譯及修改由本項目作出。其餘身份、私隱、工具、輸出、領域安全模組保留，原 ADK 組裝器與 runtime 不變。

來源：
- https://github.com/openclaw/openclaw/blob/175146de74ad5103aa97f2a04c4d06423a84df56/src/agents/system-prompt.ts
- https://github.com/openclaw/openclaw/blob/175146de74ad5103aa97f2a04c4d06423a84df56/src/agents/promised-work-prompt.ts
- https://github.com/openclaw/openclaw/blob/175146de74ad5103aa97f2a04c4d06423a84df56/extensions/memory-core/src/memory-tool-contract.ts
- https://github.com/openclaw/openclaw/blob/175146de74ad5103aa97f2a04c4d06423a84df56/docs/reference/templates/SOUL.md
- https://github.com/google-gemini/gemini-cli/blob/2ce1a6963e9e53a04afaf76111e4527cfa7c5dd7/packages/core/src/prompts/snippets.ts

必要適配：不搬單一 owner／全域檔案記憶、CLI／shell／slash、Plan/YOLO、自動批准或額外模型迴圈。缺答不當批准；私人資料不進共用 system/cache；工具可用不授權副作用。工具後收尾在本產品使用 present_answer，其 accepted 為 terminal。對未知結果查原收據，不重做；未成功建立持久工作／排程，不承諾未來通知。

逐段選擇不是整份上游政策照貼，也沒有引入 OpenClaw Gateway 或 Gemini CLI Runtime。來源 license 及引用相容與模型理解品質是不同檢查；本候選尚未取得新的真模型語義對照證據。
