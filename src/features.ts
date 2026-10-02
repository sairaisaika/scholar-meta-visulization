/**
 * 功能登记表——**每个功能都有生产端与消费端**，写明中间流的是哪个契约类型、从哪个入口拿、走哪个读口。
 * ─────────────────────────────────────────────────────────────────────────────
 * 这张表不是文档，是约束：`test/features.test.ts` 逐行核对
 *   ① 生产端 / 消费端的导出真实存在且是函数（服务方法会真的构造一个服务去看）；
 *   ② payload 是契约（types.ts）里真实导出的类型；
 *   ③ 读口在服务端路由表与浏览器客户端路由表里都有、路径一致；每个读口至少被一个功能用到（没有孤儿读口）。
 * 加一个功能 = 在这里加一行 + 写两端；少写一端测试就红。
 *
 * 生产端＝从原始输入（记录、格子、外部源、编辑操作）算出 payload 的那段代码（服务端）；
 * 消费端＝把 payload 变成读者 / 作者 / 编辑能看的东西的那段代码（present.ts 的视图模型，浏览器里跑）。
 */

export type EvidenceEntry = 'scholar-meta' | 'scholar-meta/openalex' | 'scholar-meta/service' | 'scholar-meta/http' | 'scholar-meta/client'

export interface EvidenceFeatureEnd {
  entry: EvidenceEntry
  /** src/ 下的模块名（不带扩展名） */
  module: string
  export: string
  /** 生产端是服务对象上的方法时：`createEvidenceService(...)` 返回值上的方法名 */
  method?: string
}

export interface EvidenceFeature {
  id: string
  /** 它替谁回答什么问题 */
  answers: string
  /** 两端之间流动的契约类型（types.ts 里的导出名） */
  payload: string
  producer: EvidenceFeatureEnd
  consumer: EvidenceFeatureEnd
  /** 走哪个公开读口；作者 / 编辑侧的功能不经公开读口，为 null */
  route: 'map' | 'counts' | 'tag_counts' | 'tag_graph' | null
  audience: 'reader' | 'author' | 'editor'
}

const main = (module: string, exp: string): EvidenceFeatureEnd => ({ entry: 'scholar-meta', module, export: exp })
const svc = (method: string): EvidenceFeatureEnd => ({ entry: 'scholar-meta/service', module: 'service', export: 'createEvidenceService', method })

export const EVIDENCE_FEATURES: readonly EvidenceFeature[] = [
  {
    id: 'evidence_map', audience: 'reader', route: 'map', payload: 'EvidenceMapData',
    answers: '一个标签（或一个主题）下有哪些站内与站外研究，能诚实画到哪一级',
    producer: svc('getTagMap'), consumer: main('present', 'presentEvidenceMap'),
  },
  {
    id: 'node_map', audience: 'reader', route: 'map', payload: 'EvidenceMapData',
    answers: '缩小一级（主题 → 子领域 → 领域 → 大类）之后看到什么',
    producer: svc('getNodeMap'), consumer: main('present', 'presentEvidenceMap'),
  },
  {
    id: 'node_children', audience: 'reader', route: 'map', payload: 'EvidenceTopic',
    answers: '往里一层：一个节点分成哪些更细的节点（大类 → 领域 → 子领域 → 主题 → 站内标签），各有多少篇',
    producer: svc('getNodeMap'), consumer: main('present', 'presentNodeChildren'),
  },
  {
    id: 'work_details', audience: 'reader', route: 'map', payload: 'EvidenceRecord',
    answers: '一个节点里的作品：发在哪本期刊、能不能免费读（链接）、还挂着哪些别的主题、在这批里引用了谁',
    producer: { entry: 'scholar-meta/openalex', module: 'openalex', export: 'createOpenAlexSource' }, consumer: main('present', 'presentWorks'),
  },
  {
    id: 'record_facets', audience: 'reader', route: 'map', payload: 'EvidenceTopicRef',
    answers: '这批作品还挂着哪些别的主题与站内标签、发在哪些期刊（只在这批里数，不代表全体）',
    producer: svc('getNodeMap'), consumer: main('present', 'presentRecordFacets'),
  },
  {
    id: 'evidence_view', audience: 'reader', route: 'map', payload: 'EvidenceViewDecision',
    answers: '这批记录最强能画成什么图，为什么不是更强的那一种',
    producer: main('ladder', 'pickEvidenceView'), consumer: main('present', 'presentView'),
  },
  {
    id: 'pooling', audience: 'reader', route: 'map', payload: 'EvidencePooling',
    answers: '能不能画汇总菱形；能画时汇总估计、置信区间与预测区间是多少',
    producer: main('ladder', 'poolEvidence'), consumer: main('present', 'presentView'),
  },
  {
    id: 'pooling_sensitivity', audience: 'reader', route: 'map', payload: 'EvidencePoolingSensitivity',
    answers: '去掉偏倚风险高的研究之后，汇总的结论还站不站得住（主分析不变）',
    producer: main('ladder', 'poolEvidence'), consumer: main('present', 'presentView'),
  },
  {
    id: 'risk_of_bias', audience: 'reader', route: 'map', payload: 'EvidenceRiskOfBias',
    answers: '每项研究的偏倚风险是谁评的、评成什么（引擎不评，只验形与转述；没评过不当成低风险）',
    producer: main('appraisal', 'checkRiskOfBias'), consumer: main('present', 'presentRiskOfBias'),
  },
  {
    id: 'certainty', audience: 'reader', route: 'map', payload: 'EvidenceCertainty',
    answers: '编辑或外部综述对某个结局的证据确定性（GRADE）评成哪一档、为什么升降级',
    producer: main('appraisal', 'checkCertainty'), consumer: main('present', 'presentCertainty'),
  },
  {
    id: 'tag_binding', audience: 'reader', route: 'map', payload: 'EvidenceTagBinding',
    answers: '这个标签对应外部哪个主题，是编辑确认的还是机器按名字猜的',
    producer: main('tags', 'resolveTagBinding'), consumer: main('present', 'presentBinding'),
  },
  {
    id: 'record_edges', audience: 'reader', route: 'map', payload: 'EvidenceEdge',
    answers: '这批记录之间谁引用了谁（站内文章申报的参考文献、外部作品自带的引用，只连同一批里的）、哪些站内文章共有别的标签（共现，不是引用）',
    producer: main('onsite', 'buildRecordEdges'), consumer: main('present', 'presentEvidenceMap'),
  },
  {
    id: 'external_counts', audience: 'reader', route: 'counts', payload: 'EvidenceCountsData',
    answers: '这个主题的全量文献按年份、机构、国家、语言、开放获取……怎么分布（分母各自声明）',
    producer: { entry: 'scholar-meta/openalex', module: 'openalex-counts', export: 'fetchEvidenceCounts' }, consumer: main('present', 'presentCounts'),
  },
  {
    id: 'chart_availability', audience: 'reader', route: 'counts', payload: 'EvidenceChartAvailability',
    answers: '每个维度下哪些图能画、画不了的差什么',
    producer: main('charts', 'chartAvailability'), consumer: main('present', 'presentChartMenu'),
  },
  {
    id: 'onsite_counts', audience: 'reader', route: 'tag_counts', payload: 'EvidenceOnsiteCounts',
    answers: '一个标签下的站内文章按年份、研究设计、共现标签、自报结果怎么分布',
    producer: main('onsite', 'countOnsiteLayer'), consumer: main('present', 'presentOnsiteCounts'),
  },
  {
    id: 'tag_graph', audience: 'reader', route: 'tag_graph', payload: 'EvidenceTagGraph',
    answers: '站内标签之间谁常和谁一起出现（共现，不是引用），被门槛折叠了多少',
    producer: main('onsite', 'buildTagGraph'), consumer: main('present', 'presentTagGraph'),
  },
  {
    id: 'review_gate', audience: 'reader', route: 'map', payload: 'EvidenceMapData',
    answers: '开了审阅门槛时：哪些站内文章算进标签与研究图谱（接入方标了审阅时间的），还有几篇在等审阅',
    producer: main('onsite', 'applyReviewGate'), consumer: main('present', 'presentEvidenceMap'),
  },
  {
    id: 'article_intake', audience: 'author', route: null, payload: 'EvidenceIntakeIssue',
    answers: '作者申报的研究设计、效应量、区间、p 值哪里不对，引擎怎么处理了',
    producer: main('onsite', 'intakeArticle'), consumer: main('present', 'presentIntakeIssues'),
  },
  {
    id: 'binding_suggestions', audience: 'editor', route: null, payload: 'EvidenceBindingSuggestion',
    answers: '一个标签该绑到哪个主题：按名字的候选与按引用的证据',
    producer: svc('suggestBindings'), consumer: main('present', 'presentBindingSuggestions'),
  },
  {
    id: 'binding_queue', audience: 'editor', route: null, payload: 'EvidenceBindingQueueItem',
    answers: '哪些标签还没有编辑结论、各有多少篇文章、读者现在看到的是什么、机器给的候选是什么',
    producer: svc('bindingQueue'), consumer: main('present', 'presentBindingQueue'),
  },
  {
    id: 'plugin_settings', audience: 'editor', route: null, payload: 'EvidenceSettings',
    answers: '后台插件页上这个插件有哪些设置、现在的值、哪些值不合法被退回了缺省值',
    producer: main('settings', 'validateSettings'), consumer: main('present', 'presentSettingsForm'),
  },
  {
    id: 'plugin_manifest', audience: 'editor', route: null, payload: 'EvidencePluginManifest',
    answers: 'GitHub 上的新版本比已装的多了哪些设置与功能（升级之前就能看到）',
    producer: main('manifest', 'buildPluginManifest'), consumer: main('manifest', 'diffPluginManifests'),
  },
  {
    id: 'auto_tagging', audience: 'editor', route: null, payload: 'EvidenceTagAssertion',
    answers: '接入方自己的模型给论文打了哪些标签（验过形、带置信度与模型版本），写进账本之前给人看',
    producer: main('tagging', 'runTagger'), consumer: main('present', 'presentTagSuggestions'),
  },
  {
    id: 'tag_ledger', audience: 'editor', route: null, payload: 'EvidenceWorkTag',
    answers: '一篇论文现在有哪些标签、由哪一级决定、哪些有争议（人压过模型，最高一级内部分歧即争议）',
    producer: main('ledger', 'resolveWorkTags'), consumer: main('present', 'presentWorkTags'),
  },
  {
    id: 'tag_change_requests', audience: 'editor', route: null, payload: 'EvidenceTagChangeRequest',
    answers: '谁申请改哪篇论文的标签、理由、审核结果（不能审自己的，层级要够）',
    producer: main('ledger', 'decideChangeRequest'), consumer: main('present', 'presentChangeRequests'),
  },
  {
    id: 'tag_contributions', audience: 'editor', route: null, payload: 'EvidenceTagContribution',
    answers: '愿意共享的人把自己模型打的标签打包交来；收包方验形（用自己的词表、自己定层级）后写进账本',
    producer: main('tagging', 'buildTagContribution'), consumer: main('tagging', 'validateTagContribution'),
  },
  {
    id: 'curation', audience: 'editor', route: null, payload: 'EvidenceTagBinding',
    answers: '编辑确认或否决一条绑定（之后标签级与主题级都按它来）',
    producer: svc('curate'), consumer: main('present', 'presentBinding'),
  },
]
