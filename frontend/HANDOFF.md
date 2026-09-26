# 育伴港 Web 前端交接

本文件交接 frontend/** 的獨立畫面包，不改變根目錄 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 或正式 API／共享型別的權威。FE-W02 分支 codex/fe-w02-web-shell-chat-settings-auth 由 FE-W01 commit e70a13d 延伸；兩包都尚待使用者視覺確認，未自行 merge。正式 P1 登入、孩子、文字記錄及基本聊天在主 App 已可用；P2 有部分功能已落碼並具本機證據，現網仍是 P1，Agent 對話接線、任務、通知等不能從本預覽推斷為已可用。

## 前端入口與結構

| 位置 | 狀態 | 用途 |
|---|---|---|
| [app](app)、[app/_layout.tsx](app/_layout.tsx) | 前端已完成 | Expo Router 薄路由與 PaperProvider；群組 layout 共用 PreviewProvider／AppShell |
| [AppShell.tsx](src/components/AppShell.tsx)、[PageFrame.tsx](src/components/PageFrame.tsx) | 前端已完成 | 左導覽、左下設定／用戶、孩子選擇、右資訊欄及窄屏面板、預覽情境、內頁版式 |
| [screens](src/screens) | 前端已完成 | 主頁以 [HomeDashboard.tsx](src/components/HomeDashboard.tsx) 組成；對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定及登入各自有畫面檔 |
| [theme.ts](src/theme.ts)、[ui.tsx](src/components/ui.tsx) | 前端已完成 | 單一 token／Paper 主題，品牌按鈕、表單、卡片、共用分頁、連線與操作狀態；全畫面無硬編碼色值 |
| [view-model.ts](src/view-model.ts)、[preview](src/preview) | 只屬合成預覽 | 孩子、記錄、操作狀態及本地草稿；不是 wire contract、Server 收據或正式資料源 |
| [verify-web.mjs](scripts/verify-web.mjs)、[screenshots](verification/screenshots) | 前端已完成 | Playwright Core 只測本機合成預覽與瀏覽器版式，不能代替真 API／正式 E2E |

Expo 57.0.24、Router 57.0.22、React Native Web 0.21.2 與正式 repo 現行版本相同。隔離預覽額外使用 React Native Paper 5.15.3 及 Expo SDK 相容的 @expo/vector-icons 15.x；主聊天整合時須核對根依賴與許可，不能直接覆蓋根 package-lock。React Native Web 樣式以 StyleSheet.create 與畫面共置；沒有單一 HTML 或巨型 CSS 檔。

## 預覽方法與證據

在 frontend/ 執行 npm ci --cache .npm-cache --no-audit --no-fund。Windows PowerShell 如不容許 Expo 寫入使用者目錄，先設定以下兩個環境變數，再執行 npm run web：

    $env:__UNSAFE_EXPO_HOME_DIRECTORY = (Join-Path (Get-Location) '.expo-home')
    $env:EXPO_NO_TELEMETRY = '1'

預設瀏覽 http://localhost:8081；若已佔用可用 npm run web -- --port 8082，驗證前設定 FRONTEND_PREVIEW_URL=http://localhost:8082。另執行 npm run typecheck、npm run build:web、npm run verify:web；瀏覽器腳本預設使用本機 Edge，其他環境可設定 BROWSER_EXECUTABLE 指向 Chromium。腳本檢查 1586／1440／1024／390／320 CSS px，八路由在 1440 和 320 px 無整頁橫向溢出，並檢查側欄、情境、孩子切換、草稿、設定及登入的本地互動。截圖在 [verification/screenshots](verification/screenshots)；使用者視覺比較尚待完成。

## 各畫面及正式落點

| Web 預覽 | 前端現況 | 主聊天接線時對照 |
|---|---|---|
| / 主頁及右資訊欄 | 合成孩子、已確認記錄投影、最近操作；右欄可關閉／重開 | [RecordsController](../src/client/records-controller.ts)、[CarePanel](../src/client/CarePanel.tsx)、[OnlineReceipt](../src/shared/online.ts)；同一資料來源投影，不另建背景任務／通知台帳 |
| /login | 電郵登入／註冊畫面及本地格式檢查；密碼不發送 | [身份 API](../docs/API.md#p1-input-contracts)、[records-api](../src/client/records-api.ts) 與現有 Better Auth；登入／登出、session、錯誤及角色以正式 App 為準 |
| /chat | 可寫本地未送出問題、示例對話版式；示例回答明示不是 Agent 建議 | P1 [ChatPanel](../src/client/ChatPanel.tsx) 及聊天保存；P2 S11-W02 Agent／引用接線尚待交付，不能把示例當作模型結果 |
| /care | 已確認記錄時間軸、篩選、詳情及本地共享草稿預覽 | [CarePanel](../src/client/CarePanel.tsx)、[CareRecord](../src/shared/care.ts)；保留原文、來源、事件／加入時間、精度、版本、更正及候選確認 |
| /profile | 子女資料與本地待確認草稿 | CarePanel／ChildProfile；年齡約數及日期基準、未知欄位、歷史與共享範圍不能猜測 |
| /family | 合成角色、權限說明及本地邀請內容預覽；不產生邀請 | [FamilyPanel](../src/client/FamilyPanel.tsx)、[family 型別](../src/shared/family.ts)；一次性碼、owner／caregiver／viewer、撤權與私人聊天隔離由 Server 核定 |
| /memory | 已確認／候選示例、話題及摘要版式、本地候選草稿 | [MemoryPanel](../src/client/MemoryPanel.tsx)、[memory 型別](../src/shared/memory.ts)；私有候選、確認、版本衝突、撤權及摘要覆蓋以正式契約為準 |
| /settings | 帳戶、孩子、家庭、偏好、私隱分頁；本地顯示名稱／安靜時段／預約例外預覽 | 現有身份與 S06-W02 本人偏好／家庭資料；正式保存、權限與各通知渠道須按 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 接線 |

主聊天整合時由正式控制器投影資料到畫面，將合成 fixture 排除於正式資料來源。切換孩子要先隔離舊孩子的可見資料／未完成請求；預覽只示意孩子分開及當頁草稿隔離，沒有驗證 Server 授權。登出、撤權、刪除及帳號切換須沿用正式控制器清理規則。

## 狀態語義與未接功能

| 狀態 | 正式版可顯示條件 | 本預覽 |
|---|---|---|
| 待確認 | 候選內容待照顧者核對，仍非共享已確認記錄 | 合成版式可切換 |
| 處理中 | 原操作已提交，終態仍在等待 | 不因網絡可用宣稱成功 |
| 已保存 | 原操作有可信 Server 收據／授權讀取結果 | 只示意版式，沒有真收據 |
| 失敗 | 確知原操作未成功；保留輸入供使用者處理 | 保留預覽草稿 |
| 結果未知 | 原操作終態未查明 | 顯示「查核原操作」；正式版須以原 opId 查核，不換 ID 自動重送 |

參考圖中以下元素尚未在本包做成真操作：Agent 工具進度／百分比、官方來源引用與生成建議、附件／照片／咪高峰、背景任務與到期提醒、通知 badge／Web Push／Telegram、疫苗或成長數據分析、跨資料搜尋、手機／Google／Apple 登入與忘記密碼、儲存用量／方案／匯出／刪除帳戶。P2 相關工作包及目前可用範圍見根目錄 [P2 UI 清單](../docs/P2_UI_HANDOFF.md)；無完整契約的項目不應僅依參考圖補假按鈕。

正式接線完成還需要主聊天核對真 API、session／權限、原操作收據、切換孩子及登出清理，並執行其 S16-W05 正式瀏覽器測試。前端預覽驗證與正式 E2E 分開；整套 Web 視覺尚待使用者確認，Android 尚未開始。
