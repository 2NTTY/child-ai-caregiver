# 當前與後續開發計劃

**P2 及以前的歷史計劃：**已移至 [P1／P2 歷史計劃](_archive/plans/P1-P2-20261018.md)；歸檔來源及查閱方式見[歷史索引](_archive/README.md#plan-p1-p2-20261018)。只在追溯舊工作時按需閱讀，日常直接看本文件的[當前工作](#active)。

本文件維護工作包的目標、前置、狀態、未完成項及完成門檻，按包推進，不按日期或周排程。產品要求見 [SPEC](SPEC.md)，短現況與部署觀察見 [STATUS](STATUS.md)，實際測試與失敗見 [WORKLOG](WORKLOG.md) 及各包證據；執行與文件更新規則只依 [AGENTS](AGENTS.md#document-updates)。

Sxx 是穩定範圍標識，不代表數字執行順序。原條款被新決策修訂時保留錨點；Firestore／原站與角色階段沿 [ADR-024](docs/DECISIONS.md#adr-024)，資料庫先行次序依 [ADR-025](docs/DECISIONS.md#adr-025)，以 [ADR-008](docs/DECISIONS.md#adr-008) 追溯替代關係；不得把被替代要求當成已完成。

## 閱讀次序

1. 先讀 [STATUS](STATUS.md) 與[當前工作](#active)，再只讀對應包。
2. [P3／P4／P5](#later-phases)保留後續目標、前置及完成門檻；目前先交付本地 Agent 開發入口，Android 未驗項保留。
3. 舊包只透過[歷史索引](_archive/README.md#plan-p1-p2-20261018)按需查閱；日常不讀 P1／P2 歷史正文。
4. 工作狀態與最低驗收規則仍見[狀態](#states)、[證據層級](#verification)及[按包驗收](#p2-deferred-acceptance)。

<a id="phases"></a>
## 五階段及完成門檻

| 階段 | 工作正文 |
|---|---|
| P1 基礎成品 | [P1 工作包](#s01-w01) |
| P2 完整 Agent／穩定 Web 服務 | [歷史正文](#p2-delivered)／[未完成門檻](#p2-str01) |
| P3 高級完善成品 | [Android／iOS 及更新](#p3-mobile)／[三角色 Agent](#p3-agent-roles) |
| P4 完整版 | [自部署及完整能力](#s06-w04) |
| P5 以後升級版 | [非必要增值](#p5-future) |

<a id="phase-1"></a>
### P1 基礎成品

已交付；原範圍／完成門檻只見[歷史 P1](_archive/plans/P1-P2-20261018.md#phase-1)。

<a id="phase-2"></a>
### P2 完整 Agent／穩定 Web 服務

Firestore 正式零 SQL、前端接線與既有修正已交付；STR01 及指定備份驗收仍未完成，見[當前待辦](#p2-str01)。原各輪計劃／證據見[歷史 P2](_archive/plans/P1-P2-20261018.md#phase-2)。

<a id="phase-3"></a>
### P3 高級完善成品

- **交付範圍：**Android／iOS 在線 App、跨端更新、原生通知、語音／相機；家庭多人接線移至 P4；審核、資料編製、背景知識維護三角色保留原範圍。手機接線復用新前端及後端，不重做設計。
- **完成門檻：**Android／iPhone 真機使用同一 Server、身份及資料，必要登入、同源成果、附件、通知及更新有證據；三角色另按 P3-M01～M03 驗收。不建本地 Agent 或離線主庫，手機內測里程碑不代替整個 P3 完成。

<a id="phase-4"></a>
### P4 完整版

- **交付範圍：**完整家庭多人接線、自選相容 Server API、Windows Docker Compose 少步部署、裝置配對／臨時會話、既有 RAG 的完整管理／規模／維運擴充、分享／趨勢／PDF、Server 搬遷／災備
- **完成門檻：**全部現行有效 REQ／AC 及 S01–S17 工作包結案；原驗收條款的保留／修訂／替代均可追溯，待驗收不得當完成

<a id="phase-5"></a>
### P5 以後升級版

- **交付範圍：**另行確認的非必要增值
- **完成門檻：**不阻塞 P1–P4，不承接未完成的必要功能，不預建空框架

<a id="current-p2"></a>
<a id="active"></a>
## 當前工作

**次序：**先完成 [DEV-AGENT01](#dev-agent01) 本地正式運行環境，接續 [DEV-AGENT02](#dev-agent02) 四角色聯合接線，再做 [MODEL-SELF01／02](#model-self01) 個人模型及共用設定。使用者已批准本節完整計劃；Android 收束及未驗項保留，iOS 暫緩，不另造測試 Agent。

**活動分支：**`codex/model-self01-google-settings`，從 DEV01 `feedfe3`／draft #241 建立。DEV02 固定角色整合及原失敗保留在本地 `codex/dev-agent02-role-integration`／`ce1d6f9`，本包不把協作者程式帶入交付分支。2026-10-20 重核 master `d4686b7`；#214 `294572c`、#215 `aff6804`、#216 `364937c`仍open；前兩者新增聊天呈現／client修改，#216相較原固定版本樹內容相同。原DEV02證據只適用原固定head，不更新協作者分支或合併其PR。#229／#234～#239／#241未合併前置仍有效，不能把活動基線當master或已部署版本。

### 保留的 Android 交付狀態

- 管理員總控已於 #233 合併；每日及每輪設定只有一個權威。部署觀察、期限與未核對項只見 [STATUS](STATUS.md#deployment)。
- 當前實作：[S12-W05](#s12-w05) 首頁快捷輸入及通用文件附件，Server／Web及相容Android OTA已交付，Android選檔及Web本地檔案／錄音adapter已有證據；正式頁面上傳／下載及真人流程等gate仍待驗。#229／[S04-W01](#s04-w01)首條真人聊天仍由使用者驗收；鍵盤輸入可見及收起回位的既有真機結果保留，不宣稱每幀動畫已驗。
- 504處理已交付：原站API／worker、Web及APK v2相容OTA已更新；管理員政策v3為單次90秒、互動300秒、最多額外3次有計量重試，每日200／400不變。已成功工具不重做，未知副作用不盲重送。兩項必要本機流程、舊政策相容補核及局部型別已通過；零真模型／通知。Google實際恢復及使用者首條聊天未驗，手機鎖定時未追加真機操作。依使用者要求收束當前修正，餘下Android門檻見各包，不開新功能。
- 後續獨立接線與必要本機檢查已保存於 draft #234～#239：會話、同步、原運行查回、語音／附件、原生通知與固定發布工具。`bf47c47` 的新增索引、相容 API／worker／Web 已交付原站；新版 APK已完成並記錄發布基線，使用者已回覆覆蓋安裝；使用者已確認正常開啟、原登入及資料保留；其餘功能真機及依賴合併未完成。
- Android Firebase／最小 FCM 權限及 Expo preview 描述檔已配置，新版 APK已安裝；本人已允許通知，一則指定FCM測試已在手機顯示，不重發。具體範圍／gate 只在[各工作包](#s13-w02)，不在此重複工作史。
- 主模型實作、指導及 review；使用者最新容許 Luna 按規則唯讀定位。最低必要檢查，優先局部原文或日誌尾部；需本人／手機的項目待驗時繼續獨立工作，不能把待驗寫成完成。
- OPT／LAY 已交付；[STR01](#p2-str01)及[原生備份還原](#p2-backup-followup)仍未完成。#214～#216 由協作者處理，不接管或合併。
- 每包交付按本機協作文件及主責切換帳號、單作者提交；B提出Android／共用前端需求，C實作所需後端，接口穩定後由B接線。依賴 PR／人工 gate 保留。新包及合併前重核 master、相關 head 及本機修改。

<a id="local-agent-personal-model"></a>
## 四 Agent 本地開發環境與個人模型設定

**目標：**協作者在自己的分支改完即可用真模型測聊天、資料編製、審核、背景知識維護、工具、保存及頁面結果，毋須部署 GCP；之後 Web／Android 共用本人憑證、模型及限制。以下取代前版本地／個人 key 安排，未實作部分不得寫成已具備。

### 共同不變條件

- 沿用同一正式 ADK、ModelGateway、Prompt Pack、工具及業務服務；只替換外部環境接點，不複製測試 Agent／提示詞，不重做 UI 或雲端架構。
- Google 優先：Gemini／Vertex API key，開發者亦可用本機 ADC；Web／Android 不上傳服務帳戶 JSON。個人模式完全使用本人憑證，不借平台模型或 embedding 額度。
- Firebase Auth／Firestore／Storage Emulator 使用固定版本、`demo-` 專案、本機端點及 Node／Java 檢查。業務資料專案與模型計費專案分開；缺本地依賴不回退正式 GCP，正式啟動拒絕本地接口／設定。
- 身份、准入、session、權限、交易、版本、確認、原 opId、防重、加密、附件 hash／版本及刪除仍經正式服務。物件 emulator 缺口才用薄 adapter，不另寫附件規則。
- 工作台帳、claim／租約及 worker handler 不變，只替換喚醒接點；通知／寄信預設本地收件箱並明示未實際發送，不能返回假渠道成功。
- 官方種子保留原文／版本／位置；缺向量才用本人憑證小批初始化並按 hash 復用。先核 emulator 向量支援，若缺 findNearest，只替換有界候選查詢、使用相同距離，保留正式過濾、關鍵詞、RRF及引用；不假搜尋或固定答案。
- 照片／錄音／附件／PDF 沿分支既有服務；缺失或不支援能力明示。本地結果不代替真 GCP IAM、雲端投遞及容量驗收。

<a id="dev-agent01"></a>
### DEV-AGENT01 本地正式運行環境

- 狀態：本地基礎已實作並完成首條必要真聊天／引用、保存／重啟讀回及 Web 接線核對；尚未合併，前置仍為 draft #239。操作見[本地入口](docs/AGENT_LOCAL.md)，結果與原失敗見[DEV01 證據](artifacts/verification/DEV_AGENT01_LOCAL_20261018.json)。A 單人主責及交付。
- `npm run agent:local` 一次啟動既有 Web、本機 API、正式 Agent及持久隔離資料；首次準備依賴後只需 key，ADC 使用者另設模型專案／地區，不需雲端資料庫、正式帳號或正式密鑰。
- Web 熱更新、Server／提示詞重新載入；下一操作使用新版本，途中重啟不重送問題。顯示分支／SHA／模型／Prompt Pack及角色狀態；原 run／收據可查回。
- 帳號、孩子、聊天、文件、工作重啟保留；worktree 各自端口及資料目錄。重設只清本地資料；憑證不進 Git、前端 bundle或日誌。
- 初始化、重啟與日常啟動不自動執行付費驗收；首批缺失知識向量另以明確準備操作產生，顯示用量。
- gate：本地真聊天／工具保存／頁面與重開讀回，改程式或提示詞後可再測；無正式資料寫入／通知。只作必要依賴及接線核對。
- 本次真模型回覆只有文字準備單草稿，未保存為文件；不得算編製／審核／四角色聯合驗收。另以零模型正式 client 核對同一準備單修改／讀回／版本衝突及加密附件保存／讀回／刪除，共19次本機API；沒有聲稱照片／錄音／PDF全部驗收。背景派送已復用正式 consumer；角色聯合及非郵件本地收件箱仍待補，不重跑已通過的聊天或登入來代替缺口。

<a id="dev-agent02"></a>
### DEV-AGENT02 四角色聯合接線

- 前置：DEV-AGENT01；本地基礎已可使用，非郵件收件箱及原 draft gate 保留。狀態：已在獨立本地分支整合 #214 `80eb850`、#215 `53c74ac`、#216 `0360f7b`，未推送或合併原 PR。正式組裝的 scripted 編製／審核／同文件確認保存、原操作防重、錯誤引用及背景無動作核對通過；一次真模型流程遇自動重載中斷，原 run 已查回 unknown／interrupted，僅有一次未回報結果的模型預留，未重跑。詳見[DEV02 證據](artifacts/verification/DEV_AGENT02_LOCAL_ROLES_20261018.json)。A 單人負責整合，原角色作者不變。
- 載入當前分支正式角色；聊天語義委派編製、Server控制審核，不要求每句啟動全部角色。編製更新同一資源，頁面同步；「處理頁面」是業務工具改資料，不是模擬點按。
- 聊天／編製／審核共用根 run、取消／期限／計量；背景維護使用獨立工作預算。角色模型缺省繼承共同模型及開發者憑證，不因子 Runner／重試繞限。
- 獨立背景入口可手動／本地排程啟動，樣本與受限真網站模式分明；遵守既有網域、路徑、頁數及用途，只發布本地知識庫。私人資料不可進公共維護上下文。
- 審核綁定正文／來源／對象／版本；未核准不正式保存。顯示角色、工具、審核、收據、耗時及停止原因，不預設完整私人正文／內部思考日誌。
- 聯合測試可用獨立本地整合分支及固定提交，保留原作者；不擅改／合併協作者分支、不重寫角色。缺接口列清交原包承接；環境可啟動、角色已接及真模型已驗分開，#216 stub 不計真審核完成。
- 尚欠：真模型編製／審核成果、頁面聯合核對、非郵件本地收件箱。#216 的 `BackgroundKnowledgeMaintenancePorts`／`KnowledgeSemanticReviewPort` 尚缺真模型、持久用量／工作／發布組裝及本地觸發，現有記憶體 fallback／programmatic stub 不能當通過；保留協作者承接。可先開始不依賴這些缺口的 MODEL-SELF01，不能把 DEV02 標完成。
- gate：聊天→編製→真審核→保存→頁面／新對話讀回；另無聊天時背景讀來源→整理／審核→本地發布→聊天引用新版。缺角色真實實作時保留待驗，不能以替身達標。

<a id="model-self01"></a>
### MODEL-SELF01 個人模型與共同策略

- 前置：DEV-AGENT01，DEV-AGENT02可用接口已在獨立分支核對；協作者未實作及真模型gate獨立保留。狀態：後端／共用client已接Gemini／Vertex key、模型目錄、本人進階限制、生效值及原操作查回；兩條合成設定／SDK流程及兩項既有client檢查、局部型別通過。A單人實作與交付，未部署／未驗真個人key；詳見[MODEL01證據](artifacts/verification/MODEL_SELF01_SETTINGS_20261018.json)。
- 擴充現有加密設定／收據／用量及 command／view：provider、model、能力、進階限制及實際生效值；Server提供模型目錄，保留 expectedVersion／opId／unknown恢復。
- Gemini／Vertex API key使用正確SDK模式；ADC只限本機。依供應商可用模型及已接能力提供選項，thinking／工具／圖片／音訊／串流按型號處理，不偷換模型。metadata與真生成分開；保存設定不自動試多模型。
- 地區、憑證、模型、配額、逾時回傳安全且可分辨原因。embedding路由與聊天模型分開，維持原向量空間；本人憑證缺embedding時明示混合檢索不可用，不借平台額度／偽造引用。
- 可調每日、每輪生成／工具／embedding、整輪期限、單次等待、重試及背景授權；共同解析器計算個人設定與管理員保護的實際值。模型知道可用預算，硬上限防失控而非要求用盡。
- run固定模型／預算快照，重試沿原run計數、不重做成功工具／未知副作用；舊設定缺欄位維持舊行為。聊天／編製／審核／媒體／轉錄／背景用同一解析器；公共知識維護不用家長key，本地用開發者明確設定的維護憑證。
- 版本邊界：v2明確保存才採共同管理上限；舊設定不默改。Vertex Express未有已核對的embedding／metadata方法，明示未支援；已接生成協定不等於真服務通過。新收據含備份／還原與帳戶清理接點，未跑真雲端還原。下一步為MODEL02共用表單／owner與部署；需先收束本包及既有draft前置，不把role integration或Android待驗消失。

<a id="model-self02"></a>
### MODEL-SELF02 共用設定及交付

- 前置：MODEL-SELF01；狀態待開始。Web／Android共用owner、表單與API，一端保存另一端讀同版；顯示已用次數、生效值及限制來源。
- key不進prompt、日誌、URL、瀏覽器儲存或Android持久草稿；移除／替換沿原身份與版本檢查。部署沿原站及相容Web／OTA，不另建網站。
- 交付短指引：啟動、key／ADC、選分支、改完再試、背景觸發、角色結果、資料重設及仍需雲端確認的差異。

### 最少驗證及完成門檻

只使用三組連貫情景：①本地產品流程串一次衝突／原操作查回／錯誤引用拒絕；②獨立背景流程串重投遞／私人隔離；③設定跨端同版及角色路由，無平台回退／用量重設。機械拒絕用scripted provider，真模型只補必要理解／編製／審核／整理，不每角色或每模型開一套E2E，不全量、壓測或Computer Use。

完成須區分環境、角色接線、真模型證據及協作者待辦；不得以stub或靜態review宣稱四角色可用。按包review／最低驗證／PR交付，Android原未驗、draft及備份待驗不改寫。

<a id="doc-r05"></a>
### DOC-R05 — 歷史計劃移出日常入口

- 本輪文件整理：P1／P2 及早期文件包已搬至[凍結歷史](_archive/README.md#plan-p1-p2-20261018)，根 PLAN 保留當前工作、未完成門檻、P3 以後與相容錨點。
- 來源 `92107bb`，文件 PR #240 隨 Android draft #239 交付；本機整理及文件檢查完成，master 尚未包含本次歸檔，不改產品／部署或原驗收結果。

## 尚未結束的 P2 門檻

歷史正文已移走，但下列待辦仍有效；不要求為理解目前 Android 包讀整份 P2。

<a id="p2-str01"></a>
#### P2-STR01 灰色正文串流

- 前置：OPT02、OPT05、LAY05 已交付；#214 穩定審核接口仍未合併（2026-10-18 head 80eb850），因此本包未開始。這是 OPT05 完整正文交付之後的額外能力。
- ADK TypeScript 2.1.0 [原生文字串流](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/models/google_llm.ts)可用；現有 gateway 非串流且 StreamingMode.NONE。present_answer 正文在工具參數內，而 [Gemini 3.1 Flash-Lite 不支援工具參數串流](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling#streaming-fc)，不是升 SDK 或單改旗標便完成。
- 收尾使用原生文字串流代替原呈現生成，不先全文再重生一遍；完整正文／引用／收據仍進原校驗、審核、保存管線。工具參數須完整才執行，不從 partial 執行副作用。
- Gateway 聚合回應／終態／用量，每次生成計一次，不按 chunk 計數；中斷缺用量保留未知。送草稿前保留身份／來源／權限／隔離及禁止披露檢查，全文後才語義審核；限額不足停止，不加 run／配額。
- 前端生成中灰字標「未審核草稿」，審核中仍灰；通過並保存後以權威結果原位替換；修正通過只留核准版本，拒絕／取消移除灰正文並留狀態。斷線停增量並查原 run，不改 Server 終態／重做。
- 使用者已明確同意灰色預覽；草稿已披露，不能聲稱未披露，但不入正式歷史、記憶、報告、通知或當執行證據。不傳思考／signature／raw args／其他角色內部，不逐字寫 Firestore、不用假動畫。復用 OPT05 SSE，不加 WebSocket；固定醫療卡獨立即時顯示。
- gate：同批受控正常／拒絕／一次中斷查回，然後一條必要真模型代表流程證明真增量，沿有效授權／費用上限，不擴模型比較或全量。

<a id="p2-str01-handoff"></a>
**接續備忘（2026-10-18 核對；等待協作者審核接口）：**

- **固定基線／未完成：**遠端 master `d4686b7`；正式部署另見 STATUS，不把本地或 master 當成已上線。OPT01～05、LAY01～05 已合併及部署；STR01 尚未實作。已有真進度與最終完整正文，不是逐字草稿。兩份計劃不能整體標完成。
- **外部前置與責任：**#214 仍 open、head `80eb850`；#215 `53c74ac`、#216 `0360f7b` 亦未合併。三包仍由協作者負責，本聊天不接管、不修改／合併其分支、不重做角色。恢復時重核最新 master／PR，不能直接依這份快照整合。
- **最小閱讀與修改接點：**先讀本節及 #214 合併後的正式審核契約，再讀 [ModelGateway](server/model-gateway.ts)、[ADK adapter](server/agent-model-gateway.ts)、[Runner](server/agent-runtime.ts)；傳輸復用 [SSE](server/agent-feedback-stream.ts)、[事件契約](src/shared/agent-feedback.ts)、[客戶端 reader](src/client/agent-feedback-reader.ts) 與 [ChatController](src/client/chat-controller.ts)，畫面沿 [ChatTimeline](frontend/src/components/chat/ChatTimeline.tsx)。按相依符號局部追讀，不重新盤點全倉。
- **恢復次序：**審核接口穩定且合併 → 核對成果／來源版本與審核、保存結果的綁定 → 用同一收尾生成輸出真正文字增量 → 接灰稿／核准替換／拒絕移除 → 只補本節必要驗收。不要以現有引用 ID 校驗代替語義審核，也不要提前展示工具參數、內部思考或自行提高預算。
- **已有證據及限制：**復用 [交付 EV](artifacts/verification/P2_OPT_DELIVERY_20261015.json) 與 [交付 LOG](WORKLOG.md#log-20261015-p2-opt-delivery)。兩次真生成已核持久摘要及公開 SSE／聊天讀回；不重跑已通過項目。灰稿、語義審核交接與真正正文增量仍未驗；原生備份還原仍按原決定延後。回滾與部署限制只見 [正式部署](docs/PRODUCTION_FRONTEND.md#firestore-deployment) 及 STATUS。
- **目前替代工作線：**使用者已批准 [Web／Android 共用產品](#p3-mobile)，從 S04-W01 開始，iOS 等 Android 成品完成後才啟動。STR01 的範圍、前置與證據不取消；備份真還原仍須使用者另行恢復，協作者角色與 P4 家庭功能不納入 Android 開發。

<a id="p2-backup-followup"></a>
#### 延後驗收：原生每日備份還原

- 使用者 2026-10-13 明確要求「這個測試等以後做」，不阻塞 F08／本輪 P2 合併及日常功能使用。每日 14 天排程保持，現有配對備份、獨立刪除日誌及已驗恢復能力不撤回。
- 保留 `scripts/firebase-recovery.mjs` 的 managed restore 入口、相關測試及[還原操作方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。首份原生備份與真原生還原仍未驗，不能用排程存在、本機檢查或其他備份證據代填。
- 下次使用者要求續做時，只核 READY 備份並做一次獨立還原；沿最新 Auth／journal、來源停機與新世代檢查，目標保持暫停，不切產品流量或發通知。重新核實當時資源與本輪 US$1 上限的實際剩餘，不沿用舊餘額假設。沒有續做指示不持續輪詢或新增測試。


<a id="later-phases"></a>
## P3、P4、P5 及暫緩目標

**2026-10-13 本次只更新 P3 手機計劃，不啟動實作。** P2-A09 完整成果 gate 已由 F07／F08 交付並隨 #201 合併；手機包追加 P2-R04 前置，不再把 #140 或過時的待合併快照當作未完成前置。其餘仍寫 P2-A09 的包沿同一承接關係；原生備份還原待驗維持獨立，不取消。

舊 PostgreSQL／pgvector／Compose 是原技術方案或已交付實作對照。使用者已決定捨棄 SQL，F01～F08 為既定遷移方向；S17-W05 等自部署包的歷史 SQL 技術描述不構成新 SQL 建置指令。替代實現與自部署方案留待另外規劃，本次不改需求、完成條件或預先選型。

### 原工作包前移與延後對照

保留原 Sxx 錨點及歷史，只前移本目標所需子範圍，不整包改稱完成；原表各包須與本表一起讀取。

| 原範圍 | 本輪 P2 子範圍／承接包 | 原階段剩餘範圍 |
|---|---|---|
| S09-W03／P3 | Web 歷史、記憶與新對話接續 → P2-A02 | Android／iOS 跨端記憶與既有功能接點 |
| S07-W01／W02／P3 | Web 一致性、重連、未知操作恢復 → P2-A02、P2-A07、P2-A09 | Android／iOS；自選 Server 與完整故障矩陣留原後續範圍 |
| S10-W03／P4 | 官方 PDF、語義換版及必要發布維護 → P2-A04 | 大型後台、規模／效能擴展及通用遷移 |
| S14-W02／P4 | 日常成長檔案、季度／年度與同版 PDF → P2-A05 | 非核心分析及進階分享；既有 PDF 的手機開啟／儲存／分享出口由 P3 S12-W01 承接，不含分享導入 extension |
| S15-W02／P4 | GCP 資料退出、必要備份保留與恢復 → P2-A08、P2-A09 | 跨 Server 搬遷及通用匯入／遷移 |
| 身份／服務缺口 | 邀請、找回、真實資料及穩定交付 → P2-A08、P2-A09 | 社交／電話登入、裝置配對 |


<a id="p3-agent-roles"></a>
### P3 三個後續 Agent

P2 只留最小角色配置／契約；此處明確承接內部實作與原 AC-P2M，不另造通用 runtime、四套服務或資料庫。保留下方原 Android／跨端等工作包。

<a id="p3-m01"></a>
#### P3-M01 審核 Agent

- 階段／狀態／前置：P3；腳本實作已接上聊天完成路徑，真模型／真服務未驗，不標完成；P2-F08。
- 交付：Server 控制的唯讀審核，核原始證據／適用性／內容 hash、版本及輸出範圍；不能創造授權或修改業務。共享 ModelGateway／根預算，不由聊天自行決定免審。每輪上限維持 4，審核占用剩餘一次；`AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS=6` 只在未綁定 run 時採用提案，不提高每日配額，也不覆蓋正式設定快照。
- 必要驗收：沿一條成果核對支持與錯誤引用／版本變更拒絕，保留 P2 程式檢查；對照 AC-P2M-02，不宣稱臨床有效性。合成腳本已覆蓋真實引用但含義不支持、版本變更失效，以及未審核不等於正式成功。真 Vertex／Gemini 與線上驗收仍待使用者批准。M02 的「改一項、其餘保留」不在本包。

<a id="p3-m02"></a>
#### P3-M02 資料編製 Agent

- 階段／狀態／前置：P3；未開始；P3-M01。
- 交付：透過 ADK AgentTool 按需編製可保存／重用、嚴格格式或專門風格的資料；原領域 schema、同 ID 局部修改、審核及必要本人確認後由權威服務保存，不限於 PDF 或另造事實副本。
- 必要驗收：一條指定項修改→其餘保留→保存→新對話讀回，與父 run 共額及取消；承接 AC-P2M-01／02／04 的互動部分。

<a id="p3-m03"></a>
#### P3-M03 背景知識維護 Agent

- 階段／狀態／前置：P3；未開始；P3-M01（不依賴 M02）。
- 交付：排程啟動獨立 Runner，在指定網站範圍讀 HTML／圖片／PDF、整理與核對新版並受限發布；不讀家庭私人資料，不作聊天搜尋子模型。沿現有知識、Storage、Tasks 和發布服務。
- 必要驗收：沒有聊天請求時完成一批有界更新→審核→發布→之後聊天引用；疑義保持候選、越界拒絕及重投防重，承接 AC-P2M-03／04。不得另開 run 重置邏輯工作預算。

<a id="p3-mobile"></a>
### P3 Web／Android 共用產品與 Android 成品交付

**目標：**Web 與 Android 是同一產品的兩個入口，共用功能、資料及業務規則；Android 完成後才開始 iOS。交付正式簽署、可直接安裝及更新的 APK，採 Expo EAS Build／Update，暫不包含 Google Play 上架。本節於 2026-10-15 取代原 Android／iOS 同步交付次序及「Web 只讀取／播放語音」的範圍；原包錨點及有效證據保留。

開工核對 master `21e848b`（#227），#214／#215／#216 仍由協作者處理。沿用現有 Expo 前端、Server、Firebase、ADK、Prompt Pack、原網站及 [DESIGN_SYSTEM](frontend/DESIGN_SYSTEM.md)，不重做設計、不另建手機後端或資料副本。STR01 灰色正文保留原前置，手機先接已交付的真進度 SSE／正式完整回答。只有本計劃相關接點可改，不接管三角色。

#### 已有能力及實際缺口

| 範圍 | 可復用程式／成果 | 尚需接通 |
|---|---|---|
| UI／配置 | Expo 57.0.24、RN 0.86.3、Router 57.0.22、Paper、TanStack Query；NativeAppShell 及共用畫面 | app.json 仍用 preview ID，無 EAS 設定。Android JS 匯出不是 APK／真機證據 |
| 身份／資料 | Firebase client、Server 裝置會話、正式 owner、各領域 API／收據 | owner 依賴 window.location、Cookie 及 Web Origin；需要共同原生 transport／安全會話交換 |
| Agent／同步 | 真進度 SSE、run／操作查回、changes cursor、確認及領域 owner | 原生串流 fetch、AppState／網絡狀態、跨設備接續；背景不能持續輪詢 |
| 輸入／成果 | 照片服務、私人來源、同版文件／PDF、私有加密 Storage | 相機／相簿、原生保存／分享；完整音訊服務及兩端錄音、轉錄、搜尋／播放尚未實作 |
| 通知／更新 | Tasks、授權、安靜時段、投遞台帳、Web Push／Telegram | Android FCM token／投遞接點、簽署、APK／OTA、固定更新入口；iOS 後續另補 |

#### 共用功能、薄 UI 及跨端接續

| 層次 | 唯一責任 |
|---|---|
| Server／業務服務 | 權限、確認、任務／提醒、記憶、引用、Agent、版本、防重及保存 |
| 共用 owner／controller | API、快取、本機草稿、同步、原操作恢復及身份清理 |
| 共用畫面 | 顯示、輸入、互動及載入／錯誤狀態 |
| 平台 adapter | 身份憑據、生命週期、錄音、相機、檔案、通知及系統開啟 |

- 同步已提交訊息、附件、轉錄、執行結果、持久待確認及業務資料。未發送文字、照片、錄音留在原設備，不做雲端草稿同步或離線自動寫入佇列。
- 已提交工作以 Server run／原 opId 為準。另一設備讀取目前工作及已保存結果，不必回放全部進度事件、不重新發問；斷線不是取消，不重新 POST。明確取消沿原 run 更新狀態。
- Web 保持 HttpOnly Cookie；Android 以 Firebase ID token 交換受控裝置會話，用 SecureStore 保存必要憑據。同一身份服務核對邀請、驗證、裝置撤銷及重新認證；不偽造 Origin 或放寬 Web 防護。
- 所有領域共用受控 transport，包括照片、下載、聊天、來源及設定；只向核准 HTTPS API 附帶身份，不讓跨站 redirect 洩露憑據。前端與 Agent 均不直接讀寫 Firestore 業務資料。
- Web 前景事件及 Android AppState／網絡狀態接同一 changes cursor／Query owner。背景停止輪詢，回前景立即核對；修改、確認及完成在其他可見設備同步同一版本，通知執行前再核終態。
- 登出、撤權、切換孩子／身份清快取、停止舊讀取及拒遲到回應。新裝置先核 Server 會話；不把卸載當撤權，不將密碼／key 或業務主庫放普通裝置儲存。
- 聊天、記錄、記憶、待辦、準備單、關注、成長、歷史、私人來源及本人設定兩端承接；管理員後台維持 Web 專用。App 關閉後由 Server 繼續工作，不讓手機常駐 Agent。
- 後端內部、Prompt Pack 或知識更新只要 API 相容，兩端不必重新發布。契約先向後相容部署，不假設每個 App 即時升級。

#### 共用語音及 Android 系統能力

**兩端完整流程：錄音 → 預聽／發送 → Agent 直接理解及辦事 → 背景補轉錄 → 另一設備查閱、搜尋及定位播放。** 不只讓 Web 播放 Android 音檔；不含即時通話或語音回答。

- 優先 Expo Audio 共用操作及畫面，薄 Web／Android adapter 處理權限、編碼與原生差異；沿現有 Gemini 音訊輸入，不增加語音供應商。固定相容版本後才接線，不藉此升整套 SDK。
- 每則首版最多兩分鐘、5 MiB。Server 驗支援格式、大小及實際時長，不能信任副檔名或客戶端宣告，超限不靜默截斷；WebM 等時長 metadata 缺失須正確處理。
- 原錄音沿既有私人加密附件儲存，連結同一訊息、孩子及版本。聊天／孩子刪除連帶音訊、轉錄及搜尋；下載與播放重核權限，不發永久公開 token。
- Agent 直接讀音訊，不等轉錄。清楚普通指令沿有效授權執行；含糊、重要資料及高影響操作沿原確認，不增設一律先確認轉錄的關卡。
- 背景轉錄只產生文字及段落時間標記，沒有業務工具；每份音訊版本最多一次自動生成，不再次執行指令。沿既有 worker、防重、付款路由及每日配額，額度不足保持待轉錄，不提高配額或另開聊天。
- 轉錄標示自動辨識及不清楚部分，保存後復用。搜尋返回原訊息；可靠時間標記可跳播，否則只定位整則，不虛構逐字對齊。後續取相關轉錄／摘要及按需原音訊，不反覆送多年錄音。
- 照片用 Expo ImagePicker（相簿／系統相機），PDF／匯出用 FileSystem／Sharing；共用 Server 校驗與同版成果。按需權限、取消及暫存清理；只補鍵盤、安全區、返回，不重畫 UI。系統分享導入 extension／其他文件輸入仍留 S12-W02。
- Android Expo Notifications 取得 FCM token，Server 加薄投遞 adapter；同一任務／授權台帳保留安靜時段、終態、防重及 unknown。各設備獨立授權訂閱，Web Push 沿用。
- 通知只載最少提示／資源關聯；點擊重新核權，不依 payload 自動確認或完成。完成後停止後續催辦，不聲稱能撤回已送通知。
- 原生採 Expo 串流 fetch 讀現有 SSE，維持 JSON／原 run 查回；不另造 WebSocket 或假打字動畫。

#### 固定更新入口

**改共用畫面就是改同一份程式，不是先改 Web，再重畫 Android。** S04-W03 交付 `mobile:release` 及短交接；後續 AI 沿固定入口判定，沒有必要便不重研原生工程。

| 改動 | 交付 |
|---|---|
| Server／Agent／知識且 API 相容 | 只部署後端 |
| 共用 JS／樣式／資產、原生 runtime 不變 | 更新 Web，發布相容 Android OTA |
| Web 專用接點 | 只更新 Web |
| 原生套件、權限或 runtime 改變 | 新 APK；共用修改另更新 Web |

- `--plan` 零發布，列影響平台、必要檢查、OTA／APK 判斷及未完成前置；再提供 preview、production 及相容 OTA rollback。預設不直接 production，不每次 commit 雲端 build，不購買方案。
- 用 Expo fingerprint／runtime 比較與已發布 build 的相容性；無基線或無法核實須 build／停止，不能猜測、手填舊 runtime 或忽略差異強發。
- 集中固定 application ID、簽署、API 地址、profiles／channels，保存 Git SHA、App／runtime／update ID 及回退位置。私鑰／token 不入 Git、prompt 或公開 App 配置。
- OTA 在安全啟動時套用，不在聊天、待確認或未知提交期間強制 reload；新 APK 同簽署、遞增版本，可覆蓋安裝保留資料。回退畫面不等於回退業務資料。
- EAS 帳號已設定；後續雲端 build、私有程式上傳及新增費用按具體範圍授權。額度用完才決定，不能假定永久免費。原 VM 期限另核，不自動續期。

**官方核對（2026-10-15；非原生實測）：**[Expo Firebase](https://docs.expo.dev/guides/using-firebase/)、[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)、[Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)、[Gemini 音訊](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)、[Expo fetch](https://docs.expo.dev/versions/latest/sdk/expo/)、[FCM](https://docs.expo.dev/push-notifications/sending-notifications-custom/)、[APK](https://docs.expo.dev/build-reference/apk/)、[OTA runtime](https://docs.expo.dev/eas-update/runtime-versions/)、[EAS 費用](https://expo.dev/pricing)。版本及 license 隨實際模組接入固定；文檔能力不當工程已驗。

<a id="p3-android-milestone"></a>
#### 次序與 Android 成品門檻

**S04-W01 → S05-W03 → S07-W01 → S09-W03 → S12-W01 → S13-W02 Android → S04-W03 Android → S16-W03／S17-W03 Android 里程碑。** 每包獨立分支、必要驗收、review、PR／合併後才開依賴包；同一批資料隨包累積證據，不到最後才接後端。

S04-W02 iOS 只在 Android 成品完成後開工。共用包分列 Android 已驗與 iOS 待驗，不能將 Android 交付寫成整個 P3 完成；三角色另依原 M01～M03 及協作者前置，與本里程碑分開。

**最少三條連貫情景：**

1. Web 提交工作 → Android 讀同一 run／結果／確認 → Android 修改或確認 → Web 同步；串一次原操作恢復、版本衝突及身份清理。
2. 兩端錄音／上傳各驗 adapter，只用一段代表錄音跑真 Agent／轉錄；另一端搜尋、定位播放及同一準備單／PDF讀回，不重跑同一模型品質。
3. 一則已授權 FCM → 點擊核權並完成；一次共用畫面修改發布 Web／Android OTA，核相容回退及正式 APK 覆蓋安裝。

使用同批合成資料、一部 Android 手機及一個受支援瀏覽器；復用 Web Push、隔離、防重證據，只補受影響接點。不逐頁 E2E、不全量、機型矩陣、壓測、Computer Use。scripted／bundle／Expo Go 不能代替真模型／正式 APK／真人結果。帳號、權限及真機操作保留必要本人步驟。

完成門檻是**Web／Android 隨時接續已提交工作、核心功能及完整語音共用、正式簽署 APK 可安裝更新、薄 UI 同一權威服務及固定 Web／OTA／APK 交付入口**。首次登入／聊天只是中間里程碑。

### P3 工作包

<a id="s04-w01"></a>
#### S04-W01 共用原生基礎與 Android 首條流程

- 階段／狀態：P3；APK 已安裝登入，主頁、助手及重開、孩子表單展開、鍵盤避讓與清空後輸入框縮回已有真機證據；首條有來源聊天／重開讀回仍待驗。分支 `codex/s04-w01-android-foundation`、draft PR #229。
- 前置：P2-R04、S06-W05；開工基線 `4f88948`，不依賴 STR01／三角色／iOS。
- 交付：正式 App ID／API base、EAS Build／Update、共用 transport、Firebase 原生會話／SecureStore；Web 保留 Cookie／Origin。普通操作與資料沿同一正式 owner，不另建手機業務副本。
- 已驗與修正：合成會話交換／重開／撤銷經正式 Node／API；第三次免費 build `b2fb7fe9` 產生 0.1.0／1，前兩次失敗保留。原生刷新、Paper flat outlineStyle 及折疊量度缺陷已局部修正；真機助手、表單、鍵盤及輸入框核對通過。`8992ce9` 共用送出時清除頭尾空行、連續換行最多兩個，未知保存沿同一文字查回；停止原因直接進保存回覆，來源及收據仍核對。只補兩個定向情景、受影響型別與必要產物，詳見[同一證據](artifacts/verification/S04_W01_ANDROID_FOUNDATION_20261015.json)。
- 發布：相容 Android preview `b44fb753`；原 VM API／worker／Web 已於 2026-10-15 15:49 UTC 更新 `s04-8992ce9`，健康及正式靜態入口通過，保留回退，零遷移。本人明確要求的每日每人 200／全站 400 已保存為政策 v1，不清零用量、不重發停止訊息；其後 #230 已於 16:26 UTC 接入逐輪預算及終結預留，政策 v2 為 8 次生成／4 查詢向量、工具 16，見[預算修正](#agent-budget-followup)。
- 下一步／gate：完成一次正常家長語句的有來源聊天與重開讀回；測試資料身份與問題措辭分開，不在問題硬塞「合成／假設」。使用者手動訊息曾因額度停止，不能算通過，也不自動重送。首條聊天改由使用者驗收；其服務失敗已按 #231 修正但未代填通過。使用者於 2026-10-16 明確允許先準備下一包，合併仍保持 S04 在前；保留已批准最多 1 run／4 生成／2 embedding、<$0.10、無通知的代表核對界線。
- 其餘：搜尋標籤延遲與切頁不順仍待定位，不因此擴大測試或重寫導航。語音、拍照／相簿、PDF、FCM 依下列 Android 工作包接續，未交付圖示不算已接功能；iOS 仍延後。需本人步驟時先做可獨立工作，私有發布依有效授權與工具審查。


<a id="s05-w03"></a>
#### S05-W03 原生憑據、生命週期與清理

- 階段／狀態：P3；兩處會話修正及最低必要本機檢查已完成，相容客戶端已交付；使用者已確認重開保留登入及資料，跨身份／撤銷真機仍待驗；分支 `codex/s05-w03-native-lifecycle`，基於 #229 的 `9e1a9e7`；沿使用者允許的待人工期間先做獨立工作，合併仍等 S04。
- 前置：S04-W01。
- 交付：SecureStore／裝置會話重開、到期、撤銷／退出及近期重認證，暫存與備份排除、身份切換拒遲到回應。基本安全登入已屬 S04-W01；未發送草稿仍本機，不形成業務主庫。
- 本輪修正：無效／到期本機憑據清理後可正常登入；新會話交換令舊請求失效。沿既有 Server 撤銷與近期驗證，不把 Firebase SDK 的暫時清理誤當網站登出。鍵盤過渡仍需真機定位，保留已證實可見的避讓，不盲目撤回。
- 證據：原有正式 Node／API 原生會話情景及失效憑據／遲到回應情景兩項通過，兩個受影響型別入口零診斷；零手機、模型或雲端操作。[本包 EV](artifacts/verification/S05_NATIVE_LIFECYCLE_20261016.json)。
- gate：併入同一帳號流程核重開／撤銷及另一身份不可見；iOS 結果待 S04-W02，不代填通過。

<a id="s07-w01"></a>
#### S07-W01 App／Web 在線同步

- 階段／狀態：P3；程式及最低本機檢查已完成，新版APK已安裝，跨端真機仍待驗；分支 `codex/s07-w01-native-online` 基於 S05 `95f1f6f`（draft #234），依使用者允許先準備獨立工作，合併仍等 S04／S05。
- 前置：S05-W03、S07-W03、P2-F08。
- 交付：AppState／網絡 adapter 接 Query、changes cursor；背景停輪詢／前景核對，跨端同版本、原操作恢復及身份清理，不建離線重送。
- 本輪接點：共用 metadata observer 接 Web 可見事件及 Android AppState／expo-network；前景五秒核對，背景／離線停止，恢復以同一權威服務讀回。原生取消使用可清理的 AbortController／timeout，不假定有瀏覽器 AbortSignal.any／timeout。只取消讀取，不重送業務操作。
- 證據：一條游標／變更／失聯／遲到讀取情景與兩個型別入口通過，零雲端／模型／手機；[S07 EV](artifacts/verification/S07_NATIVE_ONLINE_20261016.json)。新增原生套件必須新 APK，不能向舊 runtime 直接發 OTA；後續原生功能合併建置以免重複。
- gate：復用三條情景中的共用更新／版本衝突／原 opId 查回，不重驗全部 Firestore。

<a id="s09-w03"></a>
#### S09-W03 原生歷史、記憶與既有能力承接

- 階段／狀態：P3；原運行查回及共用畫面接線已實作／本機核對，API／Web 已隨 `mobile-bf47c47` 部署，新版APK已安裝，跨端真機仍待驗；分支 `codex/s09-w03-cross-device-recovery` 基於 S07 `887edaf`（draft #235）。使用者允許先做不需人工的準備；不越過 S04／S05／S07 合併門檻。
- 前置：S07-W01。
- 交付：同一 owner 的聊天、歷史、記憶、任務、文件、關注、來源及本人設定；跨設備接續原 run／待確認／已提交附件，不要求重問。不掛 fixture、不同步未發送草稿；管理後台只留 Web。
- 本輪接點：沿原訊息唯讀查回 runId／狀態；重開後目前最後一則未有回覆的訊息可自動查核，其他舊訊息在「取得／查核原回覆」時先讀原台帳。已存在運行不重新 POST；前景只核對已知處理中的原運行，完成讀回原聊天，未提交草稿不跨設備同步。新設備沿同一取消入口；私人候選及歷史仍讀原 owner／API。
- 證據：一條正式 HTTP／ADK scripted 情景補新客戶端查回、錯身份／孩子、終態及草稿保留，通過；4 個 Server／client 型別入口及 2 個 UI 入口零診斷。首輪錯孩子錯誤映射失敗保留於 [EV](artifacts/verification/S09_CROSS_DEVICE_RECOVERY_20261016.json)，局部修正後只補同一情景。零真模型／手機／雲端。
- gate：已保存成果及目前工作讀回，靜態核對 [UI 接點](docs/P2_UI_HANDOFF.md)，不逐頁 E2E。照片／PDF平台出口與語音交 S12-W01。

<a id="s12-w01"></a>
#### S12-W01 Web／Android 共用語音與原生檔案出口

- 階段／狀態：P3；共用語音／照片／PDF、同一 ADK 音訊、持久轉錄／搜尋／播放、清理／匯出與恢復接線及必要本機證據已保存於 draft #237。新增索引與 API／worker／Web 已隨 `mobile-bf47c47` 部署；新版 APK已完成；一段合成錄音經正式 Agent 理解、原運行讀回、真 worker 轉錄及歷史搜尋通過（合共5生成／1查詢）。Android本機錄音及修正版預聽已觀察到播放進度；Web正式adapter配真Chromium錄音／播放及Server解析已核；正式頁面完整流程、聽感、跨端真機與依賴合併仍待驗。沿 [S12 證據](artifacts/verification/S12_VOICE_PREPARATION_20261016.json)及[同版交付](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)，不把啟動核對當完整語音流程通過；原生備份真還原及 iOS仍延後。
- 前置：S09-W03、S12-W03；Android 不依賴 S04-W02。
- 交付：兩端完整錄音／預聽／發送、Agent 直接理解、持久背景轉錄、搜尋及定位播放；兩分鐘／5 MiB、權限／加密／刪除／付款防重。Android 相片、既有 PDF／匯出與 Sharing；按本節規則不設全體轉錄確認關卡。
- gate：兩端輸入 adapter 加一段代表真音訊及轉錄、另一端讀回／搜尋／播放與同版 PDF；不重複模型品質測試。iOS 另補平台差異，分享導入仍留 S12-W02。

<a id="s12-w05"></a>
#### S12-W05 共用聊天附件與首頁快捷入口

- 階段／狀態：P3；正式runtime、Agent閱讀工具、Web／Android共同owner、下載、匯出、清理及恢復已接線。本機一條連貫情景及受影響型別通過；2026-10-18原站API／worker `files-a12da46`、Web `files-c4ac1b9`已健康並核公開產物hash。一份真Storage合成Word已保存／連聊天，原檔讀取及刪除以原個案補齊；腳本啟動／回傳型別失敗與撤權保留。Android相容OTA已發布（同APK v2 runtime、毋須新APK）；Android首頁原生相機開啟／取消、測試Word選取／草稿／移除已核；原預聽0秒失敗保留；原生修正版0f0144a相容OTA已發布，4秒錄音可播放並前進至1秒，隨後丟棄，沒有上傳或模型。Web選檔／兩端下載及真Agent內容理解仍未驗，見[S12附件證據](artifacts/verification/S12_CHAT_FILES_20261018.json)。
- 前置：S12-W01；接續現有 Android 工作分支，保留原網站、共同 owner、身份、附件服務及原操作恢復。
- 範圍：首頁左下角保持一按開原生相機，確認／取消後返回 App；語音及文字快捷入口連回同一聊天草稿。附件入口允許選取各類檔案，包括 PDF／Word；不做文件內容預覽，附件卡顯示檔名、大小及「不支援預覽」，另保留必要的上傳狀態；不預先顯示「尚未讀取內容」。首版每則一份、最多20 MiB，未送出原檔留本機。
- 保存／讀取：使用同一 Server、Firestore metadata／原收據及私人加密 Storage；已提交附件連回原訊息，兩端可查回及下載。未知上傳先查原操作，身份切換清除本機資料；孩子／帳戶刪除、匯出及隔離還原須納入相同附件生命週期。
- 內容能力：檔案可上傳不等於 Agent 已讀懂。復用成熟解析器處理 PDF／DOCX／純文字等已支援格式；輸出有界片段及完整度，不把原始二進位直接塞進 prompt。所有格式均可保存及下載；是否支援畫面預覽不限制 Agent 讀取。實際處理不支援、受保護、損壞或抽取不足時，才回報具體原因並保留原檔；不執行檔案、不虛構已讀內容。
- 最少 gate：一條共用選檔→原操作保存→聊天引用／讀回→下載及刪除流程，串核一次隔離與未知查回；復用既有音訊／照片及備份證據，只補新增文件接點，不全量測試或逐格式跑模型。PDF／Word 內容品質與任意檔案保存分開報告。

<a id="s13-w02"></a>
#### S13-W02 原生本人通知

- 階段／狀態：P3；draft #238（`codex/s13-w02-android-push`）接續 #237。FCM adapter、索引與原站 API／worker 已啟用，APK v2已安裝。使用者親自允許通知；一則指定測試已保存投遞收據、渠道接受並在手機顯示，點擊可返回App。照護目標核權導航／完成停止及依賴合併仍待核，iOS 待後續。
- 前置（Android）：S12-W01 Android、S07-W01、S13-W07；iOS 另依 S04-W02。
- 本機結果：固定 Expo Notifications 57.0.21；FCM 單次 adapter、Firestore 加密綁定／原收據、同裝置 token 輪換／會話撤銷、提醒／通知歷史／匯出及還原、正式 API／worker、共用設定及核權點擊已接線。新增一條本機合成流程通過，受影響型別及配置語法通過；不把替身當真 Firestore 競爭或真 FCM。證據見 [S13 準備](artifacts/verification/S13_ANDROID_PUSH_PREPARATION_20261018.json)。
- 雲端配置（2026-10-18）：同專案 Android package、專用受限 key、原 VM 最小 FCM IAM 及 Expo preview secret file 已配置。10 個共用語音／通知索引、6 項欄位設定均 READY；`mobile-bf47c47` 已部署並啟用原生通知 adapter。部署當時只有啟動／資料查詢與公開入口證據；其後同機註冊及唯一一次真FCM結果見[S13 EV](artifacts/verification/S13_ANDROID_PUSH_PREPARATION_20261018.json)，[交付 EV](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)。
- 下一步／未驗：APK正常開啟、原資料保留、本人授權及一則指定FCM顯示已有證據；只欠照護目標核權導航／完成停止及依賴合併，不重發一般測試。
- 交付：Expo Notifications／Android FCM token 註冊、輪換／撤銷與薄投遞 adapter，沿既有 Tasks／授權／偏好／安靜時段／終態／unknown；Web與App各設備授權、同一任務。
- gate：一則明確批准通知、點擊重新核權及完成停止；不重發 Web Push／Telegram。iOS APNs 是另一平台子範圍，不能拿 FCM token 代替 APNs。

<a id="s04-w03"></a>
#### S04-W03 固定發佈入口、App 更新與 Android 交付

- 階段／狀態：P3；按使用者「人工 gate 待驗、先做獨立工作」指示開始本機發布工具，draft #239（`codex/s04-w03-mobile-release`）接續 draft #238；固定入口、相容Web／OTA發布及同簽署APK升級已有結果；S12／S13合併、剩餘真機及OTA回退gate保留。
- 本包範圍：離線發布判斷、官方 fingerprint 核對、固定 EAS CLI／channels、相容 OTA 回退及有界 manifest；Web 沿原 VM 產物／部署，不改產品設計或自動購買／上傳。
- 結果：固定入口及短交接、離線判斷與兩端正式 bundle 已通過；`bf47c47` Web／API／worker 已部署。一次 preview APK `82cb911e` 已完成（versionCode 2），固定發布工具已記錄相符的 runtime／fingerprint 基線；兩個實際 APK 的官方簽署驗證、同 applicationId／證書及遞增 versionCode 已核對。使用者於2026-10-18確認覆蓋安裝後能正常開啟、原資料仍在；ADB亦核對versionCode 2。鍵盤遮擋及站內導航誤擋已局部修正並交付同版Web／相容OTA，一條真機輸入／清除／鍵盤開合有結果；動畫細節、回退及其餘功能仍待驗。[交付 EV](artifacts/verification/S04_MOBILE_RELEASE_20261018.json)／[固定入口](docs/PRODUCTION_FRONTEND.md#mobile-release)。
- 前置（Android）：S12-W01 Android、S13-W02 Android；iOS 待 S04-W02 後補同平台結果。
- 交付：本節 `mobile:release --plan`／preview／production／OTA rollback，fingerprint、固定身份與 channels、release manifest／短交接。Web及Android共用修改沿同入口交付，新原生 runtime 出 APK、相容 JS 出 OTA。
- gate：一次共用修改 Web＋OTA、相容回退及正式同簽署 APK 升級；不為每個判斷分支另做雲端 build，不在未完成工作／unknown 中強制 reload。

<a id="s16-w03"></a>
#### S16-W03 P3 必要整體驗收

- 階段／狀態：P3；Android 里程碑未開始；完整 P3 未完成。
- 前置（Android）：S04-W01、S05-W03、S07-W01、S09-W03、S12-W01 Android、S13-W02 Android、S04-W03 Android。
- 交付／gate（Android）：合併本節三條情景證據，只補跨包缺口；不重跑各包已通過項目。無 iOS／三角色前置，不把有限檢查當整個 P3 完成。
- 完整 P3 gate：另完成 S04-W02 及共用包的 iOS 子範圍、P3-M01／M02／M03；保留其依賴及未驗結果。

<a id="s17-w03"></a>
#### S17-W03 P3 發佈與維護交付

- 階段／狀態：P3；Android 里程碑未開始；完整 P3 未完成。
- 前置（Android）：S16-W03 Android。
- 交付（Android）：正式簽署可安裝／更新 APK、同版正式 Web、Git／App／runtime／update／API版本、安裝、權限、固定更新、回退及限制。Google Play 上架不在本輪。
- 完整 P3 gate：另完成 S16-W03 全範圍及 iOS 受控交付，才可宣稱整個 P3 完成；不將 Android 中間結果提前作 P4 全範圍前置。

<a id="s04-w02"></a>
#### S04-W02 iOS 接線與可安裝首版

- 階段／狀態：P3；未開始，明確排在 Android 成品之後。
- 前置：S17-W03 的 Android 里程碑（不是完整 P3，避免循環依賴）。
- 交付：同一 Expo 應用啟用 iOS、bundle ID／簽署、Keychain、回跳及 TestFlight／受控安裝；共用能力沿 Android，補 iOS 錄音／檔案／通知／更新差異，不重畫頁面。
- gate：iPhone 核心／平台流程及共用包 iOS 子範圍；帳號、簽署、真機未就緒標待驗，Web／simulator 不代填。公開 App Store 另按授權與審核結果處理。

### P4 工作包

<a id="p4-family"></a>
#### P4-FAMILY 完整家庭多人接線

- 狀態：未開始；前置 P2-R04。2026-10-13 使用者明確延後，不以隱藏入口當功能完成。
- 復用原家庭 UI／API 契約，補 Firestore 成員、邀請、owner／caregiver／viewer、撤權及跨領域共享讀寫、背景與附件權限；私人內容維持本人隔離。恢復入口前以合成邀請／角色／撤權連貫流程核對，不只把 503 改空集合。
- P3 手機只承接當時已啟用的本人功能；本包完成後沿共用 owner 接 Web／App，不另建副本。


<a id="s06-w04"></a>
#### S06-W04

- 階段／狀態：P4；未開始。
- 前置：S17-W03。

**目標、局部驗收及範圍界線：**使用者選擇相容 Server API；確認地址、版本／能力及身份，憑據隔離，不自動把舊 Server 家庭資料送往新地址

<a id="s17-w05"></a>
#### S17-W05

- 階段／狀態：P4；未開始。
- 前置：S06-W04。

**目標、局部驗收及範圍界線：**Windows Docker Desktop／WSL2 前置檢查、Compose 設定與少步啟動 API／worker 及相容 Firestore 接點（不重新引入 PostgreSQL／pgvector）；儲存持久化、私密配置、TLS 與操作限制說明；驗沒有 GCP 附加身份且關閉 AI 時仍可使用核心資料及確定性任務，Gemini／外部通知另驗，不宣稱離線模型

<a id="s08-w01"></a>
#### S08-W01

- 階段／狀態：P4；未開始。
- 前置：S06-W04。

**目標、局部驗收及範圍界線：**QR／短碼／已登入裝置確認、裝置撤權及臨時電腦會話；拒絕重放／過期，客戶端直接連 Server，不作手機資料中繼

<a id="s10-w03"></a>
#### S10-W03

- 階段／狀態：P4；未開始（必要維護前移）。
- 前置：S17-W03、S10-W02、P2-A04。

**目標、局部驗收及範圍界線：**沿 P2 RAG 擴充大型管理頁、大規模導入／批量重建管理、效能與通用遷移。官方 PDF、語義換版及必要發布維護前移 P2-A04；不另建向量／引用權威。

<a id="s12-w02"></a>
#### S12-W02

- 階段／狀態：P4；未開始。
- 前置：S17-W03、S12-W01、S12-W04。

**目標、局部驗收及範圍界線：**系統分享及其餘既定平台 adapter；來源／確認／權限與失敗行為完整

<a id="s07-w02"></a>
#### S07-W02

- 階段／狀態：P4；未開始（Web 必要項前移）。
- 前置：S08-W01、S07-W01、S12-W02。

**目標、局部驗收及範圍界線：**完整跨端故障矩陣、附件中斷及不同 Server 邊界；Web 必要重連／unknown 前移 P2-A02／A07／A09，原 S07 剩餘 AC 仍須結案。

<a id="s13-w03"></a>
#### S13-W03

- 階段／狀態：P4；未開始。
- 前置：S07-W02、S13-W02。

**目標、局部驗收及範圍界線：**Server 切換的任務／授權交接、唯一執行、舊執行者失效與必要審計；為正式遷移提供切換邊界

<a id="s14-w02"></a>
#### S14-W02

- 階段／狀態：P4；未開始（成長成果前移）。
- 前置：S10-W03、S12-W02、P2-A05。

**目標、局部驗收及範圍界線：**原生分享、雙端預覽及非核心分析；日常成長、完整季度／年度與同版 PDF 前移 P2-A05，來源／更正語義沿用。

<a id="s15-w01"></a>
#### S15-W01

- 階段／狀態：P4；未開始。
- 前置：S13-W03、S17-W05。

**目標、局部驗收及範圍界線：**Server 搬遷、資料／身份／附件／知識／任務完整性核對、確認後切換權威 Server；失敗不提早停用來源

<a id="s15-w02"></a>
#### S15-W02

- 階段／狀態：P4；未開始（GCP 必要恢復前移）。
- 前置：S15-W01、S14-W02、P2-A09。

**目標、局部驗收及範圍界線：**跨 Server 搬遷、通用備份／遷移及保留新寫入 rollback。GCP 配對加密備份／保留／空環境恢復前移 P2-A08／A09；不能恢復已撤權／終態工作。

<a id="s16-w04"></a>
#### S16-W04

- 階段／狀態：P4；未開始。
- 前置：P4 全部功能包。

**目標、局部驗收及範圍界線：**現行 AC 全量追溯及原條款替代核對；完整成本／快取／權限／過期／可用性驗收先按驗證制度批准

<a id="s17-w04"></a>
#### S17-W04

- 階段／狀態：P4；未開始。
- 前置：S16-W04。

**目標、局部驗收及範圍界線：**全部 APK／Web／源碼配置／Windows 部署／知識／遷移／許可／操作說明／證據交付，另一組員可重現

<a id="p5-future"></a>
### P5 以後升級版

只包含另行確認的非必要增值；不阻塞 P1～P4，不接收尚未完成的必要功能，不預建空框架。尚無獨立已確認的 P5 工作包。

<a id="p2-agent-roles"></a>
### 四角色 Agent：保留接口目標，內部實作轉 P3

本節保留 2026-10-08 的四角色目標作接口與後續範圍對照；2026-10-09 已由 [ADR-021](docs/DECISIONS.md#adr-021) 收窄當前實作。依 ADR-024，下列角色內部、兩條四角色流程、6 次預算提案及 AC-P2M 全量門檻由 [P3-M01～M03](#p3-agent-roles) 承接，不是本輪 F01～F08 依賴；只有聊天與接口按 [當前入口](#active) 推進。原提案取代「文件生成 Agent」／聊天搜尋子模型式資料收集，但不授權現在開始內部實作。產品要求與四條 AC 見 [SPEC](SPEC.md#p2-agent-roles)，編排見 [架構](docs/ARCHITECTURE.md#p2-agent-roles)，決策見 [ADR-020](docs/DECISIONS.md#adr-020)。

#### 目標、現況與交付範圍

家長只面對同一育有方助手：自然交代、查證及辦事，必要時編製可保存／重用的資料，再看真實結果。不是每輪都運行四個 Agent，也不把所有普通操作改為生成文件。

| 角色 | 工作與邊界 |
|---|---|
| 聊天 | 理解口語及多輪指向、補問、檢索已發布知識／歷史、使用業務工具與按需委派，保持唯一對話入口 |
| 資料編製 | 整理需保存／重用、嚴格格式或專門風格的資料；包括準備內容、成長整理、照護說明、有用記憶／摘要與待辦草案，不限文件 |
| 審核 | 唯讀原始證據，核對實質回答／編製成果／知識更新的含義、引用、適用性與披露範圍；不能代家長同意或自行寫業務／發布 |
| 背景知識維護 | 獨立於聊天，在核准網站／路徑內自主讀目錄與連結、取得圖片／PDF 等新版、整理資料並經檢查後更新知識庫；沒有家庭私人資料權限 |

基線 `e6842fc` 已有單一 ADK 工具循環、引用身份／版本校驗、文件版本與局部修改、來源刷新／發布及文字 PDF 抽取；尚缺四角色委派、獨立語義審核、官方視覺資料理解與跨角色共同預算。已有能力與失敗／未驗證據保留，不把本文件當 runtime 已接通。

#### 暫緩的四角色流程與結果對照

- **互動：**家長交代 → 聊天查詢／操作 → 必要資料編製 → 審核 → 按授權保存或待確認 → 真收據回報／各頁同步。清楚的普通記錄、勾選、改期仍可直接走現有工具；不為確定性操作額外調模型。
- **知識維護：**排程或管理入口 → 背景讀取指定網站 → 整理／比較新版 → 審核與程式檢查 → 自動發布／更新／停用 → 供之後查詢。沒有聊天請求亦可運作；聊天搜尋直接用 KnowledgeRetriever，缺口只記待補，不擴大爬取或採信未核內容。
- **資料而非副本：**輸出依領域 schema 進原記憶／任務／文件服務；待辦是任務，網頁／卡片／PDF 是同版資料的呈現。既有成果局部修改保持 ID／版本／原 opId；草稿和正式成果分開，推測不升格事實，審核不代替重要操作確認；更正／撤權／失效同步影響衍生物。
- **審核：**重要含義以原始證據核對，不只驗引用 ID／hash。結果綁成果內容、來源版本、對象及範圍；改動須重新核對，未通過不正式保存或呈現。純澄清／確定性收據免額外模型，官方緊急求助內容可立即呈現；不宣稱零錯誤或臨床有效性。
- **自主維護：**指定網域／路徑／主題／使用範圍內，可有界跟進站內連結；原文、模型抽取與整理分開，圖片／PDF 保留原始頁面、版本與完整度。未變內容復用，長資料分批保存進度；檢查通過自動更新，含義不明／矛盾保留候選，抓取暫失不當失效。不得修改執行醫療／成長規則或把家庭／私人付費來源混公共庫。

#### 暫緩的預算、次序及驗收提案

以下保留原規劃，未啟用，不提高現行限額。互動的所有角色共用最多 **6 次生成**，包含委派、審核及修正；不是每角色 6 次。8 工具、2 次 query embedding、90 秒、每次輸出及上下文上限與每日配額不提高，本人更低上限仍有效。預留審核呼叫，餘額容許才最多一次修正／重核；耗盡保存進度，不新開 run 繞限。背景知識維護使用獨立有界工作／平台預算，不用家長私人 key；未變內容不重做模型整理。細節與目前配置分界見[運行配置](docs/ARCHITECTURE.md#p2-agent-budgets)。

角色工作次序改由 P3-M01 審核 → P3-M02 資料編製／P3-M03 背景維護承接；原把角色內部塞入 F03～F05 的安排不再有效。主模型親寫契約及角色 prompt，沿既有 manifest 按需補模組，不複製四套 Prompt Pack，不重做前端。

四角色日後恢復實作才適用的驗收為 [AC-P2M-01～04](SPEC.md#ac-p2m-01)：模糊交代後有依據的可重用成果／新對話及跨頁讀回；指定項修改與版本／引用拒絕；無聊天時取得視覺來源新版、核對發布後可引用；範圍／私人隔離、重投遞及根預算控制。合併連貫情景並復用有效證據，不為四角色各跑整套 E2E；真服務／雲端沿各包批准成本邊界，不用 Computer Use。

2026-10-08 該次只有文件定案、連結／依賴／diff review，未修改程式或 Prompt Pack、未呼叫模型、部署或建立資源。現在的唯一實作入口是 [#active](#active)；#140 已收束，F02 實證及原 A09 聊天成果門檻仍保留。

<a id="steps"></a>
## 步驟範圍與結案

Sxx 是跨階段範圍；結案須其所有有效包及 AC 完成。此表只列範圍、完成條件與唯一正文入口，不另維護狀態或下一步。SQL／Better Auth／pgvector 名稱在此指既有實作，遷移路線見 F01～F08。

<a id="s04"></a>
### S04 Android／iOS 同一縱向流程

- 範圍：重用 Server、共享業務與既有設計的在線 App、原生接點及可維護更新
- 完成條件：兩平台可安裝並完成必要真機流程；不以 Web／bundle 代替，OTA 與 API 相容／回退可核對
- 工作包：[S04-W01](#s04-w01)、[S04-W02](#s04-w02)、[S04-W03](#s04-w03)。

<a id="s05"></a>
### S05 記錄與資料保護

- 範圍：確認、更正、時間軸、搜尋、Server 加密／刪除／備份及平台安全保存
- 完成條件：原文、約數、時間、修訂與來源保留；備份還原可核對；[資料規則](docs/DATA_MODEL.md#section-5-1)
- 工作包：[S05-W01](#s05-w01)、[S05-W02](#s05-w02)、[S05-W03](#s05-w03)。

<a id="s06"></a>
### S06 Server 身份與資料

- 範圍：TypeScript、PostgreSQL、Better Auth、家庭權限及相容 Server 連線
- 完成條件：真實登入／持久化、跨家庭隔離、私人聊天邊界及 Server 選擇；[權限驗收](SPEC.md#section-10-5)
- 工作包：[S06-W03](#s06-w03)、[S06-W01](#s06-w01)、[S06-W02](#s06-w02)、[S06-W05](#s06-w05)、[S06-W04](#s06-w04)。

<a id="s07"></a>
### S07 在線更新與一致性

- 範圍：請求冪等、版本／衝突、跨端更新、附件狀態、刪除與撤權
- 完成條件：中斷／重試／並行操作不靜默丟資料，終態不復活；[一致性驗收](SPEC.md#section-10-2)
- 工作包：[S07-W03](#s07-w03)、[S07-W01](#s07-w01)、[S07-W02](#s07-w02)。

<a id="s08"></a>
### S08 裝置配對與臨時會話

- 範圍：QR／短碼、已登入裝置確認、臨時電腦、裝置管理及撤權
- 完成條件：拒絕過期／重放／未批准連線；裝置直接連 Server；[配對契約](docs/API.md#section-4-1)
- 工作包：[S08-W01](#s08-w01)。

<a id="s09"></a>
### S09 聊天與長期記憶

- 範圍：原始聊天、確認事實、摘要、話題與任務台帳
- 完成條件：新會話／換端／清空模型快取後從 Server 重建授權記憶；[記憶驗收](SPEC.md#section-10-3)
- 工作包：[S09-W01](#s09-w01)、[S09-W02](#s09-w02)、[S09-W03](#s09-w03)。

<a id="s10"></a>
### S10 知識與資訊更新

- 範圍：官方來源、pgvector／embedding、引用、版本、近期資訊、定期更新及管理擴充
- 完成條件：最小向量 RAG、穩定／近期隔離、發布／停用及 freshness 正確；[知識驗收](SPEC.md#section-10-4)／[向量驗收](SPEC.md#ac-p2-vector-rag)
- 工作包：[S10-W01](#s10-w01)、[S10-W02](#s10-w02)、[S10-W03](#s10-w03)。

<a id="s11"></a>
### S11 Gemini 與 Agent 編排

- 範圍：P1 文字聊天；P2 ADK 基礎、Prompt Pack 接線、結構化草稿／確認及互動／背景工具循環
- 完成條件：真實工具及結果回饋，模型不能繞過權限；配額及失敗可核對；[Agent 驗收](SPEC.md#ac-p2-agent-loop)
- 工作包：[S11-W01](#s11-w01)、[S11-W03](#s11-w03)、[S11-W02](#s11-w02)。

<a id="s12"></a>
### S12 照片、語音與分享輸入

- 範圍：Web 照片、主動分享、公開來源及 Android 語音／相機／系統分享
- 完成條件：來源可追溯；數字及不確定內容確認；拒絕權限與失敗明確；[輸入邊界](SPEC.md#section-1-5)
- 工作包：[S12-W03](#s12-w03)、[S12-W04](#s12-w04)、[S12-W01](#s12-w01)、[S12-W05](#s12-w05)、[S12-W02](#s12-w02)。

<a id="s13"></a>
### S13 主動任務、聯絡與家庭交接

- 範圍：Server worker、任務／授權、成長階段關注、Web Push／Telegram／FCM、fallback 與交接
- 完成條件：唯一執行、撤權即停、終態不復活；發送／回應／完成分開；[任務驗收](SPEC.md#section-10-3)／[成長關注驗收](SPEC.md#ac-growth-attention)
- 工作包：[S13-W01](#s13-w01)、[S13-W04](#s13-w04)、[S13-W05](#s13-w05)、[S13-W06](#s13-w06)、[S13-W08](#s13-w08)、[S13-W07](#s13-w07)、[S13-W02](#s13-w02)、[S13-W03](#s13-w03)。

<a id="s14"></a>
### S14 摘要與報告

- 範圍：多孩子、到診準備、日／週摘要、趨勢及 PDF
- 完成條件：數字由程式計算，來源／版本可追溯，更正後產生新報告；[報告規則](SPEC.md#section-5-8)
- 工作包：[S14-W01](#s14-w01)、[S14-W02](#s14-w02)。

<a id="s15"></a>
### S15 Server 搬遷與災備

- 範圍：統一匯出、Server 搬遷、加密備份、空環境恢復與 rollback
- 完成條件：身份／資料／附件／知識／任務完整，切換單主，rollback 保留新寫入；[災備驗收](SPEC.md#section-10-6)
- 工作包：[S15-W01](#s15-w01)、[S15-W02](#s15-w02)。

<a id="s16"></a>
### S16 驗證與成本核對

- 範圍：相關功能、四年齡段、權限／故障／成本及可用性驗收
- 完成條件：全部有效 AC 有證據；高成本驗證先獲批准，缺驗收用待驗收；[驗證制度](#verification)
- 工作包：[S16-W01](#s16-w01)、[S16-W05](#s16-w05)、[S16-W02](#s16-w02)、[S16-W03](#s16-w03)、[S16-W04](#s16-w04)。

<a id="s17"></a>
### S17 交付與接續能力

- 範圍：Web／APK、Windows 部署、源碼配置、操作及接續資料
- 完成條件：另一位組員可依說明使用並重現；[交付驗收](SPEC.md#section-10-8)
- 工作包：[S17-W01](#s17-w01)、[S17-W02](#s17-w02)、[S17-W03](#s17-w03)、[S17-W05](#s17-w05)、[S17-W04](#s17-w04)。



<a id="roadmap-packages"></a>
### 工作包、階段與依賴

前置原則上指已驗收並合併的工作包；既有 P2 隔離分支依[收束安排](#p2-deferred-acceptance) 完成必要驗收及合併，不再新增延後驗收的接續例外。S16 的「本階段全部功能包」按該次結案範圍固定：S16-W02 只涵蓋原 P2 功能包，不包括 S06-W05、INT 或 P2-A01～A09 等後續增補，避免把已結案 S17-W02 反向接回新包。未結案階段包括其所有功能包（P4 包含 S17-W05），不包括該階段 S16 驗收包及 S17-W01／W02／W03／W04 結案交付包。父 Sxx 的有效 AC 與局部驗收共同適用。

新增驗收包括 [Server／授權外發 AC](SPEC.md#ac-server-agent)、[freshness AC](SPEC.md#ac-knowledge-freshness)、[P2 知識 AC](SPEC.md#ac-p2-knowledge)、[成長關注 AC](SPEC.md#ac-growth-attention)、[ADK／完整流程 AC](SPEC.md#ac-p2-agent-loop)及[最小向量 RAG AC](SPEC.md#ac-p2-vector-rag)，隨所屬功能包驗收；原 AC 的修訂按 [替代索引](docs/DECISIONS.md#adr-008-replacements) 追溯。

通用能力先復用現有程式／Skill，再核對同版本 Google／Expo 原生能力及必要成熟候選；[選型與驗證閘](docs/TECH_REUSE.md#decisions) 按包使用，文件相容不代表已實測。已完成 P1／P2 成果不為換框架返工。前端聊天／主聊天的責任及共享修改次序依 [AGENTS](AGENTS.md#frontend-backend)，混合工作包須兩邊交付並完成相關整合驗收才結案。


- [原 P2](#p2-delivered)／[INT](#production-integration)／[P2-A](#p2-agent-service)／[P2-F](#p2-firestore-migration)。
- [P3／P4](#later-phases)；P1 的完整正文見下方。



<a id="states"></a>
## 状态

步骤和工作包仅使用下列五种状态。实现与证据层级不是额外状态。

| 状态 | 含义 |
|---|---|
| 未開始 | 尚未開始該步驟／工作包；已有研究只是輸入 |
| 進行中 | 正在實施，或驗證失敗後繼續修復；跨階段 Sxx 部分包完成亦屬此狀態 |
| 受阻 | 缺少必要条件导致无法推进；记录原因、所缺条件及解除方法 |
| 待驗收 | 实现准备完成，但必需测试或人工确认尚未完成 |
| 已完成 | 实现、全部必需验证和记录均完成 |

<a id="verification"></a>
## 验证与证据层级

| 用语 | 含义 | 依据 |
|---|---|---|
| 已确认 | 设计或需求确定 | SPEC／ADR／用户决定 |
| 已实现 | 代码确实存在 | 文件与修改版本；文档迁移只能说明文档已写入 |
| 已验证 | 指定场景实际通過 | 命令或人工步骤、环境／版本、結果与证据 |
| 已完成 | 实现、全部必需验证和记录齐备 | 本步驟必要驗收及證據齊備；按文件職責更新受影響位置 |

驗證範圍、成本、批准與失敗停批統一依 [AGENTS 驗證與收尾](AGENTS.md#finish)。此處只定義證據層級及下列既有分支例外，不複製另一份測試規則。

<a id="historical-entry"></a>
## 歷史及相容入口

整理前完整原文、Git 版本與 SHA-256 見 [固定快照索引](_archive/README.md#plan-20261011)。當時的未完成、下一步、批准及分工不因保留而成為現行指令。

<a id="current-capability-gaps"></a>
### 新前端能力差距（2026-10-07 源碼核對）

`0a39e018` 的七項完整差距快照保留於[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#current-capability-gaps)。A02～A07 後續已合併；真引用、同文件修改、新對話讀回及正式服務仍由 [F07](#p2-f07)／[F08](#p2-f08) 承接，不能把舊快照再次當未開始清單。前端原深連結保留此入口。

<a id="team-package-allocation"></a>
### 四人工作包責任預分配

人員責任、歷史預分配、權重／份額及署名操作已歸既有本機協作文件；只在分配／署名／交付時按 [AGENTS 本機協作指引](AGENTS.md#team-contributions) 讀取，不納入 Git。沒有重算或改寫歷史貢獻。

<a id="extension-boundaries"></a>
### 共享邊界與漸進實作

原 P2 接續的版本／分支／驗收批准保留於[固定歷史原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#extension-boundaries)，不是新的待辦。DataStore／ModelGateway／AgentRuntime／AttachmentStore／KnowledgeRetriever／TaskExecutor／NotificationGateway 及 SyncEngine 的職責由 [API](docs/API.md#section-3-3) 維護；共享 TypeScript／薄 adapter／Server 權威依 [架構](docs/ARCHITECTURE.md#section-3-1)，執行範圍依 [AGENTS](AGENTS.md#scope)。

<a id="packages"></a>
### 工作包与有限并行

工作包範圍、前置合併、Git、模型與並行、前後端修改歸屬統一依 [AGENTS](AGENTS.md#scope)／[Git 工作流](AGENTS.md#git-workflow)／[模型分工](AGENTS.md#models)／[前後端分工](AGENTS.md#frontend-backend)。預覽不當正式接線；S16-W05 的共用基礎由 S16-W03／W04 延續，不延後各功能包必要驗收。

工作包记录格式：

```text
工作包 ID：Sxx-Wxx
所属步骤：
階段／前置工作包：
狀態：未開始 / 進行中 / 受阻 / 待驗收 / 已完成（選一）
目标：
关联 REQ／AC：
修改范围：
前後端交付／共享契約與修改歸屬（適用時）：
復用結論／必要候選及未驗證項（一句或引用既有研究即可）：
範圍外：
验证方法：
完成证据：
```

<a id="section-7-reuse"></a>
### 技術與開源復用原則

<a id="rule-7-reuse-01"></a>
<a id="rule-7-reuse-07"></a>
執行及許可／歸屬保留規則見 [AGENTS 技術研究](AGENTS.md#technical-skills)；家庭授權、任務終態、外發去重與安全由項目掌管，採用見 [TECH_REUSE](docs/TECH_REUSE.md#decisions)。

<a id="rule-7-reuse-02"></a>
<a id="rule-7-reuse-03"></a>
<a id="rule-7-reuse-04"></a>
<a id="rule-7-reuse-05"></a>
<a id="rule-7-reuse-06"></a>
S01 的 coo-ai-agent、Baby Buddy、CareLoop、BreastfeedingTracker、UNICEF Bebbo 研究用途與不採用／參考邊界保留於[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#section-7-reuse)及[研究歷史索引](_archive/README.md)；不是新的預設首查或產品底座。已完成成果不為換框架返工。

<a id="p2-deferred-acceptance"></a>
### 按包驗收與既有 P2 隔離分支收束

2026-09-28 的集中驗收安排、2026-09-30 恢復按包驗收及既有分支收束方式是歷史；原二十包已結案。固定前置、未驗項及原證據仍按各包保留，不必重建成果，不得用歷史例外開新的未驗依賴包。原主聊天 `01a0c876-a538-7a51-8b99-648131cc56f4` 的免逐次詢問只限該聊天及原操作／成本，不延伸本聊天、部署、續期或新資源。

完整歷史條款與當時批准見[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#p2-deferred-acceptance)；現行批准、失敗停批、必要驗收／合併及真機反饋依 [AGENTS](AGENTS.md#finish)。程式準備好不等於完成，真機欠驗用待驗收；必要環境缺失且無法繼續用受阻。

<a id="maintenance"></a>
### 计划与规范维护

文件職責、更新及凍結／歷史追溯只依 [AGENTS 文件更新邊界](AGENTS.md#document-updates)。保留穩定 REQ／AC／S／工作包／ADR／LOG／EV／SRC 與舊錨點；替代關係見 [ADR-001](docs/DECISIONS.md#adr-001)／[ADR-005](docs/DECISIONS.md#adr-005)／[ADR-008](docs/DECISIONS.md#adr-008)／[ADR-009](docs/DECISIONS.md#adr-009)，回查歷史先讀 [_archive 索引](_archive/README.md)。




<a id="p1-p2-archive"></a>
## 舊錨點相容入口（不屬日常閱讀內容）

以下只保留外部連結與舊包依賴；不是第二份當前計劃。歷史詳情只在指定歸檔位置，未驗／失敗證據保持原狀。

| 原入口 | 按需查看原文 |
|---|---|
| <a id="agent-budget-followup"></a>`agent-budget-followup` | [歷史原文](_archive/plans/P1-P2-20261018.md#agent-budget-followup) |
| <a id="p2-optimization"></a>`p2-optimization` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-optimization) |
| <a id="p2-opt01"></a>`p2-opt01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt01) |
| <a id="p2-opt02"></a>`p2-opt02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt02) |
| <a id="p2-opt03"></a>`p2-opt03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt03) |
| <a id="p2-opt04"></a>`p2-opt04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt04) |
| <a id="p2-opt05"></a>`p2-opt05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-opt05) |
| <a id="p2-layering-streaming"></a>`p2-layering-streaming` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-layering-streaming) |
| <a id="p2-lay01"></a>`p2-lay01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay01) |
| <a id="p2-lay02"></a>`p2-lay02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay02) |
| <a id="p2-lay03"></a>`p2-lay03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay03) |
| <a id="p2-lay04"></a>`p2-lay04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay04) |
| <a id="p2-lay05"></a>`p2-lay05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-lay05) |
| <a id="p2-adm01"></a>`p2-adm01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-adm01) |
| <a id="p2-review-repair"></a>`p2-review-repair` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-review-repair) |
| <a id="p2-r01"></a>`p2-r01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r01) |
| <a id="p2-r02"></a>`p2-r02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r02) |
| <a id="p2-r03"></a>`p2-r03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r03) |
| <a id="p2-r04"></a>`p2-r04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-r04) |
| <a id="p2-completion-execution"></a>`p2-completion-execution` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-completion-execution) |
| <a id="chat-capacity-recovery"></a>`chat-capacity-recovery` | [歷史原文](_archive/plans/P1-P2-20261018.md#chat-capacity-recovery) |
| <a id="p2-firestore-migration"></a>`p2-firestore-migration` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-firestore-migration) |
| <a id="f02-candidate-disposition"></a>`f02-candidate-disposition` | [歷史原文](_archive/plans/P1-P2-20261018.md#f02-candidate-disposition) |
| <a id="p2-f01"></a>`p2-f01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f01) |
| <a id="p2-f02"></a>`p2-f02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f02) |
| <a id="p2-f03"></a>`p2-f03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f03) |
| <a id="p2-f04"></a>`p2-f04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f04) |
| <a id="p2-f05"></a>`p2-f05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f05) |
| <a id="p2-f06"></a>`p2-f06` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f06) |
| <a id="p2-f07"></a>`p2-f07` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f07) |
| <a id="p2-f08"></a>`p2-f08` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-f08) |
| <a id="p2-delivered"></a>`p2-delivered` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-delivered) |
| <a id="s11-w03"></a>`s11-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s11-w03) |
| <a id="s06-w02"></a>`s06-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w02) |
| <a id="s05-w02"></a>`s05-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s05-w02) |
| <a id="s09-w02"></a>`s09-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s09-w02) |
| <a id="s07-w03"></a>`s07-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s07-w03) |
| <a id="s13-w01"></a>`s13-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w01) |
| <a id="s13-w04"></a>`s13-w04` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w04) |
| <a id="s10-w01"></a>`s10-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s10-w01) |
| <a id="s10-w02"></a>`s10-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s10-w02) |
| <a id="s11-w02"></a>`s11-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s11-w02) |
| <a id="s12-w03"></a>`s12-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s12-w03) |
| <a id="s12-w04"></a>`s12-w04` | [歷史原文](_archive/plans/P1-P2-20261018.md#s12-w04) |
| <a id="s13-w05"></a>`s13-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w05) |
| <a id="s13-w06"></a>`s13-w06` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w06) |
| <a id="s13-w08"></a>`s13-w08` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w08) |
| <a id="s13-w07"></a>`s13-w07` | [歷史原文](_archive/plans/P1-P2-20261018.md#s13-w07) |
| <a id="s14-w01"></a>`s14-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s14-w01) |
| <a id="s16-w05"></a>`s16-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#s16-w05) |
| <a id="s16-w02"></a>`s16-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s16-w02) |
| <a id="s17-w02"></a>`s17-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s17-w02) |
| <a id="s06-w05"></a>`s06-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w05) |
| <a id="production-integration"></a>`production-integration` | [歷史原文](_archive/plans/P1-P2-20261018.md#production-integration) |
| <a id="int-w01"></a>`int-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w01) |
| <a id="int-w02"></a>`int-w02` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w02) |
| <a id="int-w03"></a>`int-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w03) |
| <a id="int-w04"></a>`int-w04` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w04) |
| <a id="int-w05"></a>`int-w05` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w05) |
| <a id="int-w06"></a>`int-w06` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w06) |
| <a id="int-w07"></a>`int-w07` | [歷史原文](_archive/plans/P1-P2-20261018.md#int-w07) |
| <a id="p2-agent-service"></a>`p2-agent-service` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-agent-service) |
| <a id="p2-a01"></a>`p2-a01` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a01) |
| <a id="p2-a02"></a>`p2-a02` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a02) |
| <a id="p2-a03"></a>`p2-a03` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a03) |
| <a id="p2-a04"></a>`p2-a04` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a04) |
| <a id="p2-a05"></a>`p2-a05` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a05) |
| <a id="p2-a06"></a>`p2-a06` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a06) |
| <a id="p2-a07"></a>`p2-a07` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a07) |
| <a id="p2-a08"></a>`p2-a08` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a08) |
| <a id="p2-a09"></a>`p2-a09` | [歷史原文](_archive/plans/P1-P2-20261018.md#p2-a09) |
| <a id="qa-report-period--關注觀察的固定期間歸屬已合併待部署"></a>`qa-report-period--關注觀察的固定期間歸屬已合併待部署` | [歷史原文](_archive/plans/P1-P2-20261018.md#qa-report-period--關注觀察的固定期間歸屬已合併待部署) |
| <a id="qa-adk-runtime--指令資料分層與安全終結已合併待部署"></a>`qa-adk-runtime--指令資料分層與安全終結已合併待部署` | [歷史原文](_archive/plans/P1-P2-20261018.md#qa-adk-runtime--指令資料分層與安全終結已合併待部署) |
| <a id="qa-interactive-input--待辦意圖與互動容量已合併待部署驗收"></a>`qa-interactive-input--待辦意圖與互動容量已合併待部署驗收` | [歷史原文](_archive/plans/P1-P2-20261018.md#qa-interactive-input--待辦意圖與互動容量已合併待部署驗收) |
| <a id="chat-reliability-delivered"></a>`chat-reliability-delivered` | [歷史原文](_archive/plans/P1-P2-20261018.md#chat-reliability-delivered) |
| <a id="s00"></a>`s00` | [歷史原文](_archive/plans/P1-P2-20261018.md#s00) |
| <a id="s01"></a>`s01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s01) |
| <a id="s02"></a>`s02` | [歷史原文](_archive/plans/P1-P2-20261018.md#s02) |
| <a id="s03"></a>`s03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s03) |
| <a id="vertical-slice"></a>`vertical-slice` | [歷史原文](_archive/plans/P1-P2-20261018.md#vertical-slice) |
| <a id="s01-w01"></a>`s01-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s01-w01) |
| <a id="s02-w01"></a>`s02-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s02-w01) |
| <a id="s06-w03"></a>`s06-w03` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w03) |
| <a id="s03-w01"></a>`s03-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s03-w01) |
| <a id="s06-w01"></a>`s06-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s06-w01) |
| <a id="s09-w01"></a>`s09-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s09-w01) |
| <a id="s11-w01"></a>`s11-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s11-w01) |
| <a id="s05-w01"></a>`s05-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s05-w01) |
| <a id="s16-w01"></a>`s16-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s16-w01) |
| <a id="s17-w01"></a>`s17-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s17-w01) |
| <a id="document-packages"></a>`document-packages` | [歷史原文](_archive/plans/P1-P2-20261018.md#document-packages) |
| <a id="doc-r01"></a>`doc-r01` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r01) |
| <a id="doc-r02"></a>`doc-r02` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r02) |
| <a id="doc-r03"></a>`doc-r03` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r03) |
| <a id="doc-r04"></a>`doc-r04` | [歷史原文](_archive/plans/P1-P2-20261018.md#doc-r04) |
| <a id="s00-w01"></a>`s00-w01` | [歷史原文](_archive/plans/P1-P2-20261018.md#s00-w01) |
| <a id="ac-s00-m01"></a>`ac-s00-m01` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m01) |
| <a id="ac-s00-m02"></a>`ac-s00-m02` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m02) |
| <a id="ac-s00-m03"></a>`ac-s00-m03` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m03) |
| <a id="ac-s00-m04"></a>`ac-s00-m04` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m04) |
| <a id="ac-s00-m05"></a>`ac-s00-m05` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m05) |
| <a id="ac-s00-m06"></a>`ac-s00-m06` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m06) |
| <a id="ac-s00-m07"></a>`ac-s00-m07` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m07) |
| <a id="ac-s00-m08"></a>`ac-s00-m08` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m08) |
| <a id="ac-s00-m09"></a>`ac-s00-m09` | [歷史原文](_archive/plans/P1-P2-20261018.md#ac-s00-m09) |
