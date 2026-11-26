# 交接：从这里接着做

写给接手的下一个会话（人或 AI）。写于 2026-11-26，上一轮是在一个云端容器里做的；这一页只记**现在停在哪、剩什么、怎么接**。
为什么这样设计、每个条件的证据，在[第一批真实规模的模型打标签](Tagging-at-scale.md)的「结束对照」里，这里不重复。

怎么读到这一页：两个仓克隆下来它就在引擎仓的 `docs/wiki/Handoff.md`；在引擎仓开会话会自动读 `CLAUDE.md`（它带着 `CONTRIBUTING.md`），
在平台仓开会话会自动读 `CLAUDE.md`（只有一行，导入 `AGENTS.md`），`AGENTS.md` 开头有指到这一页的链接。开场一句话就够：「读引擎仓的 docs/wiki/Handoff.md，按里面的顺序接着做」（在平台仓开的会话里，路径是 `../scholar-meta-visulization/docs/wiki/Handoff.md`）。

## 现在停在哪

| 仓 | 主干 | 状态 |
|---|---|---|
| 引擎 scholar-meta-visulization | 本页所在的提交；包版本 0.6.3（已发版，tag `v0.6.3` 在主干上） | `check` 绿；工作区干净 |
| 平台 scholar-meta-tags | 数据停在 `367cc9b`（issue #12 入库）；之后只有加交接指针的一个文档提交 | `check` / `export` / `replay` 绿；11-24、11-25 两天的定时运行（入库 5 次、导出 5 次、导入 2 次）全部成功、都没有新东西要写；每日存档 `data-2026-11-23`、`-24`、`-25` 都在 |

平台账本：15415 条断言。其中 15176 条是词表打标签器 `smt-vocabulary` 给 2623 篇论文的建议（模型层，不计票），237 条是早先样本脚本的两个模型的，
2 条是按账号的（issue #12，来历见结束对照）。导出 2623 篇、256 片；作品页显示「模型建议 · 不计票」。

## 还剩三件，都要人

目标的七个条件里，A、B、C、E、F、G 有证据；**D 差真实数字**，另有两件「需要人的事」没做。上一轮在云端做不了它们的原因各不相同：

| 事 | 为什么上一轮没做成 | 本地有没有帮助 |
|---|---|---|
| 1 标准答案（解锁 D） | 必须是人读论文后标；模型代标就是模型给模型打分 | 有一点：本地能直接打开论文、能让会话帮你把题录调出来看；判断仍然要人做 |
| 2 两个真实账号的标注走到比例裁决（R18） | 会话只有维护者一个账号，而且它是管理员（按层级一票定，走不到比例规则） | 没有：缺的是第二个人，不是工具 |
| 3 默认分支规则（R19） | 云端的接口代理与会话的安全层都不让改仓库保护设置 | 有：本地用自己的 `gh` 登录就能建，或在设置页点 |

### 1 标准答案

- 给人标的是：把有名片的作品按 `sha256(作品键)` 排序后的**前 60 篇**（第 61–140 篇已被模型参考标注用掉，两边不重叠）。
- 上一轮已经把这 60 篇的工作表作为文件交给维护者。要重新生成（在平台仓根目录；用完把 `_worksheet.mts` 和 `worksheet.txt` 都删掉，不要提交；2026-11-26 实测与交出去的那份逐条相同，与模型参考标注的 80 篇没有重叠）：

  ```ts
  // _worksheet.mts —— npx tsx _worksheet.mts > worksheet.txt
  import { loadWorks, sha256 } from './scripts/lib/store.js'
  const works = [...loadWorks().values()].filter((w) => w.card?.title)
    .sort((a, b) => (sha256(a.work_id) < sha256(b.work_id) ? -1 : 1)).slice(0, 60)
  for (const w of works) console.log(JSON.stringify({ work_id: w.work_id, _title: w.card!.title, _year: w.card!.year,
    tags: '<改成数组：这篇应该有的标签；确实一个都不该有就写 []>', design: null, by: 'gh:<你的 GitHub 数字 id>', at: '<标注时间>' }))
  ```

- **标签用 `vocab/tags.json` 里的显示名来写**（73 个；交出去的那份工作表头上列着，上面的片段不会列）。评估按规范化后的标签键逐个比，不认同义词：词表里有的概念写成别的说法，会同时记一次漏给和一次多给。词表之外的标签可以写，只是模型不会给出它。
- 标的时候**不要看** `data/model-reference/`、`imports/` 和作品页上的模型建议。拿不准的那一篇整行删掉。
- 填好后去掉 `_title` / `_year`，存成 `data/gold/<名字>.jsonl`，开 PR。格式与规则见平台仓 `data/gold/README.md`；没填完的行（`tags` 不是数组）过不了 `pnpm check`。
- 合并后：`pnpm evaluate` 与线上 `quality.json` 的 `models` 一节就有真实的精确率、召回率、F1；把数字与运行号写回结束对照的 D 行，TODO 的 R22 打勾。
- 会话**不许代标**。会话可以做的：生成工作表、把某一篇的题录调出来给人看、合并后核对数字、更新 Wiki。

### 2 两个真实账号走到比例裁决（R18）

- 需要两个互相独立的 GitHub 账号，**在平台仓里都没有 admin / maintain / write 权限，也不在 `config/roles.json` 里**（有的话会按更高的层级直接裁决）。
- 账号注册不满 7 天不会被拒，但那条 issue 会被搁置（标签 `held`），要维护者评论 `/approve` 才入库；`/approve` 本身不算表态，不影响比例裁决。
- **选一篇、一个标签，是还没有任何人表过态的**。不要用 issue #12 那一篇的那两个标签：上面已有维护者层级的表态，再多的普通账号认可也只会显示「按维护者裁决」，走不到比例规则（评审模拟过）。
- 两人各自在标注页打开同一篇论文，打同一个标签，提交 issue。期望看到：两条 issue 的入库回执；该标签在只有一人时是「待定」，第二人认可后按比例规则变成成立（用引擎的 `assessQuorum` 实测过：1 票待定；2 票赞成时置信下界 0.549 > 门槛 0.5，成立）；
  导出里这篇的 `tags` 有它且 `decided_by` 是 `contributor`、带 `quorum`；随后 `check`（带基准）与 `replay` 通过。
- 配置在平台仓 `config/smt.config.json` 的 `quorum`（`min_independent: 2`）。
- 做完把两个 issue 编号、`intake` 运行号写回结束对照与[检测基本盘](Verification-baseline.md)的 G1 行，TODO 的 R18 打勾。

### 3 默认分支规则（R19）

- 设置页：平台仓 Settings → Rules → Rulesets → New branch ruleset，目标选默认分支，勾 Restrict deletions 与 Block force pushes，并把 Enforcement status 设成 Active（新建时默认可能不是生效状态——这一点没能在页面上核实，建完看一眼）。
- 或命令行（**这条命令上一轮没能执行过，载荷没验证；以 GitHub 文档为准**）：

  ```bash
  gh api -X POST repos/sairaisaika/scholar-meta-tags/rulesets --input - <<'JSON'
  {"name":"protect-default-branch","target":"branch","enforcement":"active",
   "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
   "rules":[{"type":"deletion"},{"type":"non_fast_forward"}]}
  JSON
  ```

- 建完要确认两件事：`gh api repos/sairaisaika/scholar-meta-tags/rulesets` 列得出来且 `enforcement` 是 `active`；机器人的普通推送没被挡住。后一件**不能靠定时运行是绿的来判断**——没有新东西要写时它们根本不推送（11-24、11-25 就是这样），`export` 也从不往主干推。要看一次真的写了提交的运行：一条被接受的标注 issue 触发的 `intake`（R18 的那两条正好），或合并了 `imports/` 改动后的 `import`。
- 做完把规则名与观察到的运行号写回[检测基本盘](Verification-baseline.md)的 G2 与 TODO 的 R19。

## 本地怎么搭

两个仓**并排**克隆（平台仓的文档用相对路径 `../scholar-meta-visulization/` 指向这里的 Wiki）：

```bash
git clone https://github.com/sairaisaika/scholar-meta-visulization
git clone https://github.com/sairaisaika/scholar-meta-tags
cd scholar-meta-visulization && pnpm install && pnpm check          # 要几分钟；Node 用 .nvmrc 里的 22（最低 20）、pnpm
cd ../scholar-meta-tags && pnpm install && pnpm typecheck && pnpm test && pnpm check
pnpm exec playwright install chromium && pnpm site:test             # 标注页的浏览器测试；Linux 上缺系统库时加 --with-deps（CI 就是这样装的）
bash scripts/check-private-terms.sh                                 # 平台仓的私有词闸要单独跑，pnpm check 不带它
```

- **私有词表要自己建**：两个仓根各放一份 `.private-terms`（已 gitignore；每行一个不分大小写的正则），列上你自己接入的站点的私有词。内容问维护者，不要写进任何会进仓的文件。没有这份文件，私有词闸什么都拦不住。引擎仓的 `pnpm check` 带着这道闸；平台仓的不带，提交前要自己跑 `bash scripts/check-private-terms.sh`。
- **改了 Wiki 要另外过 Wiki 的闸**（要 Python 3；引擎仓的 `pnpm check` 不带它，CI 里是单独一步）：`python tools/wiki.py build && python tools/wiki.py check`，`python tools/wiki_route.py --build && python tools/wiki_route.py --check`，`python -m unittest discover -s tools -p test_wiki_route.py`。
- 平台仓要求提交用 GitHub 的 noreply 邮箱（见它的 `CONTRIBUTING.md`）；本地克隆默认用的是你机器上的 git 身份，先设好。
- 提交规则在引擎仓 `CLAUDE.md` 与 `CONTRIBUTING.md`：提交前 `pnpm check`；引擎仓直接推 `main`；分支名、提交信息、PR 文字里不出现接入方的任何名字；提交信息不写会话链接。
- 每完成一块实质改动，推送前找一个独立的评审挑错——上一轮每次都挑出了真问题。

本地比云端多出来的：能直接访问外部索引与线上站点（`pnpm site:live https://<账号>.github.io/<仓库>` 可以在本机跑）、`gh` 不受限、能建仓库规则。

## 上一轮踩过、值得带走的

- **机器人开的 PR 不会真的触发 `check`**（那条运行没有任何作业、显示失败）。所以写入的工作流自己带检测节点，`tag` / `sample` 开 PR 后会手动触发一次 `check` 跑在 PR 分支上——这一步还没被真实的下一个 PR 走过，第一次用时盯一下。
- **机器人的推送不触发别的工作流**。要核机器人写入的那一段只追加，用 `check` 的手动触发并给基准提交。
- **外部索引的匿名请求不让用游标翻页**（第二页 401）。取名片用的是「从今年往回、每年取被引最高的一页」。
- **`imports/` 里的包是模型当前的回答**。改了 `vocab/tags.json`、置信门槛、每篇标签上限或所钉的引擎版本，要在同一个提交里 `pnpm tag` 重新出包，否则 `pnpm tag --check` 不过、`import` 会在写入前停住。
- `pnpm import` 是 pnpm 的内置命令；贡献包入库的脚本叫 `pnpm bulk`。
- 定时触发实测每天约 4 次，不是写的每小时 / 每 15 分钟；issue 事件仍然即时触发入库。
- 平台的依赖更新 PR（#5–#10）与引擎的（#1–#6）都没合；两个是红的：平台 #10（升级后 `pnpm typecheck` 不过）、引擎 #6（Wiki 路由快照过期那一步不过）；其余是绿的。不要批量合，逐个验证。
- 平台仓有两个机器人留下的分支 `tag/batch`、`sample/refresh`，可以删。

## 不要做的

- 不手改 `data/assertions/`（只追加）；不把模型的标注放进 `data/gold/`，不把人的账号写进 `data/model-reference/`。
- 不存摘要、原文段落、邮箱。
- 不替任何人提交标注 issue 或标标准答案。issue #12 是维护者明确要求的一次例外，已在结束对照里写明来历；不要当成先例。
- 外部源没问成不等于没有数据：保留上一份、如实报告。

## 之后可以做的（不在这一轮目标里）

见 [TODO](TODO.md) 的 R29：从打标签器自己的包里整条拿掉一篇，可复现检查不会判为不一致；模型不能撤回对某篇的回答；首页还不能按模型建议的标签浏览；只有一个种子主题。
另外，[结束对照](Tagging-at-scale.md)的模型参考标注一节提示打标签器多给的主要是年龄段标签——那是两个模型之间的比较，要有了人标的标准答案才算数。
