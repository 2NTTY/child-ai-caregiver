# Codex 工作规则

<a id="read"></a>
## 读取入口
- 每次先读 [STATUS.md](STATUS.md)，再读 [PLAN.md](PLAN.md) 当前步骤及工作包；只按需要读 SPEC、docs 和相关 WORKLOG。
- 不默认扫描整个仓库或重读全部文档、日志、聊天；先做有范围的搜索，扩大范围必须有具体原因，限制无关工具输出。
- 已有研究先复用结论和来源，避免重复调查；先看失败原因，避免重复已证明不合适的尝试。
- 日常不直接掃描 `_archive/**`、歷史相容入口（DEVELOPMENT_PLAN、PROJECT_PROPOSAL、PITCH_AND_DEMO、WEEKLY_LOGS、docs/MIGRATION_MAP）及 `artifacts/verification/S00_*`；需要追溯時先讀 [_archive 索引](_archive/README.md)，再讀指定資料／章節。WORKLOG 日常禁止全讀，只讀模板、當前相關 LOG 或追加所需尾部。
- `OPEN_SOURCE_REUSE.md` 只在 S01 或具體復用核查時按需讀取；S01 完成後才評估歸檔。新文件移入 `_archive/` 或改為 `archived-in-place` 時，必須在同一工作包同步更新 `_archive/README.md` 的用途、路徑、來源版本、校驗值及閱讀條件。

<a id="language"></a>
## 語言規則

- 使用者需要閱讀和管理的項目文件，預設使用香港繁體中文，包括 AGENTS.md、PLAN.md、STATUS.md、WORKLOG.md、SPEC.md、DEVELOPMENT_PLAN.md 及內部 docs；內部 API、architecture、data-model 文件也適用。
- 即使使用者以簡體中文提問，日常回覆、進度報告、驗收結果及需要使用者確認的決策或說明，均預設使用香港繁體中文。
- 面向外部，或主要供開發工具閱讀而使用者通常不需要閱讀的內容，可使用英文；GitHub 對外 README.md 使用英文。
- 程式碼、variable / function / class / type names、API 識別名稱、code comments、commit messages、branch names、Pull Request titles/descriptions，以及 test names / error messages / developer logs 繼續使用英文。API 文件的敘述語言按讀者及用途決定，不因涉及 API 就一律改用英文。
- 產品面向香港使用者的 UI、提示、按鈕及使用者可見文案，繼續按 SPEC 使用香港繁體中文，不因程式碼使用英文而改成英文。
- 技術術語可保留英文，例如 API、Git、PR、SQLite、PostgreSQL、worktree，不必強行翻譯。
- 不為統一語言批量翻譯或重寫現有內部文件；只在新寫內容或實際需要修改時遵守以上規則，只調整當前任務涉及的內容。

<a id="scope"></a>
## 实施范围
- 一次完成一个可独立验收的工作包；遵守 SPEC 和已确认架构，不擅自重新设计。
- 已有代码尽量局部修改；网页与 App 共享业务规则及协议，参见 [架构](docs/ARCHITECTURE.md#section-3-1)。
- 不做无关重构、可选抽象、UI polish 或顺手优化；不提前实现后续步骤需要的完整框架、服务或插件平台。
- 开源研究、许可和版本结论须保存；生产复用只按 [S01](PLAN.md#s01) 验收边界推进。
- 只實現育伴港領域；寫到相關功能時集中管理 prompt、知識來源、受限 skills／任務流程及領域規則，共享 TypeScript 業務、薄平台 adapter 及必要 port 按需建立。Server 權威及核心結構見 [ARCHITECTURE](docs/ARCHITECTURE.md#section-3-1)，不另建通用領域模型、插件平台、第二主題、空框架或獨立解耦包。

<a id="models"></a>
## 模型與分工
- 主模型由使用者在 UI 選擇，通常為 Astra 或 Sol；不固定、不擅自降級。子代理通常只用 Luna／Sol，禁止 Terra／Astra；使用者明確指定優先，單次例外不成為長期許可。
- Luna 固定 Max，只做具體、獨立、可驗證的唯讀調查；禁止修改檔案、任何寫入 workspace 的操作、實現或架構決策。Sol 預設 High，只可 High／Xhigh／Max，負責邊界明確的實現；複雜實現、架構、衝突、整合 review 及最終驗收由主模型負責。所有子代理均禁止再 spawn。
- 每個工作包同時及累計各最多 4 個 Luna＋4 個 Sol，合計最多 8 個；重啟、恢復及替代啟動均計入累計，達限先整合，不追加，不以改名或重啟規避。實際 runtime 如有限制更低則採較低值；數量是上限，不是目標。
- 主模型只委派具體、獨立、可驗證，且節省的閱讀或實作負擔足以抵銷派單、回報及整合成本的任務，使用最少必要代理。Luna 適合大型檔案、跨檔案／目錄、呼叫鏈、大量日誌及獨立證據核查；已知位置的小檔案、少量程式碼、單一事實及主模型即將修改的程式碼由主模型直接處理，不拆碎同一調查或重複委派等價核查。
- 主模型按讀取入口掌握 STATUS 及當前 PLAN，親讀影響本次判斷的架構、設計、狀態及交接原文；Luna 可定位章節，不能以摘要代替主模型理解關鍵原文。
- 主模型先拆分，再一次性下達目標、範圍、路徑線索、已有證據、約束、禁止事項、停止條件及預期輸出；Sol 另須有修改歸屬及驗收要求。spawn 明確指定角色、模型、effort 及 `fork_turns="none"`，不繼承完整對話；`task_name` 不能代替角色設定。
- 只並行獨立任務，主模型同時處理不依賴其結果的工作。Sol 須有穩定接口、明確且不重疊的修改歸屬及無相互依賴；共享檔案、權限、同步、遷移或高耦合修改由主模型統籌串行。
- 每輪收齊最終結果後統一整合，未整合前不追加同類任務。不追問例行進度、不零碎補上下文，不用 `send_message` 輪詢或重複指令；follow-up 只補齊阻塞工作的關鍵證據，必要阻塞或越界風險可即時回報。
- 等待時先做獨立工作，優先利用完成通知；必須阻塞時採工具及上層規則容許的合理長等待。不以短 timeout、高頻狀態查詢或例行消息喚醒主模型，無新證據不反覆推理或報告相同狀態。
- 復用已有調查與驗證，證據足夠即停止。Luna 按角色檔交付可局部核查的來源、必要原文及檢索範圍；主模型抽查引用及關鍵原文，不重新完整讀取已外包材料。只因矛盾、阻塞證據缺漏、相關內容改變或新回歸風險擴大核查，不削減必要 review 或驗收。
- 本節維護主模型調度規則；專案 [.codex/config.toml](.codex/config.toml) 只維護預設子模型 `gpt-6-sol`、effort `high`、總並發硬上限 8 及角色入口，每角色及累計限額仍是本節行為規則，不捏造 config 欄位。兩份角色檔只維護模型、權限及自身任務／交付要求：`explorer` 為 `gpt-6-luna` Max／readonly；`worker` 為 `gpt-6-sol`，不固定 effort，以保留 High 預設及明確指定的 High／Xhigh／Max。不改全局設定。
- 分開核對配置解析、指令載入及實際 runtime；可取得時核對主模型、子代理、effort 及 sandbox，未能取得則標未驗證。唯讀指令不等於作業系統唯讀沙箱，不憑角色檔宣稱本輪已生效，不為證明設定額外啟動代理，不宣稱未量測的時間或額度收益。

<a id="operations"></a>
## 操作方式
- 默认不使用 Computer Use；登录、授权、验证码、扫码、真机安装、Android 权限及简单 GUI，优先提供步骤与预期结果，由用户操作。
- shell、build、test、lint、typecheck 和机器检查由 Codex 执行；必须记录用户实际反馈，不能假定人工验证通过。
- 可合併的搜尋、讀取、修改及驗證集中批量處理，避免零碎 exec／patch 或等價檢查。連續兩輪「修改 → 執行驗證 → 再修改」仍未解決時，先整理根因、失敗證據及下一方案，再繼續。

<a id="git-workflow"></a>
## Git 工作流

- 本地仓库是主要开发环境，GitHub 用于阶段备份、PR 和审查。
- `master` 保持稳定，不直接在 `master` 开发。
- 以可獨立驗收的工作包為分支及合併單位；每包從最新穩定 `master` 開分支，例如 `codex/s11-w01-gemini-chat`。文件維護亦使用獨立分支。
- 同一 Sxx 可跨階段、跨多個工作包及 PR，不等待整個 Sxx 完成才合併；一個分支原則上只完成一個工作包。
- 开发期间正常本地 commit，不要求每次 commit 都 push。
- 工作包達到相關驗收條件後，按文件更新邊界更新必要的 PLAN／STATUS 並追加 WORKLOG，再 push 到 GitHub；只在全部工作包及原驗收完成後把整個 Sxx 標為已完成。
- 使用 Codex 原生 Review / Pull Request，将该分支合并回 `master`。
- 工作包記錄明確列出前置工作包；完成 review 並合併後，才開始依賴其成果的下一包。不以整個 Sxx 作跨階段依賴鎖。
- 不提交 `.env`、API key、密钥、凭据、私人数据或本地数据库。

<a id="document-updates"></a>
## 项目文档更新边界

- 普通工具操作、Git/GitHub 操作、登录授权、邀请协作者、临时检查、调试命令和验证过程，不属于项目进度，不得因此修改 STATUS.md、WORKLOG.md、PLAN.md、README.md 或其他项目文档。
- 只有實質工作包狀態、需求／架構／實現、驗收、重要失敗決策或正式里程碑變化，才更新相應文件；普通 Git、格式或臨時檢查不記 LOG。
- 本节优先于本文其他记录、收尾和额度快照要求；不满足上述条件时，仅在当前对话报告，不触发项目文档更新。
- WORKLOG 嚴格 append-only：既有正文、連結、空白及格式均不回寫；更正只追加新記錄。歸檔透過舊路徑相容入口與索引保持追溯，不以修復連結為理由改寫舊 LOG。S00 JSON 原位凍結、唯一保存，不為目錄整齊搬移後再複製。

<a id="finish"></a>
## 验证与收尾
- 按 [PLAN 验证制度](PLAN.md#verification) 区分已确认、已实现、已验证、已完成；代码写完不等于完成。
- 預設只做修改所需的輕量檢查及針對公開輸入／輸出的單元測試；相關程式碼改變或新證據顯示回歸風險才重跑。integration、E2E、真機、真實服務及深度／全量回歸須先說明原因、範圍及成本，由使用者決定；未批准的必要驗收標「待驗收」，不當作通過或取消。
- 仅在符合[项目文档更新边界](#document-updates)时，按 [WORKLOG 模板](WORKLOG.md#template) 追加实际完成与未完成、修改原因、验证方法／结果、版本／证据、失败原因及下一步，并按实际变化更新相应文档，不机械同步 PLAN 和 STATUS。
- 未通过验收不标已完成；失败、未执行、待人工验收及受阻如实记录。保护当前修改并留下可恢复现场。
- 密钥、恢复信息、真实家庭正文及私人附件不写入工程或成本日志；人员贡献据实记录。
- 详细需求留在权威文件，通过短状态定位；本文件保持短小。[AGENTS 参考](https://developers.openai.com/zh-Hans/docs/agent-configuration/agents-md)

<a id="quota"></a>
## 额度（阈值唯一权威来源）
- 周额度只采用用户查看 Usage 后提供的原值与报告时间；不主动查询、不猜测、不推算，不根据日期自行宣称重置。
- GREEN：剩余 >=50%，正常核心开发。
- YELLOW：25% <=剩余<50%，只做当前验收目标，推迟非必要优化。
- RED：10% <=剩余<25%，只做 blocker、正确性、必要测试和恢复准备。
- CRITICAL：剩余<10%，不启动大型新任务，稳定仓库，更新日志与状态，留下明确下一步。
- 未提供余额时标“未知”，仅推进有边界的当前工作包，不编造 token 数或节省比例；用户报告写入 WORKLOG，STATUS 仅保留最新短快照。
- 第三个周额度作为 Reserve + Polish：先用于 blocker、回归、正确性、必需验收、迁移、交付及文档；核心完成后才做用户明确选择的小范围 polish，不提前承诺非核心功能，不改成按周排期。
- 低额度缩小工作包，不丢弃修改或跳过正确性检查；产品 Gemini／基础设施费用见 [运行成本](docs/ARCHITECTURE.md#section-9-1)，与 Codex 额度分开。
