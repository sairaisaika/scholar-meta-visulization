/**
 * 偏倚风险与证据确定性——**引擎不评**，只核形状、如实转述、按成文的规则用（纯函数、零 IO）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 评偏倚风险要读全文、按工具逐个领域判断；评证据确定性要看整组研究、按结局判断。这两件事都要有资质的人做，
 * 引擎做不了、也不该假装能做。所以：
 *   · 评好的结果由接入方传进来（站内文章的 `risk_of_bias`、服务层的 `CertaintySource`、或直接交给 present.ts）；
 *   · 引擎核形状——判断必须是这种工具的档位，**必须写明是谁评的**（读者有权知道判断从哪来）；
 *   · 引擎只在两处用它：图上逐项标出（文字永远印工具自己的判断）；汇总时另给一个去掉高风险研究的敏感性分析
 *     （`poolEvidence` 的 `sensitivity`，主分析不变，Cochrane Handbook v6.5 §10.14）。
 * 没评过 ≠ 低风险：没评过的标「未评估」，不参与敏感性分析的排除。
 */
import type {
  EvidenceCertainty, EvidenceCertaintyDowngrade, EvidenceCertaintyLevel, EvidenceCertaintyUpgrade, EvidenceIntakeIssue, EvidenceRecord,
  EvidenceRiskOfBias, EvidenceRobJudgement, EvidenceRobTool,
} from './types'
import {
  EVIDENCE_CERTAINTY_DOWNGRADES, EVIDENCE_CERTAINTY_LEVELS, EVIDENCE_CERTAINTY_UPGRADES, EVIDENCE_ROB_SCALES, EVIDENCE_ROB_TOOLS,
} from './types'
import { safeHttpUrl } from './url'

/** 「谁评的」「哪个结局」这类说明文字的长度上限（再长就截断，界面放不下，也不该放整段话） */
export const APPRAISAL_TEXT_MAX = 200

// ── 偏倚风险 ─────────────────────────────────────────────────────────────────

/**
 * 跨工具对齐的风险档，只用来取颜色、做计数（文字永远印工具自己的判断）：
 * `low` 低 · `concerns` RoB 2「一些担忧」/ ROBINS-I「中等」· `high` RoB 2「高」/ ROBINS-I「严重」· `critical` ROBINS-I「极严重」·
 * `unknown` 评了但信息不足、判断不了。
 */
export const EVIDENCE_ROB_BANDS = ['low', 'concerns', 'high', 'critical', 'unknown'] as const
export type EvidenceRobBand = (typeof EVIDENCE_ROB_BANDS)[number]

const BAND: { readonly [T in EvidenceRobTool]: Partial<Record<EvidenceRobJudgement, EvidenceRobBand>> } = {
  rob2: { low: 'low', some_concerns: 'concerns', high: 'high' },
  robins_i: { low: 'low', moderate: 'concerns', serious: 'high', critical: 'critical', no_information: 'unknown' },
  other: { low: 'low', some_concerns: 'concerns', high: 'high', unclear: 'unknown' },
}

/** 风险档；没评过（或形状不对）⇒ null——**不是** `low`。 */
export function robBand(rob: EvidenceRiskOfBias | null | undefined): EvidenceRobBand | null {
  if (!rob) return null
  return BAND[rob.tool]?.[rob.overall] ?? null
}

/** 敏感性分析要去掉的：RoB 2「高」、ROBINS-I「严重」「极严重」、其他工具「高」。没评过的不去掉。 */
export function isHighRiskOfBias(rob: EvidenceRiskOfBias | null | undefined): boolean {
  const b = robBand(rob)
  return b === 'high' || b === 'critical'
}

const str = (x: unknown): string | null => {
  if (typeof x !== 'string') return null
  const s = x.trim()
  return s.length === 0 ? null : s.length > APPRAISAL_TEXT_MAX ? `${s.slice(0, APPRAISAL_TEXT_MAX - 1)}…` : s
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** 工具名宽松地认：`RoB 2`、`rob-2`、`ROBINS-I`、`robins_i` 都行（去掉非字母数字后比较）。 */
const TOOL_BY_KEY: Readonly<Record<string, EvidenceRobTool>> = Object.fromEntries(EVIDENCE_ROB_TOOLS.map((t) => [t.replace(/[^a-z0-9]/g, ''), t]))
const toolOf = (x: unknown): EvidenceRobTool | null =>
  typeof x === 'string' ? TOOL_BY_KEY[x.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null : null
/** 判断宽松地认：`Some concerns`、`some-concerns`、`no information` 都行。 */
const judgementOf = (tool: EvidenceRobTool, x: unknown): EvidenceRobJudgement | null => {
  if (typeof x !== 'string') return null
  const v = x.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (EVIDENCE_ROB_SCALES[tool] as readonly string[]).includes(v) ? (v as EvidenceRobJudgement) : null
}

/**
 * 接入方给的偏倚风险 → 契约形状（或 null）+ 至多一条问题。没给 ⇒ `{ value: null, issue: null }`。
 * 工具认不出、判断不是这种工具的档位、没写是谁评的 ⇒ 整条不收，问题说清楚是哪一样。
 */
export function checkRiskOfBias(raw: unknown, field = 'risk_of_bias'): { value: EvidenceRiskOfBias | null; issue: EvidenceIntakeIssue | null } {
  if (raw === undefined || raw === null) return { value: null, issue: null }
  const cleared = (code: EvidenceIntakeIssue['code'], f: string) => ({ value: null, issue: { code, field: f, action: 'field_cleared' as const } })
  if (!isObj(raw)) return cleared('unknown_rob_tool', field)
  const tool = toolOf(raw.tool)
  if (!tool) return cleared('unknown_rob_tool', `${field}.tool`)
  const overall = judgementOf(tool, raw.overall)
  if (!overall) return cleared('rob_judgement_invalid', `${field}.overall`)
  const source = str(raw.source)
  if (!source) return cleared('rob_source_missing', `${field}.source`)
  return { value: { tool, overall, source }, issue: null }
}

/** 已经是契约形状、而且判断与工具对得上、写了是谁评的（自己拼记录的接入方用来自查）。 */
export function isValidRiskOfBias(x: unknown): x is EvidenceRiskOfBias {
  return isObj(x) && typeof x.tool === 'string' && (EVIDENCE_ROB_TOOLS as readonly string[]).includes(x.tool)
    && typeof x.overall === 'string' && (EVIDENCE_ROB_SCALES[x.tool as EvidenceRobTool] as readonly string[]).includes(x.overall)
    && typeof x.source === 'string' && x.source.trim().length > 0
}

/** 一批记录的偏倚风险概况：评过几项、各档几项、用了哪些工具。 */
export interface EvidenceRobSummary {
  total: number
  assessed: number
  by_band: Record<EvidenceRobBand, number>
  /** 用到的工具，按 `EVIDENCE_ROB_TOOLS` 的顺序 */
  tools: EvidenceRobTool[]
}

export function summarizeRiskOfBias(records: readonly EvidenceRecord[]): EvidenceRobSummary {
  const by_band = Object.fromEntries(EVIDENCE_ROB_BANDS.map((b) => [b, 0])) as Record<EvidenceRobBand, number>
  const used = new Set<EvidenceRobTool>()
  let assessed = 0
  for (const r of records) {
    const b = robBand(r.risk_of_bias)
    if (!b) continue
    assessed++
    by_band[b]++
    used.add(r.risk_of_bias!.tool)
  }
  return { total: records.length, assessed, by_band, tools: EVIDENCE_ROB_TOOLS.filter((t) => used.has(t)) }
}

// ── 证据确定性 ───────────────────────────────────────────────────────────────

const inList = <T extends string>(list: readonly T[], x: unknown): T | null => {
  if (typeof x !== 'string') return null
  const v = x.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return (list as readonly string[]).includes(v) ? (v as T) : null
}
const uniqueIn = <T extends string>(list: readonly T[], xs: unknown): T[] => {
  if (!Array.isArray(xs)) return []
  const got = new Set(xs.map((x) => inList(list, x)).filter((x): x is T => x !== null))
  return list.filter((x) => got.has(x))
}

/**
 * 接入方给的一条证据确定性评级 → 契约形状；等级认不出、没写结局、没写是谁评的 ⇒ null（整条不用）。
 * 降级 / 升级理由只留认得出的，去重并按 GRADE 的固定顺序排；链接只收 http / https。
 */
export function checkCertainty(raw: unknown): EvidenceCertainty | null {
  if (!isObj(raw)) return null
  const level = inList<EvidenceCertaintyLevel>(EVIDENCE_CERTAINTY_LEVELS, raw.level)
  const outcome = str(raw.outcome)
  const source = str(raw.source)
  if (!level || !outcome || !source) return null
  const down = uniqueIn<EvidenceCertaintyDowngrade>(EVIDENCE_CERTAINTY_DOWNGRADES, raw.rated_down_for)
  const up = uniqueIn<EvidenceCertaintyUpgrade>(EVIDENCE_CERTAINTY_UPGRADES, raw.rated_up_for)
  return {
    level, outcome, source, url: safeHttpUrl(raw.url),
    ...(down.length > 0 ? { rated_down_for: down } : {}),
    ...(up.length > 0 ? { rated_up_for: up } : {}),
  }
}

/** 一批评级：逐条核，不合格的丢掉；不是数组 ⇒ []。 */
export function checkCertainties(raw: unknown): EvidenceCertainty[] {
  return Array.isArray(raw) ? raw.map(checkCertainty).filter((c): c is EvidenceCertainty => c !== null) : []
}
