/**
 * 打标签的模型——**端口 + 验形 + 一个参考实现**（纯函数、零 IO；主入口导出）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 文献按标签分类、计数、可视化，标签从哪来是可以换的：接入方可以接自己的模型（大模型、分类器、规则），
 * 只要实现 `EvidenceTagger`。引擎不绑任何模型厂商：
 *   · `id` + `version` 进出处——模型换了版本，旧结论与新结论分得开；
 *   · `vocabulary` 非空时是受控词表：词表外的标签一律丢掉（模型「发明」出来的标签进不了统计）；
 *   · 模型的输出一律过 `runTagger`：标签归一、置信度夹到 [0, 1]、同一标签取最高、词表外丢掉、封顶；模型失败回 null（≠「没有标签」）。
 * 参考实现 `createVocabularyTagger`：按词表（含别名）在关键词 / 标题 / 摘要里找整词，透明、可复现，当基线或冷启动用。
 * 模型给出的只是**建议**：写进标签账本（ledger.ts）时按信任层级裁决，人工结论永远压过模型。
 * 交换包：愿意共享的人用 `buildTagContribution` 把结果打包，托管账本的一方用 `validateTagContribution` 验（不可信输入、从不抛错、用收包方自己的词表）。
 */
import type { EvidenceContributionIssue, EvidenceTagContribution } from './types'
import { EVIDENCE_CONTRACT_VERSION } from './types'
import { normalizeDoi } from './doi'
import { normalizeTag } from './tags'

export interface EvidenceTaggerInput {
  /** 作品 id：`<source>:<external_id>`（openalex:W123、onsite:42），或 `doi:<doi>` */
  work_id: string
  title: string
  abstract?: string | null
  keywords?: readonly string[] | null
  /** 外部源给的主题名（辅助信号） */
  topics?: readonly string[] | null
  language?: string | null
}

export interface EvidenceTagSuggestion {
  /** 标签原文（会按 normalizeTag 归一） */
  tag: string
  /** 0–1；模型不给就 null */
  confidence: number | null
  /** 简短理由（给编辑看；别塞大段原文） */
  rationale?: string | null
}

export interface EvidenceTagger {
  /** 稳定 id，比如 `vocabulary` / `my-llm` */
  readonly id: string
  /** 模型或规则的版本（进出处） */
  readonly version: string
  /** 受控词表（只允许这些标签）；开放词表为 null */
  readonly vocabulary: readonly string[] | null
  /** 失败回 null（网络、限流、输出形状不对），不是「这篇没有标签」 */
  tag(input: EvidenceTaggerInput): Promise<EvidenceTagSuggestion[] | null>
}

/** 验过形的一条建议。 */
export interface TagSuggestionView {
  tag_key: string
  label: string
  confidence: number | null
  rationale: string | null
}

export interface RunTaggerResult {
  tagger: { id: string; version: string }
  suggestions: TagSuggestionView[]
  /** 被丢掉的：标签不合法 / 词表外 / 低于门槛 / 超过上限 */
  dropped: { invalid: number; out_of_vocabulary: number; below_threshold: number; over_limit: number }
}

type Dropped = RunTaggerResult['dropped']

const vocabularySet = (v: readonly string[] | null | undefined) =>
  v ? new Set(v.map(normalizeTag).filter((k): k is string => k !== null)) : null

/** 模型输出与交换包共用的验形：归一、夹置信度、同标签取最高、词表外丢掉、门槛、上限。 */
function sanitizeSuggestions(
  raw: readonly unknown[], vocab: Set<string> | null, minConfidence: number, maxTags: number,
): { suggestions: TagSuggestionView[]; dropped: Dropped } {
  const min = Math.min(1, Math.max(0, minConfidence))
  const dropped: Dropped = { invalid: 0, out_of_vocabulary: 0, below_threshold: 0, over_limit: 0 }
  const best = new Map<string, TagSuggestionView>()
  for (const item of raw) {
    const s = item && typeof item === 'object' ? (item as EvidenceTagSuggestion) : null
    const key = s ? normalizeTag(s.tag) : null
    if (!s || !key) { dropped.invalid++; continue }
    if (vocab && !vocab.has(key)) { dropped.out_of_vocabulary++; continue }
    const c = typeof s.confidence === 'number' && Number.isFinite(s.confidence) ? Math.min(1, Math.max(0, s.confidence)) : null
    if (c !== null && c < min) { dropped.below_threshold++; continue }
    const rationale = typeof s.rationale === 'string' && s.rationale.trim() ? s.rationale.trim().slice(0, 300) : null
    const prev = best.get(key)
    if (!prev || (c ?? -1) > (prev.confidence ?? -1)) best.set(key, { tag_key: key, label: s.tag.trim(), confidence: c, rationale })
  }
  const sorted = [...best.values()].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || (a.tag_key < b.tag_key ? -1 : 1))
  const max = Math.max(1, maxTags)
  dropped.over_limit = Math.max(0, sorted.length - max)
  return { suggestions: sorted.slice(0, max), dropped }
}

/** 跑一个模型并验形。模型抛错或回 null ⇒ null。 */
export async function runTagger(
  tagger: EvidenceTagger, input: EvidenceTaggerInput, opts: { minConfidence?: number; maxTags?: number } = {},
): Promise<RunTaggerResult | null> {
  let raw: EvidenceTagSuggestion[] | null
  try { raw = await tagger.tag(input) } catch { return null }
  if (!Array.isArray(raw)) return null
  const { suggestions, dropped } = sanitizeSuggestions(raw, vocabularySet(tagger.vocabulary), opts.minConfidence ?? 0, opts.maxTags ?? 20)
  return { tagger: { id: tagger.id, version: tagger.version }, suggestions, dropped }
}

// ── 作品 id 与交换包（愿意共享的人把模型结果交给托管账本的一方）─────────────────────────────

const OPENALEX_WORK = /^(?:https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?|openalex:)(w\d+)$/i
const WORK_SOURCE = /^[a-z][a-z0-9_-]{0,31}$/

/**
 * 作品 id 归一（账本与交换包都用它，同一篇论文只有一个键）：
 * `openalex:W123`（也收 openalex.org 链接）· `doi:<小写 DOI>`（也收裸 DOI、`doi:`、doi.org 链接）· 其他 `<source>:<id>`（比如 `onsite:42`）。认不出 ⇒ null。
 */
export function normalizeWorkId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 300) return null
  const oa = OPENALEX_WORK.exec(s)
  if (oa) return `openalex:${oa[1]!.toUpperCase()}`
  if (/^(doi:|https?:\/\/(dx\.)?doi\.org\/|10\.)/i.test(s)) {
    const doi = normalizeDoi(s)
    return doi ? `doi:${doi}` : null
  }
  const i = s.indexOf(':')
  const source = s.slice(0, Math.max(0, i)).toLowerCase()
  const id = s.slice(i + 1)
  if (i <= 0 || !WORK_SOURCE.test(source) || ['http', 'https', 'openalex'].includes(source) || !/^\S{1,200}$/.test(id)) return null
  return `${source}:${id}`
}

/** 贡献方：把若干篇论文的 `runTagger` 结果打成交换包（没有建议的论文不进包）。 */
export function buildTagContribution(
  tagger: { id: string; version: string },
  results: ReadonlyArray<{ work_id: string; suggestions: readonly TagSuggestionView[] }>,
): EvidenceTagContribution {
  return {
    contract: EVIDENCE_CONTRACT_VERSION,
    tagger: { id: tagger.id, version: tagger.version },
    items: results.filter((r) => r.suggestions.length > 0).map((r) => ({
      work_id: r.work_id,
      tags: r.suggestions.map((s) => ({ tag: s.label, confidence: s.confidence, rationale: s.rationale })),
    })),
  }
}

export interface ValidatedTagContribution {
  /** 整包不成形时为 null（此时 `items` 为空） */
  tagger: { id: string; version: string } | null
  /** 可以直接交给 `ledger.submitSuggestions(work_id, suggestions, { id, version })` 的条目 */
  items: Array<{ work_id: string; suggestions: TagSuggestionView[] }>
  issues: EvidenceContributionIssue[]
  /** 全包合计丢掉的建议 */
  dropped: Dropped
}

/**
 * 收包方：验一个**不可信**的交换包，从不抛错。词表用收包方自己的（贡献者的模型发明的标签进不了统计）；
 * 包里没有层级——写进账本时由收包方按鉴权给层级，并且最好把模型 id 加上贡献者前缀（`<账号>/<模型>`），免得两个人的同名模型被当成同一个断言者。
 */
export function validateTagContribution(
  raw: unknown, opts: { vocabulary?: readonly string[] | null; minConfidence?: number; maxItems?: number; maxTags?: number } = {},
): ValidatedTagContribution {
  const dropped: Dropped = { invalid: 0, out_of_vocabulary: 0, below_threshold: 0, over_limit: 0 }
  const refuse = (code: EvidenceContributionIssue['code']): ValidatedTagContribution => ({ tagger: null, items: [], issues: [{ code, index: null }], dropped })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('not_an_object')
  const r = raw as { tagger?: unknown; items?: unknown }
  const t = r.tagger && typeof r.tagger === 'object' ? (r.tagger as { id?: unknown; version?: unknown }) : null
  const id = typeof t?.id === 'string' ? t.id.trim() : ''
  const version = typeof t?.version === 'string' ? t.version.trim() : ''
  if (!/^[\w.:@/-]{1,64}$/.test(id) || !version || version.length > 64) return refuse('bad_tagger')
  if (!Array.isArray(r.items)) return refuse('not_an_object')
  const maxItems = Math.max(1, opts.maxItems ?? 500)
  const issues: EvidenceContributionIssue[] = r.items.length > maxItems ? [{ code: 'too_many_items', index: null }] : []
  const vocab = vocabularySet(opts.vocabulary)
  const seen = new Set<string>()
  const items: ValidatedTagContribution['items'] = []
  r.items.slice(0, maxItems).forEach((item: unknown, index) => {
    const o = item && typeof item === 'object' ? (item as { work_id?: unknown; tags?: unknown }) : null
    const workId = normalizeWorkId(o?.work_id)
    if (!workId) { issues.push({ code: 'bad_work_id', index }); return }
    if (seen.has(workId)) { issues.push({ code: 'duplicate_work', index }); return }
    seen.add(workId)
    const s = sanitizeSuggestions(Array.isArray(o?.tags) ? o.tags : [], vocab, opts.minConfidence ?? 0, opts.maxTags ?? 20)
    dropped.invalid += s.dropped.invalid
    dropped.out_of_vocabulary += s.dropped.out_of_vocabulary
    dropped.below_threshold += s.dropped.below_threshold
    dropped.over_limit += s.dropped.over_limit
    if (s.suggestions.length === 0) { issues.push({ code: 'no_valid_tags', index }); return }
    items.push({ work_id: workId, suggestions: s.suggestions })
  })
  return { tagger: { id, version }, items, issues, dropped }
}

// ── 参考实现：词表匹配 ────────────────────────────────────────────────────────────

export interface VocabularyEntry {
  /** 标签（原文） */
  tag: string
  /** 同义写法 / 缩写 / 其他语言的叫法（编辑维护；这是人定的对应，不是机器翻译） */
  aliases?: readonly string[]
}

const FIELD_CONFIDENCE = { keywords: 0.9, topics: 0.8, title: 0.7, abstract: 0.5 } as const
const hasLatin = (s: string) => /[a-z0-9]/.test(s)

/** 词表匹配：在关键词 / 外部主题 / 标题 / 摘要里找整词（拉丁文按词边界，中日韩按子串），置信度按命中的字段定。 */
export function createVocabularyTagger(input: { entries: readonly VocabularyEntry[]; id?: string; version?: string }): EvidenceTagger {
  const entries = input.entries
    .map((e) => ({ tag: e.tag, patterns: [e.tag, ...(e.aliases ?? [])].map(normalizeTag).filter((k): k is string => k !== null) }))
    .filter((e) => e.patterns.length > 0)
  const find = (text: string, pattern: string) =>
    hasLatin(pattern) ? ` ${text} `.includes(` ${pattern} `) : text.includes(pattern)
  const norm = (s: string | null | undefined) => (s ? normalizeTag(s.replace(/[.,;:!?()[\]{}"'“”‘’、，。；：！？（）《》]/g, ' ')) ?? '' : '')
  return {
    id: input.id ?? 'vocabulary',
    version: input.version ?? '1',
    vocabulary: entries.map((e) => e.tag),
    async tag(doc) {
      const fields: Array<[keyof typeof FIELD_CONFIDENCE, string[]]> = [
        ['keywords', (doc.keywords ?? []).map(norm)],
        ['topics', (doc.topics ?? []).map(norm)],
        ['title', [norm(doc.title)]],
        ['abstract', [norm(doc.abstract ?? '')]],
      ]
      const out: EvidenceTagSuggestion[] = []
      for (const e of entries) {
        for (const [field, texts] of fields) {
          const hit = e.patterns.find((p) => texts.some((t) => t && find(t, p)))
          if (hit) { out.push({ tag: e.tag, confidence: FIELD_CONFIDENCE[field], rationale: `matched "${hit}" in ${field}` }); break }
        }
      }
      return out
    },
  }
}
