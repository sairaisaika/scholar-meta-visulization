/**
 * 浏览器 / 移动端读口客户端，只请求宿主 API。旧工厂返回 data/null；
 * 结果式工厂保留错误类别、HTTP 状态与重试提示，失败均不能当作成功空集。
 */
import type { EvidenceCountScope, EvidenceCountsData, EvidenceOnsiteCounts, EvidenceScaleLevel, EvidenceTagGraph } from './types'
import { isEvidenceCountsData, isEvidenceMapData, isEvidenceOnsiteCounts, isEvidenceTagGraph } from './guards'

/** 与服务端 EVIDENCE_ROUTES 的四条路径保持一致。 */
export const EVIDENCE_CLIENT_ROUTES = {
  map: '/map',
  counts: '/counts',
  tag_counts: '/tags/counts',
  tag_graph: '/tags/graph',
} as const

export interface EvidenceClientOptions {
  /** 读口前缀，缺省 `/api/evidence`（同源相对路径）。 */
  baseUrl?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
}

/** 已知服务端错误加客户端本地失败；不携带任意服务器正文或异常文本。 */
export type EvidenceClientError = 'invalid_input' | 'not_found' | 'not_configured' | 'unavailable'
  | 'method_not_allowed' | 'internal' | 'http_error' | 'network' | 'invalid_response'

export type EvidenceClientResult<T> =
  | { ok: true; data: T; status: number | null }
  | { ok: false; error: EvidenceClientError; status: number | null; retryAfterSeconds: number | null }

const HTTP_ERRORS: Readonly<Record<number, EvidenceClientError>> = {
  400: 'invalid_input', 404: 'not_found', 405: 'method_not_allowed',
  500: 'internal', 501: 'not_configured', 503: 'unavailable',
}

/** 仅解析提示、不执行重试。日期相对接收时的本机时钟，非法值不补猜。 */
function retryAfterSeconds(raw: string | null): number | null {
  if (raw === null) return null
  const value = raw.trim()
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) ? seconds : null
  }
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[, ]/.test(value)) return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null
}

const failure = (error: EvidenceClientError, status: number | null, retryAfter: number | null): EvidenceClientResult<never> =>
  ({ ok: false, error, status, retryAfterSeconds: retryAfter })

/** 新旧接口共用请求和 guard；旧调用不读取失败响应正文。 */
function createClientMethods(opts: EvidenceClientOptions, diagnostics: boolean) {
  const base = (opts.baseUrl ?? '/api/evidence').replace(/\/+$/, '')
  const get = async <T>(route: string, params: Record<string, string | number | undefined | null>, guard: (x: unknown) => x is T): Promise<EvidenceClientResult<T>> => {
    let query: string
    try {
      // 不使用 URLSearchParams，保留移动端兼容。
      query = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    } catch { return failure('invalid_input', null, null) }
    let response: Response
    try {
      response = await (opts.fetch ?? fetch)(`${base}${route}${query ? `?${query}` : ''}`, { headers: { accept: 'application/json', ...(opts.headers ?? {}) } })
    } catch { return failure('network', null, null) }
    if (!response.ok && !diagnostics) return failure('http_error', null, null)
    const status = typeof response.status === 'number' ? response.status : null
    // 兼容宿主自定义 fetch 的最小 mock；真实 Response 总有 headers/status。
    const retryAfter = response.ok ? null : retryAfterSeconds(response.headers?.get('retry-after') ?? null)
    let body: unknown
    try { body = await response.json() } catch {
      return failure(response.ok ? 'invalid_response' : 'http_error', status, retryAfter)
    }
    if (!response.ok) {
      const known = status === null ? undefined : HTTP_ERRORS[status]
      const code = body && typeof body === 'object' && 'error' in body ? body.error : null
      return failure(known && code === known ? known : 'http_error', status, retryAfter)
    }
    try {
      return guard(body) ? { ok: true, data: body, status } : failure('invalid_response', status, null)
    } catch { return failure('invalid_response', status, null) }
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

/** 增量诊断接口：五个方法仍请求相同读口，不自动重试、取消或访问外部源。 */
export function createEvidenceResultClient(opts: EvidenceClientOptions = {}) {
  return createClientMethods(opts, true)
}

export type EvidenceResultClient = ReturnType<typeof createEvidenceResultClient>

/** 原有 data/null 接口；复用同一请求/验形实现，不重复取数。 */
export function createEvidenceClient(opts: EvidenceClientOptions = {}) {
  const client = createClientMethods(opts, false)
  const unwrap = async <T>(request: Promise<EvidenceClientResult<T>>): Promise<T | null> => {
    const result = await request
    return result.ok ? result.data : null
  }
  return {
    getTagMap: (tag: string) => unwrap(client.getTagMap(tag)),
    getNodeMap: (level: Exclude<EvidenceScaleLevel, 'tag'>, id: string) => unwrap(client.getNodeMap(level, id)),
    getCounts: (level: Exclude<EvidenceScaleLevel, 'tag'>, id: string, scope: EvidenceCountScope = 'primary_topic') => unwrap(client.getCounts(level, id, scope)),
    getTagCounts: (tag: string) => unwrap(client.getTagCounts(tag)),
    getTagGraph: (q: { focus?: string | null; minSupport?: number; maxNodes?: number } = {}) => unwrap(client.getTagGraph(q)),
  }
}

export type EvidenceClient = ReturnType<typeof createEvidenceClient>
