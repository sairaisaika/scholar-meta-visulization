# 给网站文刊功能开发者的交接

更新：2026-10-21。本文件仅说明通用引擎的可用接口和建议接法，不包含任何接入方代码、数据表或产品内部设计。此次没有修改网站仓，也没有替其他会话做 merge/cherry-pick。先确认本仓 CI，再在网站自己的分支按实际代码接线，勿复制整个仓库覆盖工作树。

## 现在能拿回网站的内容

| 面向对象 | 现有返回/入口 | 网站可以展示 | 不能误称 |
|---|---|---|---|
| 文刊读者 | getTagMap/getNodeMap/getCounts/getTagCounts/getTagGraph，经既有 HTTP/客户端 | 主题层级、样例文献、计数口径、站内层、出处与诚实图表能力 | OpenAlex 元数据不是全文提取，样例不是全量分布 |
| 作者/编辑 | runTagger / validateTagContribution / 标签账本 / presentWorkTags | 标签候选、模型版本、来源、争议与审核状态 | 模型置信度不是研究质量，标签不是统计结果 |
| 编辑整理文章结果 | **新增 intakeOutcomeRows → buildSynthesisTable** | 多结局表、时间/比较/单位分面、不能合并的原因、合格分面的汇总 | 未增加写入接口/持久化，也未自动从 PDF 提取数字 |
| 请求状态 | createEvidenceResultClient | HTTP 状态、受支持错误类别、Retry-After 提示 | null 不表示零文献；失败不可永久缓存 |

（2026-10-21 时的状态：SMT 仍共用 SMV 包内 tagging/ledger，没有独立服务。2026-10-31 起 SMT 是独立的公开标注平台，只发静态导出，与宿主零直接接口，见[社区标注平台](Community-annotation.md)。）新表的入口在主包 `scholar-meta`，新增配置/视图类型位于 `synthesis.ts` 的声明导出；领域 `src/types.ts` 及四类现有 HTTP 路由未变。源码候选新增功能不代表已发布新 npm 版本；按提交钉定或等维护者正式发版，再做接入方的升级验收。

## 最小接线（结构化结果已有后）

```ts
import { intakeOutcomeRows, buildSynthesisTable } from 'scholar-meta'

const extracted = intakeOutcomeRows(
  { id: 'public-report-1', title: 'Example report', study_design: 'rct' },
  [{
    id: 'function-12w',
    effect: { metric: 'md', value: 2, ci_low: 1, ci_high: 3,
      n: 80, higher_is_better: true },
    context: {
      study_id: 'verified-study-1', dependence_id: 'participants-1',
      outcome: 'function', population: 'adult', comparison: 'A-v-B',
      timepoint: '12-weeks', unit: 'instrument-X-points',
      analysis: 'unadjusted', kind: 'continuous', locator: 'Table 2, row 1',
      reviewed: true, independence_verified: true,
    },
  }],
)
const table = buildSynthesisTable(extracted.records, extracted.contexts)
// 一行不会合成；展示 table.rows / facets / counts、extracted.issues。
// table.overall 始终 null，不把多结局压成“总疗效”。
```

本例只是合成数据与接线形状；真实审核状态必须来自网站自己的鉴权与审计，而不是让未授权客户端提交 true。数字、出处、研究身份和量表编码需要实查。结果表 payload 尚未接进既有通用读口，不能直接把新表当 EvidenceMapData 去通过旧 guard；先在网站自己的编辑流程调用纯函数，接口版本与权限由网站确定。

## Claude 后续在网站仓内执行的顺序

1. 从网站自己的 AGENTS/Wiki 恢复当前分支与并行改动，先看本仓 [CHANGELOG](../../CHANGELOG.md)、[Outcome-synthesis](Outcome-synthesis.md) 和 API 声明；不替换 types.ts 或自动拉取远端 main 覆盖未提交工作。
2. 找现有公开文章读取、作者/编辑身份、标签结果与文章版本的接缝。复用现有存储/路由，不凭本文件猜站点路径。公开文章、待审核结果和私有提取原文分别处理权限。
3. 先接现有标签候选/账本展示，再接结构化结果编辑与来源定位：保留原始输入、提取器/模型/提示版本、文件/表格/段落、审核结论、修改历史。允许缺失与拒绝，不用 0 补数字。
4. 同一报告拆多个稳定结果 ID，明确研究/受试者依赖群；预印本/发表版、综述/原始研究重叠和同一 cohort 的多篇报告先去重。标签可辅助召回，不能自动认定同构念或独立性。
5. 编辑预览新表：报告数≠研究数≠结果数，分面显示单位/时间/对照/调整。先展示逐项证据和缺口；合成只在明确的审核与独立性条件下开启，保留拒绝原因。复合值可展开组成和公式，当前不运算。
6. 用网站实际持久化、鉴权与浏览器流程验收，记录保存后重读、权限隔离、版本/删除/撤稿联动、上游失败和缓存行为；再考虑公开阅读页。网站运行证据与测试回执留在网站仓。

## 必须向维护者报告的验收

- 真实文章保存后重读能对回原文数值、单位和定位；作者不能伪装编辑审核；私有/撤稿数据不可进入公开合成。
- 一篇两结局是两行而不是两项独立研究；同一受试者群的重复报告/共享对照不增加权重；缺字段只降级，不产生假汇总。
- 五项合成测试研究、两个结局能各自出分面汇总；切换共享参与者后两个分面都阻止合并。不同单位/人群/比较/时间/调整模型分开；复合指标保留组成但没有总分。
- 标签模型失败/不确定/争议、外部源 null/空/partial、503/429 与缓存故障在页面上有不同可解释状态。

完整结构化提取、模型准确率、协方差模型、真实网站安装/部署与公开发布尚未由本轮证明。不要只凭本仓 CI 绿就声明网站功能已上线。

可复核实现提交：`0e3b9014a556b1f90c43c85f292c1c03bcdb2cf8`，远程check/live成功，详见[结束回执](Development-verification-2026-10.md)。可先看[在线合成数据演示](https://sairaisaika.github.io/scholar-meta-visulization/synthesis.html)，再在网站自己的工作分支完成接线；不要把本演示当真实文刊数据。
