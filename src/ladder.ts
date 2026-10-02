/**
 * 证据视图阶梯——**「手上有什么数据，决定能诚实画什么图」的唯一判据**。
 * ─────────────────────────────────────────────────────────────────────────────
 * 这是整个研究图谱的脊梁，也是它与「再写一个图表组件」的区别：视图不是 UI 选项，是数据能力的函数。
 * 加一种新图 = 往 `EVIDENCE_VIEWS` 加一行（声明它**要求**什么），不改任何判断分支。
 *
 * 阶梯出处（逐条对应，不是凭印象）：
 *   · forest ——「点估计 + 方差/CI」才配叫森林图（Cochrane Handbook v6.5 ch.10.10）；
 *   · estimates ——「只有点估计、没有方差」⇒ 中位数/IQR 点线图、**不画菱形**（ch.12.2.1.1）；
 *   · albatross ——「方向 + 精确 P + 总样本量」（ch.12.2.1.2；Harrison et al. 2017）。0.2.0 起真的要求精确 p（`effect.p_value`）；
 *   · direction ——「只有方向」⇒ harvest plot（Ogilvie 2008）/ effect direction plot（Thomson 2013）；
 *   · gap_map —— 什么定量都没有 ⇒ 只诚实回答「有没有研究、多少、什么设计」（Campbell EGM 指南）。
 *
 * ⚠️ **按「显著/不显著」投票计数不构成任何一级**。Cochrane 12.2.2.1 判定它无效：
 * 「underpowered studies that do not rule out clinically important effects are counted as not showing benefit」，
 * 且「as the number of studies increases, the power of conventional vote counting tends to zero」。
 * 所以站内 `self_reported_claim` 只能当**标注**（作者自报的结果类型），不能当统计合成——
 * 只有它时落 `gap_map` 级，降级原因是 `no_direction`。任何「显著/不显著」对比条都是这种投票计数，别当合成用。
 *
 * 纯函数、无 IO、无 React —— 服务端、浏览器、移动端都可以原样吃这一份。
 *
 * 【汇总菱形】`assessPooling` 只回答「能不能画」，`poolEvidence` 在能画时把数也算出来（REML + HKSJ + 预测区间，见 stats.ts）。
 * 能不能画的判据按 Cochrane 10.10.2 逐条：同一度量、同一结局方向（数值大＝好还是坏一致）、研究设计一致（ch.24：随机与非随机一般不合并）、
 * 每项都有方差、至少 5 项（10.10.4.3）。**判据里不出现任何文献计量字段**（测试钉着）。
 */

import type {
  EvidenceDowngradeReason,
  EvidencePooledEstimate,
  EvidencePooling,
  EvidencePoolingSensitivity,
  EvidenceRecord,
  EvidenceViewDecision,
  EvidenceViewKind,
} from './types'
import { EVIDENCE_VIEW_LADDER } from './types'
import { EFFECT_METRICS, pointEstimate } from './effects'
import { isHighRiskOfBias } from './appraisal'
import { poolRandomEffects, Z_95 } from './stats'

/** 一级视图的声明：它要求每条记录具备什么、至少要几条才画。 */
export interface EvidenceViewSpec {
  kind: EvidenceViewKind
  /** 该记录能不能进这张图 */
  accepts: (r: EvidenceRecord) => boolean
  /** 少于这个数就别画（画出来的图比没有更误导） */
  minRecords: number
  /** 没到这一级时对外说的原因 */
  downgradeReason: EvidenceDowngradeReason
}

const hasEffect = (r: EvidenceRecord): boolean => pointEstimate(r.effect) !== null
const hasVariance = (r: EvidenceRecord): boolean =>
  hasEffect(r) && r.effect!.ci_low != null && r.effect!.ci_high != null &&
  Number.isFinite(r.effect!.ci_low) && Number.isFinite(r.effect!.ci_high)
const hasDirection = (r: EvidenceRecord): boolean =>
  r.direction === 'favours' || r.direction === 'against' || r.direction === 'unclear'
const hasN = (r: EvidenceRecord): boolean => !!r.effect && r.effect.n != null && r.effect.n > 0
const hasExactP = (r: EvidenceRecord): boolean =>
  !!r.effect && typeof r.effect.p_value === 'number' && r.effect.p_value > 0 && r.effect.p_value <= 1

/**
 * 视图注册表——**加一种图就加一行**。顺序即阶梯顺序（强 → 弱），与契约里的
 * `EVIDENCE_VIEW_LADDER` 逐字同（有测试钉着两者不许漂）。
 */
export const EVIDENCE_VIEWS: readonly EvidenceViewSpec[] = [
  { kind: 'forest', accepts: hasVariance, minRecords: 1, downgradeReason: 'no_variance' },
  { kind: 'estimates', accepts: hasEffect, minRecords: 1, downgradeReason: 'no_effect_sizes' },
  // albatross 要「方向 + 精确 P + 总样本量」（Harrison 2017：用 p 与 N 反推效应量的量级）。
  // 站内文章申报了精确 p（`effect.p_value`）与样本量时自动生效；外部源恒不带，永远选不中。
  { kind: 'albatross', accepts: (r) => hasDirection(r) && hasN(r) && hasExactP(r), minRecords: 2, downgradeReason: 'no_p_or_n' },
  { kind: 'direction', accepts: hasDirection, minRecords: 1, downgradeReason: 'no_direction' },
  { kind: 'gap_map', accepts: () => true, minRecords: 0, downgradeReason: 'too_few' },
]

/**
 * 选出手上数据支持的**最高**一级视图，并说明为什么不是更高的那一级。
 * 「为什么不是更高」取的是**紧邻上一级**的降级原因——这是给读者看的，不是给日志看的。
 */
export function pickEvidenceView(records: readonly EvidenceRecord[]): EvidenceViewDecision {
  const total = records.length
  for (let i = 0; i < EVIDENCE_VIEWS.length; i++) {
    const spec = EVIDENCE_VIEWS[i]
    const usable = records.filter(spec.accepts).length
    if (usable >= spec.minRecords && (spec.kind === 'gap_map' || usable > 0)) {
      return {
        kind: spec.kind,
        usable,
        total,
        downgrade_reason: i === 0 ? null : EVIDENCE_VIEWS[i - 1].downgradeReason,
      }
    }
  }
  // 兜底不可达（gap_map 恒接受），但不写 throw：读图不该因为判据兜底而整页崩
  return { kind: 'gap_map', usable: 0, total, downgrade_reason: 'too_few' }
}

/**
 * 能不能画汇总菱形。默认**不能**——这是刻意的：
 * Cochrane 10.10.2 要求同一效应量、同一对比、同一结局方向才允许汇总；10.10.4.3 建议预测区间需研究数 ≥5。
 * 我们手上是「作者自愿申报 + 外部元数据」，对比口径不受控，所以即便度量一致也只在**度量同一 ∧ 有方差 ∧ ≥5 条**时才放行。
 */
export const MIN_STUDIES_FOR_POOLING = 5

export function assessPooling(records: readonly EvidenceRecord[]): EvidencePooling {
  const withEffect = records.filter(hasEffect)
  if (withEffect.length === 0) return { allowed: false, reason: 'not_applicable', studies: 0 }
  const metrics = new Set(withEffect.map((r) => r.effect!.metric))
  // 度量不一致，或者度量未知（other：不知道它的分析尺度，无从合并）
  if (metrics.size > 1 || EFFECT_METRICS[withEffect[0].effect!.metric].toAnalysis === null) {
    return { allowed: false, reason: 'mixed_metrics', studies: withEffect.length }
  }
  // 同一结局方向：每条都申报了「数值大＝好还是坏」且一致，否则同一根轴上左右的意思会互相抵消
  const orientations = new Set(withEffect.map((r) => r.effect!.higher_is_better ?? null)) // 缺字段＝没申报
  if (orientations.size !== 1 || orientations.has(null)) {
    return { allowed: false, reason: 'orientation_unclear', studies: withEffect.length }
  }
  // 研究设计一致（外部源恒为 null：全是 null 视为一致的「未知」，与站内申报的混在一起则不一致）
  if (new Set(withEffect.map((r) => r.study_type ?? null)).size > 1) {
    return { allowed: false, reason: 'mixed_designs', studies: withEffect.length }
  }
  const withVar = withEffect.filter(hasVariance)
  if (withVar.length !== withEffect.length) return { allowed: false, reason: 'no_variance', studies: withVar.length }
  if (withVar.length < MIN_STUDIES_FOR_POOLING) return { allowed: false, reason: 'too_few_studies', studies: withVar.length }
  return { allowed: true, reason: 'ok', studies: withVar.length }
}

/**
 * 能汇总时连数一起算（`EvidencePooling.estimate`）。先过 `assessPooling`；放行后在度量的分析尺度上
 * 由 95% CI 反推标准误（(g(上限) − g(下限)) / 2·1.96），REML + HKSJ 汇总，再变换回原尺度。
 * 任何一步数不合法（比如患病率区间碰到 0 或 1、r 的区间碰到 ±1）⇒ `estimate: null`，判定照旧——不硬算。
 */
export function poolEvidence(records: readonly EvidenceRecord[]): EvidencePooling {
  const primary = poolCore(records)
  if (!primary.allowed) return primary
  // 敏感性分析（Cochrane Handbook v6.5 §10.14）：参与汇总的研究里有偏倚风险高的 ⇒ 去掉它们再判、再算一遍；主分析不变。
  // 没评过的不算高风险（不去掉）——「没评过」不是证据，也不是反证。
  const high = records.filter((r) => hasVariance(r) && isHighRiskOfBias(r.risk_of_bias))
  if (high.length === 0) return primary
  const rest = poolCore(records.filter((r) => !high.includes(r)))
  const sensitivity: EvidencePoolingSensitivity = {
    excluded: high.length, allowed: rest.allowed, reason: rest.reason, studies: rest.studies, estimate: rest.estimate ?? null,
  }
  return { ...primary, sensitivity }
}

/** 汇总判定 + 能汇总时的估计（不含敏感性分析）。 */
function poolCore(records: readonly EvidenceRecord[]): EvidencePooling {
  const decision = assessPooling(records)
  if (!decision.allowed) return { ...decision, estimate: null }
  const used = records.filter(hasVariance)
  const metric = used[0].effect!.metric
  const spec = EFFECT_METRICS[metric]
  const g = spec.toAnalysis!
  const back = spec.fromAnalysis!
  const studies = used.map((r) => {
    const e = r.effect!
    const se = (g(e.ci_high!) - g(e.ci_low!)) / (2 * Z_95)
    return { y: g(pointEstimate(e)!), v: se * se } // hasVariance 已保证点估计有限
  })
  const res = poolRandomEffects(studies)
  if (!res) return { ...decision, estimate: null }
  const nums = [res.mu, res.ci_low, res.ci_high, res.pi_low, res.pi_high].map(back)
  if (!nums.every(Number.isFinite)) return { ...decision, estimate: null }
  const estimate: EvidencePooledEstimate = {
    method: 'reml_hksj', metric, k: res.k,
    estimate: nums[0], ci_low: nums[1], ci_high: nums[2], pi_low: nums[3], pi_high: nums[4],
    tau2: res.tau2, i2: res.i2, q: res.q, df: res.df,
  }
  return { ...decision, estimate }
}

/** 视图阶梯与契约常量同源自查（给测试用，也给未来加视图的人一个即时反馈）。 */
export function viewLadderMatchesContract(): boolean {
  return EVIDENCE_VIEWS.map((v) => v.kind).join(',') === EVIDENCE_VIEW_LADDER.join(',')
}
