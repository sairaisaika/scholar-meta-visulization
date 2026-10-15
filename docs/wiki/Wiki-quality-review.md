# Wiki 优化验收：2026-10-15

本次按 projectWikiSkill 的 `project-wiki`（提交 `26f550bf97cf0292001df37c8a1ce3d0a2fa8c7f`）优化 SMV/SMT 共享正文。产品源码基线 `37584593a5805fc197531dbc4e58ba60fcd530e0`，未改 src、类型契约、版本或行为快照。原有演练见[历史记录](Wiki-routing-verification.md)，不覆盖其原始结论。

## 本次改变

- 10 条原有路由迁到 schema 2：明确输入、输出、返回失败、抛错、缺失能力、规则来源、下游影响、检查范围、未知项和源码复核日期。
- 新增 system-views 与 interface-plan；计划保持 planned，六项计划字段不等于方案已批准或实现。
- 新增六视图页，区分实际模块、通用宿主接线和未验证部署；接口地图补章节来源，局部流程/时序图区分图表来源。
- 工程入口、侧栏与 AGENTS 使用新版 helper；CI 检查结构、快照漂移和导航题，不自动重建过期快照。

## 分开记录的结果

| 维度 | 观察 | 边界 |
|---|---|---|
| 结构 | 12/12 路由可解析并达到配置门槛；六种视图各 1 种 | 路径/字段/覆盖检查，不是 100% 语义正确 |
| 导航 | 20/20 已知问题 top-1/top-2；2/2 未知拒绝；最大响应 412 个空白分隔词 | 作者已读代码，是登记题自测；非独立盲测、非中文 token 数 |
| 来源块 | 新六视图 6/6 有局部图表来源；接口地图 10/10 特性节有章节来源 | 本轮选择页面的覆盖，不是全站所有事实逐句溯源 |
| 语义抽查 | 5/5 下表关键边界与实现核对 | 不推断未抽查路径、并发或真实运行 |
| 渲染 | Mermaid 11.17.2 + Chrome 渲染 6/6，逐张人工检查 | 新 System-views 页；不声称重渲染全站历史图 |
| 采用/速度 | 未测 | 没有陌生 agent 试用、计时或速度基线 |

机器报告：[结构](quality-structure.json)、[导航](quality-routing.json)、[渲染回执](quality-rendering.json)。图形截图为本地临时检查产物，不作为公共包附件。报告中的 source 是实现存在证据，不声称 installed/live-verified。

| 抽查位置 | 核对后写入文档的边界 |
|---|---|
| service.cached | cache get/set 抛错会记日志并降级；null 不写回；不能把缓存故障说成空结果 |
| service.onsiteRecords | 验形→条件账本应用→标签筛选→审阅；非数组 rows 实际按空数组验形 |
| ledger.decideChangeRequest / createTagLedger.decide | 规则守卫与持久化分开；append 在 putRequest 前，无跨操作事务保证 |
| settings.createLiveSettings / settingsReader | 调用触发、TTL/并发合并、同步旧值与异步刷新；不是推送/定时轮询 |
| http.createEvidenceHandler / client.createEvidenceClient | settings 失败用缺省；业务分发异常 500；SDK 网络/状态/形状失败 null |

## 本地执行及限制

- Python 旧导航兼容测试通过；新版结构、漂移、导航与渲染回执测试纳入相同测试入口。
- `pnpm check`：typecheck、typecheck:src、boundary、业务 Jest 419 通过 / 12 跳过、14 快照、build/产物与 manifest 检查通过。私有词表为空，该闸明确跳过。
- 首次 shell 命中了不可用的 WSL bash；当前进程 PATH 改用已安装 Git Bash 后越过边界步骤，没有修改系统配置。
- `check:package` 在本机 Windows 的 `spawnSync pnpm ENOENT` 处停止，故本地完整命令未通过；不把包安装链路算通过。剩余 demo 单独运行通过；远端 Linux 完整验收以[check 工作流](https://github.com/sairaisaika/scholar-meta-visulization/actions/workflows/check.yml)对应提交结果为准。

## 维护与复核

`tools/wiki.py` 原样复制自 projectWikiSkill 上述提交的 `project-wiki/scripts/wiki.py`，Python 3.10+ 标准库，无运行依赖。升级时先审阅上游差异、更新此来源记录，并跑下列检查；不自动拉取或执行远程版本。旧 wiki_route.py 增加 schema 2 读取与 checks 对象显示兼容；旧索引保留，但不承担新版质量判定。

```sh
python tools/wiki.py query "模型贡献"
python tools/wiki.py audit
python tools/wiki.py build
python tools/wiki.py check
python tools/wiki.py evaluate --tasks docs/wiki/navigation-tasks.json
python tools/wiki_route.py --build
python tools/wiki_route.py --check
python -m unittest discover -s tools -p test_wiki_route.py
pnpm check
```

`build` 更新结构快照，不代替语义复核或自动刷新 reviewed_at。修改图表后重新渲染并更新回执；`quality-structure.json` 与 `quality-routing.json` 是本次快照，后续 CI 从当前清单计算而不是信任保存分数。定点源码核验是必要步骤；不把它算作 wiki 导航失败。SMT 的现有共享入口继续指向同一正文，不复制第二套。
