import { defineConfig } from 'tsup'

// 五个入口各自打包（不拆共享块）：浏览器入口（index / client）的产物里就不会混进服务端代码，scripts/check-dist.mjs 逐个核对。
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    service: 'src/service.ts',
    http: 'src/http.ts',
    openalex: 'src/openalex.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2020',
})
