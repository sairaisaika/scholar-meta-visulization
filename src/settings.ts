/**
 * 插件设置——**设置项注册表 + 验值 + 现读**（纯函数、零 IO；主入口导出，后台页面与服务端都能用；清单在 manifest.ts）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 接入方把本引擎装进自己后台的「插件区」：
 *   · 设置页按 `EVIDENCE_SETTINGS` 自动生成（类型、缺省值、范围、单位、生效方式都在这里声明；文案在词典的 `setting` 一节）；
 *   · 值存在接入方自己的库里，交给 `createLiveSettings(读库的函数)`，服务与读口每次请求现读（带短缓存）——改了就生效；
 *   · 升级依赖后，新版本新加的设置项自动出现在设置页、带着缺省值直接生效；库里存着的、当前版本认不出的键忽略不报错
 *     （所以接入方可以先照着 GitHub 上的新清单把值填好，升级那一刻自动接上）；
 *   · 仓根的 `scholar-meta.manifest.json` 是同一份声明的 JSON（带中英文案，见 manifest.ts），接入方的同步任务从 GitHub 取来与已装版本比对；
 *   · 入口吃一个设置包（`createEvidenceService({ settings })`、`createOpenAlexClient(opts, settings)`）：静态对象、函数或现读设置都行，
 *     后台给了的键 > 代码里的选项 > 缺省值，认不出的键忽略。
 * 方法学门槛（比例的最小分母 30、汇总至少 5 项……）**不做成设置**：那是诚实规则，不是偏好。
 */
import type { EvidencePluginSecretDef, EvidenceSettingDef, EvidenceSettingIssue, EvidenceSettingKey, EvidenceSettings } from './types'
import { MACHINE_BINDING_POLICIES } from './tags'

const V = '0.2.0'
const DEFS: Record<EvidenceSettingKey, Omit<EvidenceSettingDef, 'key'>> = {
  'binding.machinePolicy': { group: 'binding', type: 'enum', options: MACHINE_BINDING_POLICIES, default: 'first_hit', unit: null, since: V, apply: 'live', scope: 'server' },
  'external.gate': { group: 'external', type: 'enum', options: ['onsite_tags_only', 'any'], default: 'onsite_tags_only', unit: null, since: V, apply: 'live', scope: 'server' },
  'external.dailyCreditBudget': { group: 'external', type: 'integer', min: 0, max: 10_000_000, default: 5000, unit: 'credits', since: V, apply: 'live', scope: 'server' },
  'external.sampleSize': { group: 'external', type: 'integer', min: 1, max: 50, default: 25, unit: 'items', since: V, apply: 'live', scope: 'server' },
  'external.maxReferenceDois': { group: 'external', type: 'integer', min: 0, max: 1000, default: 200, unit: 'items', since: V, apply: 'live', scope: 'server' },
  'cache.resolveDays': { group: 'cache', type: 'integer', min: 0, max: 365, default: 30, unit: 'days', since: V, apply: 'live', scope: 'server' },
  'cache.bundleDays': { group: 'cache', type: 'integer', min: 0, max: 365, default: 30, unit: 'days', since: V, apply: 'live', scope: 'server' },
  'cache.sampleDays': { group: 'cache', type: 'integer', min: 0, max: 365, default: 7, unit: 'days', since: V, apply: 'live', scope: 'server' },
  'cache.countsDays': { group: 'cache', type: 'integer', min: 0, max: 365, default: 7, unit: 'days', since: V, apply: 'live', scope: 'server' },
  'onsite.label': { group: 'onsite', type: 'string', maxLength: 100, default: 'On-site articles', unit: null, since: V, apply: 'live', scope: 'public' },
  'onsite.license': { group: 'onsite', type: 'string', maxLength: 100, default: 'unspecified', unit: null, since: V, apply: 'live', scope: 'public' },
  'graph.minSupport': { group: 'graph', type: 'integer', min: 1, max: 50, default: 2, unit: 'items', since: V, apply: 'live', scope: 'public' },
  'graph.maxNodes': { group: 'graph', type: 'integer', min: 1, max: 200, default: 60, unit: 'items', since: V, apply: 'live', scope: 'public' },
  'http.cacheMaxAge': { group: 'http', type: 'integer', min: 0, max: 86_400, default: 300, unit: 'seconds', since: V, apply: 'live', scope: 'server' },
  'http.route.map': { group: 'http', type: 'boolean', default: true, unit: null, since: V, apply: 'live', scope: 'server' },
  'http.route.counts': { group: 'http', type: 'boolean', default: true, unit: null, since: V, apply: 'live', scope: 'server' },
  'http.route.tagCounts': { group: 'http', type: 'boolean', default: true, unit: null, since: V, apply: 'live', scope: 'server' },
  'http.route.tagGraph': { group: 'http', type: 'boolean', default: true, unit: null, since: V, apply: 'live', scope: 'server' },
  'ledger.modelMinConfidence': { group: 'ledger', type: 'integer', min: 0, max: 100, default: 50, unit: 'percent', since: V, apply: 'live', scope: 'server' },
  'ledger.reviewTier': { group: 'ledger', type: 'enum', options: ['maintainer', 'editor', 'contributor'], default: 'editor', unit: null, since: V, apply: 'live', scope: 'server' },
  'ledger.apply': { group: 'ledger', type: 'enum', options: ['merge', 'ledger_only', 'off'], default: 'merge', unit: null, since: V, apply: 'live', scope: 'server' },
}

/** 标签账本的策略取自设置（给 `createTagLedger({ policy: () => ledgerPolicyFromSettings(live.peek().values) })` 用）。 */
export function ledgerPolicyFromSettings(values: EvidenceSettings): { modelMinConfidence: number; reviewTier: EvidenceSettings['ledger.reviewTier'] } {
  return { modelMinConfidence: values['ledger.modelMinConfidence'] / 100, reviewTier: values['ledger.reviewTier'] }
}

/** 设置项注册表（顺序＝设置页上的顺序）。加一个设置＝在 `EvidenceSettings`（契约）与这里各加一行 + 词典加文案。 */
export const EVIDENCE_SETTINGS: readonly EvidenceSettingDef[] = (Object.keys(DEFS) as EvidenceSettingKey[]).map((key) => ({ key, ...DEFS[key] }))

export function defaultSettings(): EvidenceSettings {
  return Object.fromEntries(EVIDENCE_SETTINGS.map((d) => [d.key, d.default])) as unknown as EvidenceSettings
}

export interface ValidatedSettings {
  /** 全部键都有值（没给的、不合法的用缺省值） */
  values: EvidenceSettings
  /** 只含输入里给了、而且合法的键（服务据此决定是否覆盖代码里的选项） */
  provided: Partial<EvidenceSettings>
  issues: EvidenceSettingIssue[]
}

function coerce(def: EvidenceSettingDef, raw: unknown): { ok: true; value: string | number | boolean } | { ok: false; code: EvidenceSettingIssue['code'] } {
  switch (def.type) {
    case 'enum':
      return typeof raw === 'string' && def.options!.includes(raw) ? { ok: true, value: raw } : { ok: false, code: typeof raw === 'string' ? 'not_an_option' : 'wrong_type' }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw) ? Number(raw) : NaN
      if (!Number.isInteger(n)) return { ok: false, code: 'wrong_type' }
      return n >= (def.min ?? -Infinity) && n <= (def.max ?? Infinity) ? { ok: true, value: n } : { ok: false, code: 'out_of_range' }
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      return raw === 'true' || raw === 'false' ? { ok: true, value: raw === 'true' } : { ok: false, code: 'wrong_type' }
    case 'string': {
      if (typeof raw !== 'string') return { ok: false, code: 'wrong_type' }
      const s = raw.trim()
      return s.length <= (def.maxLength ?? Infinity) ? { ok: true, value: s } : { ok: false, code: 'too_long' }
    }
  }
}

/** 验值：认不出的键忽略、不合法的值退回缺省值，都记一条问题；从不抛。 */
export function validateSettings(input: unknown): ValidatedSettings {
  const values = defaultSettings() as unknown as Record<string, unknown>
  const provided: Record<string, unknown> = {}
  const issues: EvidenceSettingIssue[] = []
  if (input === undefined || input === null) return { values: values as unknown as EvidenceSettings, provided: {}, issues }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { values: values as unknown as EvidenceSettings, provided: {}, issues: [{ key: '*', code: 'not_an_object' }] }
  }
  const byKey = new Map(EVIDENCE_SETTINGS.map((d) => [d.key as string, d]))
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const def = byKey.get(key)
    if (!def) { issues.push({ key, code: 'unknown_key' }); continue }
    if (raw === undefined || raw === null) continue
    const r = coerce(def, raw)
    if (r.ok) { values[key] = r.value; provided[key] = r.value } else issues.push({ key, code: r.code })
  }
  return { values: values as unknown as EvidenceSettings, provided: provided as Partial<EvidenceSettings>, issues }
}

/** 现读的设置：每次 `get()` 最多每 `ttlMs` 读一次库（缺省 10 秒）；读库失败沿用上一次的值并记日志。 */
export interface LiveSettings {
  get(): Promise<ValidatedSettings>
  /** 同步取最近一次的结果（还没读过时是全缺省）——给必须同步取值的地方用，比如外部源的每日预算 */
  peek(): ValidatedSettings
  /** 立刻重读（后台保存设置之后调一下，不用等缓存过期） */
  refresh(): Promise<ValidatedSettings>
}

export function createLiveSettings(
  provider: () => unknown | Promise<unknown>,
  opts: { ttlMs?: number; now?: () => number; log?: (message: string, detail: Record<string, unknown>) => void } = {},
): LiveSettings {
  const ttl = Math.max(0, opts.ttlMs ?? 10_000)
  const now = opts.now ?? (() => Date.now())
  const log = opts.log ?? ((m: string, d: Record<string, unknown>) => console.error(m, d))
  let last: ValidatedSettings = validateSettings(undefined)
  let at = -Infinity
  let pending: Promise<ValidatedSettings> | null = null
  const load = (): Promise<ValidatedSettings> => {
    if (pending) return pending
    pending = (async () => {
      try {
        last = validateSettings(await provider())
        if (last.issues.length > 0) log('[evidence.settings] invalid or unknown settings', { issues: last.issues.length })
      } catch (e) {
        log('[evidence.settings] provider failed, keeping last values', { error: e instanceof Error ? e.message : String(e) })
      } finally {
        at = now()
        pending = null
      }
      return last
    })()
    return pending
  }
  return {
    get: () => (now() - at < ttl ? Promise.resolve(last) : load()),
    peek: () => last,
    refresh: () => load(),
  }
}

export function isLiveSettings(x: unknown): x is LiveSettings {
  return !!x && typeof x === 'object' && typeof (x as LiveSettings).get === 'function' && typeof (x as LiveSettings).peek === 'function'
}

/** 插件要用的密钥（不是设置值：值只在接入方的环境变量里，后台只显示配没配）。 */
export const EVIDENCE_PLUGIN_SECRETS: readonly EvidencePluginSecretDef[] = [
  { key: 'external.apiKey', env: 'OPENALEX_API_KEY', required: false, entry: 'scholar-meta/openalex', option: 'apiKey' },
]

/** 入口吃的设置包：静态对象（验一次）、函数（每次调用现取现验）、`createLiveSettings` 的结果（取最近一次，不等待）。 */
export type SettingsInput = LiveSettings | (() => unknown) | Partial<EvidenceSettings> | Readonly<Record<string, unknown>>

/**
 * 把设置包变成「现在的设置」的同步读取函数；没给 ⇒ null。从不抛错（验值失败的键用缺省值、记在 issues 里）。
 * 现读设置：回最近一次的值，过期了顺手在后台重读（不等待）；能等的调用方（异步路径）直接 `await live.get()`。
 */
export function settingsReader(input: SettingsInput | null | undefined): (() => ValidatedSettings) | null {
  if (input === null || input === undefined) return null
  if (isLiveSettings(input)) {
    return () => {
      void input.get() // 过期才会真的去读；读失败保留旧值，不会抛
      return input.peek()
    }
  }
  if (typeof input === 'function') {
    const fn = input as () => unknown
    return () => {
      try { return validateSettings(fn()) } catch { return validateSettings(undefined) }
    }
  }
  const fixed = validateSettings(input)
  return () => fixed
}
