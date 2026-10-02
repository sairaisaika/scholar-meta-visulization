/**
 * 标签层——**标签怎么变成可以画的东西**（纯函数、零 IO）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 站内标签是作者随手打的自由文本（folksonomy）：同一个概念有大小写、全半角、连字符、`#` 前缀等写法；
 * 同一个写法又可能指不同的东西（多义）；标签频率是长尾，大部分只用过一两次
 * （Golder & Huberman 2006, *J Inf Sci* 32(2):198–208；Cattuto, Loreto & Pietronero 2007, *PNAS* 104(5):1461–1464）。
 * 把这种东西直接画成图，图的可信度就是标签的可信度。所以这里只做三件**可解释、可撤销**的事：
 *
 * ① **正字法归一**（`normalizeTag`）：NFKC（全角→半角、兼容字符）、去不可见字符、去 `#` 前缀、小写、
 *    空白 / 下划线 / 各种连字符折成一个空格。**不翻译、不按语言分支、不做繁简转换、不做同义词合并**——
 *    那些是语义判断，只能由人做（见 ③）。归一只决定「算不算同一个标签」，**去问外部源时仍发原文**。
 * ② **别名组**（`groupTags`）：归一后相同的原文写法归成一组，显示名取出现最多的原文写法，组里每种写法各几次都留着。
 * ③ **绑定**（`resolveTagBinding`）：标签键 → 外部主题，是一条**带出处**的记录：
 *      · `curated` 编辑人工确认（最高优先级；同义词、跨语言都靠这一条完成，因为它可追溯、可撤销）；
 *      · `rejected` 编辑确认「没有对应主题」，否决机器命中；
 *      · `machine` 自动补全命中，分 `exact`（主题名归一后与标签键相同）与 `first_hit`（只是第一条候选）。
 *    自动补全是**候选生成，不是消歧**（实体链接的两步，Shen, Wang & Han 2015, *IEEE TKDE* 27(2):443–460），
 *    所以机器绑定永远带着 `machine_binding` 图注，且**不参与跨标签聚合**（主题级只汇总人工绑定的标签）。
 */
import type { EvidenceExternalMatch, EvidenceTagBinding, EvidenceTagBindingConfidence } from './types'

/** 归一后的最大长度（与外部源查询的上限一致）。 */
export const TAG_MAX_LENGTH = 100
/** 原文超过这个长度直接拒绝（防止超长输入拖慢归一化）。 */
const RAW_MAX_LENGTH = 1000

// C0/C1 控制字符、软连字符、零宽字符、方向控制符、BOM
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿]/g
// 空白、下划线、ASCII 连字符、Unicode 连字符 / 破折号 / 减号
const SEPARATORS = /[\s_\-‐-―−﹘﹣]+/g

/**
 * NFKC；运行环境没有 `String.prototype.normalize`（比如关掉 Intl 的 Hermes）时原样返回——
 * 只是少折叠全角 / 兼容字符，不会崩（移动端也能直接用这个入口）。
 */
function nfkc(s: string): string {
  try { return typeof s.normalize === 'function' ? s.normalize('NFKC') : s } catch { return s }
}

/**
 * 标签键：正字法归一后的形式；不是字符串、空、或太长 ⇒ null。
 * `'ＡＤＨＤ'`、`'#ADHD'`、`' adhd '` → `'adhd'`；`'Self-Esteem'`、`'self_esteem'` → `'self esteem'`；
 * `'焦虑'` 与 `'焦慮'` **不**合并（繁简转换是语言判断，交给编辑绑定）。
 */
export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > RAW_MAX_LENGTH) return null
  const key = nfkc(raw)
    .replace(INVISIBLE, '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .trim()
  return key.length > 0 && key.length <= TAG_MAX_LENGTH ? key : null
}

/** 一条记录上的不同标签键（保持首次出现的顺序）。 */
export function recordTagKeys(record: { tags?: readonly string[] | null }): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of record.tags ?? []) {
    const k = normalizeTag(raw)
    if (k && !seen.has(k)) { seen.add(k); out.push(k) }
  }
  return out
}

export function hasTagKey(record: { tags?: readonly string[] | null }, key: string): boolean {
  return recordTagKeys(record).includes(key)
}

/** 一个别名组：同一个标签键下的全部原文写法。 */
export interface TagGroup {
  key: string
  /** 出现最多的原文写法（并列时取码点序最小的，保证确定性） */
  label: string
  /** 带这个标签的记录数（每条记录只算一次） */
  count: number
  /** 每种原文写法出现在几条记录上，多的在前 */
  variants: Array<{ raw: string; count: number }>
}

const byCountThenText = <T extends { count: number }>(text: (x: T) => string) => (a: T, b: T) =>
  b.count - a.count || (text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0)

/** 把记录上的标签归成别名组，按记录数从多到少。 */
export function groupTags(records: ReadonlyArray<{ tags?: readonly string[] | null }>): TagGroup[] {
  const groups = new Map<string, { count: number; variants: Map<string, number> }>()
  for (const r of records) {
    const seenKeys = new Set<string>()
    const seenRaw = new Set<string>()
    for (const rawTag of r.tags ?? []) {
      const key = normalizeTag(rawTag)
      if (!key) continue
      const raw = rawTag.trim()
      let g = groups.get(key)
      if (!g) { g = { count: 0, variants: new Map() }; groups.set(key, g) }
      if (!seenKeys.has(key)) { seenKeys.add(key); g.count++ }
      if (!seenRaw.has(raw)) { seenRaw.add(raw); g.variants.set(raw, (g.variants.get(raw) ?? 0) + 1) }
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const variants = [...g.variants.entries()].map(([raw, count]) => ({ raw, count })).sort(byCountThenText((v) => v.raw))
      return { key, label: variants[0]?.raw ?? key, count: g.count, variants }
    })
    .sort(byCountThenText((g) => g.key))
}

/** 名字对得上多少：`exact` 归一后相同 · `contains` 一方包含另一方（至少 2 个字符）· `none`。 */
export function tagNameMatch(tagKey: string, displayName: string): 'exact' | 'contains' | 'none' {
  const name = normalizeTag(displayName)
  if (!name) return 'none'
  if (name === tagKey) return 'exact'
  const shorter = name.length < tagKey.length ? name : tagKey
  return shorter.length >= 2 && (name.includes(tagKey) || tagKey.includes(name)) ? 'contains' : 'none'
}

/** 机器绑定的可信度：只有名字归一后完全相同才算 `exact`，其余都只是「第一条候选」。 */
export function machineConfidence(tagKey: string, topicDisplayName: string): EvidenceTagBindingConfidence {
  return tagNameMatch(tagKey, topicDisplayName) === 'exact' ? 'exact' : 'first_hit'
}

/** 机器绑定一次看几条自动补全候选（OpenAlex 自动补全一次最多回 10 条，0 credit）。 */
export const MACHINE_CANDIDATE_LIMIT = 10

/**
 * 从自动补全候选里挑机器绑定的那一条：候选里有**同名**的（归一后相同）就挑它（`exact`），没有才退回第一条（`first_hit`）。
 * 自动补全按它自己的相关度排，同名主题不一定排第一；只看第一条会把「其实有同名主题」的标签也绑成 `first_hit`，
 * 而短词、缩写的第一条常常只是字面上沾边（`app` → 「Plasma Diagnostics and Applications」）——`first_hit` 必须如实标出来。
 * 没有候选 ⇒ null。
 */
export function pickMachineCandidate<C extends { display_name: string }>(
  tagKey: string | null, candidates: readonly C[],
): { candidate: C; confidence: EvidenceTagBindingConfidence } | null {
  if (candidates.length === 0) return null
  const exact = tagKey === null ? undefined : candidates.find((c) => tagNameMatch(tagKey, c.display_name) === 'exact')
  return exact ? { candidate: exact, confidence: 'exact' } : { candidate: candidates[0], confidence: 'first_hit' }
}

// ── 主题 id ───────────────────────────────────────────────────────────────────

const TOPIC_ID = /^([a-z][a-z_]{0,31}):([A-Za-z0-9._-]{1,64})$/

/** `openalex:T10537` → `{ source: 'openalex', external_id: 'T10537' }`；形状不对 ⇒ null（不拼进任何查询）。 */
export function splitTopicId(id: unknown): { source: string; external_id: string } | null {
  if (typeof id !== 'string') return null
  const m = TOPIC_ID.exec(id)
  return m ? { source: m[1], external_id: m[2] } : null
}

// ── 绑定 ────────────────────────────────────────────────────────────────────

/**
 * 机器绑定策略：`first_hit` 自动补全第一条就绑（默认；图注标「机器匹配」）·
 * `exact_only` 只有同名才自动绑，其余进 `needs_review` 等编辑 · `off` 不做机器绑定，只认编辑绑定。
 */
export type MachineBindingPolicy = 'first_hit' | 'exact_only' | 'off'
export const MACHINE_BINDING_POLICIES = ['first_hit', 'exact_only', 'off'] as const satisfies readonly MachineBindingPolicy[]

/** 外部源对一个标签的回答（与具体源无关）。`error` = 这次没问成，**不是**「查无」。 */
export type MachineResolution =
  | { kind: 'matched'; topic_id: string; display_name: string }
  | { kind: 'no_match' }
  | { kind: 'error' }

export interface BindingResolution {
  binding: EvidenceTagBinding | null
  external_match: EvidenceExternalMatch
}

/**
 * 把「编辑绑定」与「外部源的回答」合成一个结论。优先级：编辑绑定（含否决）> 机器命中 > 没问。
 * `machine` 缺省 = 没去问（`not_queried`）；`error` ⇒ `unavailable`（调用方不许缓存）。
 */
export function resolveTagBinding(input: {
  tagKey: string
  curated?: EvidenceTagBinding | null | undefined
  machine?: MachineResolution | null | undefined
  policy?: MachineBindingPolicy | undefined
  /** 机器绑定的时间戳（ISO）；缺省取当前时间 */
  at?: string | undefined
}): BindingResolution {
  const policy = input.policy ?? 'first_hit'
  const c = input.curated
  if (c && c.tag_key === input.tagKey) {
    if (c.kind === 'rejected') return { binding: c, external_match: 'no_match' }
    if (c.kind === 'curated' && splitTopicId(c.topic_id)) return { binding: c, external_match: 'matched' }
    // 宿主把机器绑定也存进了绑定表：按机器绑定对待，照样过策略
    if (c.kind === 'machine' && splitTopicId(c.topic_id) && policy !== 'off') {
      if (policy === 'exact_only' && c.confidence !== 'exact') return { binding: null, external_match: 'needs_review' }
      return { binding: c, external_match: 'matched' }
    }
  }
  const m = input.machine
  if (policy === 'off' || !m) return { binding: null, external_match: 'not_queried' }
  if (m.kind === 'error') return { binding: null, external_match: 'unavailable' }
  if (m.kind === 'no_match' || !splitTopicId(m.topic_id)) return { binding: null, external_match: 'no_match' }
  const confidence = machineConfidence(input.tagKey, m.display_name)
  if (policy === 'exact_only' && confidence !== 'exact') return { binding: null, external_match: 'needs_review' }
  return {
    binding: {
      tag_key: input.tagKey, topic_id: m.topic_id, topic_name: m.display_name, kind: 'machine', confidence,
      bound_at: input.at ?? new Date().toISOString(), bound_by: null, note: null,
    },
    external_match: 'matched',
  }
}

/** 编辑确认一条绑定（topic 为 null ⇒ 否决：确认这个标签没有对应主题）。标签不合法或主题 id 形状不对 ⇒ null。 */
export function createCuratedBinding(input: {
  tag: string
  topic: { id: string; display_name: string } | null
  by: string | null
  note?: string | null
  at?: string
}): EvidenceTagBinding | null {
  const key = normalizeTag(input.tag)
  if (!key) return null
  if (input.topic && !splitTopicId(input.topic.id)) return null
  return {
    tag_key: key,
    topic_id: input.topic?.id ?? null,
    topic_name: input.topic?.display_name ?? null,
    kind: input.topic ? 'curated' : 'rejected',
    confidence: null,
    bound_at: input.at ?? new Date().toISOString(),
    bound_by: input.by,
    note: input.note ?? null,
  }
}
