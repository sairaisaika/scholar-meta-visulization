# Wiki-first 接口改进演练：2026-10-15

本轮针对“改进外部接口、依赖接口、标签接口及接口规则”实际走一遍。作者已熟悉部分源码，属于自测，不能作为陌生 agent 盲测或采用率证据。本页第一阶段在本轮人工打开任何 src 文件前写入；helper 查询会读取清单登记的源码解析当前行号，不属于完全零源码 IO。

## A：只用 Wiki 形成计划（先于源码核对）

入口：AGENTS → Engineering-entry → Interface-map；为核对语义边界另读 System-views、Integration-and-API、Tags-and-ledger、既有 Interface-improvement-plan 和 CONTRIBUTING。没有源码搜索、没有猜文件名。阅读范围仍偏大：两次工具返回发生输出截断，不能假定被截断内容已完整阅读；下表只采用实际可见信息。

整句查询“外部接口依赖接口和标签接口以及接口规则”返回 5 个候选中的前 2 个，并明确提示拆分。它不是整个改动的清单；随后按入口表选 route ID。不能用单次命中率冒充跨接口影响完整性。

| 工作包 | 目标与现有边界 | 位置和依赖 | 交付与退出证据 | 未定项 |
|---|---|---|---|---|
| P1 公共读口与外部源 | 保留旧 SDK data/null，设计可区分失败的新调用；外部源维持必需/可选能力与失败非空集 | public-api：ServiceResult/ServiceError → handler → client/guards；external-source/transport：ExternalEvidenceSource → OpenAlex 适配器/请求层 → service；错误分类先定，再定新载荷 | 错误/能力矩阵；网络、状态、验形、null/空/partial/缺能力案例；旧调用回归、HTTP 映射和安装包消费者测试 | 新结果式 API 命名、错误联合、取消与共享预算是否需要；均未实现 |
| P2 宿主依赖 | 替换存储不改纯引擎责任；明确缓存降级、账本失败与事务责任 | host-ports → EvidenceServiceOptions/createEvidenceService；ledger-integration → onsiteRecords/applyWorkTags；能力矩阵可先于 P1 独立执行 | 端口输入/返回/异常/缺能力表，召回与缓存失效责任；账本新增标签能召回、错误不回退、缓存异常不伪装空结果 | 原子审核、并发/幂等与跨实例失效需宿主方案，不凭内存测试证明 |
| P3 标签与裁决 | 区分归一、主题绑定、模型建议、贡献包、断言和有效标签；先做追溯诊断，不擅改现行政策 | tag-normalization → tagger-contribution → ledger-policy → ledger-integration；先固定键和现行规则；改键另设计迁移 | 接受/丢弃/拒绝/争议/审核的追溯案例和兼容输入；null confidence、词表 null/[]、每人最新立场、同级争议、审核优先、自审拒绝、召回都回归 | 是否拒收缺置信度或改变层级顺序是政策决策；模型质量与身份真实性另验 |
| P4 接口变更规则 | 让新增接口与行为可升级、可安装、可追踪 | compatibility/settings-contract；types → 实现/guards → features/present/messages → exports → 快照/CHANGELOG/manifest/Wiki；随各工作包持续进行 | 类型兼容样例、变更与必要迁移说明、五入口/行为快照审阅、完整 pnpm check；新设置检查同步旧值与异步刷新 | 版本归类由实际最终差异决定，不提前升级文档修改的版本 |

四包均列出目标、依赖、接口、交付、退出证据和未知项（字段覆盖 6/6，不代表实施完成）。没有足够证据承诺某新接口已存在，或计划实施后改善了真实 provider/数据库。

## B：核对前发现的可用性缺口

1. 复合查询只能给前两条，尚缺一个可直接展开四类改动的紧凑任务入口；要人工拼 10 条路由。
2. 一些路由只指向数百行的工厂：声明定位准确，不等于已经精确到错误转换、缓存和配置应用的编辑位置。
3. 归一、模型清洗、账本门面和公开导出有些重要符号只在正文出现，未全部进入对应机器路由。进入实施还需要增加定点定位。
4. 单纯说“我会优先 wiki”不足以证明采用效果。本次确实从 AGENTS/Wiki 开始且未做源码搜索，但已有源码熟悉度；实际节省时间未计量。

初判：Wiki 已足够写第一版有边界的计划；对精确实施仍需要补局部接缝。不能评为“已足够精细、无需继续改”。源码核对、修补和验收将在后续阶段单列，保留本阶段结论。

## C：定点核对与修补结果

A 阶段文件写入后，才在本轮人工打开路由指向的 src 文件。按十条路由解析所有登记定位，再读取 client/http/service/ledger/tagging/settings 的相关片段；补读 Wiki 已命名的 openalex 请求工厂、index 与 features。没有源码路径猜测或探索式代码搜索。片段选择仍受作者已有熟悉度影响，不能把这次路径当陌生执行者行为。

新增 10 个内部编辑定位全部唯一解析成功，位置如下。此表是本轮源码快照；后续请运行 helper 取得当前行号，内部函数不等于公开 API。

| 工作面 | 内部接缝 | 本轮位置 |
|---|---|---|
| external-transport | `const getJson = async (path: string, attempt = 0)` | `src/openalex.ts:534` |
| host-ports | `async function cached<T>` | `src/service.ts:227` |
| host-ports | `async function onsiteRecords(` | `src/service.ts:255` |
| public-api | `const get = async <T>` | `src/client.ts:27` |
| public-api | `const done = <T>` | `src/http.ts:85` |
| public-api | `const guard = async <T>` | `src/service.ts:353` |
| tagger-contribution | `function sanitizeSuggestions(` | `src/tagging.ts:70` |
| ledger-policy | `const write = async (` | `src/ledger.ts:285` |
| ledger-policy | `async decide(requestId: string` | `src/ledger.ts:355` |
| compatibility | `export * from './types'` | `src/index.ts:10` |

关键语义核对：SDK 将非成功/JSON/guard/网络失败折叠 null；HTTP done 负责成功缓存与错误 no-store/503 Retry-After；cached 区分命中、异常降级与非 null 写回；onsiteRecords 先账本后标签/审阅；runTagger 和 validateTagContribution 共用 sanitizeSuggestions，只有模型 await 位于 runTagger 的 catch 中；账本 write 的 written/unchanged/refused 与模型 dropped 不同。

修补：新增四类改动紧凑入口；六条现有路由补 10 个内部接缝；模型异常分类更准确；旧计划链接到当前工作面与本轮记录。没有实施 P1–P4，也没有增加运行时 API。类型/实现基线仍与提交 `4b424146a70fa0ffc79960184e4061c7b87511fd` 一致。

## D：实际判断与回归

- **能做到**：从 wiki 写出四类改动的首版计划，再到正确声明、实现和内部编辑点定点核对，不依赖先猜目录或源码搜索。
- **原先不够的地方**：复合请求需手工拼工作面；部分工厂定位过宽；模型清洗的共用关系/异常边界不够明确。已按这次实际失败修补，而非单纯增页。
- **为什么我会先用它**：紧凑入口一次给位置、规则、影响、测试和未实现边界；直接搜函数名仍要自行重建这些关系。对本次任务，我会优先入口表 → 单条路由，而不是先全仓搜索。
- **仍不下结论**：不存在“任何未来任务均零搜索”的证据；陌生 agent 的主动采用、计时/加速和真实运行效果未测。这里的“足够”限于本次四类改动的计划与定点核验，不是全系统规格完备。

本轮扩展导航题后：25/25 已知问题首选命中，2/2 未知拒绝，最大响应 446 个空白分隔词。新增定位后曾出现 460 词超预算；去除公共接口的重复消费者定位并压缩解释文字，保留全部具体接缝后恢复通过。未调高阈值，也未删除失败问题。原验收页曾写最大 412，与当时保存报告的 424 不一致，本轮一并纠正并明确当前报告已刷新。

验证命令与平台限制沿用[质量验收页](Wiki-quality-review.md)。结构检查、导航、快照漂移和 Python 导航测试本轮重跑；六张图没有改，不宣称再次渲染。独立采用率与速度不填假分数。

本轮本地执行结果：Python 导航 6/6、结构/漂移和全部 Markdown 链接检查通过；完整 pnpm check 再次完成类型、边界、419 个业务测试与 14 个快照、构建/产物检查，但安装包步骤仍因 Windows 的 spawnSync pnpm ENOENT 停止。私有词表为空明确跳过；不把后续 demo 算本轮已执行。远端 Linux 完整流程以当前提交 check 工作流为准。
