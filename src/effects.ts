/**
 * 效应量度量注册表——**每种度量声明它自己的性质**，而不是让验形、方向判断、汇总各写一套 if。
 * ─────────────────────────────────────────────────────────────────────────────
 * 纯声明 + 纯函数，零 IO。加一种度量 = 加一行。
 *   · `nullValue`：「没有效应」是几（差值类 0、比值类 1；患病率与 other 没有）。方向判断、「显著性自报与区间是否矛盾」都靠它；
 *   · `inDomain`：数值合法范围（比值必须 > 0，相关系数在 [−1, 1]，患病率在 [0, 1]）——验形靠它；
 *   · `toAnalysis` / `fromAnalysis`：汇总用的分析尺度（比值取对数、r 用 Fisher z、患病率用 logit）；为 null 的度量不能汇总。
 *
 * 出处：Cochrane Handbook v6.5 §6.3–6.5（效应量与其分析尺度）、§10.10.2（同一度量才合并）；Fisher z：Fisher 1915。
 */
import type { EvidenceDirection, EvidenceEffect, EvidenceEffectMetric } from './types'
import { EVIDENCE_EFFECT_METRICS } from './types'

export interface EffectMetricSpec {
  metric: EvidenceEffectMetric
  nullValue: number | null
  inDomain: (x: number) => boolean
  toAnalysis: ((x: number) => number) | null
  fromAnalysis: ((x: number) => number) | null
}

const identity = (x: number) => x
const finite = (x: number) => Number.isFinite(x)
const difference = (metric: EvidenceEffectMetric): EffectMetricSpec =>
  ({ metric, nullValue: 0, inDomain: finite, toAnalysis: identity, fromAnalysis: identity })
const ratio = (metric: EvidenceEffectMetric): EffectMetricSpec =>
  ({ metric, nullValue: 1, inDomain: (x) => Number.isFinite(x) && x > 0, toAnalysis: Math.log, fromAnalysis: Math.exp })

export const EFFECT_METRICS: Record<EvidenceEffectMetric, EffectMetricSpec> = {
  smd: difference('smd'),
  md: difference('md'),
  hedges_g: difference('hedges_g'),
  cohens_d: difference('cohens_d'),
  or: ratio('or'),
  rr: ratio('rr'),
  hr: ratio('hr'),
  r: { metric: 'r', nullValue: 0, inDomain: (x) => Number.isFinite(x) && x >= -1 && x <= 1, toAnalysis: Math.atanh, fromAnalysis: Math.tanh },
  prevalence: {
    metric: 'prevalence', nullValue: null, inDomain: (x) => Number.isFinite(x) && x >= 0 && x <= 1,
    toAnalysis: (p) => Math.log(p / (1 - p)), fromAnalysis: (z) => 1 / (1 + Math.exp(-z)),
  },
  other: { metric: 'other', nullValue: null, inDomain: finite, toAnalysis: null, fromAnalysis: null },
}

export function isEffectMetric(x: unknown): x is EvidenceEffectMetric {
  return typeof x === 'string' && (EVIDENCE_EFFECT_METRICS as readonly string[]).includes(x)
}

/**
 * 点估计：有限的数才算；`null`（只有精确 p 与样本量）、旧写法的 `NaN`、效应量本身缺 ⇒ null。
 * 读 `effect.value` 的地方都过这一道——契约里 `value` 0.3.0 起可以是 `null`。
 */
export function pointEstimate(e: Pick<EvidenceEffect, 'value'> | null | undefined): number | null {
  const v = e?.value
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 从点估计推方向（Cochrane 12.2.2.1：按**点估计的方向**计数，不看显著性）。
 * 需要度量有「无效应值」且申报了数值大＝好还是坏；否则 null（推不出来，不是 unclear）。点估计正好等于无效应值 ⇒ unclear。
 */
export function directionFromEffect(e: Pick<EvidenceEffect, 'metric' | 'value' | 'higher_is_better'>): Exclude<EvidenceDirection, 'not_applicable'> | null {
  const nv = EFFECT_METRICS[e.metric]?.nullValue ?? null
  const v = pointEstimate(e)
  if (nv === null || e.higher_is_better == null || v === null) return null
  if (v === nv) return 'unclear'
  return (v > nv) === e.higher_is_better ? 'favours' : 'against'
}

/** 95% 区间是否把「无效应」排除在外。没有区间或度量没有无效应值 ⇒ null。 */
export function intervalExcludesNull(e: Pick<EvidenceEffect, 'metric' | 'ci_low' | 'ci_high'>): boolean | null {
  const nv = EFFECT_METRICS[e.metric]?.nullValue ?? null
  if (nv === null || e.ci_low == null || e.ci_high == null) return null
  return e.ci_low > nv || e.ci_high < nv
}

/** 注册表与契约值域同源。 */
export function effectMetricsMatchContract(): boolean {
  return JSON.stringify(Object.keys(EFFECT_METRICS).sort()) === JSON.stringify([...EVIDENCE_EFFECT_METRICS].sort())
}
