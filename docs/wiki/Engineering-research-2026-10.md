# 工程研究与下一阶段计划（2026-10-17）

源码核验基线 `e74574404ce9dfeddb98eaeae5ece879064dd8bc`。本页讨论通用引擎，不包含任何接入方产品计划。外部资料为检索日的官方页面，可能变化；模拟测试不能证明真实 provider 已验证。

## 当前系统与主要缺口

SMV 的五入口包已经连通站内文章、外部元数据、主题绑定、标签建议/账本、证据判据与展示；SMT 仍只有共享文档入口。作者/模型产生建议，人类编辑负责绑定和审核，宿主负责账号、存储、权限与绘图；引擎负责形状、规则、来源与可支持的视图。

当前最有价值的增长方向是“接入可靠性与诊断可追踪”，随后是 provider 合约与标签链路追溯。理由来自当前代码：服务已有四类 ServiceError，HTTP 已保留状态/error，SDK 却将所有失败折叠 null；端口类型齐全但必需/可选/失败组合仍需系统验收；模型 dropped、账本 refused/unchanged 与统计排除处于不同阶段；审核存储存在 append 后 putRequest 的部分成功窗口。

不优先拆独立 SMT 服务、引入框架运行依赖、自动改变信任政策或用新文献源元数据生成效应量。它们没有解决上述接入缺口，且会扩大运行/迁移责任。

## 外部研究与工程决策

| 官方资料（核验日 2026-10-17） | 观察与对本项目的含义 |
|---|---|
| [OpenAlex authentication](https://help.openalex.org/api/authentication/) | 日预算和每秒速率是不同约束，两种超限都可能 429；Bearer 头仍支持。当前客户端实例预算不等于账户或多实例硬限额。不要把代码默认值当成外部服务承诺。 |
| [OpenAlex errors](https://help.openalex.org/api/errors/) | 429 不只代表瞬时拥塞；先识别预算/速率和响应头再决定等待。当前 getJson 的固定有界 429 重试不是完整预算协调方案。 |
| [RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after) | Retry-After 可以是秒数或 HTTP 日期。客户端应保留可解释的等待提示，不自行无限重试。 |
| [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) | 提供标准机器可读错误格式，是未来 HTTP 扩展选项；不应为了 SDK 诊断立即替换已有 `{error}` 响应而破坏调用者。 |
| [Crossref REST](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) / [限流变更公告](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/) | 适合 DOI 元数据补充，但不能假定具有 OpenAlex 的主题树/全量计数语义；先明确能力矩阵，再考虑第二适配器。 |

这些来源支持接口/协议决策；没有在本轮执行外部付费查询、申请密钥、自动重试真实 API 或验证其全部返回。

## 分阶段计划

| 优先级 / 工作包 | 目标与方案 | 定位/依赖 | 交付与退出证据 |
|---|---|---|---|
| P0 / R01 可区分失败的 SDK | 新增独立结果式工厂，保留旧 factory 的 data/null；只识别受支持错误，不反射未知服务器正文；暴露 status 与 Retry-After | public-api → client、HTTP 状态和 guards；先定义本地 SDK 结果，不改数据载荷或 HTTP 路由 | 五方法成功/失败矩阵、旧调用回归、CJS/ESM/两种 TS 解析、快照和文档；无需真实 provider 即可验协议 |
| P0 / R02 OpenAlex 合约复核 | 复核分页/批量/预算与 header 的现行语义；把既有 credit 常量与官方当前计量关系明确列为待验，不以旧默认值推算账户费用 | external-transport/external-source；可独立于 R01；真实验收必须约束请求和预算 | 模拟 429/预算/坏响应矩阵、官方资料日期、一次受控 live 回执；多实例协调另做设计 |
| P0 / R03 本地安装包验收 | 消除 Windows 启动 pnpm 子进程的 ENOENT，使完整包验收可在本机执行 | scripts/check-package.mjs；不得通过跳过包测试取绿 | 临时目录真实 pack/install，五入口 CJS/ESM、TS 和 client→handler→service 通过 |
| P1 / R04 可复用 provider 合约矩阵 | 对必需/可选、null/空/partial/抛错、缓存读写失败做可复用契约案例 | host-ports/external-source；先复核已有断言以免重复写测试 | 同一组语义驱动适配器验收；模拟与 live 明确分开 |
| P1 / R05 标签阶段诊断 | 追踪清洗、收包、写入、裁决、应用/统计；保留每阶段出处与版本 | tagger-contribution→ledger-policy→ledger-integration；先固定键和政策 | 两条共用 sanitizer 路径、各阶段计数与拒绝/争议案例；不自动改变 null-confidence 或信任规则 |
| P1 / R06 审核提交责任 | 先定义原子提交、幂等、乐观版本与部分失败的宿主契约设计 | ledger-policy；需要使用场景和兼容评估 | 决策记录、并发/部分失败设计及可执行契约；不能把内存 store 当分布式事务证明 |
| P2 / R07 第二数据源试验 | 评估 DOI 元数据补全价值；能力不足时明确不支持，不制造主题计数 | R04 后；另审来源 ID/许可/出处/缓存 | 最小 adapter 设计和兼容矩阵；真实返回验收后才称实现 |
| 持续 / R08 文档与验收 | 工程入口、系统说明、TODO、声明/实现/检查/证据一致；更新影响的两个索引 | 所有工作包持续执行；不是最后才补文档 | 导航/任务范围/摘要、业务/包、适用图表和源引用验证 |

实施顺序：R01 定义结果边界 → 本地单元/HTTP 联调 → R03 打通安装包验收 → 更新 Wiki/检查并提交。R02/R04 可独立调研；R05/R06 不因本轮额度允许就直接改政策或数据库协议。后续状态以 [TODO](TODO.md) 为准。

未定事项：实际宿主如何显示错误、共享预算的计量与存储、取消与超时责任、审核原子扩展、跨实例缓存失效、第二源必要性。这里的计划不是安装、上线或科学证据质量承诺。

## 本轮执行进度

研究完成后，剩余额度足够，已落实 R01 与 R03，并完成本地完整检查。具体结果与限制见[本轮验证](Development-verification-2026-10.md)。后续优先 R02 当前外部合约复核和 R04 契约矩阵，再决定 R05/R06 设计，不把 SDK 诊断完成扩张为整个系统已完成。
