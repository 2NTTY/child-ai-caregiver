# 育伴港：程式內硬限制唯讀盤點

**範圍與基線**：`2NTTY/child-ai-caregiver`，GitHub `master` **`9d319a079c03e3d3c6700bad37832c8de88a745e`**，2026-10-21 UTC 唯讀檢視。這是調查報告，不是 PLAN／SPEC／契約修改，也沒有批准任何調大限制。

## 結論先行

**有，而且不是只得管理員畫面那幾個值。** 限制散在共享常數、schema、模型 gateway、各能力 claim／lease、Firestore 查詢及儲存、檔案解析、前端、傳輸與部署配置。單改一個設定或環境變數，通常不會解開整條路徑。

優先值得處理的不是「全部刪上限」，而是以下交界：

1. **模型輸出實際仍被壓到 1,024 tokens**，即使環境配置可接受 4,096；另有每次請求文字、最近歷史、工具回傳、回答 schema 等限制。
2. **每輪 300 秒不是所有能力的有效時間**：照片／來源摘錄 95 秒 claim、語音轉錄 90 秒、正式背景執行器外層 95 秒及工作投遞 120 秒，各自更早生效。
3. **長來源有一串互相獨立的產品容量牆**：知識 PDF 每批最多 8 頁／每頁 32,000 字元；現有英文餵食手冊 watch 更只登記第 3 頁；每版最多 32 chunks、每 chunk 原文 4,000 字元。這些不是 Gemini 的官方 context 極限。
4. **日常資料規模到某點會明確拒絕，不只是換下一頁**：50 份 active 文件、50 項本人／孩子私人來源、200 項關注、約 500 項成長關注歷史；照護摘要讀取逾 2,000 筆記錄、區間選中逾 200 筆亦拒。
5. **通知前端存在具體不同步**：Server／共享型別支援 `native_push` 及最多 3 渠道；`contact-form.ts` 仍只接受 Web Push／Telegram、最多 2。FCM 選項可呈現，但表單有效性可阻止保存。這是靜態確認的交界，未做 UI 重現。
6. **媒體與傳輸另有產品容量及併發牆**：照片 4 MiB、語音 5 MiB／120 秒、一般附件 20 MiB、每訊息單件；大型 body 同時最多 2 個、語音解析同時最多 2 個。模型設定不會放寬它們。
7. **備份／還原工具也有限額**：受控快照最多 2,000 文件／32 MiB；原生 export 檢查最多 256 物件／256 MiB。不是 Firestore 全平台容量。
8. **有些數字是安全／一致性或分頁協議，不應當作效能障礙一律調高**：身份／scope／原 opId、撤權、hash、明示確認、未知副作用不盲重試、SSRF 邊界、拆批 cursor、版本上限等必須保留其目的。

## 怎樣讀這份表

- 類別 **①** 模型／計量／財務保護；**②** timeout／retry／lease／併發；**③** context／output／retrieval／batch／page／payload／media；**④** UI／schema／配置 clamp；**⑤** 安全、權限、一致性及產品語義邊界；**⑥** 供應商／協議限制與產品保守值的區分。
- **R**：現行 Firebase／Firestore 正式 runtime 可達；**L**：本地／operator 工具；**H**：舊 SQL／歷史／驗收專用，不當正式有效值；**U**：前端。
- 「硬值」=本層沒有管理員／個人設定入口；通常須改源碼並檢查整條契約。「可設」不等於可無上限；要看後面的 clamp／舊資料相容及持久政策。
- 字元、Unicode code points、UTF-16 `.length`、UTF-8 bytes、token、MiB 並不等價；本報告在影響判斷處特別標明。
- 以下 `file:line` 均對上述固定 SHA，可用[固定版本源碼](https://github.com/2NTTY/child-ai-caregiver/tree/9d319a079c03e3d3c6700bad37832c8de88a745e)核對。

## A. 模型、配額、context、輸出及角色預算

相關 AI 預算已核對；本節證據與其餘全項目掃描採用同一 master 基線。

| #／類別／路徑 | 預設、硬頂與實際先後次序 | 可編輯面／用戶影響 |
|---|---|---|
| A01 ①④ R `src/shared/agent-run-limits.ts:1–9` | 每輪 model calls **8／max12**；tools **16／max16**；query embeddings **4／max6**；run **300／max300 秒**；request **90／max180 秒**；額外 retries **3／max3**。 | 管理員及個人值只能在共享 range 內；不是各角色獨立免費額度。 |
| A02 ①④ R `server/firestore-admin.ts:17–25`; `src/shared/admin.ts:21–27` | **已保存 admin policy 優先** env／bootstrap；舊 policy 缺新欄位時相容補成 request30秒／retry0／run90秒，不能假設自動變新預設。 | 調 `.env` 未必改現場有效政策；要讀 policy 版本及 effective 值。 |
| A03 ①④ R `server/personal-model-policy.ts:5–21`; `server/firestore-model-routing.ts:87–105` | v2 個人六項採 `min(personal, admin)`；舊 personal model/query 有相容例外。個人 daily 不直接 min 平台 user daily，另受 personal-global。 | 個人畫面提高值仍可被管理員壓低；需區分原個人記錄版本。 |
| A04 ①④ R `server/ai-config.ts:97–106`; `src/shared/model-settings.ts:8–15`; `server/firestore-ai-usage.ts:19,84,144–145` | env user daily20/max1000；global100/max10000；personal-global1000/max10000；personal daily100/max1000。生成與 embedding 共用計次、UTC 日界、已預留不退款。 | **不是貨幣預算**；不能把「200次」說成「$200」。現場 saved daily 未讀。 |
| A05 ①③④ R `server/agent-model-gateway.ts:62,200,242–243`; `server/gemini-key-provider.ts:91,117`; `server/agent-budget.ts:8–22` | env output1024/max4096，但兩 provider 最後仍 `min(config.maxOutputTokens, 1024)`；非 STOP（含 MAX_TOKENS）判 invalid_response。 | 只改 env 到4096無效；長結構化答覆可能直接失敗，而非交出半份成功結果。 |
| A06 ①② R `server/agent-model-gateway.ts:189–218,278–283` | 額外重試只對408/429/500/502/503/504，backoff1/2/4秒；每 retry 都再耗 root model及daily，仍受原deadline、remaining calls。 | maxRetries3不保證還有3次可用；不是每次失敗都重送。未知副作用不應放寬。 |
| A07 ③④ R `server/agent-budget.ts:8–22,170附近`; `server/agent-runtime.ts:245–246`; `server/agent-model-gateway.ts:26–39,145–163` | 互動文字32,000–64,000（常用64,000），一般worker32,000；request JSON以UTF-16字元估算，非模型tokenizer。**已校驗inlineData的base64會先換成固定marker，不計進64k文字額度**。工具回傳餘量另扣4096保留區及其他預留。 | 調官方模型context能力不會自動改程式字元牆；不可從64k錯推照片只能約45KiB。媒體另驗user role、inlineData總數≤1，fileData直接拒。 |
| A08 ③ R `server/agent-context-window.ts:4`; `server/product-agent-tools.ts:88,247–267`; `src/shared/agent-work.ts:39,73–74` | 最近6訊息／14,000字元；完整歷史按4000字元讀；history tool budget8000。歷史搜尋每頁掃100／回10，有cursor。 | 最近視窗不等於歷史刪除；可續讀但要消耗工具／模型回合。 |
| A09 ③④ R `server/agent-document-tools.ts:34,103,134`; `src/shared/product-agent.ts:12,50–58`; `src/shared/data-compose.ts:36–39` | document工具回傳不逾8000且扣context；候選JSON≤6000字元；一次最多12 edits、8 gaps；回答≤6段、每段1800字元、每段≤6 citation IDs。 | 1,024 tokens往往先卡；放寬model output後也仍受schema限制，不能只改gateway。 |
| A10 ①② R `server/firestore-agent-admission.ts:10,25,28`; `server/agent-runtime.ts:267,500–510` | 全局最多4個root、每人1個；ADK maxLlmCalls綁remaining root calls；durable schema上限由shared導出，attempt records最大34。 | 忙時拒／需等候，不是官方API併發上限。提高需容量、租約及重入評估。 |
| A11 ①③ R `server/firestore-product-agent.ts:73`; `server/chat-delivery-review.ts:185–192,281–284`; `server/data-compose.ts:203–210` | memory-refresh／voice-transcription另max1模型call；交付review要剩1，修訂＋再審要再2，編製／審核共用原root。 | 不能把一輪8次誤解為主Agent8＋編製8＋審核8；增加角色會吃同一池。 |
| A12 ①②③ L `server/firestore-knowledge-maintenance.ts:65–71,127–130,160–167`; `server/firestore-knowledge-work.ts:44,54,91,116`; `scripts/agent-local-maintain.mjs:66` | D知識編製runner：`min(2,admin model)`、tool8/query1、run min(300秒,admin)、retry0；durable再max2calls/300秒、8units；每record512KiB；最多4publication batches。 | **有實作且可由local/operator執行，不是deadcode；本次call-site掃描未見正式firebase API/worker接入。** 不把一般背景95秒外層硬套到這條D路徑。 |
| A13 ①③ L `server/background-knowledge-model.ts:25,79,89,131,135`; `server/embedding-gateway.ts:85,94`; `server/vertex-embedding.ts:27`; `server/gemini-key-provider.ts:37,141` | D最多32units、每unit3000字元、system+user64,000、rawoutput128,000但仍受gateway1024tokens；embedding query2000／document4000字元、title600；corpus daily min(16,global)；embedding token檢查2048，Developer key另text+title UTF8≤2000 bytes。 | 最大宣告值不代表可同時達到；Developer小byte牆可早於字元／token牆。供應商官方容量另見本輪額度方案。 |

**真失敗證據的界線**（由focused audit核）：`DEV_AGENT02_KNOWLEDGE_RUNTIME_20261020.json:377–447` 的臨時4calls用滿後確有`model_limit`；`:276–320` 是daily quota；`DEV_AGENT02_REAL_COMPOSE_20261020.json:23–30` 的8次生成終止為`delivery_review_incomplete`（含429及retry），不能倒推「8call一定因call ceiling失敗」。背景2call成功只證指定PDF第3頁，不證全本能力。

## B. 時間、併發、重試、排程及外部投遞

| #／類別／路徑 | 硬值／實際先後次序 | 影響／性質 |
|---|---|---|
| B01 ② R `server/firestore-photos.ts:534–539`; `server/photo-agent.ts:18–24`; `server/firestore-shared-inputs.ts:229–244`; `server/shared-input-service.ts:37–38` | 照片與共享來源抽取claim固定95秒，傳入`deadlineAtMs`；來源fetch phase25秒。 | **較早的claim deadline可壓過管理員300秒**；可用時間還須扣掉取物件等前置。須改source/claim/runtime一齊看。 |
| B02 ② R `server/firestore-voice-transcripts.ts:62`; `server/voice-transcription.ts:16`; `server/firestore-background-work.ts:182,187` | 語音claim90秒；一般正式background lease120秒、`execute`外層AbortSignal95秒。 | worker根預算即使300秒也不能越過外層signal；語音另1call。 |
| B03 ② R `server/firebase-task-delivery.ts:30,66–69,76`; `server/firestore-task-worker.ts:157,174–175` | Cloud Tasks普通dispatch60秒／product120秒；create/get RPC10秒、retry:null；普通task lease30秒、3次租約失敗進failed。 | 程式選的dispatch/lease與RPC期限，並非Cloud Tasks官方最大。不能盲重送unknown工作。 |
| B04 ②⑤ R `server/firestore-background-work.ts:18–20,162–187`; `server/firestore-task-dispatcher.ts:12,122–125,140–141,163–180` | background due掃12、另一lane4；失敗上限3；dispatch lease30秒／scan lease60秒；普通task派送一頁25，有cursor；unresolved3轉needs_attention。 | 有界派送及保護未知副作用。25是page，不是全系統只能25件工作。 |
| B05 ②⑤ R `server/firestore-work-followup.ts:94–125`; `server/firestore-work-continuation-store.ts:191`; `server/firestore-work-continuation-recovery.ts:46,50` | 香港日界每scope一天1次私人續辦run，最多10候選／合併5工作；無變化下次約1小時；續辦claim90秒；恢復result schema tools/count最多8。 | 與一般工具16上限不相同；恢復結構有較窄邊界，改runtime預算須一起核對，未直接判定bug。 |
| B06 ②③ R `server/firestore-background-maintenance.ts:134–175,260` | 全局tick每分鐘最多1次，lease120秒；每stage掃5、有持久cursor；文件hour basis；scope erasure每次最多8頁／45秒。 | 是節流／續辦，不是永久只處理5筆；影響積壓延遲。 |
| B07 ②⑤ R `server/task-policy.ts:59–78`; `server/firestore-contact.ts:170`; `server/firestore-growth.ts:139` | 普通提醒每當地日最多一批、最多一次follow-up且非同日；appointment不follow-up；next-time最多找48小時；聯絡授權≤365日、snooze≤366日。 | 產品通知與授權語義，不宜作「模型太弱」一起放鬆。 |
| B08 ② U `src/client/chat-api.ts:107,185`; `src/client/product-agent-api.ts:59`; `frontend/src/production/ChatFileUploadController.ts:33`; `VoiceUploadController.ts:33` | 一般API20秒；product讀15／寫20秒；真正chat reply為(shared max300＋30)秒=330秒；file upload60秒、voice30秒。 | **沒有把chat reply誤當20秒。** 其他呼叫可能在Server仍運行時先中斷，保留原opId／查回。 |
| B09 ②③ R `server/firebase-main.ts:11–13`; `server/firebase-worker-main.ts:5,58`; `server/firebase-http.ts:68–103` | Node requestTimeout15秒、headers10秒、maxHeaders100；worker body4096bytes；較大body進行中最多2個。 | requestTimeout是接收HTTP請求的期限，**不是模型回覆總執行15秒**。大上傳在慢網絡可先受它影響。 |
| B10 ②⑥ R `server/telegram-gateway.ts:7–10`; `server/web-push-gateway.ts:85,110,128`; `server/native-push-gateway.ts:31,45–46,75` | Telegram request8KiB／response32KiB、10秒一般／15秒send；Web Push15秒overall／10秒socket、TTL300秒；FCM deadline≤15秒、response8KiB、TTL300秒。 | 都是adapter有界策略；不是供應商唯一上限。失聯不代表未送出。 |
| B11 ②⑤ R `server/firestore-web-push.ts:71,103`; `server/firestore-native-push.ts:99–101,132–145`; `server/firestore-telegram.ts:103,108,169` | Web／native各最多5 active bindings、24h新建20；通知測試各24h3次及相隔60秒；Telegram link24h6次、challenge10分鐘。 | 防濫用與通知測試額度，非一般聊天每日次數；不要一併解除。 |
| B12 ② L `server/local-agent-worker.ts:36–58`; `scripts/agent-local.mjs:136,148,183–190` | local worker每5秒tick、序列最多8件；busy最多3 attempts、下次≥125秒；checkpoint60秒、export60秒、ready probe1秒；單子程序log最多2MiB。 | 本地工具限制，不代表GCP正式配置。維持原job identity及unknown不重送。 |

## C. 檔案、媒體、原文抽取及傳輸

| #／類別／路徑 | 容量／組合規則 | 影響／可調面 |
|---|---|---|
| C01 ③④ R/U `src/shared/photos.ts:4–14`; `server/firestore-photos.ts:200–203` | 照片4MiB；每owner/child scope100張／100MiB；全庫active＋cleanup512MiB／10,000張；JPEG/PNG；草稿5000字元。 | 全部是shared/source硬值。**刪除未清完的物件仍佔global配額**，避免假釋放。 |
| C02 ③④ R/U `src/shared/voice.ts:3–4`; `src/shared/voice-transcript.ts:5–9`; `server/firestore-chat.ts:27–29` | 音訊5MiB／120秒／每訊息1件；5種MIME；轉錄≤40 segments，每segment2000字元；voice與file不能同時附在同訊息。 | client及Server都驗；不是模型最大音訊長度。 |
| C03 ③④ R/U `src/shared/chat-files.ts:3,15`; `server/firestore-chat-files.ts:91–92`; `server/firestore-voice.ts:93–94` | 一般檔案20MiB／每訊息1件／檔名200字元；file及voice各同scope最多3件pending reservation。 | 未完成上傳亦會佔pending；提高前須處理容量／清理，不只放寬picker。 |
| C04 ②③⑤ R `server/voice-files.ts:16–45`; `server/voice-file-probe.mjs:20` | 音訊probe最多2並發／5秒／64MiB old heap、16MiB young、4MiB stack；packet≤50,000。 | 解析安全/容量邊界，可能早於120秒業務長度；不是付費模型限制。 |
| C05 ②③ R/L `server/knowledge-pdf.ts:4–6,31–37,52,71`; `knowledge-pdf-worker.ts:9,63–76` | PDF≤32MiB，預設及max每批8頁，page text≤32,000字元，20秒、128MiB old heap／16MiB young／4MiB stack；少於20字母的非空頁標unreadable。 | 超頁文字不默默截斷，該頁unreadable。**沒有OCR掃描頁路徑**：現有worker只`getTextContent`，不能把掃描PDF成功當已支持。 |
| C06 ③ R `server/chat-file-reader.ts:6,30,51–62`; `chat-file-reader-worker.ts:6–7,15,24,36` | chat PDF每次1頁；每次讀12,000字元、帶page/offset/next；DOCX展開≤32MiB／1024entries／全文≤2Mi字元；20秒worker。 | **一頁／12k是可續讀批次，不是整份只能讀一頁。** Chat上傳20MiB比通用PDF parser32MiB更早卡。 |
| C07 ③⑤ R `server/public-source-transport.ts:15–20,30,41–47`; `server/personal-source-fetch.ts:5–21` | 公網fetch預設1MiB、可傳max但硬頂32MiB、20秒、最多2次redirect；只public IPv4、HTTPS同源校驗、拒壓縮；私人頁解析text≤64,000、title300字元。 | body bytes與解碼字元兩重限制；SSRF／重導向校驗不是應放鬆的容量政策。 |
| C08 ③④ R `server/knowledge-source-parser.ts:4–9,123,164–168`; `server/knowledge-source-fetch.ts:19–23`; `server/knowledge-source-catalog.ts:11–14` | HTML/RSS input1Mi字元，page64,000；description4000；RSS只前50items；PDF登記window最多8頁；**現有fhs-feeding-booklet-en指定3→3頁**。 | 長來源需完整覆蓋設計；改抽取器8頁不會令該watch自動讀整本。 |
| C09 ③ R `server/firebase-http.ts:11,82–85`; `server/firebase-app.ts:49,116–130,319–321`; `firebase-chat-files-api.ts:7–10`; `firebase-voice-api.ts:8–11` | Node一般64KiB，photo6MiB，document2MiB，file/voice body依base64公式＋1024；特定foundation/AI POST又受16KiB；上傳metadata一般2KiB。 | 不是全API一律16KiB；必須按實際route找最小值。UTF8 JSON＋base64膨脹要算入。 |
| C10 ③ R/U `server/agent-feedback-stream.ts:13,22`; `src/client/agent-feedback-reader.ts:12,26` | SSE server單frame256KiB；client累計512KiB／未切frame buffer256KiB，heartbeat15秒。 | 進度過多或終態結果過大可被transport拒，即使model本身未超限。 |
| C11 ③ R `server/firebase-chat-file-objects.ts:10,22,86,120`; `firebase-voice-objects.ts:10`; `firebase-photo-objects.ts:20–23` | encrypted file object40MiB（base64欄28MiB）；voice object10MiB（base647MiB）；photo密文上限由4MiB雙層base64公式導出；Storage IO15／20秒。 | 是加密包裝容量，不應誤報「用戶可上傳40MiB」。 |
| C12 ③ U `frontend/src/components/agent/native-chat-file.ts:15`; `native-voice-file.ts:15`; `VoiceCapture.tsx:14,66–68`; `appearance/BackgroundImagePicker.web.tsx:7,19` | native臨時file／voice cache各最多8；錄音119.75秒附近主動停；自訂背景圖4MiB。 | native cache滿會拒；錄音前端比120秒略早停是留裕度；背景圖不是上傳家庭照片政策。 |
| C13 ②⑤ R `server/firestore-chat-files.ts:209,241–244`; `firestore-voice.ts:211,258`; `firestore-background-maintenance.ts:82,94` | 未連訊息附件24h後清理；清理最多6attempts，backoff至15分鐘，之後blocked。 | 需可見blocked／恢復機制，不應為「解除限制」刪掉未知物件保護。 |

## D. 知識、資料／文件規模、讀取與分頁

| #／類別／路徑 | 實際值／是否總容量 | 用戶影響／備註 |
|---|---|---|
| D01 ③④ R `server/firebase-config.ts:39`; `server/firestore-knowledge.ts:124–129,216–223` | 配置最多10個root source IDs；另可含這些watch的動態RSS派生來源。 | **不能說整庫最多10篇。** 屬配置hardmax，env可選內容不能超過10root。 |
| D02 ③④ R `server/knowledge-inputs.ts:9,12,38,49–51`; `firestore-knowledge.ts:58–59` | 每source version最多32chunks；text及originalText各4000字元；topic12、keywords24、conditions8；age applicability0–120months。 | 原文總容量、領域適用性皆程式化；120月是產品年齡範圍，不是API能力。 |
| D03 ③ R `server/firestore-knowledge.ts:530–534,551,596–616`; `knowledge-ranking.ts:3–4`; `knowledge-retriever.ts:70,92` | 搜尋結果max6；候選各vector/keyword top60，COSINE threshold0.4，RRF k60；IN查詢每批30；read candidates硬防護120；工具每頁3chunks／6000字元，response8000。 | 6是retrieval回傳數，不是只建6個chunk；0.4是相關性策略不是供應商限制；有cursor可續讀。 |
| D04 ③⑤ R `server/firestore-knowledge.ts:206–214`; `firestore-knowledge-refresh.ts:93–94` | recent information只納7日內發布及24h內成功核對；最近source查詢最多60。 | 過期資料排除是新鮮度／安全語義；不能機械放寬以增加回答數量。 |
| D05 ③ R `server/firestore-shared-inputs.ts:27,31,79,125–126,199,231`; `src/shared/shared-inputs.ts:10` | 每本人/孩子50個live inputs（真容量）；抓取本文64,000字元拆4×16000；paste及抽取excerpt≤10,000；管理歷史一次20，只回hasMore。 | 調整private source parser不會越過儲存parts/schema；管理歷史hasMore不等於已有續頁UI。 |
| D06 ③④ R `server/firestore-family-documents.ts:143–152,264–265,331`; `family-document-edits.ts:9–11`; `src/shared/family-documents.ts:25–32,80–81` | 每scope最多50active文件；單snapshot≤50sections／總500items／JSON240,000字元；每edit text4000、每patch12 edits；列表default/max50。 | archive不佔active count；historyIds10是近期索引，版本查詢可10份一頁續讀，**不是只保留10版**。 |
| D07 ③ R `server/firestore-family-document-snapshots.ts:24–48`; `family-document-report-core.ts:58–60,81` | snapshot拆48KiB×最多20chunks，manifest≤960,000bytes／240,000chars；報告正文選錄最多80有日期＋40無日期＋20未知日期=140來源。 | 正式report accumulator有完整掃描／統計，但**正文選錄非全量正文**；不要混用legacy snapshot註記稱現行只掃首50。 |
| D08 ③ R `server/firestore-document-sources.ts:28,115–117,171–186`; `src/client/family-documents-api.ts:28–31` | source stage25一頁；部分直接snapshot concern每項讀5事件；document原文4000字元一頁、版本10一頁。 | stage/cursor可續行與直接快照不同；不要把頁大小說成資料刪除。 |
| D09 ③ R `server/firestore-care.ts:182–195,204–218`; `care-summary-policy.ts:73`; `firestore-care-summary.ts:38–39` | care list最近100；search每頁掃200／回50、有cursor；summary全scope讀>2000記錄即拒、所選區間>200亦拒；summary tasks>500拒。 | **摘要總範圍是容量拒絕，不能靠換頁解決**；日／週資料多或長期資料累積可碰到。 |
| D10 ③ R `src/shared/concerns.ts:3–4`; `server/firestore-concerns.ts:117,257`; `firestore-growth.ts:52–53,109,221` | 關注總200；每關注200普通events＋2終態reserve；成長關注history容量約500，常規頁僅最近30歷史且hasMore。 | 終態reserve保證達容量仍可完成/封存，不應刪除。需分頁／歸檔政策，不是單調高畫面list。 |
| D11 ③ R `server/firestore-memory.ts:25–28,270–291,338,343,405,520–522` | summary每批50messages／12,000 JSON chars／64dependencies／summary6000字元，最近4批；fact/topic context每次20，管理page default/max50。 | 已存全歷史與本輪取用窗口不同；dependency上限保護失效／撤權追溯。 |
| D12 ③ R `server/firestore-chat.ts:19–29,100–109`; `src/shared/inputs.ts:40,58` | chat每訊息10,000 Unicode code points；chat history每頁100有cursor；child displayName80code points；一般文字記錄10,000。 | UTF16前端maxLength與code points可能不同；表單字數與API bytes也不同。 |
| D13 ③ R `server/firestore-agent-actions.ts:96–97,209`; `firestore-agent-proposals.ts:68–69,182,185`; `firestore-agent-documents.ts:59`; `firestore-agent-confirmations.ts:108–140` | 每run action receipts8／proposals8／document receipt overflow8；確認讀取guard8；proposal24h到期；待辦page20。 | 工具16不代表可作16個有副作用保存；confirmation/action皆另有完整追溯容量。 |
| D14 ③④ R `server/firestore-session-codec.ts:8–10`; `firestore-session-service.ts:134,158–159,213–214` | ADK每session最多64events；owner list最多100active sessions（超過會拒，非只回首100）；每document900KiB。 | 這是ADK持久層，不等於用戶聊天只可64則。調高model/tool上限須核event增長。 |
| D15 ③⑤ R `server/firestore-domain-data.ts:11`; `firestore-authority.ts:18`; `firestore-recovery-envelope.ts:8–9`; `firestore-knowledge.ts:83,97` | 通用domain/authority plaintext192KiB；recovery locator64/96KiB；knowledge document900KiB／transaction8MiB；root budget64KiB。 | 為加密與資料庫保留餘量的產品上限，**不是Firestore官方document/transaction值本身**。不可只改一個schema。 |
| D16 ③ R/U `server/firestore-account-export.ts:107–111`; `frontend/src/production/AccountServiceOwner.ts:229–253` | 一般export每頁10，內容／媒體1；前端每下載part最多40頁或估算4MiB（以JSON.length×2，最後一頁可跨界），全流程可繼續next part；child IDs10000guard。 | **不是帳戶只可匯出4MiB**。每part「partial」明示；估算不是精確輸出byte hardmax。 |
| D17 ③④ U `frontend/src/components/tasks/task-calendar.ts:64`; `task-view-model.ts:85`; `components/agent/AgentInboxView.tsx:18`; `components/HomeOngoing.tsx:20`; `components/HomeFocus.tsx:16,44` | task list10/page；recent completed10；inbox展示20；home摘要1/2/3/6項。 | 呈現/分頁大小，不是DB保存上限。預覽fixture延遲及CSS布局數值另行排除。 |

## E. UI／schema 不一致與權限語義

| #／類別／路徑 | 靜態發現 | 裁決界線 |
|---|---|---|
| E01 ④ R/U `frontend/src/components/contact/contact-form.ts:5–7`; `ContactConsentCard.tsx:33–36,87,99`; `src/shared/contact.ts:8`; `frontend/src/contact-view-model.ts:5,47` | UI schema enum只有web_push/telegram、bindings max2；view model可包含native_push，Server shared consent max3；UI用同schema決定Save disabled。 | **具體可達的不一致**，不像單純保守上限。需定向修復／必要合成驗證，未在本輪修改或測試。 |
| E02 ④⑤ R/U `src/client/agent-actions-api.ts:42,62`; `src/shared/agent-actions.ts:14`; `server/firestore-agent-actions.ts:32` | Agent授權reminderBindings max2；client receipt channels max2；Server receipt允許3。 | 與E01相鄰但不能只改max2：要核產品授權／多渠道意圖及現有native wiring；本輪列coupling risk，不推斷已發生丟通知。 |
| E03 ④ U `frontend/src/production/AgentAuthorizationOwner.ts:96`; `frontend/src/components/family/FamilyView.tsx:20`; `server/account-admission.ts:14` | 私人備註搜尋draft直接slice200；家庭邀請UI email max254，但Server相關email max320；其他文字欄有160/500/2000等schema。 | 大多為表單輸入邊界，不是模型能力；避免「全部數字換大」造成client/server失配。 |
| E04 ⑤ R `server/firebase-auth.ts:8–10,106,199–208`; `server/firestore-authority.ts:419`; `server/firestore-erasure.ts:68` | session5天、recent auth5分鐘；管理邀請最多90天；刪帳戶receipt token15分鐘；各version/schema上限2147483646/7或MAX_SAFE_INTEGER。 | 會話／重新認證／版本範圍是安全及一致性，不應隨模型／內容上限一起解除。 |
| E05 ⑤ R `server/public-source-transport.ts:5–9,22–30`; `server/knowledge-inputs.ts:21–24`; `server/knowledge-source-fetch.ts:7–11`; `deploy/firebase/firestore.rules`; `deploy/firebase/storage.rules` | 公網位址／官方來源allowlist、禁止client直讀寫資料、Server權威／原版本與hash、家庭scope、必須確認等均為硬邊界。 | **有意保留**。新增來源需來源／授權審核；不可將allowlist誤列為「應無條件放開」的程式限制。 |

## F. 備份、還原、部署及本地工具

| #／類別／路徑 | 值／有效性 | 影響 |
|---|---|---|
| F01 ③⑤ L `server/firestore-backup.ts:11`; `firebase-backup-artifacts.ts:19–23,51–52` | 受控snapshot最多2000documents／32MiB；native export檢查最多256objects／256MiB；manifest32MiB。 | operator恢復工具的保守承載範圍；大庫可能拒，**不是正式資料庫最多2000筆**。 |
| F02 ②③⑤ L `server/firebase-native-recovery.ts:4–6,132`; `firebase-managed-photo-recovery.ts:37–43`; `firebase-restore-apply.ts:10,63–64,84` | native operation找10頁×100、RPC30秒；journal最多32頁×100但names≥2000拒；restore plan≤200pages，每page≤80actions／600,000bytes，超大單record拒。 | 必須完整性檢查失敗即停；不能截斷恢復後宣稱完成。 |
| F03 ⑤ L `server/firebase-photo-recovery.ts:13–14`; `firebase-managed-backup.ts:16,41` | photo backup保留期限14–15天；managed backup/restore RPC30秒、retry:false。 | 是工具政策，不證現場保留期／備份已成功還原。 |
| F04 ②③ 配置 `deploy/p1/compose.firestore.yaml:5,14,17,28–45`; `Caddyfile.firestore:5–17` | API/worker `/tmp`32MiB；grace25秒；log10MiB×3；healthcheck30秒/5秒/3fail。Caddy配置未另設response總timeout。 | repo配置沒有CPU／RAM硬配額欄，不代表VM／容器實際無外層限制；不讀現場。 |
| F05 ② 配置 `server/firebase-blocking.ts:44–47`; `server/firebase-registration.ts:6` | Identity blocking function minInstances0／maxInstances1／concurrency1／timeout7秒；內部registration deadline6秒。 | 預設部署描述可限制登入准入併發，現場是否一致未知；安全fail-closed不能刪。 |
| F06 ①③ L `scripts/knowledge.mjs:67–73`; `scripts/agent-local-knowledge.mjs:20,40,55`; `scripts/agent-local.mjs:94–99` | operator embedding max1–16 calls，deadline min900秒, max×request timeout；local seed固定1chunk、巡查最多64頁／120秒embedding；local初始知識source用M03 pair、通知全關。 | 明確一次性／本地工具邊界，不當全部產品runtime限制。seed限定不代表其他API只可一chunk。 |
| F07 ②③ L `scripts/mobile-release.mjs:28,34,141` | git maxBuffer4MiB、外部tool32MiB、rollback查最近50updates。 | 發布工具會有可見範圍／buffer限制；本輪沒有執行發布或憑證操作。 |

## G. 舊程式、測試及「不要誤報」

- `server/model-routing.ts`、`server/model-gateway.ts`、`server/database.ts`、SQL migrations及`server/app.ts`/`auth.ts`保留舊實作或相容型別／共用符號；正式入口是 `firebase-main.ts`／`firebase-worker-main.ts`。**被import為type或共用helper，不代表整個舊SQL服務已啟用。** 舊DB pool／Better Auth rateLimit不列為現行Firebase有效限制。
- `deploy/p1/init-secrets.py:50–51` 的daily20／30秒／input6000／output512，及`deploy/p2/configure-existing.py`舊bootstrap值，不取代目前Firestore saved policy。
- `scripts/lib/chat-intent-probe-guards.mjs:23` 的4calls/8tools/90秒/1024，`chat-document-batch-guards.mjs`的batch deadline270秒及成本reserve，是**有界驗收／probe harness**，不是一般用戶正式預算。測試／驗收目錄未全量讀取，沒有把fixture固定答案、preview延遲、測試timeout計作產品牆。
- PDF的8頁、chat-file的1頁／12k、document history10、帳戶匯出4MiB及task25皆須按其cursor／next語義解讀；有些真上限、有些只是單批。上表已分開。
- 源碼常數及環境樣板不證現場值。根`STATUS.md`記錄部署產品提交`d53c203`；本次master較新。`PLAN.md:69`的policy v3 request90／run300／retry3／daily200/400是**已有文檔觀察**，本輪沒讀live policy／keys／usage，不宣稱是當下真實值。
- PR #252在本次檢視時為draft、docs-only；文件改動不能把未改的實作限制重新定義成已移除。

## H. 後續動作的最小合理範圍（建議，未執行）

1. **先作限制登記及有效值投影**：保留每層單位、owner、可設範圍、實際effective及命中reason；UI顯示「admin300秒但此能力95秒」比只顯示一個上限更誠實。
2. **先修不同步，再評估上調**：E01最明確；A05、B01/B02、D05/D06/D09屬產品需求／容量取捨，要沿實際使用情境處理，而非一次全放大。
3. **長文件應以續讀／分段／持久工作設計優先**：增加模型context、token或call次數不能解決只登記PDF第3頁、32chunks、完整來源覆蓋與已讀證據問題。
4. **保留⑤類護欄**：家庭隔離、授權、confirmed/unknown、撤權、原opId、hash/version、一致性、外發去重、成本計量、完整恢復均不得用「無限制」繞過。
5. **供應商官方容量另見本輪額度方案**：本報告只確證repo常數；沒有把1,024tokens、64k字元、95秒、2模型call、32chunks等說成Google官方極限。

## 方法、覆蓋與未驗項

- 已讀根AGENTS、STATUS、PLAN#active及frontend AGENTS／PLAN#active。GitHub遞迴tree完整（4,544 entries，未truncated），固定SHA抓取**844個**相關source／配置／操作工具檔，約6.2MB；以常數、schema `.max`、clamp、slice/limit、timeout/lease、容量錯誤、call site及入口依賴定位，再人工核對高影響鏈。
- 覆蓋server、src/shared、src/client、frontend/src與app、deploy、Dockerfile／compose、操作及local launch scripts；重點排除archive、generated／assets/fonts、美術、lockfile、verification/test fixtures。preview源碼如被匹配明示為預覽，不當正式值。
- 已核對 AI 政策／gateway／D 預算，並掃描其餘產品、媒體、持久層、前端、worker、備份、deploy 及 local 路徑；沒有調用模型或執行驗收。
- **沒有改repository、沒有執行測試／build／模型、沒有存取用戶電腦／正式家庭資料／密鑰、沒有部署／簽證書／開PR。** 唯一新檔為本報告。
- 這是廣覆蓋靜態限制盤點，不是每一行完整code review、動態重現、正式驗收或現場容量量測。封裝依賴的默認值、外部帳戶quota、服務端saved policy、GCP現場VM/queue限制未在本輪讀取；不能由「repo沒設」推論「沒有上限」。
