/**
 * 端口——宿主要**实现**的几个接口（以及测试 / 演示 / 小站点可以直接用的内存实现）。纯声明 + 纯内存，零 IO。
 * ─────────────────────────────────────────────────────────────────────────────
 * 引擎不认识宿主的数据库、缓存、编辑后台；它只认这几个形状：
 *   · `OnsiteArticleSource`  站内公开文章从哪来（宿主查自己的文章表，返回 `OnsiteArticle` 形状的行，引擎负责验形）；
 *   · `TagBindingStore`      编辑确认过的「标签 → 主题」绑定存在哪（一张小表就够）；
 *   · `EvidenceCache`        外部源的结果缓存在哪（KV / Redis / 数据库表；值都是可 JSON 序列化的对象）；
 *   · `ExternalEvidenceSource` 外部文献源（OpenAlex 适配器实现了它；加一个源 = 实现这个接口）；
 *   · `WorkTagSource`        可选：标签账本的生效结论（`createTagLedger(...)` 本身就是一个）。
 * 这就是「加一个源 = 加一个适配器、宿主换存储 = 换一个端口实现」的全部接缝。
 */
import type {
  EvidenceCountScope, EvidenceCountsData, EvidenceRecord, EvidenceScaleLevel, EvidenceSourceId, EvidenceTagBinding, EvidenceTopic,
  EvidenceWorkTag,
} from './types'
import { normalizeTag } from './tags'

/** 外部分类树上的四级。 */
export type ExternalLevel = Exclude<EvidenceScaleLevel, 'tag'>
export const EXTERNAL_LEVELS = ['topic', 'subfield', 'field', 'domain'] as const satisfies readonly ExternalLevel[]

export interface ExternalTopicCandidate {
  /** `<source>:<external_id>` */
  topic_id: string
  display_name: string
  works_count: number | null
}

export interface ExternalNodeBundle {
  node: EvidenceTopic
  /** 从近到远 */
  ancestors: EvidenceTopic[]
  siblings: EvidenceTopic[]
  /** 兄弟没取全（残缺包）：服务层照常用，但不写长缓存 */
  partial?: boolean
}

/**
 * 外部文献源。约定：**null = 这次没问成**（网络、限流、预算、形状不对），`[]` = 问到了、没有。两者绝不混用。
 */
export interface ExternalEvidenceSource {
  readonly id: EvidenceSourceId
  /** 标签 → 候选主题（按名字）。标签原样去问，不翻译。 */
  suggestTopics(tag: string, limit: number): Promise<ExternalTopicCandidate[] | null>
  nodeBundle(level: ExternalLevel, externalId: string): Promise<ExternalNodeBundle | null>
  /** 下钻示例（被引最多的若干篇），不代表全体 */
  sampleWorks(level: ExternalLevel, externalId: string, limit: number): Promise<EvidenceRecord[] | null>
  /** 全量格子（可选：没有就不提供计数读口） */
  counts?(level: ExternalLevel, externalId: string, scope: EvidenceCountScope, displayName?: string): Promise<EvidenceCountsData | null>
  /** 一批 DOI 的主主题（可选：没有就不提供「按引用」的绑定证据） */
  topicsForDois?(dois: readonly string[]): Promise<Array<{ doi: string; topic: ExternalTopicCandidate | null }> | null>
}

/** 站内公开文章。返回的行交给 `intakeArticle` 验形，形状见 `OnsiteArticle`（onsite.ts）。 */
export interface OnsiteArticleSource {
  /**
   * `tagKeys` 给了：返回带其中任一标签（按 `normalizeTag` 归一后比较）的**公开**文章；
   * 没给：返回全部公开文章（全站标签图用；站点大时宿主自己封顶，比如最近 2000 篇）。
   * 建议宿主在文章标签表里存一列 `normalizeTag(tag)`，按它查。
   * 服务接了标签账本（`workTags`）时：按 `tagKeys` 查要把账本判 present 的标签也算上（只靠账本加上这个标签的文章也要返回），
   * 多返回的无妨——服务按账本改完标签后会再筛一遍。
   */
  listArticles(query: { tagKeys?: readonly string[] }): Promise<readonly unknown[]>
}

/**
 * 标签账本的生效结论（按作品 id 取一批）。`createTagLedger(...)` 返回的账本直接满足；
 * 大站可以在每次写账本后把 `workTags(id)` 的结果物化成一张表，这里读表。
 */
export interface WorkTagSource {
  forWorks(workIds: readonly string[]): Promise<ReadonlyMap<string, readonly EvidenceWorkTag[]>>
}

/** 编辑确认过的绑定。`get` 取一个标签键的绑定；`listByTopic` 取绑到某个主题的全部标签（主题级汇总站内文章用）。 */
export interface TagBindingStore {
  get(tagKey: string): Promise<EvidenceTagBinding | null>
  listByTopic(topicId: string): Promise<EvidenceTagBinding[]>
  put(binding: EvidenceTagBinding): Promise<void>
  /** 可选：一次取多个（共现图给节点标主题时用；没有就逐个 get） */
  getMany?(tagKeys: readonly string[]): Promise<Map<string, EvidenceTagBinding>>
}

/** 缓存。值都是可 JSON 序列化的对象；`get` 未命中回 undefined。实现可以抛错——服务层会吞掉并照常取数。 */
export interface EvidenceCache {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>
  delete?(key: string): Promise<void>
}

// ── 内存实现 ─────────────────────────────────────────────────────────────────

/** 进程内 LRU + TTL 缓存。单实例 / 开发用；多实例部署请换成共享缓存（否则每个实例各花一遍外部额度）。 */
export function createMemoryCache(opts: { maxEntries?: number; now?: () => number } = {}): EvidenceCache & { size(): number; clear(): void } {
  const max = Math.max(1, opts.maxEntries ?? 1000)
  const now = opts.now ?? (() => Date.now())
  const map = new Map<string, { value: unknown; expires: number }>()
  return {
    async get(key) {
      const hit = map.get(key)
      if (!hit) return undefined
      if (hit.expires <= now()) { map.delete(key); return undefined }
      map.delete(key)
      map.set(key, hit) // 刷新 LRU 次序
      return structuredClone(hit.value)
    },
    async set(key, value, ttlSeconds) {
      map.delete(key)
      map.set(key, { value: structuredClone(value), expires: now() + Math.max(0, ttlSeconds) * 1000 })
      while (map.size > max) map.delete(map.keys().next().value as string)
    },
    async delete(key) { map.delete(key) },
    size: () => map.size,
    clear: () => map.clear(),
  }
}

/** 内存绑定表（演示 / 测试；生产请落库，编辑绑定是要留痕的）。 */
export function createMemoryBindingStore(initial: readonly EvidenceTagBinding[] = []): TagBindingStore & { all(): EvidenceTagBinding[] } {
  const map = new Map<string, EvidenceTagBinding>(initial.map((b) => [b.tag_key, b]))
  return {
    async get(tagKey) { return map.get(tagKey) ?? null },
    async listByTopic(topicId) { return [...map.values()].filter((b) => b.topic_id === topicId) },
    async put(binding) { map.set(binding.tag_key, binding) },
    async getMany(tagKeys) {
      const out = new Map<string, EvidenceTagBinding>()
      for (const k of tagKeys) { const b = map.get(k); if (b) out.set(k, b) }
      return out
    },
    all: () => [...map.values()],
  }
}

/**
 * 内存文章源：给一个数组（或每次现取的函数），按归一后的标签键过滤。小站点可以直接用它包一层自己的查询结果。
 * 只返回 `is_public !== false` 的行（intake 还会再防一道）。
 */
export function createMemoryOnsiteSource(articles: readonly unknown[] | (() => Promise<readonly unknown[]> | readonly unknown[])): OnsiteArticleSource {
  return {
    async listArticles({ tagKeys }) {
      const rows = typeof articles === 'function' ? await articles() : articles
      const pub = rows.filter((a) => !(a && typeof a === 'object' && (a as { is_public?: unknown }).is_public === false))
      if (!tagKeys) return pub
      const want = new Set(tagKeys)
      return pub.filter((a) => {
        const tags = a && typeof a === 'object' ? (a as { tags?: unknown }).tags : null
        return Array.isArray(tags) && tags.some((t) => { const k = normalizeTag(t); return k !== null && want.has(k) })
      })
    },
  }
}
