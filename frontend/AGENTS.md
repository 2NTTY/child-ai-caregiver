# 育伴港前端工作入口

本目錄是獨立的 Expo／React Native Web 前端預覽。先讀本目錄 [STATUS.md](STATUS.md)、[PLAN.md](PLAN.md) 的當前工作包，再按畫面讀 [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)、[WORKFLOW.md](WORKFLOW.md) 與 [HANDOFF.md](HANDOFF.md)。產品功能、正式 API 及驗收仍以根目錄 AGENTS／STATUS／PLAN／SPEC、P2 UI 清單和實際程式碼為準。

- 只修改 frontend/**。不接管主聊天的 Server、Agent、資料庫、根目錄依賴、正式 App 或根目錄權威文件；前端新依賴只加入本目錄。若 active worktree 修改範圍重疊，先指出具體路徑。
- 參考圖片只提供視覺規則；文案用香港繁體中文、現有 Logo 與美術。合成預覽不得聲稱已向 Server 保存、發送、登入、邀請或獲得 Agent 回答。
- 優先使用 [共用主題](src/theme.ts)、[Paper 元件封裝](src/components/ui.tsx)及 [Web 畫面 Skill](.agents/skills/web-screen-delivery/SKILL.md)。路由檔只作入口；畫面放 src/screens/，共用框架放 src/components/，合成資料放 src/preview/。頁面樣式用 React Native StyleSheet.create 與畫面共置。
- 每頁檢查 1440／1024／390／320 CSS px、鍵盤與必要狀態，附實際運行畫面。真 API 接線及正式瀏覽器 E2E 由主聊天按交接文件處理，不把前端預覽算作正式驗收。
- 使用者於 2026-09-29 明確擴大範圍至各尺寸 Web 及手機軟件介面：可在本目錄提前實作 Android 的共用畫面、Tabs／Safe Area 和合成預覽。此指示取代「先確認整套 Web 才開始手機介面」的前端次序；正式 P3 接線、APK／真機驗收及主聊天修改邊界維持不變。手機 Web、Android bundle、Android 實機三者的證據須分開。
- 開包、整合前及交付前 fetch GitHub，核對 master 與 active worktree 的 frontend 路徑。其他聊天的新內容只讀參照；不能在主聊天 checkout 執行 pull／reset／stash。
