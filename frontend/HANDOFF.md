# 育伴港前端整合交接

2026-10-06 UTC 重整。這是依已取回程式、保存的較早交接及設計文件編寫的新交接，不是遺失的最終 v44 原件。工作狀態及驗證只見 [PLAN](PLAN.md#active)，呈現依 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)。

<a id="p2-coverage"></a>
## 按功能接手

- Agent／聊天／輸入：[AGENT_HANDOFF](AGENT_HANDOFF.md)；下文[記錄核對](#conversation-change-review)及[聊天接點](#codex-chat-presentation)
- 記錄、待辦、概況、準備單與分類歷史：[同源接點](#shared-workspace-injection)、[孩子概況](#child-overview-preparations)、[事項與歷史](#agent-first-task-history)
- 成長關注、結束／恢復及報告：[GROWTH_HANDOFF](GROWTH_HANDOFF.md#living-growth-archive)
- 記憶與參考：[唯讀接點](#memory-reference-storage)
- 正式掛載／既有差異：[適配邊界](#commercial-rollout)、[歷史契約審查](#contract-review)

其他專項交接若未在整合樹恢復，不把它們當已讀或可用的新證據；按正式 repository 的 `docs/P2_UI_HANDOFF.md`、`docs/API.md` 及相關 controller 重核。這些根文件及 backend 不由本包改寫。

<a id="shared-workspace-injection"></a>
## 一處資料 owner，多處呈現

[受控 workspace](src/workspaces/CareWorkspace.tsx) 與同目錄的 Profile／Tasks／Preparation／Growth／MemoryReference provider 只傳外部投影及回調。host 當前 scope 與 value／model 不符即遮罩，不複製可寫資料、不自行啟動 transport。`src/preview/*WorkspaceProvider` 才是合成接線；正式 controller 必須提供相同讀取、寫入、收據及刷新語義。

Dashboard 共同祖先各掛一次 owner，consumer 不能再掛自己的 fixture。Growth／Memory 的 [useOwnerProjection](src/preview/useOwnerProjection.ts) 讓 keyed 資料 owner 與穩定外殼分開；舊 generation 的投影與回調不能進入新 scope。新 dashboard layout 是重建檔，實際驗證以 PLAN 為準；此結構不等於白閃根因或動畫效果已經實測確認。

| 領域與 consumer | 正式對應及尚缺能力 |
|---|---|
| Care：`/care`、已保存／核對歷史、聊天重要確認 | CareApi search/create/revise/history/delete 保留原 ID、expectedVersion、reason、共享同意及原操作收據。跨 run 變更索引、普通自動保存、持久重要確認及匹配聊天事件尚缺正式 port |
| Profile：檔案及孩子概況 | 同一 CareApi getProfile/saveProfile/profileHistory/deleteProfile；孩子清單沿原 RecordsApi。ChildProfileData 沒有身高／體重欄位；量度須獨立授權投影，不能從 Care 單一 quantity 的文字或單位猜測 |
| Tasks：待辦、日曆、完成／取消歷史 | TaskApi tasks/task/history/createTask/changeTask；原 occurrence、版本、assignee、游標及收據保留。worker 狀態 unknown 與寫入 unknown 分開；Home attention 尚不能當 Tasks 已正式同步 |
| Preparation：準備單及準備歷史 | 舊 CareSummaryApi savePreparation 只支援每孩子單一 VisitPreparation。多份文件、生成、清單保存、歸檔／重開及歷史游標需要正式 port，不能硬套舊 API |
| Growth：持續關注、關注歷史、成長報告 | 同一 Growth owner；關注鏈及 archive／restore、報告讀取／生成／導出缺口見專項，不把 MemoryTopic 改名當 concern |
| MemoryReference：短期脈絡、長期記憶、參考資料 | 唯讀現有 Memory／知識投影；不建立第二套記憶 store，不在此頁提供任意修改 |

正式 owner 掌管本人／孩子／Server／角色、版本、讀取完整性、訂閱、撤權及 abort／generation。成功後發布同一投影供各頁更新；已確認保存但讀回失敗只重讀，不重送保存。歷史快照不是現行值，也不能反向覆寫現行資料。私人原文不因生成家庭記錄或報告而自動共享。

<a id="record-review-projection"></a>
<a id="conversation-change-review"></a>
## Agent 記錄核對

已採納方向是「家長跟 Agent 說 → Agent 按政策整理及記錄 → 家長查看」，手動新增／補填只作漏記、來源不能接入或家長要直接處理時的補救。原話、Agent 理解、正式資料與衍生摘要必須分開；一般閒聊和重複內容不應變成核對負擔。更正須指定原物件與 expectedVersion，不能靠相似文字合併事件。

- 普通結果依正式 Agent／Server 的已授權政策保存，家長可事後查看理解及更正；前端不能自行把提案升格為已保存
- 重要內容在相關聊天明確確認，記錄頁持續黃色待確認。保存與核對是兩個狀態；關閉、換頁、歷史歸檔或重開不能清黃燈，只有匹配 scope／source／proposal／record version 的有效確認收據可解除
- 可先修改或交回 Agent，不強迫同意；確認記錄不授權醫療決策、通知、預約或其他重要下游操作。重要下游操作仍按自身權限與確認契約處理
- [CareReviewProjection](src/care-view-model.ts) 保留來源批次、目標領域、原話／解讀、寫入結果及獨立 reviewState。Care、長期事實、任務的核對索引可共用呈現，但修改交回各自 owner，不能全部塞入 Care note
- [CareReviewHistoryView](src/components/care/CareReviewHistoryView.tsx) 供跨聊天集中核對；近期每頁 10 項、最多 10 頁，較早未處理另有入口。只搜尋已載入或正式游標提供的資料，不虛構總頁數、日期或完整 Server 搜尋
- [ImportantRecordConfirmation](src/components/care/ImportantRecordConfirmation.tsx) 的正式入口要求當前 conversation 與匹配事件；現時 demoItemId 只屬明示的預覽工具。相關聊天自動彈窗及重開後持久黃燈均未由 session-local fixture 實現
- 來源失效／撤權須遮罩原文及歷史；更正保留原 ID、版本、共享同意及原操作。unknown 先查原操作；略過提案不刪正式記錄

**歷史 backend 核對，並非本次部署驗收：** 在 master `65f8cf37bceeb15b05f46326c49e0370349ae3a5`，互動 Agent 只有 propose_fact／propose_task／propose_task_change，先存 proposal，明確 accept 才建立已確認記憶或任務；沒有聊天 Care 新增／更正、普通／重要自動保存政策或同 key 事實的自動合併。proposal 預設 24 小時期限；沒有正式 conversationId／跨 run 待確認總表，聊天只讀最近 100 則且無更早游標，背景 run 清單不能代替互動對話歷史。正式接線前重核相關 API；到期不等於確認，未處理項的持久發現與重新核對須由 backend 提供。

<a id="child-overview-preparations"></a>
<a id="visit-preparation-reading"></a>
## 孩子概況與準備單

`/summary` 預設概況，`?tab=preparation` 讀多用途準備單，`?tab=legacy-preparation` 只保留原共享準備及 unknown 恢復的相容深連結；正常準備單頁不再顯示該舊入口，沒有刪除或遷移資料／收據。概況共用 Profile owner，缺值保留未知；量度須有相符孩子／scope、record ID／版本、原值、日期及來源，未接入即 unavailable。

[PreparationWorkspace](src/workspaces/PreparationWorkspace.tsx) 與歷史共用同一文件 owner。到診、入學／轉校、外出／旅行、照顧交接以重點、問題及清單閱讀為主；請 Agent 準備只建立未送出草稿，不覆蓋已有問題或假稱已生成。合成歸檔保留當時 revision；來源更新標 stale，撤權連歷史正文一起遮罩。正式多文件生成、持久化、清單、歸檔／重開均未接通；舊共享準備收據沒有因此遷移。

原到診閱讀沿 Summary controller，明確修改才顯示表單，返回閱讀保留草稿。沒有權威相關性／負責人映射時不從普通記錄推導醫療關聯或編造姓名；只導向清單的按鈕不能稱為精確記錄／任務定位。

<a id="agent-first-task-history"></a>
## 事項及分類歷史

家長交代 → Agent 整理 → 原 Tasks owner 保存 → 依授權提醒／通知 → 回報後更新，是產品方向。已記下、提醒已安排、渠道 accepted、本人 ack、照護完成保持分開。

待辦、日曆及 `/history?category=tasks` 同讀 TasksWorkspace。completedAt／terminalAt 只能由相同 task／child／version／occurrence／終態 revision.at 投影，不借 dueAt 或 updatedAt。日期按 owner 的 asOf／IANA zone；未載入月份不是沒有安排，真正未排期待辦仍需正式來源。顯示分頁與 loadMoreTasks 的遠端游標分開。

[HistoryScreen](src/screens/historyScreen.tsx) 已接 Care、核對、Tasks、Preparation 及 Growth 的合成 owner；Growth 類別展示已結束關注並可恢復，取代較早「成長歷史未接入」的說明。助手對話、通知及聯絡類別仍明示未接入，不從當前聊天視窗或有限台帳拼成完整歷史。篩選、返回位置及 dirty／pending 守衛不另存一份業務資料。

<a id="memory-reference-storage"></a>
## 記憶與參考只讀

[MemoryReferenceWorkspace](src/workspaces/MemoryReferenceWorkspace.tsx) 展示 Agent 所用資料，consumer 只展開、讀歷史、續載或準備未送出的核對問題；不提供 mutation callback。短期／長期／參考是閱讀分類，不是新資料庫或 candidate／confirmed 改名。

- 短期脈絡須有權威 runId、精確 message IDs／角色／原文；缺正式讀口保持 unavailable，不能拿摘要未覆蓋批次或任意最近訊息冒充
- 長期沿原 facts／history／summary，保留 candidate／confirmed／inactive、私人／家庭、來源、版本、有效性及 confirmedBy／At。讀取失敗不是零筆或已遺忘
- 參考資料沿 KnowledgeEvidence 的 source／version／chunk／hash、片段、發布／查核／有效時間及用途。公開面只顯示 public_noncommercial；缺 catalog 不把合成引用當新聞庫

歷史核對的正式 ADK＋PostgreSQL 保存聊天、memory_facts／topics 及私人摘要；pgvector 已落地部分是公共知識，沒有本包新建私人向量記憶或定時升級長期方案。24 小時是 proposal 期限，不是記憶保存期。既有較早上下文覆蓋接縫仍須按 message IDs／coverage cursor 核對，不能聲稱 Agent 已完整記住；詳見 [Agent 接線限制](AGENT_HANDOFF.md#memory-context-integration)。

<a id="commercial-rollout"></a>
<a id="home-assistant-entry"></a>
## 正式 adapter 與呈現邊界

正式版重用 `*-view-model.ts` 及呈現回調，逐項替換 preview hooks、情境工具及合成 timer。部分表單仍依賴 preview orchestration，並非整套畫面無改 wrapper 就可直接接 API；刪「預覽」文案不代表接通。

首頁 agentImportant、attention、ongoing 各有原來源，不互相補位；ongoing 的 MemoryTopic 不當 Growth concern。拍照／文件／音訊只到同 scope 未送出草稿，本地選取、私人保存、模型同意、家庭共享、實際送出分開。真附件送出／辨識、Agent feed、媒體與渠道仍待正式 adapter；accepted 不代表收到，收到不代表事項完成。

Care／Task／Memory／Summary 的原 opId 與 confirmed／unconfirmed／null 收據不可丟失；Growth／Agent proposal 的原操作恢復有不同契約，不能套一個通用重試器。身份未知不能露出舊私人 cache，401／403／404／session_changed、撤權或 scope 改變須清理並取消遲到回應。只在同一有權身份下保留應恢復的原操作。

<a id="contract-review"></a>
## 正式 App 的歷史待重核差異

以下保留較早 FE-W30 在正式 `d3213e6` 的發現，不是本次在最新正式程式重現；不得按舊行號直接 patch，先查是否已修：

- A1：auth checking／logout unknown 時 AgentInbox 仍可能使用 careScope；只有已確認身份可顯示私人快照，這不等於已證明跨帳戶讀取
- A2：草稿取消登出前已 suspend Push；須先確認草稿，身份 unknown 不可自行恢復渠道
- A3：Family unknown 只留 boolean，未凍結原目標／body／版本；unconfirmed 仍應 pending，reload 不解鎖新請求
- A4：登出 dirty gate 未涵蓋 Family 的本地邀請／稱呼／偏好；各 owner 的 dirty／pending 須聚合
- A5：Care 背景刷新走 initial load，會重設 query／kind；應保留 applied filters 及游標語義
- A6：Memory 畫面漏投影 confirmedBy／confirmedAt；不能用 author 或當下時鐘補值
- D1：Care manual eventTime 只存 raw，at 為 null；未知時間不納入期間摘要是正確限制，完整日期／時間／precision 輸入與更正仍要接線，不能借 createdAt
- P3：正式 Family 名稱 UTF-16 長度與 Server code point 規則有差異；只修同一規則，不改既有前端 code-point 計數

另保留投影缺口：Task 沒有獨立 read-error、Memory 不能借 Home.recordsLoad、模型 failed／429 不能解析 notice 文字決定語義。真 session、歷史／stream／取消、逐句引用及不支援可取消 Navigation API 的返回流程均須按正式範圍驗證。

<a id="codex-chat-presentation"></a>
<a id="chat-timeline"></a>
<a id="chat-source-reuse"></a>
<a id="chat-presentation"></a>
<a id="answer-citations"></a>
## 聊天呈現接點

[ChatTimeline](src/components/chat/ChatTimeline.tsx)、[ChatMessage](src/components/chat/ChatMessage.tsx)、[AnswerSources](src/components/chat/AnswerSources.tsx) 與 AgentComposer 共用呈現；保留 stable message id、最終快照、IME／多行輸入、每訊息引用及閱讀位置。只顯示公開活動，不顯示內部思維鏈；合成逐字 timer 不是正式 stream。來源需原 id／版本／用途及權限，無真逐句映射只呈底部來源，不能猜上標關係。

已取消常駐緊急求助卡及聊天頭像；需要時仍用統一權威求助入口，不代表取消求助功能。舊版字型缺字與連續轉場沒有新實測便不宣稱修好。

<a id="semantic-motion"></a>
<a id="responsive-scroll"></a>
<a id="toolbar-delete-safeguards"></a>
<a id="login-original-reset"></a>
## 共用呈現的相容入口

舊引用保留至此。外殼與資料 owner 的 scope 重設分開；保留 MotionProvider、焦點、減少動畫與資源清理。危險動作具名確認，普通操作直達；這些錨點只提供現行入口，不代表舊版畫面證據已取回。具體方法沿 [Web Skill](.agents/skills/web-screen-delivery/SKILL.md)，呈現沿 [DESIGN_SYSTEM](DESIGN_SYSTEM.md#control-roles)。

<a id="預覽及驗證"></a>
<a id="history"></a>
## 驗證與較早資料

實際新修訂驗證及已取回的舊證據索引只見 [PLAN](PLAN.md#evidence)。保存的較早 HANDOFF（Library version 3）及 Growth v38 只作歷史接線依據；本文件已按取回程式更新差異。原最終 v44 QA 產物未取回，不代表當時沒有執行瀏覽器檢查；它們目前不能支持新修訂驗收。未取回的舊截圖或專項文件亦明示不可用，不補造鏈結或把舊結果轉述成新 pass。
