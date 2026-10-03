/**
 * 宿主门面——**一个函数把整条链装起来**：站内文章 → 标签 → 绑定 → 外部源 → 阶梯 / 格子 / 共现图。
 * ─────────────────────────────────────────────────────────────────────────────
 * 只在服务端用（它会通过外部源出网）。宿主要做的只有实现几个端口（ports.ts），然后：
 *
 *   const evidence = createEvidenceService({
 *     onsite: { listArticles: ({ tagKeys }) => db.publicArticles({ tagKeys }) },
 *     bindings: myBindingTable,                                  // 可选：编辑绑定
 *     external: createOpenAlexSource({ apiKey: () => env.KEY, dailyCreditBudget: 5000 }), // 可选
 *     cache: myKv,                                               // 可选：缺省进程内 LRU
 *     onsiteLabel: '站名', onsiteLicense: 'CC BY 4.0',
 *   })
 *   const r = await evidence.getTagMap('ADHD')                   // { ok: true, data } | { ok: false, error }
 *
 * 规则在这里**替宿主守住**（宿主不用、也没法写错）：
 *   · 「没问成」（error）永不写缓存；「查无」（no_match）照实缓存；
 *   · 防滥用闸（`externalGate: 'onsite_tags_only'`，缺省）：只有出现在公开文章里的标签、或编辑绑过的标签才去问外部源——
 *     读者随手输入的字符串不会变成对第三方的查询，也不会烧掉站点的外部额度；
 *   · 主题级只汇总**编辑绑定**的标签（机器匹配只在标签级用，并且带 `machine_binding` 图注）；
 *   · 同一个键的并发请求合并成一次（一篇热门文章上线时不会同时打十次外部源）；
 *   · 宿主缓存抛错只记日志、照常取数；日志里只有键的种类，不含读者信息。
 */
import type {
  EvidenceCaveat, EvidenceCitationPurpose, EvidenceSettings,
  EvidenceBindingQueueItem, EvidenceBindingSuggestion, EvidenceCountScope, EvidenceCountsData, EvidenceMapData, EvidenceOnsiteCounts, EvidenceProvenance,
  EvidenceRecord, EvidenceTagBinding, EvidenceTagGraph, EvidenceTopic, EvidenceWorkTag, EvidenceCertainty, EvidenceScaleLevel,
} from './types'
import { EVIDENCE_COUNT_SCOPES } from './types'
import { pickEvidenceView, poolEvidence } from './ladder'
import {
  createCuratedBinding, groupTags, MACHINE_CANDIDATE_LIMIT, normalizeTag, pickMachineCandidate, recordTagKeys, resolveTagBinding, splitTopicId, tagNameMatch,
} from './tags'
import type { MachineBindingPolicy, MachineResolution } from './tags'
import {
  applyReviewGate, buildRecordEdges, buildTagGraph, countOnsiteLayer, intakeArticle, intakeArticles, ONSITE_DEFAULT_LABEL, ONSITE_DEFAULT_LICENSE,
} from './onsite'
import type { IntakeResult, TagGraphOptions } from './onsite'
import { wilsonInterval } from './stats'
import { fnv1a, sampleDois } from './doi'
import { createMemoryCache, EXTERNAL_LEVELS } from './ports'
import { defaultSettings, isLiveSettings, settingsReader } from './settings'
import { applyWorkTags } from './ledger'
import type { SettingsInput, ValidatedSettings } from './settings'
import type {
  CertaintySource, EvidenceCache, ExternalEvidenceSource, ExternalLevel, ExternalNodeBundle, OnsiteArticleSource, TagBindingStore, WorkTagSource,
} from './ports'
import { checkCertainty } from './appraisal'

export * from './ports'

/** 缺省缓存时长（秒）。外部分类树很少变；下钻示例与计数一周；站内派生的共现图五分钟。 */
export const DEFAULT_TTL = {
  resolve: 30 * 86400,
  bundle: 30 * 86400,
  sample: 7 * 86400,
  counts: 7 * 86400,
  suggest: 86400,
  dois: 30 * 86400,
  onsite: 300,
} as const

export type ServiceError =
  /** 输入不合法（空标签、id 形状不对、参数越界） */
  | 'invalid_input'
  /** 外部源里没有这个节点 / 这个主题 */
  | 'not_found'
  /** 这次没取到（外部源或宿主数据源出错、预算用完）；稍后再试，**不是**「没有研究」 */
  | 'unavailable'
  /** 这个功能需要的端口没配（比如没配外部源却要计数） */
  | 'not_configured'

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError }

export interface EvidenceServiceOptions {
  onsite: OnsiteArticleSource
  external?: ExternalEvidenceSource | null
  bindings?: TagBindingStore | null
  /**
   * 可选：标签账本（`createTagLedger(...)` 直接传进来）。给了 ⇒ 站内记录的标签先按账本的生效结论改（设置 `ledger.apply`），
   * 图注标出「有模型决定的标签」「有争议的没计入」。账本取不到 ⇒ 这次回 unavailable，不拿没裁决过的标签凑数。
   */
  workTags?: WorkTagSource | null
  /**
   * 可选：证据确定性评级（0.3.0）。给了 ⇒ 标签级与节点级的研究图谱带上这个范围的评级（逐条验形，不合格的丢掉并记日志）；
   * 取不到 ⇒ `certainty: null`（UI 说「这次没取到」）。不给 ⇒ 不下发这个字段。
   */
  certainty?: CertaintySource | null
  cache?: EvidenceCache | null
  /** 站内文章在脚注里的来源名（宿主的站名 / 栏目名） */
  onsiteLabel?: string
  /** 站内文章的许可 */
  onsiteLicense?: string
  /** 机器绑定策略，缺省 `first_hit` */
  machineBinding?: MachineBindingPolicy
  /** 防滥用闸，缺省 `onsite_tags_only` */
  externalGate?: 'onsite_tags_only' | 'any'
  /** 可选：节点读口（按 id 缩放 / 计数）放不放行；缺省全放行（配合外部源的每日预算） */
  allowNode?: (level: ExternalLevel, externalId: string) => boolean | Promise<boolean>
  /** 下钻示例取几篇，缺省 25 */
  sampleSize?: number
  /** 「按引用推荐绑定」最多查多少个 DOI，缺省 200（每 50 个 1 credit） */
  maxReferenceDois?: number
  ttl?: Partial<Record<keyof typeof DEFAULT_TTL, number>>
  /**
   * 后台插件页存的设置（`createLiveSettings(读库)` 现读、一个同步函数、或一个静态对象）。优先级：这里给了的键 > 上面的代码选项 > 注册表缺省值。
   * 服务每次请求取一次（现读的有自己的短缓存），所以后台改了下一次请求就生效。
   */
  settings?: SettingsInput | null
  now?: () => Date
  log?: (message: string, detail: Record<string, unknown>) => void
}

export interface TagGraphQuery {
  focus?: string | null | undefined
  minSupport?: number | undefined
  maxNodes?: number | undefined
}

export interface CurateInput {
  tag: string
  /** 主题 id（`openalex:T10537`）；null ＝ 否决：确认这个标签没有对应主题 */
  topic_id: string | null
  /** 编辑标识（别放个人信息） */
  by: string | null
  note?: string | null
}

export interface EvidenceService {
  /** 标签级研究图谱：站内文章 + （绑定到的主题下的）外部示例，阶梯结论与汇总判定 */
  getTagMap(tag: string): Promise<ServiceResult<EvidenceMapData>>
  /** 外部分类树上任意一级的研究图谱（缩小 / 放大） */
  getNodeMap(level: ExternalLevel, externalId: string): Promise<ServiceResult<EvidenceMapData>>
  /** 外部节点的全量格子（主题级附带编辑绑定标签下的站内层） */
  getCounts(level: ExternalLevel, externalId: string, scope?: EvidenceCountScope): Promise<ServiceResult<EvidenceCountsData>>
  /** 一个标签的站内层：各站内维度的格子、图种可用性、以它为中心的共现图 */
  getTagCounts(tag: string): Promise<ServiceResult<EvidenceOnsiteCounts>>
  /** 全站（或以某标签为中心的）标签共现图 */
  getTagGraph(query?: TagGraphQuery): Promise<ServiceResult<EvidenceTagGraph>>
  /** 编辑用：一个标签的候选主题（按名字 + 按引用两路证据） */
  suggestBindings(tag: string, opts?: { limit?: number }): Promise<ServiceResult<EvidenceBindingSuggestion[]>>
  /** 编辑用：确认 / 否决一条绑定（会先向外部源核实主题存在） */
  curate(input: CurateInput): Promise<ServiceResult<EvidenceTagBinding>>
  /** 编辑用：还没有编辑结论的标签，按文章数从多到少（自动补全 0 credit，结果缓存） */
  bindingQueue(opts?: { limit?: number; minArticles?: number }): Promise<ServiceResult<EvidenceBindingQueueItem[]>>
  /** 作者用：一篇文章入库会被怎么处理（问题清单可以原样回给作者） */
  intake(article: unknown): IntakeResult
  /** 当前生效的设置（后台 > 代码选项 > 缺省）；读口据此开关路由、定缓存时长 */
  settings(): Promise<EvidenceSettings>
}

const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data })
const fail = <T>(error: ServiceError): ServiceResult<T> => ({ ok: false, error })

const NODE_ID: Record<ExternalLevel, RegExp> = { topic: /^T\d{1,12}$/, subfield: /^\d{1,12}$/, field: /^\d{1,12}$/, domain: /^\d{1,12}$/ }
export function isValidNodeId(level: string, externalId: string): level is ExternalLevel {
  return (EXTERNAL_LEVELS as readonly string[]).includes(level) && NODE_ID[level as ExternalLevel].test(externalId)
}

const uniqueProvenance = (records: readonly EvidenceRecord[]): EvidenceProvenance[] => {
  const seen = new Map<string, EvidenceProvenance>()
  for (const r of records) {
    const k = `${r.provenance.source_label}\u0000${r.provenance.license}\u0000${r.provenance.retrieved_at}`
    if (!seen.has(k)) seen.set(k, r.provenance)
  }
  return [...seen.values()]
}

export function createEvidenceService(opts: EvidenceServiceOptions): EvidenceService {
  const now = opts.now ?? (() => new Date())
  const log = opts.log ?? ((m: string, d: Record<string, unknown>) => console.error(m, d))
  const hostCache = opts.cache === null ? null : opts.cache ?? createMemoryCache()
  const ext = opts.external ?? null
  const store = opts.bindings ?? null

  // ── 生效配置：后台设置（给了的键）> 代码选项 > 注册表缺省值；每次请求现算 ──
  const codeDefaults: Partial<EvidenceSettings> = {}
  if (opts.machineBinding) codeDefaults['binding.machinePolicy'] = opts.machineBinding
  if (opts.externalGate) codeDefaults['external.gate'] = opts.externalGate
  if (opts.sampleSize !== undefined) codeDefaults['external.sampleSize'] = Math.max(1, Math.min(opts.sampleSize, 50))
  if (opts.maxReferenceDois !== undefined) codeDefaults['external.maxReferenceDois'] = Math.max(0, opts.maxReferenceDois)
  codeDefaults['onsite.label'] = opts.onsiteLabel ?? ONSITE_DEFAULT_LABEL
  codeDefaults['onsite.license'] = opts.onsiteLicense ?? ONSITE_DEFAULT_LICENSE
  const input = opts.settings ?? null
  const read = settingsReader(input)
  const DAY = 86_400
  const toCfg = (v: ValidatedSettings | null) => {
    const provided = v?.provided ?? {}
    const eff: EvidenceSettings = { ...defaultSettings(), ...codeDefaults, ...provided }
    const base = { ...DEFAULT_TTL, ...(opts.ttl ?? {}) }
    const days = (k: 'cache.resolveDays' | 'cache.bundleDays' | 'cache.sampleDays' | 'cache.countsDays', fallback: number) =>
      provided[k] !== undefined ? provided[k]! * DAY : fallback
    const ttl = {
      ...base,
      resolve: days('cache.resolveDays', base.resolve),
      bundle: days('cache.bundleDays', base.bundle),
      sample: days('cache.sampleDays', base.sample),
      counts: days('cache.countsDays', base.counts),
    }
    eff['cache.resolveDays'] = Math.round(ttl.resolve / DAY)
    eff['cache.bundleDays'] = Math.round(ttl.bundle / DAY)
    eff['cache.sampleDays'] = Math.round(ttl.sample / DAY)
    eff['cache.countsDays'] = Math.round(ttl.counts / DAY)
    return {
      settings: eff,
      policy: eff['binding.machinePolicy'],
      gate: eff['external.gate'],
      sampleSize: eff['external.sampleSize'],
      maxDois: eff['external.maxReferenceDois'],
      ttl,
      onsiteMeta: { source_label: eff['onsite.label'], license: eff['onsite.license'] },
      graph: { minSupport: eff['graph.minSupport'], maxNodes: eff['graph.maxNodes'] },
      ledgerApply: eff['ledger.apply'],
      reviewGate: eff['onsite.reviewGate'],
    }
  }
  type Cfg = ReturnType<typeof toCfg>
  const cfg = async (): Promise<Cfg> => toCfg(isLiveSettings(input) ? await input.get() : read?.() ?? null)
  const cfgNow = (): Cfg => toCfg(read?.() ?? null)
  const inflight = new Map<string, Promise<unknown>>()
  // 站内派生的结果（共现图）放进**引擎自己的小缓存**，不进宿主缓存：它的键来自读者输入（focus × 门槛 × 上限），
  // 放进共享缓存会把花了外部额度的条目挤掉。编辑改绑定时整个清掉（便宜）。
  const onsiteCache = createMemoryCache({ maxEntries: 200 })

  const ck = (...parts: Array<string | number>) => ['sm1', ...parts].join('|')

  /** 读缓存 → 没有就取（并发合并）→ 非 null 才写回。`storable` 决定哪些值能写（比如「没问成」不能写）。 */
  async function cached<T>(key: string, seconds: number, fetcher: () => Promise<T | null>, storable: (v: T) => boolean = () => true, cache: EvidenceCache | null = hostCache): Promise<T | null> {
    if (cache) {
      try {
        const hit = await cache.get(key)
        if (hit !== undefined) return hit as T
      } catch (e) {
        log('[evidence.service] cache get failed', { kind: key.split('|')[1], error: e instanceof Error ? e.message : String(e) })
      }
    }
    const pending = inflight.get(key) as Promise<T | null> | undefined
    if (pending) return pending
    const p = (async () => {
      try {
        const v = await fetcher()
        if (v !== null && cache && storable(v)) {
          try { await cache.set(key, v, seconds) } catch (e) {
            log('[evidence.service] cache set failed', { kind: key.split('|')[1], error: e instanceof Error ? e.message : String(e) })
          }
        }
        return v
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
    return p
  }

  async function onsiteRecords(c: Cfg, tagKeys?: readonly string[]) {
    const rows = await opts.onsite.listArticles(tagKeys ? { tagKeys } : {})
    const out = intakeArticles(Array.isArray(rows) ? rows : [], { ...c.onsiteMeta, retrieved_at: now().toISOString() })
    if (out.issues.length > 0) log('[evidence.onsite] intake issues', { articles: out.issues.length })
    let all = out.records
    let ledger: { decisions: ReadonlyMap<string, readonly EvidenceWorkTag[]>; mode: 'merge' | 'ledger_only'; disputed: boolean } | null = null
    if (opts.workTags && c.ledgerApply !== 'off' && all.length > 0) {
      const decisions = await opts.workTags.forWorks(all.flatMap((r) => (r.doi ? [r.id, `doi:${r.doi}`] : [r.id])))
      const applied = applyWorkTags(all, decisions, { mode: c.ledgerApply })
      all = applied.records
      ledger = { decisions, mode: c.ledgerApply, disputed: applied.stats.disputed_excluded > 0 }
    }
    const want = tagKeys ? new Set(tagKeys) : null
    const scoped = want ? all.filter((r) => recordTagKeys(r).some((k) => want.has(k))) : all
    // 审阅门槛：没审阅的照常发表，只是不进标签与图谱；数一下有几篇在等（只数圈进来的这些）
    const gated = c.reviewGate === 'reviewed_only' ? applyReviewGate(scoped) : null
    const records = gated ? gated.records : scoped
    const pending = gated ? gated.pending : undefined
    const tagCaveats: EvidenceCaveat[] = []
    if (ledger) {
      // 「有模型决定的标签」只看最终圈进来的记录（再套一遍是幂等的，只为数它）；「有争议没计入」看候选全体：争议可能正是它没被圈进来的原因
      if (applyWorkTags(records, ledger.decisions, { mode: ledger.mode }).stats.model_decided > 0) tagCaveats.push('model_decided_tags')
      if (ledger.disputed) tagCaveats.push('disputed_tags_excluded')
    }
    return { records, references: out.references, purposes: out.purposes, tagCaveats, pending }
  }
  /** 开了审阅门槛才下发「还有几篇在等」 */
  const pendingField = <K extends string>(key: K, pending: number | undefined) =>
    (pending === undefined ? {} : { [key]: pending }) as Partial<Record<K, number>>

  /** 账本的图注加到「标签」那一维的格子与共现图上 */
  const withTagCaveats = <T extends EvidenceOnsiteCounts>(data: T, extra: readonly EvidenceCaveat[]): T => extra.length === 0 ? data : {
    ...data,
    series: data.series.map((s) => (s.dimension === 'tag' ? { ...s, caveats: [...new Set([...(s.caveats ?? []), ...extra])] } : s)),
    tag_graph: data.tag_graph ? { ...data.tag_graph, caveats: [...new Set([...data.tag_graph.caveats, ...extra])] } : null,
  }

  async function safeBinding(key: string): Promise<EvidenceTagBinding | null> {
    if (!store) return null
    try { return await store.get(key) } catch (e) {
      log('[evidence.service] binding store failed', { error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }
  /** 编辑绑到这个主题的标签键。null ＝ 绑定表这次没取到（日志已记）；没配绑定表 ⇒ []。 */
  async function curatedKeysForTopic(topicId: string): Promise<string[] | null> {
    if (!store) return []
    try {
      return (await store.listByTopic(topicId)).filter((b) => b.kind === 'curated' && b.topic_id === topicId).map((b) => b.tag_key)
    } catch (e) {
      log('[evidence.service] binding store failed', { error: e instanceof Error ? e.message : String(e) })
      return null
    }
  }

  const bundle = (c: Cfg, source: ExternalEvidenceSource, level: ExternalLevel, id: string) =>
    cached<ExternalNodeBundle>(ck('bundle', source.id, level, id), c.ttl.bundle, () => source.nodeBundle(level, id), (b) => !b.partial)
  // 缓存键带版本：0.4.0 起示例作品带发表来源、开放获取地址、自己挂的主题与同一批里的引用，旧键下存的没有这些
  const sample = (c: Cfg, source: ExternalEvidenceSource, level: ExternalLevel, id: string) =>
    cached<EvidenceRecord[]>(ck('sample2', source.id, level, id, c.sampleSize), c.ttl.sample, () => source.sampleWorks(level, id, c.sampleSize))
  /** 往里一层（外部树）：分类树很少变，与缩放包同样缓存；没取全的不进长缓存 */
  const childrenOf = (c: Cfg, source: ExternalEvidenceSource, level: ExternalLevel, id: string) =>
    source.children
      ? cached(ck('children', source.id, level, id), c.ttl.bundle, () => source.children!(level, id), (v) => !v.partial)
      : Promise.resolve(undefined)

  async function machineResolve(c: Cfg, source: ExternalEvidenceSource, key: string, label: string): Promise<MachineResolution> {
    // 缓存键带挑法的版本：0.3.0 起从最多 10 条候选里优先挑同名的，旧键下存的是「只看第一条」的结果
    const r = await cached<MachineResolution>(ck('resolve2', source.id, key), c.ttl.resolve, async () => {
      const cands = await source.suggestTopics(label, MACHINE_CANDIDATE_LIMIT)
      if (cands === null) return null
      const pick = pickMachineCandidate(key, cands)
      return pick ? { kind: 'matched', topic_id: pick.candidate.topic_id, display_name: pick.candidate.display_name } : { kind: 'no_match' }
    }, (v) => v.kind !== 'error')
    return r ?? { kind: 'error' }
  }

  /**
   * 一个范围的证据确定性评级：没接端口 ⇒ undefined（不下发）；取不到 / 抛错 ⇒ null（UI 说「这次没取到」）；
   * 逐条验形，不合格的丢掉并记日志（只记条数，不记内容）。
   */
  async function certaintyFor(source: CertaintySource | null | undefined, scope: { level: EvidenceScaleLevel; id: string }): Promise<EvidenceCertainty[] | null | undefined> {
    if (!source) return undefined
    let raw: readonly unknown[] | null
    try { raw = await source.forScope(scope) } catch (e) {
      log('[evidence.service] certainty source failed', { error: e instanceof Error ? e.message : String(e) })
      return null
    }
    if (!Array.isArray(raw)) return null
    const ok = raw.map(checkCertainty).filter((x): x is EvidenceCertainty => x !== null)
    if (ok.length < raw.length) log('[evidence.service] certainty entries dropped', { dropped: raw.length - ok.length })
    return ok
  }

  const tagNode = (key: string, label: string, parentId: string | null, count: number | null): EvidenceTopic => ({
    id: `onsite:${key}`, source: 'onsite', external_id: key, level: 'tag', display_name: label, description: null, parent_id: parentId, works_count: count,
  })

  const guard = async <T>(fn: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> => {
    try { return await fn() } catch (e) {
      log('[evidence.service] failed', { error: e instanceof Error ? e.message : String(e) })
      return fail('unavailable')
    }
  }

  const service: EvidenceService = {
    getTagMap: (tag) => guard(async () => {
      const c = await cfg()
      const key = normalizeTag(tag)
      if (!key) return fail('invalid_input')
      const { records: onsite, references, purposes, pending } = await onsiteRecords(c, [key])
      const label = groupTags(onsite).find((g) => g.key === key)?.label ?? tag.trim()
      const curated = await safeBinding(key)
      const humanDecided = !!curated && curated.tag_key === key && (curated.kind === 'curated' || curated.kind === 'rejected')
      let machine: MachineResolution | undefined
      if (ext && c.policy !== 'off' && !humanDecided && (c.gate === 'any' || onsite.length > 0)) {
        machine = await machineResolve(c, ext, key, label)
      }
      const at = now().toISOString()
      let { binding, external_match } = resolveTagBinding({ tagKey: key, curated, machine, policy: c.policy, at })

      let parent: EvidenceTopic | null = null
      let external: EvidenceRecord[] = []
      let siblings: EvidenceTopic[] = []
      const t = binding?.topic_id ? splitTopicId(binding.topic_id) : null
      if (t && ext && t.source === ext.id && NODE_ID.topic.test(t.external_id)) {
        const [b, s] = await Promise.all([bundle(c, ext, 'topic', t.external_id), sample(c, ext, 'topic', t.external_id)])
        parent = b?.node ?? null
        external = s ?? []
        if (!b || !s) external_match = 'unavailable'
      } else if (t) {
        external_match = 'not_queried'
      }
      if (binding?.topic_id) {
        siblings = ((await curatedKeysForTopic(binding.topic_id)) ?? []).filter((k) => k !== key).map((k) => tagNode(k, k, binding!.topic_id, null))
      }
      const records = [...onsite, ...external]
      const certainty = await certaintyFor(opts.certainty, { level: 'tag', id: key })
      return ok<EvidenceMapData>({
        level: 'tag',
        focus: tagNode(key, label, binding?.topic_id ?? null, onsite.length),
        parent,
        siblings,
        records,
        view: pickEvidenceView(records),
        pooling: poolEvidence(records),
        sources: uniqueProvenance(records),
        onsite_only: external.length === 0,
        external_match,
        binding,
        edges: buildRecordEdges(records, references, { focusKeys: [key], purposes }),
        ...(certainty !== undefined ? { certainty } : {}),
        ...pendingField('onsite_pending', pending),
      })
    }),

    getNodeMap: (level, externalId) => guard(async () => {
      const c = await cfg()
      if (!isValidNodeId(level, externalId)) return fail('invalid_input')
      if (!ext) return fail('not_configured')
      if (opts.allowNode && !(await opts.allowNode(level, externalId))) return fail('not_found')
      const [b, s, kids] = await Promise.all([
        bundle(c, ext, level, externalId), sample(c, ext, level, externalId), level === 'topic' ? undefined : childrenOf(c, ext, level, externalId),
      ])
      if (!b) return fail('unavailable')
      const topicId = `${ext.id}:${externalId}`
      let onsite: EvidenceRecord[] = []
      let references: ReadonlyMap<string, readonly string[]> = new Map()
      let purposes: ReadonlyMap<string, ReadonlyMap<string, EvidenceCitationPurpose>> = new Map()
      let keys: string[] = []
      let pending: number | undefined
      // 往里一层：上级三级问外部树；主题往里是编辑绑到它的站内标签（篇数＝带这个标签的站内文章，与图谱同一批）
      let children: EvidenceTopic[] | null | undefined = kids === undefined ? undefined : kids?.children ?? null
      const childrenPartial = !!kids?.partial
      if (level === 'topic') {
        const bound = await curatedKeysForTopic(topicId)
        keys = bound ?? []
        if (keys.length > 0) ({ records: onsite, references, purposes, pending } = await onsiteRecords(c, keys))
        else if (c.reviewGate === 'reviewed_only') pending = 0
        if (store) {
          const groups = new Map(groupTags(onsite).map((g) => [g.key, g]))
          children = bound === null ? null : keys
            .map((k) => tagNode(k, groups.get(k)?.label ?? k, topicId, groups.get(k)?.count ?? 0))
            .sort((x, y) => (y.works_count ?? 0) - (x.works_count ?? 0) || (x.external_id < y.external_id ? -1 : x.external_id > y.external_id ? 1 : 0))
        }
      }
      const records = [...onsite, ...(s ?? [])]
      const certainty = await certaintyFor(opts.certainty, { level, id: topicId })
      return ok<EvidenceMapData>({
        level,
        focus: b.node,
        parent: b.ancestors[0] ?? null,
        siblings: b.siblings,
        records,
        view: pickEvidenceView(records),
        pooling: poolEvidence(records),
        sources: uniqueProvenance(records),
        onsite_only: !s,
        external_match: s ? 'matched' : 'unavailable',
        binding: null,
        edges: buildRecordEdges(records, references, { focusKeys: keys, purposes }),
        ...(certainty !== undefined ? { certainty } : {}),
        ...(children !== undefined ? { children } : {}),
        ...(childrenPartial ? { children_partial: true } : {}),
        ...pendingField('onsite_pending', pending),
      })
    }),

    getCounts: (level, externalId, scope = 'primary_topic') => guard(async () => {
      const c = await cfg()
      if (!isValidNodeId(level, externalId) || !(EVIDENCE_COUNT_SCOPES as readonly string[]).includes(scope)) return fail('invalid_input')
      if (!ext?.counts) return fail('not_configured')
      if (opts.allowNode && !(await opts.allowNode(level, externalId))) return fail('not_found')
      const b = await bundle(c, ext, level, externalId)
      if (!b) return fail('unavailable')
      const counts = await cached<EvidenceCountsData>(ck('counts', ext.id, level, externalId, scope), c.ttl.counts,
        () => ext.counts!(level, externalId, scope, b.node.display_name))
      if (!counts) return fail('unavailable')
      if (level !== 'topic') return ok(counts)
      const topicId = `${ext.id}:${externalId}`
      const keys = (await curatedKeysForTopic(topicId)) ?? []
      if (keys.length === 0) return ok({ ...counts, onsite: null })
      const { records, tagCaveats, pending } = await onsiteRecords(c, keys)
      return ok({
        ...counts,
        onsite: {
          ...withTagCaveats(countOnsiteLayer(records, {
            scope: { level: 'topic', id: topicId, display_name: b.node.display_name, tag_keys: keys },
            ...c.onsiteMeta, retrieved_at: now().toISOString(), excludeKeys: [],
          }), tagCaveats),
          ...pendingField('pending', pending),
        },
      })
    }),

    getTagCounts: (tag) => guard(async () => {
      const c = await cfg()
      const key = normalizeTag(tag)
      if (!key) return fail('invalid_input')
      const { records, tagCaveats, pending } = await onsiteRecords(c, [key])
      const label = groupTags(records).find((g) => g.key === key)?.label ?? tag.trim()
      return ok({
        ...withTagCaveats(countOnsiteLayer(records, {
          scope: { level: 'tag', id: `onsite:${key}`, display_name: label, tag_keys: [key] },
          ...c.onsiteMeta, retrieved_at: now().toISOString(),
        }), tagCaveats),
        ...pendingField('pending', pending),
      })
    }),

    getTagGraph: (query = {}) => guard(async () => {
      const c = await cfg()
      const focus = query.focus == null || query.focus === '' ? null : normalizeTag(query.focus)
      if (query.focus && !focus) return fail('invalid_input')
      const graphOpts: TagGraphOptions = {
        focus, minSupport: query.minSupport ?? c.graph.minSupport, maxNodes: query.maxNodes ?? c.graph.maxNodes, ...c.onsiteMeta,
      }
      // 键带审阅门槛：后台切换门槛后不会读到另一种口径下算的图
      const graph = await cached<EvidenceTagGraph>(ck('graph', c.reviewGate, focus ?? '*', graphOpts.minSupport ?? '-', graphOpts.maxNodes ?? '-'), c.ttl.onsite, async () => {
        const { records, tagCaveats, pending } = await onsiteRecords(c, focus ? [focus] : undefined)
        const built = buildTagGraph(records, { ...graphOpts, retrieved_at: now().toISOString() })
        const g = {
          ...(tagCaveats.length > 0 ? { ...built, caveats: [...new Set([...built.caveats, ...tagCaveats])] } : built),
          ...pendingField('pending', pending),
        }
        if (store && g.nodes.length > 0) {
          const keys = g.nodes.map((n) => n.key)
          let found = new Map<string, EvidenceTagBinding>()
          try {
            found = store.getMany ? await store.getMany(keys) : new Map((await Promise.all(keys.map(async (k) => [k, await store.get(k)] as const)))
              .filter((x): x is readonly [string, EvidenceTagBinding] => !!x[1]))
          } catch (e) {
            log('[evidence.service] binding store failed', { error: e instanceof Error ? e.message : String(e) })
          }
          for (const n of g.nodes) {
            const b = found.get(n.key)
            n.topic_id = b && b.kind === 'curated' ? b.topic_id : null // 只认人工绑定
          }
        }
        return g
      }, () => true, onsiteCache)
      return graph ? ok(graph) : fail('unavailable')
    }),

    suggestBindings: (tag, o = {}) => guard(async () => {
      const c = await cfg()
      const key = normalizeTag(tag)
      if (!key) return fail('invalid_input')
      if (!ext) return fail('not_configured')
      const limit = Math.max(1, Math.min(o.limit ?? 5, 10))
      const { records, references } = await onsiteRecords(c, [key])
      const label = groupTags(records).find((g) => g.key === key)?.label ?? tag.trim()
      const cands = await cached(ck('suggest', ext.id, key, limit), c.ttl.suggest, () => ext.suggestTopics(label, limit))
      if (cands === null) return fail('unavailable')

      // 引用这一路：带这个标签的文章引用的文献，主主题落在哪
      let cited: { works: number; byTopic: Map<string, { name: string; n: number }> } | null = null
      // 引用太多时取确定性的伪随机样本（按字典序截断会只留下几家出版社）；缓存键是整批 DOI 的哈希
      const dois = sampleDois(records.flatMap((r) => references.get(r.id) ?? []), c.maxDois)
      if (ext.topicsForDois && dois.length > 0) {
        const res = await cached(ck('dois', ext.id, dois.length, fnv1a(dois.join('\n')).toString(16)), c.ttl.dois, () => ext.topicsForDois!(dois))
        if (res) {
          const byTopic = new Map<string, { name: string; n: number }>()
          let works = 0
          for (const x of res) {
            if (!x.topic) continue
            works++
            const cur = byTopic.get(x.topic.topic_id) ?? { name: x.topic.display_name, n: 0 }
            cur.n++
            byTopic.set(x.topic.topic_id, cur)
          }
          cited = { works, byTopic }
        }
      }
      const citedFor = (topicId: string): EvidenceBindingSuggestion['cited'] => {
        if (!cited || cited.works === 0) return null
        const k = cited.byTopic.get(topicId)?.n ?? 0
        const ci = wilsonInterval(k, cited.works)!
        return { works: cited.works, in_topic: k, share: k / cited.works, ci_low: ci.low, ci_high: ci.high }
      }
      const out: EvidenceBindingSuggestion[] = cands.map((c, i) => ({
        topic_id: c.topic_id, display_name: c.display_name, works_count: c.works_count, rank: i,
        name_match: tagNameMatch(key, c.display_name), cited: citedFor(c.topic_id),
      }))
      if (cited) {
        const extra = [...cited.byTopic.entries()]
          .filter(([id]) => !out.some((s) => s.topic_id === id))
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, 3)
        for (const [id, v] of extra) {
          out.push({ topic_id: id, display_name: v.name, works_count: null, rank: null, name_match: tagNameMatch(key, v.name), cited: citedFor(id) })
        }
      }
      const nameRank = { exact: 0, contains: 1, none: 2 } as const
      out.sort((a, b) => (b.cited?.in_topic ?? 0) - (a.cited?.in_topic ?? 0)
        || nameRank[a.name_match] - nameRank[b.name_match]
        || (a.rank ?? Infinity) - (b.rank ?? Infinity))
      return ok(out)
    }),

    curate: (input) => guard(async () => {
      const c = await cfg()
      if (!store) return fail('not_configured')
      let topic: { id: string; display_name: string } | null = null
      if (input.topic_id !== null) {
        const t = splitTopicId(input.topic_id)
        if (!t || !NODE_ID.topic.test(t.external_id)) return fail('invalid_input')
        if (ext && t.source === ext.id) {
          const b = await bundle(c, ext, 'topic', t.external_id)
          if (!b) return fail('not_found')
          topic = { id: input.topic_id, display_name: b.node.display_name }
        } else {
          topic = { id: input.topic_id, display_name: input.topic_id }
        }
      }
      const binding = createCuratedBinding({ tag: input.tag, topic, by: input.by, note: input.note ?? null, at: now().toISOString() })
      if (!binding) return fail('invalid_input')
      await store.put(binding)
      onsiteCache.clear() // 共现图的节点标着绑定的主题：任何一张都可能含这个标签，整个清掉
      return ok(binding)
    }),

    bindingQueue: (o = {}) => guard(async () => {
      const c = await cfg()
      if (!store) return fail('not_configured')
      const limit = Math.max(1, Math.min(o.limit ?? 50, 200))
      const minArticles = Math.max(1, o.minArticles ?? 1)
      const { records } = await onsiteRecords(c)
      const groups = groupTags(records).filter((g) => g.count >= minArticles)
      const out: EvidenceBindingQueueItem[] = []
      for (const g of groups) {
        if (out.length >= limit) break
        let decided: EvidenceTagBinding | null = null
        try { decided = await store.get(g.key) } catch (e) {
          log('[evidence.service] binding store failed', { error: e instanceof Error ? e.message : String(e) })
        }
        if (decided && decided.tag_key === g.key && (decided.kind === 'curated' || decided.kind === 'rejected')) continue
        const machine = ext && c.policy !== 'off' ? await machineResolve(c, ext, g.key, g.label) : undefined
        const { binding, external_match } = resolveTagBinding({ tagKey: g.key, curated: decided, machine, policy: c.policy, at: now().toISOString() })
        out.push({
          tag_key: g.key, label: g.label, articles: g.count, external_match, binding,
          candidate: machine && machine.kind === 'matched' ? { topic_id: machine.topic_id, display_name: machine.display_name } : null,
        })
      }
      return ok(out)
    }),

    intake: (article) => {
      const c = cfgNow()
      return intakeArticle(article, { ...c.onsiteMeta, retrieved_at: now().toISOString(), requireReview: c.reviewGate === 'reviewed_only' })
    },

    settings: async () => (await cfg()).settings,
  }
  return service
}
