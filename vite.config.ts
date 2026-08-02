import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 火山方舟代理：API Key 只存在于 .env.local 的 ARK_API_KEY（无 VITE_ 前缀=永不进客户端包），
// 由 dev 服务器在转发时注入 Authorization——浏览器端与仓库都接触不到 Key。
// 生产/App 版需换成真实后端代理（ideahub-server 扩展），此处仅覆盖开发与本机运行。
/** 取图中间件：方舟产物在 TOS 域名且不带 CORS 头，浏览器直接 fetch 会被拦截
 *  （落地 dataURL 入库必须读到二进制）。开发期由 dev 服务器代取，同源返回。 */
const arkFetchPlugin = () => ({
  name: "ark-asset-fetch",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use(async (req: { url?: string }, res: NodeJS.WritableStream & { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: unknown) => void }, next: () => void) => {
      if (!req.url?.startsWith("/api/asset?")) return next();
      try {
        const target = new URL(req.url, "http://localhost").searchParams.get("url");
        if (!target || !/^https:\/\/[\w.-]+\.(volces|volccdn)\.com\//.test(target)) {
          res.statusCode = 400;
          return res.end("bad url");
        }
        const up = await fetch(target);
        if (!up.ok) {
          res.statusCode = up.status;
          return res.end("upstream " + up.status);
        }
        res.setHeader("Content-Type", up.headers.get("content-type") ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.end(Buffer.from(await up.arrayBuffer()));
      } catch (e) {
        res.statusCode = 502;
        res.end(String(e));
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const arkKey = env.ARK_API_KEY ?? "";
  return {
    plugins: [react(), arkFetchPlugin()],
    define: {
      // 客户端只知道"有没有钥匙"，不知道钥匙本身
      __AI_REAL__: JSON.stringify(arkKey.length > 0),
    },
    server: {
      port: 5178,
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
  };
});
