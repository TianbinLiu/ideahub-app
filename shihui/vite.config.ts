import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

// ★ 与 ideahub-app 同一套真假切换约定：有 ARK_API_KEY 才算"真 AI 构建"。
//   密钥无 VITE_ 前缀=永不进客户端包，由 dev 服务器在转发时注入 Authorization。
//   mock 是静默的，页面上必须有可见标识（App.tsx 的角标）。

/** 取产物中间件：方舟产物在 TOS 域且不带 CORS 头，浏览器读二进制（落库/canvas 抽尾帧）
 *  必须由 dev 服务器代取同源返回。形状照抄主仓 vite.config.ts 的 arkFetchPlugin。 */
const arkAssetPlugin = () => ({
  name: "ark-asset-fetch",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use(
      async (
        req: { url?: string },
        res: NodeJS.WritableStream & { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: unknown) => void },
        next: () => void,
      ) => {
        if (!req.url?.startsWith("/api/asset?")) return next()
        try {
          const target = new URL(req.url, "http://localhost").searchParams.get("url")
          // 白名单只放方舟产物域：这个代理能替浏览器发任意 GET，不锁域就是个开放代理
          if (!target || !/^https:\/\/[\w.-]+\.(volces|volccdn)\.com\//.test(target)) {
            res.statusCode = 400
            return res.end("bad url")
          }
          const up = await fetch(target)
          if (!up.ok) {
            res.statusCode = up.status
            return res.end("upstream " + up.status)
          }
          res.setHeader("Content-Type", up.headers.get("content-type") ?? "application/octet-stream")
          res.setHeader("Cache-Control", "no-store")
          res.end(Buffer.from(await up.arrayBuffer()))
        } catch (e) {
          res.statusCode = 502
          res.end(String(e))
        }
      },
    )
  },
})

export default defineConfig(({ mode }) => {
  // ESM 配置文件里没有 __dirname；loadEnv 用 cwd（vite 总是从本目录启动）
  const env = loadEnv(mode, process.cwd(), "")
  const arkKey = env.ARK_API_KEY ?? ""
  return {
    plugins: [react(), arkAssetPlugin()],
    define: {
      __AI_REAL__: JSON.stringify(Boolean(arkKey)),
    },
    server: {
      port: 5174, // 主 App dev 用 5173/5178，错开
      strictPort: true,
      proxy: {
        "/api/ark": {
          target: "https://ark.cn-beijing.volces.com",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/ark/, "/api/v3"),
          headers: arkKey ? { Authorization: `Bearer ${arkKey}` } : {},
        },
      },
    },
  }
})
