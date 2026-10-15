# 四类接口改动：先定位，再提出计划

入口不是单次复合查询的前两项。先按下表选工作面，局部说明只读相关节；完整候选方案见[接口计划](Interface-improvement-plan.md)，实际演练与缺口见[本轮记录](Interface-navigation-trial.md)。SMT 共用当前包内实现，没有另一套标签服务需要猜。

## 一页确定改哪几层

| 改动目标 | 路由与局部说明 | 具体编辑接缝 | 必须同时考虑 |
|---|---|---|---|
| 公共 HTTP/SDK 错误 | public-api / [公共读口](Interface-map.md#public-api) | service.ServiceResult/ServiceError；http.done；client.get；service.guard | 数据、返回错误、抛错与形状失败；旧 data/null 兼容；四个 GET/HEAD 读口不增写权限 |
| 新外部文献源 | external-source / [外部源](Interface-map.md#external-source) | ports.ExternalEvidenceSource → openalex.createOpenAlexSource → service | 必需/可选方法、null/空/partial、sample 与 counts 的范围 |
| 重试、取消、预算 | external-transport / [请求层](Interface-map.md#external-transport) | openalex.createOpenAlexClient 内 getJson | 当前 429 重试/实例 UTC 日预算；共享预算与调用方取消仍是提案 |
| 存储和缓存 | host-ports / [宿主依赖](Interface-map.md#host-ports) | ports 声明 → service.cached/onsiteRecords | cache miss/异常降级、账本失败、持久化/并发/失效责任 |
| 标签键与主题绑定 | tag-normalization / [归一](Interface-map.md#tag-normalization) | tags.normalizeTag/resolveTagBinding | 历史索引、绑定、断言、缓存迁移；不是语义同义词合并 |
| 模型与交换包 | tagger-contribution / [模型贡献](Interface-map.md#tagger-contribution) | tagging.runTagger + validateTagContribution 共用 sanitizeSuggestions | 缺置信度、词表 null/[]、去重/门槛/上限；模型版本与贡献包兼容 |
| 信任与审核 | ledger-policy / [裁决](Interface-map.md#ledger-policy) | ledger.resolveWorkTags/checkAssertion；createTagLedger 内 write/decide | 最新立场、层级/争议/审核；written/unchanged/refused；append/putRequest 非原子 |
| 有效标签与统计 | ledger-integration / [应用](Interface-map.md#ledger-integration) | service.onsiteRecords → ledger.applyWorkTags → onsite.applyReviewGate | 召回含账本新增标签，先应用再筛选；争议排除、资格变更与缓存失效 |
| 配置与规则暴露 | settings-contract / [配置](Interface-map.md#settings-contract) | settings 注册/校验/live/reader → manifest/消费入口 | 同步旧值、异步刷新、设置优先级；配置不等于实现新能力 |
| 对外兼容与交付 | compatibility / [兼容](Interface-map.md#compatibility) | types 契约 → index/五入口 → features/guards/present/messages | 契约/行为/API 快照、CHANGELOG、必要迁移、安装包消费者测试 |

**章节来源**：上表每行的 route 在 `routes.json` 中绑定声明、实现、调用者和测试。当前定位由 `python tools/wiki.py query <route-id> --limit 1` 或[生成索引](route-index.md)提供，避免复制过期行号。`cached/get/getJson/guard/write/decide/sanitizeSuggestions` 是实现接缝，不因出现在 Wiki 就成为公共导出。

## 具体做法和交付顺序

1. **先列现状和不变量**：按所选路由列输入/输出、returned/thrown/unsupported，附当前符号。目标是增加什么能力、现行调用必须保留什么行为，分开写。
2. **优先契约矩阵**：P1 定义可区分错误且兼容旧 SDK 的方案；P2 独立验证端口缺能力、null、空、partial、抛错和缓存故障；P3 追踪模型清洗→贡献验形→断言→裁决→统计。先确认既有测试的断言，再补缺失用例，不因 Wiki 列了测试就假定已覆盖。
3. **再做最小设计**：错误分类先于新载荷；键和政策先于追溯字段。共享预算、取消、拒收缺置信度、事务扩展各需明确需求与兼容设计，不作为一次接口整理的默认附赠能力。
4. **随工作包执行 P4**：实际变动涉及哪些类型、guard、生产/消费、导出、设置、快照与迁移，就更新哪些。纯文档不升级契约版本，不能为过测试直接盲更新快照。
5. **退出条件**：旧调用回归、错误不变空结果、可选能力降级、账本新增召回/争议排除、自审拒绝、历史影响说明和安装包类型/运行链路。具体窄命令取各路由；最终 `pnpm check`，真实 provider/数据库/安装状态另给实际证据。

## 不足以据此实施的事项

新 API 命名与错误联合、跨实例预算/缓存失效、宿主身份与原子审核、真实模型质量，当前仍需设计或实测。Wiki 已提供第一版计划的六项内容：目标、依赖、接口、交付、退出证据、未知；这些不是实施完成证明。

定位失败时先确认路由/快照是否漂移，再做一次有目标的源码搜索并修补。完整请求拆成工作面，不把 helper 的 top-two 或某个 100 分结构分当作全项目影响分析。文档适合减少探索式搜索，准备写代码仍要打开所指实现。
