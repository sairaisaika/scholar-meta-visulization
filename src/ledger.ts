/**
 * 标签账本——论文的标签由谁、按什么规则说了算（纯规则 + 存储端口 + 一个薄门面；零 IO）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 用途：愿意的人（或他们跑的模型）给论文打完标签后，把结论存进一个共享的地方；多方意见冲突时有章可循；
 * 以后想改某篇论文的标签，有明确的申请与审核流程。引擎只定规则与形状，「那个地方」（账号、鉴权、存储、审核界面）由接入方托管。
 *
 * 【裁决】`resolveWorkTags`，每个标签独立裁决，规则可以一句话讲清：
 *   1. 每个断言者只算**最新**一次立场（改主意就是新立场，旧的留档不作废）；
 *   2. 模型的最新立场低于置信门槛 ⇒ 它在这个标签上没有立场（不回退到它更早的结论）；
 *   3. 从最高信任层级往下找，**第一个有人表态的层级说了算**——人永远压过模型，编辑压过贡献者；
 *   4. 这一级有经审核通过的立场（修改申请通过后写入的）⇒ 最近的那条说了算；
 *   5. 否则这一级意见一致 ⇒ present / absent；不一致 ⇒ **disputed**（不投票、不取多数：分歧本身就是要人看的信号，交给审核来定）。
 * 【写入闸】`checkAssertion`：低一级的断言如果与高一级的现行结论相反（或者要去碰高一级的争议），不能直接写，回 `needs_change_request`；
 *   经审核的结论，同级也不能直接推翻，要再提一次申请（由别人审）。
 * 【修改申请】`openChangeRequest` / `decideChangeRequest` / `withdrawChangeRequest`：只有人能申请与审核；不能审自己的申请；
 *   审核人的层级要 ≥ 设定的审核门槛，并且 ≥ 所涉标签现行结论的层级；通过后以审核人的名义写入断言，带上申请 id，全程留痕；
 *   **通过即生效**：这条经审核的立场在它那一级说了算，同级的旧立场不再构成争议。
 * 【优待自己人】层级顺序与审核门槛是策略参数：接入方把自家编辑放在 editor / maintainer，社区贡献者放在 contributor，模型在最低。
 * 【门面】`createTagLedger`：作品 id 一律过 `normalizeWorkId`（同一篇论文只有一个键）；与自己现有立场相同的断言不重复写。
 */
import type {
  EvidenceCaveat, EvidenceChangeRequestStatus, EvidenceLedgerRefusal, EvidenceTagActor, EvidenceTagAssertion, EvidenceTagChangeRequest,
  EvidenceTrustTier, EvidenceWorkTag,
} from './types'
import { EVIDENCE_TRUST_TIERS } from './types'
import { normalizeTag } from './tags'
import { normalizeWorkId } from './tagging'
import type { TagSuggestionView } from './tagging'

export interface LedgerPolicy {
  /** 从高到低；缺省 maintainer > editor > contributor > model */
  tierOrder: readonly EvidenceTrustTier[]
  /** 模型断言至少多高的置信度才算（没给置信度的算） */
  modelMinConfidence: number
  /** 审核修改申请的最低层级 */
  reviewTier: EvidenceTrustTier
}

export const DEFAULT_LEDGER_POLICY: LedgerPolicy = { tierOrder: EVIDENCE_TRUST_TIERS, modelMinConfidence: 0.5, reviewTier: 'editor' }

const rankOf = (policy: LedgerPolicy) => {
  const order = new Map(policy.tierOrder.map((t, i) => [t, i]))
  return (t: EvidenceTrustTier) => order.get(t) ?? policy.tierOrder.length
}
const actorKey = (a: EvidenceTagActor) => `${a.kind}:${a.id}`
const later = (a: EvidenceTagAssertion, b: EvidenceTagAssertion) => a.at > b.at || (a.at === b.at && a.id > b.id)

/** 一篇论文的全部断言 → 每个标签的生效结论（按标签键排序）。 */
export function resolveWorkTags(assertions: readonly EvidenceTagAssertion[], policy: LedgerPolicy = DEFAULT_LEDGER_POLICY): EvidenceWorkTag[] {
  const rank = rankOf(policy)
  const byTag = new Map<string, Map<string, EvidenceTagAssertion>>()
  for (const a of assertions) {
    const perActor = byTag.get(a.tag_key) ?? new Map<string, EvidenceTagAssertion>()
    const prev = perActor.get(actorKey(a.by))
    if (!prev || later(a, prev)) perActor.set(actorKey(a.by), a)
    byTag.set(a.tag_key, perActor)
  }
  const out: EvidenceWorkTag[] = []
  for (const [tag_key, perActor] of byTag) {
    // 先取每人最新立场，再按门槛筛：模型最新一次没把握，就等于它没有立场（不回退到它更早的高置信结论）
    const stances = [...perActor.values()]
      .filter((a) => !(a.by.kind === 'model' && a.confidence !== null && a.confidence < policy.modelMinConfidence))
      .sort((x, y) => (later(x, y) ? -1 : 1))
    if (stances.length === 0) continue
    const support: EvidenceWorkTag['support'] = {}
    for (const a of stances) {
      const s = support[a.by.tier] ?? { add: 0, remove: 0 }
      s[a.op === 'add' ? 'add' : 'remove']++
      support[a.by.tier] = s
    }
    const top = stances.map((a) => a.by.tier).sort((x, y) => rank(x) - rank(y))[0]!
    const s = support[top]!
    // 这一级有经审核通过的立场 ⇒ 最近的那条说了算（审核就是这一级解决分歧的办法）；否则意见不一即争议
    const reviewed = stances.find((a) => a.by.tier === top && a.request_id !== null)
    const state = reviewed
      ? (reviewed.op === 'add' ? 'present' : 'absent')
      : s.add > 0 && s.remove > 0 ? 'disputed' : s.add > 0 ? 'present' : 'absent'
    const label = (stances.find((a) => a.op === 'add') ?? stances[0]!).tag_label
    out.push({ tag_key, label, state, decided_by: top, support, last_changed: stances[0]!.at, request_id: reviewed?.request_id ?? null })
  }
  return out.sort((a, b) => (a.tag_key < b.tag_key ? -1 : 1))
}

/**
 * 写入闸：这条断言能不能直接写。更高一级随时可以改；同级可以表态（意见不一会成为争议），但**经审核的结论**同级不能直接推翻；
 * 低一级不能推翻高一级的结论，也不能去碰高一级的争议。不能直接写的，回 `needs_change_request`——走修改申请。
 */
export function checkAssertion(
  current: EvidenceWorkTag | undefined, incoming: { op: 'add' | 'remove'; by: EvidenceTagActor }, policy: LedgerPolicy = DEFAULT_LEDGER_POLICY,
): { ok: true } | { ok: false; refusal: EvidenceLedgerRefusal } {
  if (!current) return { ok: true }
  const rank = rankOf(policy)
  const mine = rank(incoming.by.tier)
  const decided = rank(current.decided_by)
  if (mine < decided) return { ok: true }
  if (mine === decided && !current.request_id) return { ok: true }
  const contradicts = current.state === 'disputed'
    || (current.state === 'present' && incoming.op === 'remove')
    || (current.state === 'absent' && incoming.op === 'add')
  return contradicts ? { ok: false, refusal: 'needs_change_request' } : { ok: true }
}

type Result<T> = { ok: true; value: T } | { ok: false; refusal: EvidenceLedgerRefusal }

/** 开一个修改申请：只有人能申请；作品 id 要认得出；至少一处改动；标签要合法；理由必填。 */
export function openChangeRequest(input: {
  id: string; work_id: string; changes: ReadonlyArray<{ op: 'add' | 'remove'; tag: string }>; by: EvidenceTagActor; reason: string; at: string
}): Result<EvidenceTagChangeRequest> {
  if (input.by.kind !== 'person') return { ok: false, refusal: 'not_a_person' }
  const workId = normalizeWorkId(input.work_id)
  if (!workId) return { ok: false, refusal: 'invalid_work' }
  if (input.changes.length === 0 || !input.reason.trim()) return { ok: false, refusal: 'empty_request' }
  const changes: EvidenceTagChangeRequest['changes'] = []
  for (const c of input.changes) {
    const key = normalizeTag(c.tag)
    if (!key) return { ok: false, refusal: 'invalid_tag' }
    changes.push({ op: c.op, tag_key: key, tag_label: c.tag.trim() })
  }
  return {
    ok: true,
    value: {
      id: input.id, work_id: workId, changes, by: input.by, reason: input.reason.trim().slice(0, 2000), status: 'open',
      created_at: input.at, decided_at: null, decided_by: null, decision_note: null,
    },
  }
}

/**
 * 审核：只有人、不能审自己的、层级 ≥ 审核门槛且 ≥ 所涉标签现行结论的层级。
 * 通过 ⇒ 以审核人的名义为每处改动写一条断言（带申请 id），驳回 ⇒ 不写断言。两种都留下决定人、时间、说明。
 */
export function decideChangeRequest(
  request: EvidenceTagChangeRequest,
  input: { decision: 'accept' | 'reject'; by: EvidenceTagActor; note?: string | null | undefined; at: string; current: readonly EvidenceWorkTag[]; newId: () => string },
  policy: LedgerPolicy = DEFAULT_LEDGER_POLICY,
): Result<{ request: EvidenceTagChangeRequest; assertions: EvidenceTagAssertion[] }> {
  if (request.status !== 'open') return { ok: false, refusal: 'not_open' }
  if (input.by.kind !== 'person') return { ok: false, refusal: 'not_a_person' }
  if (actorKey(input.by) === actorKey(request.by)) return { ok: false, refusal: 'self_review' }
  const rank = rankOf(policy)
  const needed = [policy.reviewTier, ...request.changes
    .map((c) => input.current.find((t) => t.tag_key === c.tag_key)?.decided_by)
    .filter((t): t is EvidenceTrustTier => !!t)]
  if (needed.some((t) => rank(input.by.tier) > rank(t))) return { ok: false, refusal: 'insufficient_tier' }
  const status: EvidenceChangeRequestStatus = input.decision === 'accept' ? 'accepted' : 'rejected'
  const decided = { ...request, status, decided_at: input.at, decided_by: input.by, decision_note: input.note ?? null }
  const assertions = input.decision === 'accept'
    ? request.changes.map((c) => ({
      id: input.newId(), work_id: request.work_id, tag_key: c.tag_key, tag_label: c.tag_label, op: c.op, by: input.by,
      confidence: null, at: input.at, note: input.note ?? null, request_id: request.id,
    }))
    : []
  return { ok: true, value: { request: decided, assertions } }
}

/** 撤回：只有申请人，只在 open 时。 */
export function withdrawChangeRequest(request: EvidenceTagChangeRequest, by: EvidenceTagActor, at: string): Result<EvidenceTagChangeRequest> {
  if (request.status !== 'open') return { ok: false, refusal: 'not_open' }
  if (actorKey(by) !== actorKey(request.by)) return { ok: false, refusal: 'not_requester' }
  return { ok: true, value: { ...request, status: 'withdrawn', decided_at: at, decided_by: by, decision_note: null } }
}

// ── 结论用到统计上 ──────────────────────────────────────────────────────────────

export interface AppliedWorkTags<R> {
  records: R[]
  stats: {
    /** 账本里有结论的记录数 */
    works_with_decisions: number
    /** 账本加上的标签数 · 拿掉的标签数（作者打了、账本判没有或有争议） */
    added: number
    removed: number
    /** 账本里有争议、这次没计入的标签数 */
    disputed_excluded: number
    /** 计入的标签里由模型那一级决定的 */
    model_decided: number
  }
  /** 给图注：有模型决定的标签 ⇒ `model_decided_tags`；有争议没计入 ⇒ `disputed_tags_excluded` */
  caveats: EvidenceCaveat[]
}

/**
 * 把账本的生效结论用到记录的标签上（计数、画图之前）。只有 present 计入，disputed 一律先不计入。
 *   · `merge`（缺省）：作者原本的标签，去掉账本判 absent / disputed 的，加上账本判 present 的；账本没说的照旧；
 *   · `ledger_only`：只用账本判 present 的。
 * 记录按 id 找结论，也按 `doi:<doi>` 找（账本里用 DOI 记的论文与外部源的记录对得上；两处说法不同时 id 那处优先）。
 */
export function applyWorkTags<R extends { id: string; doi?: string | null; tags?: string[] }>(
  records: readonly R[], decisions: ReadonlyMap<string, readonly EvidenceWorkTag[]>, opts: { mode?: 'merge' | 'ledger_only' } = {},
): AppliedWorkTags<R> {
  const byWork = new Map<string, readonly EvidenceWorkTag[]>()
  for (const [k, v] of decisions) {
    const id = normalizeWorkId(k)
    if (id && !byWork.has(id)) byWork.set(id, v)
  }
  const stats: AppliedWorkTags<R>['stats'] = { works_with_decisions: 0, added: 0, removed: 0, disputed_excluded: 0, model_decided: 0 }
  const out = records.map((r) => {
    const decided = new Map<string, EvidenceWorkTag>()
    for (const key of [normalizeWorkId(r.id), r.doi ? normalizeWorkId(`doi:${r.doi}`) : null]) {
      for (const t of (key && byWork.get(key)) || []) if (!decided.has(t.tag_key)) decided.set(t.tag_key, t)
    }
    if (decided.size === 0 && opts.mode !== 'ledger_only') return r
    if (decided.size > 0) stats.works_with_decisions++
    const tags: string[] = []
    const kept = new Set<string>()
    for (const raw of r.tags ?? []) {
      const key = normalizeTag(raw)
      const d = key ? decided.get(key) : undefined
      if (key && (opts.mode === 'ledger_only' ? d?.state !== 'present' : d !== undefined && d.state !== 'present')) { stats.removed++; continue }
      tags.push(raw)
      if (key && !kept.has(key)) { kept.add(key); if (d?.decided_by === 'model') stats.model_decided++ }
    }
    for (const d of decided.values()) {
      if (d.state === 'disputed') stats.disputed_excluded++
      if (d.state !== 'present' || kept.has(d.tag_key)) continue
      tags.push(d.label)
      kept.add(d.tag_key)
      stats.added++
      if (d.decided_by === 'model') stats.model_decided++
    }
    return { ...r, tags }
  })
  const caveats: EvidenceCaveat[] = []
  if (stats.model_decided > 0) caveats.push('model_decided_tags')
  if (stats.disputed_excluded > 0) caveats.push('disputed_tags_excluded')
  return { records: out, stats, caveats }
}

// ── 存储端口与门面 ──────────────────────────────────────────────────────────────

/** 账本存在哪由接入方定（一张断言表 + 一张申请表）。断言只追加，不改不删——那是审计线索。 */
export interface TagLedgerStore {
  append(assertions: readonly EvidenceTagAssertion[]): Promise<void>
  listByWork(workId: string): Promise<EvidenceTagAssertion[]>
  /** 可选：一次取多篇（服务给一批记录找结论时用；没有就逐篇 listByWork） */
  listByWorks?(workIds: readonly string[]): Promise<EvidenceTagAssertion[]>
  putRequest(request: EvidenceTagChangeRequest): Promise<void>
  getRequest(id: string): Promise<EvidenceTagChangeRequest | null>
  listRequests(query: { status?: EvidenceChangeRequestStatus; work_id?: string }): Promise<EvidenceTagChangeRequest[]>
}

export function createMemoryTagLedgerStore(): TagLedgerStore {
  const assertions: EvidenceTagAssertion[] = []
  const requests = new Map<string, EvidenceTagChangeRequest>()
  return {
    async append(list) { assertions.push(...list.map((a) => ({ ...a }))) },
    async listByWork(workId) { return assertions.filter((a) => a.work_id === workId).map((a) => ({ ...a })) },
    async listByWorks(workIds) { const want = new Set(workIds); return assertions.filter((a) => want.has(a.work_id)).map((a) => ({ ...a })) },
    async putRequest(r) { requests.set(r.id, { ...r }) },
    async getRequest(id) { const r = requests.get(id); return r ? { ...r } : null },
    async listRequests(q) {
      return [...requests.values()].filter((r) => (!q.status || r.status === q.status) && (!q.work_id || r.work_id === q.work_id)).map((r) => ({ ...r }))
    },
  }
}

const defaultNewId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID ? c.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface TagWriteResult {
  written: EvidenceTagAssertion[]
  /** 与这个断言者现有的立场一样，没有重复写（标签键）。只说明立场已在档，不代表现行结论与它一致——结论看 `workTags` */
  unchanged: string[]
  /** 没写进去的：作品 id 或标签不合法、或要推翻更高一级的结论（得提修改申请） */
  refused: Array<{ tag: string; refusal: EvidenceLedgerRefusal }>
}

/** 账本门面：把规则与存储接起来。鉴权（谁是哪一级）由接入方在调用前做好，传进 `actor`。 */
export function createTagLedger(input: {
  store: TagLedgerStore
  policy?: Partial<LedgerPolicy> | (() => Partial<LedgerPolicy>)
  now?: () => Date
  newId?: () => string
}) {
  const policy = (): LedgerPolicy => ({ ...DEFAULT_LEDGER_POLICY, ...(typeof input.policy === 'function' ? input.policy() : input.policy ?? {}) })
  const now = () => (input.now ?? (() => new Date()))().toISOString()
  const newId = input.newId ?? defaultNewId
  const workTags = async (workId: string) => {
    const id = normalizeWorkId(workId)
    return id ? resolveWorkTags(await input.store.listByWork(id), policy()) : []
  }

  const write = async (
    rawWorkId: string, items: ReadonlyArray<{ op: 'add' | 'remove'; tag: string; confidence?: number | null; note?: string | null }>, actor: EvidenceTagActor,
  ): Promise<TagWriteResult> => {
    const workId = normalizeWorkId(rawWorkId)
    if (!workId) return { written: [], unchanged: [], refused: items.map((i) => ({ tag: i.tag, refusal: 'invalid_work' as const })) }
    const log = await input.store.listByWork(workId)
    const current = resolveWorkTags(log, policy())
    const mine = new Map<string, EvidenceTagAssertion>() // 这个断言者在各标签上的最新立场
    for (const a of log) {
      if (actorKey(a.by) !== actorKey(actor)) continue
      const prev = mine.get(a.tag_key)
      if (!prev || later(a, prev)) mine.set(a.tag_key, a)
    }
    const written: EvidenceTagAssertion[] = []
    const unchanged: string[] = []
    const refused: TagWriteResult['refused'] = []
    const at = now()
    const last = new Map<string, (typeof items)[number]>() // 同一次写入里同一个标签只留最后一条（同一时刻的两种立场分不出先后）
    for (const item of items) {
      const key = normalizeTag(item.tag)
      if (!key) { refused.push({ tag: item.tag, refusal: 'invalid_tag' }); continue }
      last.delete(key)
      last.set(key, item)
    }
    for (const [key, item] of last) {
      const confidence = actor.kind === 'model' && typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence)) : null
      const prev = mine.get(key)
      if (prev && prev.op === item.op && prev.confidence === confidence && prev.by.tier === actor.tier) { unchanged.push(key); continue }
      const check = checkAssertion(current.find((t) => t.tag_key === key), { op: item.op, by: actor }, policy())
      if (!check.ok) { refused.push({ tag: item.tag, refusal: check.refusal }); continue }
      written.push({
        id: newId(), work_id: workId, tag_key: key, tag_label: item.tag.trim(), op: item.op, by: actor,
        confidence, at, note: item.note ?? null, request_id: null,
      })
    }
    if (written.length > 0) await input.store.append(written)
    return { written, unchanged, refused }
  }

  return {
    policy,
    workTags,
    /** 一批作品的生效结论（服务的 `workTags` 端口直接收这个账本） */
    async forWorks(workIds: readonly string[]): Promise<Map<string, EvidenceWorkTag[]>> {
      const ids = [...new Set(workIds.map(normalizeWorkId).filter((x): x is string => x !== null))]
      if (ids.length === 0) return new Map()
      const log = input.store.listByWorks
        ? await input.store.listByWorks(ids)
        : (await Promise.all(ids.map((id) => input.store.listByWork(id)))).flat()
      const byWork = new Map<string, EvidenceTagAssertion[]>()
      for (const a of log) {
        const list = byWork.get(a.work_id)
        if (list) list.push(a)
        else byWork.set(a.work_id, [a])
      }
      const p = policy()
      return new Map([...byWork].map(([id, list]) => [id, resolveWorkTags(list, p)] as const))
    },
    /** 人或模型直接写断言（受写入闸约束） */
    assert: write,
    /** 模型的建议（`runTagger` 的输出）写成 add 断言，带置信度与模型版本 */
    submitSuggestions: (workId: string, suggestions: readonly TagSuggestionView[], model: { id: string; version: string; tier?: EvidenceTrustTier }) =>
      write(workId, suggestions.map((s) => ({ op: 'add' as const, tag: s.label, confidence: s.confidence, note: s.rationale })),
        { kind: 'model', id: model.id, tier: model.tier ?? 'model', model_version: model.version }),
    async requestChange(workId: string, changes: ReadonlyArray<{ op: 'add' | 'remove'; tag: string }>, actor: EvidenceTagActor, reason: string) {
      const r = openChangeRequest({ id: newId(), work_id: workId, changes, by: actor, reason, at: now() })
      if (r.ok) await input.store.putRequest(r.value)
      return r
    },
    async decide(requestId: string, decision: 'accept' | 'reject', reviewer: EvidenceTagActor, note?: string | null) {
      const request = await input.store.getRequest(requestId)
      if (!request) return { ok: false as const, refusal: 'not_found' as const }
      const r = decideChangeRequest(request, { decision, by: reviewer, note, at: now(), current: await workTags(request.work_id), newId }, policy())
      if (r.ok) {
        if (r.value.assertions.length > 0) await input.store.append(r.value.assertions)
        await input.store.putRequest(r.value.request)
      }
      return r
    },
    async withdraw(requestId: string, actor: EvidenceTagActor) {
      const request = await input.store.getRequest(requestId)
      if (!request) return { ok: false as const, refusal: 'not_found' as const }
      const r = withdrawChangeRequest(request, actor, now())
      if (r.ok) await input.store.putRequest(r.value)
      return r
    },
    async openRequests(workId?: string) {
      if (workId === undefined) return input.store.listRequests({ status: 'open' })
      const id = normalizeWorkId(workId)
      return id ? input.store.listRequests({ status: 'open', work_id: id }) : []
    },
  }
}

export type TagLedger = ReturnType<typeof createTagLedger>
