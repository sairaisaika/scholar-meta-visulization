/**
 * OpenAlex 全量计数的**装配**——把十几次 group_by 拼成一份 `EvidenceCountsData`（格子读口的生产端）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 规则全部来自维度注册表（dimensions.ts），这里不另立规矩：
 *   · 每个维度一次 group_by（1 credit）；桶 key 统一取尾段，布尔维归一成 `true` / `false`；
 *   · 分母按维度声明：`works_in_scope` 用总数，`works_with_value` 用桶和（互斥维），另外两种各多查 1 次；
 *     **分母取不到就不出这个维度**——绝不拿总数顶替（全球南方那条就是这么被低估的）；
 *   · 二值维只信「真」桶，「假」＝ 分母 − 真；
 *   · 年份维最近两年标 `provisional`（索引滞后）；
 *   · 证据与缺口图：机构部门 × 年份一次两维 group_by（1 credit），挂在机构部门那组格子上；
 *   · UpSet：机构部门最大的 4 个集合，每个集合 1 credit，得两两包含式交集；
 *   · 任何一次失败只让**那一维**缺席（没有格子 = 没查；与「查过是零」不同），全部失败才回 null。
 * 冷启动一个节点约 17 credit，并发封顶 4（OpenAlex 按秒限流，十几个请求同时在飞会吃 429）。
 */
import type {
  EvidenceCell, EvidenceChartAvailability, EvidenceCountScope, EvidenceCountSeries, EvidenceCountsData, EvidenceDenominatorKind,
  EvidenceDimensionId, EvidenceOverlap,
} from './types'
import { EVIDENCE_DIMENSION_IDS } from './types'
import { DENOMINATOR_FILTERS, EGM_PAIR, EVIDENCE_DIMENSIONS, OVERLAP_DIMENSION, OVERLAP_TOP_SETS, bucketKey, scopeFilter } from './dimensions'
import { chartAvailability } from './charts'
import type { OpenAlexClient, OpenAlexCountResult, OpenAlexGroup, OpenAlexLevel } from './openalex'
import { OPENALEX_PROVENANCE } from './openalex-meta'

/** 年份维里算「暂定」的年数（含今年）。 */
export const PROVISIONAL_YEARS = 2
const CONCURRENCY = 4

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const normKey = (raw: string, boolean: boolean): string => {
  const k = bucketKey(raw)
  if (!boolean) return k
  if (k === '1' || k === 'true') return 'true'
  if (k === '0' || k === 'false') return 'false'
  return k
}
const isUnknownKey = (k: string) => k === 'unknown' || k === 'null' || k === ''

export interface FetchCountsOptions {
  display_name?: string | undefined
  now?: Date | undefined
}

export async function fetchEvidenceCounts(
  client: OpenAlexClient, level: OpenAlexLevel, externalId: string, scope: EvidenceCountScope, opts: FetchCountsOptions = {},
): Promise<EvidenceCountsData | null> {
  const filter = scopeFilter(level, externalId, scope)
  if (!filter) return null
  const otherFilter = scopeFilter(level, externalId, scope === 'primary_topic' ? 'topics' : 'primary_topic')
  const now = opts.now ?? new Date()
  const firstProvisional = now.getUTCFullYear() - (PROVISIONAL_YEARS - 1)
  const specs = EVIDENCE_DIMENSION_IDS.map((id) => EVIDENCE_DIMENSIONS[id])
  const denomKinds = [...new Set(specs.map((s) => s.denominator).filter((k) => DENOMINATOR_FILTERS[k]))] as EvidenceDenominatorKind[]

  type Job =
    | { t: 'dim'; id: EvidenceDimensionId }
    | { t: 'egm' }
    | { t: 'denom'; kind: EvidenceDenominatorKind }
    | { t: 'other' }
  const jobs: Job[] = [
    ...specs.map((s) => ({ t: 'dim' as const, id: s.id })),
    { t: 'egm' },
    ...denomKinds.map((kind) => ({ t: 'denom' as const, kind })),
    ...(otherFilter ? [{ t: 'other' as const }] : []),
  ]
  const results = await mapLimit(jobs, CONCURRENCY, async (j) => {
    if (j.t === 'dim') return client.groupByWorks(filter, EVIDENCE_DIMENSIONS[j.id].groupBy)
    if (j.t === 'egm') return client.groupByWorks(filter, `${EVIDENCE_DIMENSIONS[EGM_PAIR.rows].groupBy},${EVIDENCE_DIMENSIONS[EGM_PAIR.cols].groupBy}`)
    if (j.t === 'denom') return client.countWorks(`${filter},${DENOMINATOR_FILTERS[j.kind]}`)
    return client.countWorks(otherFilter!)
  })
  const byDim = new Map<EvidenceDimensionId, OpenAlexCountResult>()
  const denoms = new Map<EvidenceDenominatorKind, { total: number; credits: number; query: string }>()
  let egm: OpenAlexCountResult | null = null
  let otherTotal: number | null = null
  jobs.forEach((j, i) => {
    const r = results[i]
    if (!r) return
    if (j.t === 'dim') byDim.set(j.id, r as OpenAlexCountResult)
    else if (j.t === 'egm') egm = r as OpenAlexCountResult
    else if (j.t === 'denom') denoms.set(j.kind, r)
    else otherTotal = r.total
  })
  const anyDim = byDim.values().next().value as OpenAlexCountResult | undefined
  if (!anyDim) return null
  const total = anyDim.total

  const yearCell = (key: string, label: string, count: number): EvidenceCell => {
    const y = Number(key)
    return Number.isInteger(y) && y >= firstProvisional ? { key, label, count, provisional: true } : { key, label, count }
  }

  const series: EvidenceCountSeries[] = []
  for (const spec of specs) {
    const r = byDim.get(spec.id)
    if (!r) continue
    let cells: EvidenceCell[] = r.groups
      .map((g) => ({ key: normKey(g.key, !!spec.boolean), label: g.label, count: g.count }))
      .filter((c) => !isUnknownKey(c.key))
    let credits = r.credits
    let denominatorValue: number
    if (spec.denominator === 'works_in_scope') denominatorValue = r.total
    else if (spec.denominator === 'works_with_value') denominatorValue = spec.partition ? cells.reduce((a, c) => a + c.count, 0) : r.total
    else {
      const d = denoms.get(spec.denominator)
      if (!d) continue // 诚实分母取不到 ⇒ 这一维缺席，绝不拿总数顶替
      denominatorValue = d.total
      credits += d.credits
    }
    if (spec.binaryTrueOnly) {
      const t = cells.find((c) => c.key === 'true')
      const trueCount = t?.count ?? 0
      cells = [
        { key: 'true', label: t?.label ?? 'true', count: trueCount },
        { key: 'false', label: 'false', count: Math.max(0, denominatorValue - trueCount) },
      ]
    }
    if (spec.id === 'publication_year') {
      cells = cells.map((c) => yearCell(c.key, c.label, c.count)).sort((a, b) => Number(a.key) - Number(b.key))
    } else if (spec.boolean) {
      // 布尔维固定「真」在前：换个节点桶序不变，前端的颜色映射才稳定
      const rank = (k: string) => (k === 'true' ? 0 : k === 'false' ? 1 : 2)
      cells.sort((a, b) => rank(a.key) - rank(b.key))
    } else {
      cells.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
    }
    series.push({
      dimension: spec.id,
      cells,
      denominator: { kind: spec.denominator, value: denominatorValue },
      partition: spec.partition,
      unknown: spec.partition ? Math.max(0, r.total - denominatorValue) : null,
      provenance: { ...OPENALEX_PROVENANCE, query: r.query, retrieved_at: r.retrieved_at, credits },
      caveats: [...spec.caveats],
    })
  }

  // 证据与缺口图：挂在行维（机构部门）那组格子上
  const egmResult = egm as OpenAlexCountResult | null
  const rowSeries = series.find((s) => s.dimension === EGM_PAIR.rows)
  if (egmResult && rowSeries) {
    const byRow = new Map<string, OpenAlexGroup>(egmResult.groups.map((g) => [normKey(g.key, false), g]))
    rowSeries.by = EGM_PAIR.cols
    rowSeries.cross = rowSeries.cells.map((row) => (byRow.get(row.key)?.sub ?? [])
      .map((g) => yearCell(normKey(g.key, false), g.label, g.count))
      .filter((c) => !isUnknownKey(c.key))
      .sort((a, b) => Number(a.key) - Number(b.key)))
    rowSeries.provenance = { ...rowSeries.provenance, credits: rowSeries.provenance.credits + egmResult.credits }
  }

  // UpSet：机构部门最大的几个集合的两两包含式交集
  let overlap: EvidenceOverlap | null = null
  const overlapSeries = series.find((s) => s.dimension === OVERLAP_DIMENSION)
  if (overlapSeries && overlapSeries.cells.length >= 2) { // UpSet 至少要两个集合才有交集可言
    const sets = overlapSeries.cells.slice(0, OVERLAP_TOP_SETS)
    const groupBy = EVIDENCE_DIMENSIONS[OVERLAP_DIMENSION].groupBy
    const per = await mapLimit(sets, CONCURRENCY, (s) =>
      /^[a-z_-]+$/.test(s.key) ? client.groupByWorks(`${filter},${groupBy}:${s.key}`, groupBy) : Promise.resolve(null))
    if (per.every((r) => r)) {
      const keys = new Set(sets.map((s) => s.key))
      const pairs: EvidenceOverlap['pairs'] = []
      const seen = new Set<string>()
      sets.forEach((a, i) => {
        for (const g of per[i]!.groups) {
          const b = normKey(g.key, false)
          if (b === a.key || !keys.has(b)) continue
          const id = [a.key, b].sort().join('\u0000')
          if (seen.has(id)) continue
          seen.add(id)
          pairs.push({ a: a.key, b, count: g.count })
        }
      })
      overlap = {
        dimension: OVERLAP_DIMENSION,
        sets,
        pairs,
        provenance: {
          ...OPENALEX_PROVENANCE,
          query: `${per[0]!.query} (+${sets.length - 1})`,
          retrieved_at: per[0]!.retrieved_at,
          credits: per.reduce((a, r) => a + r!.credits, 0),
        },
      }
    }
  }

  const hasCross = !!rowSeries?.cross
  const availability = Object.fromEntries(EVIDENCE_DIMENSION_IDS.map((id) => [id, chartAvailability({
    dimension: id, series: series.find((s) => s.dimension === id), overlap, hasCross,
  })])) as Record<EvidenceDimensionId, EvidenceChartAvailability[]>

  return {
    node: { id: `openalex:${externalId}`, level, display_name: opts.display_name ?? externalId },
    scope,
    total,
    other_scope_total: otherTotal,
    series,
    overlap,
    availability,
  }
}
