/**
 * 浏览器 / 移动端读口客户端（类型化；只用 fetch 与 JSON，React Native 也能用）。只打**宿主自己的** API（`createEvidenceHandler` 挂的那几个路由），
 * 从不直连第三方——读者的 IP 与他在看的话题不会离开宿主站点。
 * 失败（非 2xx、网络错、响应形状不对）一律回 null：调用方显示「暂时取不到」，**绝不**当成「没有研究」画一张空图。
 */
import type { EvidenceCountScope, EvidenceCountsData, EvidenceOnsiteCounts, EvidenceScaleLevel, EvidenceTagGraph } from './types'
import { isEvidenceCountsData, isEvidenceMapData, isEvidenceOnsiteCounts, isEvidenceTagGraph } from './guards'

/** 与服务端 `EVIDENCE_ROUTES` 同一份路径（功能登记表的测试钉着两边一致）。 */
export const EVIDENCE_CLIENT_ROUTES = {
  map: '/map',
  counts: '/counts',
  tag_counts: '/tags/counts',
  tag_graph: '/tags/graph',
} as const

export interface EvidenceClientOptions {
  /** 读口前缀，缺省 `/api/evidence`（同源相对路径） */
  baseUrl?: string
  fetch?: typeof fetch
  /** 附加请求头（一般不需要；读口与读者身份无关） */
  headers?: Record<string, string>
}

export function createEvidenceClient(opts: EvidenceClientOptions = {}) {
  const base = (opts.baseUrl ?? '/api/evidence').replace(/\/+$/, '')
  const get = async <T>(route: string, params: Record<string, string | number | undefined | null>, guard: (x: unknown) => x is T): Promise<T | null> => {
    // 手拼查询串而不用 URLSearchParams：React Native 的实现不全，移动端也要能用这个客户端
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    try {
      const res = await (opts.fetch ?? fetch)(`${base}${route}${query ? `?${query}` : ''}`, { headers: { accept: 'application/json', ...(opts.headers ?? {}) } })
      if (!res.ok) return null
      const body: unknown = await res.json().catch(() => null)
      return guard(body) ? body : null
    } catch {
      return null
    }
  }
  return {
    getTagMap: (tag: string) => get(EVIDENCE_CLIENT_ROUTES.map, { tag }, isEvidenceMapData),
    getNodeMap: (level: Exclude<EvidenceScaleLevel, 'tag'>, id: string) => get(EVIDENCE_CLIENT_ROUTES.map, { level, id }, isEvidenceMapData),
    getCounts: (level: Exclude<EvidenceScaleLevel, 'tag'>, id: string, scope: EvidenceCountScope = 'primary_topic') =>
      get<EvidenceCountsData>(EVIDENCE_CLIENT_ROUTES.counts, { level, id, scope }, isEvidenceCountsData),
    getTagCounts: (tag: string) => get<EvidenceOnsiteCounts>(EVIDENCE_CLIENT_ROUTES.tag_counts, { tag }, isEvidenceOnsiteCounts),
    getTagGraph: (q: { focus?: string | null; minSupport?: number; maxNodes?: number } = {}) =>
      get<EvidenceTagGraph>(EVIDENCE_CLIENT_ROUTES.tag_graph, { focus: q.focus, min_support: q.minSupport, max_nodes: q.maxNodes }, isEvidenceTagGraph),
  }
}

export type EvidenceClient = ReturnType<typeof createEvidenceClient>
