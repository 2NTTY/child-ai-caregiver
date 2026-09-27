# FE-W01 Web 主頁交接

**歸屬**：本文件與實作只在 `frontend/**`；根目錄 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 及正式 API／共享型別是功能權威。基線 commit：`3e15d04`（`master`）；交付分支：`codex/fe-w01-web-home`；畫面、程式與驗證交付 commit：`48cc95c`。本包不修改 P1 正式首頁、不呼叫 Server、不自行 merge。

| 項目 | 狀態 | 入口／說明 |
|---|---|---|
| Expo Router Web 預覽 | 前端已完成 | [app/_layout.tsx](app/_layout.tsx)、[app/index.tsx](app/index.tsx)；單一 `/` 預覽路由，其他頁面沒有假路由 |
| 主頁與共用元件 | 前端已完成 | [HomeDashboard](src/components/HomeDashboard.tsx)、[ui.tsx](src/components/ui.tsx)、[theme.ts](src/theme.ts)；桌面資訊架構依 1586×992 參考圖，基本聊天入口只導航、不在預覽提交訊息 |
| 資料及操作界面 | 前端已完成 | [view-model.ts](src/view-model.ts)；只供畫面顯示，**不是** wire contract 或第二套業務規則 |
| 情境資料、重讀計時和入口提示 | 只屬合成預覽 | [fixture.ts](src/preview/fixture.ts)、[app/index.tsx](app/index.tsx)；全部在記憶體，沒有 fetch／Server 呼叫 |
| 正式 App、真 API、權限、收據 | 待主聊天接線 | 根目錄 `app/**`、`src/client/**`、`src/shared/**` 保持原狀；須由主聊天對照現有契約整合及驗收 |
| Agent 百分比、通知／任務、附件、照片 | 未有本頁可用的完整契約／接線 | 不在首頁冒充已運作；按所屬 P2 工作包完成後再處理 |

## 預覽與驗證

在 `frontend/` 執行 `npm ci --cache .npm-cache --no-audit --no-fund`。Windows PowerShell 如不容許 Expo 寫入使用者目錄，先設 `$env:__UNSAFE_EXPO_HOME_DIRECTORY = (Join-Path (Get-Location) '.expo-home')` 和 `$env:EXPO_NO_TELEMETRY = '1'`，再執行 `npm run web`，瀏覽 `http://localhost:8081`。另開終端執行 `npm run typecheck`、`npm run build:web`。保持預覽服務啟動時，`npm run verify:web` 以本機 Edge 擷取及檢查畫面；非 Windows 可設 `BROWSER_EXECUTABLE` 指向可用 Chromium。`dist/`、本機 cache／瀏覽器資料均不提交。

已通過：typecheck、Expo Web 靜態 build；Playwright Core 在 1586／1440／1024／390／320 CSS px 核對 viewport、無橫向溢出、可見按鈕不被裁切及瀏覽器例外；鍵盤 Enter 可操作基本聊天入口、展開情境及查核原操作，孩子切換與本地篩選可操作，空／讀取／離線／五種操作狀態可分辨。畫面在 [verification/screenshots](verification/screenshots)；這些是合成預覽證據，不是真 API 或 Android 驗收。使用者視覺比較尚待完成。

## 資料、回調與正式落點

| 本頁入口 | 預覽行為 | 主聊天接線時對照 |
|---|---|---|
| `HomeViewModel.children`、`selectedChildId` | 兩位合成孩子；切換即換可見資料 | [RecordsState／RecordsController](../src/client/records-controller.ts) 的孩子及選擇；[ChildProfile／AgeBasis](../src/shared/care.ts) 顯示約數與日期基準，不猜未知欄位 |
| `records`、`recordsLoad`、`lastReadLabel` | 合成已確認記錄；輸入框只篩選已載入項 | [CareRecord／CarePage](../src/shared/care.ts)、[CarePanel](../src/client/CarePanel.tsx) 及現有記錄瀏覽器；保留原文、事件時間與加入／確認時間分別、來源、精度與權限；候選不能列作已確認 |
| `connection` | 合成在線／離線提示 | 現有連線及 [use-online-updates](../src/client/use-online-updates.ts)；網絡可用不等於資料已保存、刷新成功或權限仍有效 |
| `operation` | 六種展示狀態；只改前端情境 | 原控制器結果與 [OnlineReceipt](../src/shared/online.ts)、[online-transport](../src/client/online-transport.ts)；不得由文案或超時猜測終態 |
| `selectChild(id)` | 記憶體切換 | 原控制器先取消／隔離上一孩子請求與可見資料，再授權讀取；保留每位孩子當頁草稿，撤權／刪除／登出時依現有規則清理 |
| `refresh()` | 650 ms 合成讀取 | 正式刷新須讀真 API、處理版本／世代／失效與錯誤，不把預覽計時器帶入正式 App |
| `reviewOperation()` | 顯示接線提示，不提交 | 回原操作及原草稿；`unknown` 先用**原 opId** 查核收據，再按既有規則以原操作重試，不能建立新操作或自動重送 |
| `open(destination)` | 顯示「待正式 App 接線」提示 | `chat` → [ChatPanel](../src/client/ChatPanel.tsx)；`care`／`profile` → [CarePanel](../src/client/CarePanel.tsx)；`family` → [FamilyPanel](../src/client/FamilyPanel.tsx)；`memory` → [MemoryPanel](../src/client/MemoryPanel.tsx)。需保留登入／角色／孩子授權；不是新 Web 路由 |

`HomeViewModel` 的 `profileConfirmed`、`operation` 等欄位是顯示用投影，不能回寫成 Server 事實。主聊天整合時由正式控制器生成 view model；合成 fixture 不得進入正式資料來源或配置。

## 狀態語義與整合限制

| 狀態 | 可以顯示的意思 | 正式版禁止的捷徑 |
|---|---|---|
| 待確認 | 內容仍屬候選，等照顧者核對 | 顯示成已保存／共享記錄 |
| 處理中 | 原操作已發出，等待確定結果 | 因網絡在線便宣稱成功 |
| 已保存 | 原操作有可信 Server 確認／收據 | 單憑按鈕點擊、HTTP 超時或本地文字推斷 |
| 失敗 | 已能確定操作沒有成功；保留輸入 | 清空草稿或當作「結果未知」直接新建 |
| 結果未知 | 原操作終態未查清 | 當作失敗、換 opId 自動重送、生成重複資料 |

切換孩子、登出、撤權、刪除及帳號切換要沿用正式控制器的取消與清理規則；預覽只示意孩子切換後可見資料改變，**沒有**驗證權限或跨帳號隔離。主聊天負責正式接線、真 API／瀏覽器驗收及根依賴整合；前端工作包停在可比較的 Web 主頁預覽。
