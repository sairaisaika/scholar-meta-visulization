/**
 * 统计小件：数值与 scipy 1.17 逐个对过（参考值脚本见 PR 说明；这里只钉结果）。
 *   ① Wilson 区间 = scipy.stats.binomtest(...).proportion_ci(method='wilson')；
 *   ② 比例可靠性门槛：n < 30 不印比例；区间宽 ≥ 0.30 标注；
 *   ③ t 分位数 / CDF = scipy.stats.t；
 *   ④ REML τ² = 直接数值最大化限制似然（scipy.optimize）得到的值；HKSJ（q ≥ 1）区间、t(k−2) 预测区间、I²。
 */
import {
  wilsonInterval, shareReliability, studentTQuantile, studentTCdf, poolRandomEffects, tau2Reml, Z_95,
  MIN_N_FOR_SHARE,
} from '../src/stats'

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

describe('Wilson 区间', () => {
  it.each([
    [0, 10, 0, 0.27753279986288926],
    [3, 5, 0.23072428127601297, 0.8823792257673521],
    [30, 100, 0.21894885294932764, 0.39584854633346667],
    [10, 10, 0.7224672001371109, 1],
    [1, 30, 0.005908590381612441, 0.16670390991409173],
    [50, 120, 0.3323835214047596, 0.5061196729983577],
  ])('%i/%i', (k, n, low, high) => {
    const ci = wilsonInterval(k, n)!
    close(ci.low, low, 1e-12)
    close(ci.high, high, 1e-12)
  })
  it('不合法输入回 null，不硬算', () => {
    expect(wilsonInterval(1, 0)).toBeNull()
    expect(wilsonInterval(5, 3)).toBeNull()
    expect(wilsonInterval(-1, 3)).toBeNull()
    expect(wilsonInterval(NaN, 3)).toBeNull()
  })
})

describe('比例可靠性', () => {
  it('分母 < 30 ⇒ 只印计数', () => {
    expect(shareReliability(3, 5)).toBe('insufficient_n')
    expect(shareReliability(29, MIN_N_FOR_SHARE - 1)).toBe('insufficient_n')
  })
  it('n = 30、p = 0.5 时区间宽 0.337 ⇒ 标注；n = 120 ⇒ ok', () => {
    expect(shareReliability(15, 30)).toBe('wide_interval')
    expect(shareReliability(50, 120)).toBe('ok')
  })
})

describe('t 分布', () => {
  it.each([
    [1, 12.706204736174694], [2, 4.302652729749462], [3, 3.1824463052837078], [4, 2.7764451051977934],
    [5, 2.5705818356363146], [10, 2.228138851986274], [30, 2.0422724563012378], [100, 1.9839715185235518],
  ])('t(0.975, df=%i)', (df, q) => close(studentTQuantile(0.975, df), q, 1e-9))
  it('CDF 与对称性', () => {
    close(studentTCdf(2.0, 7), 0.957190335718512, 1e-12)
    close(studentTCdf(-1.3, 3), 0.14223375436394853, 1e-12)
    close(studentTQuantile(0.025, 4), -2.7764451051977934, 1e-9)
    expect(studentTQuantile(0.5, 3)).toBe(0)
    expect(studentTQuantile(1, 3)).toBeNaN()
  })
})

describe('随机效应汇总（REML + HKSJ + 预测区间）', () => {
  it('有异质性：τ² 与数值最大化限制似然一致', () => {
    const y = [0.10, 0.30, 0.35, 0.65, 0.45, 0.15]
    const v = [0.03, 0.03, 0.05, 0.01, 0.05, 0.02]
    const r = poolRandomEffects(y.map((yi, i) => ({ y: yi, v: v[i] })))!
    close(r.tau2, 0.03314026583764075, 1e-8)
    close(r.mu, 0.34633576696147256, 1e-8)
    close(r.ci_low, 0.08630876032216978, 1e-7)
    close(r.ci_high, 0.6063627736007753, 1e-7)
    close(r.pi_low, -0.23188906770703793, 1e-7)
    close(r.pi_high, 0.924560601629983, 1e-7)
    close(r.q, 12.805627705627707, 1e-9)
    close(r.i2, 0.6095466684696258, 1e-9)
    expect(r.df).toBe(5)
  })
  it('同质：τ² 截在 0；HKSJ 的 q < 1 时取 1（区间不比常规的窄）', () => {
    const y = [0.20, 0.21, 0.19, 0.20, 0.22]
    const v = [0.04, 0.05, 0.03, 0.04, 0.06]
    const r = poolRandomEffects(y.map((yi, i) => ({ y: yi, v: v[i] })))!
    expect(r.tau2).toBe(0)
    close(r.se_hksj, r.se, 1e-15)
    close(r.ci_low, -0.05178693563193923, 1e-9)
    close(r.pi_high, 0.4921829382421431, 1e-9)
    expect(r.i2).toBe(0)
  })
  it('比值度量：在对数尺度上汇总（这里只验对数尺度的数，取指数在 ladder 里做）', () => {
    const ors: Array<[number, number, number]> = [[1.5, 1.1, 2.05], [0.9, 0.6, 1.35], [2.1, 1.3, 3.4], [1.2, 0.95, 1.52], [1.8, 1.2, 2.7]]
    const studies = ors.map(([o, l, h]) => ({ y: Math.log(o), v: ((Math.log(h) - Math.log(l)) / (2 * Z_95)) ** 2 }))
    close(tau2Reml(studies), 0.05679135617993012, 1e-8)
    const r = poolRandomEffects(studies)!
    close(r.mu, 0.34065067907566654, 1e-8)
    close(r.se_hksj, 0.1414366703300862, 1e-8)
    close(r.pi_low, -0.530976447215959, 1e-7)
  })
  it('研究太少或方差不合法 ⇒ null', () => {
    expect(poolRandomEffects([{ y: 1, v: 0.1 }, { y: 2, v: 0.1 }])).toBeNull()
    expect(poolRandomEffects([{ y: 1, v: 0.1 }, { y: 2, v: 0 }, { y: 3, v: 0.1 }])).toBeNull()
  })
})
