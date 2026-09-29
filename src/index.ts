/**
 * 主入口：契约类型 + 纯判据 + 读者筛选 + 纯生产 / 消费函数（零 IO、零框架依赖，服务端 / 浏览器 / 移动端都能直接用）。
 * 会出网的东西**不从这里导出**，各走单独入口——免得浏览器端的打包把出网代码一起带进去
 * （多人站点里读者 IP 会连同他在看的话题一起发给第三方）：
 *   · `scholar-meta/openalex`  OpenAlex 适配器（服务端）
 *   · `scholar-meta/service`   给宿主用的门面：一个函数把站内文章、编辑绑定、外部源、缓存装配起来（服务端）
 *   · `scholar-meta/http`      Web 标准 Request → Response 的读口（服务端；Next.js Route Handler / Workers / Deno / Bun 直接挂）
 *   · `scholar-meta/client`    浏览器端的类型化读口客户端（只打宿主自己的 API，不直连第三方）
 */
export * from './types'
export * from './ladder'
export * from './charts'
export * from './dimensions'
export * from './effects'
export * from './stats'
export * from './tags'
export * from './onsite'
export * from './messages'
export * from './present'
export * from './guards'
export * from './features'
export * from './filters'
export * from './settings'
export * from './manifest'
export * from './tagging'
export * from './ledger'
