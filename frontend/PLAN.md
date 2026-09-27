# 育伴港前端單一計劃

本計劃合併設計規則、Web 實作和 Android 次序，只管 `frontend/**`。產品功能及正式工作包仍以根目錄 [AGENTS.md](../AGENTS.md)、[STATUS.md](../STATUS.md)、[PLAN.md](../PLAN.md)、[SPEC.md](../SPEC.md) 和 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。

| 次序 | 前端工作包 | 狀態 | 交付及驗收 |
|---|---|---|---|
| 1 | FE-W01 Web 主頁 | 待驗收 | 在 `frontend/` 建立獨立 Expo Router Web 預覽；依 1586×992 參考圖完成桌面資訊架構，以育伴港品牌、Paper 共用元件和合成 view model 做可操作首頁；核對 1586／1440／1024／390／320 CSS px、typecheck、Web build、鍵盤及狀態；交付畫面與接線文件，等使用者比較 |
| 2 | 其他 Web 畫面 | 未開始 | 每次由使用者指定一個畫面；先核對實際功能／API，再提取新圖的共用規則，逐包實作與展示；有 active worktree 檔案重疊先指出 |
| 3 | Web 整套確認 | 未開始 | 使用者明確確認整套 Web 視覺與流程，並由主聊天完成其負責的正式接線／真 API 驗收；不以合成預覽代替 |
| 4 | Android 前端 | 未開始 | 在第 3 項之後另立 Android 計劃及真機驗收；390／320 px 只屬手機瀏覽器 Web 重排 |

FE-W01 保留已驗收的正式 P1 首頁及主聊天的所有 Server／Agent／資料庫工作；前端只在獨立分支改 `frontend/**`，不修改根目錄依賴／lockfile／權威文件，也不自行 merge。正式 App 接線由主聊天按 [HANDOFF.md](HANDOFF.md) 辦理。

每頁遵從 [WORKFLOW.md](WORKFLOW.md)；共用視覺規則見 [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)。下一頁的具體範圍、接口及驗收，要待使用者提供參考圖後才確定。
