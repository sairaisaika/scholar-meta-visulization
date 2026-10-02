# 接入指南：把引擎接进一个内容平台

目标：宿主（任何一个有「学术文章 + 标签」的站点）写**三个小适配**、挂**一个路由**，就能给每个标签页、每个主题页出研究图谱。
引擎不认识宿主的数据库、缓存、鉴权与前端框架；下面的例子用 Next.js（App Router），换成别的框架只是换挂载方式。

## 0. 安装

四种方式任选：

- **release 安装包**（推荐）：每个 GitHub release 都挂着编译好的包，
  `pnpm add https://github.com/sairaisaika/scholar-meta-visulization/releases/download/v<版本>/scholar-meta-<版本>.tgz`（npm、yarn 同样用这个链接）。
  装到的是五个入口的 ESM + CJS + 类型声明，不需要 `transpilePackages`；锁文件记下链接与完整性哈希。
- **git 依赖**：`pnpm add github:sairaisaika/scholar-meta-visulization#<tag 或 commit>`。从 git 装到的是 TypeScript 源码，
  Next.js 要在 `next.config` 里加 `transpilePackages: ['scholar-meta']`；Vite、esbuild、React Native（Metro）原生能编译依赖里的 TS。
- **拷贝源码**：把某个 tag 的 `src/` 原样拷进宿主仓编译（零运行时依赖、不引 `node:*`，见 `pnpm typecheck:src`），记下 tag / commit 与逐文件哈希。
- **拷贝契约**：只想要类型时，把 `src/types.ts` 整份拷进宿主仓（它零导入），在宿主 CI 里比对它与本仓逐字节相同，并核对 `EVIDENCE_CONTRACT_VERSION`。

所有浏览器能用的东西（主入口、`/client`）不依赖 `URL`、`URLSearchParams`，没有 `Intl` 时自动降级，React Native / Hermes 上也能跑。

## 1. 学术文章 → `OnsiteArticle`

引擎只读宿主**公开**的文章。每一行映射成下面的形状（除 `id`、`title` 外全部可选——给得越全，阶梯能诚实画到的级别越高）：

| 字段 | 含义 | 验形规则（不合规的会被清掉并回问题码） |
|---|---|---|
| `id` · `title` | 文章 id、标题 | 缺了整篇不收 |
| `tags` | 作者打的标签，原文 | 归一后去重；空的、过长的丢掉；最多 30 个 |
| `year` / `published_at` | 发表年份 / 时间 | 年份 1000 至明年 |
| `authors` | 公开署名 | 别放邮箱等联系方式 |
| `url` · `doi` | 公开地址、DOI | 只收 http(s)；DOI 各种写法归一 |
| `study_design` | 研究设计 | 封闭词表 `EVIDENCE_STUDY_DESIGNS`（rct / cohort / cross_sectional / qualitative / systematic_review / meta_analysis …） |
| `publication_type` | 出版物形态（article / review / commentary …） | 自由文本；**不是**研究设计 |
| `claim` | 作者自报结果类型 | significant / non_significant / mixed / not_applicable；只当标注，不进合成 |
| `direction` | 效应方向 | favours / against / unclear / not_applicable；与点估计矛盾会被改为 unclear |
| `effect` | 效应量：`metric` `value` `ci_low` `ci_high` `n` `p_value` `higher_is_better` | 见 `EVIDENCE_INTAKE_ISSUES`：区间要含点估计、比值 > 0、p 在 (0, 1] …；`value` 可以不填——只有精确 p 与样本量（加上 `direction`）也收，能到信天翁图那一级 |
| `references` | 参考文献 DOI 列表 | 用来按引用给标签推荐主题 |
| `is_public` · `is_retracted` | | `false` / `true` 的整篇不收 |

作者保存文章时，可以顺手把问题清单回给他（引擎不改宿主的数据，只告诉作者哪里不对）：

```ts
import { presentIntakeIssues } from 'scholar-meta'
const { issues } = evidence.intake(articleRow)
return presentIntakeIssues(issues, { locale })   // [{ code, field, action, text }]
```

## 2. 三个端口

```ts
// lib/evidence.server.ts
import 'server-only'
import { createEvidenceService } from 'scholar-meta/service'
import { createOpenAlexSource } from 'scholar-meta/openalex'

export const evidence = createEvidenceService({
  // ① 站内公开文章：按归一后的标签键查（建议在文章标签表里存一列 tag_key，写入时用 scholar-meta 的 normalizeTag 算好）
  onsite: {
    listArticles: ({ tagKeys }) => db.publicArticles({ tagKeys }),   // 没给 tagKeys = 全部公开文章（全站标签图用，可自行封顶）
  },
  // ② 编辑确认的绑定（一张小表，见下）
  bindings: {
    get: (tagKey) => db.tagBindings.findByKey(tagKey),
    listByTopic: (topicId) => db.tagBindings.findByTopic(topicId),
    put: (binding) => db.tagBindings.upsert(binding),
  },
  // ③ 缓存（KV / Redis / 数据库表都行；值是可 JSON 序列化的对象）
  cache: {
    get: (key) => kv.get(key),
    set: (key, value, ttlSeconds) => kv.set(key, value, { ex: ttlSeconds }),
    delete: (key) => kv.del(key),
  },
  // ④ 标签账本（可选；见 docs/tagging.md）：给了就按裁决后的标签计数、画共现图
  workTags: ledger,
  // ⑤ 证据确定性评级（可选；见第 5 节）：编辑或外部综述按结局评好的 GRADE 等级
  certainty: { forScope: (scope) => db.evidenceCertainty.find(scope) },
  // 外部文献源（可选；不配就只有站内层）
  external: createOpenAlexSource({
    apiKey: () => process.env.OPENALEX_API_KEY,   // 只进 Authorization 头，永不进 URL 与日志
    dailyCreditBudget: 5000,                      // 必设：见第 7 节
  }),
  onsiteLabel: '<站名>',          // 脚注里的来源名
  onsiteLicense: 'CC BY 4.0',     // 站内文章的许可
  machineBinding: 'first_hit',    // 或 'exact_only' / 'off'，见 docs/tags.md 原则三
})
```

绑定表（PostgreSQL 示意）：

```sql
create table evidence_tag_bindings (
  tag_key    text primary key,          -- normalizeTag(tag)
  topic_id   text,                      -- 'openalex:T10537'；null = 编辑否决
  topic_name text,
  kind       text not null check (kind in ('curated', 'rejected', 'machine')),
  confidence text,
  bound_at   timestamptz not null,
  bound_by   text,                      -- 编辑的内部标识，不放个人信息
  note       text
);
create index on evidence_tag_bindings (topic_id);
```

标签账本（可选，PostgreSQL 示意；`ledger = createTagLedger({ store, policy })`，规则见 [tagging.md](tagging.md)）：

```sql
create table evidence_tag_assertions (          -- 只追加，不改不删
  id            text primary key,
  work_id       text not null,                  -- normalizeWorkId(...)：openalex:W… / doi:… / onsite:…
  tag_key       text not null,
  tag_label     text not null,
  op            text not null check (op in ('add', 'remove')),
  actor_kind    text not null check (actor_kind in ('person', 'model')),
  actor_id      text not null,                  -- 假名化的账号 id（见第 7 节），或 <账号>/<模型 id>
  actor_tier    text not null,
  model_version text,
  confidence    real,
  at            timestamptz not null,
  note          text,
  request_id    text
);
create index on evidence_tag_assertions (work_id);

create table evidence_tag_change_requests (
  id text primary key, work_id text not null, changes jsonb not null, by jsonb not null, reason text not null,
  status text not null, created_at timestamptz not null, decided_at timestamptz, decided_by jsonb, decision_note text
);
create index on evidence_tag_change_requests (status, work_id);
```

## 3. 读口：挂一个路由

```ts
// app/api/evidence/[...path]/route.ts
import { createEvidenceHandler } from 'scholar-meta/http'
import { evidence } from '@/lib/evidence.server'

export const GET = createEvidenceHandler(evidence, { basePath: '/api/evidence' })
export const HEAD = GET
```

| 读口 | 返回 |
|---|---|
| `GET /api/evidence/map?tag=ADHD` | `EvidenceMapData`（标签级） |
| `GET /api/evidence/map?level=topic&id=T10537` | `EvidenceMapData`（缩放） |
| `GET /api/evidence/counts?level=topic&id=T10537&scope=primary_topic` | `EvidenceCountsData` |
| `GET /api/evidence/tags/counts?tag=ADHD` | `EvidenceOnsiteCounts` |
| `GET /api/evidence/tags/graph?focus=ADHD&min_support=2` | `EvidenceTagGraph` |

状态码：400 参数不合法 · 404 节点不存在 · 501 端口没配 · 503 这次没取到（带 `Retry-After`，读者看到「暂时取不到」，**不是**「没有研究」）。
成功响应与读者无关，缺省 `Cache-Control: public, max-age=300, stale-while-revalidate=86400`，可以走 CDN。

## 4. 页面：拿数据、交给视图模型、画

服务端组件里直接调服务（不经 HTTP）：

```tsx
// app/tags/[tag]/evidence.tsx（服务端组件）
import { presentEvidenceMap, presentChartMenu } from 'scholar-meta'
import { evidence } from '@/lib/evidence.server'

export async function TagEvidence({ tag, locale }: { tag: string; locale: string }) {
  const r = await evidence.getTagMap(tag)
  if (!r.ok) return <p>{r.error === 'unavailable' ? '暂时取不到，稍后再试' : null}</p>
  const v = presentEvidenceMap(r.data, { locale })
  return (
    <section>
      <h2>{v.title}</h2>
      {v.binding && <p>{v.binding.text}</p>}
      {v.notices.map((n) => <p key={n} role="note">{n}</p>)}
      <p>{v.view.title}</p>
      {v.view.why_not_higher && <p>{v.view.why_not_higher}</p>}
      <ul>{v.caveats.map((c) => <li key={c.key}>{c.text}</li>)}</ul>
      <footer>{v.footnotes.map((f) => <small key={f}>{f}</small>)}</footer>
    </section>
  )
}
```

**只用站内层**（不经门面，自己取记录、自己挂路由）：`countOnsiteLayer(records, { scope, dimensions, sampleGates })`。
`dimensions` 只下发要的几维格子（`availability` 仍覆盖全部站内维度）；`sampleGates` 是宿主自己的产品样本门——
某一维有值的篇数（`onsiteValueCount`）不到 N，这一维除主题图与清单外先不画，格子上回显 `sample_gate: { min, n, ok }`。
引擎的比例门槛（读占比的图至少 30 篇，`MIN_ONSITE_FOR_SHARE_CHARTS`）是方法学门槛，照常叠加，不做成设置。

客户端组件用类型化客户端（只打宿主自己的读口）：

```tsx
'use client'
import { useEffect, useState } from 'react'
import { createEvidenceClient } from 'scholar-meta/client'
import { presentTagGraph } from 'scholar-meta'
import type { TagGraphView } from 'scholar-meta'

const client = createEvidenceClient()          // 缺省 baseUrl '/api/evidence'

export function TagGraph({ tag, locale }: { tag: string; locale: string }) {
  const [view, setView] = useState<TagGraphView | 'failed' | null>(null)
  useEffect(() => {
    let live = true
    client.getTagGraph({ focus: tag }).then((g) => { if (live) setView(g ? presentTagGraph(g, { locale }) : 'failed') })
    return () => { live = false }
  }, [tag, locale])
  if (view === 'failed') return <p>暂时取不到，稍后再试</p>   // 失败 ≠ 没有数据：别画空图
  if (!view) return null
  // nodes[i].size ∈ (0,1]（面积 ∝ 篇数）；edges[i].strength 给布局、width 给线宽；caption 与 caveats 印在图下
  return <YourForceGraph nodes={view.nodes} edges={view.edges} caption={[...view.caption, ...view.caveats.map((c) => c.text)]} />
}
```

视图模型里已经算好了：百分比（只用声明的分母）、Wilson 区间、`reliability`（分母 < 30 时 `share` 为 null，只画计数）、
`sum_exceeds_denominator`（为 true 时禁止饼图与 100% 堆叠）、`provisional`（画虚线）、图注与出处。组件只管排版。

更多语言：照 `EvidenceMessageCatalog` 写一份词典（类型会逼你写全），传 `{ messages }` 给任何 `present*` 函数。
自己写界面文案时也一样：按契约的联合类型定型（`satisfies Record<EvidenceChartBlocker, string>`，别用 `as Record<string, string>`），
测试遍历契约的运行时数组（`EVIDENCE_CHART_BLOCKERS` 等）。契约只做加法，上游加了成员，tsc 当场指出哪句没写，界面不会印出 `undefined`。

## 5. 偏倚风险与证据确定性（可选）

引擎**不评**这两样：评偏倚风险要读全文、按工具逐个领域判断，评证据确定性要看整组研究、按结局判断，都要有资质的人来做。
接入方把评好的结果传进来，引擎核形状、如实转述（带上是谁评的），只在两处用它：

- **图上逐项标出**：森林图每一行旁边一格，颜色按 `presentRiskOfBias(...).band`，文字永远是工具自己的判断；没评过的标「未评估」，**不当成低风险**；
- **汇总时另给一个敏感性分析**：参与汇总的研究里有偏倚风险高的（RoB 2「高」、ROBINS-I「严重」「极严重」、其他工具「高」），
  `poolEvidence` 去掉它们再判、再算一遍，放在 `pooling.sensitivity`；主分析不变（Cochrane Handbook v6.5 §10.14）。剩下的不到 5 项就只给理由、不给数。

**偏倚风险**跟着文章走（`OnsiteArticle.risk_of_bias`），由编辑或外部系统综述评，**不让作者自评**：

```ts
{ id, title, /* … */ risk_of_bias: { tool: 'rob2', overall: 'some_concerns', source: '<谁评的>' } }
```

| 工具 | `tool` | `overall` 的档位 |
|---|---|---|
| RoB 2（随机试验） | `rob2` | `low` · `some_concerns` · `high` |
| ROBINS-I（干预的非随机研究） | `robins_i` | `low` · `moderate` · `serious` · `critical` · `no_information` |
| 其他工具 | `other` | `low` · `some_concerns` · `high` · `unclear` |

`source` 必填。工具认不出、档位对不上、没写来源都整条不收，并在入库问题里说明（`unknown_rob_tool` / `rob_judgement_invalid` / `rob_source_missing`）。

**证据确定性**（GRADE）按结局评，不跟着文章走：存在接入方自己的表里，经 `CertaintySource` 按范围交给服务
（标签级 `{ level: 'tag', id: 标签键 }`，主题级 `{ level: 'topic', id: 'openalex:T…' }`）。回 `[]` ＝ 没有评级；回 `null` 或抛错 ＝ 这次没取到（页面会说「没取到」，不说「没有」）。

```sql
create table evidence_certainty (
  scope_level    text not null,       -- 'tag' / 'topic' / 'subfield' / …
  scope_id       text not null,       -- 标签键，或 '<source>:<external_id>'
  level          text not null check (level in ('high', 'moderate', 'low', 'very_low')),
  outcome        text not null,       -- 评的是哪个结局
  source         text not null,       -- 谁评的
  url            text,                -- 出处（只收 http / https）
  rated_down_for text[],              -- risk_of_bias / inconsistency / indirectness / imprecision / publication_bias
  rated_up_for   text[]               -- large_effect / dose_response / plausible_confounding
);
create index on evidence_certainty (scope_level, scope_id);
```

页面上：`presentEvidenceMap(map)` 的 `risk_of_bias`（概况一句话）、`certainty`（每条评级：GRADE 符号、等级、结局、谁评的、升降级理由、这一档的标准含义）、
`view.sensitivity_text`（敏感性那一句）。不用服务层的接入方：`checkRiskOfBias` / `checkCertainty` 验形，再交给 `presentRiskOfBias` / `presentCertainty`。

## 6. 编辑后台（要鉴权）

候选、待办队列与绑定**不在**公开读口里，宿主在自己的后台路由里调。编辑的日常流程：
`bindingQueue()` 看哪些标签还没有结论（按文章数排）→ `suggestBindings(tag)` 看按名字与按引用的证据 → `curate(...)` 确认或否决。

```ts
// app/admin/api/evidence/bindings/route.ts
import { presentBindingSuggestions } from 'scholar-meta'
import { evidence } from '@/lib/evidence.server'

export async function GET(req: Request) {
  await requireEditor(req)
  const tag = new URL(req.url).searchParams.get('tag') ?? ''
  const r = await evidence.suggestBindings(tag)              // 按名字 + 按引用两路证据
  return Response.json(r.ok ? presentBindingSuggestions(r.data, { locale: 'zh' }) : r)
}
export async function POST(req: Request) {
  const editor = await requireEditor(req)
  const { tag, topic_id, note } = await req.json()            // topic_id: null ＝ 否决
  return Response.json(await evidence.curate({ tag, topic_id, by: editor.id, note }))
}
```

标签账本的写口（断言、提申请、审核、撤回、收交换包）同样只在后台路由里、要鉴权：先把登录用户映射成 `actor`（`kind` · `id` · `tier`），
再调 `ledger.assert` / `requestChange` / `decide` / `withdraw`；拒绝码用 `getMessages(locale).ledgerRefusal[code]` 出人话。流程与规则见 [tagging.md](tagging.md)。

### 后台插件页（设置与同步）

设置值存在接入方自己的库里，入口吃整包：给了的键压过代码里的选项，认不出的键（来自更新的版本）忽略、不报错。

```ts
import { createLiveSettings } from 'scholar-meta'
import { createOpenAlexClient } from 'scholar-meta/openalex'

export const pluginSettings = createLiveSettings(() => db.pluginSettings.get('scholar-meta'))   // 读库函数；带短缓存
export const evidence = createEvidenceService({ /* …端口… */ settings: pluginSettings })
export const openalex = createOpenAlexClient({ apiKey: () => process.env.OPENALEX_API_KEY }, pluginSettings)
// 后台保存设置后调 pluginSettings.refresh()，不用等缓存过期
```

- 设置页：`presentSettingsForm(values, issues, { locale })`，按注册表自动出分组、单位、生效方式；新版本加的设置项自动出现。
- 同步：仓根的 `scholar-meta.manifest.json` 与代码随同一个提交到；同步任务取来后用 `diffPluginManifests(已装, 候选)` 给管理员看差别。
- 密钥：清单的 `secrets` 只说要哪个、建议的环境变量名、交给哪个入口；值只放在服务器的环境变量里，后台只显示配没配。

## 7. 额度、隐私与滥用

- **只在服务端调外部源**：读者在看某个健康话题时，浏览器直连第三方会把「谁在关心什么」连同 IP 交出去。`scholar-meta` 主入口与 `scholar-meta/client` 的依赖图里没有任何出网代码（`pnpm check:boundary` 钉着）。
- **防滥用闸**（缺省开）：只有出现在公开文章里、或编辑绑过的标签才会去问外部源；读者随手输入的字符串不会变成对第三方的查询。
- **每日预算**：计数读口一个节点冷启动约 17 credit。设 `dailyCreditBudget`（UTC 日），花完后收费请求直接回「暂时取不到」，免费请求（自动补全、按 id 取实体）照常。多实例部署用 `onCredits` 接宿主自己的共享计数，并用共享缓存（否则每个实例各花一遍）。
- **节点读口**可以再加一道 `allowNode(level, id)`（比如只放行绑定过的主题及其上级）；读口本身再配宿主的限流。
- 日志里只有路由名、错误信息与计数，不含读者标识；API key 永不进 URL、日志与出处字段。
- **标签账本只追加、不删**：断言里的 `actor.id` 用不可逆的假名（比如宿主自己保管盐的哈希），显示名另表另查；
  账本里不放邮箱、真名。这样账号注销时删掉对照表即可，审计链不用改写。

## 8. 升级

### 从 0.2 到 0.3

- **破坏性一处**：`EvidenceEffect.value` 可以是 `null`（没有点估计，只有精确 p 与样本量——这样的研究能进信天翁那一级）。
  读 `effect.value` 的地方改用 `pointEstimate(effect)`（有限的数才返回，否则 `null`）；TypeScript 会把要改的地方都标出来。旧写法 `NaN` 引擎照样当作「没有」。
- `resolveTopicForTag` 配上时多带 `confidence`（`exact` / `first_hit`），并且候选里有同名主题时取同名的（以前只看第一条）；
  对整个返回对象做相等断言的测试要加上这个字段。服务层的机器绑定同样优先同名候选，它的缓存键换了，升级后第一次请求会重新问一次（自动补全 0 credit）。
- 汇总那句话的数字：同一句里同一个小数位，负号用 U+2212（`−`）；按字符串断言的测试跟着改。
- 其余都是加法：偏倚风险、证据确定性、敏感性分析（第 5 节），入库问题 `ci_without_estimate` 等。

### 从 0.1 到 0.2

- 站内来源的 `source` 值改为 `'onsite'`，记录 id 前缀随之变成 `onsite:`；按旧 id 存的缓存作废即可。
- `EvidenceCaveat` 从 dimensions.ts 挪进了契约，从 `scholar-meta` 主入口导入不受影响。
- 信天翁级现在真的要求精确 p（`effect.p_value`）；汇总另要求同一结局方向与同一研究设计。
- 其余都是加法：可选字段、联合成员、新入口。
