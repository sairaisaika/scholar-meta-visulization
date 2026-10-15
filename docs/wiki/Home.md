# Scholar Meta：SMV / SMT 共享 Wiki

Scholar Meta 把论文标签、可追溯的标签裁决、主题绑定与研究证据视图连成一条链：先说明论文为什么属于某个标签，再按真正具备的数据选择图形。本文档以当前代码为依据，README 只作导航参考。

## 从哪里开始

**要改代码或制定改进计划，先看[工程入口](Engineering-entry.md)**：按“外部接口 / 依赖接口 / 标签接口 / 接口规则”直接找到声明、实现、下游影响与窄测试。使用项目本身的操作说明再读下表。

| 你要做什么 | 读哪一页 |
|---|---|
| 理解两个仓库的关系和实际进度 | [项目与实现状态](Project-status.md) |
| 本地运行、接入最小服务 | [快速开始](Quick-start.md) |
| 核对六视图与实际运行边界 | [六视图](System-views.md) |
| 检查 Wiki 精细度和本轮验证范围 | [优化验收](Wiki-quality-review.md) |
| 理解模块和数据流 | [架构与数据契约](Architecture.md) |
| 给论文打标签、处理分歧 | [标签与裁决账本](Tags-and-ledger.md) |
| 判断数据能画什么 | [证据与图形规则](Evidence-and-charts.md) |
| 接服务、HTTP、客户端 | [接入与 API](Integration-and-API.md) |
| 配置、缓存、外部源预算 | [配置与外部数据](Settings-and-external-data.md) |
| 排查失败、维护文档 | [排错与维护](Troubleshooting-and-maintenance.md) |

## 共同文档的归属

共享正文只维护在 SMV 的 `docs/wiki/`，SMT 的 README 指向这一入口，避免两份正文漂移。SMV 的完整仓库名是 `scholar-meta-visulization`（沿用仓库的现有拼写），SMT 是 `scholar-meta-tags`；当前实际安装包名是 `scholar-meta`。

现有五篇专题文档继续承担深入说明：[标签方法](../tags.md)、[打标签](../tagging.md)、[架构](../architecture.md)、[接入](../integration.md)、[图种](../charts.md)。Wiki 是跨主题的使用入口，具体接口以源码和测试为准。

当前提供的是可随代码审阅的本地 Wiki 正文。GitHub Wiki 的线上启用或发布状态见[项目状态](Project-status.md)，不能把文件已写好视为线上已经发布。
