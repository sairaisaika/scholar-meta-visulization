/**
 * 社区记录的两条共用规则（内部模块，不从任何入口导出）：服务层 `tags_and_records` 与 `mergeCommunityRecords` 都走这里，
 * 所以「社区作品怎样变成记录」「同一篇怎样去重」只有一份。
 */
import type { EvidenceRecord } from './types'
import { intakeArticles } from './onsite'
import { recordTagKeys } from './tags'
import { normalizeDoi } from './doi'

/**
 * 社区作品行（站内文章端口同形）→ 记录。验形与站内文章同一套（`intakeArticles`），来源记为 community。
 * `tagKeys` 给了就只留带这些标签键的（服务层：端口可以是任何实现）；null ⇒ 不再过滤（调用方已按导出里的 tag_key 挑过）。
 */
export function communityRecordsFromRows(
  rows: readonly unknown[],
  source: { label: string; license: string; retrieved_at: string },
  tagKeys: readonly string[] | null,
): { records: EvidenceRecord[]; issues: number } {
  const out = intakeArticles(rows, { source: 'community', source_label: source.label, license: source.license, retrieved_at: source.retrieved_at })
  if (tagKeys === null) return { records: out.records, issues: out.issues.length }
  const want = new Set(tagKeys)
  return { records: out.records.filter((r) => recordTagKeys(r).some((k) => want.has(k))), issues: out.issues.length }
}

/**
 * 外部示例里与社区记录同一篇的丢掉：同 DOI（两边都归一）或同 OpenAlex 编号（社区记录 id 形如 `community:openalex:W…`）。
 * 同一篇只出现一次，留社区那条——它带着人抄的字段。
 */
export function dropExternalDuplicates(external: readonly EvidenceRecord[], community: readonly EvidenceRecord[]): EvidenceRecord[] {
  if (community.length === 0) return [...external]
  const keys = new Set<string>()
  for (const r of community) {
    const d = normalizeDoi(r.doi)
    if (d) keys.add(`doi:${d}`)
    const m = /^community:(openalex:w\d+)/i.exec(r.id)
    if (m) keys.add(m[1]!.toLowerCase())
  }
  return external.filter((r) => {
    const d = normalizeDoi(r.doi)
    return !(d && keys.has(`doi:${d}`)) && !keys.has(r.id.toLowerCase())
  })
}
