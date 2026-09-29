/**
 * 读口——Web 标准的 `(Request) => Promise<Response>`（服务端）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 不依赖任何框架：Next.js Route Handler（`export const GET = handler`）、Cloudflare Workers、Deno、Bun、
 * Node 18+（配 `@whatwg-node/server` 之类的适配）都能直接挂。只暴露**读者**需要的四个读口；
 * 编辑用的操作（候选、绑定）不在这里——那些要鉴权，宿主在自己的后台路由里调 `service.suggestBindings / curate`。
 *
 *   GET {base}/map?tag=ADHD                      标签级研究图谱
 *   GET {base}/map?level=topic&id=T10537         外部节点的研究图谱（缩放）
 *   GET {base}/counts?level=topic&id=T10537&scope=primary_topic
 *   GET {base}/tags/counts?tag=ADHD              标签的站内层
 *   GET {base}/tags/graph?focus=ADHD&min_support=2&max_nodes=60
 *
 * 安全与隐私：只收 GET / HEAD；参数逐个验形、有长度上限；错误只回错误码，不回显输入；
 * 不读 cookie、不读任何读者标识、日志里只有路由名与错误信息。响应与读者无关，所以可以放心走 CDN 缓存。
 */
import type { EvidenceCountScope, EvidenceSettings } from './types'
import { defaultSettings } from './settings'
import { EVIDENCE_COUNT_SCOPES } from './types'
import type { EvidenceService, ServiceError, ServiceResult } from './service'
import { EXTERNAL_LEVELS } from './ports'
import type { ExternalLevel } from './ports'

/** 读口路由表（客户端与功能登记表共用这一份）。 */
export const EVIDENCE_ROUTES = {
  map: '/map',
  counts: '/counts',
  tag_counts: '/tags/counts',
  tag_graph: '/tags/graph',
} as const
export type EvidenceRoute = keyof typeof EVIDENCE_ROUTES

export interface EvidenceHandlerOptions {
  /** 挂载前缀，缺省 `/api/evidence` */
  basePath?: string
  /**
   * 成功响应的 Cache-Control。缺省按服务的设置 `http.cacheMaxAge`（缺省 300 秒）拼：
   * `public, max-age=<秒>, stale-while-revalidate=86400`。给了这个选项就用它，不看设置。
   */
  cacheControl?: string
  log?: (message: string, detail: Record<string, unknown>) => void
}

const STATUS: Record<ServiceError, number> = { invalid_input: 400, not_found: 404, unavailable: 503, not_configured: 501 }
const MAX_TAG = 200

const json = (status: number, body: unknown, headers: Record<string, string>, head: boolean): Response =>
  new Response(head ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers },
  })

const intParam = (v: string | null, min: number, max: number): number | undefined | null => {
  if (v === null || v === '') return undefined
  if (!/^\d{1,4}$/.test(v)) return null
  const n = Number(v)
  return n >= min && n <= max ? n : null
}

export function createEvidenceHandler(service: EvidenceService, opts: EvidenceHandlerOptions = {}): (request: Request) => Promise<Response> {
  const base = (opts.basePath ?? '/api/evidence').replace(/\/+$/, '')
  const log = opts.log ?? ((m: string, d: Record<string, unknown>) => console.error(m, d))

  return async (request: Request): Promise<Response> => {
    const head = request.method === 'HEAD'
    if (request.method !== 'GET' && !head) {
      return json(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD', 'cache-control': 'no-store' }, false)
    }
    let url: URL
    try { url = new URL(request.url) } catch { return json(400, { error: 'invalid_input' }, { 'cache-control': 'no-store' }, head) }
    const path = url.pathname.replace(/\/+$/, '')
    const route = path.startsWith(base) ? path.slice(base.length) || '/' : null
    const q = url.searchParams
    // 设置现读：后台关掉的读口回 404，缓存时长跟着设置走
    let settings: EvidenceSettings
    try { settings = await service.settings() } catch { settings = defaultSettings() }
    const cacheControl = opts.cacheControl ?? `public, max-age=${settings['http.cacheMaxAge']}, stale-while-revalidate=86400`
    const enabled: Record<string, boolean> = {
      [EVIDENCE_ROUTES.map]: settings['http.route.map'],
      [EVIDENCE_ROUTES.counts]: settings['http.route.counts'],
      [EVIDENCE_ROUTES.tag_counts]: settings['http.route.tagCounts'],
      [EVIDENCE_ROUTES.tag_graph]: settings['http.route.tagGraph'],
    }
    if (route !== null && enabled[route] === false) return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' }, head)
    const done = <T>(r: ServiceResult<T>): Response => r.ok
      ? json(200, r.data, { 'cache-control': cacheControl }, head)
      : json(STATUS[r.error], { error: r.error }, { 'cache-control': 'no-store', ...(r.error === 'unavailable' ? { 'retry-after': '60' } : {}) }, head)
    const bad = () => json(400, { error: 'invalid_input' }, { 'cache-control': 'no-store' }, head)
    const tagParam = () => { const t = q.get('tag'); return t !== null && t.length > 0 && t.length <= MAX_TAG ? t : null }
    const levelParam = () => { const l = q.get('level'); return l && (EXTERNAL_LEVELS as readonly string[]).includes(l) ? (l as ExternalLevel) : null }
    const idParam = () => { const id = q.get('id'); return id && /^[A-Za-z0-9]{1,16}$/.test(id) ? id : null }

    try {
      switch (route) {
        case EVIDENCE_ROUTES.map: {
          if (q.has('tag')) { const t = tagParam(); return t ? done(await service.getTagMap(t)) : bad() }
          const level = levelParam(); const id = idParam()
          return level && id ? done(await service.getNodeMap(level, id)) : bad()
        }
        case EVIDENCE_ROUTES.counts: {
          const level = levelParam(); const id = idParam()
          const scope = (q.get('scope') ?? 'primary_topic') as EvidenceCountScope
          if (!level || !id || !(EVIDENCE_COUNT_SCOPES as readonly string[]).includes(scope)) return bad()
          return done(await service.getCounts(level, id, scope))
        }
        case EVIDENCE_ROUTES.tag_counts: {
          const t = tagParam()
          return t ? done(await service.getTagCounts(t)) : bad()
        }
        case EVIDENCE_ROUTES.tag_graph: {
          const focus = q.get('focus')
          const minSupport = intParam(q.get('min_support'), 1, 50)
          const maxNodes = intParam(q.get('max_nodes'), 1, 200)
          if (minSupport === null || maxNodes === null || (focus !== null && focus.length > MAX_TAG)) return bad()
          return done(await service.getTagGraph({ focus: focus || null, minSupport, maxNodes }))
        }
        default:
          return json(404, { error: 'not_found' }, { 'cache-control': 'no-store' }, head)
      }
    } catch (e) {
      log('[evidence.http] handler failed', { route, error: e instanceof Error ? e.message : String(e) })
      return json(500, { error: 'internal' }, { 'cache-control': 'no-store' }, head)
    }
  }
}
