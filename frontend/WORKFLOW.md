# 前端逐屏工作流程

本流程只管 frontend/**。可重用的技術操作見 [Web 畫面 Skill](.agents/skills/web-screen-delivery/SKILL.md)，產品事實仍以根目錄文件與實際程式碼為準。

1. **確認工作包與邊界**：先讀根目錄 STATUS、PLAN 的當前狀態，按需讀 SPEC、P2 UI 清單及相關 API／程式碼。重查 Git、active worktree 及具體檔案重疊；只在獨立前端分支修改 frontend/**，不碰主聊天 Server／Agent／資料庫／正式 App。
2. **提取圖片規則**：比較色彩、字體層次、導覽、卡片、按鈕、輸入及狀態，先更新 [DESIGN_SYSTEM](DESIGN_SYSTEM.md) 的共用規則。圖片不是功能契約；圖中未落碼的操作列入交接，不造假互動。
3. **先組裝成熟元件**：用 Expo Router 路由與共同 layout、Paper 控件及現有 token。路由檔只做入口，畫面在 src/screens，狀態由 view model／回調驅動，合成 fixture 留在 src/preview。需要新依賴時先核對本目錄版本與官方文件；可重複且穩定的本項目做法才更新 Skill，不複製整份官方手冊。
4. **逐屏檢查**：確認 1440／1024／390／320 CSS px 無整頁橫向捲動；檢查鍵盤、孩子切換、右欄開關、草稿及適用的空／載入／離線／操作狀態。執行 typecheck、Web build 和只讀合成預覽瀏覽器腳本；真 API／正式 E2E／Android 真機驗收由主聊天或後續工作包處理。
5. **展示與交接**：附實際運行截圖、驗證結果、待接線功能及具體組件／接口。更新本目錄 STATUS、PLAN、HANDOFF；使用者比較視覺與流程後再作下一輪調整。整套 Web 獲明確確認後才開始 Android 前端。
