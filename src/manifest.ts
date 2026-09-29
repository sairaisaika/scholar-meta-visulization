/**
 * 插件清单——设置项注册表与功能登记表的 JSON 形态（纯函数；主入口导出）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 构建时写进仓根的 `scholar-meta.manifest.json`（`pnpm check` 核对它与源码一致），与代码随同一个提交到。
 * 接入方的同步任务取来后用 `diffPluginManifests` 与已装版本比对：升级之前就看到会多出 / 少掉哪些设置与功能。
 * 密钥不是设置值：清单的 `secrets` 只说「要哪个密钥、建议放在哪个环境变量」，值永远不进库、不进表单、不进清单。
 */
import type { EvidenceManifestDiff, EvidencePluginManifest } from './types'
import { EVIDENCE_CONTRACT_VERSION } from './types'
import { EVIDENCE_MESSAGES } from './messages'
import { EVIDENCE_FEATURES } from './features'
import { EVIDENCE_CLIENT_ROUTES } from './client'
import { EVIDENCE_PLUGIN_SECRETS, EVIDENCE_SETTINGS } from './settings'

export const PLUGIN_REPOSITORY = 'https://github.com/sairaisaika/scholar-meta-visulization'

/** 生成插件清单（构建时写进仓根的 scholar-meta.manifest.json；`pnpm check` 核对它与源码一致）。 */
export function buildPluginManifest(input: { version: string; repository?: string }): EvidencePluginManifest {
  const repository = input.repository ?? PLUGIN_REPOSITORY
  return {
    manifest_version: 1,
    id: 'scholar-meta',
    version: input.version,
    contract_version: EVIDENCE_CONTRACT_VERSION,
    repository,
    changelog: 'CHANGELOG.md',
    entries: ['scholar-meta', 'scholar-meta/client', 'scholar-meta/service', 'scholar-meta/http', 'scholar-meta/openalex'],
    routes: { ...EVIDENCE_CLIENT_ROUTES },
    features: EVIDENCE_FEATURES.map((f) => ({ id: f.id, audience: f.audience, route: f.route })),
    settings: EVIDENCE_SETTINGS.map((d) => {
      const zh = EVIDENCE_MESSAGES.zh.setting[d.key]
      const en = EVIDENCE_MESSAGES.en.setting[d.key]
      return {
        ...d,
        ...(d.options ? { options: [...d.options] } : {}),
        label: { zh: zh.label, en: en.label },
        help: { zh: zh.help, en: en.help },
        ...(zh.options && en.options ? { option_labels: { zh: { ...zh.options }, en: { ...en.options } } } : {}),
      }
    }),
    secrets: EVIDENCE_PLUGIN_SECRETS.map((s) => ({
      ...s,
      label: { zh: EVIDENCE_MESSAGES.zh.pluginSecret[s.key].label, en: EVIDENCE_MESSAGES.en.pluginSecret[s.key].label },
      help: { zh: EVIDENCE_MESSAGES.zh.pluginSecret[s.key].help, en: EVIDENCE_MESSAGES.en.pluginSecret[s.key].help },
    })),
  }
}

const DIFF_FIELDS = ['group', 'type', 'default', 'options', 'min', 'max', 'maxLength', 'unit', 'apply', 'scope'] as const

/** 已安装的清单 → 最新的清单：多了 / 少了哪些设置与功能，同名设置哪些字段变了（后台「同步」页用）。 */
export function diffPluginManifests(installed: EvidencePluginManifest, latest: EvidencePluginManifest): EvidenceManifestDiff {
  const a = new Map(installed.settings.map((s) => [s.key as string, s]))
  const b = new Map(latest.settings.map((s) => [s.key as string, s]))
  const fa = new Set(installed.features.map((f) => f.id))
  const fb = new Set(latest.features.map((f) => f.id))
  const changed: EvidenceManifestDiff['settings_changed'] = []
  for (const [key, s] of b) {
    const old = a.get(key)
    if (!old) continue
    const o = old as unknown as Record<string, unknown>
    const n = s as unknown as Record<string, unknown>
    const fields = DIFF_FIELDS.filter((f) => JSON.stringify(o[f]) !== JSON.stringify(n[f]))
    if (fields.length > 0) changed.push({ key, fields: [...fields] })
  }
  return {
    from: installed.version,
    to: latest.version,
    contract_changed: installed.contract_version !== latest.contract_version,
    settings_added: [...b.keys()].filter((k) => !a.has(k)),
    settings_removed: [...a.keys()].filter((k) => !b.has(k)),
    settings_changed: changed,
    features_added: [...fb].filter((k) => !fa.has(k)),
    features_removed: [...fa].filter((k) => !fb.has(k)),
  }
}
