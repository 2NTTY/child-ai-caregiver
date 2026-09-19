# 育伴港

面向香港家庭成年照顾者的 AI 照护协作助手。最终范围与行为由 [SPEC.md](SPEC.md) 定义；本目录当前只有文档，**尚无可运行的产品实现**。

<a id="entry"></a>
## 从哪里开始

Codex 每次先读 [STATUS.md](STATUS.md)，再定位 [PLAN.md](PLAN.md) 当前步骤和工作包。执行规则见 [AGENTS.md](AGENTS.md)。不要默认重读完整文档或整个仓库。

<a id="authority"></a>
## 文档职责与文件树

| 文件 | 唯一职责 |
|---|---|
| [README.md](README.md) | 项目介绍、文档入口、实际可用的启动和测试方法 |
| [AGENTS.md](AGENTS.md) | Codex 读取、实施、模型、额度、验证和收尾规则 |
| [SPEC.md](SPEC.md) | 最终产品行为、边界、权限要求与产品验收 |
| [PLAN.md](PLAN.md) | 实施步骤、依赖、步骤状态、工作包及阶段验收 |
| [STATUS.md](STATUS.md) | 当前工作的短快照与恢复入口；状态派生自 PLAN |
| [WORKLOG.md](WORKLOG.md) | append-only 实际工作、验证、失败、决定和证据索引 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 组件、技术选型、数据流、同步、主节点、AI、部署、灾备及运行成本机制 |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | 实体、字段、关系、不变量、状态转换与迁移格式 |
| [docs/API.md](docs/API.md) | 接口职责、鉴权、请求／响应语义、幂等、错误和兼容约定 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 决定的原因、依据、替代关系与影响 |
| [docs/MIGRATION_MAP.md](docs/MIGRATION_MAP.md) | 完整基线逐条到新权威位置的映射和核对结果 |
| artifacts/verification/ | 有实际检查时才保存脱敏证据；不是第二份规范 |

同一信息只维护一份完整定义，其他文件引用它。需求、实现机制和验收场景可以相互关联，但不能独立维护冲突版本。文档中的原章节编号用于保持来源可定位；稳定锚点用于跨文件引用，后续不得随意改名。

<a id="historical-assets"></a>
## 保留的历史基线和研究资产

以下五份原文件原地保留，S00 不修改内容。它们不与上述文件竞争当前规范权威。旧建议替代关系及有效资产章节见 [ADR-002](docs/DECISIONS.md#adr-002)。

- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)：完整 v1.0 Master Plan，磁盘原文为迁移基线，迁移后冻结为历史依据，不与新规范同步修改。
- [PROJECT_PROPOSAL.md](PROJECT_PROPOSAL.md)：产品研究、香港资料来源、问题和验证假设。
- [OPEN_SOURCE_REUSE.md](OPEN_SOURCE_REUSE.md)：带日期的开源调查、来源和许可；实际采用决定进入 DECISIONS，候选出现不表示已采用。
- [PITCH_AND_DEMO.md](PITCH_AND_DEMO.md)：演示资产，后续依 SPEC 和真实验证结果更新；模拟内容须标注。
- [WEEKLY_LOGS.md](WEEKLY_LOGS.md)：四人导师 log 模板；具体记录按要求从 WORKLOG 与真实个人核验生成。

<a id="run-test"></a>
## 启动和测试

目前没有应用工程、APK、服务或产品测试命令。本轮只执行 S00 文档迁移；S02 建立工程并实际验证后，才在此填写可运行的命令。本次文档核对的方法和结果见 [WORKLOG](WORKLOG.md#records)。不要把文档验收当作产品验证。
