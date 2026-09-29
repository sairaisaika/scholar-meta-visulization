/**
 * 统计小件——纯函数、零依赖：比例的区间与可靠性、t 分布分位数、随机效应汇总。
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么引擎自己算】「可靠的可视化」落到最后一公里就是这几个数：一个 3/5 = 60% 的柱子和一个 300/500 = 60% 的柱子
 * 长得一模一样，只有区间能把它们区分开。交给每个前端各算各的，迟早有人用 Wald 区间（小样本下会越出 [0,1]），
 * 或者拿全部记录数当分母。所以区间、可靠性判定、汇总估计都在这里算好，随数据一起给出去。
 *
 * 出处：
 *   · Wilson score 区间——Wilson 1927, *JASA* 22(158):209–212；小样本下优于 Wald：Brown, Cai & DasGupta 2001, *Stat Sci* 16(2):101–133。
 *   · 比例「可不可以印」的门槛——改编自 NCHS 比例呈现标准（Parker et al. 2017, *Vital Health Stat* 2(175)）：
 *     有效样本量 < 30 不印比例；区间宽度 ≥ 0.30 印但标注。原标准用 Korn–Graubard 区间，这里换成 Wilson（如实说明是改编）。
 *   · 随机效应汇总——τ² 用 REML（Viechtbauer 2005, *JEBS* 30(3):261–293 的不动点迭代）；
 *     均值的置信区间用 Hartung–Knapp–Sidik–Jonkman 并取 q ≥ 1 的保守修正（Knapp & Hartung 2003；Röver, Knapp & Friede 2015,
 *     *BMC Med Res Methodol* 15:99）；预测区间用 t(k−2)（Higgins, Thompson & Spiegelhalter 2009, *JRSS A* 172(1):137–159；
 *     Cochrane Handbook v6.5 §10.10.4.3）；I² 按 Higgins & Thompson 2002, *Stat Med* 21(11):1539–1558。
 */

/** 标准正态 97.5% 分位数（95% 双侧）。 */
export const Z_95 = 1.959963984540054

export interface Interval { low: number; high: number }

/** Wilson score 区间。k 不在 [0, n] 或 n ≤ 0 时回 null（不硬算）。 */
export function wilsonInterval(k: number, n: number, z = Z_95): Interval | null {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0 || k > n) return null
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

/** 分母少于这个数不印比例，只印计数（NCHS 2017 改编）。 */
export const MIN_N_FOR_SHARE = 30
/** 区间宽度到这个数，比例照印但必须标注（NCHS 2017 改编）。 */
export const MAX_SHARE_CI_WIDTH = 0.3

/** 一个比例能不能印：`ok` 可以 · `insufficient_n` 分母太小，只印计数 · `wide_interval` 印，但标注区间太宽。 */
export type ShareReliability = 'ok' | 'insufficient_n' | 'wide_interval'
export const SHARE_RELIABILITIES = ['ok', 'insufficient_n', 'wide_interval'] as const satisfies readonly ShareReliability[]

export function shareReliability(k: number, n: number): ShareReliability {
  if (!(n >= MIN_N_FOR_SHARE)) return 'insufficient_n'
  const ci = wilsonInterval(k, n)
  if (!ci) return 'insufficient_n'
  return ci.high - ci.low >= MAX_SHARE_CI_WIDTH ? 'wide_interval' : 'ok'
}

// ── t 分布 ─────────────────────────────────────────────────────────────────────

/** ln Γ(x)，Lanczos 近似（g = 7, n = 9），x > 0 时相对误差 ~1e-15。 */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const xm = x - 1
  let a = c[0]
  const t = xm + 7.5
  for (let i = 1; i < 9; i++) a += c[i] / (xm + i)
  return 0.5 * Math.log(2 * Math.PI) + (xm + 0.5) * Math.log(t) - t + Math.log(a)
}

/** 不完全 Beta 的连分式（Lentz 法）。 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 500
  const EPS = 1e-15
  const TINY = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** 正则化不完全 Beta 函数 I_x(a, b)。 */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0
  if (!(x < 1)) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Student t 的累积分布函数。 */
export function studentTCdf(t: number, df: number): number {
  if (!(df > 0) || Number.isNaN(t)) return NaN
  if (t === Infinity) return 1
  if (t === -Infinity) return 0
  const tail = 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

/** Student t 的分位数（二分，精度 ~1e-12）。参数不合法回 NaN。 */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN
  if (p === 0.5) return 0
  if (p < 0.5) return -studentTQuantile(1 - p, df)
  let lo = 0
  let hi = 1
  while (studentTCdf(hi, df) < p && hi < 1e12) { lo = hi; hi *= 2 }
  for (let i = 0; i < 300 && hi - lo > 1e-13 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2
    if (studentTCdf(mid, df) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ── 随机效应汇总 ────────────────────────────────────────────────────────────────

/** 一项研究在**分析尺度**上的效应与抽样方差。 */
export interface PoolStudy { y: number; v: number }

export interface PoolResult {
  k: number
  mu: number
  /** 常规随机效应标准误 √(1/Σw*) */
  se: number
  /** HKSJ（q ≥ 1 修正）标准误，置信区间用它 */
  se_hksj: number
  ci_low: number
  ci_high: number
  pi_low: number
  pi_high: number
  tau2: number
  i2: number
  q: number
  df: number
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

/** Cochran's Q（固定效应权重）。 */
export function cochranQ(studies: readonly PoolStudy[]): number {
  const w = studies.map((s) => 1 / s.v)
  const sw = sum(w)
  const mu = sum(studies.map((s, i) => w[i] * s.y)) / sw
  return sum(studies.map((s, i) => w[i] * (s.y - mu) ** 2))
}

/** DerSimonian–Laird τ²（只用作 REML 迭代的起点）。 */
export function tau2DerSimonianLaird(studies: readonly PoolStudy[]): number {
  const k = studies.length
  if (k < 2) return 0
  const w = studies.map((s) => 1 / s.v)
  const sw = sum(w)
  const c = sw - sum(w.map((x) => x * x)) / sw
  return c > 0 ? Math.max(0, (cochranQ(studies) - (k - 1)) / c) : 0
}

/** REML τ²：τ² ← Σw²[(y−μ̂)² − v]/Σw² + 1/Σw，截在 0（Viechtbauer 2005）。 */
export function tau2Reml(studies: readonly PoolStudy[], maxIter = 1000, tol = 1e-12): number {
  if (studies.length < 2) return 0
  let tau2 = tau2DerSimonianLaird(studies)
  for (let it = 0; it < maxIter; it++) {
    const w = studies.map((s) => 1 / (s.v + tau2))
    const sw = sum(w)
    const mu = sum(studies.map((s, i) => w[i] * s.y)) / sw
    const sw2 = sum(w.map((x) => x * x))
    const next = Math.max(0, sum(studies.map((s, i) => w[i] * w[i] * ((s.y - mu) ** 2 - s.v))) / sw2 + 1 / sw)
    const done = Math.abs(next - tau2) <= tol * Math.max(1, tau2)
    tau2 = next
    if (done) break
  }
  return tau2
}

/**
 * 随机效应汇总。至少 3 项研究（预测区间要 t(k−2)），且每项方差为正有限值；否则回 null。
 * 引擎只在 `assessPooling` 放行（≥5 项、同度量、同方向、同设计、都有方差）之后才调它。
 */
export function poolRandomEffects(studies: readonly PoolStudy[]): PoolResult | null {
  const k = studies.length
  if (k < 3) return null
  if (!studies.every((s) => Number.isFinite(s.y) && Number.isFinite(s.v) && s.v > 0)) return null
  const tau2 = tau2Reml(studies)
  const w = studies.map((s) => 1 / (s.v + tau2))
  const sw = sum(w)
  const mu = sum(studies.map((s, i) => w[i] * s.y)) / sw
  const se = Math.sqrt(1 / sw)
  const qHk = sum(studies.map((s, i) => w[i] * (s.y - mu) ** 2)) / (k - 1)
  const seHk = Math.sqrt(Math.max(1, qHk) / sw)
  const tCi = studentTQuantile(0.975, k - 1)
  const tPi = studentTQuantile(0.975, k - 2)
  const q = cochranQ(studies)
  const df = k - 1
  const piHalf = tPi * Math.sqrt(tau2 + se * se)
  return {
    k, mu, se, se_hksj: seHk,
    ci_low: mu - tCi * seHk, ci_high: mu + tCi * seHk,
    pi_low: mu - piHalf, pi_high: mu + piHalf,
    tau2, i2: q > 0 ? Math.max(0, (q - df) / q) : 0, q, df,
  }
}
