/**
 * 社区标注——公开平台的裁决、导出读取与宿主端口（纯函数、零 IO；主入口导出）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 任何人都可以给公开论文打标签（L0）、说它是什么研究（L1 分面）、从原文抄一行数字（L2 结果行），也可以给别人的标注投
 * 「认可 / 不认可 / 不确定」。这里只定**规则与形状**；账号、存储（GitHub 仓库）、入库 Action、页面都在标注平台自己的仓里。
 *
 * 【裁决】`resolveAnnotations`，每个 (作品, subject) 独立裁决，与标签账本同一套层级规则（`resolveWorkTags`）再加一条：
 *   1. 每个断言者只算最新立场；模型断言只记不算（公开社区里没有可信的置信门槛）；
 *   2. 从最高层往下找第一个有人表态的层级：编辑 / 维护者层一致 ⇒ confirmed / removed，分歧 ⇒ disputed（不投票）；
 *   3. 只有贡献者层有立场时按**比例**裁决（`assessQuorum`：Wilson 区间整体高于 / 低于门槛；反对人数不够只算「挑战」）；
 *   4. 结果行是**整行原子**：认可必须带整行盲复录，在容差内一致才算一票（`matchReExtraction`），不一致自动变成不认可；
 *      行要 accepted 还得有第二个人独立复录一致（或编辑层提出 / 认可），否则停在 pending；同一处两个不同的数值 ⇒ 都 disputed；
 *   5. 没写原文出处的研究设计 / 数字最多到 pending。
 * 【导出】平台按 `EvidenceCommunityExport` 的形状发一份静态文件；宿主用 `readCommunityExport` 验形（坏条目逐条报、不抛），
 *   再用 `createCommunityPorts` 装成现成的端口交给 `createEvidenceService`——宿主不写解析代码，引擎不拉文件、不认识任何平台。
 */
import type {
  EvidenceAnnotation, EvidenceAnnotationKind, EvidenceAnnotationPayload, EvidenceCommunityDecision, EvidenceCommunityExport, EvidenceCommunityExportIssue,
  EvidenceCommunityExportManifest, EvidenceCommunityPolicy, EvidenceCommunityState, EvidenceCommunityWork, EvidenceConcept, EvidenceFacetId,
  EvidenceRowEffectInput, EvidenceTagBinding, EvidenceTrustTier, EvidenceVerification, EvidenceWorkCard, EvidenceWorkTag, EvidenceDirection,
} from './types'
import {
  EVIDENCE_COMMUNITY_STATES, EVIDENCE_CONTRACT_VERSION, EVIDENCE_FACET_IDS, EVIDENCE_TRUST_TIERS, EVIDENCE_WORK_TAG_STATES, EVIDENCE_TAG_BINDING_KINDS,
} from './types'
import { assessQuorum, DEFAULT_QUORUM_RULE } from './ledger'
import { normalizeTag } from './tags'
import { normalizeWorkId } from './tagging'
import { intakeOutcomeRows, type SynthesisContext } from './synthesis'
import { workRefOfKey } from './workref'
import type { OnsiteArticleSource, TagBindingStore, WorkTagSource } from './ports'

/** 缺省参数（平台配置随导出下发时以导出里的为准）。 */
export const DEFAULT_COMMUNITY_POLICY: EvidenceCommunityPolicy = {
  quorum: DEFAULT_QUORUM_RULE,
  row: { require_re_extraction: true, tolerance: { relative: 0.005, absolute: 0.005 } },
  min_tier: { binding: 'editor', independence: 'editor', appraisal: 'editor' },
  model_min_confidence: 0.5,
}

const VERIFICATION_RANK: Record<EvidenceVerification, number> = { single: 0, double: 1, editor: 2 }
const COUNTED: readonly EvidenceCommunityState[] = ['accepted', 'confirmed']
const later = (a: EvidenceAnnotation, b: EvidenceAnnotation) => a.at > b.at || (a.at === b.at && a.id > b.id)
const actorKey = (a: EvidenceAnnotation) => `${a.by.kind}:${a.by.id}`
const tierRank = (t: EvidenceTrustTier) => { const i = EVIDENCE_TRUST_TIERS.indexOf(t); return i < 0 ? EVIDENCE_TRUST_TIERS.length : i }
const isPerson = (a: EvidenceAnnotation) => a.by.kind === 'person'
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** 两次抄录是不是同一行：度量与方向相等；点估计与区间在容差内（相对或绝对，取大者）；n 精确；p 比到 3 位有效数字。 */
export function matchReExtraction(
  a: { effect: EvidenceRowEffectInput | null; direction: EvidenceDirection | null } | null,
  b: { effect: EvidenceRowEffectInput | null; direction: EvidenceDirection | null } | null,
  tol: EvidenceCommunityPolicy['row']['tolerance'] = DEFAULT_COMMUNITY_POLICY.row.tolerance,
): { match: boolean; diffs: string[] } {
  const diffs: string[] = []
  if (!a || !b) return { match: false, diffs: ['missing'] }
  if ((a.direction ?? null) !== (b.direction ?? null)) diffs.push('direction')
  const x = a.effect
  const y = b.effect
  if (!x !== !y) diffs.push('effect')
  else if (x && y) {
    if (x.metric !== y.metric) diffs.push('metric')
    if ((x.higher_is_better ?? null) !== (y.higher_is_better ?? null)) diffs.push('higher_is_better')
    const near = (p: number | null, q: number | null) => {
      if (p === null || q === null) return p === q
      if (!Number.isFinite(p) || !Number.isFinite(q)) return false
      return Math.abs(p - q) <= Math.max(Math.abs(p) * tol.relative, tol.absolute)
    }
    for (const f of ['value', 'ci_low', 'ci_high'] as const) if (!near(x[f], y[f])) diffs.push(f)
    if ((x.n ?? null) !== (y.n ?? null)) diffs.push('n')
    const sig = (p: number | null) => (p === null || !Number.isFinite(p) ? null : Number(p.toPrecision(3)))
    if (sig(x.p_value) !== sig(y.p_value)) diffs.push('p_value')
  }
  return { match: diffs.length === 0, diffs }
}

/** 名片进仓 / 进导出之前把摘要置空：摘要不是 CC0 的一部分，只在浏览器里现取现显。 */
export function publicWorkCard(card: EvidenceWorkCard): EvidenceWorkCard {
  return { ...card, abstract: null }
}

/**
 * 结局语境 → 受控概念 id（按别名 / 显示名归一后比较；只认 `active` 的概念）。解析不到的分面不出现在结果里。
 * 导出时做：词表每加一条别名，历史行立即并框；标注者不被词表卡住。
 */
export function resolveConcepts(
  context: Partial<Pick<SynthesisContext, 'outcome' | 'population' | 'comparison' | 'timepoint'>>,
  concepts: readonly EvidenceConcept[],
): Partial<Record<EvidenceFacetId, string>> {
  const out: Partial<Record<EvidenceFacetId, string>> = {}
  const index = new Map<string, string>()
  for (const c of concepts) {
    if (c.status !== 'active') continue
    for (const alias of [...Object.values(c.label), ...c.aliases]) {
      const k = normalizeTag(alias)
      if (k && !index.has(`${c.facet}\u0000${k}`)) index.set(`${c.facet}\u0000${k}`, c.id)
    }
  }
  for (const facet of ['outcome', 'population', 'comparison', 'timepoint'] as const) {
    const raw = context[facet]
    const k = raw ? normalizeTag(raw) : null
    const id = k ? index.get(`${facet}\u0000${k}`) : undefined
    if (id) out[facet] = id
  }
  return out
}

type Stance = { op: 'add' | 'remove' | 'unsure'; a: EvidenceAnnotation; counted: boolean; conflict: boolean }

/**
 * 一批断言 → 每个 (作品, subject) 的裁决（按作品键、subject 排序）。
 * `opts.blocklist`：这些账号的断言留档但不计（`by.id`）。
 */
export function resolveAnnotations(
  annotations: readonly EvidenceAnnotation[], policy: EvidenceCommunityPolicy = DEFAULT_COMMUNITY_POLICY, opts: { blocklist?: readonly string[] } = {},
): EvidenceCommunityDecision[] {
  const blocked = new Set(opts.blocklist ?? [])
  const groups = new Map<string, EvidenceAnnotation[]>()
  for (const a of annotations) {
    if (!a || typeof a !== 'object' || !text(a.work_id) || !text(a.subject) || !a.by) continue
    if (blocked.has(a.by.id)) continue
    const key = `${a.work_id}\u0000${a.subject}`
    const g = groups.get(key) ?? []
    g.push(a)
    groups.set(key, g)
  }
  const out: EvidenceCommunityDecision[] = []
  for (const [, group] of groups) {
    const d = decideSubject(group, policy)
    if (d) out.push(d)
  }
  return out.sort((x, y) => (x.work_id < y.work_id ? -1 : x.work_id > y.work_id ? 1 : x.subject < y.subject ? -1 : x.subject > y.subject ? 1 : 0))
}

function decideSubject(group: readonly EvidenceAnnotation[], policy: EvidenceCommunityPolicy): EvidenceCommunityDecision | null {
  const proposals = group.filter((a) => a.kind !== 'review' && a.kind !== 'independence' && (a.op === 'add' || a.op === 'remove'))
  if (proposals.length === 0) return null
  const kind: EvidenceAnnotationKind = proposals[0]!.kind
  const minTier = policy.min_tier[kind as 'binding' | 'independence' | 'appraisal']
  const eligible = (a: EvidenceAnnotation) => !minTier || tierRank(a.by.tier) <= tierRank(minTier)
  const quorumRank = tierRank(policy.quorum.tier)
  // 行：提出它的那条（最新 add）决定它的内容；认可必须复录这整行
  const proposer = proposals.filter((a) => a.op === 'add' && eligible(a)).sort((x, y) => (later(x, y) ? -1 : 1))[0] ?? null
  const rowPayload = proposer && proposer.payload.kind === 'row' ? proposer.payload : null

  // 每人最新立场（人与模型分开；模型只记不算）
  const latest = new Map<string, EvidenceAnnotation>()
  for (const a of group) {
    if (a.kind === 'independence') continue
    if (!['add', 'remove', 'endorse', 'dispute', 'unsure'].includes(a.op)) continue
    if (a.kind !== 'review' && !eligible(a)) continue
    const k = actorKey(a)
    const prev = latest.get(k)
    if (!prev || later(a, prev)) latest.set(k, a)
  }
  const reExtractors = new Set<string>()
  let conflicts = 0
  const stances: Stance[] = []
  for (const a of latest.values()) {
    let op: Stance['op'] = a.op === 'add' || a.op === 'endorse' ? 'add' : a.op === 'remove' || a.op === 'dispute' ? 'remove' : 'unsure'
    let counted = true
    let conflict = false
    if (kind === 'row' && a.op === 'endorse') {
      const p = a.payload.kind === 'review' ? a.payload : null
      const editorPlus = tierRank(a.by.tier) < quorumRank
      if (p?.re_extraction) {
        const m = matchReExtraction({ effect: rowPayload?.effect ?? null, direction: rowPayload?.direction ?? null }, p.re_extraction, policy.row.tolerance)
        if (!m.match) { op = 'remove'; conflict = true; conflicts++ }
        else if (!p.peeked && proposer && actorKey(a) !== actorKey(proposer)) reExtractors.add(actorKey(a))
      } else if (!editorPlus && policy.row.require_re_extraction) {
        counted = false // 贡献者层对数字的「认可」必须带复录，否则不算票
      }
    }
    stances.push({ op, a, counted, conflict })
  }
  const human = stances.filter((s) => isPerson(s.a) && s.counted)
  const support: EvidenceCommunityDecision['support'] = {}
  for (const s of stances) {
    if (s.op === 'unsure' || !s.counted) continue
    const t = s.a.by.tier
    const cur = support[t] ?? { add: 0, remove: 0 }
    cur[s.op]++
    support[t] = cur
  }
  const voting = human.filter((s) => s.op !== 'unsure')
  if (voting.length === 0) return null
  const top = voting.map((s) => s.a.by.tier).sort((x, y) => tierRank(x) - tierRank(y))[0]!
  const atTop = human.filter((s) => s.a.by.tier === top)
  const adds = atTop.filter((s) => s.op === 'add')
  const removes = atTop.filter((s) => s.op === 'remove')
  const unsure = atTop.filter((s) => s.op === 'unsure').length

  // 分面单选：票数最多的值胜出；其余值的票算作反对
  let value: string | null = null
  let alternatives: EvidenceCommunityDecision['alternatives']
  let winnerAdds = adds
  if (kind === 'facet') {
    const tally = new Map<string, Stance[]>()
    const endorsements: Stance[] = []
    for (const s of adds) {
      const v = s.a.payload.kind === 'facet' ? s.a.payload.value : null
      if (!v) { endorsements.push(s); continue } // 「认可」不带值：算给当前胜出的值
      tally.set(v, [...(tally.get(v) ?? []), s])
    }
    const ranked = [...tally.entries()].sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1))
    if (ranked.length === 0) return null
    value = ranked[0]![0]
    winnerAdds = [...ranked[0]![1], ...endorsements]
    if (ranked.length > 1) alternatives = ranked.map(([v, ss], i) => ({ value: v, votes: ss.length + (i === 0 ? endorsements.length : 0) }))
  } else if (kind === 'tag') {
    const p = (adds[0] ?? atTop[0])!.a.payload
    value = p.kind === 'tag' ? p.tag : null
  }
  const addCount = winnerAdds.length
  const removeCount = removes.length + (adds.length - winnerAdds.length)

  let state: EvidenceCommunityState
  let quorum: EvidenceCommunityDecision['quorum'] = null
  const issues: EvidenceCommunityDecision['issues'] = []
  if (tierRank(top) === quorumRank) {
    const q = assessQuorum({ add: addCount, remove: removeCount, unsure }, policy.quorum)
    state = q.state
    quorum = q.quorum
  } else if (tierRank(top) < quorumRank) {
    state = addCount > 0 && removeCount > 0 ? 'disputed' : addCount > 0 ? 'confirmed' : 'removed'
  } else {
    return null // 比贡献者还低的层（模型）不裁决
  }
  if (conflicts > 0) {
    issues.push('extraction_conflict')
    // 复录对不上就是实打实的分歧：不管反对人数够不够计票，这一行先 disputed（编辑层已表态的除外）
    if (tierRank(top) === quorumRank) state = 'disputed'
  }

  // 行：核验档与复录要求；研究设计 / 行缺出处封顶 pending
  let verification: EvidenceVerification | null = null
  if (kind === 'row') {
    const editorPlus = human.some((s) => s.op === 'add' && tierRank(s.a.by.tier) < quorumRank)
    verification = editorPlus ? 'editor' : reExtractors.size > 0 ? 'double' : 'single'
    if (policy.row.require_re_extraction && verification === 'single' && (state === 'accepted' || state === 'pending')) {
      state = 'pending'
      issues.push('needs_re_extraction')
    }
  }
  // 生效的那条：行是提出它的；分面是胜出值最新的带值断言（认可不带值）；标签是最新的 add
  const effective = (kind === 'row' ? proposer
    : winnerAdds.filter((s) => (kind === 'facet' ? s.a.payload.kind === 'facet' : true)).sort((x, y) => (later(x.a, y.a) ? -1 : 1))[0]?.a) ?? null
  const locatorMissing = effective
    ? (effective.payload.kind === 'facet' && effective.payload.facet === 'design' && !text(effective.payload.locator))
      || (effective.payload.kind === 'row' && !text(effective.payload.context?.locator))
    : false
  if (locatorMissing && (state === 'accepted' || state === 'confirmed')) { state = 'pending'; issues.push('missing_locator') }

  const independence = group
    .filter((a): a is EvidenceAnnotation & { payload: Extract<EvidenceAnnotationPayload, { kind: 'independence' }> } =>
      a.kind === 'independence' && a.payload.kind === 'independence' && tierRank(a.by.tier) <= tierRank(policy.min_tier.independence ?? 'editor'))
    .sort((x, y) => (later(x, y) ? -1 : 1))[0]
  const reasons = [...new Set(stances
    .filter((s) => s.op === 'remove' && s.a.payload.kind === 'review' && text(s.a.payload.reason))
    .map((s) => (s.a.payload as { reason: string }).reason.trim().slice(0, 200)))].slice(0, 10)
  const first = group[0]!
  return {
    work_id: first.work_id,
    subject: first.subject,
    kind,
    state,
    decided_by: top,
    support,
    quorum,
    verification,
    re_extractions: reExtractors.size,
    effective_id: effective?.id ?? null,
    value,
    issues,
    ...(alternatives ? { alternatives } : {}),
    ...(kind === 'row' ? { independence: independence ? { study_id: independence.payload.study_id, dependence_id: independence.payload.dependence_id, independence_verified: independence.payload.independence_verified } : null } : {}),
    last_changed: group.map((a) => a.at).sort().at(-1) ?? first.at,
    reasons,
  }
}

/**
 * 竞争值检查（导出时做，手上有原始行）：同一作品里语境相同、度量相同的 ≥ 2 条 accepted 行，
 * 数值在容差内 ⇒ 互为一次独立复录（single 升 double）；不在 ⇒ 全部降 disputed 并标 `competing_value`。
 */
export function reconcileRows(
  rows: ReadonlyArray<{ decision: EvidenceCommunityDecision; input: Extract<EvidenceAnnotationPayload, { kind: 'row' }> }>,
  policy: EvidenceCommunityPolicy = DEFAULT_COMMUNITY_POLICY,
): void {
  const slot = (r: (typeof rows)[number]) => {
    const c = r.input.context
    return [r.decision.work_id, ...[c.outcome, c.comparison, c.population, c.timepoint, c.unit, c.analysis].map((x) => normalizeTag(x) ?? x), c.kind, r.input.effect?.metric ?? '-'].join('\u0000')
  }
  const groups = new Map<string, Array<(typeof rows)[number]>>()
  for (const r of rows) {
    if (!COUNTED.includes(r.decision.state) && !(r.decision.state === 'pending' && r.decision.issues.includes('needs_re_extraction'))) continue
    const k = slot(r)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const allMatch = g.every((r) => matchReExtraction({ effect: r.input.effect, direction: r.input.direction }, { effect: g[0]!.input.effect, direction: g[0]!.input.direction }, policy.row.tolerance).match)
    for (const r of g) {
      const d = r.decision
      if (allMatch) {
        if (d.verification === 'single') { d.verification = 'double'; d.re_extractions = Math.max(d.re_extractions, 1) }
        if (d.state === 'pending' && d.issues.includes('needs_re_extraction')) {
          d.issues = d.issues.filter((i) => i !== 'needs_re_extraction')
          if (d.quorum && d.quorum.ci_low !== null && d.quorum.n >= d.quorum.min_independent && d.quorum.ci_low > d.quorum.threshold) d.state = 'accepted'
        }
      } else {
        d.state = 'disputed'
        if (!d.issues.includes('competing_value')) d.issues.push('competing_value')
      }
    }
  }
}

/** 裁决 → 账本立场：accepted / confirmed ⇒ present；rejected / removed ⇒ absent；disputed ⇒ disputed；pending ⇒ null（账本没说）。 */
export function communityStateToWorkTagState(state: EvidenceCommunityState): EvidenceWorkTag['state'] | null {
  switch (state) {
    case 'accepted': case 'confirmed': return 'present'
    case 'rejected': case 'removed': return 'absent'
    case 'disputed': return 'disputed'
    default: return null
  }
}

// ── 导出读取 ─────────────────────────────────────────────────────────────────────

type ReadResult =
  | { ok: true; value: EvidenceCommunityExport; issues: EvidenceCommunityExportIssue[] }
  | { ok: false; issues: EvidenceCommunityExportIssue[] }

export const COMMUNITY_EXPORT_MAX_WORKS = 200_000

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const majorMinor = (v: string) => v.split('.').slice(0, 2).join('.')

function readManifest(raw: unknown, issues: EvidenceCommunityExportIssue[]): EvidenceCommunityExportManifest | null {
  if (!isRecord(raw)) { issues.push({ code: 'not_an_object', path: 'manifest' }); return null }
  if (!text(raw.contract) || !/^\d+\.\d+\.\d+$/.test(raw.contract)) { issues.push({ code: 'bad_manifest', path: 'manifest.contract' }); return null }
  if (majorMinor(raw.contract) !== majorMinor(EVIDENCE_CONTRACT_VERSION)) { issues.push({ code: 'contract_mismatch', path: 'manifest.contract' }); return null }
  if (raw.export_version !== 1) { issues.push({ code: 'bad_manifest', path: 'manifest.export_version' }); return null }
  if (raw.license !== 'CC0-1.0') { issues.push({ code: 'bad_manifest', path: 'manifest.license' }); return null }
  const policy = isRecord(raw.policy) ? raw.policy : null
  const q = policy && isRecord(policy.quorum) ? policy.quorum : null
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const tier = (v: unknown, fallback: EvidenceTrustTier): EvidenceTrustTier => (typeof v === 'string' && (EVIDENCE_TRUST_TIERS as readonly string[]).includes(v) ? (v as EvidenceTrustTier) : fallback)
  const d = DEFAULT_COMMUNITY_POLICY
  const row = policy && isRecord(policy.row) ? policy.row : null
  const tol = row && isRecord(row.tolerance) ? row.tolerance : null
  const minTier = policy && isRecord(policy.min_tier) ? policy.min_tier : null
  const shards = Array.isArray(raw.shards) ? raw.shards.filter(isRecord).map((s) => ({
    path: text(s.path) ? s.path : '', bytes: num(s.bytes, 0), sha256: text(s.sha256) ? s.sha256 : '', works: num(s.works, 0),
  })) : []
  const counts = isRecord(raw.counts) ? raw.counts : {}
  const c = (k: string) => num(counts[k], 0)
  return {
    contract: raw.contract,
    export_version: 1,
    generated_at: text(raw.generated_at) ? raw.generated_at : '',
    source_commit: text(raw.source_commit) ? raw.source_commit : null,
    label: text(raw.label) ? raw.label.trim().slice(0, 100) : 'Community annotations',
    license: 'CC0-1.0',
    repository: text(raw.repository) ? raw.repository : '',
    policy: {
      quorum: {
        tier: tier(q?.tier, d.quorum.tier), threshold: num(q?.threshold, d.quorum.threshold), confidence: num(q?.confidence, d.quorum.confidence),
        min_independent: num(q?.min_independent, d.quorum.min_independent), min_disputers: num(q?.min_disputers, d.quorum.min_disputers),
      },
      row: {
        require_re_extraction: typeof row?.require_re_extraction === 'boolean' ? row.require_re_extraction : d.row.require_re_extraction,
        tolerance: { relative: num(tol?.relative, d.row.tolerance.relative), absolute: num(tol?.absolute, d.row.tolerance.absolute) },
      },
      min_tier: {
        binding: tier(minTier?.binding, 'editor'), independence: tier(minTier?.independence, 'editor'), appraisal: tier(minTier?.appraisal, 'editor'),
      },
      model_min_confidence: num(policy?.model_min_confidence, d.model_min_confidence),
    },
    facet_vocab: isRecord(raw.facet_vocab) ? Object.fromEntries(Object.entries(raw.facet_vocab).filter(([, v]) => isRecord(v) && Array.isArray(v.values)).map(([k, v]) => {
      const o = v as Record<string, unknown>
      return [k, { values: (o.values as unknown[]).filter(text), maps_to: o.maps_to === 'study_type' ? 'study_type' as const : null, locator_required: o.locator_required === true }]
    })) : {},
    concepts_version: text(raw.concepts_version) ? raw.concepts_version : '',
    maintainers: Array.isArray(raw.maintainers) ? raw.maintainers.filter(text).slice(0, 100) : [],
    shards,
    counts: { works: c('works'), assertions: c('assertions'), contributors: c('contributors'), accepted: c('accepted'), pending: c('pending'), disputed: c('disputed'), frames: c('frames') },
  }
}

const TIERS = EVIDENCE_TRUST_TIERS as readonly string[]
const STATES = EVIDENCE_COMMUNITY_STATES as readonly string[]
const TAG_STATES = EVIDENCE_WORK_TAG_STATES as readonly string[]

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
function readQuorum(raw: unknown): EvidenceCommunityDecision['quorum'] {
  if (!isRecord(raw)) return null
  return {
    n: num(raw.n) ?? 0, add: num(raw.add) ?? 0, remove: num(raw.remove) ?? 0, unsure: num(raw.unsure) ?? 0, challengers: num(raw.challengers) ?? 0,
    challenged: raw.challenged === true, share: num(raw.share), ci_low: num(raw.ci_low), ci_high: num(raw.ci_high), z: num(raw.z) ?? 0,
    threshold: num(raw.threshold) ?? 0.5, confidence: num(raw.confidence) ?? 0.8, min_independent: num(raw.min_independent) ?? 2,
  }
}

function readDecision(raw: unknown, work: string, path: string, issues: EvidenceCommunityExportIssue[]): EvidenceCommunityDecision | null {
  if (!isRecord(raw) || !text(raw.subject) || !text(raw.kind)) { issues.push({ code: 'bad_work', path }); return null }
  if (!text(raw.state) || !STATES.includes(raw.state)) { issues.push({ code: 'bad_state', path: `${path}.state` }); return null }
  const n = num
  return {
    work_id: work,
    subject: raw.subject,
    kind: raw.kind as EvidenceAnnotationKind,
    state: raw.state as EvidenceCommunityState,
    decided_by: text(raw.decided_by) && TIERS.includes(raw.decided_by) ? (raw.decided_by as EvidenceTrustTier) : 'contributor',
    support: isRecord(raw.support) ? (raw.support as EvidenceCommunityDecision['support']) : {},
    quorum: readQuorum(raw.quorum),
    verification: text(raw.verification) && raw.verification in VERIFICATION_RANK ? (raw.verification as EvidenceVerification) : null,
    re_extractions: n(raw.re_extractions) ?? 0,
    effective_id: text(raw.effective_id) ? raw.effective_id : null,
    value: text(raw.value) ? raw.value : null,
    issues: Array.isArray(raw.issues) ? (raw.issues.filter(text) as EvidenceCommunityDecision['issues']) : [],
    ...(Array.isArray(raw.alternatives) ? { alternatives: raw.alternatives.filter(isRecord).map((a) => ({ value: String(a.value), votes: n(a.votes) ?? 0 })) } : {}),
    ...(isRecord(raw.independence) ? { independence: { study_id: String(raw.independence.study_id ?? ''), dependence_id: String(raw.independence.dependence_id ?? ''), independence_verified: raw.independence.independence_verified === true } } : {}),
    last_changed: text(raw.last_changed) ? raw.last_changed : '',
    reasons: Array.isArray(raw.reasons) ? raw.reasons.filter(text).slice(0, 10) : [],
  }
}

function readWork(raw: unknown, path: string, issues: EvidenceCommunityExportIssue[]): EvidenceCommunityWork | null {
  if (!isRecord(raw) || !text(raw.work_id)) { issues.push({ code: 'bad_work', path }); return null }
  const ref = workRefOfKey(raw.work_id)
  if (!ref) { issues.push({ code: 'bad_work', path: `${path}.work_id` }); return null }
  const work = raw.work_id
  let card: EvidenceWorkCard | null = null
  if (isRecord(raw.card)) {
    const c = raw.card
    const title = c.title
    if (!text(title)) { issues.push({ code: 'bad_work', path: `${path}.card.title` }); return null }
    if (c.abstract !== null && c.abstract !== undefined) issues.push({ code: 'abstract_not_allowed', path: `${path}.card.abstract` })
    const strs = (v: unknown, max: number) => (Array.isArray(v) ? v.filter(text).slice(0, max) : [])
    card = {
      id: text(c.id) ? c.id : null, doi: text(c.doi) ? c.doi : null, pmid: text(c.pmid) ? c.pmid : null, title: title.trim(),
      year: typeof c.year === 'number' ? c.year : null, authors: strs(c.authors, 20),
      venue: isRecord(c.venue) && text(c.venue.id) && text(c.venue.name) ? {
        id: c.venue.id, name: c.venue.name, type: text(c.venue.type) ? c.venue.type : null, is_oa: typeof c.venue.is_oa === 'boolean' ? c.venue.is_oa : null,
        issn_l: text(c.venue.issn_l) ? c.venue.issn_l : null, publisher: text(c.venue.publisher) ? c.venue.publisher : null,
      } : null,
      publication_type: text(c.publication_type) ? c.publication_type : null,
      topics: Array.isArray(c.topics) ? c.topics.filter((t): t is { id: string; display_name: string } => isRecord(t) && text(t.id) && text(t.display_name)).slice(0, 10).map((t) => ({ id: t.id, display_name: t.display_name })) : [],
      keywords: strs(c.keywords, 20), mesh: strs(c.mesh, 50), abstract: null, language: text(c.language) ? c.language : null,
      cited_by_count: typeof c.cited_by_count === 'number' ? c.cited_by_count : null, is_open_access: typeof c.is_open_access === 'boolean' ? c.is_open_access : null,
      oa_url: text(c.oa_url) && /^https?:\/\//i.test(c.oa_url) ? c.oa_url : null, is_retracted: c.is_retracted === true,
    }
  }
  const tags: EvidenceWorkTag[] = []
  for (const [i, t] of (Array.isArray(raw.tags) ? raw.tags : []).entries()) {
    if (!isRecord(t) || !text(t.tag_key) || !text(t.state) || !TAG_STATES.includes(t.state) || !text(t.decided_by) || !TIERS.includes(t.decided_by)) {
      issues.push({ code: 'bad_state', path: `${path}.tags[${i}]` }); continue
    }
    tags.push({
      tag_key: t.tag_key, label: text(t.label) ? t.label : t.tag_key, state: t.state as EvidenceWorkTag['state'], decided_by: t.decided_by as EvidenceTrustTier,
      support: isRecord(t.support) ? (t.support as EvidenceWorkTag['support']) : {}, last_changed: text(t.last_changed) ? t.last_changed : '',
      request_id: text(t.request_id) ? t.request_id : null, ...(isRecord(t.quorum) ? { quorum: readQuorum(t.quorum) } : {}),
    })
  }
  const pending: EvidenceCommunityWork['pending'] = []
  for (const [i, p] of (Array.isArray(raw.pending) ? raw.pending : []).entries()) {
    if (!isRecord(p) || !text(p.subject)) { issues.push({ code: 'bad_work', path: `${path}.pending[${i}]` }); continue }
    const d = readDecision(p.decision, work, `${path}.pending[${i}].decision`, issues)
    if (d) pending.push({ subject: p.subject, decision: d })
  }
  const facets: EvidenceCommunityWork['facets'] = {}
  for (const [k, f] of Object.entries(isRecord(raw.facets) ? raw.facets : {})) {
    if (!isRecord(f) || !text(f.value)) { issues.push({ code: 'bad_work', path: `${path}.facets.${k}` }); continue }
    const d = readDecision(f.decision, work, `${path}.facets.${k}.decision`, issues)
    if (d) facets[k] = { value: f.value, decision: d, locators: Array.isArray(f.locators) ? f.locators.filter(text) : [] }
  }
  const rows: EvidenceCommunityWork['rows'] = []
  for (const [i, r] of (Array.isArray(raw.rows) ? raw.rows : []).entries()) {
    const input = isRecord(r) && isRecord(r.input) && r.input.kind === 'row' && isRecord(r.input.context) ? (r.input as Extract<EvidenceAnnotationPayload, { kind: 'row' }>) : null
    if (!isRecord(r) || !text(r.row_id) || !input) { issues.push({ code: 'bad_work', path: `${path}.rows[${i}]` }); continue }
    const d = readDecision(r.decision, work, `${path}.rows[${i}].decision`, issues)
    if (!d) continue
    const ids = isRecord(r.concept_ids) ? Object.fromEntries(Object.entries(r.concept_ids).filter(([f, v]) => (EVIDENCE_FACET_IDS as readonly string[]).includes(f) && text(v))) as Partial<Record<EvidenceFacetId, string>> : undefined
    rows.push({ row_id: r.row_id, input, ...(ids && Object.keys(ids).length > 0 ? { concept_ids: ids } : {}), decision: d })
  }
  return {
    work_id: work,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.filter(text).slice(0, 10) : [],
    card, tags, pending, facets, rows,
    unsure: typeof raw.unsure === 'number' ? raw.unsure : 0,
    updated_at: text(raw.updated_at) ? raw.updated_at : '',
  }
}

/**
 * 读一份社区导出：`manifest` 与若干分片（每片是作品数组，或 `{ works: [...] }`），可选的绑定 / 概念 / frame 文件。
 * 契约主次版本对不上、清单形状不对 ⇒ `ok: false`；作品条目坏的逐条报并跳过（`issues`），摘要不为空的置空并报 `abstract_not_allowed`。
 * 不校验 sha256（引擎不引 crypto）：宿主拉文件时自己按 manifest 核对。
 */
export function readCommunityExport(manifest: unknown, shards: readonly unknown[], extras: { bindings?: unknown; concepts?: unknown; frames?: unknown } = {}): ReadResult {
  const issues: EvidenceCommunityExportIssue[] = []
  const m = readManifest(manifest, issues)
  if (!m) return { ok: false, issues }
  const works: EvidenceCommunityWork[] = []
  const seen = new Set<string>()
  let total = 0
  outer: for (const [si, shard] of shards.entries()) {
    const list = Array.isArray(shard) ? shard : isRecord(shard) && Array.isArray(shard.works) ? shard.works : null
    if (!list) { issues.push({ code: 'not_an_object', path: `shards[${si}]` }); continue }
    for (const [wi, raw] of list.entries()) {
      if (++total > COMMUNITY_EXPORT_MAX_WORKS) { issues.push({ code: 'too_many_works', path: `shards[${si}]` }); break outer }
      const w = readWork(raw, `shards[${si}][${wi}]`, issues)
      if (!w) continue
      const key = normalizeWorkId(w.work_id) ?? w.work_id
      if (seen.has(key)) { issues.push({ code: 'duplicate_work', path: `shards[${si}][${wi}]` }); continue }
      seen.add(key)
      works.push(w)
    }
  }
  const bindings: EvidenceTagBinding[] = []
  for (const [i, b] of (Array.isArray(extras.bindings) ? extras.bindings : []).entries()) {
    if (!isRecord(b) || !text(b.tag_key) || !text(b.kind) || !(EVIDENCE_TAG_BINDING_KINDS as readonly string[]).includes(b.kind) || b.kind === 'machine') {
      issues.push({ code: 'bad_binding', path: `bindings[${i}]` }); continue
    }
    bindings.push({
      tag_key: b.tag_key, topic_id: text(b.topic_id) ? b.topic_id : null, topic_name: text(b.topic_name) ? b.topic_name : null,
      kind: b.kind as EvidenceTagBinding['kind'], confidence: null, bound_at: text(b.bound_at) ? b.bound_at : '', bound_by: text(b.bound_by) ? b.bound_by : null,
      note: text(b.note) ? b.note : null,
    })
  }
  const concepts: EvidenceConcept[] = []
  for (const [i, c] of (Array.isArray(extras.concepts) ? extras.concepts : []).entries()) {
    if (!isRecord(c) || !text(c.id) || !text(c.facet) || !(EVIDENCE_FACET_IDS as readonly string[]).includes(c.facet) || !isRecord(c.label)) {
      issues.push({ code: 'bad_concept', path: `concepts[${i}]` }); continue
    }
    concepts.push({
      id: c.id, facet: c.facet as EvidenceFacetId, label: Object.fromEntries(Object.entries(c.label).filter(([, v]) => text(v))) as Record<string, string>,
      aliases: Array.isArray(c.aliases) ? c.aliases.filter(text) : [], broader: Array.isArray(c.broader) ? c.broader.filter(text) : [],
      ...(isRecord(c.mappings) ? { mappings: Object.fromEntries(Object.entries(c.mappings).filter(([, v]) => text(v))) as Record<string, string> } : {}),
      default_kind: text(c.default_kind) ? (c.default_kind as NonNullable<EvidenceConcept['default_kind']>) : null,
      default_higher_is_better: typeof c.default_higher_is_better === 'boolean' ? c.default_higher_is_better : null,
      status: c.status === 'deprecated' || c.status === 'orphan' ? c.status : 'active', replaced_by: text(c.replaced_by) ? c.replaced_by : null,
    })
  }
  const frames = Array.isArray(extras.frames) ? (extras.frames.filter((f) => isRecord(f) && text(f.key) && Array.isArray(f.record_ids)) as EvidenceCommunityExport['frames']) : []
  return { ok: true, value: { manifest: m, works, bindings, concepts, frames }, issues }
}

// ── 宿主端口 ──────────────────────────────────────────────────────────────────────

export interface CommunityPortsOptions {
  /** 缺省 `present_only`：只把「有」交给账本合并（merge 模式下任何非「有」的结论都会去掉作者原标签） */
  tagStates?: 'present_only' | 'with_negative'
  /** 社区抄录的数字至少要到哪一档核验才进记录，缺省 `double` */
  minVerification?: EvidenceVerification
  /** 记录脚注的取数时间；缺省导出的 generated_at */
  retrieved_at?: string
}

export interface CommunityPorts {
  /** 站内文章端口的同形实现：一篇作品一行（`OnsiteArticle` 形状），标签是「有」的标签，研究设计取 accepted / confirmed 的 design */
  articles: OnsiteArticleSource & { label: string; license: string }
  /** 账本结论端口：按 tagStates 过滤；作品键与别名都能查 */
  workTags: WorkTagSource
  /** 编辑层的绑定（只读；`put` 不做事） */
  bindings: TagBindingStore
  /** 一篇作品里能进统计的结果行（给 `intakeOutcomeRows` 的 outcomes 形状） */
  outcomes(workId: string, opts?: { minVerification?: EvidenceVerification }): Array<{ id: string; effect: EvidenceRowEffectInput | null; direction: EvidenceDirection | null; context: Omit<SynthesisContext, 'record_id' | 'report_id'> }>
  /** 全部作品 → 记录与语境（社区来源；走 `intakeOutcomeRows` 的同一套验形） */
  records(opts?: { minVerification?: EvidenceVerification }): { records: import('./types').EvidenceRecord[]; contexts: SynthesisContext[]; issues: Array<{ work_id: string; row: number | null; codes: string[] }> }
  /** 按作品键（或别名）取作品 */
  work(workId: string): EvidenceCommunityWork | null
}

const meets = (v: EvidenceVerification | null, min: EvidenceVerification) => v !== null && VERIFICATION_RANK[v] >= VERIFICATION_RANK[min]

/** 把导出装成宿主端口。纯内存、零 IO；宿主自己负责拉文件、校哈希、缓存与定时刷新。 */
export function createCommunityPorts(exp: EvidenceCommunityExport, opts: CommunityPortsOptions = {}): CommunityPorts {
  const tagStates = opts.tagStates ?? 'present_only'
  const minVerification = opts.minVerification ?? 'double'
  const byKey = new Map<string, EvidenceCommunityWork>()
  for (const w of exp.works) {
    for (const k of [w.work_id, ...w.aliases]) {
      const n = normalizeWorkId(k)
      if (n && !byKey.has(n)) byKey.set(n, w)
    }
  }
  const lookup = (id: string) => byKey.get(normalizeWorkId(id) ?? id) ?? null
  const presentTags = (w: EvidenceCommunityWork) => w.tags.filter((t) => t.state === 'present')
  const design = (w: EvidenceCommunityWork) => {
    const f = w.facets.design
    return f && COUNTED.includes(f.decision.state) ? f.value : null
  }
  const rowsOf = (w: EvidenceCommunityWork, min: EvidenceVerification) =>
    w.rows.filter((r) => COUNTED.includes(r.decision.state) && meets(r.decision.verification, min)).sort((a, b) => (a.row_id < b.row_id ? -1 : 1))
  const outcomes: CommunityPorts['outcomes'] = (workId, o = {}) => {
    const w = lookup(workId)
    if (!w) return []
    const min = o.minVerification ?? minVerification
    return rowsOf(w, min).map((r) => {
      const c = r.input.context
      const ind = r.decision.independence ?? null
      return {
        id: r.row_id,
        effect: r.input.effect,
        direction: r.input.direction,
        context: {
          study_id: ind?.study_id ?? c.study_id ?? w.work_id,
          dependence_id: ind?.dependence_id ?? w.work_id,
          outcome: c.outcome, population: c.population, comparison: c.comparison, timepoint: c.timepoint, unit: c.unit, analysis: c.analysis, kind: c.kind,
          locator: c.locator,
          // 只有编辑层核验的行算「审核过」；独立性只由编辑层的 independence 断言置 true
          reviewed: r.decision.verification === 'editor',
          independence_verified: ind?.independence_verified === true,
          ...(r.concept_ids ? { concept_ids: r.concept_ids } : {}),
          ...(c.timepoint_raw ? { timepoint_raw: c.timepoint_raw } : {}),
        },
      }
    })
  }
  const article = (w: EvidenceCommunityWork, min: EvidenceVerification) => {
    const c = w.card
    const primary = rowsOf(w, min)[0] ?? null
    return {
      id: w.work_id,
      title: c?.title ?? w.work_id,
      tags: presentTags(w).map((t) => t.label),
      year: c?.year ?? null,
      authors: c?.authors ?? [],
      doi: c?.doi ?? (w.work_id.startsWith('doi:') ? w.work_id.slice(4) : null),
      url: c?.oa_url ?? (c?.doi ? `https://doi.org/${c.doi}` : c?.id ? `https://openalex.org/${c.id.replace(/^openalex:/, '')}` : null),
      publication_type: c?.publication_type ?? null,
      study_design: design(w),
      effect: primary?.input.effect ?? null,
      direction: primary?.input.direction ?? null,
      is_retracted: c?.is_retracted ?? false,
      is_public: true,
    }
  }
  const label = exp.manifest.label
  const license = exp.manifest.license
  return {
    articles: {
      label, license,
      async listArticles({ tagKeys }) {
        const want = tagKeys ? new Set(tagKeys) : null
        return exp.works
          .filter((w) => !w.card?.is_retracted)
          .filter((w) => !want || presentTags(w).some((t) => want.has(t.tag_key)))
          .map((w) => article(w, minVerification))
      },
    },
    workTags: {
      async forWorks(ids) {
        const out = new Map<string, readonly EvidenceWorkTag[]>()
        for (const id of ids) {
          const w = lookup(id)
          if (!w) continue
          out.set(id, tagStates === 'with_negative' ? w.tags : presentTags(w))
        }
        return out
      },
    },
    bindings: {
      async get(tagKey) { return exp.bindings.find((b) => b.tag_key === tagKey) ?? null },
      async listByTopic(topicId) { return exp.bindings.filter((b) => b.topic_id === topicId) },
      async put() { /* 只读：社区绑定由平台的编辑层经断言改 */ },
      async getMany(tagKeys) {
        const out = new Map<string, EvidenceTagBinding>()
        for (const k of tagKeys) { const b = exp.bindings.find((x) => x.tag_key === k); if (b) out.set(k, b) }
        return out
      },
    },
    outcomes,
    records(o = {}) {
      const min = o.minVerification ?? minVerification
      const records: import('./types').EvidenceRecord[] = []
      const contexts: SynthesisContext[] = []
      const issues: Array<{ work_id: string; row: number | null; codes: string[] }> = []
      const retrieved_at = opts.retrieved_at ?? (exp.manifest.generated_at || new Date().toISOString())
      for (const w of exp.works) {
        const rows = outcomes(w.work_id, { minVerification: min })
        const r = intakeOutcomeRows(article(w, min), rows, { source: 'community', source_label: label, license, retrieved_at })
        for (const rec of r.records) {
          const row = rows.find((x) => rec.id.endsWith(`/${x.id}`))
          const decision = row ? w.rows.find((x) => x.row_id === row.id)?.decision : undefined
          if (decision) {
            rec.data_provenance = { source_label: label, license, retrieved_at, locator: row?.context.locator ?? null, verification: decision.verification ?? 'single', decided_by: decision.decided_by }
          }
          records.push(rec)
        }
        contexts.push(...r.contexts)
        for (const i of r.issues) issues.push({ work_id: w.work_id, row: i.row, codes: i.codes })
      }
      return { records, contexts, issues }
    },
    work: lookup,
  }
}

/** 几个账本端口合一：按归一后的作品键对，**先到先得**（宿主自己的账本放前面就优先）。任一来源抛错整体抛错（取不到不凑数）。 */
export function mergeWorkTagSources(sources: readonly WorkTagSource[]): WorkTagSource {
  return {
    async forWorks(ids) {
      const out = new Map<string, readonly EvidenceWorkTag[]>()
      const taken = new Set<string>()
      for (const s of sources) {
        const got = await s.forWorks(ids)
        for (const [id, tags] of got) {
          const k = normalizeWorkId(id) ?? id
          if (taken.has(k)) continue
          taken.add(k)
          out.set(id, tags)
        }
      }
      return out
    },
  }
}
