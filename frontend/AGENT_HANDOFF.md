# Agent 對話及私人結果交接

**FE-W29 最新共用時間線／訊息（2026-10-02）：** 基本聊天、合成逐字回覆與 AgentRunView 共用 ChatMessage／AnswerSources；ChatTimeline 將最新放底部、較早訊息分批展開，讀舊時不跟新文字。公開執行過程預設收起，不顯示內部思維鏈；同一 id 更新及最終快照保留自己的狀態，停止／失敗／unknown／待確認分開。合成工具及計時器只在 preview hook，正式最近 100 則 API 尚無更早游標或增量／取消契約。四尺寸、停止及 scope 清理、來源再驗和 Web／Android export 通過；[共用元件／props／證據](HANDOFF.md#chat-timeline)／[三個 Agent 官方研究](CHAT_UI_RESEARCH.md)／[必須移除／替換](PRODUCTION_UI_HANDOFF.md)。真串流、權限、逐句來源映射及原生實機仍待接線／驗收。

**FE-W28 最新來源版式（2026-10-02）：** 回覆底部以分隔線接一個來源標題分頁組件，沒有重複清單或淺綠底板；相鄰來源用細直線分隔，底線與滑塊分開；詳情按引用、版本核對、日期適用三組及細線整理。正文上標立即跳到自己的來源面板；點分頁展開，再點同一項收起，多個來源可左右捲動，沒有中央 Dialog。基本聊天與 Agent 共用 [AnswerSources／CitationText](src/components/chat/AnswerSources.tsx) 及 [ChatCitationView](src/chat-view-model.ts)，不讀 Agent／fixture 狀態，每則訊息獨立；保留快照詳情及 stable source id 回調。四尺寸／長回覆／12 項、跨訊息互不干擾、窄版放大文字及 Web／Android export 通過；原 Agent 操作／權限證據沿用未改業務。現有正式 text／KnowledgeEvidence 沒有逐句映射，主聊天須核對真實編號關聯，不能把 fixture 或猜配作證據；復用接線方式見 [總交接](HANDOFF.md#chat-source-reuse)。FE-W27 首頁不再放提問欄／捷徑，對話沿既有導覽進入，草稿保留。

更新：2026-10-02。FE-W09 前置為已 review 的前端 `83106c0`（draft PR #68），分支 `codex/fe-w09-agent-conversation`。正式契約核對穩定主線 `90dacd4e5c0a8be9e490fa7d94830ea369c57521`；只讀 API／控制器，沒有改 Server、正式 App 或根文件。

**FE-W25 最新展示修訂：** 按使用者指示撤去 `/chat` 常駐「緊急求助」卡及聊天標題／訊息頭像，問題靠右、答案用回全列寬。原草稿、按孩子分開的本地問題、composer 及結果操作不變。四尺寸局部檢查及 Web／Android export 通過。使用者已澄清「固定」指需要顯示時用統一、最權威的官方求助入口，避免每次生成不同資訊；不代表常駐，也沒有取消求助功能。正式觸發與前端誤讀更正見 [總交接](HANDOFF.md#chat-presentation)；原 FE-W17 展示證據屬歷史版本，不能據此恢復舊卡。

**FE-W19 最新增補：原對話頁直接拍照。** 源碼／驗證 `f541a2da0f97e2cf463f380d3f8449dad3525892`；基線 `bed134271e70529a0d90878292daf2fc228fc885`，直接重核 GitHub master `ce87370` 的 P2 交接；照片／聊天協定未改。新增 [AgentComposer](src/components/agent/AgentComposer.tsx) 管理當頁選圖和資源，復用 [PhotoFilePicker](src/components/photos/PhotoFilePicker.web.tsx) 的校驗／hash／blob。[WebCameraCapture](src/components/photos/WebCameraCapture.web.tsx) 只在明確按下後掛載並要求 `getUserMedia`，`audio: false`，後置鏡頭為偏好；相機畫面沿共用 AppDialog／AppButton。這項取代 FE-W18 的拍照跳頁，沒有新增依賴或修改後端。

Web 在 HTTPS／localhost 且瀏覽器允許相機時可頁內拍攝；等待權限仍可取消，拒絕／缺裝置／不可用顯示具體提示，重試須另按。系統拍照／選圖由明確點擊原 `capture=environment` input 提供後備；桌面可能只提供選檔，原生 `captureOriginal` 未注入仍停用。拍攝以完整 video frame 編碼 JPEG（瀏覽器回退 PNG 時保留真正 MIME），不裁切／改尺寸；再沿相同原檔檢查，沒有自動上傳、保存、分析或發送聊天。檔名時間只是本地命名，不可推作照顧事件時間。

本地照片與文字草稿分開：取消／失敗保留上一張照片及原問題，更換／移除釋放舊 blob，切換孩子／身份／授權範圍或離頁清除照片；相機在拍攝／取消／卸載／頁面隱藏時停止所有 tracks。未完成的權限回應／編碼／讀檔不能回填新範圍；不要在網址、localStorage 或工程日誌保存照片。`ChatPage` 的 key 只代表合成孩子／稱呼／角色；正式版須用 Server／本人身份／session／孩子／授權範圍，不可拿顯示名稱代替身份。問題文字仍沿原 provider 的按孩子草稿規則，不改已驗收的 ChatController。

FE-W19 typecheck、Web 33 路由／Android 31 資產 export、四 Web 寬度的一按開相機／完整合成 frame／取消／拒絕及明確重試、原檔後備／草稿／blob／遲到結果、鍵盤及 390／320 的 150% Web 文字通過。[最終檢查](verification/fe-w19/checks-composer-surfaces-camera.json)／[版本及產物](verification/fe-w19/build-checks.json)，[390 相機彈窗](verification/fe-w19/camera-open-390.png)／[拍攝後](verification/fe-w19/captured-photo-390.png)。串流來自測試畫布，沒有使用真相機或請求裝置權限；Webcam／手機、原生 adapter／APK、正式上傳及聊天多模態仍待驗收／接線。首輪發現 Portal 延後掛載令 effect 早於 video DOM，已改 callback ref 接入並通過。

2026-10-01 FE-W18 增補：源碼／驗證 `eb9b48c17160066f585c4fcbd7ad871a27d9045d`，基線 `f3ba9e35b718e68b5a23bf73072ec437cd746d22`；重核 GitHub `ce87370` 的 UI-P2-14／15，新增 [AgentInputToolbar](src/components/agent/AgentInputToolbar.tsx)。下表已按 FE-W19 更新拍照及回調；共用表面修正在 [COLOR_STRATEGY](COLOR_STRATEGY.md)。

| 輸入入口 | 本包已實作／交接界線 |
|---|---|
| 拍照 | 直接開頁內相機，不跳頁；拍下後回原 composer 作本地未送出預覽。系統拍照／選圖為明確操作的後備，沿原 JPEG／PNG、4 MiB、hash 和 blob 清理；實際相機／裝置權限仍未驗 |
| 檔案與來源 | 共用 AppDialog／AppMenuList 分流至原照片選檔和私人文字／網址來源；返回對話保留原問題。PDF／Word 尚無本期支援，不能給任意文件新增上傳／模型協定；照片也不因此成為已發送的對話附件 |
| 語音輸入 | SVG 入口及未接通提示已完成，返回文字輸入不清草稿；沒有咪高峰、錄音或轉文字 adapter。正式實作須另核 P3／平台權限及真 API，不能以本按鈕宣稱語音已接通 |
| 正式接線 | `AgentComposer` 接問題及預覽／導航回調；工具列的 `onPickPhoto(PhotoOriginal)`／`onPhotoError(message)` 接當頁結果，`captureOriginal` 是原生薄 port；`onPhotos()`／`onSources()` 只供檔案選單導航，`onUseText()` 回文字欄。正式對話附件須明確分開選取、私人保存、模型同意、共享及實際送出，沿既有附件／Agent 契約；原 opId／unknown、孩子／本人／Server 清理照舊 |

FE-W18 必要輕量檢查：typecheck、20 組 token 對比、Web／Android export、四尺寸輸入入口／草稿／SVG／48 觸控及 390／320 的 150% Web 文字通過；共用選單／Dialog 另復用六寬度檢查。首次焦點檢查發現 Modal 還原開啟者蓋過同 frame 的輸入聚焦，改沿 `AppDialog.onClosed` 後 Web 回到文字欄通過。實際證據見 [checks](verification/fe-w18/checks-composer-surfaces.json)，正式 API、相機／咪高峰、PDF／Word、原生焦點與系統權限仍未驗。

## 交付與預覽

開啟 `/chat` →「查看來源與候選」。[AgentRunView](src/components/agent/AgentRunView.tsx) 和 [AgentInboxView](src/components/agent/AgentInboxView.tsx) 是受資料模型／回調驅動的共用 React Native 畫面；[agent-view-model](src/agent-view-model.ts) 是顯示投影，不是 HTTP 協定。共用 Paper 按鈕、勾選、選單、卡片、SVG 和既有 OKLCH tokens，沒有新依賴或第二套色盤。

[AgentConversationPreview](src/components/agent/AgentConversationPreview.tsx)／[useAgentPreview](src/preview/useAgentPreview.ts)／[agent-fixture](src/preview/agent-fixture.ts) 只注入合成結果。工具提供不同運行、原決定、讀取、過期和執行區身份情境；沒有模型呼叫、真引用、任務／記憶寫入或外發。原 composer 仍只把問題加入當頁版式，不保存聊天、不要求真 AI 回覆；捷徑不覆蓋已有問題草稿。

候選逐項展示內容、對象、操作、原任務版本、原時差／IANA 時區、來源、可見範圍、建立／期限及候選版本。建立任務、改期／轉派、完成、取消、覆核終態及私人／家庭記憶均有顯示樣本。運行統計和工具結果收在詳情；來源保留原片段、發布者、分類、版本校驗、日期、適用範圍及內部用途限制。沒有百分比、思考過程或假附件／咪高峰。

## 正式接線入口

以下位置已按 `90dacd4` 原文核對；payload、授權、版本及收據仍以這些檔案為準。

| 顯示／回調 | 主聊天復用位置及映射 |
|---|---|
| 問題草稿、已保存訊息及要求回覆 | `src/client/ChatPanel.tsx`、`chat-controller.ts`、`chat-api.ts`；訊息的 `agentRunId` 只連到本人／同一孩子可見的已保存回覆。不得給每次本地輸入配一個假 run |
| `AgentRunActions.refresh` | `product-agent-api.getRun(childId, runId, signal, userId)`；既有 GET `/children/:childId/agent/runs/:runId`。控制器核對運行、孩子及引用／候選歸屬，再投影畫面 |
| 運行、停止原因及統計 | `src/shared/product-agent.ts`、`src/client/AgentRunPanel.tsx`；`countsKnown=false` 投影為 `counts=null`，不顯示零用量。停止原因沿既有 allowlist，不展示任意內部錯誤文字 |
| `proposals[].details` | 逐類投影正式 `value` 的完整內容；`task_change` 保留 action／原任務 expectedVersion／負責對象／新時間與時區／覆核 outcome／note，不能只傳一句標題 |
| `decide`／`retryOriginal` | `product-agent-api.decideProposal` 的既有 POST `.../proposals/:proposalId/decide`；原 proposalId／expectedVersion／decision／confirmShared 完整保留。正式 API 已有 pending／原決定核對，不包成另一套通用寫入流程 |
| 私人背景結果 | `src/client/AgentInbox.tsx` 既有 GET `/children/:childId/agent/runs`；手動讀取最多 20 個 runId／createdAt，再以相同組件開啟。不自造未讀、投遞、輪詢或背景完成通知 |
| 引用與開啟來源 | `ProductAgentResult.citations` 及 `product-agent-api.ts` 的 KnowledgeEvidence 驗證，投影到回覆底部 AnswerSources 及頁內來源分頁。原文編號對應須由正式 adapter 核對，沒有逐句映射時不猜配。sourceDate 保留 sourceDateText 或原日期，不把文字硬解析成 instant；versionHash 是版本校驗，不冒稱 contentHash。`onOpenSource` 只傳原 id，正式 adapter 核對 HTTPS、主機、無 credentials／控制字元後才開啟 |

## 必須保留的語義

- 運行 completed 是「已結束」，不等於照護任務完成；工具成功保存候選不等於候選已執行。接受後保存的任務或記憶由原控制器重新讀取，不複製成另一個 authoritative store。
- 候選是私人待核對內容；接受家庭任務或家庭記憶前明確勾選內容、對象及共享範圍。私人記憶不要求家庭勾選，但仍須明確接受。期限已過或無效、離線、讀取失敗、忙碌及權限失效皆不能提交。terminal 候選不再提供確認按鈕。
- 候選決定 unknown **沒有通用 opId 查核契約**。保留原運行／候選／版本／決定／共享值，阻擋另一個新決定，再讀取原運行。沒有候選不能推斷「未保存」；同版本 pending 也不能聲稱寫入沒發生，只能明確沿用原決定重試，並重新核對共享內容。
- 出現 terminal 候選才清除該 pending；版本改變或既有 API 要求 fresh confirmation 時停用舊基準，再明確核對新內容。409 不能只換 expectedVersion 或直接重送。讀取中清除舊共享勾選；失敗保留原操作但鎖住確認及重試。
- 正式 Server／user／child／run 範圍改變時先換 private subtree 的 key，清除舊結果、引用、勾選及原決定，再開始新讀取；abort／generation 防止舊 response 回填。401／403／404／session_changed 清除私人內容。本包身份工具只切執行區樣本，不是真正全頁換帳戶；正式聊天、草稿、inbox 和其他控制器仍須按既有身份／刪除 gate 一起清理。
- 引用是回答當時的快照，不能保證今天仍適用；無引用不能冒稱官方支持。組內非商業來源不成為公開知識卡片。展示的引用文字和校驗字串均清楚標為合成，沒有真健康資訊或外部網頁。

## 驗證與限制

typecheck、Web 23 個靜態路由及 Android Hermes／31 個資產 export 通過。實際固定 Web 輸出在 1440／1024／390／320 CSS px 核對來源長字串、共享 Space／接受 Enter、收據及問題草稿；針對原決定重試、確認基準變更、讀取失敗／缺失、孩子／執行區身份／撤權清理、手動 inbox、過期、統計未知及任務變更投影的必要合成流程通過，沒有 pageerror、console.error 或 `/api/` 請求。證據見 [checks-agent-flow](verification/fe-w09/checks-agent-flow.json)／[build-checks](verification/fe-w09/build-checks.json)。曾停在工具隨孩子重設及重複狀態文案的測試定位，修正後通過，沒有因此改產品行為。

手機截圖只驗共用組件的 Web 執行結果；正式 ChatController 接線、真 session／Server／模型／知識／跨頁同步、APK／系統字體／TalkBack／返回鍵及主聊天集中驗收未執行。使用者最新要求是重新整理手機比例、大小與密度；下一包獨立處理，不把上述 checks 當視覺滿意或真機通過。
