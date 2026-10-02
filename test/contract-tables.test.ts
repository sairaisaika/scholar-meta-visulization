/**
 * 契约的运行时常量表必须「齐」：联合类型加了成员而表忘了加，`pnpm typecheck` 当场红（不只证明「是子集」）。
 * 接入方拿这些表遍历文案、做运行时校验；表漏一个成员，那类检查就静默少查一项。
 * 由表派生联合的（`type X = (typeof LIST)[number]`）天然齐，这里只钉「先有联合、后有表」的那些。
 */
import * as contract from '../src/types'
import type {
  EvidenceChartBlocker, EvidenceCountScope, EvidenceDenominatorKind, EvidenceDirection, EvidenceDowngradeReason, EvidenceEffectMetric,
  EvidenceExternalMatch, EvidencePoolingReason, EvidenceSelfReportedClaim, EvidenceTagBindingKind, EvidenceViewKind,
} from '../src/types'
import { BINDING_BADGES, type BindingBadge } from '../src/messages'
import { EXTERNAL_LEVELS, type ExternalLevel } from '../src/ports'
import { SHARE_RELIABILITIES, type ShareReliability } from '../src/stats'
import { MACHINE_BINDING_POLICIES, type MachineBindingPolicy } from '../src/tags'

/** 表里缺了联合的哪个成员（缺了 ⇒ 不是 never ⇒ 下面赋 true 报错，并在报错里写出缺的值） */
type Missing<Table extends readonly unknown[], U> = Exclude<U, Table[number]>
type Complete<Table extends readonly unknown[], U> = [Missing<Table, U>] extends [never] ? true : { missing: Missing<Table, U> }

const complete: {
  EVIDENCE_EFFECT_METRICS: Complete<typeof contract.EVIDENCE_EFFECT_METRICS, EvidenceEffectMetric>
  EVIDENCE_DIRECTIONS: Complete<typeof contract.EVIDENCE_DIRECTIONS, EvidenceDirection>
  EVIDENCE_SELF_REPORTED_CLAIMS: Complete<typeof contract.EVIDENCE_SELF_REPORTED_CLAIMS, EvidenceSelfReportedClaim>
  EVIDENCE_DOWNGRADE_REASONS: Complete<typeof contract.EVIDENCE_DOWNGRADE_REASONS, EvidenceDowngradeReason>
  EVIDENCE_POOLING_REASONS: Complete<typeof contract.EVIDENCE_POOLING_REASONS, EvidencePoolingReason>
  EVIDENCE_EXTERNAL_MATCHES: Complete<typeof contract.EVIDENCE_EXTERNAL_MATCHES, EvidenceExternalMatch>
  EVIDENCE_TAG_BINDING_KINDS: Complete<typeof contract.EVIDENCE_TAG_BINDING_KINDS, EvidenceTagBindingKind>
  EVIDENCE_COUNT_SCOPES: Complete<typeof contract.EVIDENCE_COUNT_SCOPES, EvidenceCountScope>
  EVIDENCE_DENOMINATOR_KINDS: Complete<typeof contract.EVIDENCE_DENOMINATOR_KINDS, EvidenceDenominatorKind>
  EVIDENCE_CHART_BLOCKERS: Complete<typeof contract.EVIDENCE_CHART_BLOCKERS, EvidenceChartBlocker>
  BINDING_BADGES: Complete<typeof BINDING_BADGES, BindingBadge>
  EXTERNAL_LEVELS: Complete<typeof EXTERNAL_LEVELS, ExternalLevel>
  SHARE_RELIABILITIES: Complete<typeof SHARE_RELIABILITIES, ShareReliability>
  MACHINE_BINDING_POLICIES: Complete<typeof MACHINE_BINDING_POLICIES, MachineBindingPolicy>
} = {
  EVIDENCE_EFFECT_METRICS: true,
  EVIDENCE_DIRECTIONS: true,
  EVIDENCE_SELF_REPORTED_CLAIMS: true,
  EVIDENCE_DOWNGRADE_REASONS: true,
  EVIDENCE_POOLING_REASONS: true,
  EVIDENCE_EXTERNAL_MATCHES: true,
  EVIDENCE_TAG_BINDING_KINDS: true,
  EVIDENCE_COUNT_SCOPES: true,
  EVIDENCE_DENOMINATOR_KINDS: true,
  EVIDENCE_CHART_BLOCKERS: true,
  BINDING_BADGES: true,
  EXTERNAL_LEVELS: true,
  SHARE_RELIABILITIES: true,
  MACHINE_BINDING_POLICIES: true,
}

/** 阶梯表声明成 `readonly EvidenceViewKind[]`，类型上看不出齐不齐：用一张必须写全的对象字面量对照 */
const ALL_VIEW_KINDS: Record<EvidenceViewKind, true> = { forest: true, estimates: true, albatross: true, direction: true, gap_map: true }

describe('契约常量表', () => {
  it('先有联合、后有表的那些：编译期已核对齐（这里只确认核对表本身没有被删）', () => {
    expect(Object.values(complete).every((v) => v === true)).toBe(true)
    expect(Object.keys(complete)).toHaveLength(14)
  })
  it('视图阶梯表覆盖全部视图种类', () => {
    expect([...contract.EVIDENCE_VIEW_LADDER].sort()).toEqual(Object.keys(ALL_VIEW_KINDS).sort())
  })
  it('每张表都没有重复值', () => {
    const tables = Object.entries({ ...contract, BINDING_BADGES, EXTERNAL_LEVELS, SHARE_RELIABILITIES, MACHINE_BINDING_POLICIES })
      .filter(([name, v]) => /^[A-Z_]+$/.test(name) && Array.isArray(v)) as Array<[string, readonly unknown[]]>
    expect(tables.length).toBeGreaterThan(20)
    for (const [name, list] of tables) expect([name, new Set(list).size]).toEqual([name, list.length])
  })
})
