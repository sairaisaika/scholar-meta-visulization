/** DOI 小件（纯函数）：站内参考文献与外部源查询共用同一套归一规则。 */

const DOI = /^10\.\d{4,9}\/\S+$/

/** DOI 的各种写法（`doi:`、`https://doi.org/`、`http://dx.doi.org/`）→ 小写裸 DOI；不像 DOI ⇒ null。 */
export function normalizeDoi(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase()
  return s.length <= 300 && DOI.test(s) ? s : null
}

/**
 * 能不能放进「按 DOI 批量查」的 OR 过滤里：OpenAlex 的过滤串按 `,` 分过滤、按 `|` 分取值，
 * 含这两个字符的 DOI 放不进去（URL 编码也没用，服务端先解码再切分）。这样的 DOI 查不了，调用方要把它算作「没查」。
 */
export function isFilterSafeDoi(doi: string): boolean {
  return !/[,|]/.test(doi)
}

/** FNV-1a 32 位哈希（确定性的「伪随机」排序与缓存键用；不做安全用途）。 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * FNV-1a 再过一道 MurmurHash3 的 fmix32 终混：FNV-1a 对「只差最后几个字符」的短串雪崩很弱
 * （同前缀的 DOI 会扎堆），终混之后高位才均匀。抽样排序用它。
 */
export function hash32(s: string): number {
  let h = fnv1a(s)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * 从一批 DOI 里取至多 `max` 个做样本：按哈希排序再截断——确定性（同一批输入永远取同一批），
 * 但与出版社前缀无关（按字典序截断会只留下前缀小的几家出版社，样本有偏）。
 */
export function sampleDois(dois: readonly string[], max: number): string[] {
  const unique = [...new Set(dois)]
  if (unique.length <= max) return unique.sort()
  return unique
    .map((d) => [hash32(d), d] as const)
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
    .slice(0, Math.max(0, max))
    .map(([, d]) => d)
    .sort()
}
