/**
 * 证据视图契约（研究图谱的**归一化层**）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 【它解决的是哪一类问题】按一个标签看相关研究：像森林图那样摆出证据，不只看一个站点自己的文章；
 * 缩小一级，标签变成主题节点，再缩小是上级学科；节点可拖动、可筛选，能换不同维度看同一批数据。
 *
 * 这里定义的不是「一张图」，而是三个**变化点**的契约：
 *   ① 数据从哪来（`EvidenceSourceId` + `EvidenceRecord`）——加一个文献源 = 加一个适配器，记录形状不变；
 *   ② 按什么尺度聚合（`EvidenceScaleLevel`）——主题树换成 MeSH 只是换一份阶梯实现；
 *   ③ 用什么图画（`EvidenceViewKind`）——**视图由数据能力决定，不是 UI 选项**（见下）。
 *
 * 【为什么视图必须由数据决定】外部四个源实测（2026-09-22，OpenAlex / Semantic Scholar / PubMed / Europe PMC+Crossref）
 * **一个都不带效应量、置信区间、样本量**：S2 显式请求 effectSize/sampleSize 直接 400；PubMed 94 个 XML 元素名里零个效应量字段，
 * 从 meta-analysis 摘要正则抽「点估计+95%CI」只有约 30% 能抽到，RCT 只有约 6%，且抽到的 SMD / OR / 患病率**不可通约**。
 * 于是只有两条路：要么拿被引数冒充效应量画一张长得像 forest plot 的图（在面向公众的健康内容里，这是把文献计量伪装成证据综合，
 * 会影响读者的健康决策），要么**按手上真有什么，画到哪一级就说到哪一级**。本契约选后者，并把这条规则钉成类型。
 *
 * 【方法学出处】Cochrane Handbook v6.5 ch.12「无法做 meta 分析时的合成与呈现」Table 12.2.a（降级阶梯）·
 * ch.10.10（森林图与汇总菱形的前提）· SWiM 报告规范（BMJ 2020;368:l6890）Table 2「各合成方法所需最小数据」·
 * ASA 2016 p 值六原则 · PRISMA 2020 item 10a/12/13c。逐条对应见 `src/ladder.ts`。
 *
 * 【契约纪律】本文件自包含、零导入，宿主可以整份拷走当自己的线上契约（建议在宿主仓用一条 CI 检查保证拷贝与本文件逐字节相同）；
 * 形状只做加法（加可选字段 / 加联合成员），不改不删。真源是本仓的 `src/types.ts`。
 * 唯一一次例外：0.2.0 把站内来源的 id 从某个具体站点的名字改成了中性的 `'onsite'`——开源引擎不该带着任何宿主的名字。
 */

/**
 * 契约版本：本文件最近一次变化随的那个包版本。接入方拷贝本文件时据此核对（CHANGELOG 里必须有这一版的一节，
 * 破坏性改动写在那一节的「破坏性」下）。改本文件时把它改成将要发布的版本号（见 CONTRIBUTING.md 第三节）。
 */
export const EVIDENCE_CONTRACT_VERSION = '0.3.0'

/** 文献来源。站内文章与站外文献在本层**同形**——这正是「加一个源 = 加一行」的前提。`onsite` = 宿主自己的文章（任何站点）。 */
export type EvidenceSourceId =
  | 'onsite'
  | 'openalex'
  | 'semantic_scholar'
  | 'pubmed'
  | 'europe_pmc'
  | 'crossref'

/**
 * 主题尺度阶梯。当前实现取 OpenAlex 的真四级（2026-09-22 实测：domains 4 · fields 26 · subfields 252 · topics 4516；
 * ADHD 的真实路径是 Health Sciences → Medicine → **Psychiatry and Mental health** → Attention Deficit Hyperactivity Disorder，
 * 注意它挂在 Medicine 不是 Psychology——「心理学方向的子主题」在 OpenAlex 里对应的是 subfield 2738）。
 * `tag` 是站内自由文本标签，是这条阶梯的**第 0 级入口**，不属于外部分类树。
 */
export type EvidenceScaleLevel = 'tag' | 'topic' | 'subfield' | 'field' | 'domain'

/** 从细到粗；缩小按钮就是沿这条数组往右走一格。 */
export const EVIDENCE_SCALE_LADDER: readonly EvidenceScaleLevel[] = ['tag', 'topic', 'subfield', 'field', 'domain']

/**
 * 效应量的度量口径。混排不同度量在同一根轴上是方法学错误（Cochrane 10.4）——
 * 所以它是**记录的一部分**，视图据它决定能不能同框。
 */
export type EvidenceEffectMetric =
  | 'smd' | 'md' | 'hedges_g' | 'cohens_d'
  | 'or' | 'rr' | 'hr'
  | 'r' | 'prevalence' | 'other'
export const EVIDENCE_EFFECT_METRICS = [
  'smd', 'md', 'hedges_g', 'cohens_d', 'or', 'rr', 'hr', 'r', 'prevalence', 'other',
] as const satisfies readonly EvidenceEffectMetric[]

export interface EvidenceEffect {
  /** 效应量度量。只有精确 p 与样本量时也要写：信天翁图的等效应线按它画 */
  metric: EvidenceEffectMetric
  /**
   * 点估计；`null` ⇒ 没有点估计（只申报了精确 p 与样本量：能进 albatross 级，进不了 estimates / forest 级）。
   * 0.3.0 起可以是 `null`（此前这种情况只能写 `NaN`，而 `NaN` 经过 JSON 就成了 `null`，类型对不上）；引擎把 `NaN` 也当作没有。
   */
  value: number | null
  /** 95% CI 下界 / 上界；缺一即「有点估计无方差」，只能降到 estimates 级（Cochrane 12.2.1.1）。 */
  ci_low: number | null
  ci_high: number | null
  /** 样本量：forest 图里的方块大小；也是 albatross 级的必需项。 */
  n: number | null
  /** 数值大＝更好还是更坏。决定森林图左右两侧写「favours 谁」（PRISMA item 10a）。 */
  higher_is_better: boolean | null
  /**
   * 精确 p 值（0 < p ≤ 1）。信天翁图（Harrison 2017）要的是**精确** p，不是「p < .05」这种阈值——
   * 只有阈值时留 null（0.2.0 加法；旧记录不带即视为 null）。
   */
  p_value?: number | null
}

/**
 * 结果**方向**。Cochrane 12.2.2.1 判定传统「显著/不显著」投票计数无效
 * （「underpowered studies that do not rule out clinically important effects are counted as not showing benefit」，
 * 且「as the number of studies increases, the power of conventional vote counting tends to zero」），
 * 可用的替代是按**方向**计数。故本字段与下面的「作者自报显著性」是两个字段，不可互相冒充。
 */
export type EvidenceDirection = 'favours' | 'against' | 'unclear' | 'not_applicable'
export const EVIDENCE_DIRECTIONS = ['favours', 'against', 'unclear', 'not_applicable'] as const satisfies readonly EvidenceDirection[]

/** 站内作者自报的结果类型（宿主文章表里作者自己勾的那一栏）。**不是**效应量，也不是方向。 */
export type EvidenceSelfReportedClaim = 'significant' | 'non_significant' | 'mixed' | 'not_applicable'
export const EVIDENCE_SELF_REPORTED_CLAIMS = ['significant', 'non_significant', 'mixed', 'not_applicable'] as const satisfies readonly EvidenceSelfReportedClaim[]

/** 这条记录哪来的、什么许可、什么时候取的——图谱脚注按源逐条印（读者有权知道每个数字从哪来）。 */
export interface EvidenceProvenance {
  source_label: string
  license: string
  /** ISO 时间串 */
  retrieved_at: string
}

// ── 偏倚风险（0.3.0 加法）────────────────────────────────────────────────────────────
// 引擎**不评**偏倚风险：由接入方的编辑或外部系统综述评好传进来，引擎只核形状、如实转述（带上是谁评的），
// 并只在两处按成文的规则用它：图上逐项标出；汇总时另给一个去掉高风险研究的敏感性分析（主分析不变）。

/**
 * 偏倚风险工具：`rob2` 随机试验（Sterne et al. 2019, *BMJ* 366:l4898, doi:10.1136/bmj.l4898）·
 * `robins_i` 干预的非随机研究（Sterne et al. 2016, *BMJ* 355:i4919, doi:10.1136/bmj.i4919）·
 * `other` 别的工具，总体判断折成 low / some_concerns / high / unclear 四档。
 */
export const EVIDENCE_ROB_TOOLS = ['rob2', 'robins_i', 'other'] as const
export type EvidenceRobTool = (typeof EVIDENCE_ROB_TOOLS)[number]

/** 总体判断的全部取值；每种工具只认自己那几档（`EVIDENCE_ROB_SCALES`）。 */
export const EVIDENCE_ROB_JUDGEMENTS = ['low', 'some_concerns', 'high', 'moderate', 'serious', 'critical', 'no_information', 'unclear'] as const
export type EvidenceRobJudgement = (typeof EVIDENCE_ROB_JUDGEMENTS)[number]

/** 每种工具的总体判断档位，按风险从低到高；「信息不足」「不清楚」放最后。 */
export const EVIDENCE_ROB_SCALES: { readonly [T in EvidenceRobTool]: readonly EvidenceRobJudgement[] } = {
  rob2: ['low', 'some_concerns', 'high'],
  robins_i: ['low', 'moderate', 'serious', 'critical', 'no_information'],
  other: ['low', 'some_concerns', 'high', 'unclear'],
}

/** 一项研究的偏倚风险（工具的总体判断）。 */
export interface EvidenceRiskOfBias {
  tool: EvidenceRobTool
  /** 必须是这种工具的档位之一 */
  overall: EvidenceRobJudgement
  /** 谁评的（「本站编辑」「某篇系统综述」……）。必填：读者有权知道这个判断从哪来 */
  source: string
}

/** 归一化的一条「证据」。站内文章与站外文献都落这个形状。 */
export interface EvidenceRecord {
  /** `<source>:<external_id>`，全局唯一 */
  id: string
  source: EvidenceSourceId
  external_id: string
  title: string
  year: number | null
  authors: string[]
  doi: string | null
  url: string | null
  /** 归属的主题节点 id（`<source>:<external_id>` 形，见 EvidenceTopic） */
  topic_ids: string[]
  /**
   * 研究设计（RCT / meta-analysis / 观察性…）——分层与同框判据要用。
   * ⚠️ 外部源（OpenAlex）**恒为 null**：它的 `type` 是出版物形态（article / dissertation / preprint…），RCT 与横断面在那里
   * 都叫 article，不许映射进来（设计红线：出版物形态 ≠ 研究设计；2026-09-23 前 openalex.ts 就是这么错写的）。
   */
  study_type: string | null
  /** 出版物形态（OpenAlex `type`：article / dissertation / book-chapter / preprint…）。**不是研究设计**，与 study_type 物理隔开（2026-09-23 加法）。 */
  publication_type?: string | null
  self_reported_claim: EvidenceSelfReportedClaim | null
  direction: EvidenceDirection | null
  effect: EvidenceEffect | null
  /**
   * 被引数。**永不作为效应量轴**（见 `NEVER_AS_EFFECT_AXIS`）：它衡量的是注意力不是效应，
   * 拿它当 x 轴就是把文献计量伪装成证据综合。只允许当节点大小/排序的次要维度，且必须标注。
   */
  cited_by_count: number | null
  is_retracted: boolean
  is_open_access: boolean | null
  provenance: EvidenceProvenance
  /**
   * 站内记录身上的标签（**原文**，未归一；0.2.0 加法）。标签层（`src/tags.ts`）据此算别名组与共现图；外部记录不带。
   */
  tags?: string[]
  /**
   * 偏倚风险（0.3.0 加法）：编辑或外部综述评好的总体判断，引擎不评。外部源恒不带。
   * 缺省 / null ＝ 没评过：图上标「未评估」，**不当成低风险**。
   */
  risk_of_bias?: EvidenceRiskOfBias | null
}

/**
 * 站内文章可以申报的研究设计（封闭词表，0.2.0 加法）。`EvidenceRecord.study_type` 仍是字符串（外部源恒为 null），
 * 站内记录经 `intakeArticle` 验过之后只会是下面之一。词表借 Cochrane Handbook ch.24 / ch.25 的设计分类，粒度够分层用即可。
 */
export const EVIDENCE_STUDY_DESIGNS = [
  'rct', 'non_randomised_controlled', 'cohort', 'case_control', 'cross_sectional', 'case_series',
  'qualitative', 'mixed_methods', 'systematic_review', 'meta_analysis', 'narrative_review', 'other',
] as const
export type EvidenceStudyDesign = (typeof EVIDENCE_STUDY_DESIGNS)[number]

/** 主题树节点（缩放阶梯上的一颗球）。 */
export interface EvidenceTopic {
  /** `<source>:<external_id>` */
  id: string
  source: EvidenceSourceId
  external_id: string
  level: EvidenceScaleLevel
  display_name: string
  description: string | null
  parent_id: string | null
  /** 该主题下的作品总数（外部源给的全量口径，不是我们抓到的那几条） */
  works_count: number | null
}

/**
 * 记录之间的边（2026-09-28 加法）。`from` / `to` 都是 `EvidenceRecord.id`（`<source>:<external_id>` 形）。
 * · `cites`：from 引用了 to。目前只有**站内**引用边（消费方的文章引用表）；外部引用边（OpenAlex `referenced_works`）以后再接；
 * · `shares_tag`：两条记录挂同一个站内标签——是共现，不是引用、不是合作。
 * 边只表达「有关系」，不表达支持 / 反对：证据方向仍只看 `EvidenceRecord.direction`。
 */
export interface EvidenceEdge {
  from: string
  to: string
  kind: 'cites' | 'shares_tag'
}

/**
 * 诚实降级阶梯（Cochrane Table 12.2.a + SWiM Table 2）。从上到下，能画的越来越弱；
 * 框架取**手上数据支持的最高一级**，并把「为什么没到更高一级」显示出来。
 */
export type EvidenceViewKind =
  /** 点估计 + 方差/CI ⇒ 真森林图（汇总菱形另有前提，见 EvidencePooling） */
  | 'forest'
  /** 只有点估计、没有方差 ⇒ 中位数/IQR 点线图，**不画菱形**（12.2.1.1） */
  | 'estimates'
  /** 方向 + 精确 P + 总样本量 ⇒ albatross plot / 合并 P（12.2.1.2–12.2.1.3） */
  | 'albatross'
  /** 只有方向 ⇒ harvest plot / effect direction plot（Ogilvie 2008 / Thomson 2013） */
  | 'direction'
  /** 什么定量都没有 ⇒ 证据缺口图：只诚实回答「这个主题上有没有研究、有多少、什么设计」 */
  | 'gap_map'

/** 视图在阶梯上的次序（越靠前越强）。 */
export const EVIDENCE_VIEW_LADDER: readonly EvidenceViewKind[] = ['forest', 'estimates', 'albatross', 'direction', 'gap_map']

/**
 * **永远不许当效应量轴的量**。这条是产品立场，不是实现细节：
 * 把被引 / 影响因子 / FWCI 放上 x 轴，图会长得像 forest plot 而语义完全不是。
 * 有测试钉着任何视图的 x 轴取值不得落在本表内。
 */
export const NEVER_AS_EFFECT_AXIS: readonly string[] = [
  'cited_by_count', 'citation_count', 'influential_citation_count', 'fwci', 'impact_factor', 'h_index', 'altmetric',
]

/** 一次视图选择的结论：用哪一级、为什么不是更高的那一级、哪些记录进不了图。 */
export interface EvidenceViewDecision {
  kind: EvidenceViewKind
  /** 满足该视图要求的记录数 */
  usable: number
  /** 总记录数 */
  total: number
  /**
   * 没能用更高一级的原因键（界面文案由消费方按键查词典）。
   * `null` = 已经是最高一级。
   */
  downgrade_reason: EvidenceDowngradeReason | null
}

export type EvidenceDowngradeReason =
  /** 一条效应量都没有（外部四源实测都不带） */
  | 'no_effect_sizes'
  /** 有点估计但没有置信区间/方差 */
  | 'no_variance'
  /** 有方向但没有精确 P 或样本量 */
  | 'no_p_or_n'
  /** 连方向都没有（站内只有作者自报的显著性，而按显著性投票计数方法学上无效） */
  | 'no_direction'
  /** 记录太少，画出来会误导 */
  | 'too_few'
export const EVIDENCE_DOWNGRADE_REASONS = [
  'no_effect_sizes', 'no_variance', 'no_p_or_n', 'no_direction', 'too_few',
] as const satisfies readonly EvidenceDowngradeReason[]

/**
 * 能不能画汇总菱形（pooling）。默认**不能**——Cochrane 10.10.2：同一效应量、同一对比、同一结局方向才允许汇总；
 * 10.10.4.3：预测区间建议研究数 ≥5。本类型让「不能」带着理由出现在 UI 上，而不是悄悄不画。
 */
export interface EvidencePooling {
  allowed: boolean
  reason: EvidencePoolingReason
  /** allowed 时参与汇总的记录数 */
  studies: number
  /**
   * 汇总估计（0.2.0 加法）。只有 `allowed` 时才可能有值，由 `poolEvidence` 算：REML 估 τ²、HKSJ 置信区间、
   * t(k−2) 预测区间（Cochrane Handbook v6.5 §10.10.4；Higgins, Thompson & Spiegelhalter 2009）。
   * 旧服务端不下发时 UI 不画菱形。
   */
  estimate?: EvidencePooledEstimate | null
  /**
   * 敏感性分析（0.3.0 加法）：去掉偏倚风险高的研究后重新判、重新算（见 `EvidencePoolingSensitivity`）。
   * 只在主分析能汇总、且参与汇总的研究里至少有一项高风险时下发；其他情况不下发或为 null。
   */
  sensitivity?: EvidencePoolingSensitivity | null
}

/**
 * 去掉偏倚风险高的研究（RoB 2「high」、ROBINS-I「serious」「critical」、其他工具「high」）之后的汇总判定与估计。
 * 主分析不变：这是 Cochrane Handbook v6.5 §10.14（敏感性分析）举的做法——看结论靠不靠得住高风险研究。
 * 剩下的研究同样要过汇总的全部门槛（同一度量、同一方向、同类设计、至少 5 项），过不了就只给理由、不给数。
 */
export interface EvidencePoolingSensitivity {
  /** 去掉了几项 */
  excluded: number
  allowed: boolean
  reason: EvidencePoolingReason
  studies: number
  estimate: EvidencePooledEstimate | null
}

/**
 * 不能汇总的理由。0.2.0 加了两条（Cochrane 10.10.2「同一结局方向」、ch.24「随机与非随机研究一般不合并」）：
 * `orientation_unclear` 数值大＝好还是坏没申报齐，或者互相矛盾 · `mixed_designs` 研究设计不一致。
 */
export type EvidencePoolingReason =
  | 'ok' | 'mixed_metrics' | 'too_few_studies' | 'no_variance' | 'not_applicable'
  | 'orientation_unclear' | 'mixed_designs'
export const EVIDENCE_POOLING_REASONS = [
  'ok', 'mixed_metrics', 'too_few_studies', 'no_variance', 'not_applicable', 'orientation_unclear', 'mixed_designs',
] as const satisfies readonly EvidencePoolingReason[]

/** 汇总估计。比值类度量（OR / RR / HR）在对数尺度上算，**回报时已取指数**回到原尺度。 */
export interface EvidencePooledEstimate {
  method: 'reml_hksj'
  metric: EvidenceEffectMetric
  /** 参与汇总的研究数 */
  k: number
  estimate: number
  ci_low: number
  ci_high: number
  /** 95% 预测区间：下一项同类研究的真实效应大概落在哪（比置信区间宽，这正是它的意义） */
  pi_low: number
  pi_high: number
  /** 研究间方差（分析尺度上） */
  tau2: number
  /** I²（0–1）：观察到的变异里有多少不是抽样误差（Higgins & Thompson 2002） */
  i2: number
  /** Cochran's Q 与自由度 */
  q: number
  df: number
}

/** 研究图谱读口的响应体（尺度 + 记录 + 视图结论 + 脚注来源）。 */
export interface EvidenceMapData {
  /** 当前尺度与它在阶梯上的位置 */
  level: EvidenceScaleLevel
  /** 当前焦点节点（tag 级时 external_id 就是 tag 本身） */
  focus: EvidenceTopic | null
  /** 焦点的上级（缩小一格去哪儿）；null = 已到顶 */
  parent: EvidenceTopic | null
  /** 同级兄弟（缩小后画成球的那一圈） */
  siblings: EvidenceTopic[]
  /** 当前尺度下的证据记录 */
  records: EvidenceRecord[]
  view: EvidenceViewDecision
  pooling: EvidencePooling
  /** 本次结果用到的来源与许可（脚注逐条印） */
  sources: EvidenceProvenance[]
  /** 外部层没接上时为 true：UI 必须说明「只有站内」，不许假装这就是全部 */
  onsite_only: boolean
  /**
   * 外部层怎么了（2026-09-25 加法）：`matched` 配上了 · `no_match` 问到了、这个标签在外部库没有对应主题（中文标签的常态，
   * 标签语言不分类、不翻译）· `unavailable` 这次没问成（网络 / 外部源出错），稍后再试 · `not_queried` 没去问（标签还没出现在任何公开文章里，
   * 防滥用闸不放行）。UI 据此说不同的话。旧服务端不下发时按 onsite_only 兜底。
   */
  external_match?: EvidenceExternalMatch
  /** tag 级：标签是怎么到外部主题的（人绑 / 机器猜 / 被否决）；其他级或没有绑定时为 null 或不下发（0.2.0 加法） */
  binding?: EvidenceTagBinding | null
  /**
   * 记录之间的边（2026-09-28 加法）：站内引用边 + 同标签边，两端都在 `records` 里（焦点节点 id 也允许出现在一端）。
   * 筛掉记录时边随之剪掉（`applyEvidenceFilters`）。缺省 = 消费方还没接边，UI 只画点不画线。
   */
  edges?: EvidenceEdge[]
  /**
   * 证据确定性评级（0.3.0 加法）：接入方的编辑或外部综述按结局评好的 GRADE 等级，引擎不评。
   * 不下发 ＝ 没接评级；`[]` ＝ 这个范围没有评级；`null` ＝ 这次没取到（**不是**「没有评级」）。
   */
  certainty?: EvidenceCertainty[] | null
}

// ── 证据确定性（0.3.0 加法）──────────────────────────────────────────────────────────
// GRADE（Guyatt et al. 2011, *J Clin Epidemiol* 64(4):383–394, doi:10.1016/j.jclinepi.2010.04.026）：
// 对**一个结局**的一组证据评四档；随机试验起点高、观察性研究起点低，按五个方面降级、三个理由升级。引擎不评，只转述。

/** 四档（各档的含义见 Balshem et al. 2011, *J Clin Epidemiol* 64(4):401–406, doi:10.1016/j.jclinepi.2010.07.015）。 */
export const EVIDENCE_CERTAINTY_LEVELS = ['high', 'moderate', 'low', 'very_low'] as const
export type EvidenceCertaintyLevel = (typeof EVIDENCE_CERTAINTY_LEVELS)[number]

/** 降级的五个方面：偏倚风险、不一致、间接、不精确、发表偏倚。 */
export const EVIDENCE_CERTAINTY_DOWNGRADES = ['risk_of_bias', 'inconsistency', 'indirectness', 'imprecision', 'publication_bias'] as const
export type EvidenceCertaintyDowngrade = (typeof EVIDENCE_CERTAINTY_DOWNGRADES)[number]

/** 升级的三个理由（Guyatt et al. 2011, *J Clin Epidemiol* 64(12):1311–1316, doi:10.1016/j.jclinepi.2011.06.004）：效应大、剂量反应、可能的混杂只会削弱所见效应。 */
export const EVIDENCE_CERTAINTY_UPGRADES = ['large_effect', 'dose_response', 'plausible_confounding'] as const
export type EvidenceCertaintyUpgrade = (typeof EVIDENCE_CERTAINTY_UPGRADES)[number]

/** 一条证据确定性评级。 */
export interface EvidenceCertainty {
  level: EvidenceCertaintyLevel
  /** 评的是哪个结局（GRADE 按结局评，不按整个话题）。必填 */
  outcome: string
  /** 谁评的（「本站编辑」「某篇系统综述的结果汇总表」……）。必填 */
  source: string
  /** 评级出处的链接（只收 http / https） */
  url?: string | null
  /** 因为哪些方面降了级 */
  rated_down_for?: EvidenceCertaintyDowngrade[]
  /** 因为哪些理由升了级 */
  rated_up_for?: EvidenceCertaintyUpgrade[]
}

export type EvidenceExternalMatch = 'matched' | 'no_match' | 'unavailable' | 'not_queried' | 'needs_review'
/** 0.2.0 加了 `needs_review`：外部库里有候选主题，但机器匹配不够可靠（`exact_only` 策略下只有同名才自动绑），等编辑确认。 */
export const EVIDENCE_EXTERNAL_MATCHES = ['matched', 'no_match', 'unavailable', 'not_queried', 'needs_review'] as const satisfies readonly EvidenceExternalMatch[]

// ── 标签层：标签怎么变成主题（0.2.0 加法）──────────────────────────────────────────────
// 站内标签是自由文本（folksonomy：同义、多义、大小写与全半角变体、语言混排，Golder & Huberman 2006）。
// 引擎不翻译、不按语言分类；标签到外部主题的对应是一条**带出处的绑定**，图注必须印出它是人绑的还是机器猜的。

/** 绑定是谁定的：`curated` 编辑人工确认 · `machine` 自动补全命中 · `rejected` 编辑确认「没有对应主题」（否决机器命中）。 */
export type EvidenceTagBindingKind = 'curated' | 'machine' | 'rejected'
export const EVIDENCE_TAG_BINDING_KINDS = ['curated', 'machine', 'rejected'] as const satisfies readonly EvidenceTagBindingKind[]

/** 机器绑定的可信度：`exact` 主题名归一后与标签键逐字相同 · `first_hit` 只是自动补全的第一条（候选生成，不是消歧）。 */
export type EvidenceTagBindingConfidence = 'exact' | 'first_hit'

export interface EvidenceTagBinding {
  /** 归一化后的标签键（见 `normalizeTag`），不是原文 */
  tag_key: string
  /** 绑到的主题 `<source>:<external_id>`；`rejected` 时为 null */
  topic_id: string | null
  /** 绑到的主题显示名（外部源给的原文）；`rejected` 时为 null */
  topic_name: string | null
  kind: EvidenceTagBindingKind
  /** 只有 `machine` 有值 */
  confidence: EvidenceTagBindingConfidence | null
  /** ISO 时间串 */
  bound_at: string
  /** 谁绑的（宿主给的编辑标识，别放个人信息）；机器绑定为 null */
  bound_by: string | null
  note: string | null
}

/**
 * 编辑的待办队列（`bindingQueue` 产出）：公开文章里出现过、还没有编辑结论（确认或否决）的标签，按文章数从多到少。
 * 编辑从这里挑标签去确认——这是「机器猜的绑定」变成「有人负责的绑定」的入口（0.2.0 加法）。
 */
export interface EvidenceBindingQueueItem {
  tag_key: string
  /** 别名组里最常见的原文写法 */
  label: string
  /** 带这个标签的公开文章数 */
  articles: number
  /** 读者现在在这个标签页上看到的外部层状态 */
  external_match: EvidenceExternalMatch
  /** 读者现在看到的机器绑定（策略放行时）；没有为 null */
  binding: EvidenceTagBinding | null
  /** 外部源自动补全的第一条候选（`exact_only` 策略下没放行的也列出来）；没有为 null */
  candidate: { topic_id: string; display_name: string } | null
}

/**
 * 给编辑看的绑定候选（`suggestBindings` 产出，编辑确认后变成 `curated` 绑定）。两路证据分开列，不合成一个分数：
 * `name_match` 按名字（自动补全的名次 + 名字是否相同）· `cited` 按引用（带这个标签的站内文章**引用的文献**里有多少落在这个主题）。
 * 引用这一路是「按引用关系分类」的思路（Waltman & van Eck 2012），比按名字猜可靠，但要求文章申报参考文献 DOI。
 */
export interface EvidenceBindingSuggestion {
  topic_id: string
  display_name: string
  works_count: number | null
  /** 在自动补全结果里的名次（0 起）；不在自动补全里为 null */
  rank: number | null
  name_match: 'exact' | 'contains' | 'none'
  cited: {
    /** 能查到主题的被引文献数（分母） */
    works: number
    /** 其中主主题是这个主题的 */
    in_topic: number
    share: number
    /** Wilson 95% 区间 */
    ci_low: number
    ci_high: number
  } | null
}

// ── 研究脚手架：格子（系统的主粒度是格子，不是一篇论文）─────────────────────────────────────
// 系统的「货币」是一个**格子**（某维度某取值下几篇），不是一篇论文：一次 group_by 与「被引最高 25 篇」同样 1 credit，
// 给的却是全量分布。一篇一条的 EvidenceRecord 降级为下钻层（`list` 图种，写明「示例，不代表全体」）。

/** 口径：这个节点是作品的**主**主题（primary_topic），还是作品**沾到**这个主题（topics）。所有百分比随它变，必须印在图注上。 */
export type EvidenceCountScope = 'primary_topic' | 'topics'
export const EVIDENCE_COUNT_SCOPES = ['primary_topic', 'topics'] as const satisfies readonly EvidenceCountScope[]

/** 已接的维度（值域；维度的性质——是否互斥、分母怎么取、能不能进多维——在 dimensions.ts 声明）。 */
export const EVIDENCE_DIMENSION_IDS = [
  'publication_year', 'institution_type', 'global_south', 'country', 'language',
  'oa_status', 'publication_type', 'retracted', 'subfield',
] as const
export type EvidenceDimensionId = (typeof EVIDENCE_DIMENSION_IDS)[number]

/**
 * 站内记录能分组的维度（0.2.0 加法）。与外部维度分开成两张表：外部维度是 OpenAlex 的 group_by 键，
 * 站内维度直接从归一化记录上取值。两边**同形**（都是 `EvidenceCountSeries`），但**不许画进同一根轴**——
 * 站内几十篇是作者自选的，外部十万篇是索引全量，分母口径不同。
 * `self_reported_claim` 只喂「阳性率」这张**文献计量**图（Fanelli 2010），永不当证据合成。
 */
export const ONSITE_DIMENSION_IDS = ['publication_year', 'publication_type', 'study_type', 'tag', 'self_reported_claim'] as const
export type OnsiteDimensionId = (typeof ONSITE_DIMENSION_IDS)[number]

/**
 * 图注必须印的限定（前端按 key 查词典；0.2.0 从 dimensions.ts 挪进契约，因为站内层也要用）。
 * 作为**数据字段**下发，不做组件属性——属性会被下一个开发者删掉。
 */
export const EVIDENCE_CAVEATS = [
  'recent_years_lag',          // 最近 1–2 年必然偏低（索引滞后），图上画虚线
  'producer_not_population',   // 是「哪里的机构在产出」，不是「哪里的人被研究了」
  'multi_label',               // 一篇可在多个桶里，桶和 > 分母
  'unknown_excluded',          // 判不了的作品不进分母，也不算进任何一桶
  'oa_nominal',                // 标称开放获取 ≠ 你点开能读
  'not_study_design',          // 出版物形态，不是研究设计
  'retraction_lower_bound',    // 撤稿数是 OpenAlex 标到的下限
  'cooccurrence_not_citation', // 共现＝同一篇被打了两个标签，不是引用、不是合作、不是语义关系
  'focus_diagonal',            // 焦点自己所在的桶恒等于总数，是筛选的产物不是发现
  // ↓ 0.2.0 加法（站内层 / 标签层）
  'onsite_self_selected',      // 站内文章是作者自己选题写的，不是系统检索的样本，不代表这个领域的文献全貌
  'self_reported',             // 研究设计 / 结果类型 / 效应量是作者自报，未经独立核验
  'small_corpus',              // 记录太少，比例与关联强度都不稳定
  'sample_not_population',     // 下钻列表是示例（被引最多的 N 篇），不代表全体
  'machine_binding',           // 标签到主题的对应是机器按名字匹配的，没有人工确认
  'positive_rate_not_efficacy', // 阳性率是文献计量：回答「多少文章报了显著」，不回答「干预有没有效」
  // ↓ 0.2.0 加法（标签账本）
  'model_decided_tags',        // 计入的标签里有模型打的、还没有人确认过
  'disputed_tags_excluded',    // 有争议的标签暂不计入
] as const
export type EvidenceCaveat = (typeof EVIDENCE_CAVEATS)[number]

/**
 * 分母**由格子自己声明**：拿总数当分母会把缺失数据算成某一桶——ADHD 主题实测，4 万篇没有机构数据的作品全部落进
 * 「非全球南方」。`works_in_scope` 范围内全部 · `works_with_value` 这一维有值的（互斥维＝桶和） ·
 * `works_with_identified_institution` 至少一个可识别（有 id）的机构 · `works_with_country` 至少一个机构国家。
 */
export type EvidenceDenominatorKind = 'works_in_scope' | 'works_with_value' | 'works_with_identified_institution' | 'works_with_country'
export const EVIDENCE_DENOMINATOR_KINDS = ['works_in_scope', 'works_with_value', 'works_with_identified_institution', 'works_with_country'] as const satisfies readonly EvidenceDenominatorKind[]
export interface EvidenceDenominator { kind: EvidenceDenominatorKind; value: number }

/** 格子的出处：谁的数据、查的是什么、什么时候取的、花了几 credit（成本可审计）。 */
export interface EvidenceCountProvenance {
  source_label: string
  license: string
  /** 实际发出的查询（去掉主机名），可复打核对 */
  query: string
  /** ISO 时间串：缓存优先意味着可能是几天前取的，图注必须印 */
  retrieved_at: string
  credits: number
}

/** 一个格子。`count = 0` 的意思是「查过了，是零」；**没有这个格子**的意思是「没查」——两者在图上必须长得不一样。 */
export interface EvidenceCell {
  key: string
  /** 外部源给的显示名（国家 / 语言 / 学科名是数据本身，保持原文）；封闭小词表的维度由前端按 key 查词典 */
  label: string
  count: number
  /** 暂定值：最近 1–2 年的计数必然偏低（索引滞后），图上画虚线 / 空心（0.2.0 加法，只有外部年份维会带） */
  provisional?: boolean
}

/**
 * 一维（或 `by` 两维交叉）的一组格子。`D` 是维度 id 的值域：外部维缺省为 `EvidenceDimensionId`，
 * 站内分组用 `EvidenceCountSeries<OnsiteDimensionId>`（0.2.0 加的泛型参数，缺省值保持原形不变）。
 */
export interface EvidenceCountSeries<D extends string = EvidenceDimensionId> {
  dimension: D
  /** 第二维（证据与缺口图的交叉表）；单维缺省 */
  by?: D
  cells: EvidenceCell[]
  /** 两维时：`cells[i]` 在第二维上的分布（与 cells 同序） */
  cross?: EvidenceCell[][]
  denominator: EvidenceDenominator
  /** 互斥划分（每篇至多一个桶）。false ⇒ 多标签：桶和可大于分母，**禁饼图、禁 100% 堆叠** */
  partition: boolean
  /** 这一维没有值的作品数（只有互斥维算得出；多标签维为 null） */
  unknown: number | null
  provenance: EvidenceCountProvenance
  /** 这一组格子的图注限定（0.2.0 加法；旧服务端不下发时前端按维度注册表补） */
  caveats?: EvidenceCaveat[]
  /**
   * 接入方样本门的回显（0.2.1 加法；站内层给了 `sampleGates` 的维度才有）：这一维有值的篇数 `n` 与门槛 `min`。
   * `ok: false` ⇒ 这一维除主题图与清单外按 `needs_more_onsite` 灰掉；引擎自己的比例门槛照常叠加。
   */
  sample_gate?: EvidenceSampleGate
}

/** 接入方样本门：某一维有值的篇数 `n` 够不够门槛 `min`。 */
export interface EvidenceSampleGate {
  min: number
  n: number
  ok: boolean
}

/** 图种（七张计数图 + 饼 + 节点图 + 下钻列表 + 四张**永久列着、写明差什么**的路标）。 */
export const EVIDENCE_CHART_KINDS = [
  'nodes', 'list', 'bar', 'timeseries', 'waffle', 'treemap', 'upset', 'lorenz', 'egm', 'pie',
  'positive_rate', 'harvest', 'albatross', 'forest',
] as const
export type EvidenceChartKind = (typeof EVIDENCE_CHART_KINDS)[number]

/** 画不了的原因（前端按它出一行说明）。 */
export type EvidenceChartBlocker =
  | 'needs_partition'        // 多标签维不能按面积 / 百分比堆叠画
  | 'needs_year'             // 只有年份维能画时间序列
  | 'needs_cross'            // 需要两维交叉表（目前只有 年份 × 机构部门）
  | 'needs_overlap'          // 需要多标签重叠计数（目前只有机构部门）
  | 'too_few_buckets'        // 桶太少，画不出形状（洛伦兹 / 树图）
  | 'too_many_buckets'       // 桶太多，饼图读不出来
  | 'needs_onsite_significance' // 阳性率：站内自报显著性篇数不足
  | 'needs_direction'        // 收获图：差「方向」这一列
  | 'needs_exact_p'          // 信天翁图：差精确 p 与样本量
  | 'needs_effect_size'      // 森林图：差效应量与置信区间
  | 'needs_more_onsite'      // 读占比的图（华夫 / 树图 / 洛伦兹 / 饼）：格子来自站内文章，篇数不到比例门槛（0.2.0 加法）
export const EVIDENCE_CHART_BLOCKERS = [
  'needs_partition', 'needs_year', 'needs_cross', 'needs_overlap', 'too_few_buckets', 'too_many_buckets',
  'needs_onsite_significance', 'needs_direction', 'needs_exact_p', 'needs_effect_size', 'needs_more_onsite',
] as const satisfies readonly EvidenceChartBlocker[]

export interface EvidenceChartAvailability {
  kind: EvidenceChartKind
  available: boolean
  blocker: EvidenceChartBlocker | null
}

/** 多标签维的重叠（UpSet，包含式交集：一篇可同时计入多个集合）。 */
export interface EvidenceOverlap<D extends string = EvidenceDimensionId> {
  dimension: D
  sets: EvidenceCell[]
  /** 两两交集（包含式） */
  pairs: Array<{ a: string; b: string; count: number }>
  provenance: EvidenceCountProvenance
}

// ── 标签共现图（站内 folksonomy 的结构；0.2.0 加法）────────────────────────────────────────
// 共现 ≠ 语义关系、≠ 引用、≠ 合作：两个标签被同一位作者打在同一篇文章上，仅此而已（图注键 `cooccurrence_not_citation`）。
// 布局用关联强度（van Eck & Waltman 2009：观察共现 / 独立假设下的期望共现），线宽用原始共现数——两个量都下发。

export interface EvidenceTagNode {
  /** 归一化标签键 */
  key: string
  /** 出现最多的那种原文写法 */
  label: string
  /** 带这个标签的站内记录数 */
  count: number
  /** 编辑绑定的主题 id（只认人工绑定；机器匹配不进这张图） */
  topic_id: string | null
}

export interface EvidenceTagEdge {
  a: string
  b: string
  /** 同时带两个标签的记录数（支持度） */
  count: number
  /** |A∩B| / |A∪B|（Jaccard 1912） */
  jaccard: number
  /** 观察共现 / 独立假设下的期望共现 = c_ab·N / (c_a·c_b)；>1 表示比随机更常同现（Brin et al. 1997 的 interest / lift） */
  lift: number
}

export interface EvidenceTagGraph {
  /** 以某个标签为中心的邻域图时是它的键；全站图为 null */
  focus: string | null
  nodes: EvidenceTagNode[]
  edges: EvidenceTagEdge[]
  /** 支持度门槛：低于它的标签 / 边不画（标签频率长尾，大部分标签只用过一两次，Cattuto et al. 2007） */
  min_support: number
  /** 被门槛或节点上限压掉的：几个标签、几条边——**折叠了多少要说出来**，不许悄悄不画 */
  collapsed: { tags: number; edges: number }
  /** 参与统计的站内记录数（N） */
  records: number
  caveats: EvidenceCaveat[]
  provenance: EvidenceCountProvenance
}

/** 站内层（0.2.0 加法）：一个标签（或一个主题下编辑绑定过的全部标签）的站内文章，按站内维度分组。 */
export interface EvidenceOnsiteCounts {
  /** 这一层是按什么圈出来的：`tag` 一个标签键 · `topic` 编辑绑定到这个主题的全部标签 */
  scope: { level: 'tag' | 'topic'; id: string; display_name: string; tag_keys: string[] }
  /** 圈进来的站内记录数 */
  total: number
  series: EvidenceCountSeries<OnsiteDimensionId>[]
  /** 每个站内维度下每种图能不能画（记录级的四张——阳性率 / 收获 / 信天翁 / 森林——按站内记录真实具备的字段判） */
  availability: Record<OnsiteDimensionId, EvidenceChartAvailability[]>
  tag_graph: EvidenceTagGraph | null
}

/** 格子计数读口的响应体。 */
export interface EvidenceCountsData {
  node: { id: string; level: EvidenceScaleLevel; display_name: string }
  scope: EvidenceCountScope
  /** 本口径下的作品总数 */
  total: number
  /** 另一口径下的总数（图注上两个都印，读者才知道百分比随口径变）；取不到为 null */
  other_scope_total: number | null
  series: EvidenceCountSeries[]
  overlap: EvidenceOverlap | null
  /** 每个维度下每种图能不能画、为什么不能（「不能画什么」与数据一起发出去） */
  availability: Record<EvidenceDimensionId, EvidenceChartAvailability[]>
  /**
   * 站内层（0.2.0 加法）：编辑绑定到这个节点的标签下的站内文章。与外部 `series` **分开下发、分开画**。
   * 旧服务端不下发、或这个节点没有绑定标签时，UI 当没有站内层。
   */
  onsite?: EvidenceOnsiteCounts | null
}

// ── 标签账本：论文的标签从哪来、谁说了算（0.2.0 加法）─────────────────────────────────────
// 模型或人给某篇论文打的标签，一条一条记成「断言」（加 / 去），带上是谁、什么信任层级、什么模型版本。
// 生效的标签由断言按规则裁决：人压过模型；最高一级内部意见不一 ⇒ 「有争议」，不进统计、等审核；
// 低一级要推翻高一级的结论，不能直接写，只能提修改申请，由够级别的另一个人审。

/** 信任层级（从高到低的缺省次序）。接入方自己决定谁是哪一级——比如自家编辑是 editor，社区贡献者是 contributor。 */
export const EVIDENCE_TRUST_TIERS = ['maintainer', 'editor', 'contributor', 'model'] as const
export type EvidenceTrustTier = (typeof EVIDENCE_TRUST_TIERS)[number]

export interface EvidenceTagActor {
  kind: 'person' | 'model'
  /** 人：接入方的内部账号 id（别放邮箱等个人信息）；模型：`EvidenceTagger.id` */
  id: string
  tier: EvidenceTrustTier
  /** 模型版本（`EvidenceTagger.version`）；人为 null */
  model_version?: string | null
}

export interface EvidenceTagAssertion {
  id: string
  /** 作品 id：`<source>:<external_id>` 或 `doi:<doi>` */
  work_id: string
  tag_key: string
  tag_label: string
  /** add＝这篇有这个标签 · remove＝这篇没有这个标签 */
  op: 'add' | 'remove'
  by: EvidenceTagActor
  /** 模型的置信度（0–1）；人为 null */
  confidence: number | null
  /** ISO 时间串 */
  at: string
  note: string | null
  /** 由哪个修改申请审核通过后写入 */
  request_id: string | null
}

export const EVIDENCE_WORK_TAG_STATES = ['present', 'absent', 'disputed'] as const
export type EvidenceWorkTagState = (typeof EVIDENCE_WORK_TAG_STATES)[number]

/** 一篇论文上一个标签的生效结论。只有 `present` 进统计；`disputed` 单独列出等审核。 */
export interface EvidenceWorkTag {
  tag_key: string
  label: string
  state: EvidenceWorkTagState
  /** 结论由哪一级给出（有争议时是发生分歧的那一级） */
  decided_by: EvidenceTrustTier
  /** 各级「每个断言者最新一次立场」的计数 */
  support: Partial<Record<EvidenceTrustTier, { add: number; remove: number }>>
  last_changed: string
  /** 这个结论由哪个修改申请审核通过而定（null＝按层级立场定的）。经审核的结论同级不能直接推翻，要再提申请 */
  request_id?: string | null
}

export const EVIDENCE_CHANGE_REQUEST_STATUSES = ['open', 'accepted', 'rejected', 'withdrawn'] as const
export type EvidenceChangeRequestStatus = (typeof EVIDENCE_CHANGE_REQUEST_STATUSES)[number]

/** 修改论文标签的申请（推翻更高一级的结论、或处理有争议的标签，都走这里）。 */
export interface EvidenceTagChangeRequest {
  id: string
  work_id: string
  changes: Array<{ op: 'add' | 'remove'; tag_key: string; tag_label: string }>
  by: EvidenceTagActor
  reason: string
  status: EvidenceChangeRequestStatus
  created_at: string
  decided_at: string | null
  decided_by: EvidenceTagActor | null
  decision_note: string | null
}

/** 账本拒绝一次写入或审核的原因（前端按键查词典）。 */
export const EVIDENCE_LEDGER_REFUSALS = [
  'invalid_tag', 'invalid_work', 'needs_change_request', 'not_open', 'self_review', 'insufficient_tier', 'not_a_person', 'empty_request',
  'not_requester', 'not_found',
] as const
export type EvidenceLedgerRefusal = (typeof EVIDENCE_LEDGER_REFUSALS)[number]

/**
 * 打标签结果的交换包：愿意共享的人用自己的模型打完标签，把结果打成一个包交给托管账本的一方。
 * 包里**没有**信任层级，也没有人的身份：层级由收包的一方按鉴权决定，包里自称什么一律不信。
 */
export interface EvidenceTagContribution {
  /** 打包时的契约版本 */
  contract: string
  tagger: { id: string; version: string }
  items: Array<{
    /** 作品 id：`<source>:<external_id>` 或 `doi:<doi>` */
    work_id: string
    tags: Array<{ tag: string; confidence: number | null; rationale?: string | null }>
  }>
}

export const EVIDENCE_CONTRIBUTION_ISSUES = ['not_an_object', 'bad_tagger', 'too_many_items', 'bad_work_id', 'duplicate_work', 'no_valid_tags'] as const
export type EvidenceContributionIssueCode = (typeof EVIDENCE_CONTRIBUTION_ISSUES)[number]
/** `index` 是出问题的条目在 `items` 里的下标；整包的问题为 null */
export interface EvidenceContributionIssue { code: EvidenceContributionIssueCode; index: number | null }

// ── 插件设置与清单（0.2.0 加法）────────────────────────────────────────────────────
// 接入方把本引擎当「插件」装进自己的后台：设置页按下面的清单**自动生成**，值存在接入方自己的库里，服务每次请求现读。
// 新版本加了设置项 ⇒ 接入方同步（升级依赖）后，新条目自动出现在设置页、带着缺省值直接生效；旧值里认不出的键忽略，不报错。
// 设置只同步**数据**；代码只随依赖升级、构建、测试进来，绝不在运行时从网上取代码执行。

export const EVIDENCE_SETTING_GROUPS = ['binding', 'external', 'cache', 'onsite', 'graph', 'http', 'ledger'] as const
export type EvidenceSettingGroup = (typeof EVIDENCE_SETTING_GROUPS)[number]

/** 全部设置项与它们的值类型（键永不改名；废弃的键只标记，不删除）。 */
export interface EvidenceSettings {
  'binding.machinePolicy': 'first_hit' | 'exact_only' | 'off'
  'external.gate': 'onsite_tags_only' | 'any'
  'external.dailyCreditBudget': number
  'external.sampleSize': number
  'external.maxReferenceDois': number
  'cache.resolveDays': number
  'cache.bundleDays': number
  'cache.sampleDays': number
  'cache.countsDays': number
  'onsite.label': string
  'onsite.license': string
  'graph.minSupport': number
  'graph.maxNodes': number
  'http.cacheMaxAge': number
  'http.route.map': boolean
  'http.route.counts': boolean
  'http.route.tagCounts': boolean
  'http.route.tagGraph': boolean
  'ledger.modelMinConfidence': number
  'ledger.reviewTier': 'maintainer' | 'editor' | 'contributor'
  'ledger.apply': 'merge' | 'ledger_only' | 'off'
}
export type EvidenceSettingKey = keyof EvidenceSettings

/** 一个设置项的声明（后台据此渲染表单、验值；文案在词典的 `setting` 一节）。 */
export interface EvidenceSettingDef {
  key: EvidenceSettingKey
  group: EvidenceSettingGroup
  type: 'enum' | 'integer' | 'boolean' | 'string'
  default: string | number | boolean
  /** enum 的可选值 */
  options?: readonly string[]
  /** integer 的范围（含端点） */
  min?: number
  max?: number
  /** string 的最大长度 */
  maxLength?: number
  unit: 'credits' | 'days' | 'seconds' | 'items' | 'percent' | null
  /** 从哪个版本起有 */
  since: string
  /** `live` 改了下一次请求就生效 · `restart` 要重建服务 */
  apply: 'live' | 'restart'
  /** `public` 可以下发到浏览器 · `server` 只在服务端用 */
  scope: 'server' | 'public'
}

export const EVIDENCE_SETTING_ISSUES = ['not_an_object', 'unknown_key', 'wrong_type', 'out_of_range', 'not_an_option', 'too_long'] as const
export type EvidenceSettingIssueCode = (typeof EVIDENCE_SETTING_ISSUES)[number]
/** 验值问题：值不合法时一律退回缺省值（不抛），并记一条问题给后台显示。 */
export interface EvidenceSettingIssue { key: string; code: EvidenceSettingIssueCode }

/**
 * 插件清单（仓根 `scholar-meta.manifest.json`，由构建生成并核对）：接入方的后台可以直接从 GitHub 取最新一份，
 * 与已安装版本比对（`diffPluginManifests`），在升级之前就看到新版本会多出哪些设置、功能。文案带中英两份。
 */
export interface EvidencePluginManifest {
  manifest_version: 1
  id: 'scholar-meta'
  version: string
  contract_version: string
  repository: string
  /** 变更记录在仓里的相对路径 */
  changelog: string
  entries: string[]
  routes: Record<string, string>
  features: Array<{ id: string; audience: 'reader' | 'author' | 'editor'; route: string | null }>
  settings: Array<EvidenceSettingDef & { label: Record<string, string>; help: Record<string, string>; option_labels?: Record<string, Record<string, string>> }>
  /** 要用、但不是设置值的密钥（值只在接入方的环境变量里；后台只显示配没配） */
  secrets: Array<EvidencePluginSecretDef & { label: Record<string, string>; help: Record<string, string> }>
}

/**
 * 插件要用的密钥（0.2.0 加法）。**不是设置值**：不进设置包、不进库、不进表单、不进清单的值——
 * 清单只说「要哪个、建议放在哪个环境变量」，接入方从自己的环境变量读出来，交给对应的入口（比如 `createOpenAlexClient({ apiKey })`）。
 */
export const EVIDENCE_PLUGIN_SECRET_KEYS = ['external.apiKey'] as const
export type EvidencePluginSecretKey = (typeof EVIDENCE_PLUGIN_SECRET_KEYS)[number]
export interface EvidencePluginSecretDef {
  key: EvidencePluginSecretKey
  /** 建议的环境变量名（接入方可以映射到自己的名字） */
  env: string
  /** 不配也能用 ⇒ false */
  required: boolean
  /** 交给哪个入口的哪个选项，比如 `scholar-meta/openalex` 的 `apiKey` */
  entry: string
  option: string
}

/** 两份清单的差别（已安装 → 最新）。 */
export interface EvidenceManifestDiff {
  from: string
  to: string
  contract_changed: boolean
  settings_added: string[]
  settings_removed: string[]
  /** 同一个键，哪些字段变了（default / options / min / max / apply / scope / type…） */
  settings_changed: Array<{ key: string; fields: string[] }>
  features_added: string[]
  features_removed: string[]
}

// ── 站内文章入库验形（0.2.0 加法）────────────────────────────────────────────────────
// 作者自报的数字先验形再进阶梯：一个写反的置信区间就能把整张图从「证据缺口图」抬成「森林图」。
// 每一条问题都说清楚动作：整条丢掉 · 清空这个字段 · 按规则改写 · 只做标记（保留原值）。

export const EVIDENCE_INTAKE_ISSUES = [
  'missing_id', 'missing_title', 'not_public', 'retracted',   // 整条丢掉
  'invalid_year', 'invalid_url', 'invalid_doi',               // 清空字段
  'tag_invalid', 'too_many_tags',                             // 丢掉个别标签
  'unknown_study_design', 'unknown_claim', 'unknown_direction',
  'unknown_metric',                                           // 效应量整个清空
  'effect_not_finite', 'ratio_not_positive', 'value_out_of_range', // 清空点估计（精确 p、样本量照收；什么都没留下才整个清空）；区间越界时只清区间
  'ci_incomplete', 'ci_inverted', 'ci_excludes_estimate',     // 只清空置信区间
  'ci_without_estimate',                                      // 只清空置信区间（0.3.0 加法：没有点估计的区间核不了）
  'unknown_rob_tool', 'rob_judgement_invalid', 'rob_source_missing', // 偏倚风险整个清空（0.3.0 加法）
  'n_invalid', 'p_invalid',
  'direction_conflicts_effect',                               // 方向改为 unclear、orientation 清空
  'claim_conflicts_ci', 'p_conflicts_ci',                     // 只做标记
] as const
export type EvidenceIntakeIssueCode = (typeof EVIDENCE_INTAKE_ISSUES)[number]

export interface EvidenceIntakeIssue {
  code: EvidenceIntakeIssueCode
  /** 出问题的输入字段（`effect.ci_low` 这种点路径） */
  field: string
  action: 'record_dropped' | 'field_cleared' | 'value_adjusted' | 'flagged'
}
