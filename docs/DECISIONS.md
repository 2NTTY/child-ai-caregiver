# 决策与替代依据

只记录为什么、来源与影响；当前行为和实现全文分别在 [SPEC](../SPEC.md)、[ARCHITECTURE](ARCHITECTURE.md)、[DATA_MODEL](DATA_MODEL.md)、[API](API.md)。本文的历史原文不形成另一份现行规范。

<a id="adr-001"></a>
## ADR-001 — 文档拆分与磁盘基线冻结

- 状态：已确认；依据：用户本次明确授权 S00 及此前《长期开发文档体系与实施前迁移计划》。
- 基线：磁盘 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) v1.0（2026-09-20），SHA-256 见 [迁移清单](MIGRATION_MAP.md#baseline)。绝不根据聊天摘要重建。
- 原文件第 5 行“主计划”及逐章更新约定、第 8.1／8.3／8.6 的单文档组织由新职责分工替代；完整十章原文继续保留，已确认产品和架构不变。
- 当前规范的单一权威登记在 [README](../README.md#authority)；原 PROJECT_STATE.md 职责由 STATUS.md 接替，不创建／维护第二份状态文件。启动／测试方法放 README，AGENTS 只保留执行约定。
- DEVELOPMENT_PLAN 冻结后不继续同步修改。新需求只改其权威文件并记录原因、影响、替代条款和验证。
- 基线第 7 行“目前仍是四份文档”是旧状态描述，原样历史保留；不是本轮文件数量或实现完成情况。当前状态只由 PLAN／STATUS 表达。

<a id="adr-002"></a>
## ADR-002 — 旧资料的历史身份与有效资产

依据 v1.0 和用户后续确认，以下旧结论已替代；S00 **不修改、删除或移动**四份旧材料，在本登记处明确其效力。

| 旧位置 | 已替代的建议 | 当前权威入口 |
|---|---|---|
| PROJECT_PROPOSAL §1、§4 | 0–12 个月首版、0–10 岁远期路线 | [SPEC 产品形态](../SPEC.md#section-1-2)：0–10 岁四段覆盖；旧婴儿场景可作合成案例 |
| PROJECT_PROPOSAL §13；PITCH_AND_DEMO §5 | 六周开发排期 | [PLAN](../PLAN.md#steps)：按步骤与验收推进 |
| PROJECT_PROPOSAL §12–13；OPEN_SOURCE_REUSE §1、§5、§8 | Baby Buddy 优先作为底座、原生 App 才切 Expo | [既定共享架构](ARCHITECTURE.md#section-3-1)；研究候选尚未采用 |
| 旧参考项目中的 AWS／Twilio／短信实现 | 参考实现不成为产品选型 | [AI 与通知](ARCHITECTURE.md#section-3-6)；[Instagram 边界](../SPEC.md#section-1-5) |
| DEVELOPMENT_PLAN §8.2 的“追加实际复用决定” | 在研究文档另维护现行采用决定 | 实际选择的依据记录于本文件；研究材料保留调查用途和来源 |

下列有效资产原文保留并可直接访问，不能当作已实现或已验证：

- [PROJECT_PROPOSAL](../PROJECT_PROPOSAL.md)：§2 问题与验证假设、§3 香港服务／竞品、§6 功能研究、§9 官方来源治理、§10 报告、§11 安全隐私、§17 历史交付状态。
- [OPEN_SOURCE_REUSE](../OPEN_SOURCE_REUSE.md)：§1 候选与许可、§2 Baby Buddy 限制、§3 缺口、§6 复制与许可义务、§7 AI 开发成本、§8 旧里程碑；保留仓库及许可链接，不把候选清单当采用清单。
- [PITCH_AND_DEMO](../PITCH_AND_DEMO.md)：§2 开场稿、§3 四分钟剧本、§4 核心画面、§5 简报、§6 问答、§7 事实核对；合成、模拟和演示备份须继续如实标注。
- [WEEKLY_LOGS](../WEEKLY_LOGS.md)：§1 AI 与个人归属、§2 周报流程、§3 证据、§8 导师跟进、§9 可登记的旧状态、§10 提示词；只是模板，实际发生记录由 [WORKLOG](../WORKLOG.md) 提供。

<a id="adr-003"></a>
## ADR-003 — 提前持久化纵向流程，保持完整范围

依据用户已确认迁移方案，v1.0 §7 的 16 个大步骤调整为 [S00–S17](../PLAN.md#steps)。共享工程、三种存储、身份和多模态被拆成可独立验收步骤，使 Web／Android 重启后读取尽早验证；全部原工作和验收通过 [逐条映射](MIGRATION_MAP.md) 保留。

S03 无须等待账号、云数据库、AI、向量、配对或通知；这是实施顺序调整，不是移除这些最终功能。有限并行规则以 [PLAN 工作包](../PLAN.md#packages) 为准。本轮授权仅 S00，通过即停止。

<a id="adr-004"></a>
## ADR-004 — 模型、额度、人工操作与证据制度

依据用户已确认迁移方案，开发模型／额度唯一规则进入 [AGENTS](../AGENTS.md#models)，验证层级进入 [PLAN](../PLAN.md#verification)，事实记录进入 [WORKLOG](../WORKLOG.md#template)。余额以用户报告为准，旧计划“可取得真实用量”不能解释为授权主动查询。

默认关闭 Computer Use，简单 GUI／真机步骤由用户执行，机器检查由 Codex 执行；Luna 仅只读。此选择限制非必要开销，不把核心实现交给低能力模型。模型策略不等于已经更改实际会话配置。

<a id="deferred"></a>
## 原计划未确定、留待相应步骤细化的内容

这些是实施细节尚待确定，并非迁移条款缺失；已有上层约束完整保留。迁移归属无法判断的 unresolved 只登记在 [MIGRATION_MAP](MIGRATION_MAP.md#unresolved)。本轮不作新增技术决定。

| 编号 | 尚待确定 | 负责步骤与当前约束 |
|---|---|---|
| <a id="d-api-001"></a>D-API-001 | HTTP 路径、封装、错误码、设备凭据编码、批量／兼容协商 | S06–S08；[API](API.md#errors-compatibility) 既有契约不能删减 |
| D-DATA-001 | 具体 schema、字段类型、索引和物理约束 | S03–S15 按对象需要逐步确定；[DATA_MODEL](DATA_MODEL.md) 不变量先行 |
| D-SEC-001 | 本地数据库／浏览器加密实现、密钥恢复细节 | S05、S15；[既定加密要求](ARCHITECTURE.md#section-3-2) 与迁移密钥隔离不可放松 |
| D-REUSE-001 | 候选固定版本、许可证及可复用清单 | S01；只读旧研究不能当已完成核验或已采用代码 |
| D-PLATFORM-001 | 实际模型可用性、平台权限与后台行为验证 | S04、S08、S11–S13；保持初始模型与平台选择，实施时验证，不虚称已跑通 |

<a id="template"></a>
## 后续 ADR 模板

编号／日期；状态（已确认或未决）；问题；决定与权威条款链接；依据；考虑过的替代；影响范围；被替代 ADR／条款；验证或实施步骤。不要把未決草案写成当前架构。
