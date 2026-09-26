# 育伴港前端單一計劃

本計劃只管理 frontend/** 的設計與前端實作。產品功能、正式 API、權限與跨模組驗收，以根目錄 [AGENTS](../AGENTS.md)、[STATUS](../STATUS.md)、[PLAN](../PLAN.md)、[SPEC](../SPEC.md) 及 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。前端不修改 Server、Agent、資料庫、根目錄依賴或正式 App，不自行 merge。

| 次序 | 前端工作包 | 狀態 | 交付及關口 |
|---|---|---|---|
| 1 | FE-W01 Web 主頁基線 | 待使用者視覺驗收 | 獨立 Expo Web 預覽、資料模型、Paper 共用元件、合成狀態與響應式首頁；原分支 codex/fe-w01-web-home |
| 2 | FE-W02 Web 共用框架與核心畫面 | 待使用者視覺驗收 | 依新增對話／設定／登入參考圖，完成共用導覽及右資訊欄、主頁、對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定及登入畫面；所有資料仍屬合成預覽；本包分支 codex/fe-w02-web-shell-chat-settings-auth，基於 FE-W01 commit e70a13d |
| 3 | FE-W03 待辦預覽與訊息提示 | 待使用者視覺驗收 | 在 FE-W02 的右資訊欄加入按孩子分隔的本地清單、頂部鈴鐺及原操作狀態提示；對照正式功能缺口並交接。分支 codex/fe-w03-dashboard-todos-notifications，基於 FE-W02 commit 271f10b。正式任務／通知待其業務契約交付 |
| 4 | FE-W04 外殼、孩子摘要與引導 | 待使用者視覺驗收 | 依新增截圖統一右欄開關、頂部孩子資料、左側品牌／對話入口及條件式引導；分支 codex/fe-w04-shell-child-guide，基於 FE-W03 commit 2671a9b。孩子資料正式 API 已存在但此預覽無登入會話；引導完成狀態仍缺正式契約 |
| 5 | FE-W05 Web 動態方向比較 | 比較已完成；暫不採用 | 從 FE-W04 commit 591a23d 建 `codex/fe-w05-motion-preview`；只在 `/motion-preview` 示範 A／B／C 三種節奏，核對 reduced motion／鍵盤／320px，詳見 [MOTION_OPTIONS](MOTION_OPTIONS.md)。保留獨立比較頁作日後參考，不套入正式畫面 |
| 6 | Web 已有契約的操作畫面 | 未開始 | 先補 /care 真搜尋／記錄更正及 /profile 結構化檔案，再按交接清單處理 /family 角色邀請、/memory 生命週期、/settings 本人偏好；前端只做畫面與狀態，正式接線由主聊天負責 |
| 7 | Web 待業務契約的畫面 | 等候所屬工作包 | S13 任務／通知、S11 Agent／引用、S12 照片／分享、S13 成長關注及 S14 摘要等須先有已交付契約，逐包實作，不從截圖推造功能 |
| 8 | Web 整套確認與正式接線 | 待主聊天及使用者 | 使用者比較全部 Web 畫面並明確確認；主聊天按 [HANDOFF](HANDOFF.md) 對正式 App 的既有 API／控制器接線與真服務驗收。未接通 P2 功能須等其業務包交付，不以預覽代替 |
| 9 | Android 前端 | 未開始 | 第 8 項經明確確認後另立 Android 計劃與真機驗收；390／320 CSS px 只是手機瀏覽器 Web |

FE-W04 的可獨立驗收範圍是外殼調整、孩子摘要與引導頁的前端投影、條件顯示、Web 響應式／鍵盤檢查及正式接線交接；不宣稱孩子摘要已取得 Server 資料或引導完成狀態已有正式來源。下一批真正任務／通知流程仍須先核對所屬業務包的已交付契約，不依參考圖推造任務完成或訊息送達。

每包依 [WORKFLOW](WORKFLOW.md) 核對 active worktree、提取設計規則、實作、typecheck／Web build／預覽檢查及展示畫面。正式靜態 Web 的既有依賴順序為 FE-W01 → FE-W02 → FE-W03 → FE-W04；FE-W05 是分開保留的動態比較樣本，並非後續靜態 Web 工作包或正式接線的前置條件。Web 及 Android 先保持靜態；如日後採用動態，另立工作包從共用元件逐步加入，分別驗收 Web 與 Android。
