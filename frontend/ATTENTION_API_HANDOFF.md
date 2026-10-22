# 前端接口缺口：頁面提示、重要提醒與通知內容

狀態：**2026-10-21 提案／未實作，不能當成正式 wire contract 或已接線功能。**
本輪只釐清分工與驗收；沒有新增 Server endpoint、正式 mock fallback、模型呼叫或提醒資料。
正式契約定案後應落入根 `docs/API.md` 與共用 schema，本文件保留需求及差異，不另建通用框架。

## 分工與不變條件

- 前端管呈現、互動、必要表單驗證及有界 adapter；不跨頁 owner 拼湊業務計數，不自行推斷「重要／待處理／已解決」。
- 後端管業務篩選、授權、狀態、統計、來源及版本。前端提出接口需求；後端按同一契約產出，consumer／provider 測試分開定位問題。
- 共用 schema 版本、合成 fixture、錯誤語義與契約測試須先固定。前端可對獨立 mock port 驗收，不能讓 mock 在正式讀取失敗時冒充成功。
- 本次搬頁繼續復用既有 API adapter／owner，沒有把所有舊頁改造為新架構；`/profile` 基本檔案不併入成長報告。

## A．頂部頁面提示

### 目的與目前缺口

短提示例如「待辦 2」「關注 1」「記錄 3」，代表該頁**有需要處理的事**，不是該頁所有資料數；點擊須到同一批項目。
這些是需求示例，不是現有真計數或已定案的業務定義。

目前 API 分別提供 tasks／growth／concerns／care／agent pending，沒有這個聚合投影：
- tasks 的 `scheduled` 包含未到期安排，不能全算「現在需要注意」；`needs_review` 有明確狀態，但完整篩選窗口仍待產品與後端定案。
- concern 的正式狀態為 following／closed，沒有統一未讀／待處理更新標記；不可把所有 open concerns 算作提示。
- 正式 care review 由已保存資料投影，不能拿記錄總數當待核對數。Agent pending 跨多種 domain，不等於待確認 care records。
- 首頁 attention 被截至最多 6 項；來源分頁及未讀頁面不能提供精確總數。
- 現有 `/tasks`、`/growth`、`/care` 不具同一 attention selection 的詳單接口；普通 push 到頁面不等於接通相應項目。

### 待定接口形狀

提議 `GET /children/:childId/attention`；**路徑與欄位尚待後端契約核准**。最少回應：

```ts
interface AttentionProjection {
  schemaVersion: 1;
  childId: string;
  authorityVersion: string;
  asOf: string;                 // Server UTC timestamp
  selectionRevision: string;   // Opaque snapshot/filter revision, not authorization
  sections: AttentionSection[];
}
interface AttentionSection {
  key: "tasks" | "growth" | "care";
  state: "ready" | "unavailable";
  count: { value: number; accuracy: "exact" | "lower_bound" } | null;
  destination: {
    page: "tasks" | "growth" | "care";
    filter: "needs_attention";
    selectionRevision: string;
  } | null;
}
```

- 後端定義每個 section 的待處理資格、時間窗口／時區、去重單位、終態及撤權行為；目前未定，不從 open／scheduled／pending 猜出規則。
- `ready` 要有非負整數 count 及可核對 destination；`unavailable` 必須是 null count，不得填 0。缺 section、未知 schema／key、錯 child／authority 都不是空清單。
- exact 0 才可隱藏該提示；正數顯示 N，lower_bound 正數顯示 N+ 並有可讀「至少 N 項」。lower_bound 0 不可顯示成「0 項／沒有事情」，須保留未完整取得狀態。
- 前端只按固定 page/filter allowlist 映射 route，不執行任意後端 href／腳本／未支援 tab。導向仍走原 guard；不能跨 child 或繞過權限。
- 必須同時提供相同 `selectionRevision` 與 filter 的詳單讀取（獨立 endpoint 或既有分頁接口擴充均可）；回 items、cursor、complete、childId、authorityVersion、revision。不能靠前端再 filter 原普通清單湊對。
- revision 失效須用可辨識錯誤要求重讀；不靜默把舊數字配新資料。相同穩定 snapshot 的 exact count 應等於完整去重詳單；lower_bound 不冒充完整總量。

### 生命週期與驗收

1. 單例 presentation adapter 沿現有 identity／child／authority 隔離讀取；切 scope 立即遮罩舊投影，取消或拒收晚到結果。未提供 API 前不新增正式 badge。
2. loading／offline／unavailable／403／版本不支援須分開；保留快照時明示較早資料及 asOf，撤權不得保留私人內容。失敗不是 0。
3. 已確認成功操作沿既有 invalidation signal 重讀投影與詳單；saving／unknown 不樂觀扣數、不重送原操作，也不把過期數字當成功。
4. consumer tests：schema／scope 拒收、exact 0／正數／N+／null、無效 destination、URL filter／BackForward、延遲回覆、重讀錯誤、切孩子及保留 unknown。
5. provider tests：同權限範圍、資格／時區／終態、去重／分頁總集、revision 失效與撤權。整合測試須驗 badge → 指定 child/filter/revision 詳單 → 已確認處理 → 重讀收斂，不以 build 或元件 mock 當真接線通過。

## B．首頁「重要提醒」——與待辦、頁面提示分開

使用者用途：助手判斷真的重要、需要家長留意的事情，例如經核對的近期兒童流感嚴重情況。這不是一般待辦的到時提醒，也不是全部 pending 或全網新聞搬運。

目前首頁 assistant-important 投影固定 unavailable；沒有已接通的權威重要提醒列表。**未實作不等於「目前沒有重要事」**。本輪不填假提醒、不改成空成功，不新增自動搜索／生成或外發。

使用者已暫緩主動機制；本輪只記用途及缺口，不設計背景工作流、重要性門檻或生成／外發流程。
後續另定獨立資料契約，至少能區分不可用與真空結果，並呈現來源、日期、為何重要及必要行動；不能與 A 的頁面待處理數或待辦提醒混用。

## C．通知內容歷史——不是投遞診斷台帳

使用者用途：手機通知容易消失，需要回看**以前發送過甚麼內容**；可跨渠道顯示，同一通知不因渠道不同而重複。用戶端不提供「技術詳情」或嘗試開始／結束等診斷入口，維護者沿原有權限查原後端紀錄。

### 已實作的本人消息契約（待部署啟用）

- `GET /api/account/messages?cursor=&scopeVersion=`，共用 schema 為根 `src/shared/notification-messages.ts`。歷史與右上「最近消息」使用同一 `usePersonalHistory` owner／正式 client，無 production mock fallback；最近 5 則不是未讀數，不顯示未讀徽章。
- Server 只回當前本人 recipient 且仍有權讀取的帳戶／孩子消息，保存當次真正對外 payload，只有 provider accepted 的渠道出現在 `contents[]`。每個穩定 `messageId` 一列，各渠道保留自己的 title（可 null）、body、contentVersion、sentAt；不按文字／時間猜合併，不把 accepted 說成本人收到。
- 主畫面呈現內容、時間及渠道，不再呈現投遞診斷／自動重發說明；原投遞台帳及維護權限不變。不提供任意 href，也不捏造原事項連結。
- `scopeVersion` 綁身份及可讀權限變更，不隨普通消息新增失效。每頁與 refresh 都驗 scope；`asOf` 為本輪時間上界，後續游標頁保持同一值，但不是隔離 snapshot。`complete` 只表示本輪沒有下一頁；尚有游標可繼續讀，晚保存內容由整輪 refresh 補上。
- `coverage.historical=unknown`：舊消息未保存的正文不可重建；排除帳戶驗證電郵與未確認／未保存發送。UI 說明「只顯示已保存的通知內容；較早記錄可能不齊，不包括帳戶驗證電郵」。成功空、partial、loading、error、stale、unavailable 分開，不宣稱系統從未發過。
- 消息 route 的 404／501、503 `firebase_domain_not_ready`（舊部署）及 `message_history_unavailable` 明示服務未提供，不能沿通用 404 撤權邏輯清空其他本人資料；明確身份錯誤仍清全部 owner，消息權限 epoch／游標失效則清消息並重讀。
- `FIREBASE_MESSAGE_HISTORY_ENABLED` 預設關閉；部署者先完成 API／worker 兼容版本與索引，再啟用保存及讀取。本輪未部署 GCP、未實發消息，不能把 synthetic 合約驗收稱作正式 backend 已上線。

### 驗收邊界

前端 synthetic 驗內容／渠道、近期與歷史同源、分頁、靜默整輪 refresh、初次缺服務、身份／scope 晚結果拒收，以及無孩子帳戶的單一消息 owner。Server／真 handler synthetic bridge 另驗 payload 保存、recipient／孩子撤權與刪除、provider accepted、舊部署 unavailable；不使用真家庭資料、模型或渠道。

## 本輪交接狀態

A 的全域 attention 聚合仍未接 API；header 只投影既有頁面 owner 的明確操作狀態與原處理入口，不宣稱覆蓋所有待辦。B 主動機制仍暫緩。C 已有契約、provider、正式 adapter 與 synthetic 驗收，部署啟用仍待獨立 GCP 流程。
