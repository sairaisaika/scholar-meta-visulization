/**
 * 响应验形（纯函数）：浏览器端收到的 JSON 先过这里再用。只查「画图会用到的骨架」，不做全量 schema 校验——
 * 目的是把「服务端回了个错误页 / 空体 / 旧版本形状」挡在渲染之前，而不是替服务端做类型证明。
 */
import type { EvidenceCountsData, EvidenceMapData, EvidenceOnsiteCounts, EvidenceTagGraph } from './types'
import { EVIDENCE_SCALE_LADDER, EVIDENCE_VIEW_LADDER } from './types'

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const isArr = Array.isArray
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

const isSampleGate = (g: unknown) => isObj(g) && isNum(g.min) && isNum(g.n) && typeof g.ok === 'boolean'
const isSeriesLike = (s: unknown) =>
  isObj(s) && typeof s.dimension === 'string' && isArr(s.cells) && isObj(s.denominator) && isNum((s.denominator as Record<string, unknown>).value)
  && typeof s.partition === 'boolean' && isObj(s.provenance) && (s.sample_gate === undefined || isSampleGate(s.sample_gate))

export function isEvidenceMapData(x: unknown): x is EvidenceMapData {
  return isObj(x)
    && (EVIDENCE_SCALE_LADDER as readonly unknown[]).includes(x.level)
    && isArr(x.records) && isArr(x.siblings) && isArr(x.sources)
    && isObj(x.view) && (EVIDENCE_VIEW_LADDER as readonly unknown[]).includes(x.view.kind)
    && isObj(x.pooling) && typeof x.pooling.allowed === 'boolean'
    && typeof x.onsite_only === 'boolean'
    && (x.certainty === undefined || x.certainty === null || isArr(x.certainty))
}

export function isEvidenceTagGraph(x: unknown): x is EvidenceTagGraph {
  return isObj(x) && isArr(x.nodes) && isArr(x.edges) && isNum(x.min_support) && isNum(x.records) && isArr(x.caveats)
    && isObj(x.collapsed) && isObj(x.provenance)
}

export function isEvidenceOnsiteCounts(x: unknown): x is EvidenceOnsiteCounts {
  return isObj(x) && isObj(x.scope) && isNum(x.total) && isArr(x.series) && x.series.every(isSeriesLike) && isObj(x.availability)
    && (x.tag_graph === null || isEvidenceTagGraph(x.tag_graph))
}

export function isEvidenceCountsData(x: unknown): x is EvidenceCountsData {
  return isObj(x) && isObj(x.node) && typeof x.scope === 'string' && isNum(x.total) && isArr(x.series) && x.series.every(isSeriesLike)
    && isObj(x.availability) && (x.onsite === undefined || x.onsite === null || isEvidenceOnsiteCounts(x.onsite))
}
