/**
 * 演示页自己的界面文案（中 / 英）。引擎的文案（阶梯各级的名字、降级原因、图种名、画不了的原因……）一律用引擎词典，不在这里重写。
 */
import type { EvidenceViewKind } from '../../src/types'
import type { ScenarioId } from './fixtures'

export type Locale = 'zh' | 'en'

interface ScenarioText { name: string; about: string }

export interface DemoText {
  title: string
  /** 冒号：中文全角，英文半角加空格 */
  sep: string
  tagline: string
  intro: string
  fictional: string
  source: string
  ladderTitle: string
  ladderLead: string
  scenarios: Record<ScenarioId, ScenarioText>
  requires: Record<EvidenceViewKind, string>
  reached: string
  missing: string
  notReached: string
  alsoPossible: string
  satisfied: (usable: number, total: number) => string
  /** 点估计与区间：0.42（0.10 至 0.74） */
  interval: (value: string, lo: string, hi: string) => string
  /** 分组名带个数：偏向干预（5） */
  counted: (label: string, n: number) => string
  whyNotHigher: string
  pooling: string
  study: (key: string) => string
  pooledRow: string
  predictionNote: string
  favoursRight: string
  favoursLeft: string
  effectAxis: string
  noDiamond: string
  estimatesNote: (median: string, q1: string, q3: string) => string
  median: string
  pAxis: string
  nAxis: string
  contour: string
  heightNote: string
  countByDesign: string
  claimsNote: string
  table: string
  columns: { study: string; design: string; direction: string; effect: string; ci: string; p: string; n: string; claim: string; rob: string }
  /** 偏倚风险与证据确定性（0.3.0） */
  robHeader: string
  riskOfBias: string
  sensitivity: string
  certainty: string
  certaintyExample: { outcome: string; source: string }
  appraisalNote: string
  /** 下钻（0.4.0） */
  explore: {
    title: string; lead: string; gate: string; gateHelp: string; crumbs: string; works: string; linksHint: string
    facetTopics: string; facetTags: string; facetVenues: string; locked: string; loading: string; unavailable: string
    none: string; fake: string; fakeLink: string
    /** 引用为什么引、一篇文章的位置（0.5.0） */
    ctxOpen: string; citeTitle: string; citeLead: string; undeclaredChip: string; meaningTitle: string
  }
  menuTitle: string
  menuLead: string
  presets: Record<PresetId, string>
  controls: {
    partition: string; buckets: string; isYear: string; hasCross: string; hasOverlap: string
    onsite: string; onsiteN: string; sampleGate: string; gateUnset: string; gatePass: string; gateFail: string; records: string
  }
  canDraw: string
  cannotDraw: string
  footer: string
}

export type PresetId = 'design' | 'year' | 'topics' | 'onsite_small' | 'onsite_gate'

export const TEXT: Record<Locale, DemoText> = {
  zh: {
    title: 'scholar-meta 演示',
    sep: '：',
    tagline: '手上有什么数据，就诚实地画到哪一级。',
    intro: '这一页在浏览器里直接跑引擎的判据。换一组研究，看它能画到证据阶梯的哪一级、为什么不是更高一级；从大类一路点到文章，看每一层往里有什么、文章发在哪、能不能免费读、互相怎么引用；换一种格子的形状，看哪些图能画、画不了的差在哪。',
    fictional: '所有研究都是虚构的样例，只为演示判据。页面不连网。',
    source: '源码与文档',
    ladderTitle: '证据阶梯',
    ladderLead: '同一套判据，按手上的字段从上往下找：第一级能满足的就是能诚实画到的最高一级。',
    scenarios: {
      pooled: { name: '6 项随机对照试验，都有效应量与置信区间', about: '效应量度量相同、结局方向相同、设计相同，而且至少 5 项：可以画汇总菱形。其中一项偏倚风险高，另给去掉它之后的结果。' },
      mixed: { name: '同样的数，但设计混杂', about: '其中两项换成队列研究。森林图照画，但随机与非随机不合并，不画菱形。' },
      estimates: { name: '只有点估计', about: '报了效应量，但没有置信区间：只画点，不画区间、不画菱形。' },
      albatross: { name: '只有方向、精确 p 与样本量', about: '没有效应量，但报了精确 p 值与样本量：用 p 与样本量看效应的量级。' },
      direction: { name: '只知道方向', about: '只说了偏向干预还是不利于干预：按方向计数，不按显著性计数。' },
      claims: { name: '只有作者自报「显著 / 不显著」', about: '按显著性计票不构成证据合成：只回答有没有研究、多少、什么设计。' },
    },
    requires: {
      forest: '效应量 + 95% 置信区间，至少 1 项',
      estimates: '效应量（点估计），至少 1 项',
      albatross: '方向 + 精确 p + 样本量，至少 2 项',
      direction: '效应方向，至少 1 项',
      gap_map: '任何记录',
    },
    reached: '能画到这一级',
    missing: '差这一条',
    notReached: '没到',
    alsoPossible: '也能画，但信息更少',
    satisfied: (usable, total) => `${usable} / ${total} 项满足`,
    interval: (value, lo, hi) => `${value}（${lo} 至 ${hi}）`,
    counted: (label, n) => `${label}（${n}）`,
    whyNotHigher: '为什么不是更高一级',
    pooling: '汇总',
    study: (key) => `研究 ${key}`,
    pooledRow: '汇总（随机效应）',
    predictionNote: '细线是 95% 预测区间：下一项研究的真实效应大概落在这个范围。',
    favoursRight: '偏向干预 →',
    favoursLeft: '← 偏向对照',
    effectAxis: '标准化均数差（SMD）',
    noDiamond: '不画汇总菱形：',
    estimatesNote: (median, q1, q3) => `中位数 ${median}，四分位距 ${q1} 至 ${q3}。`,
    median: '中位数',
    pAxis: 'p 值（左：不利于干预；右：偏向干预）',
    nAxis: '样本量 N',
    contour: '等效应线：标准化均数差 d',
    heightNote: '柱高表示研究设计：高＝随机对照，中＝队列等观察性研究，低＝横断面与病例系列。',
    countByDesign: '按研究设计计数',
    claimsNote: '这些研究只自报了「显著 / 不显著」。按显著性计票会把样本不够、没能排除重要效应的研究也算成「没有效果」，研究越多越失真（Cochrane Handbook 12.2.2.1），所以这里不画任何显著与不显著的对比。',
    table: '表格',
    columns: { study: '研究', design: '设计', direction: '方向', effect: '效应量', ci: '95% 置信区间', p: 'p', n: 'N', claim: '作者自报', rob: '偏倚风险' },
    robHeader: '偏倚',
    riskOfBias: '偏倚风险',
    sensitivity: '敏感性分析',
    certainty: '证据确定性',
    certaintyExample: { outcome: '焦虑症状评分（虚构）', source: '虚构的评定人（仅供演示）' },
    appraisalNote: '偏倚风险与证据确定性都是演示用的虚构评定。引擎不评，只核对接入方传进来的评定、写明是谁评的，并据此另给一个去掉高风险研究的敏感性分析。',
    explore: {
      title: '下钻：从大类一路点到文章',
      lead: '每一层列出往里一层：大类 → 领域 → 子领域 → 主题，主题再往里是编辑绑到它的站内标签。条长只用来比大小——一篇作品可以同时在几个子节点下，所以不给占比。点到最里层，看这里有哪些文章、是什么样的研究、发在哪本期刊、能不能免费读、还挂着哪些别的主题与标签、互相怎么引用、为什么引。',
      gate: '审阅门槛：只计入审阅过的站内文章',
      gateHelp: '比如「至少有一条认证专家的评论」——谁算专家、什么算审阅由站点定，引擎只看站点标的审阅时间。没审阅的文章照常发表，只是暂不计入标签与图谱，并写明还有几篇在等。',
      crumbs: '位置',
      works: '文章',
      linksHint: '指针移到（或键盘选中）一篇文章上，会标出这一批里和它有引用关系的文章。',
      facetTopics: '这批作品还挂着的主题',
      facetTags: '这批文章还挂着的站内标签',
      facetVenues: '发在哪些期刊',
      locked: '演示只填了一条路径，灰着的点不进去。',
      loading: '正在取数据…',
      unavailable: '暂时取不到，稍后再试。',
      none: '没有',
      fake: '这一节的分类、篇数、文章、期刊与链接都是虚构的。跑的是引擎真正的服务层，外部文献库换成了内存里的一棵树，页面不连网。',
      ctxOpen: '它是什么研究、和这里的文章怎么联系',
      citeTitle: '这批作品之间的引用：为什么引',
      citeLead: '只转述作者或编辑写明的用途（也可以接机器判读，会标明）。外部文献库不提供用途，没写明的就写「没说明」，引擎不猜。',
      undeclaredChip: '没说明为什么引',
      meaningTitle: '这些用途各推进了什么',
      fakeLink: '演示用的虚构链接',
    },
    menuTitle: '图种菜单',
    menuLead: '判据只看格子的形状：互斥吗、有几个桶、是不是年份、有没有交叉表或重叠计数。画不了的图不藏起来，灰着并写明差什么。',
    presets: {
      design: '研究设计分布',
      year: '发表年份',
      topics: '主题（一篇可属多个）',
      onsite_small: '站内文章，只有 12 篇',
      onsite_gate: '站内文章，接入方样本门没过',
    },
    controls: {
      partition: '桶互斥（一篇只进一个桶）', buckets: '有值的桶数', isYear: '这一维是年份', hasCross: '有两维交叉表', hasOverlap: '有重叠计数',
      onsite: '格子由站内文章数出来', onsiteN: '篇数', sampleGate: '接入方样本门', gateUnset: '不设', gatePass: '通过', gateFail: '没过',
      records: '带上上面选中场景的研究（记录级的四张图按阶梯同判）',
    },
    canDraw: '能画',
    cannotDraw: '画不了',
    footer: '判据出处与每种图回答什么、不回答什么，见仓库里的 docs/charts.md 与 src/ladder.ts 的注释。',
  },
  en: {
    title: 'scholar-meta demo',
    sep: ': ',
    tagline: 'Draw exactly as far as your data honestly allows.',
    intro: 'This page runs the engine’s rules in your browser. Pick a set of studies to see which rung of the evidence ladder it reaches and why not higher; drill down from a domain to the articles to see what each level contains, where the articles were published, whether they are free to read and how they cite each other; change the shape of a set of counts to see which charts can be drawn and what the others are missing.',
    fictional: 'All studies are fictional examples made up to show the rules. The page makes no network requests.',
    source: 'Source and docs',
    ladderTitle: 'The evidence ladder',
    ladderLead: 'One rule set, read top-down against the fields you have: the first rung your data satisfies is the highest you can honestly draw.',
    scenarios: {
      pooled: { name: '6 randomised trials with effect sizes and CIs', about: 'Same metric, same outcome direction, same design and at least 5 studies: a pooled diamond is allowed. One study is at high risk of bias, so the result without it is shown too.' },
      mixed: { name: 'Same numbers, mixed designs', about: 'Two of the studies are cohort studies. The forest plot still draws, but randomised and non-randomised studies are not pooled.' },
      estimates: { name: 'Point estimates only', about: 'Effect sizes without confidence intervals: points only, no intervals, no diamond.' },
      albatross: { name: 'Direction, exact p and sample size only', about: 'No effect sizes, but exact p values and sample sizes: p and N show the magnitude of the effect.' },
      direction: { name: 'Direction only', about: 'Each study only says whether it favours the intervention: count by direction, never by significance.' },
      claims: { name: 'Only “significant / not significant” claims', about: 'Vote counting by significance is not evidence synthesis: show only whether there are studies, how many and of what design.' },
    },
    requires: {
      forest: 'Effect size + 95% CI, at least 1 study',
      estimates: 'Effect size (point estimate), at least 1 study',
      albatross: 'Direction + exact p + sample size, at least 2 studies',
      direction: 'Effect direction, at least 1 study',
      gap_map: 'Any records',
    },
    reached: 'Highest rung reached',
    missing: 'Missing',
    notReached: 'Not reached',
    alsoPossible: 'Also possible, with less information',
    satisfied: (usable, total) => `${usable} of ${total} qualify`,
    interval: (value, lo, hi) => `${value} (${lo} to ${hi})`,
    counted: (label, n) => `${label} (${n})`,
    whyNotHigher: 'Why not higher',
    pooling: 'Pooling',
    study: (key) => `Study ${key}`,
    pooledRow: 'Pooled (random effects)',
    predictionNote: 'The thin line is the 95% prediction interval: where the true effect of a new study would likely fall.',
    favoursRight: 'Favours intervention →',
    favoursLeft: '← Favours control',
    effectAxis: 'Standardised mean difference (SMD)',
    noDiamond: 'No pooled diamond: ',
    estimatesNote: (median, q1, q3) => `Median ${median}, interquartile range ${q1} to ${q3}.`,
    median: 'Median',
    pAxis: 'p value (left: against the intervention; right: in favour)',
    nAxis: 'Sample size N',
    contour: 'Contours: standardised mean difference d',
    heightNote: 'Bar height shows the design: tall = randomised trial, medium = cohort and other observational, short = cross-sectional and case series.',
    countByDesign: 'Studies by design',
    claimsNote: 'These studies only report “significant / not significant”. Counting votes by significance counts underpowered studies that cannot rule out important effects as showing no effect, and gets worse as studies accumulate (Cochrane Handbook 12.2.2.1), so no significant-versus-not comparison is drawn here.',
    table: 'Table',
    columns: { study: 'Study', design: 'Design', direction: 'Direction', effect: 'Effect', ci: '95% CI', p: 'p', n: 'N', claim: 'Author claim', rob: 'Risk of bias' },
    robHeader: 'RoB',
    riskOfBias: 'Risk of bias',
    sensitivity: 'Sensitivity analysis',
    certainty: 'Certainty of evidence',
    certaintyExample: { outcome: 'Anxiety symptom score (fictional)', source: 'a fictional rater (demo only)' },
    appraisalNote: 'The risk-of-bias judgements and the certainty rating are fictional. The engine does not assess either: it checks what the host passes in, says who assessed it, and adds a sensitivity analysis without the high-risk studies.',
    explore: {
      title: 'Drill down: from a domain to the articles',
      lead: 'Each level lists the next one in: domain → field → subfield → topic, and inside a topic the on-site tags an editor bound to it. Bar length only compares sizes: a work can sit under several children, so no shares are given. At the innermost level, see which articles are there, what kind of study each is, where they were published, whether they are free to read, which other topics and tags they carry, how they cite each other and why.',
      gate: 'Review gate: count reviewed on-site articles only',
      gateHelp: 'For example “at least one comment from a verified expert”: the site decides who counts as an expert and what counts as a review; the engine only reads the review time the site sets. Unreviewed articles stay published but are not counted yet, and the page says how many are waiting.',
      crumbs: 'Location',
      works: 'Articles',
      linksHint: 'Point at (or tab to) an article to mark the articles in this batch it cites or is cited by.',
      facetTopics: 'Other topics these works carry',
      facetTags: 'Other on-site tags these articles carry',
      facetVenues: 'Where they were published',
      locked: 'Only one path is filled in for the demo; greyed-out rows cannot be opened.',
      loading: 'Loading…',
      unavailable: 'Not available right now; try again later.',
      none: 'None',
      fake: 'The taxonomy, counts, articles, journals and links in this section are fictional. It runs the engine’s real service layer with the external index replaced by an in-memory tree; the page makes no network requests.',
      ctxOpen: 'What kind of study it is, and how it links to the others here',
      citeTitle: 'Citations in this batch: why they cite',
      citeLead: 'Only purposes an author or editor stated are shown (a machine classifier can be plugged in and is labelled as such). The external index gives no purposes; unstated ones are shown as unstated, and the engine does not guess.',
      undeclaredChip: 'No reason given',
      meaningTitle: 'What each purpose advances',
      fakeLink: 'a fictional demo link',
    },
    menuTitle: 'The chart menu',
    menuLead: 'The rules only look at the shape of the counts: are buckets exclusive, how many there are, is it years, is there a cross-table or overlap counts. Charts that cannot be drawn are not hidden; they are greyed out with what is missing.',
    presets: {
      design: 'Study design breakdown',
      year: 'Publication year',
      topics: 'Topics (a study can have several)',
      onsite_small: 'On-site articles, only 12',
      onsite_gate: 'On-site articles, host sample gate not met',
    },
    controls: {
      partition: 'Exclusive buckets (each study in one)', buckets: 'Buckets with counts', isYear: 'This dimension is year', hasCross: 'Has a two-way cross-table', hasOverlap: 'Has overlap counts',
      onsite: 'Counts come from on-site articles', onsiteN: 'Articles', sampleGate: 'Host sample gate', gateUnset: 'Not set', gatePass: 'Met', gateFail: 'Not met',
      records: 'Include the studies of the scenario above (the four record-level charts follow the ladder)',
    },
    canDraw: 'Can draw',
    cannotDraw: 'Cannot draw',
    footer: 'Sources for every rule, and what each chart answers and does not, are in docs/charts.md and the comments of src/ladder.ts.',
  },
}
