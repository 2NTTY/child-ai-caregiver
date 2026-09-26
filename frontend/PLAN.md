# 育伴港前端單一計劃

本計劃只管理 frontend/** 的設計與前端實作。產品功能、正式 API、權限與跨模組驗收，以根目錄 [AGENTS](../AGENTS.md)、[STATUS](../STATUS.md)、[PLAN](../PLAN.md)、[SPEC](../SPEC.md) 及 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。前端不修改 Server、Agent、資料庫、根目錄依賴或正式 App，不自行 merge。

| 次序 | 前端工作包 | 狀態 | 交付及關口 |
|---|---|---|---|
| 1 | FE-W01 Web 主頁基線 | 待使用者視覺驗收 | 獨立 Expo Web 預覽、資料模型、Paper 共用元件、合成狀態與響應式首頁；原分支 codex/fe-w01-web-home |
| 2 | FE-W02 Web 共用框架與核心畫面 | 待使用者視覺驗收 | 依新增對話／設定／登入參考圖，完成共用導覽及右資訊欄、主頁、對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定及登入畫面；所有資料仍屬合成預覽；本包分支 codex/fe-w02-web-shell-chat-settings-auth，基於 FE-W01 commit e70a13d |
| 3 | FE-W03 待辦預覽與訊息提示 | 待使用者視覺驗收 | 在 FE-W02 的右資訊欄加入按孩子分隔的本地清單、頂部鈴鐺及原操作狀態提示；對照正式功能缺口並交接。分支 codex/fe-w03-dashboard-todos-notifications，基於 FE-W02 commit 271f10b。正式任務／通知待其業務契約交付 |
| 4 | Web 已有契約的操作畫面 | 未開始 | 先補 /care 真搜尋／記錄更正及 /profile 結構化檔案，再按交接清單處理 /family 角色邀請、/memory 生命週期、/settings 本人偏好；前端只做畫面與狀態，正式接線由主聊天負責 |
| 5 | Web 待業務契約的畫面 | 等候所屬工作包 | S13 任務／通知、S11 Agent／引用、S12 照片／分享、S13 成長關注及 S14 摘要等須先有已交付契約，逐包實作，不從截圖推造功能 |
| 6 | Web 整套確認與正式接線 | 待主聊天及使用者 | 使用者比較全部 Web 畫面並明確確認；主聊天按 [HANDOFF](HANDOFF.md) 對正式 App 的既有 API／控制器接線與真服務驗收。未接通 P2 功能須等其業務包交付，不以預覽代替 |
| 7 | Android 前端 | 未開始 | 第 6 項經明確確認後另立 Android 計劃與真機驗收；390／320 CSS px 只是手機瀏覽器 Web |

FE-W03 的可獨立驗收範圍是右欄待辦版式與本地勾選、鈴鐺原操作提示、Web 響應式／鍵盤檢查及功能缺口交接；不宣稱 S13 任務、正式站內通知、Web Push 或正式 Web 已完成。下一批真正任務／通知流程必須先核對所屬業務包的已交付契約，不依參考圖推造任務完成或訊息送達。

每包依 [WORKFLOW](WORKFLOW.md) 核對 active worktree、提取設計規則、實作、typecheck／Web build／預覽檢查及展示畫面。FE-W03 不自行合併前兩包；主聊天整合時須按 FE-W01 → FE-W02 → FE-W03 的依賴順序處理，避免把預覽包當作已在 master 生效。
