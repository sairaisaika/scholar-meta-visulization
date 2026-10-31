/**
 * 用户贴进来的「一篇论文」认成什么（纯函数、零 IO）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 社区打标签的入口是一个输入框：DOI、`doi.org` 链接、OpenAlex 的 `W…` 编号或链接、PubMed 编号或链接、
 * 出版社页面的链接、或者干脆一个标题。这里只做**识别与归一**，不出网：
 *   · `doi`      → 小写裸 DOI（同 `normalizeDoi`）；
 *   · `openalex` → `W` + 数字；
 *   · `pmid`     → 纯数字（PubMed 链接 `pubmed.ncbi.nlm.nih.gov/<n>` 也认）；
 *   · `url`      → 认不出编号的 http(s) 链接（下一步由调用方去问外部源，问不到再让用户给标题）；
 *   · `title`    → 其余文本，压成单个空白；太短（< 4 个字符）当作认不出。
 * 认出 DOI / OpenAlex / PMID 的，`workKeyOf` 给出账本用的作品键（`doi:<doi>` · `openalex:W…` · `pmid:<n>`），
 * 与 `normalizeWorkId` 同一套写法——同一篇论文在社区标签与宿主账本里是同一个键。
 */
import type { EvidenceWorkRef } from './types'
import { normalizeDoi } from './doi'
import { safeHttpUrl } from './url'

const OPENALEX = /^(?:https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?|openalex:)?(W\d{3,})\/?$/i
const PMID_BARE = /^(?:pmid:\s*)?(\d{1,9})$/i
const PMID_URL = /^https?:\/\/(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{1,9})\/?(?:[?#].*)?$/i
/** 链接里嵌着的 DOI（出版社页面常见：`https://…/doi/10.1000/xyz`、`…?doi=10.1000/xyz`） */
const DOI_IN_URL = /(10\.\d{4,9}\/[^\s?#&"']+)/
const TITLE_MIN = 4
const TITLE_MAX = 500

/** 把输入认成一种引用；空、太长、太短 ⇒ null。 */
export function parseWorkRef(raw: unknown): EvidenceWorkRef | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s || s.length > 2048) return null
  const doi = normalizeDoi(s)
  if (doi) return { kind: 'doi', value: doi }
  const oa = OPENALEX.exec(s)
  if (oa) return { kind: 'openalex', value: oa[1]!.toUpperCase() }
  const pm = PMID_BARE.exec(s) ?? PMID_URL.exec(s)
  if (pm) return { kind: 'pmid', value: String(Number(pm[1])) }
  const url = safeHttpUrl(s)
  if (url) {
    const m = DOI_IN_URL.exec(decodeURIComponentSafe(url))
    const embedded = m ? normalizeDoi(m[1]!.replace(/[.,;)]+$/, '')) : null
    return embedded ? { kind: 'doi', value: embedded } : { kind: 'url', value: url }
  }
  if (s.length < TITLE_MIN) return null
  return { kind: 'title', value: s.slice(0, TITLE_MAX) }
}

/** 作品键：`doi:<doi>` · `openalex:W…` · `pmid:<n>`；链接与标题还不是一篇确定的论文，回 null。 */
export function workKeyOf(ref: EvidenceWorkRef | null | undefined): string | null {
  if (!ref) return null
  switch (ref.kind) {
    case 'doi': return `doi:${ref.value}`
    case 'openalex': return `openalex:${ref.value}`
    case 'pmid': return `pmid:${ref.value}`
    default: return null
  }
}

/** 作品键 → 引用（账本里的键、导出文件里的键都能反解）；不是三种之一 ⇒ null。 */
export function workRefOfKey(key: unknown): EvidenceWorkRef | null {
  if (typeof key !== 'string') return null
  const i = key.indexOf(':')
  if (i <= 0) return null
  const kind = key.slice(0, i)
  const value = key.slice(i + 1)
  if (kind === 'doi') { const d = normalizeDoi(value); return d ? { kind, value: d } : null }
  if (kind === 'openalex') return /^W\d{3,}$/.test(value) ? { kind, value } : null
  if (kind === 'pmid') return /^\d{1,9}$/.test(value) ? { kind, value } : null
  return null
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}
