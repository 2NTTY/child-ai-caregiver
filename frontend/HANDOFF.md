# 育伴港 Web 前端交接

本文件交接 frontend/** 的獨立畫面包，不改變根目錄 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 或正式 API／共享型別的權威。FE-W05 分支 codex/fe-w05-motion-preview 由 FE-W04 commit 591a23d 延伸；先前四包尚待使用者視覺確認，使用者已決定暫不採用動態，FE-W05 只保留獨立比較頁，未自行 merge，亦非靜態 Web 接線的前置條件。正式 P1 登入、孩子、文字記錄及基本聊天在主 App 已可用；P2 有部分功能已落碼並具本機證據，現網仍是 P1，Agent 對話接線、任務、通知等不能從本預覽推斷為已可用。

## 前端入口與結構

| 位置 | 狀態 | 用途 |
|---|---|---|
| [app](app)、[app/_layout.tsx](app/_layout.tsx) | 前端已完成 | Expo Router 薄路由與 PaperProvider；群組 layout 共用 PreviewProvider／AppShell |
| [AppShell.tsx](src/components/AppShell.tsx)、[ChildKeyFacts.tsx](src/components/ChildKeyFacts.tsx)、[PageFrame.tsx](src/components/PageFrame.tsx) | 前端已完成；資料只屬合成預覽 | 左導覽、置中可返回主頁的 Logo、孩子選擇及關鍵摘要、單一右欄開關、左下對話入口、條件式引導入口與內頁版式 |
| [PreviewTodoCard.tsx](src/components/PreviewTodoCard.tsx)、[NotificationBell.tsx](src/components/NotificationBell.tsx) | 只屬合成預覽 | 右欄按孩子顯示可本地勾選的清單；頂部鈴鐺按原操作狀態顯示提示及角標，不是 S13 任務或通知資料 |
| [screens](src/screens) | 前端已完成；資料只屬合成預覽 | 主頁以 [HomeDashboard.tsx](src/components/HomeDashboard.tsx) 組成；對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定、[使用引導](src/screens/guideScreen.tsx)及登入各自有畫面檔 |
| [motionPreviewScreen.tsx](src/screens/motionPreviewScreen.tsx)、[MOTION_OPTIONS.md](MOTION_OPTIONS.md) | 只屬合成選型預覽 | `/motion-preview` 在同一示例中比較三種動態；沒有寫入其他畫面的共用規則，也不讀取真孩子或任務 |
| [theme.ts](src/theme.ts)、[ui.tsx](src/components/ui.tsx) | 前端已完成 | 單一 token／Paper 主題，品牌按鈕、表單、卡片、共用分頁、連線與操作狀態；全畫面無硬編碼色值 |
| [view-model.ts](src/view-model.ts)、[preview](src/preview) | 只屬合成預覽 | 孩子、記錄、操作狀態、本地草稿及待辦示例；不是 wire contract、Server 收據或正式資料源 |
| [verify-web.mjs](scripts/verify-web.mjs)、[screenshots](verification/screenshots) | 前端已完成 | Playwright Core 只測本機合成預覽與瀏覽器版式，不能代替真 API／正式 E2E |

Expo 57.0.24、Router 57.0.22、React Native Web 0.21.2 與正式 repo 現行版本相同。隔離預覽額外使用 React Native Paper 5.15.3 及 Expo SDK 相容的 @expo/vector-icons 15.x；主聊天整合時須核對根依賴與許可，不能直接覆蓋根 package-lock。React Native Web 樣式以 StyleSheet.create 與畫面共置；沒有單一 HTML 或巨型 CSS 檔。

## 預覽方法與證據

在 frontend/ 執行 npm ci --cache .npm-cache --no-audit --no-fund。Windows PowerShell 如不容許 Expo 寫入使用者目錄，先設定以下兩個環境變數，再執行 npm run web：

    $env:__UNSAFE_EXPO_HOME_DIRECTORY = (Join-Path (Get-Location) '.expo-home')
    $env:EXPO_NO_TELEMETRY = '1'

預設瀏覽 http://localhost:8081；若已佔用可用 npm run web -- --port 8082，驗證前設定 FRONTEND_PREVIEW_URL=http://localhost:8082。另執行 npm run typecheck、npm run build:web、npm run verify:web；瀏覽器腳本預設使用本機 Edge，其他環境可設定 BROWSER_EXECUTABLE 指向 Chromium。FE-W04 的 typecheck、Web build 與瀏覽器檢查均通過；腳本覆蓋 1586／1440／1024／390／320 CSS px、九個 dashboard／登入路由與側欄、待辦、鈴鐺、孩子切換、首次登入／設定未完成引導、草稿、設定及登入的本地互動，未見整頁橫向溢出。截圖在 [verification/screenshots](verification/screenshots)；使用者視覺比較尚待完成。

FE-W05 另以 `npm run verify:motion` 檢查 1440／1024／390／320 CSS px 的 A／B／C 切換、孩子資料同步、鍵盤展開與手動／系統減少動態；typecheck、Web build、此針對性瀏覽器檢查均通過，截圖在 [verification/motion-preview](verification/motion-preview)。本包只新增隔離路由與腳本，未改既有產品路由或 view model；使用者已選擇暫時保持靜態，正式頁面不採用動態。

## 各畫面及正式落點

| Web 預覽 | 前端現況 | 主聊天接線時對照 |
|---|---|---|
| / 主頁及右資訊欄 | 合成孩子、已確認記錄投影、最近操作；右欄可關閉／重開，新增本地待辦示例；頂部鈴鐺只按原操作狀態提示 | [RecordsController](../src/client/records-controller.ts)、[CarePanel](../src/client/CarePanel.tsx)、[OnlineReceipt](../src/shared/online.ts)；待辦／通知須等 S13 正式契約，不另建前端背景台帳 |
| 頂部孩子選擇與關鍵摘要 | 孩子稱呼／約齡、地區、檔案核對及過敏欄位由同一個 selectedChildId 的 view-model 驅動；讀取中隱藏舊摘要，未知過敏明示「未提供」；目前全是 fixture | 先經登入會話取得授權的 `GET /api/children`，再依所選 ID 取得 `GET /api/children/:childId/profile`；按 [Child](../src/shared/records.ts) 與 [ChildProfile](../src/shared/care.ts) 投影年齡基準、地區與過敏資料。切換 ID 立即清除舊摘要、取消或忽略舊請求，才展示新 ID 的資料；Server 的權限與最新值為準 |
| /guide 使用引導 | 首次登入／設定未完成時左下導覽及首頁 CTA 指向引導；完成時只保留設定入口。三步內容與「模擬設定已完成」只屬本地示意，未保存設定 | 現有 API／SPEC 沒有權威 `first_login / incomplete / complete` 來源；主聊天須按正式身份及配置流程決定狀態來源、初始化完成條件、跨裝置持續性與權限失效處理，再投影到 `guideStatus`。不可從瀏覽器記憶體或「看過頁面」推斷已完成 |
| /login | 電郵登入／註冊畫面及本地格式檢查；密碼不發送 | [身份 API](../docs/API.md#p1-input-contracts)、[records-api](../src/client/records-api.ts) 與現有 Better Auth；登入／登出、session、錯誤及角色以正式 App 為準 |
| /chat | 可寫本地未送出問題、示例對話版式；示例回答明示不是 Agent 建議 | P1 [ChatPanel](../src/client/ChatPanel.tsx) 及聊天保存；P2 S11-W02 Agent／引用接線尚待交付，不能把示例當作模型結果 |
| /care | 已確認記錄時間軸、篩選、詳情及本地共享草稿預覽 | [CarePanel](../src/client/CarePanel.tsx)、[CareRecord](../src/shared/care.ts)；保留原文、來源、事件／加入時間、精度、版本、更正及候選確認 |
| /profile | 子女資料與本地待確認草稿 | CarePanel／ChildProfile；年齡約數及日期基準、未知欄位、歷史與共享範圍不能猜測 |
| /family | 合成角色、權限說明及本地邀請內容預覽；不產生邀請 | [FamilyPanel](../src/client/FamilyPanel.tsx)、[family 型別](../src/shared/family.ts)；一次性碼、owner／caregiver／viewer、撤權與私人聊天隔離由 Server 核定 |
| /memory | 已確認／候選示例、話題及摘要版式、本地候選草稿 | [MemoryPanel](../src/client/MemoryPanel.tsx)、[memory 型別](../src/shared/memory.ts)；私有候選、確認、版本衝突、撤權及摘要覆蓋以正式契約為準 |
| /settings | 帳戶、孩子、家庭、偏好、私隱分頁；本地顯示名稱／安靜時段／預約例外預覽 | 現有身份與 S06-W02 本人偏好／家庭資料；正式保存、權限與各通知渠道須按 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 接線 |

主聊天整合時由正式控制器投影資料到畫面，將合成 fixture 排除於正式資料來源。切換孩子要先隔離舊孩子的可見資料／未完成請求；預覽只示意孩子分開及當頁草稿隔離，沒有驗證 Server 授權。登出、撤權、刪除及帳號切換須沿用正式控制器清理規則。

`HomeViewModel.profileLoad` 及 `HomeChild.allergiesLabel` 是顯示層欄位，不是新 wire contract。真 profile 錯誤或未回覆時須顯示讀取／錯誤，不可沿用上一位孩子的關鍵資料；沒有過敏資料時應顯示「未提供」，不可改寫成「無過敏」。連線標籤「已連接」只反映連線狀態，不能代替保存收據。前端沒有登入會話，故本包沒有直接呼叫上述 API；接線只由主聊天在正式 App 的既有身份、授權和控制器邊界內處理。

## 已有功能與 Web 預覽之間的缺口

以下比較對象是 frontend/** 的隔離預覽，並非聲稱主 App 沒有畫面。優先按根目錄 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 及 [PLAN](../PLAN.md) 的實際工作包狀態對接；參考圖中的 Google／Apple 登入、儲存用量與疫苗百分比沒有現成產品契約，不列為已承諾功能。

| 功能與目前正式狀態 | 此預覽仍缺的操作 | 後續責任 |
|---|---|---|
| P1 登入／基本聊天已可用；S07-W03 原操作收據與刷新已落碼 | /login 不建立真 session，/chat 只新增本地未送出文字；全畫面沒有真 opId 查核、跨端刷新和權限失效流程 | 主聊天沿現有身份、ChatPanel、online transport 接線及真服務驗收；前端按真狀態補齊畫面 |
| S05-W02 孩子檔案、已確認記錄、更正歷史、時間軸及搜尋已落碼 | /care 只有對已載入示例的本地篩選，沒有跨頁搜尋／搜尋 cursor 失效、原文來源、版本、更正操作與歷史；/profile 只預覽自由文字草稿，未有結構化年齡基準及共享範圍表單 | 下一個相關 Web 畫面包應先設計真搜尋與記錄／檔案細節；主聊天按 CarePanel／共享型別接線 |
| S06-W02 家庭角色／邀請／撤權及本人通知偏好已落碼 | /family 只預覽邀請內容，沒有接受邀請、成員角色變更及撤權流程；/settings 偏好輸入不保存 | 前端補真操作狀態；主聊天接 FamilyPanel、本人偏好及權限清理 |
| S09-W02 記憶事實、話題終態及摘要覆蓋已落碼 | /memory 只示意候選／話題，沒有確認、共享、更正、停用／刪除、重開、版本衝突及摘要覆蓋操作 | 前端按 MemoryPanel 已交付契約補完整控制；主聊天接線與驗收 |
| S13-W01 任務與 occurrence、S13-W04 執行台帳尚未開始 | 新增右欄待辦只是按孩子分隔的本地示例；沒有建立、到期／時區、指派、改期、完成、取消、跨成員同步或正式任務頁 | 待 S13 契約交付後另立前端任務包；主聊天處理 Server／worker／正式接線 |
| S06-W02 只有通知偏好；S13-W05 Web Push、S13-W06 Telegram 及投遞台帳尚未開始 | 鈴鐺只提示合成原操作狀態；沒有通知識別碼、未讀數、訂閱、安靜時段執行、投遞／已讀／回應證據 | 待通知契約交付再建立真訊息中心及渠道設定；主聊天接通知服務與接收者授權 |
| S11-W02 Agent／引用、S12-W03／W04 照片與分享、S13-W08 成長關注、S14-W01 到診摘要尚未開始 | /chat 沒有真 Agent 結果／官方片段／附件；沒有照片確認、成長關注處理及到診摘要專頁 | 等相關業務包交付，再逐屏做 Web；不能由截圖造百分比或可信來源 |

本地待辦的勾選只保存在 PreviewProvider 記憶體，重新載入即重置；切換孩子只顯示該孩子的項目，沒有改動正式資料。鈴鐺角標只在「待確認／失敗／結果未知」出現，數字是合成狀態提示數，不是未讀訊息數。正式任務的「完成」要依 S13 occurrence 終態；訊息的「接受／送達／已讀／回應」與照護完成須各有獨立證據，不能用本地勾選推導。Web 上 Paper Checkbox 5.15.3 的裸控制項未提供此組合需要的 Space 與 aria-checked，預覽外層 Pressable 補上 Web 鍵盤及可讀取狀態；日後升級須重驗。

FE-W04 把窄屏右欄改為外殼內的覆蓋面板，讓頂部同一按鈕在開啟後仍可關閉；右欄本身沒有 X。FE-W03 曾發現 Paper Portal 內的右欄直接呼叫 usePreview 會失去 Provider 而報錯；現仍由 AppShell 傳入資料與回調，正式接線及其他彈出層應沿用此邊界並實測開關。

## 狀態語義與未接功能

| 狀態 | 正式版可顯示條件 | 本預覽 |
|---|---|---|
| 待確認 | 候選內容待照顧者核對，仍非共享已確認記錄 | 合成版式可切換 |
| 處理中 | 原操作已提交，終態仍在等待 | 不因網絡可用宣稱成功 |
| 已保存 | 原操作有可信 Server 收據／授權讀取結果 | 只示意版式，沒有真收據 |
| 失敗 | 確知原操作未成功；保留輸入供使用者處理 | 保留預覽草稿 |
| 結果未知 | 原操作終態未查明 | 顯示「查核原操作」；正式版須以原 opId 查核，不換 ID 自動重送 |

參考圖中以下元素尚未在本包做成真操作：Agent 工具進度／百分比、官方來源引用與生成建議、附件／照片／咪高峰、正式背景任務與到期提醒、真未讀通知／Web Push／Telegram、疫苗或成長數據分析、跨資料搜尋、手機／Google／Apple 登入與忘記密碼、儲存用量／方案／匯出／刪除帳戶。P2 相關工作包及目前可用範圍見根目錄 [P2 UI 清單](../docs/P2_UI_HANDOFF.md)；無完整契約的項目不應僅依參考圖補假按鈕。

正式接線完成還需要主聊天核對真 API、session／權限、原操作收據、切換孩子及登出清理，並執行其 S16-W05 正式瀏覽器測試。前端預覽驗證與正式 E2E 分開；整套 Web 視覺尚待使用者確認，Android 尚未開始。
