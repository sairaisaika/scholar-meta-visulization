# Provider 合约矩阵（R04 初步盘点）

2026-10-17；入口为 ExternalEvidenceSource（src/ports.ts），由 createEvidenceService 消费；OpenAlex 实现经 createOpenAlexSource 装配。先查询 external-source / host-ports，再核对引用测试。此表是现有测试盘点，不是所有适配器的认证，也不是新增 provider 已完成。

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

待补：把每个外部方法各自的 null / 空 / 抛错 / 缺可选能力排列为可执行共用合约套件，明确 counts 与 topicsForDois 缺失、抛错及缓存交叉组合；验证不同源 ID 的隔离和第二适配器复用。现有 fakeExternal 的通过只证明当前服务测试输入，不能代表真实 OpenAlex 或任意 provider。R04 保持未完成。

定位后的开发顺序：先盘点已有断言，补真正缺失的失败组合，再抽取可复用测试工厂；保持失败不缓存、政策不变、源前缀隔离。第二源选择属于 R07，应在矩阵可复用后进行。
