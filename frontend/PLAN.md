# 育伴港前端單一計劃

本計劃只管理 frontend/** 的設計與前端實作。產品功能、正式 API、權限與跨模組驗收，以根目錄 [AGENTS](../AGENTS.md)、[STATUS](../STATUS.md)、[PLAN](../PLAN.md)、[SPEC](../SPEC.md) 及 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。前端不修改 Server、Agent、資料庫、根目錄依賴或正式 App，不自行 merge。

| 次序 | 前端工作包 | 狀態 | 交付及關口 |
|---|---|---|---|
| 1 | FE-W01 Web 主頁基線 | 待使用者視覺驗收 | 獨立 Expo Web 預覽、資料模型、Paper 共用元件、合成狀態與響應式首頁；原分支 codex/fe-w01-web-home |
| 2 | FE-W02 Web 共用框架與核心畫面 | 待使用者視覺驗收 | 依新增對話／設定／登入參考圖，完成共用導覽及右資訊欄、主頁、對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定及登入畫面；所有資料仍屬合成預覽；本包分支 codex/fe-w02-web-shell-chat-settings-auth，基於 FE-W01 commit e70a13d |
| 3 | Web 整套確認與正式接線 | 待主聊天及使用者 | 使用者比較全部 Web 畫面並明確確認；主聊天按 [HANDOFF](HANDOFF.md) 對正式 App 的既有 API／控制器接線與真服務驗收。未接通 P2 功能須等其業務包交付，不以預覽代替 |
| 4 | Android 前端 | 未開始 | 第 3 項經明確確認後另立 Android 計劃與真機驗收；390／320 CSS px 只是手機瀏覽器 Web |

FE-W02 的可獨立驗收範圍是前端畫面結構、共用設計系統、合成互動及交接；不宣稱 P2 產品功能或正式 Web 已完成。使用者要求持續完成 Web 畫面，因此本包涵蓋現有契約可界定的核心路由；圖片中的通知、任務、附件、Agent 工具進度等未接線能力記於 [HANDOFF](HANDOFF.md)，待主聊天業務包成熟後才開相關前端包。

每包依 [WORKFLOW](WORKFLOW.md) 核對 active worktree、提取設計規則、實作、typecheck／Web build／預覽檢查及展示畫面。FE-W02 不自行合併 FE-W01；主聊天整合時須按依賴順序處理，避免把兩包當作已在 master 生效。
