/**
 * 读者侧筛选——对 `EvidenceMapData` 做**减法**的纯函数：返回新对象，绝不改入参。
 * ─────────────────────────────────────────────────────────────────────────────
 * 两个开关，都是「只看…」：
 *   · `onlyOnsite`：只看站内——外部记录去掉，外部树也不画（兄弟 → `[]`、上级 → `null`）。
 *     `onsite_only` / `external_match` **不动**：它们说的是「外部层这次接没接上」，不是读者选了什么，两件事不许混。
 *   · `onlyOa`：只看开放获取——外部记录里 `is_open_access !== true` 的去掉。`null`（不知道）也去掉：
 *     标称 OA 尚且 ≠ 点开能读（dimensions.ts `oa_nominal`），「不知道」更不能当 OA 画。站内记录一律保留（站内文章本来就公开可读）。
 * 边随记录走：两端都还在筛后 `records` 里（或一端是焦点）才留，不留悬空的半条边。
 * 视图结论、汇总判定与汇总估计按筛后记录**重算**（ladder.ts 同一判据）——视图是数据的函数，记录变了结论不能还是老的。
 * 零 IO 零框架：服务端、浏览器、移动端都可以原样吃这一份。
 */
import type { EvidenceMapData, EvidenceRecord } from './types'
import { pickEvidenceView, poolEvidence } from './ladder'

export interface EvidenceFilters {
  /** 只看站内记录；外部树（上级 / 兄弟）一并不画 */
  onlyOnsite: boolean
  /** 只看开放获取；站内记录不受影响 */
  onlyOa: boolean
}

const keepRecord = (r: EvidenceRecord, f: EvidenceFilters): boolean => {
  if (r.source === 'onsite') return true
  if (f.onlyOnsite) return false
  if (f.onlyOa && r.is_open_access !== true) return false
  return true
}

export function applyEvidenceFilters(data: EvidenceMapData, f: EvidenceFilters): EvidenceMapData {
  const records = data.records.filter((r) => keepRecord(r, f))
  const alive = new Set(records.map((r) => r.id))
  if (data.focus) alive.add(data.focus.id)
  const out: EvidenceMapData = {
    ...data,
    parent: f.onlyOnsite ? null : data.parent,
    siblings: f.onlyOnsite ? [] : data.siblings,
    records,
    view: pickEvidenceView(records),
    pooling: poolEvidence(records), // 连汇总估计一起按筛后记录重算（与服务端同一个函数）
  }
  if (data.edges) out.edges = data.edges.filter((e) => alive.has(e.from) && alive.has(e.to))
  return out
}
