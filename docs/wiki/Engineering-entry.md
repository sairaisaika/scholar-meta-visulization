# 工程入口：从改动目标找到接口、规则和检查

这页面向要改代码的人。使用说明和概念解释仍从 [Home](Home.md) 进入。当前接口改进演练见[计划与演练记录](Interface-improvement-plan.md)。

在 SMV 仓库根运行：

```sh
python tools/wiki_route.py "外部源端口"
python tools/wiki_route.py "HTTP 错误"
python tools/wiki_route.py "模型贡献"
python tools/wiki_route.py "标签裁决"
python tools/wiki_route.py --list
```

每次只返回最相关的两条路由：当前源码位置、局部说明、检查命令、证据边界。查询读取已登记的文件以解析位置，不是全仓搜索；人工不用猜文件名。需要完全不读源码的计划阶段，直接用下表和[接口影响地图](Interface-map.md)；准备编辑时再定点打开列出的符号。

| 改动问题 / 稳定路由 ID | 声明 → 实现 → 影响 | 说明 |
|---|---|---|
| 换/加外部文献源 `external-source` | ExternalEvidenceSource → createOpenAlexSource → createEvidenceService | [外部源端口](Interface-map.md#external-source) |
| 超时、限流、预算 `external-transport` | OpenAlexOptions → createOpenAlexClient → 外部读口 | [外部请求](Interface-map.md#external-transport) |
| 数据库、缓存、依赖注入 `host-ports` | OnsiteArticleSource / TagBindingStore / EvidenceCache / WorkTagSource / CertaintySource → createEvidenceService | [宿主依赖](Interface-map.md#host-ports) |
| HTTP / SDK 错误、路由 `public-api` | EvidenceService / ServiceResult → createEvidenceHandler → createEvidenceClient / guards | [公共读口](Interface-map.md#public-api) |
| 标签归一、主题绑定 `tag-normalization` | normalizeTag / resolveTagBinding → 服务筛选 / 绑定 | [标签与主题](Interface-map.md#tag-normalization) |
| 模型接口、交换包 `tagger-contribution` | EvidenceTagger → runTagger / validateTagContribution → 账本 | [模型贡献](Interface-map.md#tagger-contribution) |
| 信任层级、审核规则 `ledger-policy` | LedgerPolicy → resolveWorkTags / checkAssertion / decideChangeRequest | [裁决规则](Interface-map.md#ledger-policy) |
| 标签计数漏项、争议排除 `ledger-integration` | WorkTagSource → applyWorkTags → createEvidenceService | [标签应用](Interface-map.md#ledger-integration) |
| 设置默认值、热更新 `settings-contract` | EVIDENCE_SETTINGS → validateSettings / createLiveSettings → 各入口 | [设置](Interface-map.md#settings-contract) |
| 包导出、契约、兼容性 `compatibility` | EVIDENCE_CONTRACT_VERSION / 五入口 → API 快照 / 安装包 | [兼容性](Interface-map.md#compatibility) |

## 怎样判断路由够不够精细

读完一条就应能写出：修改哪层、哪个声明和实现、影响谁、哪条规则不能破坏、跑哪个测试、还有什么未知。如果只有一个文件名，没有这些信息，路由仍不合格。

位置快照在 [agent-index.md](agent-index.md)，机器清单在 `routes.json`；查询会重新解析当前行号，快照用于审阅而非永久行号承诺。`--build` 更新快照，`--check` 检查位置、链接、锚点和快照漂移，漂移时以非零退出码失败；CI 同时运行导航验收。内容哈希统一 LF，避免 Windows/Linux 换行差异造成假漂移。它不证明描述的行为正确，也不证明接口计划已经实现。

遇到未登记问题，查询返回无路由；不要硬套“最像”的接口。定点搜索后补路由是兜底，不能声称 Wiki 已覆盖所有未来任务。
