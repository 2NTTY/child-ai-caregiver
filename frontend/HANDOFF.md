# 育伴港 Web／手機介面交接

更新：2026-09-29。只交接 `frontend/**`；正式產品、Server、Agent、權限及協定仍以根目錄文件和程式碼為準。FE-W01–FE-W05 已隨 PR #40–#44 合併；FE-W06 基於穩定 `master` **22f5c667887e8c5a926df59686a460fc3d281c6d**，分支 `codex/fe-w06-care-record-flows`。本包主責 B（Web／App UI），開發責任份額 100%，相對權重 5；使用者透過共用 Codex 統籌，沒有聲稱 B 親自手寫或執行驗證。視覺由使用者驗收，正式接線及真服務由主聊天統籌。

## 交付範圍及入口

**已實作前端源碼；全部資料操作只屬合成預覽，尚未接真 API。** Web／Android 維持靜態，`/motion-preview` 只保留舊比較樣本。所有新增依賴、設定、測試、Skill 和文件均在本目錄；不替換已驗收正式首頁，不修改其他聊天的後端／Agent 或權威文件，不自行 merge。

| 入口 | 本包前端行為 | 正式接線位置 |
|---|---|---|
| `/`：[HomeDashboard](src/components/HomeDashboard.tsx)、[MobileHomeDashboard](src/components/MobileHomeDashboard.tsx) | 桌面主頁、手機參考圖的問候／孩子卡片／提問捷徑／今日重點／待辦／快速記錄；未知及載入分開。捷徑只準備問題，有原草稿時保留 | [records-controller](../src/client/records-controller.ts) 授權投影；HomeViewModel／HomeActions 在 [view-model](src/view-model.ts) |
| 共用外殼：[AppShell](src/components/AppShell.tsx)、[NativeAppShell](src/components/NativeAppShell.tsx)、[dashboard layout](app/(dashboard)/_layout.tsx) | 左下設定／帳戶與深綠對話入口，置中可返回主頁的 Logo，單一右欄開關，頂部孩子摘要、鈴鐺；原生四個 Tabs 和更多入口 | 正式控制器提供孩子、檔案、任務、操作及身份；不從 fixture 推斷權限 |
| `/care`：[CareRecordsView](src/components/care/CareRecordsView.tsx)、[care-view-model](src/care-view-model.ts) | 分頁搜尋／種類篩選、空頁續載、失敗／游標失效、詳情／歷史、新增／更正、原文及單位精度、共享核對、單筆永久刪除及衝突比較 | [CarePanel](../src/client/CarePanel.tsx)、[care-api](../src/client/care-api.ts)、[CareValues](../src/shared/care.ts) |
| `/profile`：[ProfileView](src/components/profile/ProfileView.tsx)、[profile-view-model](src/profile-view-model.ts) | 未知／生日／約數年齡與日期基準、早產原文、來源、有效期、家庭共享、歷史、更正／檔案刪除；另有新增孩子及擁有人整位孩子刪除確認 | CarePanel／care-api 的 profile；[records-api](../src/client/records-api.ts) 及 records-controller 的孩子建立／刪除 |
| `/family`：[FamilyView](src/components/family/FamilyView.tsx)、[family-view-model](src/family-view-model.ts) | owner／caregiver／viewer、邀請與一次顯示的無效合成碼、預覽／接受邀請、範圍核對、角色調整、撤權及版本比較 | [FamilyPanel](../src/client/FamilyPanel.tsx)、[family-api](../src/client/family-api.ts)、[family 型別](../src/shared/family.ts) |
| `/memory`：[memoryScreen](src/screens/memoryScreen.tsx)、[MemoryCards](src/components/memory/MemoryCards.tsx)、[memory-view-model](src/memory-view-model.ts) | 私人候選、確認家庭共享、來源版本／過期阻擋、更正／停用／刪除／歷史、話題暫緩／終態／明確重開、私人摘要覆蓋明細 | [MemoryPanel](../src/client/MemoryPanel.tsx)、[memory-api](../src/client/memory-api.ts)、[memory 型別](../src/shared/memory.ts) |
| `/tasks`：[TasksView](src/components/tasks/TasksView.tsx)、[task-view-model](src/task-view-model.ts) | 建立共享事項、負責人／時間／時區、改期／轉派、完成／取消、needs_review 明確覆核、版本／歷史／分頁；worker 與提醒資格分開 | [TaskPanel](../src/client/TaskPanel.tsx)、[task-api](../src/client/task-api.ts)、[task 型別](../src/shared/tasks.ts)；對照 S13-W01／W04 |
| `/settings`：[PreferencesPreview](src/components/PreferencesPreview.tsx) | 本人安靜時段、時區、預約例外及合成操作；帳戶／孩子／家庭／私隱分頁與引導重看入口 | family-api 的 getPreferences／savePreferences 及 family 型別；身份、渠道操作沿正式服務 |
| `/chat`、`/login`、`/guide` | 對話版式／當頁未送出問題，登入／註冊本地格式檢查，引導條件及重看入口 | 已驗收 ChatPanel／Better Auth；Agent 引用和引導完成來源仍待接線，不把示例回答或「看過引導」當真結果 |

桌面內容以 onLayout 的實際可用寬度重排；手機首頁在 Web 小於 650 px 或原生入口使用。390 px 快速記錄四格，較窄容器改兩列；孩子卡片可換行，不固定截圖尺寸。原生使用 SafeAreaProvider／useSafeAreaInsets、Expo Router JavaScript Tabs、Android window resize／tabBarHideOnKeyboard 及返回鍵關抽屜；沒有假系統狀態欄。手機 Web 截圖不是 Android 實機證據。

## 共用元件與成熟方案

- [theme.ts](src/theme.ts) 是色彩、字級、間距、圓角及 Paper 主題唯一入口；[ui.tsx](src/components/ui.tsx) 集中品牌按鈕、輸入、選單、卡片、標題、分頁和狀態。
- [AppDialog](src/components/AppDialog.tsx) 以 React Native Modal 承載 Paper Dialog，沿其 Web focus trap／Escape／焦點還原。Paper 的 [Modal 官方文件](https://oss.callstack.com/react-native-paper/docs/components/Modal) 要求 accessible modal 採 RN Modal；不用裸 Paper Modal 假設焦點已被限制。
- [AppCheckbox](src/components/AppCheckbox.tsx) 集中勾選、Space、disabled、Web aria-checked 與原生 accessibilityState；[ChildPicker](src/components/ChildPicker.tsx) 集中孩子切換。RN Web 0.21.2 須明確提供相應 ARIA，不因 TypeScript 接受 accessibilityState 就當 DOM 已有狀態。
- 複雜表單沿根工程已採用 RHF 7.88.0／resolvers 5.9.1／Zod 4.5.4；schema 在各功能組件目錄，Controller 接共用欄位，原文不被 trim／數值轉換覆寫。
- [DateTimeFields](src/components/DateTimeFields.tsx) 復用 MIT 的 Paper Dates **0.24.0** 日曆／時間輸入及 zh-HK 文案。標準時鐘視窗最小寬度 328，因此小於 360 的容器用同庫公開 TimePicker 的鍵盤模式和共用 Dialog；保留可手填欄位。
- [date-time](src/components/date-time.ts) 透過 MIT Luxon **3.7.2** 處理 IANA 時區轉換；日期本身不变成 UTC instant。安排時間需明確 offset／時區，拒絕無效日、DST 不存在或重複的本地時間，不按電腦時區暗中偏移。未改動的原值保留。
- 基線仍是 Expo 57.0.24／Router 57.0.22／RN 0.86.3／RN Web 0.21.2／Paper 5.15.3。依賴在本目錄鎖版本，不複製 lockfile 覆蓋根檔。路由／畫面／元件／狀態分檔，StyleSheet.create 與組件共置，沒有單一 HTML 巨檔。

重複使用的方法與官方來源在 [前端 Skill](.agents/skills/web-screen-delivery/SKILL.md) 及其原生／表單參考；不重選框架，不把 Skill 變成第二份需求或協定。

## 接線及狀態邊界

*-view-model.ts 是顯示模型和回調，不是 wire contract。[preview](src/preview) 的 fixture／use*Preview、[usePreviewOperation](src/preview/usePreviewOperation.ts) 只供展示，不得充當正式 transport。正式版由既有 API／控制器投影畫面，回調交給原 online transport；root shared 型別、Server 授權、收據及版本規則不改。

**各頁合成寫入目前彼此獨立，不能當作跨畫面同步已接通。** 只有新增／整位孩子刪除更新 PreviewProvider 的孩子投影；care／profile／tasks 修改不回填主頁／右欄 fixture。主聊天須用同一個授權 controller／refresh 結果投影所有位置，確認後重讀必要摘要，不能把兩套 fixture 拼成正式資料來源。

| 顯示狀態 | 正式行為 |
|---|---|
| 待確認 | 候選／預覽未保存或公開；核對來源、內容、對象、時間、共享及版本 |
| 處理中 | 保留原操作身份並等候，鎖定重複提交和改變對象的控制 |
| 已保存／已確認刪除 | 必須有可信原操作收據。確認後重讀失敗顯示「已確認，需重讀」，不能轉成未保存或再建立一次 |
| 失敗 | 已知未成功；保留草稿或刪除對象，重新核對才可提交 |
| 結果未知 | 用同一 Server opId 查核；不換 ID 自動重送、提前移除對象、清草稿或重建已刪除資料 |
| 版本衝突 | 保留本地值，並列原基準與最新值；明確換基準，再重新預覽／勾選及確認，不靜默覆蓋 |

合成 preview-operation-*／preview-care-operation-* 不是 Server opId。「已連接」不代表保存或 worker 正常。整合須保留：

1. 以孩子、身份及 generation 隔離請求；切換孩子、登出、身份改變、撤權或整位孩子刪除時清理相應可見資料、草稿、一次性碼、收據查核及遲到回覆，取消／忽略舊請求。同一身份短暫離線保留當頁草稿；沒有跨關閉恢復、離線主庫或 outbox。
2. 搜尋用既有 CareSearch／nextCursor；空頁仍有游標可續載，已載入數量不是總數。游標失效重新搜尋，不重送寫入；原文及查詢不放 URL／日誌。
3. CareValues.quantity 是一組原值／單位／精度，不擴成新協定；事件／加入時間分開。更正時 eventTime 原文未變，沿 CarePanel 保留完整原 eventTime（包括 at、timeZone、precision）；原文改變按既有程式碼重建，不猜精確時間。
4. 刪檔案／單筆照顧記錄／整位孩子是三種範圍。deleteProfile／care.delete 核對 expectedVersion；只有 owner 經 records.deleteChild 及原 childDeletion gate 刪整位孩子，payload 為 confirmChildId。沿原控制器阻擋私人聊天／其他 pending 寫入；Server 確認後才清理孩子和關聯資料。預覽按鈕不是授權機制。
5. owner 管邀請、角色和撤權；caregiver／owner 可寫共享照護，viewer 的私人記憶與家庭共享權限分開。token 只建立時一次展示，清單／URL／日誌不含碼，刷新／離開／切換範圍清除；合成碼不能用於真邀請。
6. 記憶候選另行核對家庭共享；來源變更／過期不能確認舊值。摘要顯示覆蓋 ID／版本，變更後舊摘要失效；本包只讀摘要，沒有模型「生成」假按鈕。終態話題重開建立相連新話題，舊話題保持終態。
7. task、occurrence、work、reminder 和投遞分開。完成／取消不能重開；needs_review 明確覆核終態。workerEnabled=true 不是存活證據，processed 不是發送或照護完成。提醒須匹配 taskVersion／occurrence／接收者當下權限。

## 已交付 API 對照

基線已合併 S05-W02、S06-W02、S07-W03、S09-W02、S13-W01 及 S13-W04；未接線不表示後端沒有實作。詳細 payload 沿既有型別，不另抄第二份協定。

| 領域 | 主聊天應復用 |
|---|---|
| 孩子／身份／私人聊天 | records-api／records-controller 的 session、children、createChild、deleteChild、原 ChatPanel；保留身份及刪除 gate |
| 照顧／檔案 | care-api 的 search／create／revise／history／delete、getProfile／saveProfile／profileHistory／deleteProfile |
| 家庭／偏好 | family-api 的家庭／成員讀取、create／preview／accept／revokeInvitation、changeMember、createChild、get／savePreferences |
| 記憶 | memory-api 的 facts／topics／summary／history、create／confirm／revise／deactivate／delete fact、create／change／reopen／delete topic |
| 任務 | task-api 的 tasks／task／history／createTask／changeTask、S13-W04 work／reminder 投影；不新增前端 worker |
| 一致性 | [online](../src/shared/online.ts) 及原 online transport：原操作收據、版本及可見頁面重讀 |

HomeChild.profileConfirmed／ageLabel／allergiesLabel 只投影同一 selectedChildId 的授權資料。沒有過敏資料是「未提供」，不能寫「沒有過敏」；載入或錯誤不沿用上一位孩子摘要。引導的 first_login／incomplete／complete 尚無本基線權威來源，主聊天須按身份／初始化流程定義；本地看過頁面只是示意。

## 待主聊天接續

- 所有真 session／API／opId／跨畫面及跨成員同步、正式 UI 掛載和 S16-W05 瀏覽器驗收。
- S11-W02 真 Agent 多步結果／引用、S12 照片／分享来源核對、S13 通知渠道／投遞及成長關注、S14 到診摘要等：active 分支落碼不等同已合併交付。收到已 review 契約／基線再安排相應前端包，不代改其程式碼。
- 真通知中心、Web Push／Telegram／FCM 及未讀。鈴鐺只提示合成原操作，右欄勾選只是本地清單；/tasks 的合成流程另列，不能互相冒充。
- 圖中的第三方／手機登入、忘記密碼、方案／儲存用量、帳戶匯出／刪除、疫苗百分比及知識首頁，不能憑圖片當已承諾 API。手機首頁暫用已有記憶／話題入口，沒有假醫療建議、附件或咪高峰操作。
- 正式 P3 共用服務、APK／簽署、實機畫面／鍵盤／返回鍵／Safe Area／TalkBack／大字體、登入及相機／通知權限。Android JS bundle 不代表上述已驗收。

## 預覽及驗證

在 frontend/ 執行：

```powershell
npm ci --cache .npm-cache --no-audit --no-fund
$env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path (Get-Location) '.expo-home'
$env:EXPO_NO_TELEMETRY = '1'
npm run web -- --port 8082
```

瀏覽 http://localhost:8082。另外執行 npm run typecheck、npm run test:forms、npm run build:web、npm run build:android-ui。npm run verify:web 只验本機合成畫面；可用 node scripts/verify-ui.mjs care，或 profile／family／tasks／memory／shell／settings／shared／login／deletion 選群組。預設 Edge；其他 Chromium 設 BROWSER_EXECUTABLE，其他埠設 FRONTEND_PREVIEW_URL。

共用控件／外殼變更已檢查 **10 個靜態路由 × 1440／1024／390／320 CSS px**，另查表單／歷史／搜尋、確認／失敗／unknown／409、角色／撤權、孩子切換、邀請及終態。腳本監察 pageerror 和 /api/ 請求，沒有呼叫 Server。19 項單元檢查涵蓋日期／時區／DST、檔案原文／未知、家庭角色／邀請、記憶及任務終態；不是正式服務測試。

證據及截圖在 [verification/fe-w06](verification/fe-w06)，實際結果以 JSON 及 [STATUS](STATUS.md) 為準。手機截圖是共享 React Native 畫面的 Web 執行結果；Android 另有資產／Hermes bundle 建置證據，未跑 emulator／實機。視覺仍待使用者比較，P2／P3 未因前端交付完成。

2026-09-29 使用者因沒額度要求暫時收尾。40 個版面／11 組流程及其後手機首頁針對性檢查、最新 typecheck、19 項單元檢查已通過；兩個 export 在最後手機問題捷徑的小調整前通過。**下次先重跑最後版本的 Web／Android export**，再視新證據補驗，不從暫存推斷已完成全部驗收。交付 commit 及遠端備份以本分支 Git 記錄和此次對話為準。
