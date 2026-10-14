# 证据与图形规则

## 阶梯按可用记录选层

`pickEvidenceView` 从强到弱选第一个可用层。判定用符合字段要求的子集，返回 `usable`、`total` 与相邻上一层的降级原因。应显示多少记录实际参与，不能暗示所有记录都有定量效应。

| 层 | 单条所需字段 | 最少可用条数 |
|---|---|---|
| forest | 有限点估计、有限 CI 两端 | 1 |
| estimates | 点估计 | 1 |
| albatross | favours/against/unclear 方向、p ∈ (0,1]、n > 0 | 2 |
| direction | favours/against/unclear 方向 | 1 |
| gap_map | 没有定量要求 | 0 |

必须先过文章验形，不能把阶梯判据当完整输入校验。被引次数不属于效应量；“显著/不显著”不构成阶梯的定量合成层。

## 森林图不等于可以汇总

`assessPooling` 只检查具有点估计的记录子集：度量相同且有支持的分析变换；每条 `higher_is_better` 已给且一致；研究设计字段一致；所有这类记录有区间；至少 5 条。

当前代码将所有缺失的研究设计视为同一“未知”设计，且不检查研究对象、对照、结局定义、时间点是否一致。这是软件门槛的实际边界，宿主需要另外审核科学可比性，不能把 `allowed` 表述为系统完成了专家评审。

`poolEvidence` 使用区间反推标准误、REML + HKSJ 随机效应与预测区间。有高偏倚风险记录时另给剔除它们的敏感性分析；未评级不等于低风险。即使 allowed 为 true，数值变换仍可能产生 `estimate: null`，只有实际 estimate 存在时才能画汇总菱形。

## 图种菜单是另一套判定

`chartAvailabilityFor` 判 14 种图，返回不能画的 blocker。不是 14 种现成 UI 组件。

| 图种 | 主要门槛 |
|---|---|
| nodes / list | 不依赖计数维度，也不受 sampleOk 门限制 |
| bar | 至少一个有值桶 |
| timeseries | 年份维度 |
| waffle / pie | 互斥划分、有值桶；pie 最多 8 个有值桶 |
| treemap | 互斥划分、至少 3 个有值桶 |
| lorenz | 互斥划分、至少 5 个有值桶 |
| upset | 有该维的重叠计数 |
| egm | 有对应维度交叉表 |
| positive_rate | 至少 30 条作者申报 significant/non_significant/mixed |
| harvest / albatross / forest | 对应阶梯的记录门槛 |

站内 `onsite_n < 30` 时，pie、waffle、treemap、lorenz 的比例图被阻止。`sampleOk: false` 是额外样本门；形状本来有问题时优先返回形状原因。

`positive_rate` 是自报结果描述，不能宣称疗效或充当按显著性投票的证据合成。计数百分比只用该维声明的分母；`MIN_N_FOR_SHARE = 30`，小分母只展示数量，允许展示比例时提供 Wilson 区间。

## 出处和质量

站内与外部层各自说明分母、范围、来源与许可。外部作品默认是被引最多的示例，不是随机样本，不应用其比例描述整个主题。

偏倚风险、GRADE 确定性由编辑或外部综述提供，引擎验形和展示，不自动评级。文章参考文献可以申报引用用途；共现边表示同标签出现，引用边表示 DOI 对应的参考关系，二者不能混用。

本页描述程序行为，不新增方法学背书。已有方法依据见[标签方法专题](../tags.md)与[图种专题](../charts.md)；实现见 [ladder.ts](../../src/ladder.ts)、[charts.ts](../../src/charts.ts)、[stats.ts](../../src/stats.ts)。
