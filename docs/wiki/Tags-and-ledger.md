# 标签与裁决账本

## 三件不同的事

1. 论文有没有某个标签：由文章申报与标签账本决定。
2. 标签对应哪个外部主题：由绑定表与机器候选决定。
3. 这组论文能支持什么证据视图：由记录数据与判据决定。

确认主题绑定不会自动批准所有论文标签；模型给标签也不会自动确认外部主题。

## 归一与绑定

`normalizeTag` 做兼容字符归一、去标签前缀、转小写、折叠空白及连字符。`#CBT-I`、`cbt-i`、`ＣＢＴ－Ｉ` 归为 `cbt i`。标签键上限 100 字符；HTTP 接收参数的 200 字符上限是另一层检查。

不翻译、不自动合并同义词。`groupTags` 将同一键的不同写法归组，不是语义聚类。

绑定由 `resolveTagBinding` 处理：优先编辑确认或否决，再考虑机器匹配。策略有 `first_hit`、`exact_only`、`off`，缺省 `first_hit`。机器按名称找候选，必须保留“未经确认”的出处，不能把结果描述成专家认定。

## 模型建议与贡献包

`EvidenceTagger` 提供 `id`、`version`、`vocabulary`、异步 `tag(input)`。`createVocabularyTagger` 是可复现词表基线，第三方模型由宿主实现。

`runTagger` 归一标签、夹置信度到 [0,1]、同键取较高置信度、过滤词表和门槛、封顶数量；缺省最多 20 个建议。词表为 `null` 表示开放词表，空数组则不允许任何标签。没有置信度不会仅因数值门槛而自动丢弃。

失败回 `null`，成功且没有标签是空 suggestions。模型版本与丢弃数量保留在结果中。`buildTagContribution` 打包，`validateTagContribution` 用接收方规则验形；贡献包不承担身份认证。

作品键经 `normalizeWorkId` 统一：`openalex:W123`、`doi:10.…`、`onsite:42` 等。不要把同一篇论文的 DOI 与内部键当两个毫无关系的作品。

## 裁决与修改

缺省信任顺序：maintainer > editor > contributor > model；模型置信门槛 0.5，审核最低 editor。

- 每个断言者只采用其最新立场。模型最新立场低于门槛，不回退到旧的高置信结论；`null` 置信度不会因此被排除。
- 最高有有效立场的层级决定标签。普通同级意见一致为 `present` / `absent`，冲突为 `disputed`，不取多数。
- 同层存在经审核的断言时，最近的经审核结论解决该层分歧。
- 低层不能直接推翻高层或介入高层争议；经审核结论同层也不能直接推翻，返回 `needs_change_request`。
- 只有人能申请和审核；不能审核自己的申请，审核人还要满足最低层级与当前结论层级。

`createTagLedger` 门面提供 `submitSuggestions`、`assert`、`requestChange`、`decide`、`withdraw`、`workTags`、`forWorks`。断言留痕、存储与事务由 `TagLedgerStore` 实现；多人写入需要宿主处理并发一致性。

## 怎样影响图谱

将 ledger 传给服务的 `workTags`。`ledger.apply` 为 `merge` 时保留没有账本裁决的原标签；`ledger_only` 只保留账本 present；`off` 不应用账本。absent 与 disputed 不计入生效标签，图注保留模型决定与争议排除说明。

文章源按标签查询时，也必须返回仅由账本新增该标签的文章。否则文章在应用裁决前就被数据库漏掉，引擎无法补回来。账本端口取不到时服务返回 unavailable，不用原始标签凑数。

依据：[tags.ts](../../src/tags.ts)、[tagging.ts](../../src/tagging.ts)、[ledger.ts](../../src/ledger.ts)、[ports.ts](../../src/ports.ts)。完整流程见[打标签专题](../tagging.md)。

## 工程边界与来源

申请生命周期及拒绝守卫见[申请状态图与操作表](System-views.md#state-machine)，断言、申请与派生结论见[数据模型](System-views.md#data-model)。`createTagLedger.decide` 先 append 审核断言，再 putRequest；门面未提供跨操作原子事务，部分成功和并发审核需要宿主处理。

**章节来源**：归一/绑定节 `tags.normalizeTag/resolveTagBinding`；模型节 `tagging.runTagger/validateTagContribution`；裁决节 `ledger.resolveWorkTags/checkAssertion/decideChangeRequest`；统计节 `ledger.applyWorkTags` 与 `service.onsiteRecords`。对应路由动态解析当前位置，详见[生成索引](route-index.md)。
