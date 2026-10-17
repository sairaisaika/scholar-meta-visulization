# 配置与外部数据

## 设置怎样生效

`EVIDENCE_SETTINGS` 为注册表，`validateSettings` 回 values、provided、issues；未知键忽略，不合法值退回缺省并记录问题。只有 provided 的有效键覆盖服务代码选项，优先级为有效后台值 > 代码选项 > 注册表缺省。

支持静态设置、同步函数、`createLiveSettings(provider)`；现读设置缺省缓存 10 秒，refresh 可触发重读，读取失败沿用上次结果并记录日志。同步读取路径可能先使用最近值再后台刷新，不应宣称所有入口保存后立即同步读库。

| 设置键 | 缺省值 |
|---|---|
| binding.machinePolicy | first_hit |
| external.gate | onsite_tags_only |
| external.dailyCreditBudget | 5000 |
| external.sampleSize | 25（范围 1–50） |
| external.maxReferenceDois | 200 |
| cache.resolveDays / cache.bundleDays | 30 / 30 |
| cache.sampleDays / cache.countsDays | 7 / 7 |
| onsite.label / onsite.license | On-site articles / unspecified |
| onsite.reviewGate | off |
| graph.minSupport / graph.maxNodes | 2 / 60 |
| http.cacheMaxAge | 300 秒 |
| http.route.map / counts / tagCounts / tagGraph | 都为 true（键均有 http.route. 前缀） |
| ledger.modelMinConfidence | 50（百分数，换成策略时为 0.5） |
| ledger.reviewTier / ledger.apply | editor / merge |

完整类型、范围和生效范围以 [settings.ts](../../src/settings.ts) 为准，JSON 清单是 `scholar-meta.manifest.json`。比例最小分母 30、汇总最少 5 项是方法判据，不是后台偏好开关。

## 服务端 OpenAlex

用 `createOpenAlexSource({ apiKey, dailyCreditBudget })` 提供外部源，密钥由宿主注入，只送 Authorization 头。引擎不自行读环境变量，不能把服务端密钥放浏览器。

外部源可返回四级分类树、子级、被引较多作品示例与全量计数。OpenAlex 元数据不提供本引擎森林图所需效应量，不能从引用数制造效应。

`external.gate` 默认只对计入的站内标签向外取数；节点读取缺省放行，宿主可用 `allowNode` 限制。标签闸不等于所有请求都已受到节点访问控制。

## 预算的实际边界

OpenAlex 客户端按响应头 credit 统计，在该实例内每个 UTC 日重置。直接创建适配器而不传 dailyCreditBudget 或有效设置时不限额；要明确传入或接上同一设置源。

这是本地实例预算，不是全站共享账本；多实例、重启、并发请求都影响实际限额效果。生产需要宿主协调全局预算、共享缓存与限流。代码中的免费路径与历史成本描述来自当时 API 行为，本 Wiki 不保证今天的外部价格或额度，调整前应重新查官方说明及实际响应。

## 缓存与失败

服务 DEFAULT_TTL 的单位是秒：resolve/bundle/dois 为 30 天，sample/counts 为 7 天，suggest 为 1 天，onsite 为 300 秒。设置中的 Days 是天，不能直接当秒传给 ttl 选项。

失败 null 不写长缓存，部分分类包不写长缓存；成功的空数组可表示确实没有结果。缓存端口故障会降级取数，但外部和账本不可用不能伪装为空集。内存缓存为单实例 LRU + TTL，多实例用共享实现。宿主数据、资格或账本改变时，需要处理相关缓存失效，并考虑 HTTP/CDN 仍可能保存旧响应。

依据：[service.ts](../../src/service.ts)、[settings.ts](../../src/settings.ts)、[openalex.ts](../../src/openalex.ts)、[ports.ts](../../src/ports.ts)。

## 外部合约复核（2026-10-17）

本页预算数字是当前代码配置，既有按请求 credit/费用说明属于原核验日期的记录，不作为今天账户的费用或硬限额承诺。OpenAlex 现行官方文档区分日预算与每秒速率，两类都可能 429；应复核响应头/计量和调用条件。详情、官方依据与 R02 未完成项见[工程研究](Engineering-research-2026-10.md)。本轮未改适配器，也未执行新的真实 provider 验收。
