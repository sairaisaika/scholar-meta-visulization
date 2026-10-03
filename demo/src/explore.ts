/**
 * 演示页的下钻区块：从大类一路点到文章。数据走引擎真正的服务层（explore-data.ts 的内存外部源，不连网），
 * 文字一律来自引擎的视图模型（presentEvidenceMap / presentNodeChildren / presentWorks / presentRecordFacets /
 * presentCitations / presentArticleContext），这里只管摆放与导航。
 */
import {
  normalizeTag, presentArticleContext, presentCitations, presentEvidenceMap, presentNodeChildren, presentRecordFacets, presentWorks,
} from '../../src/index'
import type { ArticleContextView, CaveatView, CitationLinkView, CitationsView, FacetView, WorkRowView } from '../../src/index'
import type { EvidenceService, ExternalLevel } from '../../src/service'
import type { EvidenceMapData } from '../../src/types'
import { OPEN_PATH, START, TREE, createDemoExplorer, pathTo } from './explore-data'
import type { DemoText, Locale } from './i18n'
import { h } from './dom'

type Step = { kind: 'node'; level: ExternalLevel; id: string } | { kind: 'tag'; key: string; label: string }

export function createExplorer(initial: Locale, rerender: () => void) {
  const st = {
    locale: initial,
    gate: false,
    path: [{ kind: 'node', level: START.level, id: START.id }] as Step[],
    data: null as EvidenceMapData | null,
    failed: false,
    seq: 0,
    /** 展开了「它在这里的位置」的作品（重画时保持展开） */
    open: new Set<string>(),
  }
  let service: EvidenceService = createDemoExplorer(st.locale, () => st.gate)

  async function load() {
    const seq = ++st.seq
    const at = st.path[st.path.length - 1]
    const r = at.kind === 'node' ? await service.getNodeMap(at.level, at.id) : await service.getTagMap(at.key)
    if (seq !== st.seq) return // 期间又点了别处：只认最后一次
    st.data = r.ok ? r.data : null
    st.failed = !r.ok
    rerender()
  }
  const go = (path: Step[]) => { st.path = path; void load() }
  // 面包屑永远是从大类到这个节点的整条路径（从作品的主题直接跳过去也一样）
  const openNode = (_level: ExternalLevel, id: string) => go(pathTo(id).map((x) => ({ kind: 'node', level: TREE[x].level, id: x })))
  const openTag = (label: string) => {
    const key = normalizeTag(label)
    if (!key) return
    const nodes = st.path.filter((p) => p.kind === 'node')
    go([...nodes, { kind: 'tag', key, label }])
  }
  const canOpen = (id: string) => (OPEN_PATH as readonly string[]).includes(id)

  function section(t: DemoText): HTMLElement {
    const e = t.explore
    const gate = h('input', { type: 'checkbox', checked: st.gate, 'data-focus': 'x-gate' })
    gate.addEventListener('change', () => { st.gate = gate.checked; void load() })

    const crumbs = h('nav', { class: 'crumbs', 'aria-label': e.crumbs }, st.path.flatMap((p, i) => {
      const last = i === st.path.length - 1
      const label = p.kind === 'node' ? TREE[p.id]?.name ?? p.id : `#${p.label}`
      const b = h('button', { type: 'button', 'aria-current': last ? 'page' : null, 'data-focus': `x-crumb-${i}` }, [label])
      if (!last) b.addEventListener('click', () => go(st.path.slice(0, i + 1)))
      return i === 0 ? [b] : [h('span', { class: 'sep', 'aria-hidden': 'true' }, ['›']), b]
    }))

    const head = [h('h2', { id: 'explore-h' }, [e.title]), h('p', { class: 'lead' }, [e.lead]),
      h('label', { class: 'ctl gate' }, [gate, e.gate]), h('p', { class: 'fine gate-help' }, [e.gateHelp]), crumbs]
    if (!st.data) {
      return h('section', { class: 'block explore', 'aria-labelledby': 'explore-h' }, [...head, h('p', { class: 'notice' }, [st.failed ? e.unavailable : e.loading])])
    }

    const map = st.data
    const opts = { locale: st.locale }
    const v = presentEvidenceMap(map, opts)
    const kids = presentNodeChildren(map, opts)
    const works = presentWorks(map, opts)
    const facets = presentRecordFacets(map, { ...opts, limit: 6 })
    const citations = presentCitations(map, opts)

    const nodeHead = h('div', { class: 'node-head' }, [
      h('h3', {}, [map.level === 'tag' ? `#${v.title}` : v.title]),
      h('span', { class: 'level' }, [v.level_text]),
      v.binding ? h('span', { class: 'level' }, [v.binding.text]) : null,
    ])
    const notices = v.notices.map((n) => h('p', { class: 'notice', role: 'note' }, [n]))

    const kidsPanel = kids ? h('div', { class: 'panel kids' }, [
      h('h4', {}, [kids.title]),
      kids.rows.length ? h('ul', { class: 'bars' }, kids.rows.map((r) => {
        const open = r.level === 'tag' || canOpen(r.external_id)
        const inner = [
          h('span', { class: 'bar-label' }, [r.level === 'tag' ? `#${r.label}` : r.label]),
          h('span', { class: 'bar-count' }, [r.count_text ?? '']),
          r.size !== null ? h('span', { class: 'bar', style: `width:${Math.max(r.size * 100, r.size > 0 ? 2 : 0).toFixed(1)}%`, 'aria-hidden': 'true' }) : null,
        ]
        if (!open) return h('li', {}, [h('div', { class: 'bar-row locked', title: e.locked }, inner)])
        const b = h('button', { type: 'button', class: 'bar-row', 'data-focus': `x-kid-${r.id}` }, inner)
        b.addEventListener('click', () => (r.level === 'tag' ? openTag(r.label) : openNode(r.level as ExternalLevel, r.external_id)))
        return h('li', {}, [b])
      })) : null,
      kids.notice ? h('p', { class: 'notice' }, [kids.notice]) : null,
      kids.rows.some((r) => r.level !== 'tag' && !canOpen(r.external_id)) ? h('p', { class: 'fine' }, [e.locked]) : null,
    ]) : null

    // 引用关系：指针或焦点停在一篇上，标出这一批里和它有引用关系的
    const related = new Map<string, Set<string>>()
    for (const edge of map.edges ?? []) {
      if (edge.kind !== 'cites') continue
      for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
        const set = related.get(a) ?? new Set<string>()
        set.add(b)
        related.set(a, set)
      }
    }
    const list = h('ol', { class: 'works' })
    const highlight = (id: string | null) => {
      for (const li of Array.from(list.children) as HTMLElement[]) {
        li.classList.toggle('focus', li.dataset.id === id)
        li.classList.toggle('linked', !!id && !!related.get(id)?.has(li.dataset.id ?? ''))
      }
    }
    list.append(...works.map((w) => workItem(w, e, highlight)))
    const worksPanel = h('div', { class: 'panel works-panel' }, [
      h('h4', {}, [e.works]),
      ...v.counts_text.map((c) => h('p', { class: 'fine' }, [c])),
      related.size ? h('p', { class: 'fine' }, [e.linksHint]) : null,
      works.length ? list : h('p', { class: 'notice' }, [e.none]),
      citeLegend(citations, e),
    ])

    // click 回 null ＝ 这一行点不进去（演示树里没有的主题、期刊），只印文字
    const facetPanel = (title: string, f: FacetView, click: ((id: string, label: string) => (() => void) | null)) => h('div', { class: 'facet' }, [
      h('h4', {}, [title]),
      f.base_text ? h('p', { class: 'base' }, [f.base_text]) : null,
      f.rows.length ? h('ul', {}, f.rows.map((r) => {
        const action = click(r.id, r.label)
        const label = action ? h('button', { type: 'button', class: 'linkish', 'data-focus': `x-facet-${r.id}` }, [r.label]) : h('span', {}, [r.label])
        if (action) label.addEventListener('click', action)
        return h('li', {}, [label, h('span', { class: 'count' }, [r.count_text])])
      })) : h('p', { class: 'fine' }, [e.none]),
      f.more_text ? h('p', { class: 'fine' }, [f.more_text]) : null,
    ])
    const topicClick = (id: string) => { const x = id.replace(/^openalex:/, ''); return canOpen(x) ? () => openNode(TREE[x].level, x) : null }
    const facetsRow = h('div', { class: 'facets' }, [
      facetPanel(e.facetTopics, facets.topics, (id) => topicClick(id)),
      facetPanel(e.facetTags, facets.tags, (_id, label) => () => openTag(label)),
      facetPanel(e.facetVenues, facets.venues, () => null),
    ])

    const caveats = uniqueCaveats([...v.caveats, ...(kids?.caveats ?? []), ...facets.caveats])
    return h('section', { class: 'block explore', 'aria-labelledby': 'explore-h' }, [
      ...head,
      nodeHead,
      ...notices,
      h('div', { class: kidsPanel ? 'explore-grid' : 'explore-grid single' }, [kidsPanel, worksPanel]),
      facetsRow,
      caveats.length ? h('ul', { class: 'caveats fine' }, caveats.map((c) => h('li', {}, [c.text]))) : null,
      h('p', { class: 'fine' }, [e.fake]),
    ])

    function workItem(w: WorkRowView, ex: DemoText['explore'], hl: (id: string | null) => void) {
      const access = w.layer === 'onsite' ? 'onsite' : w.open === true ? 'open' : w.open === false ? 'closed' : 'unknown'
      const chips = [
        ...w.other_topics.map((tp) => {
          const x = tp.id.replace(/^openalex:/, '')
          if (!canOpen(x)) return h('span', { class: 'chip' }, [tp.label])
          const b = h('button', { type: 'button', class: 'chip', 'data-focus': `x-chip-${w.id}-${x}` }, [tp.label])
          b.addEventListener('click', () => openNode(TREE[x].level, x))
          return b
        }),
        ...w.other_tags.map((tag) => {
          const b = h('button', { type: 'button', class: 'chip tag', 'data-focus': `x-tag-${w.id}-${tag}` }, [tag])
          b.addEventListener('click', () => openTag(tag))
          return b
        }),
      ]
      const li = h('li', { class: `work ${w.layer}`, 'data-id': w.id, tabindex: '0' }, [
        h('p', { class: 'work-title' }, [w.title]),
        h('p', { class: 'work-meta' }, [
          w.kind_label ? h('span', { class: 'kind' }, [w.kind_label]) : null,
          [w.year_text, w.authors_text].filter(Boolean).join(' · '),
        ]),
        w.venue_text ? h('p', { class: 'work-venue' }, [w.venue_text]) : null,
        h('p', { class: 'work-access' }, [
          h('span', { class: `pill ${access}`, title: w.read_url ? `${w.read_url}（${ex.fakeLink}）` : null }, [w.access_text]),
          w.citations_text ? h('span', { class: 'work-cited' }, [w.citations_text]) : null,
        ]),
        chips.length ? h('p', { class: 'chips' }, chips) : null,
      ])
      const ctx = presentArticleContext(map, w.id, opts)
      if (ctx) li.append(contextCard(ctx, w, ex))
      li.addEventListener('pointerenter', () => hl(w.id))
      li.addEventListener('pointerleave', () => hl(null))
      li.addEventListener('focusin', () => hl(w.id))
      li.addEventListener('focusout', () => hl(null))
      return li
    }
  }

  /** 一篇的位置：它是什么研究、能回答什么；这里谁引用了它、拿它做了什么；它引用了谁、拿它们做了什么 */
  function contextCard(ctx: ArticleContextView, w: WorkRowView, ex: DemoText['explore']) {
    const links = (title: string, list: readonly CitationLinkView[], other: (l: CitationLinkView) => string) => list.length === 0 ? null
      : h('div', { class: 'ctx-links' }, [
        h('p', { class: 'ctx-h' }, [title]),
        h('ul', {}, list.map((l) => h('li', { title: l.text }, [
          h('span', { class: 'ctx-other' }, [other(l)]),
          h('span', { class: 'purposes' }, l.labels.length > 0
            ? l.labels.map((lab) => h('span', { class: 'purpose' }, [lab]))
            : [h('span', { class: 'purpose none' }, [ex.undeclaredChip])]),
          l.declared_text ? h('span', { class: 'declared' }, [l.declared_text]) : null,
        ]))),
      ])
    const d = h('details', { class: 'ctx', open: st.open.has(w.id) }, [
      h('summary', { 'data-focus': `x-ctx-${w.id}` }, [ex.ctxOpen, w.links_text ? h('span', { class: 'work-links' }, [` · ${w.links_text}`]) : null]),
      h('div', { class: 'ctx-card' }, [
        ctx.kind_text ? h('p', { class: 'ctx-kind' }, [ctx.kind_text]) : null,
        ctx.kind_hint ? h('p', {}, [ctx.kind_hint]) : null,
        ctx.rank_text ? h('p', { class: 'fine' }, [ctx.rank_text]) : null,
        ctx.advances_text ? h('p', { class: 'ctx-adv' }, [ctx.advances_text]) : null,
        links(ctx.cited_by_title, ctx.cited_by, (l) => l.from_title),
        links(ctx.cites_title, ctx.cites, (l) => l.to_title),
        ctx.legend.length > 0 ? h('dl', { class: 'meanings' }, ctx.legend.flatMap((r) => [h('dt', {}, [r.label]), h('dd', {}, [r.meaning])])) : null,
        h('ul', { class: 'fine ctx-notes' }, ctx.notes.map((n) => h('li', {}, [n]))),
      ]),
    ])
    d.addEventListener('toggle', () => { if (d.open) st.open.add(w.id); else st.open.delete(w.id) })
    return d
  }

  /** 这批里的引用用途：每种几条、没说明的几条；各推进了什么折在里面 */
  function citeLegend(c: CitationsView, ex: DemoText['explore']) {
    if (c.links.length === 0) return null
    return h('div', { class: 'cite-legend' }, [
      h('p', { class: 'ctx-h' }, [ex.citeTitle]),
      c.legend.length > 0 ? h('p', { class: 'purposes' }, c.legend.map((r) => h('span', { class: 'purpose' }, [r.label, h('span', { class: 'count' }, [r.count_text])]))) : null,
      c.undeclared_text ? h('p', { class: 'fine' }, [c.undeclared_text]) : null,
      c.machine_text ? h('p', { class: 'fine' }, [c.machine_text]) : null,
      h('p', { class: 'fine' }, [ex.citeLead]),
      c.legend.length > 0 ? h('details', { class: 'ctx' }, [
        h('summary', {}, [ex.meaningTitle]),
        h('dl', { class: 'meanings' }, c.legend.flatMap((r) => [h('dt', {}, [r.label]), h('dd', {}, [r.meaning])])),
      ]) : null,
    ])
  }

  return {
    section,
    load,
    setLocale(locale: Locale) {
      if (locale === st.locale) return
      st.locale = locale
      service = createDemoExplorer(locale, () => st.gate)
      // 站内标签随语言变：停在标签上时退回到它所在的节点
      st.path = st.path.filter((p) => p.kind === 'node')
      st.data = null
      void load()
    },
  }
}

const uniqueCaveats = (list: readonly CaveatView[]) => {
  const seen = new Set<string>()
  return list.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
}
