/**
 * 「这一页的数据从哪来、怎么变成图」：四步（数据从哪来 → 怎么打标签 → 怎么出数据 → 怎么出图）、这一页三块各用什么数据，
 * 以及「试一个标签」——归一、计数与绑定用的是引擎同一份代码（normalizeTag / groupTags，见 explore-data.ts 的 demoTagInfo），
 * 结果在原地更新，不重画整页（打字时光标不跳）。
 */
import { demoTagInfo } from './explore-data'
import type { DemoText, Locale } from './i18n'
import { h } from './dom'

/** 输入框里的字：整页重画（换语言、下钻取到数据）时保留 */
let tryText = '#CBT-I'

export function howSection(t: DemoText, locale: Locale, openTag: (label: string) => void): HTMLElement {
  const x = t.how
  const steps = h('ol', { class: 'steps' }, x.steps.map((s) => h('li', {}, [h('strong', {}, [s.name]), h('p', {}, [s.text])])))
  const sources = h('div', { class: 'sources' }, x.sources.map((s) => h('div', { class: 'source' }, [
    h('h4', {}, [h('a', { href: s.href }, [s.section])]),
    h('p', {}, [h('span', { class: 'label' }, [x.dataLabel]), s.data]),
    h('p', { class: 'code' }, [h('span', { class: 'label' }, [x.codeLabel]), s.code]),
  ])))

  const out = h('div', { class: 'try-out', role: 'status', 'aria-live': 'polite' })
  const input = h('input', { type: 'text', value: tryText, spellcheck: 'false', autocomplete: 'off', 'data-focus': 'how-try' })
  const show = () => {
    const info = demoTagInfo(locale, tryText)
    if (!info.key) { out.replaceChildren(h('p', {}, [x.tryInvalid])); return }
    const open = info.count > 0 ? h('button', { type: 'button', class: 'linkish', 'data-focus': 'how-try-open' }, [x.tryOpen]) : null
    open?.addEventListener('click', () => openTag(info.label ?? tryText))
    out.replaceChildren(...[
      h('p', { class: 'try-key' }, [x.tryKey(info.key)]),
      h('p', {}, [info.count > 0 ? x.tryCount(info.count) : x.tryNone]),
      h('p', {}, [info.boundTopic ? x.tryBound(info.boundTopic) : x.tryUnbound]),
      ...(open ? [h('p', {}, [open])] : []),
    ])
  }
  input.addEventListener('input', () => { tryText = input.value; show() })
  show()

  return h('section', { class: 'block how', 'aria-labelledby': 'how-h' }, [
    h('h2', { id: 'how-h' }, [x.title]),
    h('p', { class: 'lead' }, [x.lead]),
    steps,
    h('h3', {}, [x.sourcesTitle]),
    sources,
    h('div', { class: 'try' }, [
      h('h3', {}, [x.tryTitle]),
      h('label', { class: 'try-in' }, [x.tryLabel, input]),
      out,
      h('p', { class: 'fine' }, [x.tryHelp]),
    ]),
  ])
}
