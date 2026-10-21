// 有界、无重试的合约探针；只保存白名单头和形状，绝不保存密钥、正文或 meta.notice。
import { writeFileSync } from 'node:fs'

const cases = [
  ['topic', '/topics/T10537', j => typeof j.id === 'string'],
  ['list-100', '/topics?filter=subfield.id:2738&select=id,display_name,works_count&per_page=100', j => Array.isArray(j.results) && j.meta?.per_page === 100],
  ['list-page-2', '/topics?filter=subfield.id:2738&select=id&per_page=1&page=2', j => Array.isArray(j.results) && j.meta?.page === 2],
  ['doi-or', '/works?filter=doi:10.1136/bmj.n71|10.1371/journal.pone.0010068&select=id,doi,primary_topic&per_page=50', j => Array.isArray(j.results) && j.results.length === 2 && j.results.every(r => typeof r.doi === 'string')],
  ['groups-200', '/works?filter=primary_topic.id:T10537&group_by=type&per_page=200', j => Array.isArray(j.group_by) && j.group_by.length > 0],
  ['invalid-filter', '/works?filter=not_a_real_field:yes&per_page=1', j => typeof j.error === 'string'],
]
const report = { observed_at: new Date().toISOString(), authentication: process.env.OPENALEX_API_KEY ? 'injected-bearer' : 'anonymous', max_requests: cases.length, retries: 0, observed_credits: 0, results: [] }
for (const [id, path, shape] of cases) {
  try {
    const key = process.env.OPENALEX_API_KEY?.trim()
    const r = await fetch(`https://api.openalex.org${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(12000) })
    const headers = Object.fromEntries(['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-credits-used', 'x-ratelimit-cost-usd', 'x-ratelimit-reset', 'retry-after'].map(k => [k, r.headers.get(k)]))
    const credits = Number(headers['x-ratelimit-credits-used'])
    if (Number.isFinite(credits) && credits > 0) report.observed_credits += credits
    const j = await r.json().catch(() => null)
    report.results.push({ id, path, status: r.status, headers, passed: r.status === (id === 'invalid-filter' ? 400 : 200) && j !== null && shape(j), rows: Array.isArray(j?.results) ? j.results.length : null, groups: Array.isArray(j?.group_by) ? j.group_by.length : null })
    if (r.status === 429 || r.status === 401 || r.status === 403) break
  } catch {
    report.results.push({ id, path, passed: false, error: 'transport_or_timeout' })
    break
  }
}
report.passed = report.results.length === cases.length && report.results.every(r => r.passed)
const output = process.argv[2]
if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
