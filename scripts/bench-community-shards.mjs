#!/usr/bin/env node
// 宿主分片存储的实测脚本——**一次本机实测，不是容量承诺**；不进 `pnpm check`，数字随机器、Node 版本与数据形状而变。
//
// 比的是同一份合成导出走两条路各花多少：
//   · 整份快照：`refreshCommunityExport` + `mergeCommunityRecords`（快照是一整个 JSON，宿主整份存、整份取）；
//   · 分片存储：`refreshCommunityShards` + `mergeCommunityRecordsFromShards`（内存参考实现 `createMemoryShardStore`，值进出都过一遍 JSON）。
//
// 合成数据（全部确定性，同一组参数每次生成同一份）：
//   · 缺省 2 万篇、256 片（作品键的 sha256 头一个字节定分片，路径 `works/<hh>.jsonl`）；
//   · 每篇 5 个标签：1 个人人都有的大标签 + 4 个从 200 个标签里伪随机抽的。缺省按长尾抽（第 r 个标签的权重 1/r——
//     自由标签的频率本来就是长尾）；加 `--uniform` 改成均匀抽；
//   · 约 5% 的作品带一行两人核验过的结果行与研究设计（能产出带效应量的记录）。
// 不出网：导出文件放在内存里，由假的 `get` 提供；sha256 用 node:crypto。
//
// 用法：pnpm build && node --expose-gc scripts/bench-community-shards.mjs [--works 20000] [--uniform]
//   （不加 --expose-gc 也能跑，只是堆内存那几列更不准。）
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'dist', 'index.mjs')
if (!existsSync(entry)) { console.error('缺 dist/：先跑 `pnpm build`'); process.exit(1) }
const {
  EVIDENCE_CONTRACT_VERSION, DEFAULT_COMMUNITY_POLICY, createMemoryShardStore, mergeCommunityRecords, mergeCommunityRecordsFromShards,
  normalizeTag, readCommunityShards, refreshCommunityExport, refreshCommunityShards,
} = await import(pathToFileURL(entry).href)

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback }
const WORKS = arg('works', 20_000)
const UNIFORM = process.argv.includes('--uniform')
const POOL = 200
const AT = '2026-11-23T00:00:00Z'
const BASE = 'https://example.org/export/v1'
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex')
const bytes = (t) => Buffer.byteLength(t, 'utf8')

// ── 合成数据 ─────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const BIG = 'Mental health'
const poolLabel = (r) => `Topic ${String(r).padStart(3, '0')}`
const cumulative = []
{ let sum = 0; for (let r = 1; r <= POOL; r++) { sum += UNIFORM ? 1 : 1 / r; cumulative.push(sum) } }
const drawRank = (rng) => {
  const x = rng() * cumulative[POOL - 1]
  let lo = 0
  let hi = POOL - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] >= x) hi = mid; else lo = mid + 1 }
  return lo + 1
}
const quorum = { n: 2, add: 2, remove: 0, unsure: 0, challengers: 0, challenged: false, share: 1, ci_low: 0.549, ci_high: 1, z: 1.2816, threshold: 0.5, confidence: 0.8, min_independent: 2 }
const decision = (workId, subject, kind, value, verification) => ({
  work_id: workId, subject, kind, state: 'accepted', decided_by: 'contributor', support: { contributor: { add: 2, remove: 0 } }, quorum,
  verification, re_extractions: verification === 'double' ? 1 : 0, effective_id: null, value, issues: [], last_changed: AT, reasons: [],
})
const tagOf = (label) => ({ tag_key: normalizeTag(label), label, state: 'present', decided_by: 'contributor', support: { contributor: { add: 2, remove: 0 } }, quorum, last_changed: AT, request_id: null })
function makeWork(n, rng) {
  const doi = `10.5555/bench.${n}`
  const id = `doi:${doi}`
  const ranks = new Set()
  while (ranks.size < 4) ranks.add(drawRank(rng))
  const work = {
    work_id: id, aliases: [`openalex:W${1_000_000 + n}`],
    card: {
      id: `openalex:W${1_000_000 + n}`, doi, pmid: null, title: `Synthetic study ${n}: a longitudinal cohort of outcomes after a behavioural programme`, year: 2000 + (n % 26),
      authors: ['A. Author', 'B. Author', 'C. Author', 'D. Author'], venue: { id: `S${n % 500}`, name: `Journal ${n % 500}`, type: 'journal', is_oa: n % 3 === 0, issn_l: null, publisher: null },
      publication_type: 'article', topics: [{ id: `T${n % 90}`, display_name: `Field ${n % 90}` }, { id: `T${(n * 7) % 90}`, display_name: `Field ${(n * 7) % 90}` }],
      keywords: ['cohort', 'follow-up', `keyword ${n % 300}`], mesh: [], abstract: null, language: 'en', cited_by_count: n % 400, is_open_access: n % 3 === 0, oa_url: null, is_retracted: false,
    },
    tags: [tagOf(BIG), ...[...ranks].map((r) => tagOf(poolLabel(r)))], pending: [], facets: {}, rows: [], unsure: 0, updated_at: AT,
  }
  if (n % 20 === 0) {
    work.facets = { design: { value: 'rct', decision: decision(id, 'facet:design', 'facet', 'rct', null), locators: ['Methods'] } }
    work.rows = [{
      row_id: 'o1',
      input: { kind: 'row', context: { row_id: 'o1', outcome: 'Symptom score', comparison: 'programme vs waitlist', population: 'adults', timepoint: '8 weeks', unit: 'pts', analysis: 'unadjusted', kind: 'continuous', locator: 'Table 2' },
        effect: { metric: 'smd', value: -0.2 - (n % 50) / 100, ci_low: -0.9, ci_high: -0.05, n: 100 + (n % 300), p_value: 0.01, higher_is_better: false }, direction: null },
      decision: decision(id, 'row:o1', 'row', null, 'double'),
    }]
  }
  return work
}
const rng = mulberry32(20261123)
const works = Array.from({ length: WORKS }, (_, i) => makeWork(i + 1, rng))
const shardOf = new Map(works.map((w) => [w.work_id, `works/${sha(w.work_id).slice(0, 2)}.jsonl`]))

// ── 假的导出站点 ──────────────────────────────────────────────────────────────────
const files = new Map()
const net = { files: 0, bytes: 0 }
function publish() {
  const byShard = new Map()
  for (const w of works) { const p = shardOf.get(w.work_id); if (!byShard.has(p)) byShard.set(p, []); byShard.get(p).push(w) }
  files.clear()
  const shards = [...byShard.keys()].sort().map((path) => {
    const body = byShard.get(path).map((w) => JSON.stringify(w)).join('\n') + '\n'
    files.set(path, body)
    return { path, bytes: bytes(body), sha256: sha(body), works: byShard.get(path).length }
  })
  files.set('manifest.json', JSON.stringify({
    contract: EVIDENCE_CONTRACT_VERSION, export_version: 1, generated_at: AT, source_commit: null, label: 'Community annotations', license: 'CC0-1.0',
    repository: 'https://example.org/r', policy: DEFAULT_COMMUNITY_POLICY, facet_vocab: {}, concepts_version: '1', maintainers: [], shards,
    counts: { works: works.length, assertions: 0, contributors: 0, accepted: 0, pending: 0, disputed: 0, frames: 0 },
  }))
  for (const name of ['bindings', 'concepts', 'frames']) files.set(`${name}.json`, '[]')
  return shards.length
}
const get = async (url) => {
  touch()
  const body = files.get(url.slice(BASE.length + 1))
  if (body !== undefined) { net.files++; net.bytes += bytes(body) }
  return { status: body === undefined ? 404 : 200, async text() { return body ?? '' } }
}
/** 改 k 篇（各加一个标签）：确定性地挑互不相同的作品 */
let editRound = 0
function edit(k) {
  editRound++
  const pick = mulberry32(1000 + editRound)
  const chosen = new Set()
  while (chosen.size < k) chosen.add(Math.floor(pick() * works.length))
  for (const i of chosen) works[i] = { ...works[i], tags: [...works[i].tags, tagOf(`Edit ${editRound}`)], updated_at: '2026-11-24T00:00:00Z' }
  return new Set([...chosen].map((i) => shardOf.get(works[i].work_id))).size
}

// ── 量：耗时、下载、堆 ─────────────────────────────────────────────────────────────
let peak = 0
function touch() { const h = process.memoryUsage().heapUsed; if (h > peak) peak = h }
const gc = () => { if (typeof globalThis.gc === 'function') globalThis.gc() }
async function measure(f) {
  gc()
  const base = process.memoryUsage().heapUsed
  peak = base
  net.files = 0
  net.bytes = 0
  const t0 = performance.now()
  const value = await f()
  const ms = performance.now() - t0
  touch()
  return { value, ms, files: net.files, bytes: net.bytes, heap: Math.max(0, peak - base) }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
async function timed(f, runs = 7) {
  const ms = []
  let heap = 0
  let value
  for (let i = 0; i < runs; i++) { const m = await measure(f); ms.push(m.ms); heap = Math.max(heap, m.heap); value = m.value }
  return { value, ms: median(ms), heap }
}
const MB = (n) => `${(n / 1048576).toFixed(2)} MB`
const KB = (n) => `${(n / 1024).toFixed(1)} KB`
const MS = (n) => (n >= 100 ? `${n.toFixed(0)} ms` : n >= 1 ? `${n.toFixed(1)} ms` : `${n.toFixed(2)} ms`)
function table(head, rows) {
  const all = [head, ...rows]
  const width = head.map((_, c) => Math.max(...all.map((r) => displayWidth(String(r[c])))))
  const line = (r) => `| ${r.map((x, c) => String(x) + ' '.repeat(width[c] - displayWidth(String(x)))).join(' | ')} |`
  console.log(line(head))
  console.log(`|${width.map((n) => '-'.repeat(n + 2)).join('|')}|`)
  for (const r of rows) console.log(line(r))
  console.log()
}
// 中日韩与全角字符按两格算，表才对得齐
function displayWidth(s) { let n = 0; for (const ch of s) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1; return n }

// 分片存储外面包一层：数写进去多少
const memory = createMemoryShardStore()
const wrote = { index: 0, shards: 0, bytes: 0, deletes: 0 }
let indexBytes = 0
const store = {
  readIndex: async () => { touch(); return memory.readIndex() },
  writeIndex: async (index) => { const n = bytes(JSON.stringify(index)); wrote.index++; wrote.bytes += n; indexBytes = n; touch(); return memory.writeIndex(index) },
  readShard: async (key) => { touch(); const v = await memory.readShard(key); touch(); return v },
  writeShard: async (key, list) => { wrote.shards++; wrote.bytes += bytes(JSON.stringify(list)); touch(); return memory.writeShard(key, list) },
  deleteShard: async (key) => { wrote.deletes++; return memory.deleteShard(key) },
}
const resetWrites = () => { wrote.index = 0; wrote.shards = 0; wrote.bytes = 0; wrote.deletes = 0 }

// ── 跑 ───────────────────────────────────────────────────────────────────────────
const shardCount = publish()
console.log(`宿主分片存储实测（一次本机实测，不是容量承诺）`)
console.log(`Node ${process.version} · ${process.platform}/${process.arch} · 合成导出 ${WORKS} 篇、${shardCount} 片 · 标签 ${UNIFORM ? '均匀' : '长尾（权重 1/r）'}抽样 · 引擎契约 ${EVIDENCE_CONTRACT_VERSION}${typeof globalThis.gc === 'function' ? '' : ' · 没开 --expose-gc，堆内存列更不准'}`)
console.log()

let snapshot = null
let snapshotJson = ''
const refreshRows = []
async function snapshotRefresh(label) {
  const m = await measure(() => refreshCommunityExport({ base: BASE, get, sha256: sha, previous: snapshot, now: () => new Date(AT) }))
  if (m.value.status === 'failed') throw new Error(`整份快照刷新失败：${m.value.reason} ${m.value.path}`)
  let save = { ms: 0 }
  let written = 0
  if (m.value.status === 'updated') {
    snapshot = m.value.snapshot
    save = await measure(() => { snapshotJson = JSON.stringify(snapshot); return null }) // 宿主要把整份快照存下来
    written = bytes(snapshotJson)
  }
  refreshRows.push(['整份快照', label, m.value.status, MS(m.ms + save.ms), m.files, MB(m.bytes), written ? `1 个值 / ${MB(written)}` : '—', MB(Math.max(m.heap, save.heap ?? 0))])
}
async function shardRefresh(label) {
  resetWrites()
  const m = await measure(() => refreshCommunityShards({ base: BASE, get, sha256: sha, store, now: () => new Date(AT) }))
  if (m.value.status === 'failed') throw new Error(`分片存储刷新失败：${m.value.reason} ${m.value.path}`)
  const s = m.value.shards
  refreshRows.push(['分片存储', label, `${m.value.status}（下载 ${s.downloaded} 片、复用 ${s.reused} 片）`, MS(m.ms), m.files, MB(m.bytes),
    wrote.index + wrote.shards ? `${wrote.shards} 片 + 索引 ${wrote.index} 次 / ${MB(wrote.bytes)}` : '—', MB(m.heap)])
}

await snapshotRefresh('全量（首次）')
await shardRefresh('全量（首次）')
await snapshotRefresh('无变化')
await shardRefresh('无变化')
const touched1 = edit(1); publish()
await snapshotRefresh('改 1 篇')
await shardRefresh('改 1 篇')
const touched100 = edit(100); publish()
await snapshotRefresh(`改 100 篇（落在 ${touched100} 片）`)
await shardRefresh(`改 100 篇（落在 ${touched100} 片）`)
if (touched1 !== 1) throw new Error('改 1 篇应当只落在 1 片')
await shardRefresh('无变化（顺带清掉上一版退下来的键）')

console.log('刷新（各跑一次；耗时含下载后的核哈希、解析、验形，以及把结果写进存储——整份快照是 JSON.stringify 整份，分片存储是内存参考实现逐片 JSON.stringify）')
table(['路径', '场景', '结果', '耗时', '下载文件数', '下载字节', '写进存储', '堆内存峰值增量（粗略）'], refreshRows)

const keys = memory.keys()
let shardBytes = 0
for (const k of keys) shardBytes += bytes(JSON.stringify(await memory.readShard(k)))
console.log('存下来的大小')
table(['东西', '大小'], [
  ['整份快照 JSON（一个值）', MB(bytes(snapshotJson))],
  ['分片存储：索引 JSON', KB(indexBytes)],
  [`分片存储：${keys.length} 片合计`, MB(shardBytes)],
  ['分片存储：单片平均', KB(shardBytes / keys.length)],
])

// 合并：同一组输入两条路各算一遍，结果必须相同
const on = { 'community.apply': 'tags_and_records' }
const counts = new Map()
for (const w of works) for (const t of w.tags) counts.set(t.label, (counts.get(t.label) ?? 0) + 1)
const pool = Array.from({ length: POOL }, (_, i) => poolLabel(i + 1)).filter((l) => counts.has(l)).sort((a, b) => counts.get(b) - counts.get(a))
const cases = [['大标签（人人都有）', BIG], ['200 个里最常见的', pool[0]], ['200 个里居中的', pool[Math.floor(pool.length / 2)]], ['200 个里最少见的', pool[pool.length - 1]]]
const mergeRows = []
for (const [name, label] of cases) {
  const input = { tags: [label], external: [], settings: on }
  const read = await readCommunityShards(store, { tags: [label] })
  if (!read.ok) throw new Error(`读分片失败：${read.reason}`)
  const warm = await timed(() => mergeCommunityRecords(snapshot, input))
  const cold = await timed(() => mergeCommunityRecords(JSON.parse(snapshotJson), input), 3)
  const sharded = await timed(() => mergeCommunityRecordsFromShards(store, input))
  if (!sharded.value.ok) throw new Error(`分片合并失败：${sharded.value.reason}`)
  const same = isDeepStrictEqual({ community: sharded.value.community, external: sharded.value.external }, warm.value)
  if (!same) throw new Error(`两条路的合并结果不同：${label}`)
  mergeRows.push([name, counts.get(label), warm.value.community.length, `${MS(warm.ms)} / ${MB(warm.heap)}`, `${MS(cold.ms)} / ${MB(cold.heap)}`,
    `${MS(sharded.ms)} / ${MB(sharded.heap)}`, `${read.shards_read} / ${keys.length}`, read.works.length, '是'])
}
console.log('合并一张图（耗时取多次的中位数 / 堆内存峰值增量，粗略）')
console.log('「整份快照·已在内存」假定宿主进程里常驻着解析好的快照；「整份快照·从存储取」每张图先把整份 JSON 解析出来；「分片存储」每张图读索引与相关分片（内存参考实现，含 JSON 解析）。')
table(['标签', '带它的作品', '出的记录', '整份快照·已在内存', '整份快照·从存储取', '分片存储', '读的分片', '读到的作品', '两条路结果相同'], mergeRows)
