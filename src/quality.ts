/**
 * 打标签质量：把一组标签建议（模型的、某位贡献者的）与人标的标准答案对照。
 * ─────────────────────────────────────────────────────────────────────────────
 * 单位是（作品, 标签键）：标签两边都过 `normalizeTag`，作品键过 `normalizeWorkId`。只评标准答案覆盖到的作品——
 * 标准答案没标的作品上建议对不对，这里不知道，不算对也不算错。
 * 分母为 0 的指标给 null：没有任何建议时精确率是「算不出」，不是 0。
 * 数值与 scikit-learn 的 `precision_recall_fscore_support` / `f1_score` / `cohen_kappa_score` 对过（见 test/quality.test.ts）。
 * 这里只算；标准答案由谁标、标多少篇才够，是使用方的决定。
 */
import type { EvidenceLabelAgreement, EvidenceQualityScore, EvidenceTagQuality } from './types'
import { normalizeTag } from './tags'
import { normalizeWorkId } from './tagging'

export interface TagSetInput {
  work_id: string
  tags: readonly string[]
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const score = (tp: number, fp: number, fn: number): EvidenceQualityScore => ({
  tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn),
})

/** 作品键 → 标签键 → 首次出现的写法；同一篇出现多次取并集；键认不出的条目丢掉 */
function index(items: readonly TagSetInput[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const item of items) {
    const work = item && typeof item.work_id === 'string' ? normalizeWorkId(item.work_id) ?? (item.work_id.trim() || null) : null
    if (!work) continue
    const tags = out.get(work) ?? new Map<string, string>()
    for (const raw of Array.isArray(item.tags) ? item.tags : []) {
      const key = normalizeTag(raw)
      if (key && !tags.has(key)) tags.set(key, String(raw).trim().replace(/^#+/, ''))
    }
    out.set(work, tags)
  }
  return out
}

/**
 * 标签集合对标准答案的精确率 / 召回率 / F1。只评 `gold` 里的作品；`predicted` 里别的作品只计入 `works.predicted`。
 * 标准答案里某篇是空集合也算被评：这篇上的任何建议都是多给的。
 */
export function scoreTagSets(gold: readonly TagSetInput[], predicted: readonly TagSetInput[]): EvidenceTagQuality {
  const g = index(gold)
  const p = index(predicted)
  const per = new Map<string, { label: string; tp: number; fp: number; fn: number; support: number }>()
  const at = (key: string, label: string) => {
    let row = per.get(key)
    if (!row) { row = { label, tp: 0, fp: 0, fn: 0, support: 0 }; per.set(key, row) }
    return row
  }
  let withPredictions = 0
  for (const [work, goldTags] of g) {
    const predTags = p.get(work) ?? new Map<string, string>()
    if (predTags.size > 0) withPredictions++
    for (const [key, label] of goldTags) {
      const row = at(key, label)
      row.support++
      if (predTags.has(key)) row.tp++
      else row.fn++
    }
    for (const [key, label] of predTags) if (!goldTags.has(key)) at(key, label).fp++
  }
  const rows = [...per.entries()]
    .map(([tag_key, r]) => ({ tag_key, label: r.label, support: r.support, ...score(r.tp, r.fp, r.fn) }))
    .sort((a, b) => b.support - a.support || (a.tag_key < b.tag_key ? -1 : a.tag_key > b.tag_key ? 1 : 0))
  const sum = (k: 'tp' | 'fp' | 'fn') => rows.reduce((n, r) => n + r[k], 0)
  const supported = rows.filter((r) => r.support > 0)
  return {
    works: { gold: g.size, predicted: p.size, with_predictions: withPredictions },
    coverage: ratio(withPredictions, g.size),
    micro: score(sum('tp'), sum('fp'), sum('fn')),
    macro_f1: supported.length > 0 ? supported.reduce((n, r) => n + (r.f1 ?? 0), 0) / supported.length : null,
    per_tag: rows,
  }
}

/** 单选项的一致率与 Cohen κ。每对是同一个对象上的两个取值（标准答案与待评的那一方）；空白取值的对丢掉。 */
export function scoreLabelAgreement(pairs: ReadonlyArray<{ gold: string; predicted: string }>): EvidenceLabelAgreement {
  const clean = pairs
    .map((x) => ({ gold: typeof x?.gold === 'string' ? x.gold.trim() : '', predicted: typeof x?.predicted === 'string' ? x.predicted.trim() : '' }))
    .filter((x) => x.gold !== '' && x.predicted !== '')
  const n = clean.length
  const agreed = clean.filter((x) => x.gold === x.predicted).length
  const labels = [...new Set(clean.flatMap((x) => [x.gold, x.predicted]))].sort()
  if (n === 0) return { n: 0, agreed: 0, agreement: null, kappa: null, labels }
  const count = (side: 'gold' | 'predicted', label: string) => clean.filter((x) => x[side] === label).length
  const po = agreed / n
  const pe = labels.reduce((s, l) => s + (count('gold', l) / n) * (count('predicted', l) / n), 0)
  return { n, agreed, agreement: po, kappa: pe < 1 ? (po - pe) / (1 - pe) : null, labels }
}
