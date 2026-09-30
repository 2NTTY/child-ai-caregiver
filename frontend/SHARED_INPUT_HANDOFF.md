# 私人來源與共享核對前端交接

更新：2026-10-01。FE-W14 基線 `c09c22b4cde784cf9f31f349b204038b063ed3d4`，沿 `codex/fe-w11-photos`／[draft PR #73](https://github.com/2NTTY/child-ai-caregiver/pull/73)，不自行 merge。源碼／驗證 commit：待本包提交。主責 B；只交付 `frontend/**` 的顯示、表單及合成操作，沒有改 Server、Agent、正式 App、共用業務型別或根文件。

## 權威來源

直接從 GitHub 核對 `ce87370b6375b25e45f016f2218d924b44f06f3c`，不是依賴主聊天是否已拉取。接線時再核對最新契約，以下固定連結保留本包依據：

- [P2 UI 清單 UI-P2-15／分享交接](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/P2_UI_HANDOFF.md#shared-input-handoff)。
- [API 主動分享輸入](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/docs/API.md#p2-shared-inputs)。
- [shared-inputs 型別及 schema](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/shared/shared-inputs.ts)、[SharedInputApi](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/shared-input-api.ts)、[正式 SharedInputPanel](https://github.com/2NTTY/child-ai-caregiver/blob/ce87370b6375b25e45f016f2218d924b44f06f3c/src/client/SharedInputPanel.tsx)。正式 Panel 目前是 Web 入口；共享手機畫面不等於原生系統分享已接通。

## 元件及預覽

`npm run web -- --port 8083`；固定 export 可按 [總交接](HANDOFF.md#預覽及驗證) 啟動。入口 `/sources`，桌面導航「私人來源」，窄屏／原生「更多」可到達。右資訊欄及底部導航沿共用外殼。

| 入口 | 責任 |
|---|---|
| [sources 路由](app/(dashboard)/sources.tsx)、[SourcesScreen](src/screens/SourcesScreen.tsx) | 薄路由／合成預覽組裝、身份／Server／孩子範圍；正式版換控制器提供資料 |
| [SourcesView](src/components/shared-inputs/SourcesView.tsx)、[shared-input-view-model](src/shared-input-view-model.ts) | 純 view model／回調；重排、清單、操作提示、刪除範圍及唯讀／離線 |
| [SourceComposer](src/components/shared-inputs/SourceComposer.tsx) | 自設私人來源、貼上、指定公開清單；RHF／Zod 原文驗證，不靜默截短 |
| [SourceDetails](src/components/shared-inputs/SourceDetails.tsx) | 原文／來源日期／取得時間、完整正文、明確取得、精確片段、模型同意與候選 |
| [SourceRecordForm](src/components/shared-inputs/SourceRecordForm.tsx) | 人工核對、參考／孩子實際記錄、預覽及分開同意；不自動採納候選 |
| [RecordDraftFields](src/components/RecordDraftFields.tsx) | 照片及來源共同使用的種類、原文、數值／單位、約數和時間原文控件；業務 schema 仍按各契約 |
| [source-form](src/components/shared-inputs/source-form.ts) | 顯示層驗證及回調投影，不是第二份 Server 協定 |
| [useSourcesPreview](src/preview/useSourcesPreview.ts)、[sourceFixture](src/preview/sourceFixture.ts) | 僅 component memory 的合成資料／故障選項；無 API、模型、網頁取得、訂閱或 browser storage |

合成工具可切換空資料、載入／讀取失敗、唯讀、容量及失去存取，另可比較 create／fetch／extract／confirm／delete 的成功、失敗、unknown、衝突及查核結果。清單中的 FHS 首頁與假 sourceId／hash 只供展示，**不是正式准許抓取的文章清單**；正式清單須由 `inputs()` 的 `sources` 提供，不從圖片或 fixture 擴大來源。

## 接線映射

所有呼叫沿原 SharedInputApi 的本人 session、`x-expected-user-id`、AbortSignal、版本及 transport。清單即使已有家庭記錄，完整來源、網址、備註及候選仍只屬建立者；不拿其他家庭成員的私人輸入填入畫面。viewer 只讀本人可見資料，寫入按 `canCreate`／`canManage` 及實際授權。

| view 回調 | 既有 API／控制器責任 |
|---|---|
| refresh／openInput | `inputs(childId, signal, userId)`／`input(childId, inputId, signal, userId)`；重新查同一輸入，清單最多 50 項不代表建立上限 |
| create | `create(childId, input, signal, userId)`；沿原 opId 收據，保存後不自動取得正文 |
| fetchContent | `fetch(input, signal, userId)`；`expectedVersion`＋`confirmFetch: true`，直接操作沒有 opId |
| extract | `extract(input, excerpt, signal, userId)`；`expectedVersion`＋`confirmModel: true`，直接操作沒有 opId；只送明確選定原文片段 |
| confirm | `confirm(input, confirmation, signal, userId)`；原 opId、`confirmShared: true`、reference／family_record 及明確孩子關係 |
| remove | `delete(input, signal, userId)`；原 opId、`expectedVersion`＋`confirmDelete: true`，清本人輸入及其連結記錄 |
| checkOriginal／retryOriginal | 沿 `reconcilePending` 查同一收據及原內容；confirmed-but-unread 必須採正式 Panel 的 GET／結束分支，不再次 replay |
| retryDirect／endDirect／useLatest | 沿正式 Panel 對原版本／片段及 GET 結果的判斷；不可接成新的通用重試器 |

## 須保留的語義

- 自設來源需名稱及網址／原文至少一項；貼上需非空原文。名稱最多 200、HTTPS 網址 1,000、來源日期原文 200、備註 1,000、原文 10,000 字；不含帳密網址。原空白、日期說法、數字和不確定內容保留，超限報錯不截短。指定公開來源只送 sourceId，不把隱藏私人草稿送入請求。
- 「連結已保存」不等於「正文已取得」。私人自設來源補正文會建立另一項輸入，原項保留；不是更新或訂閱。只有使用者明確同意，Server 才按已准許的 URL 取得公開 HTML；此 UI 不在瀏覽器抓網站、不帶 cookie／登入或讀付費內容。Server 的 20 秒、1 MiB、兩次同主機 HTTPS redirect、公共 IPv4 及最多 64,000 字正文限制仍由原實作掌管。
- 來源日期原文、保存時間和取得時間分開；不以 `createdAt`／`retrievedAt` 冒充發布日期。正文大於 10,000 字時提取欄留空，由使用者選擇**與保存正文完全相同且連續**的片段；不自動取頭段或省略內容。只准原受限提取流程，不能由輸入直接建立任務或外發。
- 候選保持私人、完整內容和 uncertainties。按「帶入核對」後不確定說明仍留在草稿及共享預覽旁；人工編輯不自動變成家庭事實。預設 reference 只存備註，kind=note、quantity=null、事件時間未知；family_record 才顯示數字／約數／時間原文，先確認與目前孩子有關，再同意家庭共享。關係／用途／原文改動後須重新核對，同意不能沿用。
- 家庭共享只包含核對的記錄正文和來源名稱；完整輸入、私人備註、網址／來源日期及候選不附帶共享。provenance 的 inputId／hash／種類／保存時間／來源由 Server 注入，不能取 fixture 冒充。每項只能確認一次；日後更正走照顧記錄 API。
- 刪除需兩次明確範圍確認：本人這項私人輸入和連結照顧記錄，不刪其他照片、來源或整位孩子。`onRecord(recordId)` 預留開精確記錄；目前 preview 只到 `/care`，兩頁 fixture 不同步，正式版須按原 id 讀取。

## unknown、版本與清理

create／confirm／delete 的 unknown 保留原 payload 及 opId 並鎖定，先查原收據；只有已查核但未確認時，使用者才可明確重試**同一**內容／參考。收據已確認但回應不能解析／結果仍不可讀時，不能重送；先 GET 清單，再明確結束本次操作及清草稿，不靠原文／hash 猜測。已查明結果為 null（刪除／不可讀）的已確認終態另行清理，不當作未保存。

fetch／extract 沒有收據，unknown 保留原 basisVersion／原片段，先 GET 同一輸入。ready／available／failed 可結束原次查核；running／unknown／not_requested 不自動重送。查核後重新明確同意「查回原次」時沿原版本／片段，不變成新處理。新提取／取得只按原契約允許的 not_requested／failed；未知結果不當失敗。已查核且非 running 的提取可人工核對記錄；沒有正文的連結不能共享空內容。

409 保留原文和手動草稿，先 GET，再明確使用目前版本及重置所有同意；片段不再與正文完全相符便清片段。身份／Server／孩子切換、401／403／404／session_changed 清私人原文、候選、未送草稿及舊操作，取消請求並忽略舊回應。一般離線只保留目前記憶中的草稿，不排 outbox；回線後手動重讀。本人可見但不能管理時保留唯讀展示，不推測撤權範圍。

## 證據與待接線

typecheck、四項來源 schema／投影及三項共用照片規則檢查通過；Web 27 個靜態路由、Android Hermes／31 項資產 export 通過。共用 AppTextField 以 Paper 5.x 公開 `contentStyle` 留出浮動標籤空間，保留字體伸縮；48 個四尺寸重排及來源關鍵合成流程、390／320 的 150% Web 文字檢查通過。完整輸出、測試 bundle、檔案 hash 和重用範圍見 [build-checks](verification/fe-w14/build-checks.json)。

仍待使用者視覺確認、正式 UI／API／跨頁接線，以及原生選圖／OS share、APK、鍵盤／返回鍵／Safe Area／TalkBack／系統大字體和真機驗收。沒有真 Server、來源抓取、模型或外發成本；手機 Web 截圖及 bundle 不冒充原生驗收。成長關注、到診摘要及主動聯絡另包接續，本包不把整套前端標完成。
