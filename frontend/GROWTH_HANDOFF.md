# 成長階段關注前端交接

更新：2026-10-01。FE-W15 基線 `3e153a7c5f8682429e380d6e8816ae5be128175d`，沿 `codex/fe-w11-photos`／[draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)；源碼／驗證 commit：待本包提交。主責 B，只修改 `frontend/**`，沒有改 Server、Agent、正式 App、根文件或業務規則。使用者視覺及真接線由原責任方驗收，不自行 merge。

## 已核對依據

直接讀 GitHub master `ce87370b6375b25e45f016f2218d924b44f06f3c`：[UI-P2-07／S13-W08 交接](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md#growth-ui-handoff)、[HTTP 契約](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/API.md#growth-attention-http)、[growth 型別](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/growth.ts)、[GrowthApi](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/growth-api.ts)、[正式 GrowthPanel](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/GrowthPanel.tsx)。接線時再核對受影響契約；不因主聊天 checkout 未拉取便推造功能或重寫後端。

## 前端入口

`npm run web -- --port 8083`，入口 `/growth`；固定輸出預覽方法沿 [總交接](HANDOFF.md#預覽及驗證)。桌面導航「成長關注」，窄屏及原生「更多」可到達；四個原生底部 Tabs 保留。手機 Web 與 Android 使用同一功能元件。

| 檔案 | 責任 |
|---|---|
| [growth 路由](app/(dashboard)/growth.tsx)、[GrowthScreen](src/screens/GrowthScreen.tsx) | 薄路由、合成情境及身份／Server／孩子範圍；正式版替換資料提供者 |
| [GrowthView](src/components/growth/GrowthView.tsx)、[growth-view-model](src/growth-view-model.ts) | 純顯示模型／操作回調、狀態與清單；dataLabel 由 adapter 提供，無須保留預覽字句 |
| [GrowthAttentionCard](src/components/growth/GrowthAttentionCard.tsx) | 理由／限制／狀態、完整來源與依據快照、接受／暫緩／關閉、任務另行同意 |
| [GrowthTopicCard](src/components/growth/GrowthTopicCard.tsx) | 四主題及 API 有限近況選項、共享核對、停用／重新啟用；表單草稿保留原基準 |
| [growth-form](src/components/growth/growth-form.ts) | RHF／Zod 顯示層驗證及回調投影；新任務復用既有 taskFormSchema／時間控件 |
| [useGrowthPreview](src/preview/useGrowthPreview.ts)、[growthFixture](src/preview/growthFixture.ts) | component memory 的合成操作、故障和來源示例，不跑規則、worker／Agent、保存或外發 |

固定四個 topicId 沿原型別；實際標題、近況選項、適用性、來源及依據由 `GrowthPage` 提供。fixture 的選項、來源片段／hash／ID 均屬合成，不是正式規則或官方文章，不可發到 API，也不表示已驗四年齡段的評估。來源連結只允許無帳密 HTTPS；實際開啟是使用者明確操作。

## 回調映射及操作語義

沿原 `createGrowthApi`、登入 cookie、`x-expected-user-id`、AbortSignal 和 online refresh。正式 API `getPage`／`decideAttention`／`updateTopic` 分別接 `refresh`／`decide`／`updateTopic`；本地 `GrowthDecision`／`GrowthTopicDecision` 只屬顯示投影，正式請求須用根目錄 schema 再核對。

- 頁面資料供獲授權家庭成員查看；owner／caregiver 可管理，viewer 唯讀。來源理由不能洩漏私人資料；權限、`canManage`、成員授權／storage epoch 及 `authorityVersion` 由 Server 判定。
- 每項顯示「為何現在」、觀察／安排／諮詢、適用限制、sourceAvailable、狀態、版本／時間、basis／已確認資料、來源片段／版本／hash／核對時間、previousId 和新提示原因。不可用代表來源或適用依據失效，不必然是網站下架；舊建議不當現行內容，不准接受／暫緩，仍保留追溯和真正任務狀態。
- 接受預設只記錄知悉，沒有任務、預約、外發或完成。明確選新任務後核對原標題／內容、種類、目前合資格負責人、日期／時間／IANA 時區，再另行同意家庭共享。標題 160、內容 2,000 字，不靜默截短。時間沿共用 Paper Dates／Luxon，原文和 offset 保留。
- 已有同階段連結的待處理／待覆核任務時，先到任務區核對，不在關注入口另建；來源變化不等於任務取消。已完成／取消仍顯示實際狀態。`onTask(taskId)` 預留精確查找；目前 preview 只到 `/tasks`，兩頁 fixture 不同步。API 支援連接指定版本既有任務，但正式 Panel 目前只露出知悉／新建；本包沿原 Panel，不造一個靠標題猜測的任務選單。
- 暫緩需明確將來時刻；到期處理由原 Server 規則掌管，此預覽不自動復活或另建任務。關閉備註最多 1,000 字，相同階段／同依據的舊終態保持；新提示必須另列理由及前次關係。
- 四主題永久停用和重新啟用各需明確勾選；重新啟用只恢復未來適用性評估，不復活舊關閉記錄、不取消連結任務。
- 近況不預填否定；只有明確選的 API 有限選項才送出，未選保留原狀。共享同意獨立且選項改動後清除；`expectedFacts` 凍結**原主題全部** fact refs，去重並核對版本，不只包含被選的欄位。衝突或失效到記憶區覆核，這裏不覆蓋它。成功交易／更正歷史仍由原 API 保存。

RHF 會把名稱中的點解析成路徑。動態有限選項採穩定本地欄位名，再映回原 API key，避免改變 keys；不引入新的表單框架。本機 7.88.0 的公開 `set()` 行為已實際核對，既有 [表單 Skill](.agents/skills/web-screen-delivery/references/forms-controls.md) 及研究沿用。本次官方頁讀取受 403／cache miss 影響，沒有把未取得文件寫成已重新核對。

## 原操作、版本與清理

成長操作**沒有 opId 收據**；原版本＋相同 actor／完整 body 的最後一次成功結果由原 API 查回。unknown 凍結原對象、完整正文、`expectedVersion`／`authorityVersion`、fact refs 及原顯示名稱；停止所有新變更。先 GET；原對象在最新頁面才能重新明確同意查回同一份原請求，即使目前來源／狀態已改變，也不能把原基準默換成新操作。沒有找到對象時仍保留原操作及鎖定，不用相似文字猜測成功。

原 API 的明確 4xx 拒絕先停止重試；GET 後要求重新核對，不能用這次拒絕判定較早 unknown 成敗。表單第一次改動時捕捉項目／主題／授權／fact 基準，重讀保留草稿及同意；基準改變便停止該表單。放棄草稿須二次明確操作並重讀；這只清表單，**不清除 unknown 的原請求**。dirty 對象從最新頁面缺席時保留舊資料及草稿、停止相關新操作；原生／正式版沿原 ambient refresh 的延後及合併規則。

401／403／404、session_changed、帳號／Server／孩子切換清舊資料、草稿、原操作及計時回應；真 transport 要取消並忽略晚到結果。一般離線保留本頁草稿、禁提交／無 outbox，回線後依正式 refresh 控制器核對；preview 用明確手動重讀。撤權不拿 fixture 的角色當證據。

## 已驗及待驗

typecheck、三項規則／原文／有限選項／版本及時間檢查、Web 29 靜態路由和 Android Hermes／31 資產 export 通過。1440／1024／390／320 的成長頁／導航及關鍵合成流程、390／320 的 150% Web 文字／浮動標籤／共用表單重排通過，沒有 pageerror、console.error 或 /api/ 請求；[證據及 bundle](verification/fe-w15/build-checks.json)。共用配色／控件未改，沿 FE-W14 及更早未變證據，沒有機械重跑其他業務套件。

仍待使用者視覺確認、正式 API／控制器／refresh／任務及記憶精確導航／首頁投影與跨頁同步；規則、抑制、真背景及四年齡段產品驗收沿主聊天已有證據，不由此預覽重做或冒充。Android 只是共用 UI 匯出，APK、系統字體、鍵盤／返回鍵／TalkBack／Safe Area 和真機待驗。到診摘要與主動聯絡另包接續，整套前端仍未結案。
