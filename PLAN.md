# 五階段實施計劃

本文件維護長期階段、工作包、依賴、狀態及驗收。產品要求見 [SPEC](SPEC.md)，現況見 [STATUS](STATUS.md)，歷史證據按需定位 [WORKLOG](WORKLOG.md)。按工作包推進，不按日期或周分配任務。

Sxx 是穩定範圍標識，不代表數字執行順序。原條款被新決策修訂時保留錨點，以 [ADR-008](docs/DECISIONS.md#adr-008) 追溯替代關係；不得把被替代要求當成已完成。

<a id="active"></a>
## 當前任務入口

### 聊天 Agent 可靠辦事；F01 接點與既有能力整合

2026-10-09 按使用者最新範圍校準，決策見 [ADR-021](docs/DECISIONS.md#adr-021)。本輪只交付家長使用的聊天 Agent；資料收集／知識維護、資料生成／編製、審核三個 Agent 保留接口，其內部實作及四角色全量驗收不作本輪前置。既有權限、來源有效性、確認及結果誠實門檻不因此移除。

- **成果目標：**理解不完整交代；只就會影響結果、對象或授權的歧義補問，回答後沿同一工作接續。完成適用知識查證、文件／任務操作、記憶更正及授權內提醒，保留取消、版本、原操作收據與結果未知狀態。原 A09 未通過的引用、同一文件修改及新對話讀回仍待完成，不能以新計劃抹除。
- **復用與適配：**保留 ADK 的原生 Runner／工具循環及既有業務服務。成熟開源提示詞須按固定來源、授權與實際移植段落記錄；研究過不等於已採用。先核現有原生能力，再只補產品所需的身份／孩子／資料／收據及介面適配；不另造通用 agent runtime 或多角色平台。
- **已合併基線：**2026-10-10 已核 master `04fb3f3ef7aa70cb63451b1229d8936241e389f1`；[#171](https://github.com/2NTTY/child-ai-caregiver/pull/171)、[#172](https://github.com/2NTTY/child-ai-caregiver/pull/172)、[#173](https://github.com/2NTTY/child-ai-caregiver/pull/173)、[#174](https://github.com/2NTTY/child-ai-caregiver/pull/174) 及 [#175](https://github.com/2NTTY/child-ai-caregiver/pull/175) 已正常合併，未部署；[#176](https://github.com/2NTTY/child-ai-caregiver/pull/176) accepted 確認重試權威及 [#177](https://github.com/2NTTY/child-ai-caregiver/pull/177) 匯出彈窗／結果提示原碼亦已合併，#177 原碼已隨 v66／v67 預覽發布，未作正式 Server 部署。#168～#170 的固定平台 services、owned cleanup 及日額可證實不一致拒絕保留，完整 restore gate 仍未解。#171 單字補問修復與額外查回輪才 completed 的限制見[原證據](artifacts/verification/CHAT_DOCUMENT_CLARIFICATION_20261009.json)；#172 的本人 user 原訊息／取消不可復活守衛及歷史原 op 查回見[原證據](artifacts/verification/CHAT_WORK_SAFETY_20261009.json)。#173 的搜尋／準備單修正已合併；先前未能取得既有預覽來源，原因未明；本輪經官方來源流程恢復；[#182](https://github.com/2NTTY/child-ai-caregiver/pull/182) 已合併；既有公開 Sites v67 於 2026-10-10T08:45:53Z 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`。radio 定向真瀏覽器在 1440／1024／390／320 四尺寸的 31 項觀察通過；PDF 只見 fixture 預期錯誤，實際下載／pending race 仍未驗。前端包入口見 [frontend/STATUS](frontend/STATUS.md)；本 Server 未部署，原失敗及未驗紀錄保留。
- **#174 已合併驗收界線：**已用真 work／continuation／run stores、worker、ProductAgent 及 ADK，搭合成 Pool／scheduler／clock／provider，補驗授權到期後取消及 worker 重建／重投零執行、合併事件只執行有效工作、成功原收據及逾時 unknown 查回不再生成。三個連貫場景及一個受影響背景工具測試通過。合併事件中的已取消工作可能讀到別項完成後的同批 completed，原 per-work 斷言紅保留；沒有每 constituent outcome／取消時間權威，未以 timestamp 或目前 cancelled 改寫歷史台帳。該切片只讓工作卡優先顯示取消，關聯 cancelled 列明「此工作關聯接續」、其餘列明「同批跟進事件」，並澄清工具指引／[既有契約](docs/API.md#p2-a06-continuation)；三個靜態 render 反例通過；其中 queued 同批仍有效的取消投影由 review 揭示並修正文案。Server／frontend typecheck 通過，最後字串分支修訂後只重驗三個 render，未重跑核心。固定[證據](artifacts/verification/CHAT_FOLLOWUP_RECOVERY_20261010.json)區分原 API 限制與 UI 修正，獨立 review 已消除 queued-overlay 文案阻塞，dot 已親審產品 diff、最後三項 render 及證據界線，准予精確11檔正常 PR 交付，現已由 #174 合併；未發布／部署。
- **#175 已合併驗收界線：**受信固定平台 claimed services 的 model／query embedding 已共原 Firestore 日額，契約見[原日額台帳](docs/CHAT_AGENT_DURABLE_BUDGET.md#shared-query-embedding)。舊 missing-kind／ciphertext 相容、實際 nullable 用量、同 query cache，以及 lookup／失去回覆／權威異常不得落 SQL／keyword fallback 的守衛保留。原 SQL 日額偏離紅與 review 授權重查異常紅均保留；首輪8項核心（含1個 parent）＋6項受影響及 typecheck 是修前證據，修後3項定向及 typecheck 通過，沒有重跑8＋6。12份本任務 audit 及1份 reviewer 原紅 audit 均零網絡；詳見[固定證據](artifacts/verification/F01_SHARED_EMBEDDING_USAGE_20261010.json)。精確14檔經獨立 review／dot 最終驗收後正常合併，未發布／部署，不解鎖全平台共額、正式持久流量或 restore gate。
- **#176 已合併驗收界線：**accepted 同訊息確認重試與唯讀 reader 共用原已授權 client／鎖內的收據驗證；失效收據／lookup error 不作 absence，不重做 decide，有效過期結果保持冪等。6項必要定向、Server typecheck 及 reviewer 1項 bigint／proposal int／SQL形狀補驗通過，原紅保留，詳見[固定證據](artifacts/verification/CHAT_CONFIRMATION_RETRY_20261010.json)。精確9檔已正常合併，未部署；不代表歷史來源全文重驗或完整恢復。
- **#178 已合併驗收界線：**既有成長關注呈現沿原 ID／version／hash／適用性及前後授權的同次引用重驗讀回受核 text，避免把未讀完的原文片段當成受核正文；一般 bool 重驗、原文累積 coverage、預算及公開 DTO 不變。bc886820 基線首輪4＋5＋1項及 typecheck（含真 Runner 搭合成 provider）與空正文返修後3項／typecheck、reviewer 4項拒絕各自保留，未將真 Runner 稱為返修後重跑。原擴讀混用紅、review空正文紅及工具路徑失誤不改；詳見[固定證據](artifacts/verification/CHAT_REVIEWED_GROWTH_EVIDENCE_20261010.json)。精確8檔已由 #178 正常合併，未部署，不解鎖 A09／完整 F01。
- **#179 已合併驗收界線：**既有家庭文件 PDF 每頁非診斷提示／頁碼的 renderer 窄修已合併。歷史 QA_DOCUMENT_INTEGRITY 明列未解，本輪以 #178 原 renderer、指定 v1.522 字型及同一18項合成 snapshot 真 render 重現2頁皆缺頁尾。字型先遇 GitHub connector UTF-8 格式限制，其後只按倉庫明列官方公開 asset 取回；實際 bytes／SHA256／Git blob 全吻合，不換字型／依賴。layout 取證確認繼承 lineHeight 在 dynamic relayout 被反覆放大至頁面外；minHeight 候選無效、正文 View 隔離候選改成3頁，兩者均拒絕並保留原 PDF／抽字／render 圖。最終只給 footer 設 lineHeight:0，按已裝 stylesheet／textkit 的零值與自然字型行高語義阻斷放大，原正文 Page 樹與所有內容不變。定稿單一2頁 PDF 抽字、字形範圍及逐頁 PNG 視覺檢查通過，非診斷提示及1/2、2/2完整可見；82個正文 word／bbox及正文像素與原紅完全一致，原163字 coverage／18項正文及不可變 snapshot 保留。只做 renderer＋shared 範圍 typecheck，沒有全量驗收；工具碼兩次錯誤及首次 tsc CLI 錯誤亦保留。2份 code／script 維持 freeze，程式／文件及實際雙頁 PNG 獨立覆核無阻塞；dot 親審核心 diff／證據及末頁圖後最終 Allow，精確6檔已由 [#179](https://github.com/2NTTY/child-ai-caregiver/pull/179) 正常合併；未發布／部署；詳見[固定證據](artifacts/verification/QA_PDF_FOOTER_20261010.json)。這只證明 renderer，不能代替既有 v65 的3次被合成傳輸攔截匯出、實際下载／跨孩子 byte 隔離／取消後晚到結果／HTTP API，也不改四用途、私人資料或來源重驗契約。
- **#181 已合併驗收界線：**受信固定profile可選有界runLimits，在bind前選入原AgentBudget，與持久binding、Runner及gateway共用；正式default4、工具8、期限90秒、日額及取消／授權／原收據不變。合成4／6／4三輪已用4／5／3個模型步完成同work澄清、同文件只寫一次、本輪保存completed後獨立present及新對話零重寫讀回。最後profile守衛、同輪流程及Server typecheck通過，原baseline紅與測試漏設availableInputs失敗保留；程式／根文件獨立review及dot最終裁決已通過，精確11檔已由 [#181](https://github.com/2NTTY/child-ai-caregiver/pull/181) 正常合併。這不是付費批次或完整產品完成，第15次全鏈准入／歷史successor台帳及US$30費用gate仍待落實；見[窄驗證](artifacts/verification/TRUSTED_RUN_LIMITS_20261010.json)及[接點契約](docs/CHAT_AGENT_DURABLE_BUDGET.md#claimed-services)。未部署。
- **#183／#184 已合併前置：**[#183](https://github.com/2NTTY/child-ai-caregiver/pull/183) 的逐工作起始輸入證據契約／離線合成前置已合併；included／not_included／歷史 unknown 只表示原 run 已提交起始輸入，不等於逐工作執行、完成或成功 outcome。原 per-work 診斷紅及 7／7 手寫規格／既有 strict DTO 相容證據保留於[原 artifact](artifacts/verification/F01_FOLLOWUP_INPUT_EVIDENCE_20261010.json)。[#184](https://github.com/2NTTY/child-ai-caregiver/pull/184) 已加入 recovery-only Firestore 原收據 adapter 及互斥 processor 分支，沒有建立新 claim 或重做 provider／side effect；本輪保留其 5 項定向回歸。兩者均未啟用正式流量／部署，不能當作完整同庫 authority lifecycle 已建立。
- **#185 已合併界線：未啟用的 F01 純到期 Firestore writer／consumer。** 在完整既有同庫 canonical control／account／workspace／child／work／followup 權威前提下，原子建立到期事件、每日標記及新 claim／完整 included／not_included 起始快照，只把成功 transaction attempt 的 context 交給真 ProductAgent／ADK consumer；受限為站內補問／記錄回述。根 budget、日額、worker 身份、取消及原期限保留；失回覆只查原收據，unknown 不重播，取消後 finish 零效果，已完成原密文不可變；合法 V1 經嚴格原 job／claim／run 證明走 lookup-only，不升級或補造 V2 證據。契約見[Firestore 接點](docs/CHAT_AGENT_FIRESTORE_RECOVERY.md)，合成資料與 deterministic provider 的 23 項定向測試（作者 17＋獨立 reviewer 6）及 scoped TypeScript 通過；reviewer 揭示的新 consumer 拒絕 V1 真紅保留，原斷言未改修後轉綠。9 檔固定 manifest `68b07c22b15ac4e9b9ddbd9791c07cc351ace1f68d652bc4c9b5fcd0f8fd843a` 已獲獨立 Allow 及 dot 核准正常 PR 交付，詳見[固定證據](artifacts/verification/F01_DUE_WORK_AUTHORITY_20261010.json)；已由 [#185](https://github.com/2NTTY/child-ai-caregiver/pull/185) 正常合併，未啟用／部署。現有 PG 路徑 3 項回歸保留；沒有 SQL／Firestore 雙寫、新 SQL、真模型／網絡外呼或部署。這只是受控未啟用接線，不是正式 migration：canonical 建立／同意／撤權／刪除／accessVersion／epoch lifecycle writers、正式 bootstrap／排程／outbox／cleanup／restore、query／DTO、真 Firestore 競爭及逐工作 outcome 仍未完成；三個其他 Agent 只留接口。
- **受控文件批次離線 consumer：局部機械驗證已實作。** 唯一產品改動是 gateway 共用原生 payload builder／固定 SDK options；原模型、thinking、輸出下調與 abort 語義保留。真 GenAI 2.24 serializer 的最後 URL／JSON body 先固定、雜湊及同 bytes 准入，再交合成 counter／transport；同一合成舊帳保留 20 cap、跨 root 預留／防重／失敗停止，live factory 無條件拒絕。真 ProductAgent／ADK 搭合成依賴以4／5／3完成兩文件澄清、單字選擇、只改原ID一次、完成同work及新root讀回同文件，0 embedding。原收據只由受信 inspect 核未變，第三root尚未透過產品工具讀取原receipt正文；同一回覆內多工具的即時中止hook未加，已接的是下一request／root終局停批。五碼已獲獨立 Allow，dot 已親審最後9檔／根文案並核准精確12檔正常PR交付，記錄時尚未PR／合併；原SDK frozen-schema、cap下調、duplicate-resource紅及review修正分別保留於[固定證據](artifacts/verification/CONTROLLED_DOCUMENT_BATCH_20261010.json)，接線／未驗界線見[候選說明](docs/CONTROLLED_DOCUMENT_BATCH.md)。這不是live ready、真模型理解或全流程完成。可靠token上界／counter授權與費用、Vertex thinking-output硬限、累計US$30及原20 successor權威、新批次明確批准仍未具備；不重置歷史、不改workflow／manifest或啟動付費批次。
- **接續順序：**沿同一工作意圖、待答／待確認及工具結果契約，補齊連貫合成流程：不完整交代 → 必要補問 → 原工作接續 → 查證 → 保存／同 ID 局部修改 → 中斷後查原收據 → 新對話讀回 → 授權提醒及取消。獨立小修可並行；依賴新接口／儲存的接線須等相應候選 review／合併。 目前這種工具序列的「寫入後據收據更新 work，再獨立 present_answer」需要第5個依賴模型步；正式預設上限4不變，#171 原合成流程使用額外使用者查回輪的證據保留。#181固定profile切片只證明合成4／6／4接續中，第2輪可用5步按原收據保存工作完成再獨立呈現；尚未真模型驗證或解鎖通用成果權威，不以合併終結 batch、省略讀版本或只改harness常數冒稱完成。 沒有明確單目標權威時，不把一次文件工具成功當作整個 work completed；本輪不補假 binding 或跨 receipt 新框架，取消／來源守衛已由 #172 完成；跟進取消／原結果證據及同批事件呈現已由 #174 合併；共用日額已由 #175 合併；受核正文／擴讀片段混用已由 #178 合併；上述既有 PDF 頁尾窄修已由 #179 合併；接續仍按未完成 gate，獨立公開 Sites v67 已發布並通過上述四尺寸 radio 定向瀏覽器驗收；PDF fixture 錯誤不代表下載成功，實際下載／pending race 仍未驗。Server 本切片未部署，起始輸入前置契約不等於原 per-work outcome 缺口已完成，不擴用途矩陣。
- **仍未完成：**default memory 保留，持久模式重投僅停止並查原結果；已有持久 work、取消及收據不等於跨程序恢復。正式 bootstrap／index／worker、動態本人設定、正式 query embedding 日額及其他 SQL 路徑的跨後端共額、帳戶／孩子清理及日額 restore 協調、跨庫取消／副作用 fencing 及 resume 尚未完成；既有 SQL 日額仍非 attempt 冪等，已合併模型日額及本輪 services 均屬可選非 SQL 組裝，未啟用正式流量。F01–F03 仍須核非 SQL 交易、持久受理／outbox、跨 instance 限額、重啟剩餘工作、unknown 查原結果及撤權；舊 SQL 作遷移對照，不新增後續 SQL 依賴。
- **驗收與限額：**scripted／mock／Emulator 只證明所驗機械邊界，不能代替真模型理解、真雲端或完整產品成果。32k 下界失敗與 64k 配置通過分開；字元不是 token。原真模型批次 **20／20 已用盡，原台帳及失敗凍結保留**，見[原整合記錄](WORKLOG.md#log-20261009-initial-summary-integration)；不能把次數耗盡當作費用耗盡或以新run清零。2026-10-10已獲相關工作累計上限US$30授權，包含先前支出；付費仍須先核完整歷史費用、未入帳／在途預留及新批最壞上界。總成本覆蓋未成立，尚未建立或執行新live批次；本次只有零外聯窄候選，資源／身份／權限及安全邊界不變。
- **未解鎖事項：**正式 Firestore／Auth／Tasks 等雲端切片及切換仍按既有資源、成本和資料安全批准執行；不自行建資源、續期 VM 或改正式資料。其他角色恢復實作須由使用者明確改變本輪範圍，不能因歷史 F 包文字自動開工。

#140 已合併的有效修正及原部署觀察保留於 [原收束記錄](WORKLOG.md#log-20261008-pr140-closeout)；歷史 F01–F08 依賴以本入口的單聊天範圍解讀，未完成項沒有改標完成。

<a id="p2-firestore-migration"></a>
## P2 Firestore 與集中雲端服務遷移

2026-10-08 使用者定案。本節取代 [P2-A 計劃](#p2-agent-service) 的 PostgreSQL／Better Auth／單 VM **後續交付路線**，不取消 Agent、資料治理及穩定服務門檻。決策見 [ADR-019](docs/DECISIONS.md#adr-019)，機制見 [架構](docs/ARCHITECTURE.md#firestore-target)，產品要求見 [SPEC](SPEC.md#p2-firestore-service)。

### 基線與保留範圍

0c22180 實際依賴為 35 份 SQL migration、97 個建表定義及 27 個 store factory；PostgreSQL 同時負責交易、授權鎖、收據、變更序號、pg-boss 與 pgvector。這是保存及執行機制遷移，不能只改連線名稱。按 [依賴盤點](docs/TECH_REUSE.md#firestore-dependency-audit) 逐域對照，不把 SQL join／savepoint、cascade 或 trigger 當作 Firestore 已提供的能力。

集中邀請制讓家長註冊登入後使用本人空間，不要求自建 Server、建立家庭或提供 key。保留 ADK、Prompt Pack、前端設計／owner、平台 AI、可選本人 key、家庭成員／私人資料隔離，以及所有已有功能、修復與有效證據。家庭增補、Android、自部署、大型管理及跨 Server 通用遷移仍延後。

| 項目 | 已確認目標；不代表已接入 |
|---|---|
| 資料／檔案 | Firestore Standard Native；私有 Cloud Storage；保留應用層加密 |
| 運算／入口 | Cloud Run 按請求計費、minimum instances 0；Firebase Hosting 同源 API |
| 身份／准入 | Firebase Authentication；產品管邀請、本人空間、角色、資料同意及逐裝置會話撤銷 |
| 背景 | Cloud Tasks＋Cloud Scheduler＋Firestore 持久工作台帳／outbox |
| 地區 | 業務資料及運算預設香港 asia-east2；已接受 Firebase Auth 在美國處理認證資料，不宣稱全部資料只在香港 |
| 規模／保留 | 初期 10 帳號、約 3 日活；每日備份 14 天；附件 7 天復原期另加配對備份覆蓋 14 天；獨立持久刪除紀錄 |
| 切換 | 可短暫維護停寫；不建長期雙寫 |
| 排除 | Firebase SQL Connect／Cloud SQL、額外常駐搜尋叢集、重寫 ADK／前端 |

### 全包共同完成邊界

以下仍是 F01–F08 的共同 gate；只引用既有契約，不因收短而取消細節：

- **保存／查詢／清理：**逐 store 核固定 ID、密文／AAD、版本、原 opId、授權／索引／游標、有界投影及交易原子性；唯一性、回調重跑、FK／cascade／trigger 的承接依 [資料契約](docs/DATA_MODEL.md#firestore-target)及[架構](docs/ARCHITECTURE.md#firestore-target)。
- **身份與隔離：**合成密碼匯入相容、邀請／本人准入、逐裝置撤銷、跨 instance 限流／配額，以及背景／附件即時授權，依同節[身份契約](docs/ARCHITECTURE.md#身份准入及會話)驗證，不能只靠 Rules 或單 instance。
- **背景與前端：**持久受理／outbox、Scheduler／Tasks、私有 worker、lease／generation／unknown 及 202／runId、Hosting／session 接點，依[非同步機制](docs/ARCHITECTURE.md#縮零outbox-與非同步-agent)及[API](docs/API.md#firestore-target)；保留既有 UI。
- **知識：**1024 維向量與有界公共混合檢索、適用性先行、權重／RRF、不可變發布及即時停用，依[知識契約](docs/ARCHITECTURE.md#官方知識與發布)；兼容向量不重算，私人內容不進公共索引，重要含義仍須核對。
- **附件／刪除／恢復：**私有 immutable 物件、授權下載、獨立不可覆寫加密刪除 journal、隔離還原及 epoch，依[檔案契約](docs/ARCHITECTURE.md#檔案刪除及恢復)；7 天復原窗不能代替 14 天配對備份。
- **成本與品質：**跨 instance／縮零／重投遞不能重置根預算；現行模型／每日配置不提高，四角色 6 次生成提案暫不啟用。F07／F08 仍須驗聊天引用、保存／局部修改、新對話讀回、授權跟進及其他角色接口；其內部實作暫緩，基建切片不能代替聊天成果。

### 工作包與依賴

下表保留遷移工作包與依賴；實際進度以本頁當前入口及各包證據為準，研究、隔離候選及草稿 PR 不當已合併。按 ADR-021，本輪只有聊天 Agent 與另外三角色接口，後者內部實作不作依賴或完成門檻。需要隔離或獨立交付才開 branch／worktree；相關修改沿用既有分支／PR，不逐小項批量建立。必要驗收、主模型 review 及 PR 正常合併後才解鎖依賴。份額是預分配，署名／推送／合併按實際參與及主責帳號核對；D 驗收不冒充開發。文件包 A100%，後續四包 C 主責。

| 工作包 | 狀態／前置 | 交付／gate | 主責；權重；預分配 |
|---|---|---|---|
| <a id="p2-f01"></a>**P2-F01** 遷移契約與接點 | 進行中；文件定案、#140 已合併，完整接點／對照仍待完成 | 逐 store 資料／查詢／交易／清理對照、Auth／session port、固定 SDK／索引、最小儲存接口；補聊天與其他角色接口、草稿／確認／發布邊界及現有互動／維護預算；保留 PostgreSQL 回退實作，不自建 SQL 引擎 | A；3；A60%／C40% |
| <a id="p2-f02"></a>**P2-F02** 合成雲端切片 | 未開始；P2-F01、資源／費用上限另批 | 登入、引用、保存／修改、防重、排程、附件、刪除／隔離還原；真雲端通過才搬全部功能 | C；5；C70%／A20%／D10% |
| <a id="p2-f03"></a>**P2-F03** 核心業務資料 | 未開始；P2-F02 | 完整帳號／家庭權限、孩子、記錄、記憶、聊天、持久工作、確認、changes 與收據；聊天 runtime、其他角色接口、持久確認狀態及根運行共同預算 | C；5；C70%／A20%／B10% |
| <a id="p2-f04"></a>**P2-F04** 文件、檔案與退出 | 未開始；P2-F03 | 聊天 Agent 經既有記憶／任務／文件服務保存可重用成果及局部修改；資料編製 Agent 僅留接口；文件／修訂／報告／照片、匯出、退出、持久刪除及配對加密備份，14 天資料／附件能一起恢復 | C；5；C60%／B20%／A20% |
| <a id="p2-f05"></a>**P2-F05** 官方知識 | 未開始；P2-F02、P2-F03 | 既有官方知識的保存／混合檢索、來源閱讀及發布／停用邊界；獨立知識維護與審核 Agent 僅留接口，其內部自主收集／語義審核不在本輪；保留 body 檢索與兼容向量 | A；5；A70%／C30% |
| <a id="p2-f06"></a>**P2-F06** 全背景流程 | 未開始；P2-F03、P2-F05 | 任務、關注、聊天工作接續、既有來源更新事件及通知重試／停止；其他角色喚醒只保留接口；郵件保留／替代對照，不能漏 pg-boss 消費者 | A；5；A50%／C40%／D10% |
| <a id="p2-f07"></a>**P2-F07** 全量合成演練 | 未開始；P2-F04、P2-F06 | 資料對帳、隔離還原、反向同步／回退及 Auth 相容映像；新寫入、刪除、審核／草稿／維護進度與 unknown 不丟失；納入聊天成果、其他角色接口及現行預算必要驗收 | C；3；C70%／A20%／D10% |
| <a id="p2-f08"></a>**P2-F08** 正式入口及交付 | 未開始；P2-F07、維護窗口／實測預算另批 | Hosting／Cloud Run 正式入口、完整聊天 Agent 成果／實測成本及其他角色接口、切換及舊 VM 收束；承接 A09 未完成 gate | B；3；B50%／C40%／D10% |

F02 以少量合成帳號、孩子、一份文件、一項提醒、一張附件及少量已核對知識走通「登入 → 查證 → 保存／修改 → 原操作重試 → 縮零後喚醒 → 刪除 → 隔離還原」。同流程順帶驗越權、撤權、版本衝突、引用及 Tasks 重投遞，不拆大量 E2E。Emulator 只證明基本邏輯，不能代替真向量索引、交易競爭、OIDC、Tasks 及 scale-to-zero；失敗保留現場、修正方案後才決定是否繼續。

### 低用量預算假設

2026-10-08 公開單價推算，美元／月，**不是帳單、免費保證或資源授權**；未扣促銷信用，未含過渡舊 VM、一次性遷移／建置突增。費率與免費額範圍見 [成本依據](docs/ARCHITECTURE.md#firestore-cost)。

| 每月估算 | 10 帳號／3 日活 | 50 帳號／15 日活 |
|---|---:|---:|
| Agent 運行 | 120 | 600 |
| 每 run 平均 | 3 次生成、1 次 query embedding | 相同 |
| 每次生成 | 10,000–15,000 input／500 output tokens | 相同 |
| 一般 Firestore 讀／寫 | 25 萬／5 萬 | 100 萬／25 萬 |
| 公共 chunks／向量查詢 | 5,000／120 | 5,000／600 |
| DB／原附件 | 0.5 GiB／1 GiB | 2 GiB／5 GiB |
| Scheduler 補償喚醒 | 約 43,200 次 | 約 43,200 次 |
| 活躍 CPU／記憶體 | 30,000 vCPU-s／20,000 GiB-s | 100,000／70,000 |
| 模型預算 | 約 $1.2–1.7 | 約 $6–8.3 |
| 整體規劃區間 | **約 $2–6** | **約 $8–20** |

**實際成本待量測：**本表仍是平均每 run 3 次生成的歷史情景，不是聊天成果的已測帳單；本輪按現行配置記錄完成一件聊天工作的 tokens／呼叫／耗時與返修。其他三角色及歷史 6 次生成提案暫緩，其成本不得預填為已驗或當本輪交付前置；未因此批准提高每日額度。

模型按現有 Gemini 3.1 Flash-Lite／gemini-embedding-001；新增語料 embedding 另算，兼容向量遷移不重算。CPU 假設包含補償喚醒／冷啟動及 Agent 等待，F02 量測後修正，不當已測效能。區間容納配對備份、索引、少量傳輸／日誌；免費額被共用帳單其他服務佔用、大量下載或重建須另算。50 帳號只是容量情景，**不批准提高每日額度**；現有上限可限制實際服務量。

### 切換、回退與未決門檻

1. F07 全功能及反向演練通過，按批准窗口停寫／停舊 worker，核對 in-flight／unknown，不能當未執行再入列。
2. 取得配對備份，搬固定 ID、版本、密文、收據、待確認、未完成工作、引用及刪除紀錄；核數量、hash、關係、權限及索引，只讓一套恢復寫入／排程。
3. 開放前可退回相容 PostgreSQL；Firestore 已接受新寫入後必須再停寫、反向同步及對帳，不能切舊快照。回退映像仍支援 Firebase Auth，不恢復舊密碼／撤銷會話或重投舊工作。
4. 新環境及還原通過後才按核准範圍收束舊 VM／磁碟／IP。舊 VM 最後核對 STOP **2026-10-10 20:50:44 HKT**，本計劃不續期、不承諾屆時遷移完成；仍需舊環境時另處置。
5. #140 有效修正、Prompt Pack 版本及失敗證據逐項追溯；新平台不消除真引用／局部修改／新對話讀回缺口，也不重跑有效驗收。

框架、地區取捨、規模基線及保留政策已定。**F02 建資源前**另批准具體資源／成本上限；**F08 切換前**另批准停寫窗口、實測預算及舊環境處置。身份匯入、混合檢索品質、熱點／讀取成本、縮零及刪除還原仍待實證，不是要求使用者猜測的架構決定。

本文件包只查 diff、連結／錨點、依賴無環及現行引用，零產品測試。後續按有效授權做最低必要連貫成果及安全邊界，不跑全面矩陣或 Computer Use；真模型／通知不超原限額及明確對象內容。

<a id="p2-agent-roles"></a>
## P2 四角色 Agent：保留的後續接口目標（內部實作暫緩）

本節保留 2026-10-08 的四角色目標作接口與後續範圍對照；2026-10-09 已由 [ADR-021](docs/DECISIONS.md#adr-021) 收窄當前實作。下列角色內部、兩條四角色流程、6 次預算及 AC-P2M 全量門檻均屬暫緩目標，不是本輪 F01～F08 依賴；只有聊天與接口按 [當前入口](#active) 推進。原提案取代「文件生成 Agent」／聊天搜尋子模型式資料收集，但不授權現在開始內部實作。產品要求與四條 AC 見 [SPEC](SPEC.md#p2-agent-roles)，編排見 [架構](docs/ARCHITECTURE.md#p2-agent-roles)，決策見 [ADR-020](docs/DECISIONS.md#adr-020)。

### 目標、現況與交付範圍

家長只面對同一育有方助手：自然交代、查證及辦事，必要時編製可保存／重用的資料，再看真實結果。不是每輪都運行四個 Agent，也不把所有普通操作改為生成文件。

| 角色 | 工作與邊界 |
|---|---|
| 聊天 | 理解口語及多輪指向、補問、檢索已發布知識／歷史、使用業務工具與按需委派，保持唯一對話入口 |
| 資料編製 | 整理需保存／重用、嚴格格式或專門風格的資料；包括準備內容、成長整理、照護說明、有用記憶／摘要與待辦草案，不限文件 |
| 審核 | 唯讀原始證據，核對實質回答／編製成果／知識更新的含義、引用、適用性與披露範圍；不能代家長同意或自行寫業務／發布 |
| 背景知識維護 | 獨立於聊天，在核准網站／路徑內自主讀目錄與連結、取得圖片／PDF 等新版、整理資料並經檢查後更新知識庫；沒有家庭私人資料權限 |

基線 `e6842fc` 已有單一 ADK 工具循環、引用身份／版本校驗、文件版本與局部修改、來源刷新／發布及文字 PDF 抽取；尚缺四角色委派、獨立語義審核、官方視覺資料理解與跨角色共同預算。已有能力與失敗／未驗證據保留，不把本文件當 runtime 已接通。

### 暫緩的四角色流程與結果對照

- **互動：**家長交代 → 聊天查詢／操作 → 必要資料編製 → 審核 → 按授權保存或待確認 → 真收據回報／各頁同步。清楚的普通記錄、勾選、改期仍可直接走現有工具；不為確定性操作額外調模型。
- **知識維護：**排程或管理入口 → 背景讀取指定網站 → 整理／比較新版 → 審核與程式檢查 → 自動發布／更新／停用 → 供之後查詢。沒有聊天請求亦可運作；聊天搜尋直接用 KnowledgeRetriever，缺口只記待補，不擴大爬取或採信未核內容。
- **資料而非副本：**輸出依領域 schema 進原記憶／任務／文件服務；待辦是任務，網頁／卡片／PDF 是同版資料的呈現。既有成果局部修改保持 ID／版本／原 opId；草稿和正式成果分開，推測不升格事實，審核不代替重要操作確認；更正／撤權／失效同步影響衍生物。
- **審核：**重要含義以原始證據核對，不只驗引用 ID／hash。結果綁成果內容、來源版本、對象及範圍；改動須重新核對，未通過不正式保存或呈現。純澄清／確定性收據免額外模型，官方緊急求助內容可立即呈現；不宣稱零錯誤或臨床有效性。
- **自主維護：**指定網域／路徑／主題／使用範圍內，可有界跟進站內連結；原文、模型抽取與整理分開，圖片／PDF 保留原始頁面、版本與完整度。未變內容復用，長資料分批保存進度；檢查通過自動更新，含義不明／矛盾保留候選，抓取暫失不當失效。不得修改執行醫療／成長規則或把家庭／私人付費來源混公共庫。

### 暫緩的預算、次序及驗收提案

以下保留原規劃，未啟用，不提高現行限額。互動的所有角色共用最多 **6 次生成**，包含委派、審核及修正；不是每角色 6 次。8 工具、2 次 query embedding、90 秒、每次輸出及上下文上限與每日配額不提高，本人更低上限仍有效。預留審核呼叫，餘額容許才最多一次修正／重核；耗盡保存進度，不新開 run 繞限。背景知識維護使用獨立有界工作／平台預算，不用家長私人 key；未變內容不重做模型整理。細節與目前配置分界見[運行配置](docs/ARCHITECTURE.md#p2-agent-budgets)。

原四角色交付構想（目前暫緩）：F01 契約 → F02 雲端切片 → F03 共用 runtime／聊天／審核 → F04 資料編製及 F05 知識維護 → F06 全背景 → F07／F08 成果／遷移驗收及交付。F05 增加 F03 前置，其餘依賴及約一半 C 主責安排保留。主模型親寫契約及角色 prompt，沿既有 manifest 按需補模組，不複製四套 Prompt Pack，不重做前端。

四角色日後恢復實作才適用的驗收為 [AC-P2M-01～04](SPEC.md#ac-p2m-01)：模糊交代後有依據的可重用成果／新對話及跨頁讀回；指定項修改與版本／引用拒絕；無聊天時取得視覺來源新版、核對發布後可引用；範圍／私人隔離、重投遞及根預算控制。合併連貫情景並復用有效證據，不為四角色各跑整套 E2E；真服務／雲端沿各包批准成本邊界，不用 Computer Use。

2026-10-08 該次只有文件定案、連結／依賴／diff review，未修改程式或 Prompt Pack、未呼叫模型、部署或建立資源。現在的唯一實作入口是 [#active](#active)；#140 已收束，F02 實證及原 A09 聊天成果門檻仍保留。

<a id="current-capability-gaps"></a>
## 新前端能力差距（2026-10-07 源碼核對）

以下是 `0a39e018` 在 2026-10-07 的開工差距快照，條目中的「目前／下一步」只指當時，不是第二份當前待辦。後續 P2-A02～A07 已合併的實作及其限制見[包表](#p2-agent-service)；原 A09 聊天成果與遷移 gate 仍由 [#active](#active) 承接。舊包完成不等於整體產品完成，正式部署及真使用驗收依 [STATUS](STATUS.md#deployment)。

- 準備單已有多文件權威／版本／清單／歸檔及Agent工具；正文仍是確定性來源整理與固定清單，未有Agent依要求撰寫／修改正文、日期及增刪項目。下一步先定同一document的編輯、來源grounding與版本契約，不另建內容副本。
- Agent文件讀取只列前20份，正文超7000字不返回且無分段續讀；需有界搜尋／游標及固定版本章節讀取，不能以內容部分標誌當已讀完。
- 成長報告目前固定range且partial，不代表完整年度／季度檔案；逐觀察期間篩選修復已隨PR #117合併，尚未部署。年度／季度分類、長期容量與合法歷史查閱另待完成，不放寬撤權遮蔽。
- 每孩子50文件含歸檔、歷史僅最近仍有效快照、聯絡首50項及無游標，長期可找回／可新增能力須規劃；不能把載入前綴冒充完整歷史。
- 提醒通知及人工核對已有後端、新UI及權限／unknown流程；仍須真流程驗收。任務尚無完全禁背景的獨立模式，不將無外發授權說成沒有站內事件。
- 長期記憶人工管理已接，短期脈絡／參考目錄及Agent更正／停用已有事實未接；管理表單只作後備，不要求家長管理資料庫。
- 指定共享家庭建立孩子及簡潔可達的緊急求助入口未等價接回新UI；保留原能力，不能列為无用退休。舊單份準備仍有資料／原操作恢復入口，不刪或自動複製成新文件。



<a id="qa-report-period--關注觀察的固定期間歸屬已合併待部署"></a>
### QA-REPORT-PERIOD — 關注觀察的固定期間歸屬（交付記錄）

- PR #117 已合併為 `31025d6`；逐觀察以原事件 ID／日期歸屬期間，保留來源權威、未知日期、80 項 coverage、同版 PDF 及舊快照相容，不遷移／刪除資料。原跨季聚合缺陷、香港跨日／超過 5 條／更正撤權等檢查與雙方 10／10 定向結果見[原證據](artifacts/verification/QA_REPORT_PERIOD_CHECKS.json)及[LOG](WORKLOG.md#log-20261007-report-observation-period)。
- fake Pool／mock renderer 與 scoped typecheck 不代表真 DB／PDF 排版／正式 UI 或全面產品驗收。#117 已包含於最後觀察的 `85e3a846`；部署版本按 [STATUS 日期觀察](STATUS.md#deployment)，不是本輪重新部署或真 UI 重驗。

<a id="qa-adk-runtime--指令資料分層與安全終結已合併待部署"></a>
### QA-ADK-RUNTIME — 指令資料分層與安全終結（交付記錄）

- PR #113 已合併為 `0a39e018`。基於 #112／`a347956b` 將不受信 context 移至資料 part、受信指令改 InstructionProvider，保留原生 parts／大括號原文；有效 present_answer 終結原生 loop 並再核引用／授權，混合 terminal batch 在 handler 前拒絕。互動 64k／背景 32k、selector／跨輪來源／DB 未由本包擴改。
- Prompt Pack 0.1.25、44／11／83／53 項各輪結果、四組 T7 的四輪／單一 pending 候選及兩份 scoped typecheck 見[固定證據](artifacts/verification/QA_ADK_RUNTIME_CONTRACT_CHECKS.json)及[LOG](WORKLOG.md#log-20261007-adk-runtime-contract)。本機 scripted 通過不代表真模型／UI；部署依 [STATUS](STATUS.md#deployment)。
- 該包未解的漏調 present_answer、澄清跨輪來源、背景 no_action 及按能力裁剪須與後續修正和 [當前 gate](#active) 一起讀；不把本包當全部 ADK／Agent 完成，不另建 persistent state 或第二套記憶。

<a id="qa-interactive-input--待辦意圖與互動容量已合併待部署驗收"></a>
### QA-INTERACTIVE-INPUT — 待辦意圖與互動容量（交付記錄）

- PR #112 已合併為 `a347956b`；基線 #110／`9d1024c` 的 T7 在一次生成及一次被拒 propose_task 後超限，沒有建待辦，確切線上參數錯誤仍未知。修含修飾語的明確意圖及標題／內容資料邊界；互動 AI_AGENT_MAX_INPUT_CHARACTERS 預設 64k、範圍 32k–64k，背景 32k、P1、生成／工具／輸出／時間及授權不變。
- 設定頁只讀 Server 真值，舊 metadata 不猜值；47 項定向、兩份 scoped typecheck 與獨立多意圖修正見[固定證據](artifacts/verification/QA_TASK_INTENT_BUDGET_CHECKS.json)及[契約 LOG](WORKLOG.md#log-20261007-interactive-input-contract)。該 head 無 CI checks／workflows，不稱 CI 成功；scripted 不代替真待辦流程，部署依 [STATUS](STATUS.md#deployment)。
- 原 #109／#110 已合併未部署、#111 draft 與真 PostgreSQL 驗證受阻屬當時情況。核心修正已由 #137 合併並取得[本機 PostgreSQL 18.6／029 證據](artifacts/verification/P2_A06_CHECKS.json)；剩餘回歸已由 [#142](https://github.com/2NTTY/child-ai-caregiver/pull/142) 合併，原 [#111](https://github.com/2NTTY/child-ai-caregiver/pull/111) 已關閉未合併，見[補充證據](artifacts/verification/PR111_REGRESSION_RECOVERY_CHECKS.json)。正式 readers／029 啟用仍未核，不由本機結果推定。


### QA-AGENT-CONTEXT-INTEGRITY — 工具容量與數量依據（已部署，保留交付快照）

- PR #107／#108 已部署；A6 真 UI 已讀回未知數量，收據客戶端相容修復在 PR #110。以下 32k 是該包歷史邊界，後續互動容量見上方 QA-INTERACTIVE-INPUT。

- 基線 a75ebb6。正式第 5 次合成請求在模型／工具皆 0 時撞 input_limit；固定 Runner 重建為 35,748 字元，工具選擇誤含前文與禁止通知句。另 12 則各 200 字原訊息被 read_context 重複載入，下一輪也超限。普通記錄 A3 同時揭露模型補入未提供的「1 次」。
- 僅修當前意圖選工具、有界單份 context／精確摘要前綴及 Server 數量 grounding；保留原 gateway contents／config 邏輯 JSON 的 32k 字元上限、原生 parts、權限、opId／unknown、既有 store 及來源邊界。不新增「完全無背景待辦」能力，不改固定報告期間。
- 離線定向 38／38、scoped strict typecheck、原 fixture 失敗與 master 對照見[原證據](artifacts/verification/QA_AGENT_CONTEXT_INTEGRITY_CHECKS.json)及[LOG](WORKLOG.md#log-qa-agent-context-integrity)。mock completed 只驗容量／循環，不能當真待辦已保存；後續部署與 A6 讀回按上方快照，不再把當時 review／部署列為下一步。
- 第 3 次真 Agent 普通保存及第 4 次私人重要候選明確確認已讀回；第 4 次最終文字未通過 present_answer 驗證仍未修。本包不把保存收據等同整個 run 成功。201 項記憶／200 條關注事件的容量死角另待修復。


### QA-DOCUMENT-INTEGRITY — 已合併部署及定向 UI 重測

- PR #103 已合併並隨 Web／API `b7dec9d` 部署；2026-10-07 合成 UI 已重測 stale 歸檔／恢復、刷新勾選保留及真 PDF coverage 完整。這是既有後續觀察，不是本輪新驗收。
- 基線 `b23f12b`；保留未變 checklist、有效來源的 stale 歸檔、無日期關注正文及同孩子／精確期間 active 標準報告 create／restore 防重。固定期間不改，不刪舊文件或改 DB；來源、家庭／孩子隔離、撤權、同版 PDF 及原 opId／unknown 保留。
- 真 PDF coverage 只按固定句號分段、保留原快照。離線 Server 7／7、frontend 25／25、scoped typecheck、35 路由 export、真 PDF 抽字／邊界及原失敗對照見[固定證據](artifacts/verification/QA_DOCUMENT_INTEGRITY_CHECKS.json)／[LOG](WORKLOG.md#log-qa-document-integrity)。fake Pool／shallow 不當真 PostgreSQL 並發或瀏覽器驗收，定向 UI 重測也不是全面產品通過。
- 原分工為 dot 負責修復／測試／覆核／PR／合併，Codex 輔助只做已授權 GCP／部署。真 Agent 首請求另因服務暫不可用停批，與本包零模型文件修復分開；不保留「尚未部署」的過時下一步。


### QA-GROWTH-READ-BOUNDARY — 已合併，保留交付證據

- PR #101 已合併，API／Web `b23f12b` 於 2026-10-07 04:02 UTC 部署；04:09 UTC 原合成地區資料的 Growth UI 已正常讀取並呈現限制提示。此為既有後續觀察，原 draft／待 review／待部署不再是下一步。
- 基線 `01c25a4`、原分支 `codex/fix-growth-filter-boundary`。自由文字 region／未知年齡觸發只接受兩碼地域及最多 120 個月的 parser，合成 A／B 重現 GET 400；無正式 HTTP capture，不冒稱全面線上根因驗收。
- 只在 list／GET 的本機 filter 轉換不可用時略過知識查詢並提示地域／0–10 歲限制，保留 profile、scope、authority、既有候選及其他資料；sourceAvailable=false 只是未確認適用性的讀投影，不存回狀態／版本／歷史。DB／解密／網絡錯誤不吞掉。decide／topic（含回傳 page）／evaluate／Agent search 的嚴格失敗及 worker 邊界不變。
- 修復前 5／9、最終 10／10、6 項真 renderer shallow 及 scoped／frontend typecheck，原 11 個 NodeNext／erasable diagnostics、缺 mount 失敗、共用兩則 notice／正常空頁不變等詳見[證據](artifacts/verification/GROWTH_READ_BOUNDARY_CHECKS.json)／[重跑及對照限制](artifacts/verification/GROWTH_READ_BOUNDARY/README.md)／[LOG](WORKLOG.md#log-qa-growth-read-boundary)。完整 Server 對照只替換 Growth store，不是 pristine master；UI 補正未重跑完整 typecheck。本地零模型／通知／DB／全面瀏覽器與後續一次 UI 讀取分開。
- C 主責、權重 2、C 60%／B 20%／A 20%（初稿 C 75%／A 25%）；共用 AI 在 A 統籌下實作，不代填人手或人工驗收。

此前 QA-POST-RELEASE 已隨 [PR #100](https://github.com/2NTTY/child-ai-caregiver/pull/100) 合併；Web `01c25a4` 的另次部署及公開唯讀核對已交接給 dot。原始修復／失敗證據見 [QA_CHILD_SELECTION_CHECKS](artifacts/verification/QA_CHILD_SELECTION_CHECKS.json)。本包沒有重做或再次部署。

INT-W01～07 已交付的狀態、前置及證據只在[正式整合包表](#production-integration)維護；不再沿用 2026-10-06 的 INT-W07「目前分支／下一包」。當時 INT-W07 從 `053658b`（#96）開 `codex/int-w07-production-delivery`，開工沒有其他 open PR；歷史部署／停止及驗收判斷见[原 LOG](WORKLOG.md#log-int-w07)，當前入口只見 [#active](#active)。

- [DOC-R04](#doc-r04) 已隨 #86 合併結案；未因此啟動下一文件包。前端獨立工作只沿 [frontend/PLAN#active](frontend/PLAN.md#active)，根計劃不複製 FE-Wxx 狀態。
- 正式接點沿[整合包表](#production-integration) → [P2 UI 接點](docs/P2_UI_HANDOFF.md#chat-handoff) → [前端交接](frontend/HANDOFF.md#reading-order)。[正式 Web](docs/PRODUCTION_FRONTEND.md)保存啟動／部署及功能清單；語音、其他文件輸入、短期 run context／全域知識目錄專頁及照片／私人聊天 PDF 等原交付限制不當已完成，也不自動啟動 P3／額外測試矩陣。
- 當前卡及完成原位收短規則直接依 [AGENTS 文件職責](AGENTS.md#document-updates)，不在此再建立另一份現行卡或更新規範。


<a id="p2-agent-service"></a>
## P2 完整 Agent 與穩定 Web 服務總計劃

2026-10-08 使用者定案；本節取代尚未落實的 Agent 增補提案，保留舊 P2／INT 的完成範圍與證據。A01～A08 的實作與最低證據以下表為準；完整服務門檻未完成，不由 master 推定已部署。保存／認證／部署路線已由 [Firestore 計劃](#p2-firestore-migration) 取代。產品行為及 AC 見 [SPEC](SPEC.md#p2-agent-service)，技術邊界分別見 [架構](docs/ARCHITECTURE.md#p2-agent-service)、[資料](docs/DATA_MODEL.md#p2-agent-service)、[API](docs/API.md#p2-agent-service)；替代決定見 [ADR-018](docs/DECISIONS.md#adr-018)。

### 目標與保留範圍

**在 GCP 提供邀請制、可保存真實資料的穩定 Web 服務；家長註冊登入後，一個人便能以「自然交代 → 查證及辦事 → 真實回饋 → 同源呈現 → 適時接續」使用核心 Agent。** 不必建立家庭、邀請照顧者、配置 GCP 或填模型 key；平台提供基本 AI，本人 key／限額只是可選設定。

保留文字、照片、私人來源連結／正文、記錄、記憶、待辦、準備單、持續關注、成長檔案、報告／PDF、本人通知及歷史。沿用 ADK、Prompt Pack、美術、正式前端 owner、權限與操作收據；PostgreSQL／pgvector、pg-boss 是目前實作，按 F01～F08 遷移，不重建另一套業務權威。手動輸入是備援；普通低風險指令在本人授權內直接執行，重要事項在對話內具體確認，未完成工作持久保留。

準備單是某一次到診、入學、旅行等事情到時可直接使用的行動資料；待辦負責「何時做甚麼」。同一事情可連結待辦、準備單及關注鏈，不另存可獨立修改的孩子資料。各頁用途沿用 [DESIGN_SYSTEM](frontend/DESIGN_SYSTEM.md)，保留已確認設計與互動。

延後家庭多人協作與選人聯絡／交接增補、Android、語音、一般文件上傳、自部署、跨 Server 遷移及大型管理介面；既有能力與安全隔離保留。官方手冊 PDF 的公共知識匯入不等於開放一般附件。維持不診斷、不開藥、不建立自動醫療分流；危險描述的已核對求助資訊不能被一般工具流程延誤。

### 五項強制約束與實現方向

| 約束 | 各包必須保留的做法 |
|---|---|
| 語義選工具 | 拆除最後一句／延續詞 regex 的能力開關；常用工具與簡短能力目錄可見，模型依上下文載入工具，原生 function calling 的結果回到同一有界循環。不解析思考文字、不換成另一套固定意圖清單。 |
| 操作綁定確認 | 自然提示列清將改甚麼；Server 綁定操作參數、孩子／資源、資源及授權版本、提問訊息、候選及原 opId。只有唯一且有效的具體確認才承接「好」；模型不能自行產生同意。 |
| 一致的來源範圍 | 檢索前按本人／孩子／用途授權；摘要、文件及外發前再核對來源與目的地。公共、私人、孩子資料分開；coverage／版本／可見範圍不因摘要而放寬。 |
| 官方換版核對含義 | hash 發現變更後，在收集／發布管線核對年齡、數值／單位、時間、條件、例外及撤回；核對受影響引用、少量代表問題及相關規則。通過政策檢查才發布，不確定保留候選，失效舊版不冒充最新。 |
| 有界但可接續的讀取 | 資料庫先授權／適用過濾再排名、限量；搜尋、文件、歷史及完整期間整理使用游標／範圍，回傳 coverage、未讀部分及續讀位置。不能以讀取前綴冒充完整，也不能因資料增多整次失敗或將權限／DB 錯誤偽裝為空結果。 |

RAG 採上下文理解／必要改寫 → 向量與關鍵詞 RRF → 同版本章節／頁面擴讀 → 必要補查 → 有依據回答。約數年齡只是模糊問題之一；保留原話、精度及未知部分，不補造生日或其他事實。私人內容不進公共向量庫，公共查詢只攜必要情境。

持久工作保存目標、焦點、資源、待答問題、待確認引用及結果；不是預寫育兒流程。原始訊息／事件／收據與有 coverage 的摘要分開；相關歷史可按需續讀，更正、取消、撤權及孩子切換使受影響理解與操作失效。逾時先查原操作。

文件沿同一 ID／版本作局部增刪改移，固定版本分段閱讀；交易寫入帶 expectedVersion／opId，衝突先讀最新版。歸檔不佔終身建立額度，歷史恢復形成同一文件新版本。成長日常頁投影同源資料；季度／年度報告分批完整覆蓋，先統計再必要敘述，網頁與 PDF 同版，來源變更標待更新。

worker 只因相關資料／階段／到期／已授權跟進／有效知識換版觸發；無新事件不空轉模型。重查終態、授權、渠道及安靜時段，保留合併、跟進上限、抑制及去重；入列、渠道接受、收到和完成分開。

### 增補工作包與依賴

下表份額為預分配，不是已發生貢獻。主模型親寫行為、契約、Skill、提示詞及最終 review；Sol 6.1 依清楚方法承接有界實作。技術驗收由主模型裁決，D 只在實際參與時記錄。需要隔離或獨立交付時才從最新穩定 master 開分支／worktree，相關修改沿用既有分支／PR，不逐小項批量建立；必要驗收、review、PR 正常合併後才解鎖依賴，不為並行建立未合併依賴分支。

| 工作包 | 狀態／前置 | 交付與完成邊界 | 主責／權重／預分配 |
|---|---|---|---|
| <a id="p2-a01"></a>**P2-A01** 語義工具循環 | 已合併 PR #132；[最低證據](artifacts/verification/P2_A01_CHECKS.json) | 拆除關鍵詞閘；ADK 原生按需工具／配方、工具結果接續、配額／取消及真實終結。只補必要代表流程，不先實作 A02 工作狀態。 | A；3；A60%／C40% |
| <a id="p2-a02"></a>**P2-A02** 持久工作與記憶 | 已合併 [PR #133](https://github.com/2NTTY/child-ai-caregiver/pull/133)／770ad48；[證據](artifacts/verification/P2_A02_CHECKS.json) | 跨輪工作、相關歷史續讀／搜尋、來源與 coverage、Agent 更正／停用記憶、操作綁定確認及未知結果恢復。 | C；5；C60%／A30%／B10% |
| <a id="p2-a03"></a>**P2-A03** 真正文件讀寫 | 已合併 PR #134；[必要證據](artifacts/verification/P2_A03_CHECKS.json) | 準備單／文件局部正文與清單修改、固定版本續讀、歷史分頁、歸檔容量與實際保存收據；整合 PR #130 有效成果。 | C；5；C50%／A30%／B20% |
| <a id="p2-a04"></a>**P2-A04** 可補查官方 RAG | 已合併[PR #135](https://github.com/2NTTY/child-ai-caregiver/pull/135)；[證據／限制](artifacts/verification/P2_A04_CHECKS.json) | 模糊問題的有界混合檢索／上下文擴讀，HTML／文字型官方 PDF、章節頁碼、增量向量及語義換版發布核對；首批香港核心主題及四年齡段。 | A；5；A60%／C40% |
| <a id="p2-a05"></a>**P2-A05** 成長成果 | 已合併 [PR #136](https://github.com/2NTTY/child-ai-caregiver/pull/136)；[證據](artifacts/verification/P2_A05_CHECKS.json) | 同源日常投影、完整季度／年度分批整理及同版 PDF，來源更正失效；復用已合併日期篩選修正。 | C；3；C50%／B30%／A20% |
| <a id="p2-a06"></a>**P2-A06** 有用的主動接續 | 已完成（[PR #137](https://github.com/2NTTY/child-ai-caregiver/pull/137)）；P2-A02、P2-A03、P2-A04 | 私人工作事件接續、原run去重、終態／撤權與滿額關注結束；沿用本人通知原授權。[EV](artifacts/verification/P2_A06_CHECKS.json)。 | A；3；A50%／C40%／B10% |
| <a id="p2-a07"></a>**P2-A07** 正式單人使用流程 | 已合併 [PR #139](https://github.com/2NTTY/child-ai-caregiver/pull/139)／b30a7b2；[證據](artifacts/verification/P2_A07_CHECKS.json) | 各頁用途與共用 owner、統一歷史／完整聊天通知入口、單人引導、即時同源更新及安全操作入口；保留設計，不改成管理表格。 | B；3；B60%／C30%／A10% |
| <a id="p2-a08"></a>**P2-A08** 邀請制真實資料服務 | 已合併[PR #138](https://github.com/2NTTY/child-ai-caregiver/pull/138)；[證據](artifacts/verification/P2_A08_CHECKS.json) | 本人獨立資料空間、邀請註冊、Better Auth 電郵驗證／找回／會話撤銷、真實資料授權、下載及帳戶退出／刪除與備份保留說明。 | C；3；C70%／B20%／A10% |
| <a id="p2-a09"></a>**P2-A09** GCP 穩定交付 | 有效修正隨 [PR #140](https://github.com/2NTTY/child-ai-caregiver/pull/140) 收束；完整交付仍未完成；前置 A01～A08 已合併 | Prompt 版本及文件收據修正、原失敗／未驗均保留；[收束證據](artifacts/verification/P2_A09_CLOSEOUT_CHECKS.json)。完整 Agent／帳號／備份恢復及穩定交付由 F07／F08 承接；原 VM／SMTP 專用路線被替代，不標整包完成。 | C；3；C60%／B20%／A10%／D10% |

文件定案包由 A 主責、權重 2、A100%，主模型實際整理／覆核。原定案時 Ready 為 P2-A01 與 P2-A08，兩包現已合併；即時入口只見 [#active](#active)。約一半功能包由 C 主責；Author／共同作者按實際成果，推送／PR／合併按主責真實帳號，保留真實 Committer。

### 原工作包前移與延後對照

保留原 Sxx 錨點及歷史，只前移本目標所需子範圍，不整包改稱完成；原表各包須與本表一起讀取。

| 原範圍 | 本輪 P2 子範圍／承接包 | 原階段剩餘範圍 |
|---|---|---|
| S09-W03／P3 | Web 歷史、記憶與新對話接續 → P2-A02 | Android 跨端記憶接點 |
| S07-W01／W02／P3 | Web 一致性、重連、未知操作恢復 → P2-A02、P2-A07、P2-A09 | Android、自選 Server、完整故障矩陣 |
| S10-W03／P4 | 官方 PDF、語義換版及必要發布維護 → P2-A04 | 大型後台、規模／效能擴展及通用遷移 |
| S14-W02／P4 | 日常成長檔案、季度／年度與同版 PDF → P2-A05 | 原生分享及非核心分析 |
| S15-W02／P4 | GCP 資料退出、必要備份保留與恢復 → P2-A08、P2-A09 | 跨 Server 搬遷及通用匯入／遷移 |
| 身份／服務缺口 | 邀請、找回、真實資料及穩定交付 → P2-A08、P2-A09 | 社交／電話登入、裝置配對 |

### 最低必要驗收及交付門檻

以少量連貫情景覆蓋以下成果；不要求每項另開真模型或 E2E，也不規定唯一工具順序。復用有效證據，不測大量偏僻矩陣，不使用 Computer Use。

1. 受邀註冊、登入及找回；不建家庭、不填 key 也可使用。
2. 模糊提問、多輪指向及改口，取得實際支持的重要官方引用並保存有用成果。
3. 長準備單續讀、指定項修改、勾選、歸檔及新對話讀回同一文件最新版。
4. 重要操作綁定對象／版本；多候選或過期時一句「好」不確認錯事，一次確認只生效一次。
5. 私人搜尋、摘要、文件及背景處理不擴大資料範圍。
6. 重要知識換版核對含義，失效舊版不當最新；資料增加仍可有界接續。
7. 更正同步成長頁、完整期間同版報告／PDF；本人提醒完成即停止。
8. 集中核對一次必要版本衝突、原操作重試、服務重啟、刪除與備份恢復。

每包完成後直接執行最低必要驗收的本聊天授權已取得；不得擴成全量測試。真通知仍限已明確授權內容及接收者，雲端操作／主機期限／費用不因開發授權自動擴大。目前程式沿原每運行 4 次生成配置，保留 8 工具、2 查詢 embedding、90 秒及本人更低限制；[四角色目標](#p2-agent-roles)的 6 次生成僅保留為暫緩提案，不是本輪自動調整；不暗中調高每日額度或開新 run 繞過限制。規模／保留及新部署路線見 [Firestore 計劃](#p2-firestore-migration)；費用與切換仍須核准，不宣稱高可用。

完成以實際成果和 GCP 可用服務為準，不能以工具／畫面存在、mock 或 unit 通過取代。對每包分開記已實作、已驗證、待驗收、未完成及部署版本。權限、分享範圍、有界讀取與可靠寫入不是最後整合才補的項目。


<a id="production-integration"></a>
## 正式前端整合（P2 結案後增補）

2026-10-06 使用者確認先完成接線，並建立持續目標直到新前端取代正式入口。核心體驗及新增能力見 [SPEC](SPEC.md#agent-first-experience)，決策見 [ADR-017](docs/DECISIONS.md#adr-017)。沿用最新前端設計、既有 Server／Prompt Pack／素材；不把已確認的新 Agent 能力或預覽效果當作已實作。正式頁面接既有業務服務，缺少後端的關注鏈、多份準備文件及報告必須明示，不用相似 API 冒充。

| 包 | 狀態／交付 | 前置 | 主責及預分配 |
|---|---|---|---|
| <a id="int-w01"></a>INT-W01 | 已完成（隨 [PR #91](https://github.com/2NTTY/child-ai-caregiver/pull/91) 合併生效）：正式建置、登入、孩子与共用 owner／讀取快取；[EV](artifacts/verification/INT_W01_CHECKS.json) | master `61a8faa`；原分支 `codex/int-w01-production-foundation` | B；權重 3，B 60%／C 30%／A 10% |
| <a id="int-w02"></a>INT-W02 | 已完成（PR #92）：真聊天／引用、持久候選、普通記錄／私人交代與本人提醒的預授權操作及收據；[EV](artifacts/verification/INT_W02_CHECKS.json) | INT-W01 | C；權重 5，C 50%／A 30%／B 20% |
| <a id="int-w03"></a>INT-W03 | 已完成（PR #93）：既有 UI-P2-01～18 接線、共用 owner／跨頁同步及人工備援；普通記錄更正、聊天游標及取消。一次代表流程通過，未全驗表單及新照片提取；[EV](artifacts/verification/INT_W03_CHECKS.json) | INT-W02 | B；權重 5，B 50%／C 30%／A 10%／D 10% |
| <a id="int-w04"></a>INT-W04 | 已完成（PR #94）：私人來源的對話設定、讀取、引用及管理；同一 shared_inputs／獨立私人引用，零模型必要流程與未驗見 [EV](artifacts/verification/INT_W04_CHECKS.json)／[LOG](WORKLOG.md#log-20261006-int-w04) | INT-W03（PR #93） | A；權重 3，A 50%／C 30%／B 20% |
| <a id="int-w05"></a>INT-W05 | 已完成（PR #95）：持續關注、站內主動跟進、事件鏈及結束／恢復；結束不取消相連任務、恢復不重排，原 input_limit 失敗與必要零模型流程見 [EV](artifacts/verification/INT_W05_CHECKS.json)／[LOG](WORKLOG.md#log-20261006-int-w05) | INT-W03 | C；權重 5，C 50%／A 30%／B 20% |
| <a id="int-w06"></a>INT-W06 | 已完成（PR #96）：Agent 操作多份準備文件、成長報告及同版 PDF；[EV](artifacts/verification/INT_W06_CHECKS.json) | INT-W04、INT-W05 | A；權重 5，A 40%／C 40%／B 20% |
| <a id="int-w07"></a>INT-W07 | 已交付，隨 [PR #97](https://github.com/2NTTY/child-ai-caregiver/pull/97) 合併完成：正式入口部署、必要接線證據及舊 UI 退出；[功能清單](docs/PRODUCTION_FRONTEND.md)／[EV](artifacts/verification/INT_W07_CHECKS.json)（完整瀏覽器序列在 HTTP 上限停批；3 生成／0 embedding 後只補同一 fixture 的 8 次 API 核對，剩餘 UI 斷言未驗，D 人工結果未代填）；[LOG](WORKLOG.md#log-int-w07) | INT-W01～06 | C；權重 3，C 60%／B 20%／A 20%；D 人工驗收另記 |

需要隔離或獨立交付才開分支／worktree，相關修改沿用既有分支／PR，不逐小項批量建立；必要驗收、主模型 review、按主責帳號提交／推送／PR 正常合併後才啟動依賴包；後續包開工時再定權重及份額。2026-10-06 使用者要求將一半工作包交 C：餘下六包中 INT-W02／05／07 由 C 主責交付，INT-W03 由 B，INT-W04／06 由 A；已合併 INT-W01 保留 B 的原交付紀錄，不改歷史署名。INT-W02 的 C 負責 Server 授權／持久化及接線，A 負責 Agent 政策／工具與整合，B 負責既有 UI 回調；主模型仍親自處理指導、契約及提示詞。分配是責任安排，不冒稱個人手寫程式或實測工時；共用 AI 在 A 統籌下執行，主模型統籌驗收及最終裁決，Committer 保留實際操作者。

驗收只取通常路徑及必要邊界：正式登入／Agent、跨頁同源、重開持久化、身份／孩子隔離、一次原操作 unknown 恢復；新增能力各取一條代表路徑，重用已有證據。不重跑完整預覽矩陣，不使用 Computer Use。真模型／通知仍受既有次數、成本、明確目的地及內容授權限制；部署前重查 VM 期限、備份及相容遷移。完成需列明已接、待驗及未接項，不能在過渡頁仍存在時宣稱正式接線完成。

<a id="phases"></a>
## 五階段及完成門檻

| 階段 | 交付範圍 | 完成門檻 |
|---|---|---|
| <a id="phase-1"></a>**P1 基礎成品** | 在線 Web、最小登入隔離、孩子／文字記錄、Server 持久化與聊天、Gemini／簡單 prompt | 合成資料先玩通；Server 加密／最小加密備份還原、憑據及日誌保護通過；完成時交付組員可獨立試玩的 URL |
| <a id="phase-2"></a>**P2 完整 Agent／穩定 Web 服務** | 保留原 P2／INT 成果；增補邀請制單人服務、語義工具、持久工作、有證據的 RAG、真正文件讀寫／成長成果與本人跟進 | [P2-A01～A09](#p2-agent-service) 成果及 [P2-F01～F08](#p2-firestore-migration) 遷移完成；SPEC AC-P2A-01～08／AC-P2F-01～04 中本輪有效範圍通過；[AC-P2M-01～04](SPEC.md#ac-p2m-01) 依 [ADR-021](docs/DECISIONS.md#adr-021) 僅驗聊天與接口，其他角色內部驗收暫緩；GCP 真實資料服務可用，證據與部署分開；原二十包完成不能代替新門檻 |
| <a id="phase-3"></a>**P3 高級完善成品** | Android 在線客戶端、跨端更新、原生通知／FCM、語音／相機、家庭交接 | 真機與 Web 共用服務；權限／資料一致性／通知及平台行為已驗收，不建本地 Agent 或離線主庫 |
| <a id="phase-4"></a>**P4 完整版** | 自選相容 Server API、Windows Docker Compose 少步部署、裝置配對／臨時會話、既有 RAG 的完整管理／規模／維運擴充、分享／趨勢／PDF、Server 搬遷／災備 | 全部現行有效 REQ／AC 及 S01–S17 工作包結案；原驗收條款的保留／修訂／替代均可追溯，待驗收不得當完成 |
| <a id="phase-5"></a>**P5 以後升級版** | 另行確認的非必要增值 | 不阻塞 P1–P4，不承接未完成的必要功能，不預建空框架 |

P1 驗收於 2026-09-23 通過；本次結案隨 [PR #23](https://github.com/2NTTY/child-ai-caregiver/pull/23) 合併生效。證據見 [EV-S17-W01](artifacts/verification/S17_W01_CHECKS.json)；不代表跨階段 Sxx 或 P2–P4 已完成。

P2 的 20 個工作包必要驗收於 2026-09-30 齊備，已隨 [PR #71](https://github.com/2NTTY/child-ai-caregiver/pull/71) 合併結案；[公開交付證據](artifacts/verification/S17_W02_CHECKS.json)。其後 INT 已接回新前端並切換正式入口；Firefox 全套相容性仍依使用者決定延後。本輪 P2-A01～A09 為新增門檻，不自動啟動 P3。

2026-09-30 使用者在 P2 結案後新增必備項：**網站／軟件可設定本人模型 key**。另以 S06-W05 作 P2 增補包，立即實作及獨立驗收；原 20 包的完成證據保留。此包不列入已結案 S16-W02 的「P2 全部功能包」前置集合，避免反向循環；其驗收由本包承擔。Android 在 P3 復用同一設定契約，P4 自選 Server 為另一項功能。

Server 從 P1 起保存權威資料；Web／App 在線存取，業務 Agent 在 Server 執行。斷線只保留當前表單及所選照片、提示刷新／關閉風險，恢復連線後由使用者重試；不建立跨關閉恢復草稿或離線寫入隊列。P1 以合成資料驗收；首次模型請求起即有權限、憑據、配額、有限重試及日誌保護。

P2 由 ADK 實際編排受限產品工具，按預先確認的對象／內容／渠道及 fallback 規則自動聯絡，不逐次要求人工確認；每次執行重查授權。P2 直接建立可延續的最小 pgvector RAG，官方穩定知識與近期資訊分開更新／引用，支援可信育兒問答及非醫療分流的成長關注；P4 擴充管理介面、大規模導入、批量重建管理、效能及完整遷移，不重建另一套核心。總決定見 [ADR-011](docs/DECISIONS.md#adr-011)，行為見 [SPEC](SPEC.md#section-5-11)／[freshness](SPEC.md#knowledge-freshness)。P4 自部署接受 Docker Desktop／WSL2 前置，保留既定模型外送及通知授權要求。

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

<a id="steps"></a>
## 步驟範圍與結案

狀態由工作包及現行驗收累積；部分包完成不等於整個 Sxx 完成。

| 步驟 | 狀態 | 工作 | 驗收條件 |
|---|---|---|---|
| <a id="s00"></a>**S00 文件遷移** | 已完成 | 固定基線、逐條映射、文件權威及執行入口 | M01–M09 全部通過；歷史基線可追溯 |
| <a id="s01"></a>**S01 開源復用核查** | 已完成 | 有界核查必要候選、固定版本與許可 | 可核對的版本／許可／採用清單；未核實程式碼不進入交付 |
| <a id="s02"></a>**S02 最小共享工程** | 已完成 | Expo Router／TypeScript、共享契約與必要配置 | Web 可啟動；只建立縱向流程使用的工程與邊界 |
| <a id="s03"></a>**S03 Web 最小縱向流程** | 已完成 | 登入後建立孩子、文字記錄及 Server 保存／顯示 | 不依賴 AI；關閉重開並登入後資料可恢復；[保存驗收](SPEC.md#section-10-2) |
| <a id="s04"></a>**S04 Android 同一縱向流程** | 未開始 | 重用 Server 與共享業務的在線 App、APK | 使用者真機完成同一流程；不以 Web 驗證代替真機 |
| <a id="s05"></a>**S05 記錄與資料保護** | 進行中 | 確認、更正、時間軸、搜尋、Server 加密／刪除／備份及平台安全保存 | 原文、約數、時間、修訂與來源保留；備份還原可核對；[資料規則](docs/DATA_MODEL.md#section-5-1) |
| <a id="s06"></a>**S06 Server 身份與資料** | 進行中 | TypeScript、PostgreSQL、Better Auth、家庭權限及相容 Server 連線 | 真實登入／持久化、跨家庭隔離、私人聊天邊界及 Server 選擇；[權限驗收](SPEC.md#section-10-5) |
| <a id="s07"></a>**S07 在線更新與一致性** | 進行中 | 請求冪等、版本／衝突、跨端更新、附件狀態、刪除與撤權 | 中斷／重試／並行操作不靜默丟資料，終態不復活；[一致性驗收](SPEC.md#section-10-2) |
| <a id="s08"></a>**S08 裝置配對與臨時會話** | 未開始 | QR／短碼、已登入裝置確認、臨時電腦、裝置管理及撤權 | 拒絕過期／重放／未批准連線；裝置直接連 Server；[配對契約](docs/API.md#section-4-1) |
| <a id="s09"></a>**S09 聊天與長期記憶** | 進行中 | 原始聊天、確認事實、摘要、話題與任務台帳 | 新會話／換端／清空模型快取後從 Server 重建授權記憶；[記憶驗收](SPEC.md#section-10-3) |
| <a id="s10"></a>**S10 知識與資訊更新** | 進行中 | 官方來源、pgvector／embedding、引用、版本、近期資訊、定期更新及管理擴充 | 最小向量 RAG、穩定／近期隔離、發布／停用及 freshness 正確；[知識驗收](SPEC.md#section-10-4)／[向量驗收](SPEC.md#ac-p2-vector-rag) |
| <a id="s11"></a>**S11 Gemini 與 Agent 編排** | 進行中 | P1 文字聊天；P2 ADK 基礎、Prompt Pack 接線、結構化草稿／確認及互動／背景工具循環 | 真實工具及結果回饋，模型不能繞過權限；配額及失敗可核對；[Agent 驗收](SPEC.md#ac-p2-agent-loop) |
| <a id="s12"></a>**S12 照片、語音與分享輸入** | 進行中 | Web 照片、主動分享、公開來源及 Android 語音／相機／系統分享 | 來源可追溯；數字及不確定內容確認；拒絕權限與失敗明確；[輸入邊界](SPEC.md#section-1-5) |
| <a id="s13"></a>**S13 主動任務、聯絡與家庭交接** | 進行中 | Server worker、任務／授權、成長階段關注、Web Push／Telegram／FCM、fallback 與交接 | 唯一執行、撤權即停、終態不復活；發送／回應／完成分開；[任務驗收](SPEC.md#section-10-3)／[成長關注驗收](SPEC.md#ac-growth-attention) |
| <a id="s14"></a>**S14 摘要與報告** | 進行中 | 多孩子、到診準備、日／週摘要、趨勢及 PDF | 數字由程式計算，來源／版本可追溯，更正後產生新報告；[報告規則](SPEC.md#section-5-8) |
| <a id="s15"></a>**S15 Server 搬遷與災備** | 未開始 | 統一匯出、Server 搬遷、加密備份、空環境恢復與 rollback | 身份／資料／附件／知識／任務完整，切換單主，rollback 保留新寫入；[災備驗收](SPEC.md#section-10-6) |
| <a id="s16"></a>**S16 驗證與成本核對** | 進行中 | 相關功能、四年齡段、權限／故障／成本及可用性驗收 | 全部有效 AC 有證據；高成本驗證先獲批准，缺驗收用待驗收；[驗證制度](#verification) |
| <a id="s17"></a>**S17 交付與接續能力** | 進行中 | Web／APK、Windows 部署、源碼配置、操作及接續資料 | 另一位組員可依說明使用並重現；[交付驗收](SPEC.md#section-10-8) |

<a id="vertical-slice"></a>
## 最小縱向流程與依賴

S03：登入 → 建立孩子 → 輸入文字記錄 → Server 保存／顯示 → 關閉重開並登入 → 仍可讀取。S04 在 P3 Android 真機完成同一流程。

S03 依賴最小 Server 身份及資料能力，不依賴 Gemini、家庭邀請、配對、知識或通知。P1 預設順序：**S01-W01 → S02-W01 → S06-W03 → S03-W01 → S06-W01 → S09-W01 → S11-W01 → S05-W01 → S16-W01 → S17-W01**。加密／備份排在最早可玩流程之後，但仍是 P1 完成前置；不能以清空既有資料代替升級。

<a id="roadmap-packages"></a>
## 工作包、階段與依賴

前置原則上指已驗收並合併的工作包；既有 P2 隔離分支依[收束安排](#p2-deferred-acceptance) 完成必要驗收及合併，不再新增延後驗收的接續例外。S16 的「本階段全部功能包」按該次結案範圍固定：S16-W02 只涵蓋原 P2 功能包，不包括 S06-W05、INT 或 P2-A01～A09 等後續增補，避免把已結案 S17-W02 反向接回新包。未結案階段包括其所有功能包（P4 包含 S17-W05），不包括該階段 S16 驗收包及 S17-W01／W02／W03／W04 結案交付包。父 Sxx 的有效 AC 與局部驗收共同適用。

新增驗收包括 [Server／授權外發 AC](SPEC.md#ac-server-agent)、[freshness AC](SPEC.md#ac-knowledge-freshness)、[P2 知識 AC](SPEC.md#ac-p2-knowledge)、[成長關注 AC](SPEC.md#ac-growth-attention)、[ADK／完整流程 AC](SPEC.md#ac-p2-agent-loop)及[最小向量 RAG AC](SPEC.md#ac-p2-vector-rag)，隨所屬功能包驗收；原 AC 的修訂按 [替代索引](docs/DECISIONS.md#adr-008-replacements) 追溯。

通用能力先復用現有程式／Skill，再核對同版本 Google／Expo 原生能力及必要成熟候選；[選型與驗證閘](docs/TECH_REUSE.md#decisions) 按包使用，文件相容不代表已實測。已完成 P1／P2 成果不為換框架返工。前端聊天／主聊天的責任及共享修改次序依 [AGENTS](AGENTS.md#frontend-backend)，混合工作包須兩邊交付並完成相關整合驗收才結案。

| 工作包 | 階段 | 狀態 | 前置 | 目標、局部驗收及範圍界線 |
|---|---|---|---|---|
| <a id="s01-w01"></a>S01-W01 | P1 | 已完成 | S00、DOC-R02 文件規範合併 | 有界核查 coo 與當前流程必要候選，固定版本／許可／實際復用結論；不能核實就不採用，不無限除錯舊專案 |
| <a id="s02-w01"></a>S02-W01 | P1 | 已完成 | S01-W01 | 最小 Expo／TypeScript Web 工程、共享契約／驗證與可配置入口；必要檢查可執行，不建通用平台 |
| <a id="s06-w03"></a>S06-W03 | P1 | 已完成 | S02-W01 | 最小 Server／PostgreSQL／Better Auth 登入與帳號／資料空間隔離；Server 重啟後資料仍在、未授權請求拒絕；不含家庭邀請 |
| <a id="s03-w01"></a>S03-W01 | P1 | 已完成 | S06-W03 | Web 登入、孩子／文字記錄及 Server 保存／顯示；關閉重開後登入可恢復；斷線保留當前表單，不假稱保存 |
| <a id="s06-w01"></a>S06-W01 | P1 | 已完成 | S03-W01 | 安全 AI API／部署配置；供應商憑據只在 Server，從首次請求套用權限、配額、有限重試／總開關及無正文日誌 |
| <a id="s09-w01"></a>S09-W01 | P1 | 已完成 | S03-W01 | 原始聊天與孩子／作者關聯保存於 Server，授權後可恢復；不提前建立全部長期記憶 |
| <a id="s11-w01"></a>S11-W01 | P1 | 已完成 | S06-W01、S09-W01 | 真 Gemini、簡單 prompt、相關孩子／近期聊天及調用統計；失敗保留當前輸入，先以合成資料玩通 |
| <a id="s05-w01"></a>S05-W01 | P1 | 已完成 | S11-W01 | Server 儲存加密／密鑰保護、必要刪除、最小加密備份／還原；既有記錄聊天可接續，不以清空資料代替升級 |
| <a id="s16-w01"></a>S16-W01 | P1 | 已完成 | P1 全部功能包 | 核心流程、持久化、斷線／AI 失敗、憑據／日誌與備份還原的必要驗收；實際模型及服務驗證先取得批准 |
| <a id="s17-w01"></a>S17-W01 | P1 | 已完成 | S16-W01 | 交付組員可開啟的 Web URL、操作說明及證據；另一位組員獨立試玩通過才算 P1 完成 |
| <a id="s11-w03"></a>S11-W03 | P2 | 已完成 | S17-W01 | ADK 基礎與相容性：固定依賴／許可、npm 與建置版本、既有 Prompt Pack 組裝、真 Runner／FunctionTool 有界循環、配額及取消；必要 scripted model 輕量檢查與另行批准的最小真 Gemini 驗收分開記錄；[EV-S11-W03](artifacts/verification/S11_W03_CHECKS.json) 通過，完整記憶／知識／任務接線留 S11-W02 |
| <a id="s06-w02"></a>S06-W02 | P2 | 已完成 | S17-W01 | 家庭邀請／owner、caregiver、viewer 角色及按需孩子資料入口；owner／caregiver 可確認更正共享事實及改期／完成／關閉事項，僅 owner 可邀請／變更或撤銷成員權限／刪整個孩子，viewer 唯讀；個人通知偏好可管理，私人聊天不因家庭管理權而共享 |
| <a id="s05-w02"></a>S05-W02 | P2 | 已完成 | S06-W02 | 確認／更正歷史、來源及精度、時間軸／快捷記錄／搜尋與原文／約數／單位／模糊時間；出生日期按需，約數年齡保留精度與日期基準，不猜精準窗口；私人聊天不自動轉共享事實；新持久資料納入刪除／備份 |
| <a id="s09-w02"></a>S09-W02 | P2 | 已完成 | S05-W02、S07-W03 | 長期確認事實及來源／年齡日期基準、摘要覆蓋、話題／任務記憶及已解決／暫緩話題的再問條件，供後續關注復用；新會話及清空模型快取不重問已解決事項；摘要不改終態，已關閉事項不復活；[EV-S09-W02](artifacts/verification/S09_W02_CHECKS.json) 必要驗收通過，完成隨 [PR #34](https://github.com/2NTTY/child-ai-caregiver/pull/34) 合併生效 |
| <a id="s07-w03"></a>S07-W03 | P2 | 已完成 | S06-W02、S05-W02 | 在線請求冪等／版本確認、並行修改與重連、刪除及撤權；重試不重建，衝突可見；不建離線 outbox；[EV-S07-W03](artifacts/verification/S07_W03_CHECKS.json) 必要驗收通過，已隨 PR #36 合併 |
| <a id="s13-w01"></a>S13-W01 | P2 | 已完成 | S09-W02、S07-W03 | Server 任務／對象／時間、穩定 occurrenceId、改期／取消／完成及站內台帳；任務、occurrence 與投遞分開，與後續關注候選保持獨立語義，家庭成員完成狀態同步；每日普通提示合併一次、普通任務最多跟進一次，安靜時段預設 Asia/Hong_Kong 22:00–08:00 可調，預約例外須明確選擇；先由手動入口驗收確定性規則，不在本包自建通用 worker；新 TaskPanel 接入 RHF＋Zod／Paper，保留既有 UI；[EV-S13-W01](artifacts/verification/S13_W01_CHECKS.json) 必要驗收通過，完成隨本包 PR 合併生效；持久 worker／投遞另由 W04／W07 交付 |
| <a id="s13-w04"></a>S13-W04 | P2 | 已完成 | S13-W01 | 持久 worker、事件／到期觸發、分鐘級故障恢復及有限重試，業務有效結果唯一；優先驗證 pg-boss，業務台帳與入列同交易，job 只存參照；授權／終態／外發去重／unknown 由項目掌管。雙 worker、hard-kill、取消撤權、重試上限及備份還原按 [採用閘](docs/TECH_REUSE.md#worker) 驗收；Web 關閉仍執行，框架成功不代表任務完成；[EV-S13-W04](artifacts/verification/S13_W04_CHECKS.json) 27 項輕量檢查及獲批分段本機驗收通過，hard-kill 恢復 68.895 秒；完成隨本包 PR 合併生效 |
| <a id="s10-w01"></a>S10-W01 | P2 | 已完成 | S17-W01 | 最小向量 RAG：有限官方知識分段／版本／適用性、固定 pgvector、embedding、精確向量＋關鍵詞／RRF 及最多六片段引用；可重複匯入／核對發布／停用指令、失敗／降級、既有資料保留及擴展備份還原必要驗收；不建完整管理平台；[EV-S10-W01](artifacts/verification/S10_W01_CHECKS.json) 必要本機／真 embedding／擴展還原通過，完成隨 PR #35 合併生效；Agent／引用 UI 在 S11-W02 接線 |
| <a id="s10-w02"></a>S10-W02 | P2 | 已完成 | S10-W01、S13-W04 | 共用 worker 定期檢查：官方穩定每週、官方＋指定媒體近期每日；未變 hash 不重算向量，變更只更新受影響片段且核對後發布；驗收無變／失敗／停用／過期／日期／分類隔離；依使用者確認，CHP／RTHK 只限組內試用，公開檢索預設排除，見 [ADR-013](docs/DECISIONS.md#adr-013)；不做新聞分析平台；必要集中驗收及來源失效／登記撤回閘通過，完成隨本包 PR 合併生效，見 [EV-S10-W02](artifacts/verification/S10_W02_CHECKS.json) |
| <a id="s11-w02"></a>S11-W02 | P2 | 已完成 | S11-W03、S09-W02、S13-W04、S10-W02 | 接通互動／背景共用 AgentRuntime、已確認記憶、真向量檢索及任務工具；復用 Prompt Pack 的草稿／補問／確認／結構化結果，工具授權、版本、配額及取消一致；育兒問答／成長關注／安全求助引用適用官方片段，不足時明示；原生工具與收尾不重複執行副作用，不建立醫療分流；依 [ADK 原生能力核查](docs/TECH_REUSE.md#adk) 保留單次 Session／Pack，優先 BasePlugin＋原生 spans 最小診斷並驗無正文外洩，不另建 session／skill 平台；共用真 ADK／檢索／確認與背景重啟證據、引用修正的必要 Runner／離線重播覆核通過，範圍分列於 [EV-S11-W02](artifacts/verification/S11_W02_CHECKS.json)；真聯絡留 W07，完成隨本包 PR 合併生效 |
| <a id="s12-w03"></a>S12-W03 | P2 | 已完成 | S06-W02、S11-W02 | Web 照片上傳／附件識別與授權、提取及確認；原檔／hash／來源／刪除／備份／容量限制與失敗保留當前輸入；原檔／ADK 私人候選／確認及功能 UI 已接，見 [EV-S12-W03](artifacts/verification/S12_W03_CHECKS.json)；021／原資料保留、39 HTTP 中的照片流程、單次真照片候選與配對備份／空庫還原必要證據通過；刪除快照限制及完整面板未驗分列，完成隨本包 PR 合併生效 |
| <a id="s12-w04"></a>S12-W04 | P2 | 已完成 | S12-W03 | 使用者主動分享／貼上／上傳、指定公開來源及本人自訂私人來源（含自備訂閱／付費材料）；保存來源／時間／備註，公開可直接訪問 HTML 由本人明確取得，需登入正文由本人提供；不背景讀私人動態，不把帖子直接當家庭事實或執行授權；私人來源、受限提取、確認及功能 UI 已接，見 [EV-S12-W04](artifacts/verification/S12_W04_CHECKS.json)；023／私人來源保存、一次取得及隔離已通過；原提取日期失敗保留；修正版真候選及原文／確認／還原必要證據通過，完整分享面板瀏覽器未驗；完成隨本包 PR 合併生效，不重跑已通過項 |
| <a id="s13-w05"></a>S13-W05 | P2 | 已完成 | S06-W02、S13-W04 | Web Push adapter：優先 web-push 處理 VAPID／協定；家庭成員訂閱／授權／撤銷、站內狀態與失敗回報；發送不冒充已讀或完成，依 [渠道採用閘](docs/TECH_REUSE.md#channels) 驗證重試／unknown 及許可；49 業務／2 輪詢 SQL 與一次 Firefox 關頁後真通知／撤銷通過；完成隨本包 PR 合併生效，公開 origin 留 S17-W02，見 [EV-S13-W05](artifacts/verification/S13_W05_CHECKS.json) |
| <a id="s13-w06"></a>S13-W06 | P2 | 已完成 | S06-W02、S13-W04 | Telegram adapter：優先 grammY，不預設開自動重試；接收者先啟動 bot 並綁定、授權／撤銷、發送／回應及錯誤狀態；憑據／最小通知內容保護、webhook 去重及 unknown 依 [渠道採用閘](docs/TECH_REUSE.md#channels) 驗證；migration／還原及 45 業務／2 輪詢 SQL、一次真訊息及本人收到回覆通過，公開 webhook／即時 callback 回應留 S17-W02；完成隨本包 PR 合併生效，見 [EV-S13-W06](artifacts/verification/S13_W06_CHECKS.json) |
| <a id="s13-w08"></a>S13-W08 | P2 | 已完成 | S11-W02 | 四年齡段有限且已核對的非醫療分流的成長關注規則、按已確認孩子情況判斷適用；站內候選生命週期及來源，關閉後同階段同依據不再催，新階段／實質新確認資料／官方規則實質變更才產生新候選並說明原因；舊終態不復活，可永久停用主題；[成長關注驗收](SPEC.md#ac-growth-attention)；四年齡段規則、家長控制／原操作唯一任務與保存、關閉抑制／新依據、真背景檢索及重啟去重的必要證據已核對；引用修正沿用必要 Runner／離線重播，範圍見 [EV-S13-W08](artifacts/verification/S13_W08_CHECKS.json)，完成隨本包 PR 合併生效 |
| <a id="s13-w07"></a>S13-W07 | P2 | 已完成 | S11-W02、S13-W08、S13-W05、S13-W06 | 預先授權的對象／內容／渠道／fallback 及 S13-W01 提醒控制規則內主動聯絡；每次重查授權，失敗／回應／逾時按規則處理，完成／取消／撤權即停，未知結果不盲重發；沒新事件不空轉模型；預授權／工具／持久投遞及功能 UI 已接，見 [EV-S13-W07](artifacts/verification/S13_W07_CHECKS.json)；019／配對還原、SQL fallback／撤權／終態／unknown，以及一次真 Agent→Telegram→收到→明確完成及清理通過；原清理呼叫上限失敗保留。完成隨本包 PR 合併生效；公開 webhook／部署仍留 S17-W02 |
| <a id="s14-w01"></a>S14-W01 | P2 | 已完成 | S11-W02 | 多孩子切換、到診問題／準備清單、簡單日／週摘要；數字程式計算、資料可追溯、更正可更新；真 API 摘要／準備保存、來源刪除後失效、migration／加密還原及真 Agent 摘要工具證據已核對，範圍見 [EV-S14-W01](artifacts/verification/S14_W01_CHECKS.json)；完成隨本包 PR 合併生效 |
| <a id="s16-w05"></a>S16-W05 | P2 | 已完成 | S06-W02、S07-W03 | 提前建立共用 Playwright Test Web 測試基礎：隔離合成資料、單 test worker、Chromium；Firefox 依 2026-09-29 使用者確認延後作相容性驗收，不阻塞 P2；先驗家庭隔離／角色、遺失寫入回應後查原 opId、撤權後清 UI 三條流程。主聊天負責正式 App／真 API 瀏覽器層及受控測試資料，前端 preview 測試另記；保留 node:test／P1 腳本，不以 mock 或 Web 代替真服務／Android；E2E 執行仍先按驗證制度批准；Chromium 單一真 API 情景通過；後續必要功能檢查用 Codex 內置瀏覽器，不重跑已通過項，Firefox 保留未驗；完成隨本包 PR 合併生效，見 [EV-S16-W05](artifacts/verification/S16_W05_CHECKS.json) |
| <a id="s16-w02"></a>S16-W02 | P2 | 已完成 | 原 P2 功能包（不含後續增補）、S16-W05 | 真 ADK 工具循環、四年齡段向量召回／引用、成長關注與抑制、記憶／任務、worker 恢復、家庭隔離、照片／來源、freshness、通知／fallback、失敗及成本必要驗收；復用 S16-W05 瀏覽器基礎及既有 scripted Runner，有限真 Gemini 情境另驗，不把 TS conformance 或靜態 Pack 當產品品質證據；證明家長需求與網頁關閉後背景事件兩條完整流程，高成本項先批准；必要本機／真服務證據已按包收束，全部功能包已合併；一次真聯絡與明確完成／清理已通過，原失敗保留，主模型最終證據核對通過，完成隨本包 PR 合併生效，見 [EV-S16-W02](artifacts/verification/S16_W02_CHECKS.json)。公開 HTTPS／正常部署接線及組員展示仍由 S17-W02 驗收 |
| <a id="s17-w02"></a>S17-W02 | P2 | 已完成 | S16-W02 | Web＋ADK 產品 Agent＋最小向量 RAG 比賽成品；演示家長需求及背景觸發的工具／任務／真實聯絡／回報，交付來源與操作／投遞證據及限制；不以 mock、靜態 Pack 或兩條演示取代真服務及其他 P2 驗收。S16 已隨 PR #67 合併；[部署及交付](docs/P2_DELIVERY.md)／[EV-S17-W02](artifacts/verification/S17_W02_CHECKS.json)，P2 `43ab10c` 已部署，原資料保留／023／向量初始化、23 次合成 HTTP 及配對備份空庫還原通過；兩條公開 ADK／來源／任務／關頁後真聯絡流程、本人 Push／Telegram 收到、明確完成及清理通過；原失敗及修正保留，配額恢復 12／20；必要驗收已齊，完成隨本包 PR 合併生效 |
| <a id="s06-w05"></a>S06-W05 | P2 增補 | 已完成 | S17-W02 | 本人模型 key 必備入口：首版 Gemini Developer API，保留平台 Vertex；Web 設定／替換／停用／刪除、帳號隔離及加密、明確同意／背景 opt-in、執行期版本重核、生成與查詢向量同一付費來源、分開配額／用量且無靜默 fallback；共用語料維護仍用平台。個人每日／單次生成／query embedding 上限可在 UI 調整並真正約束運行；平台上限不變。本次依使用者追加確認，只驗保存／隔離／刪除、原資料保留、scripted Runner 限額及撤回後停止；Google 地區限制下真 key 生成／向量保留待驗，不阻塞此次設定與接線交付。024／10 HTTP／31 store及必要 Runner 已通過，完成隨本包 PR 合併生效；[證據](artifacts/verification/S06_W05_CHECKS.json)。C 主責，權重 3，C 60%／A 25%／B 15%；主模型整合及最終驗收。軟件端於 S04-W01 復用，無需先自部署或切換 Server；本次設定增補尚未公開部署 |
| <a id="s04-w01"></a>S04-W01 | P3 | 未開始 | P2-A09、S06-W05 | Android 在線登入／孩子／記錄／聊天、APK 與使用者真機流程；重用同一 Server 和業務，不建 SQLite 主庫；正式 P3 接線／真機仍須使用者明確確認整套 Web 滿意；隔離 Android 共用 UI 可按 [分工例外](AGENTS.md#frontend-backend) 提前實作，手機瀏覽器／單頁確認不能代替正式關口 |
| <a id="s05-w03"></a>S05-W03 | P3 | 未開始 | S04-W01 | Android 憑據安全保存、附件暫存／清理及退出／撤權處理；平台 adapter 不成為權威業務資料庫 |
| <a id="s07-w01"></a>S07-W01 | P3 | 未開始（Web 子範圍前移） | S05-W03、S07-W03、P2-A09 | Android／跨端在線更新、並行修改、重連與附件狀態；沿 TanStack Query／RN focus／online adapter 與 opId，不建離線隊列。Web 同源、一致性及原操作恢復由 P2-A02／A07／A09 先交付，不重做。 |
| <a id="s09-w03"></a>S09-W03 | P3 | 未開始（Web 子範圍前移） | S07-W01 | Android 跨端授權歷史與記憶接點；Web 新對話／歷史／記憶接續前移 P2-A02，不把清空業務庫當清模型快取。 |
| <a id="s12-w01"></a>S12-W01 | P3 | 未開始 | S05-W03、S12-W03 | 粵語與 Android 相機／照片／便條，重用 Web 提取契約；數字單位確認，拒絕權限或失敗回表單 |
| <a id="s13-w02"></a>S13-W02 | P3 | 未開始 | S07-W01、S13-W07 | 家庭交接與 FCM／原生通知 adapter；客戶端優先 Expo Notifications，Server 優先 Google Auth＋單次 FCM HTTP v1，依 [候選與限制](docs/TECH_REUSE.md#channels) 驗 native build／權限／token／unknown；業務排程仍在 Server，投遞／回應／完成分離及撤權有效 |
| <a id="s16-w03"></a>S16-W03 | P3 | 未開始 | P3 全部功能包 | 雙端真機／在線一致性／家庭隔離／多模態／通知必要驗收；先批准高成本項，不能用 Web 代替真機 |
| <a id="s17-w03"></a>S17-W03 | P3 | 未開始 | S16-W03 | 可安裝 APK、跨端 Web、家庭操作／權限／連線說明及真實證據 |
| <a id="s06-w04"></a>S06-W04 | P4 | 未開始 | S17-W03 | 使用者選擇相容 Server API；確認地址、版本／能力及身份，憑據隔離，不自動把舊 Server 家庭資料送往新地址 |
| <a id="s17-w05"></a>S17-W05 | P4 | 未開始 | S06-W04 | Windows Docker Desktop／WSL2 前置檢查、Compose 設定與少步啟動 API／worker／PostgreSQL／pgvector；儲存持久化、私密配置、TLS 與操作限制說明；驗沒有 GCP 附加身份且關閉 AI 時仍可使用核心資料及確定性任務，Gemini／外部通知另驗，不宣稱離線模型 |
| <a id="s08-w01"></a>S08-W01 | P4 | 未開始 | S06-W04 | QR／短碼／已登入裝置確認、裝置撤權及臨時電腦會話；拒絕重放／過期，客戶端直接連 Server，不作手機資料中繼 |
| <a id="s10-w03"></a>S10-W03 | P4 | 未開始（必要維護前移） | S17-W03、S10-W02、P2-A04 | 沿 P2 RAG 擴充大型管理頁、大規模導入／批量重建管理、效能與通用遷移。官方 PDF、語義換版及必要發布維護前移 P2-A04；不另建向量／引用權威。 |
| <a id="s12-w02"></a>S12-W02 | P4 | 未開始 | S17-W03、S12-W01、S12-W04 | 系統分享及其餘既定平台 adapter；來源／確認／權限與失敗行為完整 |
| <a id="s07-w02"></a>S07-W02 | P4 | 未開始（Web 必要項前移） | S08-W01、S07-W01、S12-W02 | 完整跨端故障矩陣、附件中斷及不同 Server 邊界；Web 必要重連／unknown 前移 P2-A02／A07／A09，原 S07 剩餘 AC 仍須結案。 |
| <a id="s13-w03"></a>S13-W03 | P4 | 未開始 | S07-W02、S13-W02 | Server 切換的任務／授權交接、唯一執行、舊執行者失效與必要審計；為正式遷移提供切換邊界 |
| <a id="s14-w02"></a>S14-W02 | P4 | 未開始（成長成果前移） | S10-W03、S12-W02、P2-A05 | 原生分享、雙端預覽及非核心分析；日常成長、完整季度／年度與同版 PDF 前移 P2-A05，來源／更正語義沿用。 |
| <a id="s15-w01"></a>S15-W01 | P4 | 未開始 | S13-W03、S17-W05 | Server 搬遷、資料／身份／附件／知識／任務完整性核對、確認後切換權威 Server；失敗不提早停用來源 |
| <a id="s15-w02"></a>S15-W02 | P4 | 未開始（GCP 必要恢復前移） | S15-W01、S14-W02、P2-A09 | 跨 Server 搬遷、通用備份／遷移及保留新寫入 rollback。GCP 配對加密備份／保留／空環境恢復前移 P2-A08／A09；不能恢復已撤權／終態工作。 |
| <a id="s16-w04"></a>S16-W04 | P4 | 未開始 | P4 全部功能包 | 現行 AC 全量追溯及原條款替代核對；完整成本／快取／權限／過期／可用性驗收先按驗證制度批准 |
| <a id="s17-w04"></a>S17-W04 | P4 | 未開始 | S16-W04 | 全部 APK／Web／源碼配置／Windows 部署／知識／遷移／許可／操作說明／證據交付，另一組員可重現 |

<a id="team-package-allocation"></a>
## 四人工作包責任預分配

2026-09-28：以下分配適用於尚未完成的 P2–P4 工作包，只增加交付責任，不改上表的範圍、前置、狀態或驗收。已結案工作及已交付的前端預覽保留原紀錄與署名，不追溯重新分配；責任預分配本身不啟動功能包，開工按後續使用者指示及前置狀態。

| 成員代號 | 主責方向 |
|---|---|
| A | Agent 行為、提示詞、工具編排、記憶／知識接線及整體功能整合 |
| B | Web／Android 介面、客戶端互動、平台 adapter 及前端交接 |
| C | Server API、權限、持久化、一致性、worker、部署及恢復 |
| D | Web Push／Telegram 渠道功能；另負責獲安排的測試執行、人工驗收及 PPT |

主責負責整包交付協調，配合欄只列需要的分工，並非已完成貢獻或自動共同作者名單。開包時按使用者已授權的本機協作指引分配及記錄實際參與／修改歸屬；權重、份額、帳號、email 及署名操作按本機 `docs/TEAM_CONTRIBUTIONS.md` 管理，不將該本機指引重新加入 Git。

每包必要技術驗收由主聊天統籌，相關實作者提供證據，A 作整包確認；D 執行另外安排的人工／跨功能驗收及整理結果，未實際執行不能代填通過。功能開發、測試執行及 PPT 交付分開記錄；需批准的驗收依[驗證制度](#verification)處理；按現行按包驗收及其限定例外執行，不沿用已被取代的集中安排。

人類責任不改變[前後端聊天邊界](AGENTS.md#frontend-backend)：B 的畫面交付沿用 [frontend/HANDOFF](frontend/HANDOFF.md)，正式 App／API 接線仍由主聊天統籌並明確分配修改範圍。新預覽未替代正式介面，對已完成業務的新 UI 接線須另界定實際範圍及驗收，不倒算為舊包的新貢獻。指導文件、計劃與 AI 提示詞仍由相關聊天的主模型親自處理。

### P2 原責任預分配（歷史；狀態以上表為準）

| 工作包 | 主責 | 配合範圍 |
|---|---|---|
| [S13-W01](#s13-w01) 任務台帳 | C | B：任務表單／狀態操作；A：後續工具所需的任務語義邊界 |
| [S13-W04](#s13-w04) 持久 worker | C | A：背景事件與後續 Agent 運行邊界 |
| [S10-W02](#s10-w02) 知識／資訊更新 | A | C：worker 接駁、版本保存及增量向量更新 |
| [S11-W02](#s11-w02) 完整 Agent 接線 | A | C：授權業務服務；B：引用、確認及真實工具結果介面 |
| [S12-W03](#s12-w03) Web 照片與提取 | A | C：附件保存／權限／刪除；B：上傳、提取確認與失敗保留 |
| [S12-W04](#s12-w04) 主動分享輸入 | B | A：提取及確認流程；C：來源保存與公開來源取得邊界 |
| [S13-W05](#s13-w05) Web Push | D | B：瀏覽器訂閱及權限介面；C：訂閱保存、授權及 worker 接駁 |
| [S13-W06](#s13-w06) Telegram | D | C：綁定／授權及 webhook 持久化；B：綁定與撤銷介面；Agent 聯絡編排留 S13-W07 |
| [S13-W08](#s13-w08) 成長階段關注 | A | C：規則適用判斷及候選／終態保存；B：來源與關注處理入口 |
| [S13-W07](#s13-w07) 授權主動聯絡 | A | C：投遞前校驗／終態；D：渠道回應及 fallback；B：預授權／結果介面 |
| [S14-W01](#s14-w01) 到診準備與摘要 | A | B：多孩子／清單／摘要介面；C：可追溯查詢及數字計算 |
| [S16-W05](#s16-w05) 正式 Web 測試基礎 | C | B：正式介面選取與跨端狀態配合；D：核對案例及獲批後的測試執行；由主聊天接真 API |
| [S16-W02](#s16-w02) P2 整體驗收 | A | B／C／D：按所屬功能處理缺口；D：人工驗收與證據整理；不代替各包必要驗收 |
| [S17-W02](#s17-w02) 比賽交付 | C | A：Agent 展示及能力界線；B：Web 交付；D：獨立試玩、PPT 及展示材料 |

2026-09-28 使用者恢復 P2，S13-W01 必要驗收通過，完成隨本包 PR 合併生效；已隨 [PR #47](https://github.com/2NTTY/child-ai-caregiver/pull/47) 合併，S13-W04 從 master `a591f87` 開始，A 確認權重 3、C 80%／A 20%。S16-W05 亦已 Ready，仍未開始；分配給不同人不解除前置。S13-W01 分工已由 A 確認：權重 3，C 70%／B 20%／A 10%；實際 Server／UI／整合均有交付，主模型統籌技術驗收。

### P3 工作包

| 工作包 | 主責 | 配合範圍 |
|---|---|---|
| [S04-W01](#s04-w01) Android 縱向流程 | B | C：同一 Server 的登入及業務接駁；仍須 P2 結案及整套 Web 獲確認 |
| [S05-W03](#s05-w03) Android 資料保護 | B | C：憑據、撤權與附件清理邊界 |
| [S07-W01](#s07-w01) 跨端在線一致性 | B | C：版本／冪等契約與撤權邊界 |
| [S09-W03](#s09-w03) 跨端記憶恢復 | A | B：歷史／記憶恢復介面；C：授權查詢與保存邊界 |
| [S12-W01](#s12-w01) 語音與相機 | B | A：沿用提取／確認工具；C：附件服務接駁 |
| [S13-W02](#s13-w02) 家庭交接與原生通知 | B | C：FCM Server adapter；D：渠道結果／回應語義及既有通知協作 |
| [S16-W03](#s16-w03) 跨端真機驗收 | B | A／C：Agent 與 Server 缺口；D：獲批真機／跨端驗收及證據 |
| [S17-W03](#s17-w03) APK 與跨端交付 | B | C：建置／服務配置；A：Agent 能力說明；D：獨立安裝試玩 |

### P4 工作包

| 工作包 | 主責 | 配合範圍 |
|---|---|---|
| [S06-W04](#s06-w04) 相容 Server 選擇 | C | B：地址／身份／能力確認及切換介面 |
| [S17-W05](#s17-w05) Windows 自部署 | C | A：模型關閉時的能力界線與 Agent 配置；D：獲批後獨立重現 |
| [S08-W01](#s08-w01) 配對與臨時會話 | C | B：QR／短碼／確認及裝置管理介面 |
| [S10-W03](#s10-w03) RAG 管理與擴充 | A | C：批量導入／重建／效能／遷移；B：來源與版本管理介面 |
| [S12-W02](#s12-w02) 系統分享 adapter | B | A：沿用來源／提取／確認流程；C：權限及附件接駁 |
| [S07-W02](#s07-w02) 完整在線故障矩陣 | C | B：跨端連線／附件失敗狀態；D：獲批案例執行 |
| [S13-W03](#s13-w03) 任務權威切換 | C | A：Agent／工具授權交接；D：渠道執行者及 unknown 邊界 |
| [S14-W02](#s14-w02) 趨勢與 PDF 報告 | A | B：圖表／雙端預覽／分享；C：數字、來源及版本查詢 |
| [S15-W01](#s15-w01) Server 搬遷 | C | B：確認／切換介面；A：記憶、知識及任務接續核對 |
| [S15-W02](#s15-w02) 災備與 rollback | C | A：Agent 相關資料／終態完整性；B：恢復操作及結果介面 |
| [S16-W04](#s16-w04) 完整驗收 | A | B／C／D：按功能處理缺口；D：獲批驗收執行及 AC 證據整理 |
| [S17-W04](#s17-w04) 完整版交付 | C | A：Agent／知識／工具說明；B：Web／APK 成品；D：獨立重現與交付材料 |

<a id="extension-boundaries"></a>
## 共享邊界與漸進實作

以下為 P2 接續的歷史基線；當前狀態以工作包表及 STATUS 為準，P2 必要驗收已齊，不重啟已完成包。

S11-W03／S06-W02／S05-W02／S07-W03 已分別隨 PR #30／#31／#32／#36 合併。S09-W02 必要驗收通過，完成隨 PR #34 合併生效；因接入相同操作收據，加入已完成的 S07-W03 作前置。S09-W02 已隨 PR #34 合併；使用者於 2026-09-28 恢復 P2，S13-W01 從 master `54e53d6` 開始。使用者另行批准 S10-W01 必要驗收及收尾；已整合最新 master，真 embedding、同卷升級、原資料保留及加密擴展還原通過，完成隨 PR #35 合併生效；先前暫停已由本次使用者恢復指示解除。S13-W04 已隨 PR #48 合併；S10-W02 從 master `70dda82` 開始，權重 3、A 60%／C 40%，主模型統籌必要驗收。按依賴推進，不按 Sxx／Wxx 數字排序；未完成必要驗收及合併前不解鎖依賴包。ADK 選型與初始限額見[架構](docs/ARCHITECTURE.md#p2-agent-runtime)；實作與真服務驗收分開記錄。

P1 按真實流程實作 DataStore／ModelGateway；P2 加入 AgentRuntime／AttachmentStore／KnowledgeRetriever／TaskExecutor／渠道無關的 NotificationGateway。在線更新／版本／確認沿用 SyncEngine 契約名稱，不保留離線同步框架。詳細職責由 [API](docs/API.md#section-3-3) 維護。

共享 TypeScript 承載業務、驗證、AI orchestration 與任務規則；Web／Android UI、資料 driver、相機／通知／分享保持薄 adapter。Agent／權威寫入在 Server，不把平台或資料庫 SDK 寫進核心。育有方仍是唯一領域實作；集中領域模型、prompt、來源及受限 skills，不建立插件平台或第二主題。Android、相容 Server 選擇、配對與完整災備只在相應階段實作；之前保留必要識別、版本、權限與接口責任。

<a id="packages"></a>
## 工作包与有限并行

- 分支、提交、推送与合并遵循 [AGENTS Git 工作流](AGENTS.md#git-workflow)。
- 主模型同一时间只推进一个生产代码工作包；工作包通过不代表整个步骤通过。
- 主模型先拆分，再按 [子代理政策](AGENTS.md#models) 委派可獨立核查的任務；先收齊並整合結果，不輪詢進度或持續追加代理。
- 不并行实现依赖不稳定接口的模块；相同同步、权限、迁移或共享模型修改优先串行。
- 前後端依 [聊天分工](AGENTS.md#frontend-backend) 使用獨立分支；前端當前先在 `frontend/` 交付 Web 合成預覽，主聊天負責正式接線與整合。FE-Wxx 及其專用文件由前端管理，Sxx 業務包及正式驗收仍由本 PLAN 管；preview 完成不計作 Sxx 接線完成。穩定接口且無前置依賴的交付才可並行；S16-W05 可先於 P2 總驗收準備並由 S16-W03／W04 沿用，各功能包的必要驗收不因此延後。
- 未驗收並合併的前置工作包不能當作已完成基礎；阻塞寫明原因及解除方法，不以擴展功能掩蓋。分支、review、合併以包為單位；父 Sxx 全部包完成才結案。

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

<a id="doc-r01"></a>
## DOC-R01 — 五階段文件重排及歸檔

- 狀態：已完成。
- 驗收：五階段／依賴、原錨點及當時有效 AC 保留；歸檔原文／唯一 JSON、WORKLOG 舊前綴及連結核對。
- 證據：[LOG-20260920-007](WORKLOG.md#log-20260920-007)／[EV-DOC-R01](artifacts/verification/DOC_R01_CHECKS.json)。證据適用當時版本；後續替代依 ADR 追溯。

<a id="doc-r02"></a>
## DOC-R02 — Server 路線與專案代理規則修訂

- 狀態：已完成。
- 前置：DOC-R01 文件基線。
- 範圍：五階段／工作包、Server 契約、規則／專案配置及必要狀態與追加記錄；不含產品實作。
- 驗收：現行要求與替代關係一致、舊錨點可追溯、依賴無循環、WORKLOG 舊前綴及歷史資料未改、專案配置可解析與當前 Codex 識別；角色限額與硬配置明確區分。
- 證據：[LOG-20260922-001](WORKLOG.md#log-20260922-001)／[EV-DOC-R02](artifacts/verification/DOC_R02_CHECKS.json)。

<a id="doc-r03"></a>
## DOC-R03 — P1–P4 技術復用與前後端分工

以下保留當時結案範圍；其中「下一包／Android 次序」不是現行指令，現行分工見 [AGENTS](AGENTS.md#frontend-backend)。

- 狀態：已完成；文件驗收通過，交付隨本包 PR review／合併生效。
- 基線：master `80cf50c`；保留已完成工作包及六份技術 Skill 的有效成果。
- 範圍：有界復用規則、原生能力／候選證據、工作包採用閘、提前 S16-W05 及前後端交接；不改產品程式、依賴、部署或既有驗收結果。
- 驗收：文件連結／錨點、工作包依賴、候選與實測分類、歷史 WORKLOG 前綴及 STATUS 位元組保留。使用者明確要求本包不改 STATUS，完成記錄只在本節及追加 WORKLOG。
- 證據：[選型核查](docs/TECH_REUSE.md)／[ADR-012](docs/DECISIONS.md#adr-012)／[LOG-20260926-001](WORKLOG.md#log-20260926-001)。新功能包仍未開始，下一後端功能包仍為 S13-W01。
- 前端交接補充：與「檢查育伴港前端現況」最新計劃對齊，採隔離 Web 預覽／主聊天正式整合及整套 Web 確認後才開 Android；[LOG-20260926-002](WORKLOG.md#log-20260926-002)。前端目錄及 FE-W01 尚未實作，不更改原產品包完成狀態。

<a id="doc-r04"></a>
## DOC-R04 — 文件職責及閱讀路徑收斂

- 狀態：已完成；2026-10-04 使用者確認合併，隨 [PR #86](https://github.com/2NTTY/child-ai-caregiver/pull/86) 合併生效。
- 成果／基線：從 master `c51dd52` 收斂根／前端閱讀入口、文件職責、過時 metadata 及歷史索引；附件按現行資料取捨，保留前端獨立進度、固定歷史原文及證據。沒有業務程式、API 語義、UI 或部署改動。
- 驗收：[EV-DOC-R04](artifacts/verification/DOC_R04_CHECKS.json)／[LOG](WORKLOG.md#log-20261004-001)。引用／錨點、TOML、歷史內容及接手入口已核對；追加 STATUS 更新／清理規則已靜態核對。官方 Skill validator 缺 PyYAML，替代檢查及未驗限制照實保留；沒有產品測試或 runtime／token 節省量測。
- 後續整合限制：#84／#85 的新內容及各自驗收由原包處理；整合時保留其新增內容，不整檔覆蓋。本包不操作其源分支或啟動正式接線。

<a id="s00-w01"></a>
## S00-W01 — 完整文档迁移

- 状态：已完成。
- 目标：原样保留磁盘完整基线及四份旧材料，完成职责拆分、逐条映射与执行制度。
- 关联验收：AC-S00-M01 至 AC-S00-M09（下表稳定锚点）。
- 验证：完整覆盖／原文保留、哈希、链接锚点、状态、单一权威、Luna 只读獨立核查。
- 完成证据：[LOG-20260920-002](WORKLOG.md#log-20260920-002)、[EV-001](artifacts/verification/S00_CHECKS.json)、[EV-002](artifacts/verification/S00_AUDIT.md)。

| 子步骤／验收 ID | 状态 | 工作 | 验收条件 |
|---|---|---|---|
| <a id="ac-s00-m01"></a>M01 / AC-S00-M01 | 已完成 | 固定已有磁盘基线，登记五份原文件版本与校验值 | 原文可回看、来源明确、五文件哈希未变，没有摘要重建 |
| <a id="ac-s00-m02"></a>M02 / AC-S00-M02 | 已完成 | 逐段、逐列表项、逐表格行清点 | 有效设计、验收与结构信息全部可定位，冲突有依据 |
| <a id="ac-s00-m03"></a>M03 / AC-S00-M03 | 已完成 | 文档权威职责、稳定编号 | 每类信息有唯一维护位置，引用可解析 |
| <a id="ac-s00-m04"></a>M04 / AC-S00-M04 | 已完成 | 完整内容搬迁 | 正文有实质规则，不是只有标题／链接／TODO；已有未定细节明确保留 |
| <a id="ac-s00-m05"></a>M05 / AC-S00-M05 | 已完成 | 建立执行入口 | PLAN 全步骤、短 AGENTS／STATUS、append-only WORKLOG、诚实 README，产品步骤未假完成 |
| <a id="ac-s00-m06"></a>M06 / AC-S00-M06 | 已完成 | 完成逐条映射 | 有效条款无遗漏；复合条款各部分有落点；所有 AC 保留；unresolved 不隐瞒 |
| <a id="ac-s00-m07"></a>M07 / AC-S00-M07 | 已完成 | 一致性与结构检查 | 无断链、重复锚点、错误状态、竞争权威、虚假运行命令 |
| <a id="ac-s00-m08"></a>M08 / AC-S00-M08 | 已完成 | Luna 獨立只读核查，主模型处理 | 发现项有解决记录、复核通过；子代理无文件修改 |
| <a id="ac-s00-m09"></a>M09 / AC-S00-M09 | 已完成 | 冻结迁移结果和交接 | 记录完整，PLAN 与 STATUS 一致；歷史遷移範圍結案，不代表產品功能完成 |

<a id="section-7-reuse"></a>
## 技術與開源復用原則

<a id="rule-7-reuse-01"></a>
先復用現有實作／依賴／Skill，再核對同版本 Google／Expo／已採用框架的原生能力，缺口才有界比較成熟開源方案；具體執行依 [AGENTS](AGENTS.md#technical-skills)，已核對候選及驗證方法見 [TECH_REUSE](docs/TECH_REUSE.md#decisions)。育伴港的家庭授權、任務終態、外發去重及安全規則由項目控制，核心支援自部署，不為更知名的框架重寫已驗收功能。

<a id="rule-7-reuse-02"></a>
保留 S01 已完成調查的來源及結論；`coo-ai-agent` 的 AWS、短信及會話設計與目標有差異，不整套作產品底座，也不再作所有通用能力的預設首查入口。[參考項目](https://github.com/skidx64/coo-ai-agent)。其他歷史設計參考：

- <a id="rule-7-reuse-03"></a>Baby Buddy：育儿事件字段和成熟记录流程；
- <a id="rule-7-reuse-04"></a>CareLoop：语音、照顾者和交接设计参考；
- <a id="rule-7-reuse-05"></a>BreastfeedingTracker：记录、提醒和统计界面候选；
- <a id="rule-7-reuse-06"></a>UNICEF Bebbo：多孩子、年龄分类和内容组织参考。

<a id="rule-7-reuse-07"></a>
仅移植许可明确、经过核验、确实减少工作的模块。发现许可文件不完整时保留研究结论，不把不确定代码直接放入交付物。沿用部分保留归属、许可证、版本和修改说明。

<a id="verification"></a>
## 验证与证据层级

| 用语 | 含义 | 依据 |
|---|---|---|
| 已确认 | 设计或需求确定 | SPEC／ADR／用户决定 |
| 已实现 | 代码确实存在 | 文件与修改版本；文档迁移只能说明文档已写入 |
| 已验证 | 指定场景实际通过 | 命令或人工步骤、环境／版本、结果与证据 |
| 已完成 | 实现、全部必需验证和记录齐备 | 本步驟必要驗收及證據齊備；按文件職責更新受影響位置 |

驗證範圍、成本、批准與失敗停批統一依 [AGENTS 驗證與收尾](AGENTS.md#finish)。此處只定義證據層級及下列既有分支例外，不複製另一份測試規則。

<a id="p2-deferred-acceptance"></a>
### 按包驗收與既有 P2 隔離分支收束

2026-09-30 使用者更新：恢復每個工作包完成實作及 review 後，提出最小必要範圍、次數與成本並獲批驗收，不再延後至整個 P2。2026-09-28 的先實作／集中驗收安排是既有分支的歷史依據，不能用來新開尚欠前置驗收的依賴包。

- **實作與完成分開：**程式及接線準備好仍只標已實作／待驗收；必要驗收和交付門檻不取消。只測通常使用路徑及必要正確性／安全邊界，不補偏僻情景、完整矩陣或重跑已有可信證據。
- **既有分支收束：**保留已建立的各包分支／worktree、固定前置及未驗項，無須為恢復按包驗收重建成果。將 S16-W02 已取得的有效證據歸回相應包，只補缺項，按真實依賴完成 review／PR／合併；新包恢復從已驗收合併的最新 master 開始。
- **正式合併：**尚欠必要驗收的功能包不合併 master、不部署。前置修正只補受影響的必要驗證；S16-W02 統籌跨包缺項，S17-W02 完成門檻不變。
- **目前主聊天例外：**使用者在 `01a0c876-a538-7a51-8b99-648131cc56f4` 明確授權本聊天直接執行最低必要驗收，毋須逐次詢問；主模型仍先準備／review 有界入口，報告範圍及實際次數，失敗定位後只補受影響部分。既有具體上限繼續沿用，不把免詢問理解為可加跑大量／深度測試；新增高成本操作先向使用者說明。例外不延伸至其他聊天，也不授權部署、續期或擴大雲端資源。

用户真机操作需要真实反馈；代码已准备但缺真机验收用“待驗收”。必需账号／权限／环境缺失且无法继续用“受阻”。单次演示成功、界面好看或计划写完都不等于产品完成。

<a id="maintenance"></a>
## 计划与规范维护

保留冻结基线的十章编号；现行文件使用稳定 REQ／AC／S／工作包／ADR／LOG／EV／SRC 标识，标题可以完善，锚点不能随意失效。只修改被新决定影响的部分，未变有效内容继续保留。

刪除或替代設計須在 DECISIONS 記原因、影響及替代，WORKLOG 只追加實際驗證及狀態。日常按現行 REQ／AC 與工作包追溯；只有需要回查遷移來源時，先讀 [_archive 索引](_archive/README.md) 再定位歷史 MIGRATION_MAP。文件移入 `_archive/` 或改為 archived-in-place，必須同包同步索引；不得直接掃描歸檔或改寫舊 LOG 連結。舊「待處理」不是狀態；使用本文件五狀態與四證據層級。[歷史拆分依據](docs/DECISIONS.md#adr-001)／[五階段依據](docs/DECISIONS.md#adr-005)／[Server 替代決策](docs/DECISIONS.md#adr-008)／[工作規則決策](docs/DECISIONS.md#adr-009)。

