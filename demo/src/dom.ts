/**
 * 小工具：建 HTML / SVG 元素、比例尺、刻度、数字格式、悬停提示。文字一律走 textContent，不拼 innerHTML。
 */
const SVG_NS = 'http://www.w3.org/2000/svg'

type Attrs = Record<string, string | number | boolean | null | undefined>
type Child = Node | string | null | undefined | false

const apply = (el: Element, attrs: Attrs, children: readonly Child[]) => {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return el
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  return apply(document.createElement(tag), attrs, children) as HTMLElementTagNameMap[K]
}

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, children: readonly Child[] = []): SVGElementTagNameMap[K] {
  return apply(document.createElementNS(SVG_NS, tag), attrs, children) as SVGElementTagNameMap[K]
}

/** 线性比例尺 */
export const scale = (d0: number, d1: number, r0: number, r1: number) => (x: number) => r0 + ((x - d0) / (d1 - d0)) * (r1 - r0)

/** 取整齐的刻度（1 / 2 / 5 × 10^k 的步长），首尾刻度把 [lo, hi] 整个包住：数据永远落在轴上 */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag
  const first = Math.floor(lo / step + 1e-9)
  const last = Math.ceil(hi / step - 1e-9)
  const out: number[] = []
  for (let i = first; i <= last; i++) out.push(i * step + 0) // + 0：把 −0 变成 0
  return out
}

export function formatter(locale: string, digits: number) {
  try {
    const f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    return (x: number) => f.format(x).replace('-', '−')
  } catch {
    return (x: number) => x.toFixed(digits).replace('-', '−')
  }
}

// ── 悬停提示：值在前（醒目），说明在后；键盘聚焦与悬停一样 ─────────────────────────────────

let tip: HTMLDivElement | null = null
const tipEl = () => {
  if (!tip) {
    tip = h('div', { class: 'tip', role: 'status', 'aria-live': 'polite' })
    document.body.append(tip)
  }
  return tip
}

export interface TipContent { value: string; label: string }

export function withTip(target: Element, content: () => TipContent) {
  const show = (x: number, y: number) => {
    const t = tipEl()
    const c = content()
    t.replaceChildren(h('strong', {}, [c.value]), h('span', {}, [c.label]))
    t.style.display = 'block'
    const pad = 12
    const w = t.offsetWidth
    const left = Math.min(Math.max(pad, x + pad), window.innerWidth - w - pad)
    t.style.left = `${left}px`
    t.style.top = `${Math.max(pad, y - t.offsetHeight - pad)}px`
  }
  const hide = () => { if (tip) tip.style.display = 'none' }
  target.setAttribute('tabindex', '0')
  target.addEventListener('pointerenter', (e) => show((e as PointerEvent).clientX, (e as PointerEvent).clientY))
  target.addEventListener('pointermove', (e) => show((e as PointerEvent).clientX, (e as PointerEvent).clientY))
  target.addEventListener('pointerleave', hide)
  target.addEventListener('focus', () => {
    const r = target.getBoundingClientRect()
    show(r.left + r.width / 2, r.top)
  })
  target.addEventListener('blur', hide)
}
