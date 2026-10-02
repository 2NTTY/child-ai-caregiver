# 本人渠道設定交接

更新：2026-09-30。FE-W07 前置是已 review 的前端 `6c7216f2c1b04f0ecebb3cedde7abf7e131b1f2d`（PR #54）；業務契約核對 `master` 的 `34892c7`，包含已合併 S13-W05／W06。現場分支 `codex/fe-w07-notification-settings`。只新增 frontend 介面與合成流程，沒有修改正式 App 或後端，也沒有真通知權限／訂閱／bot／外發。

## 組件及預覽

開啟 /settings →「通知渠道」。[ChannelCards](src/components/notifications/ChannelCards.tsx) 的 WebPushSettingsCard／TelegramSettingsCard 是受 model/actions 驅動的顯示組件；[channel-view-model](src/channel-view-model.ts) 只投影已核對欄位與動作，不是 HTTP 協定。共用 Paper／SVG／RHF／Zod 和既有色彩 token，沒有另造色盤或控制項。

[ChannelSettingsPreview](src/components/notifications/ChannelSettingsPreview.tsx) 注入既有 PreviewWriteNotice；useChannelSettingsPreview、usePushSettingsPreview、useTelegramSettingsPreview 全部只屬合成資料來源。工具可切權限拒絕／不支援、服務未配置、worker 暫停、過期、讀取／身份失效及不同投遞結果；本人渠道與安靜時段分開。

Web／窄 Web 的 Telegram 與渠道狀態使用同一元件。原生入口中的 Web Push 顯示不支援並阻擋新登記；不是 Android FCM 功能。FCM、APK／權限／實機仍由 P3 接續，不能因 Android JS export 成功當成已接通。

## 正式接線映射

| 前端顯示／回調 | 主聊天沿既有位置接線 |
|---|---|
| Push permission／browserSupported／currentBindingId | src/client/use-web-push.ts 及 push-browser.ts 的能力、本人瀏覽器狀態；由真 user gesture 觸發權限，不用 Platform.OS 代替真能力檢查 |
| Push status／bindings／delivery／測試限制 | src/shared/web-push.ts、web-push-api.ts 的 status；available／workerEnabled／testsRemaining／nextTestAt 投影，不推造 worker 存活或新配額 |
| stageEnable → 明確確認 | 原 useWebPush.onEnable／WebPushApi.register；label 最多 80 字元。正式 adapter 處理訂閱、keys、endpoint、本人 userId，顯示模型不處理這些資料 |
| stageRevoke／stageTest | 原 binding.id／expectedVersion 的 revoke／test；test 明確 confirmImmediate。服務未配置仍可撤銷，測試冷卻及最多三次按 Server 滾動 24 小時核對 |
| Telegram begin／openStartLink／refresh | telegram-api.begin／status 及 TelegramPanel 原流程；開始須 confirmPrivateChannel，開啟服務提供的有效 10 分鐘連結，不在前端自造 bot／token |
| Telegram stageConfirm | 原 challenge.id／version 與 candidate.label／chatIdHint 完整核對；confirmAccount 是明確同意。候選改變、過期或重讀後清除舊勾選，不能直接改 expectedVersion 再送 |
| Telegram revoke／test | 原 binding.id／expectedVersion；blocked 先撤銷，active 才測試。queued／sending 或未有 acknowledgedAt 的 unknown 不建立另一測試 |
| 原操作查核 | 既有 reconcilePending／online transport；前端 preview-operation-* 不是真 opId，不可當作正式重試識別 |

本 worktree 不改主線檔案；新增正式檔案可按已核對的 [Web Push API](https://github.com/2NTTY/child-ai-caregiver/blob/34892c7/src/client/web-push-api.ts)／[Telegram API](https://github.com/2NTTY/child-ai-caregiver/blob/34892c7/src/client/telegram-api.ts) 查閱。payload、授權、冪等及渠道協定仍以主線實際型別為準，不從本表複製成第二份協定。

## 必須保留的狀態與隔離

- permission、binding.status、寫入操作、worker 和 delivery 是不同狀態。瀏覽器允許不等於已訂閱；操作有收據不等於投遞已完成；accepted 不是送達／已讀；Telegram acknowledgedAt 只表示收到本人回覆，不是照護完成。
- 所有建立／撤銷／立即測試先核對本人、對象及範圍，再明確勾選。一般測試不含家庭正文，與主動聯絡授權分開；預覽不建立真側效果。
- unknown 保留原操作，不清對象或建立第二次提交；已知未保存才讓使用者重新核對。已確認但重讀失敗仍屬已確認／需重讀，不可改成未保存。正式重試保留主線原 ID 及 payload。
- 409 先展示最新對象／版本；明確採用新基準後清勾選並重新核對。本 preview 的失敗／衝突只用合成 fixture，沒有接正式 rollback 或 transport。
- 正式工作區按 userId＋apiBaseUrl 管 generation／取消與清理；切帳戶、Server、登出或會話失效時清除讀取值、待查操作、連結和勾選，忽略遲到回覆。切孩子不重綁本人渠道。
- 讀取失敗、載入和身份失效不展示上一批接收者；身份失效要求正確登入，不提供無效刷新按鈕。恢復連線後由使用者手動重讀，不另造 polling、離線 outbox 或背景重送。
- 同一帳戶讀取失敗或載入時保留當前瀏覽器名稱草稿；身份切換才清理。模擬 Telegram 啟動只準備合成回覆，須手動重讀才展示候選，然後再次核對及明確確認。
- 本包的「渠道情境帳戶」只測隔離，不是真帳戶切換，也不改主頁 fixture 身份。離開 /settings 或重新載入可清預覽；正式 controller 接線須替換這整層 synthetic hooks，不能串接兩份 fixture。

## 證據與待驗項

typecheck、18 組既有 token 對比、Web export（23 個靜態輸出）及 Android Hermes／31 項資產 export 通過。固定輸出 /settings 在 1440／1024／390／320 的重排、確認勾選、失敗／重讀草稿保留、狀態容器、原操作查核、切孩子保留／換帳戶清理、不可用仍撤銷、Telegram 手動重讀／候選衝突／過期／封鎖／回覆語義通過，沒有 pageerror、console.error 或 /api/ 請求；見 [checks-channels](verification/fe-w07/checks-channels.json)／[build-checks](verification/fe-w07/build-checks.json)。19 項未變表單單元及其他頁面沿前置證據，不機械重跑。

待使用者視覺比較、主聊天正式 UI／真 API／真權限／真 Push 與 Telegram 驗收、公開 origin／webhook、Android FCM 與實機。沒有新增真未讀／通知中心，也沒有完成 S13-W07 預授權、fallback 或完整聯絡台帳；頂部鈴鐺繼續只提示合成原操作。
