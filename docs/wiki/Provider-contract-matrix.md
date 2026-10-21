# Provider 合约矩阵（R04）

2026-10-21；入口为 ExternalEvidenceSource（src/ports.ts），由 createEvidenceService 消费；OpenAlex 实现经 createOpenAlexSource 装配。先查询 external-source / host-ports，再核对引用测试。R04 完成的是现有端口的可复用服务消费端套件与边界盘点，不是所有适配器认证，也不是第二源已实现。

| 维度 | 约定与已验证案例 | 可直接定位的测试 |
|---|---|---|
| 必需能力 | id、suggestTopics、nodeBundle、sampleWorks；类型约束不等于不可信运行时对象验形 | src/ports.ts ExternalEvidenceSource；test/service.test.ts 标签级研究图谱 |
| 未配置源 | 站内仍可用，外部 not_queried；节点 not_configured | test/service.test.ts “没配外部源”与“节点 id 验形” |
| null / 空 | 没问成不缓存、下次重问；成功查无缓存；并发合并 | test/service.test.ts “② 「没问成」不缓存、下次再问；「查无」缓存；并发合并” |
| partial bundle | 仍可展示，不能长缓存；下次重取 | test/service.test.ts “兄弟没取全的缩放包” |
| children 可选 | 方法不存在省略字段；失败 null，非成功空；partial 不长缓存 | test/service.test.ts “外部源没有 children 方法”与“上级三级问外部树并缓存” |
| counts | 外部格子缓存，站内层现算 | test/service.test.ts “⑤ 计数” |
| 宿主抛错 | 文章源异常成为 unavailable；不能报告空图 | test/service.test.ts “文章源抛错” |
| 缓存故障 | get/set 抛错仍取外部结果 | test/service.test.ts “缓存抛错” |
| HTTP 失败 | 非成功/坏正文为失败；429 预算与等待行为另见 transport | test/openalex.test.ts “429 退避”与“标签解析三态” |

## 可执行矩阵与复用

运行：`pnpm exec jest --runInBand test/provider-contract.test.ts test/service.test.ts test/openalex.test.ts test/openalex-counts.test.ts`。

`test/provider-contract.ts` 导出 `providerContract(name, make)`。make 接受 Partial<ExternalEvidenceSource> 方法替换，构造可受控适配器；每个测试有独立服务、缓存和固定时钟，不依赖真实网络。`test/provider-contract.test.ts` 执行20个案例（含共享缓存隔离）；fixture 的零计数与空数组是合法成功，不是缺数据替身。

| 能力 | null | 空/零 | 抛错 | 缺可选方法 | 缓存/partial |
|---|---|---|---|---|---|
| suggestTopics | unavailable且再问 | no_match且缓存 | service unavailable且再问 | 必需，缺失不支持 | 既有并发合并测试保留 |
| nodeBundle | service unavailable且再问 | 无合法“空节点” | service unavailable且再问 | 必需 | partial可显示但每次重取 |
| sampleWorks | 图仍可用，external_match unavailable | []成功matched | service unavailable且再问 | 必需 | 成功空也缓存 |
| children | children:null且再问 | []成功且缓存 | service unavailable且再问 | 字段省略 | partial:true不长缓存 |
| counts | unavailable且再问 | total:0成功 | service unavailable且再问 | not_configured | 并发/后续成功读合并；get/set故障仍取数 |
| topicsForDois | 名字候选仍在，cited:null且再问 | []成功且缓存 | service unavailable且再问 | 保留名字候选 | get/set故障仍取数 |

当前 service 对某个方法返回 null 与抛错不一定相同（例如 DOI null 允许名字候选降级，而抛错使整个 suggestBindings unavailable）。这是观察到并钉住的边界，不擅自把异常转换成“零”或更宽成功。自定义适配器应按端口将预期上游失败转换为 null；任意 JSON 必须先验形，不能把 TypeScript 声明当运行时安全保证。

共享缓存以source.id隔离：测试分别使用openalex/crossref命名空间与相同节点ID，确认不串缓存。第二命名空间只是受控fixture，**不是Crossref真实适配器**。接入新源时可复用此套件并提供其受控factory；还须独立验证实际请求/响应映射、来源ID与节点形状、协议字段、错误处理和真实服务。OpenAlex真实回执另见 [R02](OpenAlex-contract-2026-10.md)。

范围外：任意坏缓存值的通用验形、跨实例原子预算/锁、TTL过期时钟与无限故障笛卡尔积不是本次认证结论；新组合有具体故障再补测试。第二源选择属于R07，不把受控套件通过当作上线。
