/**
 * 消费端词典——引擎下发的每一个**键**（图注限定、画不了的原因、降级原因、绑定状态、入库问题……）在这里都有一句人话。
 * ─────────────────────────────────────────────────────────────────────────────
 * 【完整性是编译期保证的】每一节都是 `Record<某个契约联合类型, string>`：契约里加一个键而词典没跟上，`tsc` 直接红。
 * 这就是「每个生产出来的键都有消费端」的最底层一环（功能级的见 features.ts）。
 * 【宿主要更多语言】照 `EvidenceMessageCatalog` 写一份（类型会逼你写全），传给 present.ts 的任何函数（`{ messages }`）；
 * 或者 `mergeMessages(EVIDENCE_MESSAGES.zh, { caveat: { … } })` 只改几句。
 * 【占位符】`{name}` 形式；中英两份模板的占位符集合必须相同（测试钉着）。
 */
import type {
  EvidenceCaveat, EvidenceChartBlocker, EvidenceChartKind, EvidenceDenominatorKind, EvidenceDimensionId, EvidenceDirection,
  EvidenceDowngradeReason, EvidenceEffectMetric, EvidenceExternalMatch, EvidenceIntakeIssueCode, EvidencePoolingReason,
  EvidenceScaleLevel, EvidenceSelfReportedClaim, EvidenceSettingDef, EvidenceSettingGroup, EvidenceSettingIssueCode, EvidenceSettingKey,
  EvidenceStudyDesign, EvidenceViewKind, OnsiteDimensionId,
  EvidenceChangeRequestStatus, EvidenceContributionIssueCode, EvidenceLedgerRefusal, EvidencePluginSecretKey, EvidenceTrustTier,
  EvidenceWorkTagState, EvidenceRobTool, EvidenceRobJudgement, EvidenceCertaintyLevel, EvidenceCertaintyDowngrade, EvidenceCertaintyUpgrade,
} from './types'
import type { ShareReliability } from './stats'
import type { EvidenceRobBand } from './appraisal'

/** 绑定徽章：人绑的 / 机器按同名绑的 / 机器第一条候选 / 编辑否决 / 没有绑定。 */
export type BindingBadge = 'curated' | 'machine_exact' | 'machine_first_hit' | 'rejected' | 'none'
export const BINDING_BADGES = ['curated', 'machine_exact', 'machine_first_hit', 'rejected', 'none'] as const satisfies readonly BindingBadge[]

/** 模板句子（带占位符）。 */
export interface EvidenceMessageTemplates {
  footnote: string
  query: string
  unknown: string
  usable: string
  multi_label_sum: string
  graph_threshold: string
  graph_collapsed: string
  pooled: string
  sample: string
  onsite_only: string
  onsite_count: string
  scope_primary: string
  scope_topics: string
  scope_other: string
  cited_evidence: string
  autocomplete_rank: string
  name_exact: string
  name_contains: string
  name_none: string
  provisional: string
  undeclared_design: string
  queue_articles: string
  queue_candidate: string
  suggestion_confidence: string
  work_tag_decided: string
  work_tag_reviewed: string
  request_changes: string
  /** 偏倚风险与证据确定性（0.3.0） */
  rob_record: string
  rob_not_assessed: string
  rob_source: string
  rob_summary: string
  rob_missing: string
  sensitivity: string
  pooled_short: string
  certainty: string
  certainty_down: string
  certainty_up: string
  certainty_unavailable: string
  list_sep: string
  parts_sep: string
  clause_sep: string
}

export interface EvidenceMessageCatalog {
  view: Record<EvidenceViewKind, string>
  downgrade: Record<EvidenceDowngradeReason, string>
  pooling: Record<EvidencePoolingReason, string>
  chart: Record<EvidenceChartKind, string>
  blocker: Record<EvidenceChartBlocker, string>
  caveat: Record<EvidenceCaveat, string>
  external: Record<EvidenceExternalMatch, string>
  binding: Record<BindingBadge, string>
  dimension: Record<EvidenceDimensionId | OnsiteDimensionId, string>
  denominator: Record<EvidenceDenominatorKind, string>
  reliability: Record<ShareReliability, string>
  intake: Record<EvidenceIntakeIssueCode, string>
  studyDesign: Record<EvidenceStudyDesign, string>
  claim: Record<EvidenceSelfReportedClaim, string>
  direction: Record<EvidenceDirection, string>
  metric: Record<EvidenceEffectMetric, string>
  scale: Record<EvidenceScaleLevel, string>
  /** 封闭小词表维度的桶名（按维度分节；词典里没有的新值回落到数据源给的原文） */
  bucket: Partial<Record<EvidenceDimensionId | OnsiteDimensionId, Record<string, string>>>
  /** 插件设置页：每个设置项的标题、说明、可选值的名字 */
  setting: Record<EvidenceSettingKey, { label: string; help: string; options?: Record<string, string> }>
  settingGroup: Record<EvidenceSettingGroup, string>
  settingIssue: Record<EvidenceSettingIssueCode, string>
  settingApply: Record<EvidenceSettingDef['apply'], string>
  settingUnit: Record<NonNullable<EvidenceSettingDef['unit']>, string>
  /** 标签账本 */
  trustTier: Record<EvidenceTrustTier, string>
  workTagState: Record<EvidenceWorkTagState, string>
  requestStatus: Record<EvidenceChangeRequestStatus, string>
  ledgerRefusal: Record<EvidenceLedgerRefusal, string>
  /** 打标签交换包的问题 */
  contributionIssue: Record<EvidenceContributionIssueCode, string>
  /** 插件密钥（后台只显示配没配） */
  pluginSecret: Record<EvidencePluginSecretKey, { label: string; help: string }>
  /** 偏倚风险：工具名、各工具的判断、跨工具的风险档（0.3.0） */
  rob: { tool: Record<EvidenceRobTool, string>; judgement: Record<EvidenceRobJudgement, string>; band: Record<EvidenceRobBand, string> }
  /** 证据确定性（GRADE）：四档名称、四档的标准含义、降级的五个方面、升级的三个理由（0.3.0） */
  certainty: {
    level: Record<EvidenceCertaintyLevel, string>
    meaning: Record<EvidenceCertaintyLevel, string>
    down: Record<EvidenceCertaintyDowngrade, string>
    up: Record<EvidenceCertaintyUpgrade, string>
  }
  text: EvidenceMessageTemplates
}

export type EvidenceLocale = 'zh' | 'en'

const PUBLICATION_TYPES_ZH: Record<string, string> = {
  article: '论文', review: '综述', preprint: '预印本', 'book-chapter': '书章', book: '专著', dissertation: '学位论文',
  dataset: '数据集', editorial: '社论', letter: '通信', erratum: '勘误', paratext: '附文', report: '报告', other: '其他',
  'peer-review': '同行评议意见', standard: '标准', 'reference-entry': '参考条目', 'supplementary-materials': '补充材料',
  commentary: '评论',
}
const PUBLICATION_TYPES_EN: Record<string, string> = {
  article: 'Article', review: 'Review', preprint: 'Preprint', 'book-chapter': 'Book chapter', book: 'Book', dissertation: 'Dissertation',
  dataset: 'Dataset', editorial: 'Editorial', letter: 'Letter', erratum: 'Erratum', paratext: 'Paratext', report: 'Report', other: 'Other',
  'peer-review': 'Peer review', standard: 'Standard', 'reference-entry': 'Reference entry', 'supplementary-materials': 'Supplementary materials',
  commentary: 'Commentary',
}

const zh: EvidenceMessageCatalog = {
  view: {
    forest: '森林图：逐项效应与置信区间',
    estimates: '点估计图：只有点估计，没有置信区间，不画汇总',
    albatross: '信天翁图：由 p 值与样本量看效应量级',
    direction: '效应方向图：各项研究偏向哪一边',
    gap_map: '证据与缺口图：有没有研究、多少、什么设计',
  },
  downgrade: {
    no_effect_sizes: '没有一条记录带效应量。',
    no_variance: '有点估计，但缺置信区间或方差。',
    no_p_or_n: '有效应方向，但缺精确 p 值或样本量。',
    no_direction: '没有效应方向：只有作者自报的「显著 / 不显著」，而按显著性计票不构成证据合成。',
    too_few: '记录太少，画出来会误导。',
  },
  pooling: {
    ok: '可以汇总。',
    mixed_metrics: '效应量度量不统一（或度量未知），不能汇总。',
    too_few_studies: '满足条件的研究不到 5 项，不画汇总菱形。',
    no_variance: '有研究缺置信区间，不能汇总。',
    not_applicable: '没有效应量，不涉及汇总。',
    orientation_unclear: '「数值大是好还是坏」没有申报齐或互相矛盾，不能汇总。',
    mixed_designs: '研究设计不一致（例如随机与非随机混在一起），不能汇总。',
  },
  chart: {
    nodes: '主题关系', list: '被引最多的文献', bar: '条形图', timeseries: '时间序列', waffle: '华夫图', treemap: '树图',
    upset: '重叠（UpSet）', lorenz: '洛伦兹曲线', egm: '证据与缺口图', pie: '饼图', positive_rate: '阳性率',
    harvest: '收获图', albatross: '信天翁图', forest: '森林图',
  },
  blocker: {
    needs_partition: '这一维一篇可以落在多个桶里，不能按面积或百分比堆叠。',
    needs_year: '只有年份维能画时间序列。',
    needs_cross: '需要两维交叉表。',
    needs_overlap: '需要多标签的重叠计数。',
    too_few_buckets: '桶太少，画不出形状。',
    too_many_buckets: '桶太多，饼图读不出来，请用条形图。',
    needs_onsite_significance: '需要至少 30 篇自报了结果类型的文章。',
    needs_more_onsite: '站内文章还不到 30 篇，占比读不出可信的形状；先看条形图的篇数。',
    needs_direction: '缺「效应方向」这一列。',
    needs_exact_p: '缺精确 p 值与样本量。',
    needs_effect_size: '缺效应量与置信区间。',
  },
  caveat: {
    recent_years_lag: '最近 1–2 年的数字必然偏低：新论文要过一段时间才会被索引（图上用虚线或空心表示）。',
    producer_not_population: '这是「哪里的机构在发表」，不是「哪里的人被研究了」。',
    multi_label: '一篇可以同时落在多个桶里，桶加起来会超过总数；不能画成饼图或 100% 堆叠。',
    unknown_excluded: '判断不了的作品不进分母，也不算进任何一桶。',
    oa_nominal: '标称开放获取不等于点开就能读到全文。',
    not_study_design: '这是出版物形态（论文、综述、预印本…），不是研究设计：随机对照试验和横断面调查在这里都叫「论文」。',
    retraction_lower_bound: '撤稿数是数据源标注到的下限，实际可能更多。',
    cooccurrence_not_citation: '两个标签相连只表示它们被打在同一篇文章上：不是引用、不是合作，也不代表意思相近。',
    focus_diagonal: '焦点自己所在的那一格恒等于总数，是筛选的结果，不是发现。',
    onsite_self_selected: '站内文章是作者自己选题写的，不是按检索式系统收集的样本，不代表这个领域的文献全貌。',
    self_reported: '研究设计、结果类型、效应量都是作者自报的，没有经过独立核验。',
    small_corpus: '记录不到 30 条：比例和关联强度都很不稳定，只宜当线索。',
    sample_not_population: '列表只是示例（被引最多的几篇），不代表全体；被引多说明受关注，不说明结论可靠。',
    machine_binding: '这个标签对应的主题是按名字自动匹配的，还没有经过人工确认，可能配错。',
    positive_rate_not_efficacy: '阳性率回答「多少文章报告了显著结果」，不回答「干预有没有效」；按显著与否计票在方法学上无效（Cochrane Handbook 12.2.2.1）。',
    model_decided_tags: '有些标签是模型打的、还没有人确认过；人工审核之后数字可能会变。',
    disputed_tags_excluded: '审核意见不一致的标签暂不计入，定下来之后再算。',
  },
  external: {
    matched: '已对应到外部文献库的主题。',
    no_match: '外部文献库里没有与这个标签对应的主题，下面只有站内文章。',
    unavailable: '这次没能连上外部文献库，下面只有站内文章；稍后再试。',
    not_queried: '没有查询外部文献库（只对公开文章里出现过的标签查询，或者站点没有接外部源）。',
    needs_review: '外部文献库里有候选主题，但还没经编辑确认，暂不显示外部文献。',
  },
  binding: {
    curated: '编辑确认：对应主题「{topic}」',
    machine_exact: '自动匹配（名称相同）：「{topic}」',
    machine_first_hit: '自动匹配（未经人工确认）：「{topic}」',
    rejected: '编辑确认：这个标签没有对应的外部主题',
    none: '没有对应的外部主题',
  },
  dimension: {
    publication_year: '发表年份', institution_type: '机构部门', global_south: '全球南方', country: '国家 / 地区', language: '语言',
    oa_status: '开放获取状态', publication_type: '出版物形态', retracted: '撤稿', subfield: '学科（子领域）',
    study_type: '研究设计', tag: '标签', self_reported_claim: '作者自报结果类型',
  },
  denominator: {
    works_in_scope: '分母：范围内全部 {n} 篇',
    works_with_value: '分母：这一维有值的 {n} 篇',
    works_with_identified_institution: '分母：至少有一个可识别机构的 {n} 篇',
    works_with_country: '分母：至少有一个机构国家的 {n} 篇',
  },
  reliability: {
    ok: '样本量足够。',
    insufficient_n: '样本少于 30，只显示计数，不显示比例。',
    wide_interval: '样本偏少，比例的 95% 区间很宽（至少 30 个百分点）。',
  },
  intake: {
    missing_id: '缺文章 id，整篇没有收录。',
    missing_title: '缺标题，整篇没有收录。',
    not_public: '文章未公开，没有收录。',
    retracted: '文章已撤回，没有收录。',
    invalid_year: '年份不合法，已忽略。',
    invalid_url: '链接不是 http / https 地址，已忽略。',
    invalid_doi: 'DOI 格式不对（应形如 10.1234/abcd），已忽略。',
    tag_invalid: '有空标签或过长的标签，已忽略。',
    too_many_tags: '标签太多，只保留了前面的一部分。',
    unknown_study_design: '研究设计不在可选范围内，已忽略。',
    unknown_claim: '结果类型不在可选范围内，已忽略。',
    unknown_direction: '效应方向不在可选范围内，已忽略。',
    unknown_metric: '效应量的度量类型无法识别，效应量已忽略。',
    effect_not_finite: '点估计不是有效数字，已忽略（p 值与样本量照常保留）。',
    ratio_not_positive: '比值类效应量（OR / RR / HR）及其区间必须大于 0，已忽略。',
    value_out_of_range: '效应量超出这种度量的合法范围（相关系数在 −1 到 1，患病率在 0 到 1），已忽略。',
    ci_incomplete: '置信区间只填了一端，区间已忽略。',
    ci_without_estimate: '只有置信区间、没有点估计，区间已忽略（核对不了点估计是否落在区间内）。',
    ci_inverted: '置信区间下限必须小于上限，区间已忽略。',
    ci_excludes_estimate: '点估计不在置信区间内，区间已忽略。',
    n_invalid: '样本量必须是正整数，已忽略。',
    p_invalid: 'p 值必须大于 0、不超过 1（只知道「p < 0.05」时请留空），已忽略。',
    direction_conflicts_effect: '申报的效应方向与点估计相反：方向改为「不明确」，请重新确认「数值大是好还是坏」。',
    claim_conflicts_ci: '自报的显著性与 95% 置信区间不一致，请核对。',
    p_conflicts_ci: 'p 值与 95% 置信区间不一致，请核对。',
    unknown_rob_tool: '偏倚风险的工具认不出（只收 RoB 2、ROBINS-I 或 other），偏倚风险已忽略。',
    rob_judgement_invalid: '偏倚风险的总体判断不是这种工具的档位，已忽略。',
    rob_source_missing: '偏倚风险没写是谁评的，已忽略（读者要能看到这个判断从哪来）。',
  },
  studyDesign: {
    rct: '随机对照试验', non_randomised_controlled: '非随机对照研究', cohort: '队列研究', case_control: '病例对照研究',
    cross_sectional: '横断面研究', case_series: '病例系列', qualitative: '质性研究', mixed_methods: '混合方法研究',
    systematic_review: '系统综述', meta_analysis: '元分析', narrative_review: '叙述性综述', other: '其他设计',
  },
  claim: { significant: '报告显著', non_significant: '报告不显著', mixed: '结果混合', not_applicable: '不适用' },
  direction: { favours: '偏向干预', against: '不利于干预', unclear: '不明确', not_applicable: '不适用' },
  metric: {
    smd: '标准化均数差（SMD）', md: '均数差（MD）', hedges_g: "Hedges' g", cohens_d: "Cohen's d", or: '比值比（OR）',
    rr: '相对危险度（RR）', hr: '风险比（HR）', r: '相关系数（r）', prevalence: '患病率', other: '其他度量',
  },
  scale: { tag: '标签', topic: '主题', subfield: '子领域', field: '领域', domain: '大类' },
  bucket: {
    institution_type: {
      education: '教育机构', healthcare: '医疗机构', company: '企业', archive: '档案机构', nonprofit: '非营利组织',
      government: '政府机构', facility: '研究设施', funder: '资助机构', other: '其他',
    },
    oa_status: { gold: '金色 OA', diamond: '钻石 OA', green: '绿色 OA', hybrid: '混合 OA', bronze: '铜色 OA', closed: '非开放获取' },
    publication_type: PUBLICATION_TYPES_ZH,
    global_south: { true: '全球南方', false: '非全球南方' },
    retracted: { true: '已撤稿', false: '未撤稿' },
  },
  setting: {
    'binding.machinePolicy': {
      label: '机器绑定策略', help: '编辑还没确认的标签，要不要按外部库的自动补全结果自动对应主题。',
      options: { first_hit: '第一条候选就用（图上标「未经确认」）', exact_only: '名称完全相同才用，其余等编辑', off: '只用编辑确认的' },
    },
    'external.gate': {
      label: '外部查询范围', help: '哪些标签会拿去问外部文献库。只问公开文章里出现过的标签，读者随手输入的字符串就不会变成对第三方的查询。',
      options: { onsite_tags_only: '只问公开文章里出现过的标签（推荐）', any: '任何标签都问' },
    },
    'external.dailyCreditBudget': { label: '外部库每日额度', help: '每个 UTC 日最多花多少 OpenAlex credit；花完后收费请求暂停到第二天，免费请求照常。0 表示只用免费请求。' },
    'external.sampleSize': { label: '外部示例篇数', help: '标签页与主题页上列出的外部文献篇数（被引最多的若干篇，是示例，不代表全体）。' },
    'external.maxReferenceDois': { label: '引用证据最多查几篇', help: '给编辑推荐绑定时，最多查多少篇参考文献的主题（每 50 篇 1 credit）。' },
    'cache.resolveDays': { label: '标签匹配结果缓存', help: '标签 → 主题的自动匹配结果保存几天。' },
    'cache.bundleDays': { label: '主题树缓存', help: '主题的上级与兄弟保存几天（兄弟没取全的不写缓存）。' },
    'cache.sampleDays': { label: '外部示例缓存', help: '外部示例文献保存几天。' },
    'cache.countsDays': { label: '全量计数缓存', help: '主题的全量格子保存几天（冷启动一次约 17 credit）。' },
    'onsite.label': { label: '站内来源名称', help: '脚注里站内文章的来源名，比如站名或栏目名。' },
    'onsite.license': { label: '站内文章许可', help: '站内文章的许可（比如 CC BY 4.0），脚注逐条印出。' },
    'graph.minSupport': { label: '共现图门槛', help: '标签与共现至少出现几次才画进共现图（读者请求没指定时的缺省值）。' },
    'graph.maxNodes': { label: '共现图最多标签数', help: '共现图最多画几个标签（读者请求没指定时的缺省值）。' },
    'http.cacheMaxAge': { label: '读口缓存时长', help: '公开读口成功响应的 Cache-Control max-age。' },
    'http.route.map': { label: '开放「研究图谱」读口', help: 'GET /map：标签与主题的研究图谱。' },
    'http.route.counts': { label: '开放「全量计数」读口', help: 'GET /counts：最花外部额度的读口。' },
    'http.route.tagCounts': { label: '开放「标签站内层」读口', help: 'GET /tags/counts：一个标签下站内文章的分布。' },
    'http.route.tagGraph': { label: '开放「标签共现图」读口', help: 'GET /tags/graph：站内标签的共现图。' },
    'ledger.modelMinConfidence': { label: '模型断言的置信门槛', help: '模型给论文打的标签，置信度低于这个百分比的不参与裁决（没给置信度的照算）。' },
    'ledger.reviewTier': {
      label: '审核修改申请的最低层级', help: '谁可以批准或驳回「修改论文标签」的申请；还要不低于所涉标签现行结论的层级，且不能审自己的申请。',
      options: { maintainer: '维护者', editor: '编辑', contributor: '贡献者' },
    },
    'ledger.apply': {
      label: '账本结论怎么用到统计上', help: '只有「有」计入统计；有争议的一律先不计入。服务接了账本才起作用。',
      options: { merge: '合并：作者的标签按账本增删', ledger_only: '只用账本的结论', off: '不用（只看作者的标签）' },
    },
  },
  settingGroup: { binding: '标签绑定', external: '外部文献库', cache: '缓存', onsite: '站内文章', graph: '共现图', http: '公开读口', ledger: '标签账本' },
  settingIssue: {
    not_an_object: '设置不是一个对象，全部用缺省值。',
    unknown_key: '当前版本不认识这个设置（可能来自更新的版本），已忽略；升级后会自动生效。',
    wrong_type: '类型不对，用缺省值。',
    out_of_range: '超出允许范围，用缺省值。',
    not_an_option: '不是可选值之一，用缺省值。',
    too_long: '太长，用缺省值。',
  },
  settingApply: { live: '改了立即生效', restart: '重启服务后生效' },
  settingUnit: { credits: 'credit', days: '天', seconds: '秒', items: '个', percent: '%' },
  trustTier: { maintainer: '维护者', editor: '编辑', contributor: '贡献者', model: '模型' },
  workTagState: { present: '有', absent: '没有', disputed: '有争议（不计入统计，等审核）' },
  requestStatus: { open: '待审核', accepted: '已通过', rejected: '已驳回', withdrawn: '已撤回' },
  ledgerRefusal: {
    invalid_tag: '标签不合法。',
    invalid_work: '认不出这篇论文的 id（要 openalex:W…、doi:10.…/… 或 来源:编号）。',
    needs_change_request: '这会推翻更高一级的结论，请提交修改申请。',
    not_open: '这个申请已经处理过了。',
    self_review: '不能审核自己的申请。',
    insufficient_tier: '你的层级不够审核这个申请。',
    not_a_person: '只有人能提交或审核申请。',
    empty_request: '申请至少要有一处改动和一段理由。',
    not_requester: '只有申请人能撤回。',
    not_found: '找不到这个申请。',
  },
  contributionIssue: {
    not_an_object: '交换包的格式不对，整包没有收。',
    bad_tagger: '交换包没有写明是哪个模型、哪个版本，整包没有收。',
    too_many_items: '一次交的论文太多，超出的部分没有收。',
    bad_work_id: '认不出这篇论文的 id，这一条没有收。',
    duplicate_work: '同一篇论文在包里出现了两次，后一条没有收。',
    no_valid_tags: '这一条没有可收的标签（都不合法、在词表外或置信度太低）。',
  },
  pluginSecret: {
    'external.apiKey': {
      label: 'OpenAlex API key',
      help: '可选。配了走你自己的额度，不配走公共额度。只放在服务器的环境变量里；引擎只把它放进请求头，永不进网址、日志与出处。',
    },
  },
  rob: {
    tool: { rob2: 'RoB 2', robins_i: 'ROBINS-I', other: '其他工具' },
    judgement: {
      low: '低风险', some_concerns: '有一些担忧', high: '高风险', moderate: '中等风险', serious: '严重风险', critical: '极严重风险',
      no_information: '信息不足', unclear: '不清楚',
    },
    band: { low: '低风险', concerns: '有担忧', high: '高风险', critical: '极严重', unknown: '信息不足' },
  },
  certainty: {
    level: { high: '高', moderate: '中', low: '低', very_low: '极低' },
    // 各档含义按 Balshem et al. 2011（J Clin Epidemiol 64(4):401–406）表 2 意译
    meaning: {
      high: '我们非常有把握：真实效应接近估计值。',
      moderate: '我们对效应估计有中等把握：真实效应很可能接近估计值，但也可能有实质差别。',
      low: '我们对效应估计的把握有限：真实效应可能与估计值有实质差别。',
      very_low: '我们对效应估计几乎没有把握：真实效应很可能与估计值有实质差别。',
    },
    down: { risk_of_bias: '偏倚风险', inconsistency: '结果不一致', indirectness: '间接性', imprecision: '不精确', publication_bias: '发表偏倚' },
    up: { large_effect: '效应很大', dose_response: '有剂量反应关系', plausible_confounding: '可能的混杂只会削弱所见效应' },
  },
  text: {
    footnote: '来源：{source}（{license}），取数于 {date}',
    query: '查询：{query}',
    unknown: '另有 {n} 篇这一维没有值，不计入分母',
    usable: '{usable} / {total} 条记录满足这一级的要求',
    multi_label_sum: '一篇可以落在多个桶里，桶加起来会超过 {n}',
    graph_threshold: '只画出现至少 {min} 次的标签与共现（共 {records} 篇文章）',
    graph_collapsed: '另有 {tags} 个标签、{edges} 组共现低于门槛，没有画',
    pooled: '随机效应汇总（{metric}，{k} 项研究）：{estimate}，95% 置信区间 {ci_low} 至 {ci_high}；95% 预测区间 {pi_low} 至 {pi_high}；I² = {i2}',
    sample: '外部文献只列了被引最多的 {n} 篇：示例，不代表全体',
    onsite_only: '只有站内文章，不是这个话题的全部研究。',
    onsite_count: '站内文章 {n} 篇',
    scope_primary: '口径：以它为主主题的作品，共 {total} 篇',
    scope_topics: '口径：沾到这个主题的作品，共 {total} 篇',
    scope_other: '换一个口径是 {n} 篇（百分比随口径变）',
    cited_evidence: '引用证据：带这个标签的文章引用的 {works} 篇文献里，{in_topic} 篇的主主题是它（{share}，95% 区间 {ci_low}–{ci_high}）',
    autocomplete_rank: '名称搜索第 {rank} 位',
    name_exact: '名称相同',
    name_contains: '名称部分相同',
    name_none: '名称不同',
    provisional: '暂定',
    undeclared_design: '{n} 篇没有申报研究设计',
    queue_articles: '{n} 篇文章',
    queue_candidate: '候选主题：{topic}',
    suggestion_confidence: '置信度 {value}',
    work_tag_decided: '{state}（由{tier}决定）',
    work_tag_reviewed: '{state}（经{tier}审核）',
    request_changes: '加：{add}；去：{remove}',
    rob_record: '{tool}：{judgement}',
    rob_not_assessed: '未评估偏倚风险',
    rob_source: '评定：{source}',
    rob_summary: '偏倚风险（{tools}）：{parts}',
    rob_missing: '{n} 项没有评估',
    sensitivity: '去掉 {excluded} 项偏倚风险高的研究后（剩 {k} 项）：{result}',
    pooled_short: '{estimate}，95% 置信区间 {ci_low} 至 {ci_high}',
    certainty: '证据确定性（GRADE）：{level}——结局「{outcome}」；评定：{source}',
    certainty_down: '因{list}降级',
    certainty_up: '因{list}升级',
    certainty_unavailable: '这次没取到证据确定性评级，稍后再试。',
    list_sep: '、',
    parts_sep: ' · ',
    clause_sep: '；',
  },
}

const en: EvidenceMessageCatalog = {
  view: {
    forest: 'Forest plot: study-level effects with confidence intervals',
    estimates: 'Point-estimate plot: no confidence intervals, so no summary diamond',
    albatross: 'Albatross plot: effect magnitude from p-values and sample sizes',
    direction: 'Effect-direction plot: which way each study points',
    gap_map: 'Evidence and gap map: whether there is research, how much, and which designs',
  },
  downgrade: {
    no_effect_sizes: 'No record carries an effect size.',
    no_variance: 'Point estimates exist, but confidence intervals or variances are missing.',
    no_p_or_n: 'Effect directions exist, but exact p-values or sample sizes are missing.',
    no_direction: 'No effect directions: only self-reported "significant / not significant", and vote counting by significance is not a synthesis.',
    too_few: 'Too few records; a chart would mislead.',
  },
  pooling: {
    ok: 'Pooling is allowed.',
    mixed_metrics: 'Effect measures differ (or are unknown), so the studies cannot be pooled.',
    too_few_studies: 'Fewer than 5 eligible studies, so no summary diamond is drawn.',
    no_variance: 'Some studies lack confidence intervals, so they cannot be pooled.',
    not_applicable: 'No effect sizes, so pooling does not apply.',
    orientation_unclear: 'Whether higher values are better is missing or inconsistent, so the studies cannot be pooled.',
    mixed_designs: 'Study designs differ (for example randomised and non-randomised), so the studies cannot be pooled.',
  },
  chart: {
    nodes: 'Topic map', list: 'Most-cited works', bar: 'Bar chart', timeseries: 'Time series', waffle: 'Waffle chart', treemap: 'Treemap',
    upset: 'Overlaps (UpSet)', lorenz: 'Lorenz curve', egm: 'Evidence and gap map', pie: 'Pie chart', positive_rate: 'Positive-result rate',
    harvest: 'Harvest plot', albatross: 'Albatross plot', forest: 'Forest plot',
  },
  blocker: {
    needs_partition: 'Works can fall into several buckets here, so area or 100% stacks would double-count.',
    needs_year: 'Only the year dimension can be drawn as a time series.',
    needs_cross: 'Needs a two-way cross-tabulation.',
    needs_overlap: 'Needs overlap counts for a multi-label dimension.',
    too_few_buckets: 'Too few buckets to show a shape.',
    too_many_buckets: 'Too many slices to read as a pie; use a bar chart.',
    needs_onsite_significance: 'Needs at least 30 articles with a self-reported result type.',
    needs_more_onsite: 'Fewer than 30 on-site articles, too few for shares to mean much; use the bar chart counts instead.',
    needs_direction: 'Needs the effect-direction column.',
    needs_exact_p: 'Needs exact p-values and sample sizes.',
    needs_effect_size: 'Needs effect sizes with confidence intervals.',
  },
  caveat: {
    recent_years_lag: 'The last 1–2 years are always undercounted because new papers take time to be indexed (drawn dashed or hollow).',
    producer_not_population: 'This shows where the publishing institutions are, not where the studied people are.',
    multi_label: 'A work can fall into several buckets, so buckets sum to more than the total; never draw this as a pie or a 100% stack.',
    unknown_excluded: 'Works that cannot be classified are left out of the denominator and out of every bucket.',
    oa_nominal: 'Nominal open access does not guarantee you can read the full text.',
    not_study_design: 'This is the publication type (article, review, preprint…), not the study design: trials and surveys are both "articles" here.',
    retraction_lower_bound: 'Retractions are a lower bound: only those the source has flagged.',
    cooccurrence_not_citation: 'A link means two tags were put on the same article. It is not a citation, a collaboration, or a sign that the tags mean similar things.',
    focus_diagonal: 'The focus\'s own bucket always equals the total; that is a result of filtering, not a finding.',
    onsite_self_selected: 'On-site articles were chosen by their authors, not collected by a systematic search, so they do not represent the whole literature.',
    self_reported: 'Study design, result type and effect sizes are self-reported by authors and not independently verified.',
    small_corpus: 'Fewer than 30 records: shares and association strengths are unstable; treat them as leads only.',
    sample_not_population: 'The list is a sample (the most-cited works), not the whole; being cited a lot means attention, not reliability.',
    machine_binding: 'This tag was matched to the topic automatically by name and has not been reviewed; the match may be wrong.',
    positive_rate_not_efficacy: 'The positive-result rate says how many articles report significant results, not whether an intervention works; vote counting by significance is invalid (Cochrane Handbook 12.2.2.1).',
    model_decided_tags: 'Some tags were assigned by a model and not yet confirmed by a person; counts may change after review.',
    disputed_tags_excluded: 'Tags that reviewers disagree on are left out until the disagreement is settled.',
  },
  external: {
    matched: 'Matched to a topic in the external literature database.',
    no_match: 'The external database has no topic for this tag; only on-site articles are shown.',
    unavailable: 'The external database could not be reached this time; only on-site articles are shown. Try again later.',
    not_queried: 'The external database was not queried (only tags that appear in public articles are queried, or no external source is configured).',
    needs_review: 'The external database has candidate topics, but an editor has not confirmed one yet, so no external works are shown.',
  },
  binding: {
    curated: 'Confirmed by an editor: topic "{topic}"',
    machine_exact: 'Matched automatically (same name): "{topic}"',
    machine_first_hit: 'Matched automatically (not reviewed): "{topic}"',
    rejected: 'Confirmed by an editor: this tag has no external topic',
    none: 'No external topic',
  },
  dimension: {
    publication_year: 'Publication year', institution_type: 'Institution type', global_south: 'Global South', country: 'Country / region',
    language: 'Language', oa_status: 'Open-access status', publication_type: 'Publication type', retracted: 'Retraction',
    subfield: 'Subfield', study_type: 'Study design', tag: 'Tag', self_reported_claim: 'Self-reported result type',
  },
  denominator: {
    works_in_scope: 'Denominator: all {n} works in scope',
    works_with_value: 'Denominator: the {n} works with a value on this dimension',
    works_with_identified_institution: 'Denominator: the {n} works with at least one identified institution',
    works_with_country: 'Denominator: the {n} works with at least one institution country',
  },
  reliability: {
    ok: 'Sample size is adequate.',
    insufficient_n: 'Fewer than 30 works: counts only, no percentages.',
    wide_interval: 'Small sample: the 95% interval for this share is wide (30 points or more).',
  },
  intake: {
    missing_id: 'Missing article id; the article was not included.',
    missing_title: 'Missing title; the article was not included.',
    not_public: 'The article is not public; it was not included.',
    retracted: 'The article was withdrawn; it was not included.',
    invalid_year: 'The year is invalid and was ignored.',
    invalid_url: 'The link is not an http or https address and was ignored.',
    invalid_doi: 'The DOI is malformed (expected something like 10.1234/abcd) and was ignored.',
    tag_invalid: 'Empty or overly long tags were ignored.',
    too_many_tags: 'Too many tags; only the first ones were kept.',
    unknown_study_design: 'The study design is not one of the allowed values and was ignored.',
    unknown_claim: 'The result type is not one of the allowed values and was ignored.',
    unknown_direction: 'The effect direction is not one of the allowed values and was ignored.',
    unknown_metric: 'The effect measure is not recognised; the effect size was ignored.',
    effect_not_finite: 'The point estimate is not a valid number and was ignored (the p-value and sample size were kept).',
    ratio_not_positive: 'Ratio measures (OR / RR / HR) and their intervals must be greater than 0; the value was ignored.',
    value_out_of_range: 'The effect size is outside the valid range for its measure (r within −1 to 1, prevalence within 0 to 1) and was ignored.',
    ci_incomplete: 'Only one end of the confidence interval was given; the interval was ignored.',
    ci_without_estimate: 'A confidence interval was given without a point estimate; the interval was ignored (it cannot be checked against the estimate).',
    ci_inverted: 'The lower confidence limit must be below the upper one; the interval was ignored.',
    ci_excludes_estimate: 'The point estimate lies outside its confidence interval; the interval was ignored.',
    n_invalid: 'The sample size must be a positive whole number and was ignored.',
    p_invalid: 'The p-value must be above 0 and at most 1 (leave it empty if you only know "p < 0.05"); it was ignored.',
    direction_conflicts_effect: 'The declared direction contradicts the point estimate. The direction was set to "unclear"; please re-check whether higher values are better.',
    claim_conflicts_ci: 'The self-reported significance disagrees with the 95% confidence interval; please check.',
    p_conflicts_ci: 'The p-value disagrees with the 95% confidence interval; please check.',
    unknown_rob_tool: 'The risk-of-bias tool was not recognised (RoB 2, ROBINS-I or other); the risk-of-bias judgement was ignored.',
    rob_judgement_invalid: 'The overall risk-of-bias judgement is not one of this tool’s levels; it was ignored.',
    rob_source_missing: 'The risk-of-bias judgement does not say who made it, so it was ignored (readers need to see where it comes from).',
  },
  studyDesign: {
    rct: 'Randomised controlled trial', non_randomised_controlled: 'Non-randomised controlled study', cohort: 'Cohort study',
    case_control: 'Case-control study', cross_sectional: 'Cross-sectional study', case_series: 'Case series',
    qualitative: 'Qualitative study', mixed_methods: 'Mixed-methods study', systematic_review: 'Systematic review',
    meta_analysis: 'Meta-analysis', narrative_review: 'Narrative review', other: 'Other design',
  },
  claim: { significant: 'Reported significant', non_significant: 'Reported not significant', mixed: 'Mixed results', not_applicable: 'Not applicable' },
  direction: { favours: 'Favours the intervention', against: 'Against the intervention', unclear: 'Unclear', not_applicable: 'Not applicable' },
  metric: {
    smd: 'Standardised mean difference (SMD)', md: 'Mean difference (MD)', hedges_g: "Hedges' g", cohens_d: "Cohen's d",
    or: 'Odds ratio (OR)', rr: 'Risk ratio (RR)', hr: 'Hazard ratio (HR)', r: 'Correlation (r)', prevalence: 'Prevalence', other: 'Other measure',
  },
  scale: { tag: 'Tag', topic: 'Topic', subfield: 'Subfield', field: 'Field', domain: 'Domain' },
  bucket: {
    institution_type: {
      education: 'Education', healthcare: 'Healthcare', company: 'Company', archive: 'Archive', nonprofit: 'Nonprofit',
      government: 'Government', facility: 'Facility', funder: 'Funder', other: 'Other',
    },
    oa_status: { gold: 'Gold OA', diamond: 'Diamond OA', green: 'Green OA', hybrid: 'Hybrid OA', bronze: 'Bronze OA', closed: 'Closed' },
    publication_type: PUBLICATION_TYPES_EN,
    global_south: { true: 'Global South', false: 'Not Global South' },
    retracted: { true: 'Retracted', false: 'Not retracted' },
  },
  setting: {
    'binding.machinePolicy': {
      label: 'Automatic binding policy', help: 'Whether tags without an editor decision are matched to a topic automatically from the external autocomplete.',
      options: { first_hit: 'Use the first candidate (marked as unreviewed)', exact_only: 'Exact name matches only; the rest wait for an editor', off: 'Editor-confirmed bindings only' },
    },
    'external.gate': {
      label: 'External query scope', help: 'Which tags are sent to the external index. Querying only tags used in public articles keeps arbitrary reader input from becoming third-party queries.',
      options: { onsite_tags_only: 'Only tags used in public articles (recommended)', any: 'Any tag' },
    },
    'external.dailyCreditBudget': { label: 'Daily external credit budget', help: 'OpenAlex credits allowed per UTC day. When used up, paid requests pause until the next day; free requests continue. 0 means free requests only.' },
    'external.sampleSize': { label: 'External sample size', help: 'How many external works are listed on tag and topic pages (the most cited ones: a sample, not the whole).' },
    'external.maxReferenceDois': { label: 'Reference DOIs to check', help: 'How many reference DOIs are looked up when suggesting bindings to editors (1 credit per 50).' },
    'cache.resolveDays': { label: 'Tag match cache', help: 'Days to keep automatic tag → topic matches.' },
    'cache.bundleDays': { label: 'Topic tree cache', help: 'Days to keep a topic\'s ancestors and siblings (incomplete sibling lists are not cached).' },
    'cache.sampleDays': { label: 'External sample cache', help: 'Days to keep external sample works.' },
    'cache.countsDays': { label: 'Full counts cache', help: 'Days to keep a topic\'s full counts (about 17 credits per cold start).' },
    'onsite.label': { label: 'On-site source name', help: 'Source name printed in footnotes for on-site articles, such as the site or section name.' },
    'onsite.license': { label: 'On-site licence', help: 'Licence of on-site articles (for example CC BY 4.0), printed in footnotes.' },
    'graph.minSupport': { label: 'Tag graph threshold', help: 'Minimum occurrences for a tag or co-occurrence to be drawn (default when a request does not say).' },
    'graph.maxNodes': { label: 'Tag graph size', help: 'Maximum number of tags in the tag graph (default when a request does not say).' },
    'http.cacheMaxAge': { label: 'API cache lifetime', help: 'Cache-Control max-age of successful public API responses.' },
    'http.route.map': { label: 'Enable the evidence-map route', help: 'GET /map: evidence maps for tags and topics.' },
    'http.route.counts': { label: 'Enable the counts route', help: 'GET /counts: the route that spends the most external credits.' },
    'http.route.tagCounts': { label: 'Enable the tag-counts route', help: 'GET /tags/counts: on-site distributions for a tag.' },
    'http.route.tagGraph': { label: 'Enable the tag-graph route', help: 'GET /tags/graph: co-occurrence graph of on-site tags.' },
    'ledger.modelMinConfidence': { label: 'Model confidence threshold', help: 'Model tag assertions below this confidence (in percent) are ignored when deciding; assertions without a confidence still count.' },
    'ledger.reviewTier': {
      label: 'Minimum reviewer tier', help: 'Who can accept or reject requests to change a paper\'s tags. Reviewers must also be at least at the tier that decided the affected tags, and cannot review their own requests.',
      options: { maintainer: 'Maintainer', editor: 'Editor', contributor: 'Contributor' },
    },
    'ledger.apply': {
      label: 'How ledger decisions reach the counts', help: 'Only present tags are counted; disputed tags are always left out. Takes effect only when the service has a ledger.',
      options: { merge: 'Merge: add and remove author tags per the ledger', ledger_only: 'Use ledger decisions only', off: 'Off (author tags only)' },
    },
  },
  settingGroup: { binding: 'Tag binding', external: 'External index', cache: 'Cache', onsite: 'On-site articles', graph: 'Tag graph', http: 'Public API', ledger: 'Tag ledger' },
  settingIssue: {
    not_an_object: 'Settings are not an object; all defaults are used.',
    unknown_key: 'This version does not know this setting (it may come from a newer version); ignored until you upgrade.',
    wrong_type: 'Wrong type; the default is used.',
    out_of_range: 'Out of range; the default is used.',
    not_an_option: 'Not one of the allowed values; the default is used.',
    too_long: 'Too long; the default is used.',
  },
  settingApply: { live: 'Applies immediately', restart: 'Applies after a restart' },
  settingUnit: { credits: 'credits', days: 'days', seconds: 'seconds', items: 'items', percent: '%' },
  trustTier: { maintainer: 'maintainer', editor: 'editor', contributor: 'contributor', model: 'model' },
  workTagState: { present: 'Present', absent: 'Absent', disputed: 'Disputed (left out of counts until reviewed)' },
  requestStatus: { open: 'Open', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' },
  ledgerRefusal: {
    invalid_tag: 'The tag is invalid.',
    invalid_work: 'Unrecognised paper id (use openalex:W…, doi:10.…/… or source:id).',
    needs_change_request: 'This would overturn a decision made at a higher tier; please file a change request.',
    not_open: 'This request has already been decided.',
    self_review: 'You cannot review your own request.',
    insufficient_tier: 'Your tier is not high enough to review this request.',
    not_a_person: 'Only people can file or review requests.',
    empty_request: 'A request needs at least one change and a reason.',
    not_requester: 'Only the requester can withdraw it.',
    not_found: 'Request not found.',
  },
  contributionIssue: {
    not_an_object: 'The package is malformed; nothing was accepted.',
    bad_tagger: 'The package does not name its model and version; nothing was accepted.',
    too_many_items: 'Too many papers in one package; the rest were not accepted.',
    bad_work_id: 'Unrecognised paper id; this item was not accepted.',
    duplicate_work: 'The same paper appears twice; the later item was not accepted.',
    no_valid_tags: 'No acceptable tags in this item (invalid, outside the vocabulary, or below the confidence threshold).',
  },
  pluginSecret: {
    'external.apiKey': {
      label: 'OpenAlex API key',
      help: 'Optional. With a key, requests use your own quota; without one, the shared quota. Keep it in a server environment variable only; the engine puts it in the request header and never in URLs, logs or provenance.',
    },
  },
  rob: {
    tool: { rob2: 'RoB 2', robins_i: 'ROBINS-I', other: 'Other tool' },
    judgement: {
      low: 'Low risk', some_concerns: 'Some concerns', high: 'High risk', moderate: 'Moderate risk', serious: 'Serious risk',
      critical: 'Critical risk', no_information: 'No information', unclear: 'Unclear',
    },
    band: { low: 'Low', concerns: 'Some concerns', high: 'High', critical: 'Critical', unknown: 'No information' },
  },
  certainty: {
    level: { high: 'High', moderate: 'Moderate', low: 'Low', very_low: 'Very low' },
    // Balshem et al. 2011 (J Clin Epidemiol 64(4):401–406), table 2
    meaning: {
      high: 'We are very confident that the true effect lies close to that of the estimate of the effect.',
      moderate: 'We are moderately confident in the effect estimate: the true effect is likely to be close to the estimate of the effect, but there is a possibility that it is substantially different.',
      low: 'Our confidence in the effect estimate is limited: the true effect may be substantially different from the estimate of the effect.',
      very_low: 'We have very little confidence in the effect estimate: the true effect is likely to be substantially different from the estimate of effect.',
    },
    down: { risk_of_bias: 'risk of bias', inconsistency: 'inconsistency', indirectness: 'indirectness', imprecision: 'imprecision', publication_bias: 'publication bias' },
    up: { large_effect: 'a large effect', dose_response: 'a dose–response gradient', plausible_confounding: 'plausible confounding that would reduce the effect' },
  },
  text: {
    footnote: 'Source: {source} ({license}), retrieved {date}',
    query: 'Query: {query}',
    unknown: '{n} more works have no value on this dimension and are not in the denominator',
    usable: '{usable} of {total} records meet this level\'s requirements',
    multi_label_sum: 'A work can fall into several buckets, so buckets add up to more than {n}',
    graph_threshold: 'Only tags and co-occurrences seen at least {min} times are drawn ({records} articles)',
    graph_collapsed: '{tags} more tags and {edges} more co-occurrences fall below the threshold and are not drawn',
    pooled: 'Random-effects summary ({metric}, {k} studies): {estimate}, 95% CI {ci_low} to {ci_high}; 95% prediction interval {pi_low} to {pi_high}; I² = {i2}',
    sample: 'External works show only the {n} most cited: a sample, not the whole',
    onsite_only: 'On-site articles only; this is not all research on the topic.',
    onsite_count: '{n} on-site articles',
    scope_primary: 'Scope: works with this as their primary topic, {total} in total',
    scope_topics: 'Scope: works tagged with this topic at all, {total} in total',
    scope_other: 'The other scope gives {n} works (percentages depend on the scope)',
    cited_evidence: 'Citation evidence: of {works} works cited by articles with this tag, {in_topic} have this as their primary topic ({share}, 95% interval {ci_low}–{ci_high})',
    autocomplete_rank: 'Name search rank {rank}',
    name_exact: 'Same name',
    name_contains: 'Partly the same name',
    name_none: 'Different name',
    provisional: 'provisional',
    undeclared_design: '{n} articles declared no study design',
    queue_articles: '{n} articles',
    queue_candidate: 'Candidate topic: {topic}',
    suggestion_confidence: 'Confidence {value}',
    work_tag_decided: '{state} (decided by {tier})',
    work_tag_reviewed: '{state} (reviewed by {tier})',
    request_changes: 'Add: {add}; remove: {remove}',
    rob_record: '{tool}: {judgement}',
    rob_not_assessed: 'Risk of bias not assessed',
    rob_source: 'Assessed by {source}',
    rob_summary: 'Risk of bias ({tools}): {parts}',
    rob_missing: '{n} not assessed',
    sensitivity: 'Excluding studies at high risk of bias ({excluded} removed, {k} left): {result}',
    pooled_short: '{estimate}, 95% CI {ci_low} to {ci_high}',
    certainty: 'Certainty of evidence (GRADE): {level} for “{outcome}”; assessed by {source}',
    certainty_down: 'rated down for {list}',
    certainty_up: 'rated up for {list}',
    certainty_unavailable: 'The certainty-of-evidence ratings could not be loaded this time; please try again later.',
    list_sep: ', ',
    parts_sep: ' · ',
    clause_sep: '; ',
  },
}

export const EVIDENCE_MESSAGES: Record<EvidenceLocale, EvidenceMessageCatalog> = { zh, en }

/** 按 BCP 47 标签挑内置词典：`zh*` → 中文，其余 → 英文。 */
export function getMessages(locale?: string): EvidenceMessageCatalog {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? zh : en
}

type Sections = Omit<EvidenceMessageCatalog, 'bucket'>
/** 在一份词典上改几句（逐节浅合并；bucket 逐维度合并）。 */
export function mergeMessages(
  base: EvidenceMessageCatalog,
  override: { [K in keyof Sections]?: Partial<Sections[K]> } & { bucket?: EvidenceMessageCatalog['bucket'] },
): EvidenceMessageCatalog {
  const out = { ...base } as Record<string, unknown>
  for (const [section, patch] of Object.entries(override)) {
    if (!patch) continue
    if (section === 'bucket') {
      const merged: Record<string, Record<string, string>> = { ...(base.bucket as Record<string, Record<string, string>>) }
      for (const [dim, labels] of Object.entries(patch as Record<string, Record<string, string>>)) merged[dim] = { ...(merged[dim] ?? {}), ...labels }
      out.bucket = merged
    } else {
      out[section] = { ...(base as unknown as Record<string, object>)[section], ...(patch as object) }
    }
  }
  return out as unknown as EvidenceMessageCatalog
}

/** `{name}` 占位符替换；变量缺失时原样保留占位符（宁可露出来，也不静默吞掉）。 */
export function formatMessage(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/** 模板里出现的占位符名（测试用来比对中英两份是否一致）。 */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
}
