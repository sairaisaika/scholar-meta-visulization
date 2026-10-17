# 项目与实现状态

核对日期：2026-10-14。代码基线：SMV `9e1899a50864032141fb4b95445715cf2473d583`；SMT `cb9780603d1059ee9187ba9d3d3b4a80b6805cec`。以下是这两个本地检出的状态，不代表未来版本。

## 两个仓库，一份使用文档

| 名称 | 当前检出实际内容 | 当前使用方式 |
|---|---|---|
| SMV | TypeScript 引擎、标签与账本、OpenAlex 适配器、服务/HTTP/客户端、演示、测试及专题文档 | 实际实现和共享 Wiki 正文所在仓库 |
| SMT | 核对时只有标题 README 与 MIT LICENSE，没有源码、包清单、测试或服务 | 保留独立仓库，以共享 Wiki 解释标签能力与整体关系 |

SMT 的名称对应标签方向，但不能据此宣称它已经提供独立标签服务或安装包。当前标签能力来自 SMV 的 `src/tags.ts`、`src/tagging.ts`、`src/ledger.ts`。独立仓库关系不等于已实现包间依赖；当前 `package.json` 没有 SMT 依赖。后续如拆出标签包，应先确定公共契约、发布与迁移路径，再更新此页。

## 已实现与需宿主实现的部分

| 能力 | 代码证据 | 边界 |
|---|---|---|
| 标签归一、别名组、主题绑定 | `src/tags.ts` | 不自动翻译或理解同义词 |
| 可替换模型端口、词表基线、贡献包验形 | `src/tagging.ts` | 没有内置第三方大模型服务 |
| 断言裁决、修改申请、审核、撤回 | `src/ledger.ts` | 账号、权限、持久化、审核 UI 由宿主提供 |
| 文章验形、审阅门槛、站内计数、共现与引用边 | `src/onsite.ts` | 不替宿主认证专家身份 |
| 证据阶梯、汇总统计、图种可用性、视图模型 | `src/ladder.ts`、`src/stats.ts`、`src/charts.ts`、`src/present.ts` | 不是通用图表组件库；前端负责绘制 |
| 外部分类树、示例作品、分组计数 | `src/openalex.ts`、`src/openalex-counts.ts` | 当前适配器是 OpenAlex，不是所有类型中声明来源的完整实现 |
| 无框架服务、四个 HTTP 读口、客户端 | `src/service.ts`、`src/http.ts`、`src/client.ts` | 编辑写操作不通过公共读口提供 |
| 插件设置、清单、中文/英文展示文案 | `src/settings.ts`、`src/manifest.ts`、`src/messages.ts` | 没有随包提供完整插件管理后台 |

包版本与证据契约版本在此基线均为 `0.5.0`，分别取自 `package.json` 与 `src/types.ts`。此页没有核实远端 Release 或 npm 是否已发布该版本。

## Wiki 原有进度

SMV 原有 `docs/architecture.md`、`charts.md`、`integration.md`、`tagging.md`、`tags.md`，已超过只有 README 的阶段；SMT 原有本地文档确实只有标题。

对两仓的 `.wiki.git` 执行远端只读查询均返回 `Repository not found`。这只能证明当前查询未能读取 Wiki，可能涉及未初始化或权限，不能证明线上没有任何页面。本次新增的是共享 Markdown Wiki；未发布 GitHub Wiki。

## 阅读 README 时需要补足的细节

- 信天翁图至少两条记录同时具有方向、精确 p 和正样本量，只有一条不会选中这一层。
- 阶梯选择看各层可用的记录子集，不要求输入每一条都满足该层；输出的 `usable` 与 `total` 都应展示。
- 汇总检查的是具有点估计的子集；所有研究设计都缺失时也视为同一“未知”设计。通过程序门槛不等于研究问题已被证明可以科学合并。
- `allowed: true` 后数值变换仍可能失败，`estimate` 可以为 `null`，UI 不能据此画菱形。
- `positive_rate` 在图种注册表中真实存在，但只呈现作者自报结果比例，不能当作证据合成。
- 外部预算是客户端实例内按 UTC 日累计；不是分布式账户总预算，也不能保证并发请求完全不超支。
- 适配器直接不传预算时不限额；设置注册表的 5000 缺省值不能替代给适配器实际接入预算。

这些判断来自实现函数；详见相应 Wiki 页的源码依据。

## 2026-10-17 工程推进

当前源码新增结果式客户端（旧 data/null 保留），并修正 Windows 安装包验收；这不表示版本或部署已发布。研究与优先级见[工程研究](Engineering-research-2026-10.md)，逐项退出证据和剩余工作见[TODO](TODO.md)。SMT 仍不另起一套实现。
