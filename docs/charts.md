# 图种：它答什么，不答什么

判据在 `src/charts.ts`（只看格子的**形状**：互斥吗、几个桶、有没有交叉表 / 重叠计数），这里是每张图的用途与边界。
**画不了的图不藏起来**：列在菜单里灰着，写明差哪个字段——用户在选图的过程中学会什么数据配什么图。

| 图种（`EvidenceChartKind`） | 需要什么 | 它答什么 | 它**不答**什么 | 出处 |
|---|---|---|---|---|
| `nodes` 主题关系 | 主题树（焦点 + 上级 + 兄弟） | 这个主题在学科树里的位置 | 主题之间谁引用谁 | — |
| `list` 被引最多的 N 篇 | 作品列表 | 这个主题下被注意最多的几篇（**示例，不代表全体**） | 这个领域长什么样 | — |
| `bar` 条形 | 1 维计数 | 哪个桶多 | 为什么多、好不好 | Cleveland & McGill 1984 |
| `timeseries` 时间序列 | 年份维 | 产出的起落 | 质量变化；**最近 1–2 年必然偏低**（索引滞后） | — |
| `waffle` 华夫 | 互斥维 + 分母 | 占分母多少 | 桶间关系。它的全部价值是逼着把分母画出来 | — |
| `treemap` 树图 | 互斥维，≥3 桶 | 层级占比 | 跨枝重叠 | Shneiderman 1992, *ACM TOG* 11(1) |
| `upset` 重叠 | 多标签维的重叠计数 | 重叠结构 | 任何百分比构成 | Lex et al. 2014, *IEEE TVCG*, 10.1109/tvcg.2014.2346248 |
| `lorenz` 洛伦兹 / 基尼 | 互斥维，桶够多 | 产出集中在几只手里 | 集中是好是坏 | Lorenz 1905 / Gini 1912 |
| `egm` 证据与缺口图 | 两维交叉表 | 哪些组合有研究、哪里是真空白 | 有研究的格子里效果好不好 | Snilstveit et al. 2016, *J Clin Epidemiol*, 10.1016/j.jclinepi.2016.05.015；White et al. 2020, *Campbell Syst Rev* 16:e1125 |
| `pie` 饼图 | 互斥维，桶不多 | 占比 | 桶多了读不出来——用条形 | — |
| `positive_rate` 阳性率 | 足够多的作者自报显著性 | 这片文献里报「显著」的比例 | **干预有没有效** | Fanelli 2010 / 2011 |
| `harvest` 收获图 | 效应**方向** | 不同分层上研究倒向哪边 | 合并效应量、显著性检验 | Ogilvie et al. 2008, *BMC Med Res Methodol* 8:8 |
| `albatross` 信天翁图 | 精确 p + 样本量 | 从 p 与 N 反推效应量的量级 | 合并估计 | Harrison et al. 2017, *RSM* 8(3), 10.1002/jrsm.1239 |
| `forest` 森林图 | 效应量 + 置信区间 | 逐研究效应与合并效应 | — | Cochrane Handbook v6.5 §10.10 |

**记录级的四张**（阳性率 / 收获 / 信天翁 / 森林）：外部数据源（OpenAlex、Semantic Scholar、PubMed、Europe PMC）实测都不带方向、精确 p、效应量，
所以只有外部格子时它们永久列着、灰着、写明差什么——这是一个**写明了条件的路标**，不是被删掉的功能。

0.2.0 起，站内文章可以由作者申报效应量、区间、样本量、精确 p 与方向（验形规则见 `intakeArticle`）。给了记录时，这四张图与证据阶梯**同一套判据**：
森林 ↔ forest 级（点估计 + 区间）、信天翁 ↔ albatross 级（方向 + 精确 p + 样本量）、收获 ↔ direction 级（方向）、
阳性率 ↔ 至少 30 篇自报了结果类型（与「比例能不能印」同一个门槛），两边不会说出矛盾的话。汇总菱形另有条件，见 `assessPooling` / `poolEvidence`。

**按形状判，不按维度名判**：判据只看形状——互斥吗（`partition`）、几个有值的桶（`buckets`）、是不是年份（`isYear`）、
在不在交叉表里（`hasCross`）、有没有这一维的重叠计数（`hasOverlap`）、有没有记录（`records`）。接入方自己的维度（比如站内的「研究类型」）
直接构一个 `ChartShape` 交给 `chartAvailabilityFor`，不必冒充某个已有维度；`chartAvailability(ctx)` 就是 `chartAvailabilityFor(chartShapeOf(ctx))`，
行为与改写前逐项相同（测试在两万多种组合上核对）。

```ts
chartAvailabilityFor({ partition: true, buckets: 4, isYear: false, hasCross: false, hasOverlap: false, onsite_n: 12 })
// 条形照画；饼 / 华夫 / 树图 / 洛伦兹 → needs_more_onsite（站内文章不到 30 篇，占比读不出可信的形状）
```

**站内篇数门槛**：格子是站内文章数出来的时候给 `onsite_n`。不到 30 篇（`MIN_ONSITE_FOR_SHARE_CHARTS`，与「比例能不能印」同一个门槛），
读占比的四张图（饼、华夫、树图、洛伦兹）回 `needs_more_onsite`；条形、时间序列、重叠、缺口图画的是篇数，照画（图注印 `small_corpus`）。
形状上的毛病（不互斥、桶太多）先报，篇数其次。

**接入方自己的样本门**：`sampleOk: false`（比如「作者自报结果类型不到 N 篇不画」这类产品规则，门槛由接入方定）⇒ 主题图与清单照常，
形状上能画的图一律回 `needs_more_onsite`，形状上本来就画不了的照报形状上的原因。

**站内层的缺口图**：外部的证据与缺口图是 机构部门 × 年份；站内层是 **标签 × 研究设计**（`crossOnsite`）——哪些话题有哪些设计的研究、哪里是空白。
每一行里没申报研究设计的篇数单独给出，不塞进任何一列。标签的用法与可信度规则见 [tags.md](tags.md)。

**记录之间的边**（`EvidenceMapData.edges`，`EvidenceEdge`）：两端都是**记录**（`EvidenceRecord.id`），不是主题——`nodes` 图画的是主题树，
「主题之间谁引用谁」仍然不答；边画在下钻层的记录之间。目前有站内引用边（`cites`：站内文章申报的参考文献 DOI 对上了图上另一条记录）
与同标签边（`shares_tag`：两篇站内文章除焦点外还共有标签，是共现不是引用），由 `buildRecordEdges` 产出、服务层随图谱下发；
外部文献之间的引用边以后再接。读者筛选（`applyEvidenceFilters`）去掉记录时，两端不全在的边随之剪掉。
