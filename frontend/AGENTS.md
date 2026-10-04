# 育有方前端工作入口

本檔適用 `frontend/**`，以根 AGENTS 為基底；本域更具體的指示在本域優先，未衝突根規則繼續適用。

本目錄是獨立 Expo／React Native Web 前端預覽。根 STATUS 已提供產品短摘要；接着只讀 [PLAN#active](PLAN.md#active)，按包讀相關設計、Skill 或專項交接，不預設讀整份 HANDOFF／研究／歷史。根 PLAN／SPEC／API 只按具體契約或正式整合需要讀。

本域沿 [根文件職責](../AGENTS.md#document-updates)：PLAN 管任務；STATUS 管短現況與入口；HANDOFF 管接線索引與差異；WORKFLOW 管次序；Skill 管方法；DESIGN_SYSTEM 管已採納呈現。不要再維護多份下一步。

- 只修改 frontend/**。不接管主聊天的 Server、Agent、資料庫、根目錄依賴、正式 App 或根目錄權威文件；前端新依賴只加入本目錄。若 active worktree 修改範圍重疊，先指出具體路徑。
- 參考圖片只提供視覺規則；文案用香港繁體中文、現有 Logo 與美術。合成預覽不得聲稱已向 Server 保存、發送、登入、邀請或獲得 Agent 回答。
- 優先使用 [共用主題](src/theme.ts)、[Paper 元件封裝](src/components/ui.tsx)及 [Web 畫面 Skill](.agents/skills/web-screen-delivery/SKILL.md)。路由檔只作入口；畫面放 src/screens/，共用框架放 src/components/，合成資料放 src/preview/。頁面樣式用 React Native StyleSheet.create 與畫面共置。
- 按當前改動檢查受影響頁的 1440／1024／390／320 CSS px、鍵盤與必要狀態，附實際運行畫面。真 API 接線及正式瀏覽器 E2E 由主聊天按交接文件處理，不把前端預覽算作正式驗收。
- Android 共用 UI 的提前實作與正式 P3／真機門檻，只依 [根聊天分工](../AGENTS.md#frontend-backend)；本域不再維護另一份次序。
- 開包、整合前及交付前 fetch GitHub，核對 master 與 active worktree 的 frontend 路徑。其他聊天的新內容只讀參照；不能在主聊天 checkout 執行 pull／reset／stash。
