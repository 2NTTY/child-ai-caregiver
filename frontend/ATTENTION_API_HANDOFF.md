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

### 目前 API 缺口

- `src/production/usePersonalHistory.ts` 讀 account export 的 `notification_deliveries`；`src/history-view-model.ts` 只投影渠道、結果及時間。
- 根 `server/account-data.ts` 與 `server/firestore-notification-history.ts` 的對應匯出只有 delivery／attempt metadata，沒有通知標題、正文或跨渠道的 logical notification ID。
- delivery ID／contact request ID 不等於跨渠道通知 ID；前端不能按相同標題、時間或不同渠道猜去重，亦不能從目前待辦／助手文字拼造過去已發送的內容。
- 本輪只移除用戶端技術時間與重複說明，保留正常時間、渠道真結果及部分載入狀態；**尚未交付內容收件箱**，沒有刪後端紀錄或新增維護者權限。

### 供分工確認的最少接口需求（尚未實作）

1. 專用本人通知內容讀取接口；回 schemaVersion、本人 scope／authorityVersion、asOf、items、cursor、complete 及可辨識 error／unavailable。現有通知歷史涵蓋本人帳戶及其他孩子，不能誤宣稱只屬目前孩子；每項須有明確 scope 與可讀的孩子／帳戶歸屬。
2. 每項有後端穩定 `notificationId`／contentVersion、實際發送時保存的 title、摘要／正文或具名 detail endpoint、正常通知時間，及同一邏輯通知的渠道摘要。無可讀正文／舊資料不齊需明示，不能用空字串假完整。
3. 與原事項關聯使用語義 destination＋受權 resource ID，不回任意可執行 href。對象已刪除、撤權或不再可讀時不洩露內容／連結；沿原 guard 與 child 邊界。
4. Backend 決定跨渠道分組、內容版本、分頁排序／去重、內容保留及授權。前端只呈現已保存內容；`accepted` 不代表本人已收到，unknown 不改成 failed，不自行重發或修改渠道授權。此需求未授權新增敏感正文保存政策，須由後端另行確認。
5. consumer 驗收：相同 notificationId 多渠道只一列、不同 ID 相同標題不合併、展開真正文／原事項、錯 scope／晚結果拒收、partial／error／舊資料缺正文如實。provider 驗收：內容與發送版本一致、權限／撤回／保留政策、跨渠道唯一性、穩定分頁及失效游標。
6. 沒有 provider 前只可用獨立契約 fixture 驗展示，不掛 production mock fallback；目前本提案連共用 schema／正式 adapter 也未實作，不能以現有 metadata UI 或 build 代替端到端驗收。

## 本輪交接狀態

A、B、C 都未接通新 API；A／C 的業務定義、共用 schema、Server provider、正式 adapter 及端到端驗收待分工確認，B 主動機制依使用者要求暫緩。
頁面精簡、搬頁、登入、intro 與純讀 guard 修補可獨立驗收，不以未完成接口承諾掩蓋其待辦。
