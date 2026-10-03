/**
 * 演示的下钻：一棵虚构的分类树（大类 → 领域 → 子领域 → 主题 → 站内标签）、几篇虚构的外部作品与站内文章。
 * 跑的是引擎真正的服务层（createEvidenceService）：外部源换成内存里的这棵树，页面不连网。
 * 名字、篇数、期刊、链接全是编的，只为演示「往里一层、作品清单、还挂着什么、互相引用（为什么引）、审阅门槛」怎么工作。
 * 外部树的名字用英文（外部文献库通常如此）；站内文章的标题与标签随界面语言。
 */
import { createEvidenceService, createMemoryBindingStore, createMemoryOnsiteSource } from '../../src/service'
import type { EvidenceService, ExternalEvidenceSource, ExternalLevel } from '../../src/service'
import { createCuratedBinding } from '../../src/tags'
import type { EvidenceRecord, EvidenceTopic, EvidenceTopicRef, EvidenceVenue } from '../../src/types'
import type { Locale } from './i18n'

interface TreeNode { level: ExternalLevel; name: string; works: number; parent: string | null }

/** 外部树：只有一条路径往里填满了（其余节点能看到篇数，点不进去） */
export const TREE: Record<string, TreeNode> = {
  '91': { level: 'domain', name: 'Life and Health Sciences', works: 31_400_000, parent: null },
  '9101': { level: 'field', name: 'Mind and Behaviour', works: 2_180_000, parent: '91' },
  '9102': { level: 'field', name: 'Nutrition and Metabolism', works: 1_460_000, parent: '91' },
  '9103': { level: 'field', name: 'Public and Community Health', works: 1_320_000, parent: '91' },
  '9104': { level: 'field', name: 'Clinical Medicine', works: 9_800_000, parent: '91' },
  '910101': { level: 'subfield', name: 'Sleep Science', works: 96_000, parent: '9101' },
  '910102': { level: 'subfield', name: 'Stress and Coping', works: 142_000, parent: '9101' },
  '910103': { level: 'subfield', name: 'Attention and Learning', works: 88_000, parent: '9101' },
  '910104': { level: 'subfield', name: 'Mood Disorders', works: 210_000, parent: '9101' },
  T9101011: { level: 'topic', name: 'Insomnia and Its Treatment', works: 18_400, parent: '910101' },
  T9101012: { level: 'topic', name: 'Circadian Rhythms in Daily Life', works: 14_900, parent: '910101' },
  T9101013: { level: 'topic', name: 'Screens, Light and Sleep', works: 6_200, parent: '910101' },
  T9101014: { level: 'topic', name: 'Sleep in Adolescents', works: 9_700, parent: '910101' },
  T9101021: { level: 'topic', name: 'Burnout at Work', works: 21_300, parent: '910102' },
  '910201': { level: 'subfield', name: 'Diet and Health', works: 305_000, parent: '9102' },
  T9102011: { level: 'topic', name: 'Diet and Sleep', works: 4_800, parent: '910201' },
}
/** 从大类到这个节点的路径（面包屑用） */
export const pathTo = (id: string): string[] => (TREE[id]?.parent ? [...pathTo(TREE[id].parent!), id] : [id])
/** 演示里填满了的那条路径：这些节点点得进去 */
export const OPEN_PATH = ['91', '9101', '910101', 'T9101011'] as const
export const START = { level: 'domain' as ExternalLevel, id: '91' }

const node = (id: string): EvidenceTopic => {
  const n = TREE[id]
  return {
    id: `openalex:${id}`, source: 'openalex', external_id: id, level: n.level, display_name: n.name, description: null,
    parent_id: n.parent ? `openalex:${n.parent}` : null, works_count: n.works,
  }
}
const ancestors = (id: string): EvidenceTopic[] => {
  const out: EvidenceTopic[] = []
  for (let p = TREE[id]?.parent; p; p = TREE[p].parent) out.push(node(p))
  return out
}
const childIds = (id: string) => Object.keys(TREE).filter((k) => TREE[k].parent === id)
const under = (topicId: string, id: string): boolean => topicId === id || (TREE[topicId]?.parent ? under(TREE[topicId].parent!, id) : false)

const venue = (id: string, name: string, type: string, is_oa: boolean | null): EvidenceVenue => ({ id: `openalex:${id}`, name, type, is_oa, issn_l: null, publisher: null })
const V = {
  quarterly: venue('S9001', 'Sleep and Rest Quarterly', 'journal', false),
  open: venue('S9002', 'Open Journal of Behavioural Health', 'journal', true),
  archive: venue('S9003', 'PsyArchive', 'repository', true),
  annals: venue('S9004', 'Annals of Clinical Rest', 'journal', false),
  letters: venue('S9005', 'Nutrition Letters', 'journal', false),
}
const ref = (id: string, name?: string): EvidenceTopicRef => ({ id: `openalex:${id}`, display_name: name ?? TREE[id]?.name ?? id })

interface Work {
  id: string; title: string; year: number; authors: string[]; cited: number; primary: string; also: EvidenceTopicRef[]; venue: EvidenceVenue | null; oa: boolean
  cites?: string[]
  /** 出版物形态（缺省 article） */
  type?: string
}
/** 虚构的外部作品：主主题决定它在哪些节点的示例里出现；引用只写同一批里的 */
const WORKS: Work[] = [
  { id: 'W9001', title: 'A randomised trial of group CBT for chronic insomnia', year: 2014, authors: ['L. Moreau', 'K. Osei', 'R. Lind', 'T. Haddad'], cited: 2310, primary: 'T9101011', also: [ref('T9101012'), ref('T9104011', 'Anxiety Symptoms in Primary Care')], venue: V.quarterly, oa: false },
  { id: 'W9002', title: 'Measuring insomnia severity: a short self-report scale', year: 2011, authors: ['A. Brandt', 'S. Ito'], cited: 1980, primary: 'T9101011', also: [ref('T9101014')], venue: V.annals, oa: true },
  { id: 'W9003', title: 'Digital CBT-I versus sleep hygiene education: two-year follow-up', year: 2019, authors: ['M. Okafor', 'J. Silva', 'P. Novak'], cited: 1240, primary: 'T9101011', also: [ref('T9101013')], venue: V.open, oa: true, cites: ['W9001', 'W9002'] },
  { id: 'W9004', title: 'Hypnotic use and next-day functioning in older adults', year: 2016, authors: ['H. Lund', 'C. Rossi'], cited: 860, primary: 'T9101011', also: [ref('T9104011', 'Anxiety Symptoms in Primary Care')], venue: V.quarterly, oa: false, cites: ['W9002'] },
  { id: 'W9005', title: 'Brief behavioural therapy for insomnia delivered by nurses', year: 2021, authors: ['E. Varga', 'N. Kim', 'D. Ahmed', 'F. Costa'], cited: 410, primary: 'T9101011', also: [ref('T9101012')], venue: V.archive, oa: true, cites: ['W9003', 'W9001'], type: 'preprint' },
  { id: 'W9010', title: 'Psychological treatments for insomnia: a systematic review', year: 2022, authors: ['C. Duarte', 'H. Lund', 'A. Brandt'], cited: 690, primary: 'T9101011', also: [ref('T9101012')], venue: V.open, oa: true, cites: ['W9001', 'W9003', 'W9005'], type: 'review' },
  { id: 'W9006', title: 'Light exposure in the evening shifts circadian timing', year: 2013, authors: ['R. Patel', 'G. Ferreira'], cited: 3120, primary: 'T9101012', also: [ref('T9101013')], venue: V.open, oa: true },
  { id: 'W9007', title: 'Smartphone use at bedtime and sleep onset in teenagers', year: 2018, authors: ['Y. Chen', 'B. Mensah', 'O. Petrov'], cited: 1630, primary: 'T9101013', also: [ref('T9101014')], venue: V.annals, oa: false, cites: ['W9006'] },
  { id: 'W9008', title: 'Coping styles and burnout in hospital staff', year: 2015, authors: ['I. Nowak', 'S. Haddad'], cited: 2790, primary: 'T9101021', also: [ref('T9101011')], venue: V.open, oa: true, type: 'review' },
  { id: 'W9009', title: 'Dietary patterns and sleep duration: a cohort study', year: 2017, authors: ['J. Andersen', 'L. Wu', 'M. Rahman'], cited: 1520, primary: 'T9102011', also: [ref('T9101011')], venue: V.letters, oa: false },
]

const toRecord = (w: Work): EvidenceRecord => ({
  id: `openalex:${w.id}`, source: 'openalex', external_id: w.id, title: w.title, year: w.year, authors: w.authors,
  doi: `https://doi.org/10.5555/demo.${w.id.toLowerCase()}`, url: `https://doi.org/10.5555/demo.${w.id.toLowerCase()}`,
  topic_ids: [`openalex:${w.primary}`], study_type: null, publication_type: w.type ?? 'article', self_reported_claim: null, direction: null, effect: null,
  cited_by_count: w.cited, is_retracted: false, is_open_access: w.oa,
  provenance: { source_label: 'OpenAlex (demo data)', license: 'CC0 1.0', retrieved_at: '2026-10-01T00:00:00Z' },
  venue: w.venue, oa_url: w.oa ? `https://example.org/demo/${w.id}` : null,
  topics: [ref(w.primary), ...w.also],
})

/** 外部源：按节点给缩放包、往里一层与示例作品（示例按被引从多到少；引用只连同一批里的，与真适配器同一个规矩） */
export const demoExternal: ExternalEvidenceSource = {
  id: 'openalex',
  async suggestTopics() { return [] },
  async nodeBundle(_level, id) {
    if (!TREE[id]) return null
    const parent = TREE[id].parent
    return { node: node(id), ancestors: ancestors(id), siblings: parent ? childIds(parent).filter((k) => k !== id).map(node) : [] }
  },
  async children(_level, id) {
    return TREE[id] ? { children: childIds(id).map(node).sort((a, b) => (b.works_count ?? 0) - (a.works_count ?? 0)) } : null
  },
  async sampleWorks(_level, id, limit) {
    const batch = WORKS.filter((w) => under(w.primary, id)).sort((a, b) => b.cited - a.cited).slice(0, limit)
    const ids = new Set(batch.map((w) => w.id))
    return batch.map((w) => {
      const cites = (w.cites ?? []).filter((c) => ids.has(c)).map((c) => `openalex:${c}`)
      return cites.length > 0 ? { ...toRecord(w), cites } : toRecord(w)
    })
  },
}

/** 一条参考文献：引用哪篇（外部作品或站内文章的 id），可以带「为什么引」与谁标的；只写 id 的＝没说明为什么引 */
type Ref = string | { to: string; functions: string[]; by?: 'author' | 'editor' | 'machine' }
interface Article {
  id: string; title: Record<Locale, string>; tags: Record<Locale, string[]>; year: number; reviewed: boolean
  design: string; doi?: string; refs?: Ref[]
}
/** 虚构的站内文章：有的审阅过（比如有认证专家评论过），有的还没有；参考文献里有上面的外部作品，有的写明了为什么引 */
const ARTICLES: Article[] = [
  { id: 'a1', year: 2025, reviewed: true, design: 'non_randomised_controlled', doi: '10.5555/demo.site.a1',
    refs: [{ to: 'W9001', functions: ['extends', 'confirms'] }, { to: 'W9002', functions: ['uses_method'] }],
    title: { zh: '失眠认知行为治疗：八周后的随访', en: 'CBT for insomnia: eight weeks later' },
    tags: { zh: ['失眠', 'CBT-I', '焦虑'], en: ['insomnia', 'CBT-I', 'anxiety'] } },
  { id: 'a2', year: 2024, reviewed: true, design: 'cross_sectional',
    refs: [{ to: 'W9003', functions: ['confirms'], by: 'editor' }],
    title: { zh: '大学生的睡眠卫生教育有没有用', en: 'Does sleep hygiene education help students?' },
    tags: { zh: ['睡眠卫生', '失眠'], en: ['sleep hygiene', 'insomnia'] } },
  { id: 'a3', year: 2025, reviewed: false, design: 'case_series',
    title: { zh: '倒班工作者的褪黑素使用', en: 'Melatonin use among shift workers' },
    tags: { zh: ['失眠', '褪黑素'], en: ['insomnia', 'melatonin'] } },
  { id: 'a4', year: 2023, reviewed: true, design: 'qualitative',
    refs: [{ to: 'W9003', functions: ['extends'] }, { to: 'a1', functions: ['background'], by: 'machine' }],
    title: { zh: '数字化 CBT-I 为什么坚持不下去', en: 'Why people stop using digital CBT-I' },
    tags: { zh: ['CBT-I', '失眠', '数字健康'], en: ['CBT-I', 'insomnia', 'digital health'] } },
  { id: 'a5', year: 2025, reviewed: false, design: 'cross_sectional',
    title: { zh: '睡前刷手机与入睡时间', en: 'Phones in bed and time to fall asleep' },
    tags: { zh: ['睡眠卫生', '手机'], en: ['sleep hygiene', 'phones'] } },
  { id: 'a6', year: 2022, reviewed: true, design: 'cohort', refs: ['W9001'],
    title: { zh: '规律运动与睡眠质量', en: 'Regular exercise and sleep quality' },
    tags: { zh: ['运动', '睡眠卫生'], en: ['exercise', 'sleep hygiene'] } },
]
const doiOf = (id: string) => (id.startsWith('W') ? `10.5555/demo.${id.toLowerCase()}` : `10.5555/demo.site.${id}`)
/** 编辑绑到主题「Insomnia and Its Treatment」的站内标签 */
const BOUND: Record<Locale, string[]> = { zh: ['失眠', 'CBT-I', '睡眠卫生'], en: ['insomnia', 'CBT-I', 'sleep hygiene'] }

export const demoArticles = (locale: Locale) => ARTICLES.map((a) => ({
  id: a.id, title: a.title[locale], tags: a.tags[locale], year: a.year, url: `https://example.org/site/${a.id}`, study_design: a.design,
  ...(a.doi ? { doi: a.doi } : {}),
  ...(a.reviewed ? { reviewed_at: `${a.year}-11-01T00:00:00Z` } : {}),
  ...(a.refs ? {
    references: a.refs.map((r) => (typeof r === 'string' ? doiOf(r) : { doi: doiOf(r.to), functions: r.functions, declared_by: r.by ?? 'author' })),
  } : {}),
}))

/** 每种语言一个服务（站内文章的标题与标签随语言）；审阅门槛读页面上的开关，切换后下一次请求就生效 */
export function createDemoExplorer(locale: Locale, gate: () => boolean): EvidenceService {
  const bindings = createMemoryBindingStore(BOUND[locale].flatMap((tag) => {
    const b = createCuratedBinding({ tag, topic: { id: 'openalex:T9101011', display_name: TREE.T9101011.name }, by: 'demo editor', at: '2026-10-01T00:00:00Z' })
    return b ? [b] : []
  }))
  return createEvidenceService({
    onsite: createMemoryOnsiteSource(demoArticles(locale)),
    external: demoExternal,
    bindings,
    settings: () => ({ 'onsite.reviewGate': gate() ? 'reviewed_only' : 'off' }),
    onsiteLabel: locale === 'zh' ? '演示站' : 'Demo site',
    onsiteLicense: 'CC BY 4.0',
    now: () => new Date('2026-10-01T00:00:00Z'),
    log: () => {},
  })
}
