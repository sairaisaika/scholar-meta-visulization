/**
 * OpenAlex 适配器——第一个外部证据源。
 * ─────────────────────────────────────────────────────────────────────────────
 * 【用法】`createOpenAlexClient({ apiKey, baseUrl, fetch, log, dailyCreditBudget, onCredits }, settings?)`；全部可选。
 *   第二个参数是后台存的设置包（静态对象、函数或 `createLiveSettings` 的结果）：用 `external.dailyCreditBudget` 与 `external.sampleSize`，
 *   给了的键压过代码选项，认不出的键忽略——后台改了值就生效，上游加了设置项、接入方不改代码也能用上。
 *   · `apiKey`：OpenAlex 免费 key（每天 $1 额度；不带 key 是匿名，约 $0.1）。可以传函数，每次请求现取（宿主从 env 读）。
 *   · `baseUrl`：默认 `https://api.openalex.org`；自建镜像或代理时改它。
 *   · `fetch` / `log`：注入自己的实现（测试、日志系统）；不传就用全局 `fetch` 与 `console.error`，**调用时才取**，便于测试替换。
 *   · `dailyCreditBudget`：每个 UTC 日最多花多少 credit（按响应头 `x-ratelimit-credits-used` 累计）。花完之后，
 *     要花钱的请求（列表 / 计数 / group_by / 上级三级实体）直接当失败回 null，免费的（自动补全、主题实体）照常。
 *     多人站点必须设：计数读口一个节点冷启动约 17 credit，放任爬虫遍历主题，匿名额度一小时就见底，之后当天全站外部层都挂。
 *     计数器在客户端实例内存里；多实例部署用 `onCredits` 接宿主自己的共享计数。
 *   · `onCredits`：每次请求花了几 credit 的回调（只给数字，不给路径——路径里有读者在看的话题）。
 *
 * 【隐私：放在哪一侧出网由宿主决定】多人使用的站点里，读者在看某个健康话题时若让浏览器直连第三方，
 * 读者 IP + 他关心什么就落进了对方日志。这种宿主应当只在服务端调用本适配器，并确保请求里**只带主题词，不带任何读者标识**
 * （本文件从不附带任何读者信息；它也不读任何环境变量——key 由宿主传进来）。单人本机使用（CLI、自己的浏览器）没有这个问题。
 *
 * 【实测成本（2026-09-22 首测、2026-09-28 按当日实测更正；响应头 x-ratelimit-credits-used 逐次核对）】
 *   · `/autocomplete/topics?q=…`          → **0 credits**（tag→topic 解析走这条，不走 10 credits 的 search）
 *   · `/topics/{id}`                      → **0 credits**，祖先链内联（subfield / field / domain 各一个对象）
 *   · `/subfields|fields|domains/{id}`    → **1 credit** 各（上级三级的实体查询不免费，旧记录「实体查询 0 credit」只对 topic 成立）
 *   · 任何列表端点                        → **1 credit**（$0.0001）：`/topics?filter=…` 同级兄弟、`/works?filter=…` 作品列表、group_by 计数都算
 *   匿名桶实测 `x-ratelimit-limit: 1000` / `limit-usd: 0.1`。
 *   ⇒ 一个标签的主题图冷启动 2 credits（兄弟列表 + 作品列表）；往上缩一格 2 credits（上级实体 + 它的兄弟列表）。
 *   ⚠️ 实体自带的 `siblings[]` **不读**：subfield / field 级它给的是「该级全部节点」不是同父兄弟，且不带 works_count；
 *      兄弟一律走同级列表端点按父过滤（`fetchNodeBundle`）。本适配器只管「一次请求花多少」，上游的 30 天缓存是消费方的事。
 *   ⚠️ 官方已废除 mailto/polite pool（同一 URL 带与不带 mailto，限流头逐字相同——本机对照实验证伪）。
 *
 * 【许可】OpenAlex 数据 CC0（公共领域，可落库、可再分发）——
 * https://github.com/ourresearch/openalex-docs/blob/main/license.md
 *
 * 【响应必须验形】Europe PMC 的教训（实测 15%–35% 概率回 HTTP 200 + 空体、无任何错误信号）提醒：
 * 外部源的「成功」不等于「有数据」。本文件所有解析都先验形，形状不对一律当失败**返回 null**，
 * 由调用方决定降级，绝不把空响应渲染成「这个主题没有研究」。
 *
 * 【标签语言不分类】任何标签都**原样**去问，不翻译、不按语言分支、不硬凑：
 * 英文标签配英文主题；中文标签（如 `焦虑`，OpenAlex 主题名是英文，实测 0 结果）如实回「查无」。
 * 「查无」与「这次没问成」是**两件事**：`resolveTopicForTag` 回三态，调用方不许把「没问成」当「查无」缓存起来。
 *
 * 【API key 只走请求头】`Authorization: Bearer`，永不进 URL——path 会进日志，query 会进 `provenance.query`
 * （宿主往往把它原样展示给读者，好让人复打核对）；这把 key 同时是 openalex.org 账号的登录凭据。
 */

import type { EvidenceRecord, EvidenceTagBindingConfidence, EvidenceTopic, EvidenceScaleLevel, EvidenceVenue } from './types'
import { scopeFilter } from './dimensions'
import type { ExternalEvidenceSource, ExternalTopicCandidate } from './ports'
import { fetchEvidenceCounts } from './openalex-counts'
import { OPENALEX_PROVENANCE } from './openalex-meta'
import { isFilterSafeDoi, normalizeDoi } from './doi'
import { isLiveSettings, settingsReader } from './settings'
import { MACHINE_CANDIDATE_LIMIT, normalizeTag, pickMachineCandidate } from './tags'
import { safeHttpUrl } from './url'
import type { SettingsInput } from './settings'
export { fetchEvidenceCounts, PROVISIONAL_YEARS } from './openalex-counts'

/** 同 `OpenAlexNodeLevel`（旧名，保留给已有调用方）。 */
export type OpenAlexLevel = OpenAlexNodeLevel

const DEFAULT_BASE = 'https://api.openalex.org'
const TIMEOUT_MS = 8000
/** 一次取多少篇外部文献。取太多图会糊，取太少代表性不足。 */
export const OPENALEX_WORKS_LIMIT = 25

export { OPENALEX_PROVENANCE }

/** `https://openalex.org/T10537` → `T10537`；已是短 id 时原样回。 */
function shortId(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null
  const tail = url.split('/').pop()
  return tail && tail.length > 0 ? tail : null
}

/**
 * 429 最多重试几次、每次最长等多久。实测：一个节点冷启动的十几次 group_by 同时在飞时，
 * 个别请求回 429（每秒次数限制，不是日配额）；一律当失败会让整组计数落空。
 * 429 不花 credit，退避后重试是 OpenAlex 文档建议的做法；有 Retry-After 就照它，封顶以免把一次页面请求拖太久。
 */
const RETRY_429 = 2
const RETRY_MAX_WAIT_MS = 4000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface OpenAlexOptions {
  /** OpenAlex API key；只进 `Authorization` 头。传函数则每次请求现取。 */
  apiKey?: string | (() => string | undefined)
  /** 默认 `https://api.openalex.org`。 */
  baseUrl?: string
  /** 默认全局 `fetch`（调用时才取）。 */
  fetch?: typeof fetch
  /** 默认 `console.error`（调用时才取）。参数里只有 path / 状态 / 错误信息，不含 key。 */
  log?: (message: string, detail: Record<string, unknown>) => void
  /** 每个 UTC 日的 credit 上限（见头注）；不设 = 不限。传函数则每次请求现取（接后台设置 `external.dailyCreditBudget`） */
  dailyCreditBudget?: number | (() => number | undefined)
  /** 每次请求花掉的 credit */
  onCredits?: (credits: number) => void
}

/**
 * 不花 credit 的请求：自动补全与主题实体 `/topics/{id}`（2026-09-28 实测；上级三级实体各 1 credit，不在这里）。
 * 预算花完后它们照常放行。
 */
export function isFreeOpenAlexPath(path: string): boolean {
  return path.startsWith('/autocomplete/') || /^\/topics\/T\d+$/.test(path)
}

type GetJson = (path: string) => Promise<{ json: unknown; credits: number } | null>
interface Ctx { getJson: GetJson; log: NonNullable<OpenAlexOptions['log']> }

interface RawNamed { id?: unknown; display_name?: unknown }
const named = (v: unknown): { id: string; name: string } | null => {
  if (!v || typeof v !== 'object') return null
  const r = v as RawNamed
  const id = shortId(typeof r.id === 'string' ? r.id : null)
  const name = typeof r.display_name === 'string' ? r.display_name : null
  return id && name ? { id, name } : null
}

const topicNode = (
  level: EvidenceScaleLevel, id: string, name: string,
  extra: { description?: string | null; parent_id?: string | null; works_count?: number | null } = {},
): EvidenceTopic => ({
  id: `openalex:${id}`,
  source: 'openalex',
  external_id: id,
  level,
  display_name: name,
  description: extra.description ?? null,
  parent_id: extra.parent_id ?? null,
  works_count: extra.works_count ?? null,
})

/**
 * 标签 → 外部主题的三态：
 * · `matched`：配上了，`confidence` 说配得多有把握——`exact` 主题名归一后与标签相同；`first_hit` 只是自动补全的第一条，
 *   **不是**确定的对应（短词、缩写常常只是字面上沾边），调用方要么标「机器匹配」，要么交编辑确认（`exact_only` 策略）；
 * · `no_match`：问到了，这个标签在 OpenAlex 没有对应主题（中文标签的常态）——调用方如实落缓存，免得每次都去撞同一堵墙；
 * · `error`：这次没问成（网络 / 超时 / 非 2xx / 响应形状不对）——**不是**「查无」，调用方不许把它写成缓存。
 */
export type TagTopicResolution =
  | { kind: 'matched'; external_id: string; display_name: string; works_count: number | null; confidence: EvidenceTagBindingConfidence }
  | { kind: 'no_match' }
  | { kind: 'error' }

/**
 * 站内 tag → OpenAlex 主题。**0 credits**（autocomplete，不是 search）。标签原样去问（不翻译、不按语言分支）。
 * 一次看最多 10 条候选：有同名的就取同名的（`exact`），没有才取第一条（`first_hit`），与服务层的机器绑定同一个挑法（`pickMachineCandidate`）。
 */
async function resolveTopicForTag(ctx: Ctx, tag: string): Promise<TagTopicResolution> {
  const cands = await suggestTopicsForTag(ctx, tag, MACHINE_CANDIDATE_LIMIT)
  if (cands === null) return { kind: 'error' }
  const pick = pickMachineCandidate(normalizeTag(tag), cands)
  if (!pick) return { kind: 'no_match' }
  return { kind: 'matched', ...pick.candidate, confidence: pick.confidence }
}

/** 外部树上的四级（`tag` 是站内入口，不在外部树上）。 */
export type OpenAlexNodeLevel = Exclude<EvidenceScaleLevel, 'tag'>

/**
 * 四级各自的 REST 路径、id 形状（主题 `T…`，上级三级纯数字——与 dimensions.ts 的 scopeFilter 同口径）、父级。
 * 祖先链就是沿 parent 一路往上走；实体响应把祖先按级名内联（topic 有 subfield/field/domain，subfield 有 field/domain，field 有 domain）。
 */
const NODE_LEVELS: Record<OpenAlexNodeLevel, { path: string; idShape: RegExp; parent: OpenAlexNodeLevel | null }> = {
  topic: { path: 'topics', idShape: /^T\d+$/, parent: 'subfield' },
  subfield: { path: 'subfields', idShape: /^\d+$/, parent: 'field' },
  field: { path: 'fields', idShape: /^\d+$/, parent: 'domain' },
  domain: { path: 'domains', idShape: /^\d+$/, parent: null },
}
/**
 * 兄弟列表只取画球要用的三列；200 是 per_page 上限，**放不下就翻页**（每页 1 credit）。
 * 2026-09-28 `group_by` 核对：同父 subfield 最多 42（Medicine）、同父 topic 最多 **224**（subfield 3312 Sociology and Political Science，
 * 其余 ≤137）——「几十个都放得下」对 topic 级不成立，一页会悄悄少 24 个兄弟。
 */
const SIBLING_SELECT = 'select=id,display_name,works_count&per_page=200'
const SIBLING_PER_PAGE = 200
/** 翻页护栏：真实数据两页足够；到这还没完就当形状异常止步并记日志，不无限打下去。 */
const SIBLING_MAX_PAGES = 3

/**
 * 一个节点的整条缩放阶梯：节点本身 + 祖先 + 同父兄弟。
 * 实体一次（topic 0 credit，上级三级 1 credit）+ 同级列表一次（1 credit；同父超过 200 个时每多一页再 1）。
 */
export interface OpenAlexNodeBundle {
  node: EvidenceTopic
  /** 从近到远：subfield → field → domain（field 级只有 domain；domain 级为空） */
  ancestors: EvidenceTopic[]
  /** 同父的其他节点（不含自己），带 works_count；列表没拿到时为 `[]`（实体拿到了就不整体失败） */
  siblings: EvidenceTopic[]
  /** 兄弟列表没拿全（某一页失败或到了翻页上限）时为 true——调用方别把残缺包写进长缓存 */
  partial?: boolean
}

async function fetchNodeBundle(ctx: Ctx, level: OpenAlexNodeLevel, id: string): Promise<OpenAlexNodeBundle | null> {
  const { getJson } = ctx
  const spec = NODE_LEVELS[level]
  if (!spec.idShape.test(id)) return null
  const out = await getJson(`/${spec.path}/${id}`)
  if (!out) return null
  const d = out.json as Record<string, unknown>
  const self = named(d)
  if (!self) return null

  // 祖先：沿 parent 链取实体里内联的对象；每个祖先的 parent_id 指向再上一级（缺了就 null）
  const chain: OpenAlexNodeLevel[] = []
  for (let p = spec.parent; p; p = NODE_LEVELS[p].parent) chain.push(p)
  const found = chain.map((lv) => ({ lv, v: named(d[lv]) }))
  const idAt = (i: number): string | null => (found[i]?.v ? `openalex:${found[i].v!.id}` : null)
  const ancestors: EvidenceTopic[] = []
  found.forEach(({ lv, v }, i) => { if (v) ancestors.push(topicNode(lv, v.id, v.name, { parent_id: idAt(i + 1) })) })
  const parent = found[0]?.v ?? null

  const node = topicNode(level, self.id, self.name, {
    description: typeof d.description === 'string' ? d.description : null,
    parent_id: parent ? `openalex:${parent.id}` : null,
    works_count: typeof d.works_count === 'number' ? d.works_count : null,
  })

  // 兄弟：同级列表按父过滤（domain 级无父 ⇒ 全部 domain）。⚠️ 不读实体自带的 siblings[]（见头注：上级级别那不是同父兄弟）
  // 实体拿到了、列表没拿到：回残缺 bundle（兄弟为空或不全）比整体 null 强——调用方仍能画焦点与祖先
  const listPath = spec.parent === null
    ? `/${spec.path}?${SIBLING_SELECT}`
    : parent ? `/${spec.path}?filter=${spec.parent}.id:${parent.id}&${SIBLING_SELECT}` : null
  const { nodes: siblings, partial } = listPath
    ? await listNodes(ctx, level, listPath, { exclude: self.id, parentId: node.parent_id, what: 'siblings' })
    : { nodes: [], partial: false }
  return partial ? { node, ancestors, siblings, partial } : { node, ancestors, siblings }
}

/** 约定：一层节点按 works_count 从多到少（没有篇数的排最后，同数按 id），不依赖外部源列表的缺省顺序；残缺时只对拿到的排。 */
const byWorksCount = (a: EvidenceTopic, b: EvidenceTopic) =>
  (b.works_count ?? -1) - (a.works_count ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * 按父过滤的一层节点列表（兄弟与往里一层共用）。第一页 URL 不带页码，第二页起显式 `&page=N`；
 * 任何一页没拿到就止步并标 `partial`，已拿到的照留；到翻页上限还没完也标 `partial`。
 */
async function listNodes(
  { getJson, log }: Ctx, level: OpenAlexNodeLevel, listPath: string,
  opts: { exclude?: string; parentId: string | null; what: 'siblings' | 'children' },
): Promise<{ nodes: EvidenceTopic[]; partial: boolean }> {
  const nodes: EvidenceTopic[] = []
  let partial = false
  for (let page = 1; page <= SIBLING_MAX_PAGES; page++) {
    const list = await getJson(page === 1 ? listPath : `${listPath}&page=${page}`)
    const j = list ? (list.json as { meta?: { count?: unknown }; results?: unknown }) : null
    if (!j || !Array.isArray(j.results)) {
      log(`[evidence.openalex] ${opts.what} unavailable, partial bundle`, { path: listPath, page })
      partial = true
      break
    }
    for (const raw of j.results) {
      const s = named(raw)
      if (!s || s.id === opts.exclude) continue
      const wc = (raw as { works_count?: unknown }).works_count
      nodes.push(topicNode(level, s.id, s.name, { parent_id: opts.parentId, works_count: typeof wc === 'number' ? wc : null }))
    }
    const count = typeof j.meta?.count === 'number' ? j.meta.count : null
    if (j.results.length < SIBLING_PER_PAGE || count === null || page * SIBLING_PER_PAGE >= count) break
    if (page === SIBLING_MAX_PAGES) {
      log(`[evidence.openalex] ${opts.what} truncated at page cap, partial bundle`, { path: listPath, count })
      partial = true
    }
  }
  nodes.sort(byWorksCount)
  return { nodes, partial }
}

/** 往里一层是哪一级；主题往里没有外部的一层（站内标签由服务层按编辑绑定补上）。 */
const CHILD_LEVEL: Record<OpenAlexNodeLevel, OpenAlexNodeLevel | null> = { domain: 'field', field: 'subfield', subfield: 'topic', topic: null }

/**
 * 一个节点往里一层：大类 → 领域 → 子领域 → 主题（**1 credit**；同父超过 200 个时每多一页再 1）。
 * 主题级、id 形状不对 ⇒ null（不出网）；第一页就没拿到 ⇒ null（这次没问成，**不是**「没有往里的一层」）；
 * 后面的页没拿到 ⇒ 带 `partial: true` 回已拿到的。按 works_count 从多到少。
 */
async function fetchNodeChildren(ctx: Ctx, level: OpenAlexNodeLevel, id: string): Promise<{ children: EvidenceTopic[]; partial?: boolean } | null> {
  const child = CHILD_LEVEL[level]
  if (!child || !NODE_LEVELS[level].idShape.test(id)) return null
  const path = `/${NODE_LEVELS[child].path}?filter=${level}.id:${id}&${SIBLING_SELECT}`
  const { nodes, partial } = await listNodes(ctx, child, path, { parentId: `openalex:${id}`, what: 'children' })
  if (partial && nodes.length === 0) return null
  return partial ? { children: nodes, partial } : { children: nodes }
}

/** 兼容旧调用方：`fetchNodeBundle('topic', id)` 的薄包装，字段名 `topic` 不变。 */
export interface OpenAlexTopicBundle {
  topic: EvidenceTopic
  /** 从近到远：subfield → field → domain */
  ancestors: EvidenceTopic[]
  siblings: EvidenceTopic[]
}

async function fetchTopicBundle(ctx: Ctx, externalId: string): Promise<OpenAlexTopicBundle | null> {
  const b = await fetchNodeBundle(ctx, 'topic', externalId)
  return b ? { topic: b.node, ancestors: b.ancestors, siblings: b.siblings } : null
}

/** 给编辑看的候选主题：自动补全的前几条（**0 credits**）。null = 这次没问成；[] = 问到了，没有。 */
export interface OpenAlexTopicCandidate { external_id: string; display_name: string; works_count: number | null }

async function suggestTopicsForTag({ getJson }: Ctx, tag: string, limit = 5): Promise<OpenAlexTopicCandidate[] | null> {
  const q = tag.trim()
  if (q.length === 0 || q.length > 100) return []
  const out = await getJson(`/autocomplete/topics?q=${encodeURIComponent(q)}`)
  if (!out) return null
  const results = (out.json as { results?: unknown }).results
  if (!Array.isArray(results)) return null
  const cands: OpenAlexTopicCandidate[] = []
  for (const r of results.slice(0, Math.max(1, Math.min(limit, 10)))) {
    const n = named(r)
    if (!n) return null
    const wc = (r as { works_count?: unknown }).works_count
    cands.push({ external_id: n.id, display_name: n.name, works_count: typeof wc === 'number' ? wc : null })
  }
  return cands
}

/**
 * 一批 DOI 各自的主主题（每 50 个 DOI 1 credit）。用于「按引用关系」给标签推荐主题：带这个标签的站内文章
 * 引用的文献主要落在哪个主题。任何一批失败 ⇒ 整体 null（半截数据算出来的比例会误导）。查不到的 DOI 不出现在结果里。
 */
export const OPENALEX_DOI_BATCH = 50

async function fetchPrimaryTopicsForDois({ getJson }: Ctx, dois: readonly string[]): Promise<Array<{ doi: string; topic: OpenAlexTopicCandidate | null }> | null> {
  // 与站内参考文献同一套归一；含 `,` / `|` 的放不进 OR 过滤，只能不查（结果里不出现，调用方按「没查」算）
  const clean = [...new Set(dois.map(normalizeDoi).filter((d): d is string => d !== null && isFilterSafeDoi(d)))]
  const out: Array<{ doi: string; topic: OpenAlexTopicCandidate | null }> = []
  for (let i = 0; i < clean.length; i += OPENALEX_DOI_BATCH) {
    const batch = clean.slice(i, i + OPENALEX_DOI_BATCH)
    const filter = encodeURIComponent(`doi:${batch.map((d) => `https://doi.org/${d}`).join('|')}`)
    const res = await getJson(`/works?filter=${filter}&select=id,doi,primary_topic&per_page=${OPENALEX_DOI_BATCH}`)
    if (!res) return null
    const results = (res.json as { results?: unknown }).results
    if (!Array.isArray(results)) return null
    for (const r of results) {
      if (!r || typeof r !== 'object') continue
      const doiRaw = (r as { doi?: unknown }).doi
      if (typeof doiRaw !== 'string') continue
      const doi = doiRaw.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
      const pt = named((r as { primary_topic?: unknown }).primary_topic)
      out.push({ doi, topic: pt ? { external_id: pt.id, display_name: pt.name, works_count: null } : null })
    }
  }
  return out
}

/**
 * 下钻层：某主题下**被引最多的 25 篇**（**1 credit**）。⚠️ 这是**示例，不是全体**——ADHD 主题全量 110,442 篇，
 * 这里只有 25 篇；「这个领域长什么样」一律走下面的全量计数（`groupByWorks`，同样 1 credit），UI 上这一层标明「示例」。
 *
 * 已撤稿的在查询里就排掉（`is_retracted:false`）——
 * 撤稿论文出现在「相关研究」里是实打实的误导。`select` 压体积，只取画图与署名要用的列。
 */
async function fetchWorksForTopic(ctx: Ctx, externalId: string, limit = OPENALEX_WORKS_LIMIT): Promise<EvidenceRecord[] | null> {
  return fetchWorksForNode(ctx, 'topic', externalId, limit)
}

/** 同上，任意一级节点（topic / subfield / field / domain）；以它为**主**主题的作品。 */
async function fetchWorksForNode({ getJson }: Ctx, level: OpenAlexLevel, externalId: string, limit = OPENALEX_WORKS_LIMIT): Promise<EvidenceRecord[] | null> {
  const filter = scopeFilter(level, externalId, 'primary_topic')
  if (!filter) return null
  // 0.4.0 多取三列：primary_location（发在哪）、topics（自己挂的主题）、referenced_works（只用来连同一批里的引用边，不下发）
  const select = 'id,doi,title,publication_year,type,cited_by_count,open_access,authorships,primary_location,topics,referenced_works'
  const out = await getJson(
    `/works?filter=${filter},is_retracted:false&sort=cited_by_count:desc&per_page=${Math.min(Math.max(limit, 1), 50)}&select=${select}`,
  )
  if (!out) return null
  const results = (out.json as { results?: unknown }).results
  if (!Array.isArray(results)) return null
  const retrieved = new Date().toISOString()
  const records: EvidenceRecord[] = []
  const refs = new Map<string, string[]>()
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = shortId(typeof r.id === 'string' ? r.id : null)
    const title = typeof r.title === 'string' ? r.title : null
    if (!id || !title) continue
    const authorships = Array.isArray(r.authorships) ? r.authorships : []
    const authors = authorships
      .map((a) => (a && typeof a === 'object' ? (a as { author?: { display_name?: unknown } }).author?.display_name : null))
      .filter((n): n is string => typeof n === 'string')
      .slice(0, 8)
    const doi = typeof r.doi === 'string' ? r.doi : null
    records.push({
      id: `openalex:${id}`,
      source: 'openalex',
      external_id: id,
      title,
      year: typeof r.publication_year === 'number' ? r.publication_year : null,
      authors,
      doi,
      url: doi ?? `https://openalex.org/${id}`,
      topic_ids: [`openalex:${externalId}`],
      // OpenAlex 的 `type` 是**出版物形态**（article / dissertation / preprint…），不是研究设计——
      // RCT 与横断面在它那里都叫 article。研究设计从外部源恒为 null；出版物形态单独一列。
      study_type: null,
      publication_type: typeof r.type === 'string' ? r.type : null,
      // 外部源不带效应量/方向/自报结论——**这三个字段恒为 null 是有意的**（不拿被引数冒充效应量）
      self_reported_claim: null,
      direction: null,
      effect: null,
      cited_by_count: typeof r.cited_by_count === 'number' ? r.cited_by_count : null,
      is_retracted: false,
      is_open_access: typeof (r.open_access as { is_oa?: unknown } | undefined)?.is_oa === 'boolean'
        ? ((r.open_access as { is_oa: boolean }).is_oa)
        : null,
      provenance: { ...OPENALEX_PROVENANCE, retrieved_at: retrieved },
      venue: venueOf(r.primary_location),
      oa_url: safeHttpUrl((r.open_access as { oa_url?: unknown } | undefined)?.oa_url),
      topics: (Array.isArray(r.topics) ? r.topics : []).map(named).filter((t): t is { id: string; name: string } => t !== null)
        .slice(0, 5).map((t) => ({ id: `openalex:${t.id}`, display_name: t.name })),
    })
    if (Array.isArray(r.referenced_works)) {
      refs.set(`openalex:${id}`, r.referenced_works.map((u) => shortId(typeof u === 'string' ? u : null)).filter((x): x is string => x !== null).map((x) => `openalex:${x}`))
    }
  }
  // 引用边只连同一批里的：别的引用不下发（一篇综述能引几百篇，整串带给浏览器没有意义）
  const inBatch = new Set(records.map((x) => x.id))
  for (const rec of records) {
    const cites = [...new Set((refs.get(rec.id) ?? []).filter((x) => x !== rec.id && inBatch.has(x)))]
    if (cites.length > 0) rec.cites = cites
  }
  return records
}

/** 作品的主要发表位置 → 发在哪（期刊 / 来源）；没有来源（比如只有落地页）⇒ null。 */
function venueOf(location: unknown): EvidenceVenue | null {
  if (!location || typeof location !== 'object') return null
  const src = (location as { source?: unknown }).source
  const n = named(src)
  if (!n) return null
  const v = src as Record<string, unknown>
  return {
    id: `openalex:${n.id}`, name: n.name,
    type: typeof v.type === 'string' ? v.type : null,
    is_oa: typeof v.is_oa === 'boolean' ? v.is_oa : null,
    issn_l: typeof v.issn_l === 'string' ? v.issn_l : null,
    publisher: typeof v.host_organization_name === 'string' ? v.host_organization_name : null,
  }
}

// ── 全量计数 ────────────────────────────────────────────────────────────────
// 一次 group_by 与「被引最高 25 篇」同样 1 credit，给的却是全量分布——系统的主粒度从此是**格子**。
// 实测要点（2026-09-23 本机真打）：
//   · **group_by 必须带 `per_page=200`**：桶也受 per_page 截断——per_page=1 时只回 1 个桶（全球南方那条恰好只有 2 桶，
//     会让人误以为「没截断」）。200 是上限；年份 172 桶、国家 172 桶、学科 174 桶都放得下。
//   · 两维 `group_by=A,B` 1 credit 回完整交叉表（每行一个 `groups` 子数组），**不截断**；
//     `topics.field.id` / `is_retracted` 进多维是**显式 400、0 credit**（维度注册表的 multiDimOk 据此声明）。
//   · `/topics/{id}` 实体 0 credit（上级三级实体各 1）；列表 / 计数 / group_by 各 1 credit。

export interface OpenAlexGroup { key: string; label: string; count: number; sub?: OpenAlexGroup[] }
export interface OpenAlexCountResult {
  /** 过滤后的作品总数（meta.count） */
  total: number
  groups: OpenAlexGroup[]
  /** 实际发出的查询（不含主机名），印进出处 */
  query: string
  credits: number
  retrieved_at: string
}

const parseGroups = (raw: unknown): OpenAlexGroup[] | null => {
  if (!Array.isArray(raw)) return null
  const out: OpenAlexGroup[] = []
  for (const g of raw) {
    if (!g || typeof g !== 'object') return null
    const r = g as { key?: unknown; key_display_name?: unknown; count?: unknown; groups?: unknown }
    if (typeof r.key !== 'string' || typeof r.count !== 'number') return null
    const sub = r.groups === undefined ? undefined : parseGroups(r.groups)
    if (sub === null) return null
    out.push({ key: r.key, label: typeof r.key_display_name === 'string' ? r.key_display_name : r.key, count: r.count, ...(sub ? { sub } : {}) })
  }
  return out
}

/** `filter` 下按 `groupBy`（一维或 `a,b` 两维）分组计数。形状不对 ⇒ null（调用方降级，绝不当成「零」）。 */
async function groupByWorks({ getJson, log }: Ctx, filter: string, groupBy: string): Promise<OpenAlexCountResult | null> {
  const query = `/works?filter=${filter}&group_by=${groupBy}&per_page=200`
  const out = await getJson(query)
  if (!out) return null
  const j = out.json as { meta?: { count?: unknown }; group_by?: unknown }
  const total = typeof j.meta?.count === 'number' ? j.meta.count : null
  const groups = parseGroups(j.group_by)
  if (total === null || groups === null) {
    log('[evidence.openalex] malformed group_by', { query })
    return null
  }
  return { total, groups, query, credits: out.credits, retrieved_at: new Date().toISOString() }
}

/** `filter` 下的作品数（分母另查用；1 credit）。 */
async function countWorks({ getJson, log }: Ctx, filter: string): Promise<Omit<OpenAlexCountResult, 'groups'> | null> {
  const query = `/works?filter=${filter}&per_page=1&select=id`
  const out = await getJson(query)
  if (!out) return null
  const total = (out.json as { meta?: { count?: unknown } }).meta?.count
  if (typeof total !== 'number') {
    log('[evidence.openalex] malformed count', { query })
    return null
  }
  return { total, query, credits: out.credits, retrieved_at: new Date().toISOString() }
}

/**
 * 造一个 OpenAlex 客户端。所有取数函数共用同一套超时、429 退避与验形；任何一步失败都回 `null`
 * （`resolveTopicForTag` 回 `{ kind: 'error' }`），由调用方降级——绝不把失败当成「没有研究」。
 */
export function createOpenAlexClient(opts: OpenAlexOptions = {}, settings?: SettingsInput | null) {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
  // 设置包（后台存的值）：给了的键 > 代码选项 > 缺省；认不出的键忽略。用到 external.dailyCreditBudget 与 external.sampleSize
  const readSettings = settingsReader(settings)
  /** 发请求本来就是异步的：现读设置在这里等它读好（首个请求不会拿缺省值凑数），其余形态直接读 */
  const provided = async () => (isLiveSettings(settings) ? (await settings.get()).provided : readSettings?.().provided ?? {})
  const worksLimit = async (limit?: number) => limit ?? (await provided())['external.sampleSize'] ?? OPENALEX_WORKS_LIMIT
  /** 有 key 才带 `Authorization` 头（见头注：永不进 URL）。 */
  const authHeader = (): Record<string, string> => {
    const raw = typeof opts.apiKey === 'function' ? opts.apiKey() : opts.apiKey
    const key = raw?.trim()
    return key ? { authorization: `Bearer ${key}` } : {}
  }
  const log = (msg: string, detail: Record<string, unknown>) => (opts.log ?? ((m, d) => console.error(m, d)))(msg, detail)

  // 每日预算（UTC 日；OpenAlex 的日额度也按 UTC 午夜重置）
  let budgetDay = ''
  let spent = 0
  const spentToday = () => {
    const day = new Date().toISOString().slice(0, 10)
    if (day !== budgetDay) { budgetDay = day; spent = 0 }
    return spent
  }

  const getJson = async (path: string, attempt = 0): Promise<{ json: unknown; credits: number } | null> => {
    const budget = (await provided())['external.dailyCreditBudget']
      ?? (typeof opts.dailyCreditBudget === 'function' ? opts.dailyCreditBudget() : opts.dailyCreditBudget)
    if (attempt === 0 && budget !== undefined && !isFreeOpenAlexPath(path) && spentToday() >= budget) {
      log('[evidence.openalex] daily credit budget exhausted', { budget })
      return null
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await (opts.fetch ?? fetch)(`${base}${path}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json', ...authHeader() },
        // 外部公共数据：不带任何 cookie / 凭据；不用宿主框架的 fetch 缓存（如 Next），缓存归宿主自己的表
        cache: 'no-store',
      })
      if (res.status === 429 && attempt < RETRY_429) {
        const after = Number(res.headers.get('retry-after'))
        const wait = Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 800 * 2 ** attempt, RETRY_MAX_WAIT_MS)
        clearTimeout(timer)
        await sleep(wait)
        return getJson(path, attempt + 1)
      }
      if (!res.ok) {
        log('[evidence.openalex] non-ok', { path, status: res.status, attempt })
        return null
      }
      const json: unknown = await res.json().catch(() => null)
      if (json === null || typeof json !== 'object') {
        // 形状不对当失败（Europe PMC 式静默空体的同型防线）
        log('[evidence.openalex] malformed body', { path })
        return null
      }
      const raw = Number(res.headers.get('x-ratelimit-credits-used') ?? '0')
      const credits = Number.isFinite(raw) && raw > 0 ? raw : 0
      if (credits > 0) {
        spentToday()
        spent += credits
        opts.onCredits?.(credits)
      }
      return { json, credits }
    } catch (e) {
      log('[evidence.openalex] fetch failed', { path, error: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const ctx: Ctx = { getJson, log }
  return {
    resolveTopicForTag: (tag: string) => resolveTopicForTag(ctx, tag),
    fetchNodeBundle: (level: OpenAlexNodeLevel, id: string) => fetchNodeBundle(ctx, level, id),
    fetchNodeChildren: (level: OpenAlexNodeLevel, id: string) => fetchNodeChildren(ctx, level, id),
    fetchTopicBundle: (externalId: string) => fetchTopicBundle(ctx, externalId),
    fetchWorksForTopic: async (externalId: string, limit?: number) => fetchWorksForTopic(ctx, externalId, await worksLimit(limit)),
    fetchWorksForNode: async (level: OpenAlexLevel, externalId: string, limit?: number) => fetchWorksForNode(ctx, level, externalId, await worksLimit(limit)),
    suggestTopicsForTag: (tag: string, limit?: number) => suggestTopicsForTag(ctx, tag, limit),
    fetchPrimaryTopicsForDois: (dois: readonly string[]) => fetchPrimaryTopicsForDois(ctx, dois),
    /** 今天（UTC）已经花掉的 credit（本实例内） */
    creditsSpentToday: () => spentToday(),
    groupByWorks: (filter: string, groupBy: string) => groupByWorks(ctx, filter, groupBy),
    countWorks: (filter: string) => countWorks(ctx, filter),
  }
}

export type OpenAlexClient = ReturnType<typeof createOpenAlexClient>

// ── 外部源适配（ExternalEvidenceSource）─────────────────────────────────────────

/**
 * 把 OpenAlex 客户端包成服务层认的 `ExternalEvidenceSource`。传客户端或客户端选项都行：
 * `createOpenAlexSource({ apiKey: () => env.OPENALEX_API_KEY, dailyCreditBudget: 5000 })`。
 */
export function createOpenAlexSource(clientOrOptions: OpenAlexClient | OpenAlexOptions = {}, settings?: SettingsInput | null): ExternalEvidenceSource {
  const client: OpenAlexClient = 'groupByWorks' in clientOrOptions ? clientOrOptions : createOpenAlexClient(clientOrOptions, settings)
  const cand = (c: OpenAlexTopicCandidate): ExternalTopicCandidate => ({ topic_id: `openalex:${c.external_id}`, display_name: c.display_name, works_count: c.works_count })
  return {
    id: 'openalex',
    async suggestTopics(tag, limit) {
      const r = await client.suggestTopicsForTag(tag, limit)
      return r ? r.map(cand) : null
    },
    nodeBundle: (level, externalId) => client.fetchNodeBundle(level, externalId),
    children: (level, externalId) => client.fetchNodeChildren(level, externalId),
    sampleWorks: (level, externalId, limit) => client.fetchWorksForNode(level, externalId, limit),
    counts: (level, externalId, scope, displayName) => fetchEvidenceCounts(client, level, externalId, scope, { display_name: displayName }),
    async topicsForDois(dois) {
      const r = await client.fetchPrimaryTopicsForDois(dois)
      return r ? r.map((x) => ({ doi: x.doi, topic: x.topic ? cand(x.topic) : null })) : null
    },
  }
}

