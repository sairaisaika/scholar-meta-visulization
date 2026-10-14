# 接入与 API

## 先接数据端口

`createEvidenceService` 必需 `onsite.listArticles({ tagKeys? })`，返回公开文章的原始行；其他端口按能力选配：external、bindings、cache、workTags、certainty。

`OnsiteArticle` 最小字段是 id、title。tags、研究设计、效应、方向、年份、参考文献、审阅时间等都是可选。`intakeArticle` / 服务 `intake` 返回 record 与 issues，可能拒收整篇，也可能只清掉问题字段；不会修改宿主数据库。

不公开或已撤稿的文章不收。publication_type 与 study_design 是两个维度。`claim` 只是自报结果。效应区间、p、方向需要验形，不能从摘要里随意拼字段。

`onsite.reviewGate = reviewed_only` 时，只有有效 reviewed_at 的站内文章计入；待审数量保留。谁具备审阅资格、资格撤销后如何重算由宿主决定。

## 服务方法

| 方法 | 用途 |
|---|---|
| getTagMap(tag) | 标签图谱 |
| getNodeMap(level, externalId) | 外部节点图谱 |
| getCounts(level, externalId, scope?) | 外部全量分组计数 |
| getTagCounts(tag) | 站内标签计数 |
| getTagGraph(query?) | 全站或聚焦共现图 |
| suggestBindings(tag, opts?) | 编辑候选，含名称与引用线索 |
| curate(input) | 编辑确认或否决主题绑定 |
| bindingQueue(opts?) | 待编辑处理标签 |
| intake(article) | 同步文章验形 |
| settings() | 当前有效设置 |

异步数据方法返回 `{ ok: true, data }` 或 `{ ok: false, error }`，不要与客户端直接 data/null 混用。`intake` 与 `settings` 有各自的返回形状。

## HTTP 只提供读口

缺省前缀 `/api/evidence`，支持 GET / HEAD。

| 路径 | 参数 |
|---|---|
| /map | tag，或者 level + id |
| /counts | level + id + 可选 scope（缺省 primary_topic） |
| /tags/counts | tag |
| /tags/graph | 可选 focus、min_support（1–50）、max_nodes（1–200） |

level 是 topic/subfield/field/domain。HTTP 的 id 传 `T10537` 这类裸外部 ID，编辑绑定的 topic_id 则是 `openalex:T10537`。服务另校验对应层级 ID，不可混用。

| 状态码 | 意义 |
|---|---|
| 200 | 成功，正文直接是数据 |
| 400 | invalid_input |
| 404 | not_found，或未知/关闭路由 |
| 405 | method_not_allowed |
| 501 | not_configured |
| 503 | unavailable，Retry-After: 60 |
| 500 | 未被服务结果包装的处理异常 |

错误正文是 `{ error: code }`，不回显输入；失败 no-store。成功默认 `public, max-age=300, stale-while-revalidate=86400`，显式 handler cacheControl 优先于设置。默认读口不读取读者身份，若宿主增加个性化或权限数据，就必须重新评估公共缓存。

编辑写入、账本贡献与审核不在这四个读口里；宿主为它们提供鉴权路由，不能直接信任客户端提交的 actor/tier。

## 客户端与绘制

`createEvidenceClient({ baseUrl?, fetch?, headers? })` 默认同源 `/api/evidence`。移动端可提供宿主 API 的绝对 baseUrl。非成功、网络失败或响应形状不对返回 null；客户端不保留服务端错误码供细分展示，需要细分时在宿主读取 HTTP 状态。

客户端数据交给 `presentEvidenceMap` 等展示函数，再由宿主画图；null 显示暂时取不到，成功的空集才表示当前结果为空。保留 notices、caption、出处与降级理由。

完整通用适配示例见[原接入指南](../integration.md)。依据：[service.ts](../../src/service.ts)、[ports.ts](../../src/ports.ts)、[http.ts](../../src/http.ts)、[client.ts](../../src/client.ts)、[onsite.ts](../../src/onsite.ts)。
