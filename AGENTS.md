# Codex 工作規則

<a id="read"></a>
## 讀取入口

- 根 AGENTS 是共通基底；子域有衝突時採較深層指示，使用者當次明確指示優先。[Codex 載入](https://learn.chatgpt.com/docs/agent-configuration/agents-md)沿根至工作目錄；從根處理子域時先讀該域 AGENTS，不因此擴大修改範圍。
- 先讀 [STATUS](STATUS.md)；前端接 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)，Server／Agent／正式整合／根文件維護接 [PLAN#active](PLAN.md#active)，再按包讀必要契約、交接及 Skill。
- 開工、整合及交付前核對 master、相關 PR／head 和本機差異；分清已合併、未合併、dirty 與實際部署，不修改其他 checkout。
- 先局部定位並復用結論，只為具體缺口擴讀。歷史由 [_archive 索引](_archive/README.md)按主題查指定文件／LOG；WORKLOG 只讀相關項及必要尾部，不掃全量歷史。OPEN_SOURCE_REUSE 是歷史研究，現行採用看 DECISIONS／TECH_REUSE。

## 開發與檢查入口

命令在倉庫根執行；環境、`npm ci`、唯一 lockfile 與目錄責任見 [README](README.md#run-test)／[Repository layout](README.md#repository-layout)。

| 用途 | 入口 |
|---|---|
| 本地資料／畫面，零模型 | `npm run agent:local -- --no-model` |
| 真 Agent | 按[本地指南](docs/AGENT_LOCAL.md)配置本人憑證，再執行 `npm run agent:local` |
| 僅前端 | `npm run web`；不啟動 API，完整登入用上述同源入口 |
| 單檔檢查 | `node --experimental-test-module-mocks --test tests/<檔名>.test.ts` |
| Web 建置／正式部署 | `npm run build:web`／[Firestore 部署指引](docs/PRODUCTION_FRONTEND.md#firestore-deployment) |

檢查按改動選取，不預設跑整批 `npm test`。

<a id="language"></a>
## 語言

- 回覆、進度、驗收及內部 AGENTS／PLAN／STATUS／WORKLOG／SPEC／架構契約用香港繁體中文。
- 公開 README、程式／識別名稱、code comments、commit／branch／PR、測試名稱／錯誤及開發日誌用英文；技術術語及主要供工具閱讀的內容可用英文。
- 產品文案依 SPEC 用香港繁體中文，只改當前範圍，不批量翻譯舊文件。

<a id="scope"></a>
## 實施範圍與自主推進

- 按已確認 SPEC／架構完成可獨立驗收的工作包，優先局部修改；不順手重構、美化或預建後續框架。Web／App 共用業務規則與協定，Server 保持權威，見[架構](docs/ARCHITECTURE.md#section-3-1)。
- 已授權且必要的工作直接做，不反覆詢問同一批准或為普通可逆操作另設確認。只有實質需求歧義、超出授權／成本範圍或工具要求才詢問，並指出具體原因。
- 未完成就繼續推進；回答旁支問題後回到原任務。需本人登入、安裝、系統授權或待驗時，只保留受阻項，繼續獨立工作；沒有可做項才清楚交接，不冒稱完成。
- 只實現育有方領域：集中管理 prompt、來源、受限工具及領域規則，按需建立共用 TypeScript／薄 adapter，不建第二產品、通用平台或空框架。開源採用依 [S01](PLAN.md#s01)，授權／版本結論留原有目的地。

<a id="technical-skills"></a>
## 技術研究與 Skill 復用

- 先查既有程式、依賴、Skill／研究及同版本官方能力；有具體缺口才比較 1–2 個成熟候選的維護、相容、license、接線成本與必要驗證。小改或已有結論只記一句理由，不重做全面研究／已驗功能，採用證據見 [TECH_REUSE](docs/TECH_REUSE.md#decisions)。
- 裁切、選檔、錄音、播放、表單等常見功能，先看已裝套件的完整選項、原生元件與範例。配置／薄 adapter 能滿足便沿用；自建前用 1–3 句說明必要缺口及取捨。review 同樣檢查是否漏用現成能力，不因已投入就保留替代品。
- 按完整操作體驗判斷，不只看 API／保存成功；優先成熟系統互動，設備差異留薄 adapter，家庭授權、終態、確認及防重留業務服務。
- 重要 SDK／API、身份、持久化、建置及部署核實際版本與適用 Skill；只為變更、棄用、衝突或缺證據補查官方約束。價格等易變資訊按需即查，文件相容不當實測。
- 技術 Skill 按實際需要保存可重用方法、版本陷阱、官方來源／日期及已核對／實測／待驗，放 `.agents/skills/<技術任務>/SKILL.md`，前端用本域位置；不抄手冊、存一次性故障或另建索引平台。上游 Skills 依[安裝紀錄](docs/SKILLS_INSTALLED.md)使用；技術 Skill 不取代產品 Prompt Pack 或權威契約。
- 調查／執筆依[模型分工](#models)；方法或契約衝突交主模型裁決，不靜默套用失效方法或改架構。

<a id="frontend-backend"></a>
## 前後端聊天分工

- 主聊天負責 Server／Agent／資料庫及正式 App 整合，已獲准依 [INT](PLAN.md#production-integration)修改 `frontend/` 及所需根依賴、client／部署接點；保留已確認設計、互動與美術，不以接線重做 UI。
- 前端設計聊天的預設範圍是 `frontend/**` 隔離 Expo 預覽及本域依賴／文件，不呼叫真 Server；可唯讀正式契約及素材。修改 `server/`、`deploy/`、`src/shared/`、正式 `app/`／`src/client/`、根依賴或權威文件須另有明確分配。正式整合不受這個預覽範圍限制。
- 各用獨立分支／worktree；先核正式 owner 歸屬，不以合成副本覆蓋正式資料。前端 PLAN／STATUS 管 FE，根 PLAN／STATUS 管正式包；按 [P2 UI 交接](docs/P2_UI_HANDOFF.md#chat-handoff)交換版本、元件／API 差異、授權、原 opId／unknown、草稿及身份清理。
- Android 共用 UI 可提前製作；正式 P3 接線／APK／真機依根 PLAN。預覽、窄 Web、bundle、真機與正式成果分開，不以假成功補未接功能。依賴例外只按 [PLAN](PLAN.md#p2-deferred-acceptance)。

<a id="models"></a>
## 模型與分工

主模型由使用者在 UI 選擇，不自行切換或降級。Astra 主模型統籌需求、拆解、依賴、方案、派單、阻塞、整合、review 及最終驗收。

| 執行者 | 範圍 |
|---|---|
| Astra 主模型 | 困難功能、複雜排錯、逆向、科研方法、數學推導／證明、關鍵未知及高耦合修改；需求／架構與視覺判斷、跨任務裁決 |
| Sol（`gpt-6.1-sol`） | 簡單／中等、可界定及驗證的實作、工程排錯與獲授權驗證；常規 `high`，中等按需 `xhigh`，確有必要才 `max`，專案後備 `xhigh` |
| Luna Max | 唯讀定位／大量調查、呼叫鏈／日誌／證據分析，以及現有、無寫入、低成本、非關鍵的簡單批量測試 |

- **親寫要求：**AGENTS、SPEC、PLAN、架構／資料／API、DECISIONS、Skill 及全部 AI 提示詞／配方／指引（含 Prompt Pack）由 Astra 主模型親寫及核對，不因方法已定或改動小而外派。Sol 只可唯讀核查，Luna 只可定位證據。主模型親讀入口及影響判斷的契約／設計原文，不以摘要代替。
- **dot 例外：**dot 可用 Astra xhigh 原生子代理；上述指導文件必須特地委派、明確指定 Astra xhigh 執筆，不假定 dot 主模型符合。dot 主對話仍負責 review／驗收，其餘範圍規則照常。
- 其他子代理只用上表 Luna／Sol，禁止 Terra／Astra 及再派生；使用者明確例外只限當次。每包同時及累計各最多 4 Luna＋4 Sol，合共 8 個，重啟／替代亦計，runtime 更低從低。
- **派單按收益與難度：**先釐清結果、重要原話／限制及成功條件，復用已有答案，只追問實質歧義。短小已知工作主模型直接做，跨檔／未知定位按成本效益交 Luna；不按檔數判難度、不把困難工作交 Sol 試錯。核心方法確定後，才可拆出不承擔困難推理的獨立簡單／中等工作。
- 簡單派單交目標、歸屬／範圍、限制及驗收；中等再補關鍵思路、接口、不變條件與陷阱，Sol 自決一般實作細節。spawn 明確指定角色、模型、effort、`fork_turns="none"`，只傳必要上下文／原文位置、停止及通信邊界，不預寫全部步驟；提高 effort 不擴職責。
- Luna「只定位」派單列問題、搜尋範圍及停止條件；回報僅路徑＋行號／symbol，找不到時補一行未確定範圍。調查則交來源／版本、關鍵原文、適用性與不確定性。主模型局部讀原文，僅為不足、變更或矛盾補查。
- 驗證派單另列版本／環境、成功條件、已准操作／成本、可改路徑及停止條件。Sol 可做限定的瀏覽器／整合／設備核對及相關修正；Luna 不寫測試、不作最終驗收。保留任務涉及的隔離、撤權、原 opId／unknown 及通知授權。
- Sol 遇核心方法缺失、假設失效、困難推理、重大需求／架構／安全改變或越界，立即停受影響部分交主模型，不反覆補提示試錯。同一問題兩輪修正失敗亦接手；驗收仍依[首次失敗停批](#finish)。
- **並行與等待：**只並行接口穩定、歸屬不重疊的獨立工作；依賴結果到齊並覆核才整合。共享檔案／權限／同步／遷移由主模型串行統籌；瀏覽器、設備、測試庫等共享狀態同時一名執行者，交接先停前者。
- 派出後不重做其範圍；等待只做必要且獨立的原任務，否則等待。慢或等待逾時不當失敗，不催促、密集查狀態或另開等價代理；只有明確失敗／阻塞、需求變更或實際風險才中止／接手。
- 子代理只按已定通信關係交換必要接口／結果；不自行擴散、廣播進度或重複上下文，重大新依賴交主模型。結果整合後小缺口／返修用原代理 follow-up 或主模型處理，新 spawn 只供新的獨立工作。
- 回報只含結果、版本／環境、必要位置、證據、修正、風險及失敗／未驗／阻塞，截圖／trace 沿包保存，不另存全量日誌。主模型核關鍵 diff／原文／證據後裁決，證據足夠即停，不只信一句總結。
- [專案 TOML](.codex/config.toml)管預設／並發／角色入口，兩份角色檔管模型、權限及交付；Sol 角色不固定 effort。行為限額不虛構成配置，不改全局。配置、載入與 runtime 分開核實；不為驗設定另開代理或產品測試，不宣稱未知的模型／sandbox／快取或節省比例。

<a id="operations"></a>
## 操作方式

- 優先用現有腳本／API；可見互動用內置瀏覽器，原生 Computer Use 只在必要、可用且獲授權時使用。設備／真人結論不能由 Web 或合成測試代填。
- 登入、驗證碼、掃碼、安裝及系統權限需本人確認時，提供最短步驟並保留待辦；其餘 shell／build／test 由 Codex 執行。
- 獨立讀取／搜尋及同範圍驗證批量處理，避免零碎或等價重跑。兩輪「修正→驗證」未解決，先整理根因、失敗證據及下一方法再繼續。

<a id="git-workflow"></a>
## Git 工作流

- 本地開發，GitHub 作備份／review。每個可獨立驗收的包（含文件）從最新穩定 master 開 `codex/<工作包>` 分支，不直接改 master；正常本地 commit，不要求每次 push。
- 每包完成必要驗證、review 及文件後才交付，以 Merge commit 為預設。依賴包原則上等前置合併；既有例外見 [PLAN](PLAN.md#p2-deferred-acceptance)。Sxx 可分包跨階段交付，不等整個 Sxx 才合併，亦不把部分完成寫成整包完成。
- commit／push／PR／合併前按[本機協作指引](#team-contributions)切換並核對身份；維持單作者，不為分配自動加共同作者，不以 merge 的 Verified 代替開發提交核對。
- 不提交密鑰、憑據、私人資料或本地資料庫，保護其他人的未提交成果與分支。

<a id="team-contributions"></a>
## 本機協作指引

- 只在分配責任、署名或交付時讀本機 `docs/TEAM_CONTRIBUTIONS.md`，不納入 Git／遠端。當前 worktree 缺檔時先用已知本機位置查找；仍無所需資料才詢問，不猜身份。
- 按既有責任方向自行分包並據實記錄主責、參與、權重／份額及驗收責任，不逐包重問；分配不改產品前置、修改範圍或驗收要求。

<a id="document-updates"></a>
## 文件職責

本節是唯一文件維護規則；新增前先找既有目的地，同職責合併或引用，不為每包／每屏另開文件。

| 資訊 | 目的地 |
|---|---|
| 長期工作、閱讀、範圍及驗收規則 | 根／子域 AGENTS；子代理 runtime 值留 TOML |
| 需求與 AC／架構／資料／API | SPEC／docs/ARCHITECTURE／DATA_MODEL／API |
| 包、依賴、狀態、下一步、未驗及 gate | 所屬 PLAN；根管正式包，frontend 管 FE，`#active` 指當前入口 |
| 短現況 | 所屬 STATUS 投影 PLAN；外部現況附觀察時間／版本 |
| 決策及替代理由 | docs/DECISIONS；不複製現行配置 |
| 跨域接點與缺口 | docs/P2_UI_HANDOFF／frontend/HANDOFF 及既有專項 HANDOFF |
| 已採納設計／研究 | frontend/DESIGN_SYSTEM、MOTION_SYSTEM／原研究文件 |
| 可復用方法與版本陷阱 | 相關 Skill 及按需 references |
| 實際工作／驗證證據 | 根 WORKLOG＋artifacts/verification；前端 PLAN 短結果＋frontend/verification |
| 歷史定位 | _archive/README 按主題連指定文件／LOG／EV |

- **只記實質變化：**需求、實作、包狀態、驗收、重要失敗決策或正式里程碑才更新對應文件。普通 Git／登入／臨時查核不寫進度；本規則優先於其他收尾／額度記錄要求。
- PLAN 當前包留範圍、基線／分支、契約、下一步、阻塞／未驗與 gate；完成後收短為結果及證據。STATUS 在摘要／入口實質變動或接手發現失效時原位修正，不只追加，不藏未驗項；無變化不改日期。HANDOFF 只在接點／差異改變時更新，沒有第二份待辦。
- WORKLOG 嚴格 append-only，舊正文／連結／格式不改，錯誤以新記錄更正；前端包不改根 LOG／總包狀態或另建日誌。證據連特定版本／run，不把失敗改成通過，不保存私人正文／附件、密鑰或恢復資料。
- 替代規則同步現行引用；歸檔記用途、位置、來源 commit、SHA-256、替代入口與查閱條件，保留舊錨點／相容入口。凍結證據及 S00 JSON 原位保存，不為整理複製歷史。
- 跨域只傳必要接口、授權及 error／unknown 邊界，細節留原域。程式／契約矛盾先列影響並停依賴該判斷的操作，由主模型裁決，不按「較新」靜默改需求。

<a id="finish"></a>
## 驗證與收尾

- 按 [PLAN 證據層級](PLAN.md#verification)分清已確認、實作、驗證與完成；未做／失敗／待人工／受阻如實保留，合併或發布不代替驗收。
- 先復用有效證據，只補沒有便無法判斷基本可用或關鍵正確性的檢查；不機械跑全套 lint／typecheck／build／unit，不為數量／覆蓋率補矩陣、壓測或偏僻情景。
- 已有授權內的必要檢查直接做，不因換執行者或測試名稱重問；沿原範圍、次數、付款來源及成本上限。需要新增費用／資源、外發、權限變更、不可逆操作或工具要求的批准時，完成可審閱的準備後才詢問。其他聊天不得套用本聊天特許；既有例外見 [PLAN](PLAN.md#p2-deferred-acceptance)。
- 首次驗收失敗停該批，保留證據並查因；局部修正與補驗須在原批准／派單範圍。重大意外、改需求／斷言、增副作用或超限另報，不靠換 ID、提高額度或放寬斷言硬過。副作用 unknown 先查原結果，不盲重做。
- 主模型核關鍵 diff、契約及證據後收尾；人工結論只記本人實際回覆。按[文件職責](#document-updates)更新必要文件，根成果依 [WORKLOG 模板](WORKLOG.md#template)追加版本、方法／結果、失敗／限制及下一步，不機械同步全部文件。

<a id="quota"></a>
## 額度

只採使用者提供的 Usage 原值及時間；不主動查、不推算或宣稱自行重置。未提供即未知，仍推進有界工作，不編造 token／節省比例。

| 剩餘 | 工作範圍 |
|---|---|
| GREEN：≥50% | 正常核心開發 |
| YELLOW：25%–<50% | 當前驗收目標，延後非必要優化 |
| RED：10%–<25% | blocker、正確性、必要測試及恢復準備 |
| CRITICAL：<10% | 不開大型新任務，穩定現場並留下下一步 |

第三周額度作 Reserve + Polish，先解 blocker／回歸／驗收／遷移／交付，核心完成才做明確選定的小範圍 polish；不改成周排程。低額度縮範圍，不丟修改或省正確性。快照只在[文件職責](#document-updates)允許時記錄；產品／基建費用另見[運行成本](docs/ARCHITECTURE.md#section-9-1)。
