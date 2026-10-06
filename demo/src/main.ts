/**
 * 演示页入口：先说这一页的数据从哪来、怎么变成图（how.ts），然后是证据阶梯（换一组研究，看能画到哪一级、为什么不是更高）、
 * 下钻（从大类点到文章），最后是图种菜单（换格子的形状，看哪些图能画）。
 * 判据与文案全部来自引擎本身（与 npm 包 / release 安装包是同一份源码），这里只管摆放与画图。页面不发任何网络请求。
 */
import {
  EVIDENCE_VIEWS, chartAvailabilityFor, getMessages, pickEvidenceView, poolEvidence, presentCertainty, presentChartMenu, presentRiskOfBiasSummary,
  presentView, summarizeRiskOfBias,
} from '../../src/index'
import type { EvidenceRobBand } from '../../src/appraisal'
import type { ChartShape } from '../../src/charts'
import { SCENARIOS, type Scenario, type ScenarioId } from './fixtures'
import { TEXT, type Locale, type PresetId } from './i18n'
import { ROB_GLYPH, albatrossChart, estimatesChart, forestChart, gapChart, harvestChart, recordsTable, type ChartCtx } from './charts'
import { formatter, h } from './dom'
import { createExplorer } from './explore'
import { howSection } from './how'

type Gate = 'unset' | 'pass' | 'fail'
interface MenuState {
  partition: boolean; buckets: number; isYear: boolean; hasCross: boolean; hasOverlap: boolean
  onsite: boolean; onsiteN: number; gate: Gate
}

const PRESETS: Record<PresetId, MenuState> = {
  design: { partition: true, buckets: 6, isYear: false, hasCross: false, hasOverlap: false, onsite: false, onsiteN: 120, gate: 'unset' },
  year: { partition: true, buckets: 12, isYear: true, hasCross: true, hasOverlap: false, onsite: false, onsiteN: 120, gate: 'unset' },
  topics: { partition: false, buckets: 9, isYear: false, hasCross: false, hasOverlap: true, onsite: false, onsiteN: 120, gate: 'unset' },
  onsite_small: { partition: true, buckets: 4, isYear: false, hasCross: false, hasOverlap: false, onsite: true, onsiteN: 12, gate: 'unset' },
  onsite_gate: { partition: true, buckets: 4, isYear: false, hasCross: false, hasOverlap: false, onsite: true, onsiteN: 40, gate: 'fail' },
}

const store = {
  get(key: string): string | null { try { return window.localStorage.getItem(key) } catch { return null } },
  set(key: string, value: string) { try { window.localStorage.setItem(key, value) } catch { /* 隐私模式等：不记也能用 */ } },
}

const state = {
  locale: ((): Locale => {
    const saved = store.get('smv-demo-locale')
    if (saved === 'zh' || saved === 'en') return saved
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
  })(),
  scenario: 'pooled' as ScenarioId,
  preset: 'design' as PresetId | null,
  menu: { ...PRESETS.design },
  useRecords: false,
}

const app = document.getElementById('app')!
// 下钻区块的数据是异步取的（引擎的服务层）：取到之后整页重画一次
const explorer = createExplorer(state.locale, () => render())
/** 图按实际显示宽度排版：先按上一次量到的宽度画，量出来不一样就再画一遍（第二遍必然一致） */
let figureWidth = 640
const measure = () => (app.querySelector('.figure') as HTMLElement | null)?.clientWidth ?? 0

function render() {
  // 重画之后把键盘焦点还给同一个控件
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus ?? null
  const t = TEXT[state.locale]
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en'
  document.title = t.title
  const m = getMessages(state.locale)
  const ctx: ChartCtx = { t, m, num: formatter(state.locale === 'zh' ? 'zh-CN' : 'en', 2), width: figureWidth }
  const scenario = SCENARIOS.find((x) => x.id === state.scenario)!
  app.replaceChildren(header(), howSection(t, state.locale, openTag), ladderSection(ctx, scenario), explorer.section(t), menuSection(ctx, scenario), footer(ctx))
  const fw = measure()
  if (fw && Math.abs(fw - figureWidth) > 1) { figureWidth = fw; render(); return }
  if (focusKey) (app.querySelector(`[data-focus="${focusKey}"]`) as HTMLElement | null)?.focus()
}

/** 「试一个标签」里点「在下钻里打开」：下钻跳到这个标签，重画完再滚到下钻那一节（重画会打断进行中的滚动） */
function openTag(label: string) {
  void explorer.showTag(label).then(() => {
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('explore-h')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  })
}

let resizeTimer = 0
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => { const fw = measure(); if (fw && Math.abs(fw - figureWidth) > 1) { figureWidth = fw; render() } }, 150)
})

function header() {
  const t = TEXT[state.locale]
  const langs: Array<[Locale, string]> = [['zh', '中文'], ['en', 'English']]
  return h('header', { class: 'top' }, [
    h('div', { class: 'brand' }, [
      h('h1', {}, [t.title]),
      h('p', { class: 'tagline' }, [t.tagline]),
    ]),
    h('nav', { class: 'lang', 'aria-label': 'Language' }, langs.map(([code, label]) => {
      const b = h('button', { type: 'button', 'aria-pressed': state.locale === code ? 'true' : 'false', 'data-focus': `lang-${code}` }, [label])
      b.addEventListener('click', () => { state.locale = code; store.set('smv-demo-locale', code); explorer.setLocale(code); render() })
      return b
    })),
    h('p', { class: 'intro' }, [t.intro]),
    h('p', { class: 'fine' }, [t.fictional, ' ', h('a', { href: 'https://github.com/sairaisaika/scholar-meta-visulization' }, [t.source])]),
  ])
}

function ladderSection(ctx: ChartCtx, scenario: Scenario) {
  const { t, m } = ctx
  const records = scenario.records
  const decision = pickEvidenceView(records)
  const pooling = poolEvidence(records)
  const view = presentView(decision, pooling, { locale: state.locale })
  const chosen = EVIDENCE_VIEWS.findIndex((v) => v.kind === decision.kind)

  const picker = h('div', { class: 'segmented', role: 'group', 'aria-label': t.ladderTitle }, SCENARIOS.map((sc, i) => {
    const b = h('button', { type: 'button', 'aria-pressed': sc.id === scenario.id ? 'true' : 'false', 'data-focus': `sc-${sc.id}` }, [
      h('span', { class: 'num' }, [String(i + 1)]), t.scenarios[sc.id].name,
    ])
    b.addEventListener('click', () => { state.scenario = sc.id; render() })
    return b
  }))

  const rungs = h('ol', { class: 'ladder' }, EVIDENCE_VIEWS.map((spec, i) => {
    const usable = records.filter(spec.accepts).length
    const [name, ...rest] = m.view[spec.kind].split(/：|: /)
    const status = i === chosen ? 'reached' : i === chosen - 1 ? 'missing' : i < chosen ? 'not' : 'below'
    const badge = status === 'reached' ? `✓ ${t.reached}`
      : status === 'missing' ? `✕ ${t.missing}${t.sep}${decision.downgrade_reason ? m.downgrade[decision.downgrade_reason] : ''}`
        : status === 'not' ? `✕ ${t.notReached}` : t.alsoPossible
    return h('li', { class: `rung ${status}` }, [
      h('div', { class: 'rung-head' }, [h('strong', {}, [name]), h('span', { class: 'count' }, [t.satisfied(usable, records.length)])]),
      rest.length ? h('p', { class: 'rung-what' }, [capitalize(rest.join(t.sep))]) : null,
      h('p', { class: 'rung-needs' }, [t.requires[spec.kind]]),
      h('p', { class: 'badge' }, [badge]),
    ])
  }))

  const figure = h('figure', { class: 'figure' })
  const notes: string[] = []
  const legend = h('div', { class: 'legend' })
  if (decision.kind === 'forest') {
    // 偏倚风险一栏的图例：只列这组研究里出现过的档（加上「未评估」）
    const rob = summarizeRiskOfBias(records)
    if (rob.assessed > 0) {
      const bands = (Object.keys(rob.by_band) as EvidenceRobBand[]).filter((b) => rob.by_band[b] > 0)
      legend.append(...bands.map((b) => robKey(b, m.rob.band[b])))
      if (rob.assessed < rob.total) legend.append(robKey(null, m.text.rob_not_assessed))
      figure.append(legend)
    }
    figure.append(scroll(forestChart(records, pooling, ctx)))
    notes.push(pooling.allowed ? t.predictionNote : `${t.noDiamond}${m.pooling[pooling.reason]}`)
  } else if (decision.kind === 'estimates') {
    const { svg, note } = estimatesChart(records, ctx)
    figure.append(scroll(svg))
    notes.push(note)
  } else if (decision.kind === 'albatross') {
    legend.append(key('pole-favours', m.direction.favours), key('pole-against', m.direction.against), key('contour-key', t.contour, true))
    figure.append(legend, scroll(albatrossChart(records, ctx)))
  } else if (decision.kind === 'direction') {
    legend.append(key('pole-favours', m.direction.favours), key('pole-unclear', m.direction.unclear), key('pole-against', m.direction.against))
    figure.append(legend, scroll(harvestChart(records, ctx)))
    notes.push(t.heightNote)
  } else {
    figure.append(h('p', { class: 'chart-title' }, [t.countByDesign]), scroll(gapChart(records, ctx)))
    notes.push(t.claimsNote)
  }
  const robSummary = presentRiskOfBiasSummary(records, { locale: state.locale })
  const cert = scenario.certainty
    ? presentCertainty({ ...scenario.certainty, outcome: t.certaintyExample.outcome, source: t.certaintyExample.source }, { locale: state.locale })
    : null
  if (robSummary.text || cert) notes.push(t.appraisalNote)
  for (const n of notes) figure.append(h('figcaption', {}, [n]))

  const row = (dt: string, dd: Array<Node | string | null>) => h('div', {}, [h('dt', {}, [dt]), h('dd', {}, dd)])
  const facts = h('dl', { class: 'facts' }, [
    view.why_not_higher ? row(t.whyNotHigher, [view.why_not_higher]) : null,
    view.pooling_text ? row(t.pooling, [view.estimate_text ?? view.pooling_text]) : null,
    view.sensitivity_text ? row(t.sensitivity, [view.sensitivity_text]) : null,
    robSummary.text ? row(t.riskOfBias, [[robSummary.text, robSummary.missing_text].filter(Boolean).join(m.text.parts_sep)]) : null,
    cert ? row(t.certainty, [
      h('span', { class: 'grade', 'aria-hidden': 'true' }, [cert.symbol]), ' ', cert.text,
      cert.reasons_text ? h('span', { class: 'sub' }, [cert.reasons_text]) : null,
      h('span', { class: 'sub' }, [cert.meaning]),
    ]) : null,
  ])

  return h('section', { class: 'block', 'aria-labelledby': 'ladder-h' }, [
    h('h2', { id: 'ladder-h' }, [t.ladderTitle]),
    h('p', { class: 'lead' }, [t.ladderLead]),
    picker,
    h('p', { class: 'about' }, [t.scenarios[scenario.id].about]),
    h('div', { class: 'ladder-grid' }, [
      rungs,
      h('div', { class: 'result' }, [
        h('h3', {}, [view.title]),
        h('p', { class: 'usable' }, [view.usable_text]),
        facts,
        figure,
        h('details', { class: 'table-view' }, [h('summary', {}, [t.table]), h('div', { class: 'table-wrap' }, [recordsTable(records, ctx)])]),
      ]),
    ]),
  ])
}

function menuSection(ctx: ChartCtx, scenario: Scenario) {
  const { t } = ctx
  const ms = state.menu
  const shape: ChartShape = { partition: ms.partition, buckets: ms.buckets, isYear: ms.isYear, hasCross: ms.hasCross, hasOverlap: ms.hasOverlap }
  if (ms.gate !== 'unset') shape.sampleOk = ms.gate === 'pass'
  if (ms.onsite) shape.onsite_n = ms.onsiteN
  if (state.useRecords) shape.records = scenario.records
  const items = presentChartMenu(chartAvailabilityFor(shape), { locale: state.locale })

  const presets = h('div', { class: 'segmented small', role: 'group' }, (Object.keys(PRESETS) as PresetId[]).map((id) => {
    const b = h('button', { type: 'button', 'aria-pressed': state.preset === id ? 'true' : 'false', 'data-focus': `preset-${id}` }, [t.presets[id]])
    b.addEventListener('click', () => { state.preset = id; state.menu = { ...PRESETS[id] }; render() })
    return b
  }))

  const edit = (patch: Partial<MenuState>) => { state.menu = { ...state.menu, ...patch }; state.preset = null; render() }
  const check = (key: 'partition' | 'isYear' | 'hasCross' | 'hasOverlap' | 'onsite', label: string) => {
    const input = h('input', { type: 'checkbox', checked: ms[key], 'data-focus': `c-${key}` })
    input.addEventListener('change', () => edit({ [key]: input.checked } as Partial<MenuState>))
    return h('label', { class: 'ctl' }, [input, label])
  }
  const buckets = h('input', { type: 'range', min: 0, max: 15, value: ms.buckets, 'data-focus': 'c-buckets', 'aria-label': t.controls.buckets })
  buckets.addEventListener('input', () => edit({ buckets: Number(buckets.value) }))
  const onsiteN = h('input', { type: 'number', min: 0, max: 999, value: ms.onsiteN, disabled: !ms.onsite, 'data-focus': 'c-onsiteN', 'aria-label': t.controls.onsiteN })
  onsiteN.addEventListener('change', () => edit({ onsiteN: Math.max(0, Math.round(Number(onsiteN.value) || 0)) }))
  const gate = h('select', { 'data-focus': 'c-gate', 'aria-label': t.controls.sampleGate }, (['unset', 'pass', 'fail'] as Gate[]).map((g) =>
    h('option', { value: g, selected: ms.gate === g }, [g === 'unset' ? t.controls.gateUnset : g === 'pass' ? t.controls.gatePass : t.controls.gateFail])))
  gate.addEventListener('change', () => edit({ gate: gate.value as Gate }))
  const rec = h('input', { type: 'checkbox', checked: state.useRecords, 'data-focus': 'c-records' })
  rec.addEventListener('change', () => { state.useRecords = rec.checked; render() })

  const controls = h('div', { class: 'controls' }, [
    check('partition', t.controls.partition),
    h('label', { class: 'ctl' }, [t.controls.buckets, buckets, h('output', {}, [String(ms.buckets)])]),
    check('isYear', t.controls.isYear),
    check('hasCross', t.controls.hasCross),
    check('hasOverlap', t.controls.hasOverlap),
    h('span', { class: 'ctl' }, [check('onsite', t.controls.onsite), onsiteN]),
    h('label', { class: 'ctl' }, [t.controls.sampleGate, gate]),
    h('label', { class: 'ctl wide' }, [rec, `${t.controls.records}${t.sep}${t.scenarios[scenario.id].name}`]),
  ])

  const menu = h('ul', { class: 'menu' }, items.map((it) => h('li', { class: it.available ? 'card' : 'card off' }, [
    h('span', { class: 'mark-icon', 'aria-hidden': 'true' }, [it.available ? '✓' : '✕']),
    h('div', {}, [
      h('strong', {}, [it.label]),
      h('span', { class: 'state' }, [it.available ? t.canDraw : t.cannotDraw]),
      it.reason ? h('p', {}, [it.reason]) : null,
    ]),
  ])))

  return h('section', { class: 'block', 'aria-labelledby': 'menu-h' }, [
    h('h2', { id: 'menu-h' }, [t.menuTitle]),
    h('p', { class: 'lead' }, [t.menuLead]),
    presets,
    controls,
    menu,
  ])
}

function footer(ctx: ChartCtx) {
  return h('footer', { class: 'fine' }, [ctx.t.footer])
}

/** 图按显示宽度排版；极窄的屏（< 320px）才会左右滑，页面本身不横向滚动 */
const scroll = (chart: Element) => h('div', { class: 'scroll' }, [chart])

/** 英文句子拆开后首字母大写（中文不受影响） */
const capitalize = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

const key = (cls: string, label: string, line = false) =>
  h('span', { class: 'key' }, [h('i', { class: line ? `swatch line ${cls}` : `swatch ${cls}`, 'aria-hidden': 'true' }), label])
/** 偏倚风险图例：与森林图里那一栏同样的圆点与符号；null ＝ 未评估（空心圈） */
const robKey = (band: EvidenceRobBand | null, label: string) =>
  h('span', { class: 'key' }, [h('i', { class: `rob-dot rob-${band ?? 'none'}`, 'aria-hidden': 'true' }, [band ? ROB_GLYPH[band] : '']), label])

render()
void explorer.load()
