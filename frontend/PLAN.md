# 育伴港前端單一計劃

本計劃只管理 frontend/** 的設計與前端實作。產品功能、正式 API、權限與跨模組驗收，以根目錄 [AGENTS](../AGENTS.md)、[STATUS](../STATUS.md)、[PLAN](../PLAN.md)、[SPEC](../SPEC.md) 及 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。前端不修改 Server、Agent、資料庫、根目錄依賴或正式 App；合併只按使用者明確指示進行。

| 次序 | 前端工作包 | 狀態 | 交付及關口 |
|---|---|---|---|
| 1 | FE-W01 Web 主頁基線 | 待使用者視覺驗收 | 獨立 Expo Web 預覽、資料模型、Paper 共用元件、合成狀態與響應式首頁；原分支 codex/fe-w01-web-home |
| 2 | FE-W02 Web 共用框架與核心畫面 | 待使用者視覺驗收 | 依新增對話／設定／登入參考圖，完成共用導覽及右資訊欄、主頁、對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定及登入畫面；所有資料仍屬合成預覽；本包分支 codex/fe-w02-web-shell-chat-settings-auth，基於 FE-W01 commit e70a13d |
| 3 | FE-W03 待辦預覽與訊息提示 | 待使用者視覺驗收 | 在 FE-W02 的右資訊欄加入按孩子分隔的本地清單、頂部鈴鐺及原操作狀態提示；對照正式功能缺口並交接。分支 codex/fe-w03-dashboard-todos-notifications，基於 FE-W02 commit 271f10b。正式任務／通知待其業務契約交付 |
| 4 | FE-W04 外殼、孩子摘要與引導 | 待使用者視覺驗收 | 依新增截圖統一右欄開關、頂部孩子資料、左側品牌／對話入口及條件式引導；分支 codex/fe-w04-shell-child-guide，基於 FE-W03 commit 2671a9b。孩子資料正式 API 已存在但此預覽無登入會話；引導完成狀態仍缺正式契約 |
| 5 | FE-W05 Web 動態方向比較 | 比較已完成；暫不採用 | 從 FE-W04 commit 591a23d 建 `codex/fe-w05-motion-preview`；只在 `/motion-preview` 示範 A／B／C 三種節奏，核對 reduced motion／鍵盤／320px，詳見 [MOTION_OPTIONS](MOTION_OPTIONS.md)。保留獨立比較頁作日後參考，不套入正式畫面 |
| 6 | FE-W06 既有契約流程與跨尺寸介面 | 實作及輕量檢查完成；待使用者視覺驗收 | 基於 master `22f5c66`，分支 `codex/fe-w06-care-record-flows`；/care、/profile、/family、/memory、/tasks 及 /settings 本人偏好投影已實作。新增品牌／OKLCH 配色位置、完整 MD3、SVG、Dialog／選單及孩子切換比例修訂，10 頁四種 Web 寬度、共用互動與 Web／Android export 通過；所有寫入仍未接真 API |
| 7a | FE-W07 本人渠道設定前端 | 實作及輕量檢查完成；待視覺／正式接線 | 前置已 review 的 FE-W06 `6c7216f`，分支 `codex/fe-w07-notification-settings`；主線 `34892c7` 已合併 S13-W05／W06（PR #58／#59）。/settings 的本人 Web Push 訂閱／撤銷／明確測試、Telegram 開始私人綁定／候選核對／撤銷／投遞及回覆分開已實作；四 Web 寬度、合成關鍵流程及 Web／Android export 通過。不觸發真權限、訂閱、bot 或外發 |
| 7b | Web 待業務契約的畫面 | 等候所屬工作包 | S13-W01／W04 已在第 6 項完成投影，渠道設定按 7a 接續。真未讀／通知中心、S11 Agent／引用、S12 照片／分享、S13 成長關注及 S14 摘要須先有已交付契約；active 分支不當作已合併主線，不從截圖推造功能 |
| 8 | Web 整套確認與正式接線 | 待主聊天及使用者 | 使用者比較全部 Web 畫面並明確確認；主聊天按 [HANDOFF](HANDOFF.md) 對正式 App 的既有 API／控制器接線與真服務驗收。未接通 P2 功能須等其業務包交付，不以預覽代替 |
| 9 | FE-W06 手機軟件介面 | 源碼及 bundle 完成；待視覺及真機驗收 | 按使用者 2026-09-29 指示提前做手機畫面；手機首頁依參考圖的品牌／問候、孩子卡片、提問、重點、待辦、快捷記錄及底部導航組裝。共用 React Native 元件、Expo Router Tabs／Safe Area／鍵盤及最終 Android bundle 通過；正式 P3 接線／APK／實機驗收仍待主聊天及後續條件 |

FE-W04 的可獨立驗收範圍是外殼調整、孩子摘要與引導頁的前端投影、條件顯示、Web 響應式／鍵盤檢查及正式接線交接；不宣稱孩子摘要已取得 Server 資料或引導完成狀態已有正式來源。下一批真正任務／通知流程仍須先核對所屬業務包的已交付契約，不依參考圖推造任務完成或訊息送達。

每包依 [WORKFLOW](WORKFLOW.md) 核對 active worktree、提取設計規則、實作、必要輕量檢查及展示合成運行畫面。FE-W01 → FE-W04 的源碼已隨 PR #40–#43 合併；FE-W05 只保留比較樣本，並非後續靜態畫面的前置。2026-09-29 已恢復開發，並依使用者明確新指示加入手機軟件介面，取代先等待整套 Web 視覺確認的開工次序。Web／Android 維持靜態；本次只完成有契約可對照的前端範圍。第 7／8 項未交付的 API、正式接線及集中驗收不能由前端代為完成或標為通過。

FE-W06 驗收範圍：既有靜態路由及新增 /tasks 在 1440／1024／390／320 CSS px 檢查重排；針對新表單檢查確認、失敗保留、同原操作查核、版本衝突、角色、孩子切換及離線。共用設計修訂另查 840／744 的更多選單、SVG、白色 Dialog／合理圓角、孩子切換比例、16 個 token 對比及固定 export 首次載入。Android 只核對 bundle 與共用介面源碼；系統鍵盤、返回鍵、Safe Area、TalkBack、真 session、通知及實機畫面尚待後續驗收。主聊天 P2 集中驗收安排照常，不提前執行真服務或正式 E2E。

2026-09-29 使用者回報沒額度並要求暫時收尾；源碼及證據保存在 checkpoint `4739b9e`。2026-09-30 已恢復並補完建置、共用設計修訂及 FE-W07 本人渠道前端；使用者另要求建立持續目標。視覺比較及正式接線仍待使用者／主聊天；不把源碼／bundle 完成當作產品包或真機驗收完成。後續只按已交付契約開始獨立前端包；新合併只讀核對，不改主聊天 checkout。
