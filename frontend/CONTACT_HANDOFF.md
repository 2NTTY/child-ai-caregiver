# 主動聯絡授權前端交接

更新：2026-10-01。FE-W17 基線 `3d4badfe07fdb4cee0574e802923178f071013be`，沿 `codex/fe-w11-photos`／[draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)，源碼／驗證 commit `ebcaa7359a932bd41bea050b5969a514619deca1`，主責 B。全部修改只在 `frontend/**`；沒有修改 Server、Agent、正式 App 或根文件，不自行 merge。

## 權威及入口

直接讀 GitHub master `ce87370b6375b25e45f016f2218d924b44f06f3c` 的 [UI-P2-09／聯絡交接](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md#contact-handoff)、[HTTP 契約](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/API.md#proactive-contact-http)、[contact 型別](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/contact.ts)、[ContactApi](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/contact-api.ts) 及 [正式 ContactPanel](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/ContactPanel.tsx)。交付前 fetch 仍是此 commit，其他 worktree 沒有 frontend 重疊。不依賴主聊天本機是否已拉取。

預覽 `npm run web -- --port 8083`，路由 `/contact`；桌面「聯絡授權」或窄屏／原生「更多」可到達。四個原生底部 Tabs 保留。固定輸出及通用指令見 [總交接](HANDOFF.md#預覽及驗證)。

| 入口 | 責任 |
|---|---|
| [ContactScreen](src/screens/ContactScreen.tsx)、contact 路由 | 薄入口、合成工具及身份／Server／孩子範圍重建 |
| [contact-view-model](src/contact-view-model.ts)、[ContactView](src/components/contact/ContactView.tsx) | 純資料／回調投影、讀取／原決定狀態；正式 adapter 替換 dataLabel 和回調 |
| [ContactConsentCard](src/components/contact/ContactConsentCard.tsx) | 本人渠道同意、綁定及次序、後備 opt-in、明確保存／撤回 |
| [ContactTaskCard](src/components/contact/ContactTaskCard.tsx)、[contact-form](src/components/contact/contact-form.ts) | RHF／Zod 選項、固定對象／內容／觸發、期限、跟進／fallback／撤回及版本核對 |
| [ContactHistory](src/components/contact/ContactHistory.tsx) | 真台帳狀態、自己收到確認，沒有補發或任務完成按鈕 |
| [useContactPreview](src/preview/useContactPreview.ts)、[contactFixture](src/preview/contactFixture.ts) | 只在頁面記憶中的合成結果／故障；沒有 API、worker、訂閱、儲存或外發 |

## 正式映射與狀態語義

沿 `createContactApi`、登入 cookie、`x-expected-user-id`、AbortSignal、原 S07 transport／opId。`page` 映射 page／refresh；`consent`、`authorization`、`acknowledge` 映射 ContactDecision 三個分支，必須再次經根 schema 核對。`reconcilePending`、`hasPendingOnline`、`resetOnline` 沿原控制器；本地型別不是第二份業務協定。`onSettings()` 到本人渠道設定，`onTask(id)` 接精確任務／歷史；preview 目前只到 `/settings`、`/tasks`，fixture 不跨頁同步。

- 本人同意按身份／Server／孩子管理，與全域渠道綁定、家庭角色、各任務 grant 分開。只選已綁定本人渠道，每渠道一個、最多兩種、可調次序；原 bindingId／bindingVersion 不改。撤回同意清接收次序及後備 opt-in，不刪綁定。
- 主要接收者由任務負責人決定；開啟 grant 需要 scheduled 任務及本人已同意的可用渠道。後備須與負責人不同且已同意接收／後備資格，不輸入任意地址或代人同意。
- 授權固定 `generic_notice`／`task_due`，明確未來期限、最長 365 日；可允許最多一次 follow-up、已知失敗 fallback。沒有「立即發送」、任意通知原文或 Client worker。worker 未啟用不代表已完成，也不阻止管理／撤回授權。
- 已保存 grant 的 enabled 不等於目前符合執行資格；版本改變／過期另行提示。撤回沿已保存選項及期限、目前 task／grant 版本，不要求另填新期限；不能保證召回正在投遞的通知。
- 台帳保留 pending、sending、accepted、rejected、unknown、stopped、coalesced；渠道接受不等於本人收到。普通提示合併不代表其所指的第一次投遞成功。unknown／sending 不按已知失敗切換或補發；執行規則仍由 Server 掌管。
- 只有本人未 ack 的 sending／accepted／unknown attempt 可明確確認收到；viewer 不能寫入。不改 delivery status 或 task 完成狀態，不代其他人 ack。事項完成仍在任務頁明確確認。
- tasksHaveMore／historyLimited 明示任務及最近請求的 50 項入口限制；未在有限清單不推定已刪除或授權全失效。沒有推造未讀數量／通知中心協定，不展示模型內部推理。

## 草稿、收據及正式面板差異

RHF 選項保留原同意／task／grant 版本；一般 GET 和離線不覆寫 dirty 表單，不自動換綁定、後備或期限。GET 改變版本時鎖新保存；先核對上方最新已保存狀態，再明確「保留選項並採用最新版本」、清確認後重新同意。後備失去資格／原綁定失效須明確另選；任務不在有限清單仍保留草稿快照並禁止新授權。保存一項不清其他尚未提交選項；純草稿放棄須沒有 pending 且成功讀回。

**正式 ContactPanel 在 `applyPage`（107–108）、一般 error（129–134）及離線 effect（175–182）會 clearDrafts。** 本包按使用者要求保留選項與原基準，因此主聊天整合時須局部調整正式 controller 的畫面草稿管理；不把舊 clearDrafts 直接套到新視圖。這是接線差異，不代表根 API／Server 協定改了；本聊天沒有修改該面板。身份／Server／孩子／session_changed／401／403／404 才清舊私有資料、草稿及原操作，取消並忽略晚到回應。

所有 mutation 沿原 opId；unknown／409 保留原識別、完整 body、接收者顯示快照及版本。先 reconcilePending 再 GET；GET 成功不證明原決定成功。只有仍 pending、收據未確認、成功讀回目前資料且重新明確同意，才能用同一原 input／識別重試；Server 仍會核對原版本及權限，不自動更新 body。

收據已確認但 GET 未讀回時，停止重送或新提交；只查收據／更新。原收據不覆寫較新的同意／授權狀態。查核結束且 `hasPendingOnline=false` 才解除原請求，不能因此標 saved；保留選項、核對新版本後再明確確認。已知拒絕不推論較早 unknown 已失敗。離線只保留本頁、清提交同意，回線手動更新；沒有 outbox 或重開恢復保證。

## 功能清單補缺及驗證

**2026-10-02 FE-W25 修訂及解讀更正：** 以下常駐求助卡的描述及驗證屬 FE-W17 歷史版本，現已撤去展示。使用者澄清 UI-P2-06 的「固定」指有需要時顯示統一、最權威的官方求助入口，不代表每次聊天都展示；此前常駐設計是前端誤讀，沒有取消求助功能。本人聯絡授權／任務／台帳行為不變；正式觸發及交接見 [現行聊天版面](HANDOFF.md#chat-presentation)。

最後核對 UI-P2-06 發現固定緊急入口未投影，已加 [EmergencyHelpView](src/components/agent/EmergencyHelpView.tsx)，在 `/chat` 的模型結果前及離線時均存在。正式接入根 `EMERGENCY_HELP` 常量；隔離 [顯示快照](src/preview/emergency-help-data.ts) 沿 GitHub 的 [原型別／文案](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/emergency-help.ts)／[原元件](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/EmergencyHelp.tsx)，保留其 2026-09-28 核對日期。2026-10-01 另讀兩個 [消防處頁](https://www.hkfsd.gov.hk/chi/fire_ambulance_services/responder.html)／[召喚資料](https://www.hkfsd.gov.hk/chi/fire_ambulance_services/fire_information.html)，與固定文字相符；沒有新症狀分類、模型分流或自動致電。官方頁是有真 href 的 Expo Link，鍵盤可聚焦，不是假的 link 角色。

復用現有 Paper 5.15.3、RHF 7.88／Zod 4.5、DateTimeFields／Luxon、SVG 和 OKLCH tokens；兩個渠道沿既有勾選／移動控件，沒有新排序庫、表單或通知框架。外部 Link asChild 最初未向 Pressable anchor 傳 target／rel，已按 [RN Web 官方 View](https://necolas.github.io/react-native-web/docs/view/) 的 hrefAttrs 修正；現官方頁 0.21.3，另核對本機 0.21.2 實作，沒有以文件相容冒充實測。三項契約規則已通過；四尺寸、鍵盤／期限／授權／台帳／草稿／原收據、390／320 的 150% Web 文字及固定入口檢查結果見 [本包證據](verification/fe-w17/build-checks.json)。只核對受影響畫面，沿 FE-W14 共用及後續局部證據，不聲稱重跑所有頁。

仍待使用者視覺、ContactApi／原控制器與 adapter、精確任務導航／跨頁、真 worker／通知與必要正式驗收；Android bundle 不代表 APK、系統權限、鍵盤／返回鍵／Safe Area／TalkBack 或實機通過。隔離前端範圍完成後以 [總交接](HANDOFF.md) 接續，不把產品 P2／P3 標為本聊天已完成。
