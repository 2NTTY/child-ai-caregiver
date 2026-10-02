# 前端逐屏工作流程

本流程只管 frontend/**。可重用的技術操作見 [Web 畫面 Skill](.agents/skills/web-screen-delivery/SKILL.md)，產品事實仍以根目錄文件與實際程式碼為準。

1. **確認工作包與邊界**：先讀根目錄 STATUS、PLAN 的當前狀態。依使用者 2026-09-30 指示，以 GitHub `master` 的 [P2 UI 交接](https://github.com/2NTTY/child-ai-caregiver/blob/master/docs/P2_UI_HANDOFF.md) 為入口，再局部讀 [API](https://github.com/2NTTY/child-ai-caregiver/blob/master/docs/API.md)、`src/shared` 型別及 `src/client/*-api.ts`；不假定主聊天或本 worktree 已拉到最新。本次固定遠端 commit，交接保留該版本的連結；網頁讀取不可用時可用 GitHub Contents API 讀同一遠端檔案，不以過時本機副本代替。開包、整合前、交付前 fetch GitHub，核對主線差異及 active worktree 的 frontend 路徑。有重疊先列具體路徑；只在自己的前端分支修改 frontend/**，不在主聊天 checkout 執行 pull／stash／reset，也不碰 Server／Agent／資料庫／正式 App。
2. **提取圖片規則**：比較色彩、字體層次、導覽、卡片、按鈕、輸入及狀態，先更新 [DESIGN_SYSTEM](DESIGN_SYSTEM.md) 的共用規則。圖片不是功能契約；圖中未落碼的操作列入交接，不造假互動。
3. **先組裝成熟元件**：用 Expo Router 路由與共同 layout、Paper 控件及現有 token。路由檔只做入口，畫面在 src/screens，狀態由 view model／回調驅動，合成 fixture 留在 src/preview。需要新依賴時先核對本目錄版本與官方文件；可重複且穩定的本項目做法才更新 Skill，不複製整份官方手冊。
4. **逐屏檢查**：按變更範圍執行 typecheck／Web build／必要單元檢查，針對新流程驗合成預覽。共用外殼變更時所有靜態路由檢查 1440／1024／390／320 CSS px；局部改動只驗受影響路由及狀態，不例行重跑完整舊測試。檢查鍵盤、孩子切換、右欄開關、草稿及空／載入／離線／操作狀態。真 API／正式 E2E／真服務沿主聊天 P2 集中驗收安排，不以預覽代替。
5. **手機介面**：按使用者 2026-09-29 指示可提前實作本目錄 Android UI；先復用同一套模型、Paper 表單及卡片，再加 Expo Router Tabs、Safe Area／鍵盤平台處理。不另建本地 Agent、資料庫或離線主庫。Android bundle 與 Web 截圖只證明各自範圍；APK、真機、TalkBack、系統權限及真 API 另列待驗收。
6. **展示與交接**：附實際運行截圖、驗證結果、待接線功能及具體組件／接口。更新本目錄 STATUS、PLAN、HANDOFF；分開列前端源碼、合成互動、正式接線及實機證據，不把未交付的後端功能勾成完成。使用者比較視覺與流程後再調整；不自行 merge。

2026-10-02 局部改動補充：先列同一元件的初態、過渡及終態，改佈局時同步檢查其動畫。尺寸／flex／位置需連續變化時，先用已採用 RN 0.86 的 [Animated.Value](https://reactnative.dev/docs/0.86/animatedvalue) 同步驅動，不在終態突然切另一份佈局。按 [Expo 官方動畫指引](https://github.com/expo/skills/blob/13ad8e05874195633b5c185f6947bb6400e228fc/plugins/expo/skills/expo-animation/SKILL.md) 的原則，驗實際移動幀、結束接縫、中途點擊／離頁、減少動畫及受影響斷點；靜態前後截圖不能證明過渡正常。首頁箭嘴跳動的根因及逐幀證據見 [FE-W28](HANDOFF.md#chat-source-reuse)。

同類內容已在兩處使用時，按 [Expo 元件組裝指引](https://github.com/expo/skills/blob/13ad8e05874195633b5c185f6947bb6400e228fc/plugins/expo/skills/expo-design-system/SKILL.md) 提取小而有明確用途的共用元件，資料／回調與內容組裝分開；不要把 fixture 或業務控制器搬進通用顯示層。沿 [React state／key 規則](https://react.dev/learn/preserving-and-resetting-state) 核對多實例互不干擾及身份／孩子清理。捲動、底線、固定輸入列等相鄰元素須量度相對位置，不能只驗整頁寬度。以上是局部開發方法研究，沒有安裝 Expo skills、複製開源程式或新增框架。
