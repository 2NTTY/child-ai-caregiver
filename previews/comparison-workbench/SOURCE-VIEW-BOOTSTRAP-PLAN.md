# Original 與 Harbour 待辦原生畫面啟動實作計劃

**狀態：待審核的實作計劃，尚未接入執行環境。**

本計劃補齊 Original 與 Harbour 凍結原始碼讀取同一個 normal Tasks 合成案例時，需要的啟動資料與有限請求處理。沿用各版本原生 ProductionOwner、Tasks owner 與既有資料投影，不另建 shell，不以混合待辦頁代替完整版本畫面。

目標是讓後續測試能驗證登入投影、帳戶閘門、孩子作用域、檔案及待辦讀取互相一致。這不是完整畫面、可操作寫入或瀏覽器驗收完成的宣告。

## 固定來源與範圍

| 輸入 | 固定身份 |
| --- | --- |
| Original | composite source tree `de0cbacb583c923fba8f88f27fd5f6b8d5409c1c`，不是另造的 commit |
| Original 組裝配方 | SHA-256 `e49b453d98d3bcb34ea51bb67d068078d90e9c50c8862ae70b81f3bbe237074b` |
| Harbour | commit `4050c0a16d0a9735923434abc9749ecd416d7926`；tree `fcc2393ea5f6bf6963fbf9b281f24bd02de76ea2` |
| normal Tasks fixture | SHA-256 `d108aca1f8248e76e28ce4ab5c3497005cff5f1e6f15f2d23081b8d32bd2d5e4` |

重用 Workbench source package 的 `src/normal-tasks-read-binding.mjs`、`sources/normal-tasks-read-bindings.json` 與 `docs/NORMAL-SOURCE-PAIR.md`。保留六筆 task、所有值與歷史、原有 17-ID UUID 對照，以及案例時鐘 `2026-10-04T16:00:00+08:00`。不匯入 legacy ready 或舊公開預覽的帳戶與資料。

本計劃只涵蓋 Original 與 Harbour 的 Tasks 讀取前置條件。其他三版本及其他語義頁面仍須獨立綁定。既有 semantic navigation adapter、比較 shell、混合 Tasks 單一 owner，以及另行處理的四處 read-clock overlay 均不在此重做。

## 明示新增的合成資料

另建 `normal-tasks-synthetic-bootstrap-v1` extension，引用上述 fixture SHA，不修改原 JSON。下列新增欄位不得宣稱是原案例既有資料。

本文使用以下代號：

| 代號 | 值 |
| --- | --- |
| `U` | `preview-owner` |
| `C` | `c0b00000-0000-4000-8000-000000000001`，沿用既有 child 投影 |
| `W` | `c0b00000-0000-4000-8000-000000000012`，新增合成 workspace |
| `E` | `c0b00000-0000-4000-8000-000000000013`，新增合成唯讀 epoch |
| `A` | `2026-10-04T16:00:00+08:00`，案例時鐘 |
| `T` | 既有投影中的六個 native task IDs 之一 |

### Session 與孩子

- Session：`{user:{id:U,name:"媽媽",email:"preview-owner@example.invalid"}}`。姓名與 actor 重用原合成案例；保留網域 email 是明示新增值。不建立 token、cookie、真實帳戶或登入憑證。
- Children：`{children:[{id:C,workspaceId:W,displayName:"小晴",createdAt:"2026-10-02T08:30:00+08:00",accessRole:"owner"}],nextCursor:null}`。
- `child.createdAt` 固定為最早 canonical task.createdAt。只有一名孩子，不新增選擇狀態儲存或虛構家庭成員。

### 帳戶服務

使用原生已有的 disabled account service 狀態，不捏造 email 驗證或真人同意：

```json
{
  "enabled": false,
  "registration": "trial",
  "mailConfigured": false,
  "policyVersion": "2026-10-08",
  "notice": "合成示例：帳戶驗證、寄信及帳戶退出操作未接入。",
  "user": {
    "id": "preview-owner",
    "emailVerified": false,
    "acknowledged": false,
    "acknowledgementVersion": null
  }
}
```

`user.id` 必須與 session 相同；即使 `enabled:false`，也不能返回 `user:null`。不使用 legacyTrial 的 404 fallback。此資料只供封閉合成測試，不能用來修改或繞過產品驗證規則。

### 孩子檔案

原 fixture 的「3 歲」沒有出生日期或年齡基準，不能反推出生日。採用明示的 approximate 3-years profile：

```json
{
  "profile": {
    "childId": "c0b00000-0000-4000-8000-000000000001",
    "version": 1,
    "data": {
      "age": {"kind":"approximate","rawValue":"3","unit":"years","asOf":"2026-10-04"},
      "dueDate": null,
      "gestationalWeeksRaw": null,
      "region": "香港",
      "language": null,
      "allergies": null,
      "specialNeeds": null,
      "preferences": null,
      "source": "normal Tasks 合成 bootstrap",
      "validUntil": null
    },
    "confirmedBy": "preview-owner",
    "confirmedAt": "2026-10-04T16:00:00+08:00",
    "reason": "合成示例確認標記，並非真人確認"
  }
}
```

**顯示差異必須保留說明：**原生格式會顯示「約 3 歲（截至 2026-10-04）」，不是 canonical display text「3 歲」。這是保留原 Tasks 資料並補充明示合成 metadata 的 extension，不能宣稱整份案例及畫面文字完全未變。不能以 `data:null` 抹掉已知年齡、地區與已確認狀態來避開此差異。

### 唯讀零變更 snapshot

固定 `W`、`E`、`cursor:"0"`、`accessVersion:1`、`changes:[]`、`hasMore:false`。這只表示此合成靜態案例沒有變更，不代表 live sync、寫入收據、操作核對或真後端可用。

原生 online observer 首次讀到此 snapshot 時會觸發一次 changed refresh；之後相同檢查不應持續刷新。不可用空 workspace 清單取代已綁定的 `W`。若這兩項讀取失敗，observer 會約每 5 秒觸發 refresh，不能把這種狀態當成穩定啟動。

## 有限成功請求

下列路徑均加上 `/api` 前綴。只對固定來源、normal fixture、`U` 與 `C` 回應 HTTP 200，且不接受未列出的 query。本文的 expected-user header 指 `x-expected-user-id`。

| 方法與路徑 | 明確回應 | 使用時機 |
| --- | --- | --- |
| GET `/auth/get-session` | 上述 session | 啟動及各 owner 重複身份核對 |
| GET `/account` | 上述帳戶服務資料 | 帳戶閘門；已帶 expected-user header 時必須等於 `U` |
| GET `/children` | 上述單一孩子清單 | 選定有效 child scope；終止游標為 null |
| GET `/children/C/profile` | 上述 profile envelope | Tasks shell 首屏必要讀取 |
| GET `/children/C/tasks` | 既有 `binding.native.page` | 六筆完整列表；不帶 `afterId` |
| GET `/children/C/tasks/T` | `{task: matchingNativeTask}` | 已綁六個 ID 的按需 detail 讀取 |
| GET `/children/C/tasks/T/history` | `binding.native.histories[T]` | 按需歷史；不帶 `beforeVersion` |
| GET `/online/spaces` | `{workspaces:[{id:W,storageEpoch:E}]}` | 靜態唯讀 metadata |
| GET `/online/changes?workspaceId=W&storageEpoch=E&cursor=0` | `{workspaceId:W,storageEpoch:E,cursor:"0",accessVersion:1,changes:[],hasMore:false}` | 同一 metadata snapshot |

帳戶 status 初次未帶 expected-user header 時，仍只能取得同一合成帳戶。Native 已載入列表內的 task selection 可以直接重用原 owner 資料，不必強迫多發一次 detail GET。

`frontend/src/startup/dataReadiness.ts` 與 `frontend/src/production/ProductionStartupReadiness.tsx` 要求 `/tasks` 的 **profile 與 tasks** 均 ready；只有 task page 成功不足以完成首屏。

## 明確保持不可用的請求

以下背景 owners 會在 Tasks 路由仍然啟動，但沒有本案例資料可綁。對列出的正常首次讀取返回 HTTP **503** 與 `{"error":{"code":"preview_domain_unbound"}}`，不要偽造空成功。未列出的 query、游標或操作仍本地拒絕。

| 原生讀取 | 範圍 |
| --- | --- |
| POST `/children/C/care/search`，body `{query:""}` | 這是首次唯讀搜尋，不是允許其他 POST 寫入 |
| GET `/children/C/messages`、`/ai/status`、`/ai/usage` | 聊天與模型 metadata |
| GET `/children/C/summary` | 首次 query：有效 `YYYY-MM-DD` 的 `startDay`、`period=week`、`timeZone=Asia/Hong_Kong`；日期仍由原生 caller 提供，不偽造摘要內容 |
| GET `/children/C/memory/facts`、`/children/C/memory/topics`、`/children/C/memory/summary` | 記憶 |
| GET `/children/C/growth`、`/children/C/concerns` | 成長與關注 |
| GET `/children/C/documents?status=active&limit=20` | 文件首次頁 |
| GET `/children/C/agent/work`、`/children/C/library` | 個人歷史背景讀取 |
| GET `/children/C/photos`、`/children/C/inputs` | 相片與來源輸入 |
| GET `/ai/settings`、`/web-push`、`/telegram`、`/notification-preferences` | 設定與通知 |
| GET `/children/C/contact` | 聯絡資料 |

另有兩組按需 unavailable 回應，不列為 Tasks 首次必要條件：

- GET `/account/messages`：HTTP 503，code `message_history_unavailable`，使用原生通知歷史的專門 unavailable 分支。
- GET `/me/avatar`、`/children/C/avatar`：HTTP 503，code `avatar_unavailable`。

其他 agent pending、history、run、model catalog、family 或 admin 操作不新增成功資料。這一階段不支援離開 Tasks 後的全站操作；未知請求本地拒絕而不外送。

### 不能使用的通用錯誤

- `task-knowledge-runtime.ts` 將 **401、403、404** 視為存取權失效；不可用作背景服務未綁定的通用回應。
- `CareReadCoordinator.ts` 的 child-scoped 404、Photos／sources 的 401／403／404，以及 ChatController 的孩子存取錯誤，都可能清除或拒絕有效 child scope。
- ProductionOwner 可因 `session_changed`、`unauthorized` 重讀 session，或因 `access_denied` 拒絕孩子。ProductAgentOwner 亦將 `not_found` 視為 access loss。
- Task detail 的 404 雖有專用分支，仍會清除列表並進入錯誤，不是正常 unavailable。
- Session 與必要 bootstrap reads 不得套用上述背景 503；它們失敗就不能宣稱 Tasks ready。

部分 parser 不保留自訂 error code，因此必須測試實際 caller，不能只檢查 JSON 字串。測試也不得吞掉真正的安全錯誤來維持假 ready。

## 拒絕規則與外網隔離

有限 matcher 必須逐項核對來源 pin、fixture、method、origin、path、query 與身份。以下全部本地拒絕並留下合成測試診斷，不能轉送原 fetch：

- 非 Original／Harbour、非 normal scenario、過期或不匹配的來源及 fixture hash。
- 未知 child、workspace、epoch、task ID，或不匹配的 expected-user header。
- 未列出、重複或格式不符的 query key；任何 task/history/children pagination query（包括空值）；非指定的 online cursor。
- 未列出的方法與 body、任何外部 origin、非 allowlist 的 API 或非 API fetch。
- 所有 mutations，包括建立、修改、完成、取消、確認、上傳、投遞、身份驗證，以及 online 操作提交與核對。

不按標題找替代 task，不回退第一筆、不借用 legacy fixture、不返回通用空 200。既有原生操作按鈕即使仍可見，也不能因此宣稱寫入可用；寫入互動不在本階段驗收範圍。

### Account 的 global fetch 旁路

`frontend/src/production/AccountServiceOwner.ts` 在未注入 API 時呼叫 `createAccountApi(baseUrl, fetch, ...)`；no-Firebase 分支不會自動沿用 `ProductionOwner.fetcher`。

因此 native owner 測試必須同時注入 closed `transport.fetcher`，及 `accountDependencies.api = createAccountApi(baseUrl, closedFetcher)`。不啟用 legacyTrial、Firebase 或真實 authentication；其他 auth 呼叫必須拒絕。測試另設 global-fetch spy，證明沒有漏出封閉邊界的請求。

未來 recipe 若採用入口前安裝 closed global fetch 的既有方式，必須在 provider 與 account 建立前完成，且不可保留外網 fallback。這項實際入口整合及其 artifact 需另行驗證，本計劃不宣稱已接上。

## 實作與驗證順序

交付單位限於一份 bootstrap extension、一個重用既有 normal read binding 的有限 matcher，以及原生 parser／owner 測試。不新增通用 API 模擬框架、shell 或 state owner。

**分階段依賴閘門：** 原生 parser 測試可先進行；`ProductionOwner` 靜態匯入 `firebase-auth-api.ts`，後者再匯入 `firebase/app`／`firebase/auth`，因此實際 Owner class 的載入及測試仍暫停，須先完成精確的 dependency-only closure，確認無 SDK 初始化或網絡行為，且不得使用 SDK mock 或匯入替換。

- [ ] **封存 extension。** 驗證 fixture hash、既有 17-ID 對照不變；新增欄位僅來自本計劃，包含 approximate profile 與零變更 snapshot。加入來源或 fixture 不符的拒絕測試。
- [ ] **先寫有限矩陣的失敗測試，再實作 matcher。** 覆蓋每個成功 envelope、每組 unavailable 回應及所有拒絕規則；確認沒有外網 fallback、通用空成功或 mutation success。
- [ ] **以兩側真實 native parsers 驗證。** 使用 `createRecordsApi`、`createAccountApi`、`createCareApi`、`createTaskApi` 解析資料；六筆 task、detail 與 history 必須與原投影逐欄一致。
- [ ] **測試真 ProductionOwner。** 依序驗證 session、matching account ready、單一孩子選定及穩定 scope；同時封閉 owner 與 account 兩個 transport 入口。不得用 fake Owner 的 ready snapshot 取代。
- [ ] **測試 caller 特有失敗與取消。** 各背景 503 不得觸發 restoreSession／denySelectedChild；profile 成功與 care-search 503 可並存。相反地，真正的身份不匹配及 401／403／404 仍應保留原生安全失效行為。Abort、dispose、身份變更後不得發布晚到資料。
- [ ] **測試 observer 的有限刷新。** 初次 snapshot 觸發一次 changed refresh；後續相同檢查不產生持續 refresh。錯誤 epoch、cursor 及其他 query 不取得假成功。
- [ ] **獨立審核差異與結果。** 確認未改凍結來源身份、canonical fixture、Tasks 單一 owner、既有 shell 或其他工作；結果只標記為 native read bootstrap compatibility。

沿用專案的 `node:test` 測試方式，參考 `tests/tasks-client.test.ts`、`tests/care-client.test.ts`、`tests/record-api.test.ts`、`tests/chat-client.test.ts`，以及 `frontend/scripts/startup-readiness.test.mjs`、`frontend/scripts/visible-startup-readiness.test.mjs`。不新增依賴、不為此啟動 app、瀏覽器、後端或模型。

原生 parser 與 ProductionOwner class 的測試通過，仍不能證明 React Tasks hook 已掛載並完成首屏。真 hook／provider、完整 sourceframe、兩側相同 CSS viewport、共享 fixture 與瀏覽器互動，都屬後續獨立驗收。

## 完成邊界

本階段不包含任何資料寫入、live sync、真實認證、帳戶權限變更、模型請求、完整 frames、發布或瀏覽器 readiness。相關能力標記不得因 source tests 通過而升為可用。

此方案已明確選擇 approximate profile、disabled account service、單一孩子／workspace 與合成唯讀 epoch，不需要真實家庭資料或使用者重新選擇設計。下一步是審核這份有限 extension 與測試邊界，再實作；本文件本身不是接受、整合或執行成功的證據。
