# Codex 工作规则

<a id="read"></a>
## 读取入口
- 每次先读 [STATUS.md](STATUS.md)，再读 [PLAN.md](PLAN.md) 当前步骤及工作包；只按需要读 SPEC、docs 和相关 WORKLOG。
- 不默认扫描整个仓库或重读全部文档、日志、聊天；先做有范围的搜索，扩大范围必须有具体原因，限制无关工具输出。
- 已有研究先复用结论和来源，避免重复调查；先看失败原因，避免重复已证明不合适的尝试。

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

<a id="models"></a>
## 模型與分工
- 主模型由使用者自行選擇，通常在 Sol～Astra 範圍內；本文件不固定預設主模型，不得擅自降級使用者選擇的模型。
- Luna 只能作為只讀子代理，用於調查、程式碼定位、日誌／測試分析及影響核查；不得修改檔案、寫生產程式碼或決定架構。
- 需要寫程式碼的子代理，優先使用與主模型相同的模型；若無法使用，至少使用 Sol，不得使用 Luna 或更低能力模型寫入生產程式碼。
- 主模型負責整合、審查子代理輸出及最終實現。
- 核對實際主模型與子代理設定，不得僅憑本文件聲稱已切換模型。

<a id="operations"></a>
## 操作方式
- 默认不使用 Computer Use；登录、授权、验证码、扫码、真机安装、Android 权限及简单 GUI，优先提供步骤与预期结果，由用户操作。
- shell、build、test、lint、typecheck 和机器检查由 Codex 执行；必须记录用户实际反馈，不能假定人工验证通过。

<a id="git-workflow"></a>
## Git 工作流

- 本地仓库是主要开发环境，GitHub 用于阶段备份、PR 和审查。
- `master` 保持稳定，不直接在 `master` 开发。
- 开始每个 Sxx 前，从最新 `master` 创建对应分支，例如 `s03-web-vertical-slice`。
- 一个分支原则上只完成一个 Sxx；过大的步骤才按工作包拆分。
- 开发期间正常本地 commit，不要求每次 commit 都 push。
- Sxx 达到验收条件后，更新 `PLAN.md` / `STATUS.md` / `WORKLOG.md`，再 push 到 GitHub。
- 使用 Codex 原生 Review / Pull Request，将该分支合并回 `master`。
- 合并完成后再开始依赖它的下一个 Sxx。
- 不提交 `.env`、API key、密钥、凭据、私人数据或本地数据库。

<a id="document-updates"></a>
## 项目文档更新边界

- 普通工具操作、Git/GitHub 操作、登录授权、邀请协作者、临时检查、调试命令和验证过程，不属于项目进度，不得因此修改 STATUS.md、WORKLOG.md、PLAN.md、README.md 或其他项目文档。
- 只有项目实际需求、架构、实现状态、长期决策或正式里程碑发生变化时，才允许更新相应文档。
- 本节优先于本文其他记录、收尾和额度快照要求；不满足上述条件时，仅在当前对话报告，不触发项目文档更新。

<a id="finish"></a>
## 验证与收尾
- 按 [PLAN 验证制度](PLAN.md#verification) 区分已确认、已实现、已验证、已完成；代码写完不等于完成。
- 优先相关检查；相关代码改变或新证据表明确有回归风险才重跑，不无故重复全套测试。
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
