# 工作日志

唯一保存实际发生的工作、验证、失败和证据。**Append-only：初始化制度和模板后，只追加记录；错误通过新增更正条目引用原 LOG，不重写历史结果。** 当前状态见 [STATUS](STATUS.md)，完整验收制度见 [PLAN](PLAN.md#verification)。

<a id="rules"></a>
## 记录规则

每条至少包含日期／编号、目标、实际动作、AI 协助、人员核验、修改／成果位置、测试结果、失败／阻塞和下一步。历史回填必须明确标注，区分实际发生时间和记录时间，未知时间写未知，不用整理时间代替执行时间。

不编造工时、访谈、付款、用量或测试结果，不把自动等待算个人工时。原始长日志和脱敏报告按需保存到 artifacts/verification/，本文件只记结论及证据索引。日志不包含真实家庭正文、私人附件、密钥或恢复信息。

<a id="section-8-5"></a>
## 8.5 四人 log

<a id="rule-8-5-01"></a>
保留当前真实分工：

- <a id="rule-8-5-02"></a>你：主力使用 AI、整合、验收和产品决定；
- <a id="rule-8-5-03"></a>两位组员：经费支持，以及实际认领并完成的其他工作；
- <a id="rule-8-5-04"></a>另一位组员：实际协助、测试或材料整理。

<a id="rule-8-5-05"></a>
你要求生成 log 时，根据工作证据整理四份草稿，各人核对。团队成果不自动变成四个人各自独立完成的工作。

<a id="template"></a>
## 后续追加模板

```markdown
<a id="log-yyyymmdd-001"></a>
## LOG-YYYYMMDD-001

- Recorded At：[实际记录时间及时区]
- Work Date：[实际发生时间；未知则注明；历史回填单独标识]
- Step / Package：[Sxx / Sxx-Wxx]
- Executor：[主模型／Luna 只读／用户／组员]
- Goal：[本次目标]
- AI Assistance：[实际协助]
- Human Verification：[实际人员核验；未进行则写未进行]

### Actual Work
- [实际做过的动作、关键决定及 ADR 引用]

### Changes
- [修改文件与用途；只读写无文件修改]

### Verification
- Requirement / Acceptance：[REQ／AC]
- Method：[实际命令或人工操作步骤]
- Environment / Revision：[实际环境、版本或修改范围]
- Result：[通过／失败／未执行]
- Evidence：[EV 编号、报告位置或简短可核对输出]

### Limitations / Blockers
- [未验证内容、失败原因、缺少条件；没有则写无]

### Plan Update
- [步骤／工作包状态变化及理由；无变化则写无]

### Next Action
- [一个具体动作]
```

<a id="records"></a>
## 实际记录

<a id="log-20260920-001"></a>
## LOG-20260920-001

- Recorded At：2026-09-20（Asia/Hong_Kong，本次实施进行中记录）
- Work Date：2026-09-20；仅记录本轮，不回填此前研究工时。
- Step / Package：S00 / S00-W01。
- Executor：主模型；Luna（foundation_check、coo_repo_audit）只读核查。
- Goal：实施用户限定的 S00 文档迁移，保留磁盘基线和四份旧材料。
- AI Assistance：主模型读取与文档整理；Luna 检查 §4–6 规则及四份旧资料的替代关系。
- Human Verification：用户已指定源文件及边界；尚无用户对生成文档的人工验收反馈。

### Actual Work
- 读取磁盘完整基线，确认目录尚无产品工程；登记五文件 SHA-256。
- 逐段／列表项／表格行建立 561 个源单元，源标题另登记。
- 读取引用任务作为历史背景，不替代磁盘基线；未采纳旧 0–12 月、六周或 Baby Buddy 底座建议为当前规范。
- 根据 ADR-001 至 ADR-004 整理权威职责、提前纵向流程、模型／额度与验收规则。

### Changes
- 正在创建用户指定十一份文档；原基线和四旧材料保持不动。尚未完成最终迁移验收。

### Verification
- Requirement / Acceptance：AC-S00-M01、M02，其他进行中。
- Method：PowerShell 读取源文件与 Get-FileHash；Node v24.11.0 按源行建立迁移单元；Luna 本地只读审阅。
- Environment / Revision：Windows，工作目录为本项目；开始时 git status 仅 DEVELOPMENT_PLAN.md 未跟踪，其余四文件无修改。
- Result：源读取与初始清点通过；最终覆盖／链接／状态检查未执行。
- Evidence：初始 SHA-256 登记在 [MIGRATION_MAP](docs/MIGRATION_MAP.md#baseline)，完成时另追加核查证据，不把本条改成全部通过。

### Limitations / Blockers
- 完整落点和一致性仍待检查；未运行产品测试，因尚无产品实现。
- 用户余额未知；未查询 Usage。实际模型配置未独立核对，未切换声明。

### Plan Update
- S00／S00-W01：未开始 → 进行中；S01–S17 未开始。

### Next Action
- 完成迁移映射、结构检查及 Luna 对生成文件的独立复核。

<a id="log-20260920-002"></a>
## LOG-20260920-002

- Recorded At：2026-09-20 03:52:25 +08:00（Asia/Hong_Kong）。
- Work Date：2026-09-20，本轮 S00 实施与核查。
- Step / Package：S00 / S00-W01。
- Executor：主模型写入、修正与机器检查；两名 Luna 子代理只读独立核查。
- Goal：完成完整迁移、关闭审阅发现，更新步骤与短状态后停止。
- AI Assistance：正文迁移、561 单元映射、验证、日志整理；Luna 没有修改项目文件。
- Human Verification：没有用户对生成文档的额外人工验收；S00 的文档检查由主模型和独立 Luna 完成，未冒充产品真机验收。

### Actual Work
- 创建用户指定的十一份文档，按唯一职责迁移全部有效设计与验收；冻结磁盘基线和四份旧材料，保留其路径、字节和历史效力。
- 561 个源单元及 72 个标题分别定位；484 个原文单元迁入，77 个元信息／步骤／治理单元有明确表述整合或替代依据；第 10 章 55 个最终验收与完成判据完整保留。
- PLAN 建立 S00–S17、五种状态、工作包和阶段门槛，提前 Web／Android 真实持久化纵向流程；AGENTS 与 STATUS 保持短小，余额未知且未查询。
- 原有未确定的接口、schema、加密实现、许可和平台验证分别登记后续负责步骤，没有擅自决定；迁移归属 unresolved 为 0。
- 处理 F-01（知识库链接分流）和 F-02（下载 cursor 与上传确认语义），Luna 定点复核均通过。补齐审计证据并重跑检查后，Luna 确认 F-03 已关闭。

### Changes
- 新建：AGENTS.md、README.md、SPEC.md、PLAN.md、STATUS.md、WORKLOG.md；docs/ARCHITECTURE.md、DATA_MODEL.md、API.md、DECISIONS.md、MIGRATION_MAP.md。
- 新建三份实际证据：artifacts/verification/S00_SOURCE_INDEX.json、S00_CHECKS.json、S00_AUDIT.md。
- DEVELOPMENT_PLAN.md 和四份旧材料未修改；未创建 PROJECT_STATE.md。临时文档生成／检查脚本仅在系统临时目录，未写入产品工程。

### Verification
- Requirement / Acceptance：AC-S00-M01 至 AC-S00-M09。
- Method：五文件 SHA-256；逐源行覆盖及源单元哈希；目标原文与锚点比较；本地链接／唯一锚点／状态／短入口／最终 AC 检查；两名 Luna 独立只读审阅和定点复核。
- Environment / Revision：Windows，Node v24.11.0；本轮只有文档与证据改动，未提交 Git commit；最终文档哈希在 EV-001。
- Result：内容迁移、映射、独立审阅与 24 项机器检查通过；收尾后按同一方法复核文档哈希、状态和链接，结果记录于 EV-001。
- Evidence：[EV-001 机器结果](artifacts/verification/S00_CHECKS.json)、[EV-002 独立核查与发现处理](artifacts/verification/S00_AUDIT.md)、[完整来源索引](artifacts/verification/S00_SOURCE_INDEX.json)。
- 失败记录：首轮临时检查器误判两位数有序列表前缀，已修复检查器；两份证据未落盘时链接检查失败，补齐后重跑通过。没有以失败结果标完成。

### Limitations / Blockers
- 迁移遗漏 0、迁移归属 unresolved 0、未解决规范冲突 0；五类原有实施细节见 DECISIONS，并非文档缺失。
- 本轮未进行产品运行、模型调用、真机、外部网页可用性或服务测试；这些仍属未开始的后续步骤。
- 开发额度与实际模型配置继续按 STATUS 如实记为未知／未独立核对。

### Plan Update
- S00、S00-W01、M01–M09 在验收与记录齐备后同步为“已完成”；S01–S17 保持“未开始”。
- STATUS 保留 S00 完成快照；本条只追加，LOG-20260920-001 的进行中记录未重写。

### Next Action
- 按用户边界停止；等待用户另行安排后续工作。本轮不进入 S01，不 clone、安装依赖、写产品代码或部署。

<a id="log-20260920-003"></a>
## LOG-20260920-003

- Recorded At：2026-09-20 03:55:39 +08:00（Asia/Hong_Kong）。
- Work Date：同日，用户本次额度报告。
- Step / Package：状态维护；不启动新的开发步骤。
- Executor / AI Assistance：主模型登记报告；未调用子代理。
- Human Verification：用户原话“现在只有20%的5小时额度了”。
- Goal：保存用户提供的额度，避免混淆不同额度窗口。

### Actual Work
- 记录 5 小时额度剩余 20%；周额度与重置时间均未提供，不查询或推算。
- AGENTS 的周额度档位不套用到这条短时额度报告；当前只做记录和交接，不启动新开发任务。

### Changes
- STATUS 更新额度快照、时间与日志引用；WORKLOG 仅追加本条。

### Verification
- 依据：用户直接报告及 AGENTS 额度规则。
- 方法／结果：核对记录保留“5 小时／剩余 20%”，周余额仍为未知，S00 已完成与 S01 未开始状态不变。
- 本次仅更新状态元数据，不重跑 S00 全套核查；原 EV-001 的文件哈希对应迁移验收时版本，继续作为历史证据保留。

### Limitations / Blockers
- 不推断剩余可用时长、token 数或重置时间。

### Plan Update
- 无变化。

### Next Action
- 保持停止，等待用户安排后续工作。
