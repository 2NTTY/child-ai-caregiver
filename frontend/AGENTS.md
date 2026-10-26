# 育有方前端工作入口

本檔適用 `frontend/**`，以根 AGENTS 為基底；本域更具體的指示在本域優先，未衝突根規則繼續適用。

本目錄現為正式 Expo／React Native Web 前端；預覽素材只作設計及開發參考，不能覆蓋正式 owner。根 STATUS 已提供產品短摘要；接着只讀 [PLAN#active](PLAN.md#active)，按包讀相關設計、Skill 或專項交接，不預設讀整份 HANDOFF／研究／歷史。根 PLAN／SPEC／API 只按具體契約或正式整合需要讀；正式啟動及部署見 [入口指引](../docs/PRODUCTION_FRONTEND.md)。

本域沿 [根文件職責](../AGENTS.md#document-updates)：PLAN 管任務；STATUS 管短現況與入口；HANDOFF 管接線索引與差異；WORKFLOW 管次序；Skill 管方法；DESIGN_SYSTEM 管已採納呈現。不要再維護多份下一步。

主聊天現已獲准按 [根 INT 計劃](../PLAN.md#production-integration) 在本目錄接正式身份、資料及操作，並整合根 workspace／部署；下列隔離範圍限前端設計聊天，不阻止這次正式接線。已確認的版面、動效與互動保持，修改集中於 provider、API 回調及必需狀態。正式驗收採根包的最少代表路徑，不因本段而重跑整套預覽矩陣。預覽 fixture／測試保留參考，但正式畫面不得掛載合成 owner；過渡 route gate 不代表所有依賴已完成清理。

- 只修改 frontend/**。不接管主聊天的 Server、Agent、資料庫、根目錄依賴、正式 App 或根目錄權威文件；前端新依賴只加入本目錄。若 active worktree 修改範圍重疊，先指出具體路徑。
- 參考圖片只提供視覺規則；文案用香港繁體中文、現有 Logo 與美術。合成預覽不得聲稱已向 Server 保存、發送、登入、邀請或獲得 Agent 回答。
- 優先使用 [共用主題](src/theme.ts)、[Paper 元件封裝](src/components/ui.tsx)及 [Web 畫面 Skill](.agents/skills/web-screen-delivery/SKILL.md)。路由檔只作入口；畫面放 src/screens/，共用框架放 src/components/，合成資料放 src/preview/。頁面樣式用 React Native StyleSheet.create 與畫面共置。
- 正式入口為 `app/_layout.tsx` → `src/production/ProductionProvider.tsx`；正式資料 owner 位於 `src/production/`。合成 fixture／預覽 owner 不作正式資料來源；`src/preview/` 尚有正式畫面使用的共用 guard／provider，不按目錄名刪除。
- 在倉庫根執行 `npm run web` 啟動本域；需 API／登入時沿根本地入口。僅需前端型別檢查時使用 `npm run typecheck --workspace frontend`。
- 佈局／響應式改動按影響選取 1440／1024／390／320 CSS px、鍵盤及必要狀態，附實際畫面；純文案或不影響佈局的接線不例行重跑四尺寸。真 API 接線及正式瀏覽器 E2E 由主聊天按交接文件處理，不把前端預覽算作正式驗收。
- Android 共用 UI 的提前實作與正式 P3／真機門檻，只依 [根聊天分工](../AGENTS.md#frontend-backend)；本域不再維護另一份次序。
- 開包、整合前及交付前 fetch GitHub，核對 master 與 active worktree 的 frontend 路徑。其他聊天的新內容只讀參照；不能在主聊天 checkout 執行 pull／reset／stash。
