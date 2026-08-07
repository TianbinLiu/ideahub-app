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

// 内容安全策略（CSP）：只在生产构建注入 <meta>。
// dev 不注入——@vitejs/plugin-react 的预热脚本是内联的，严格 CSP 会把 dev 直接打挂。
// 各指令的由来：
//   - script-src 'wasm-unsafe-eval'：MeshoptDecoder / ammojs 要实例化 WebAssembly；不含 'unsafe-eval'，内联与外域脚本一律禁止（XSS 主防线）。
//   - style-src 'unsafe-inline'：React/r3f 大量 style 属性 + Tailwind 注入，样式内联不可避免。
//   - img/media/connect-src 收窄到 https:（+data:/blob:）：AI 产物在 *.volces.com / *.volccdn.com，
//     服务器域名按部署可变，故先禁明文 http 与任意 scheme；域名固定后可进一步收窄成白名单。
//   - frame-ancestors/X-Frame-Options 无法用 <meta> 表达，Web 部署时由服务器响应头补（见 docs/security-checklist.md）。
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
].join("; ");

const cspPlugin = () => ({
  name: "inject-csp",
  apply: "build" as const,
  transformIndexHtml(html: string) {
    return html.replace(
      "<meta charset=\"UTF-8\" />",
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    );
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const arkKey = env.ARK_API_KEY ?? "";
  return {
    plugins: [react(), arkFetchPlugin(), cspPlugin()],
    define: {
      // 客户端只知道"有没有钥匙"，不知道钥匙本身
      __AI_REAL__: JSON.stringify(arkKey.length > 0),
    },
    build: {
      // 显式关闭 sourcemap：生产包不携带源码映射（默认虽同为 false，此处固化意图防误开）
      sourcemap: false,
      rollupOptions: {
        output: {
          // 3D 引擎与 React 各自成块：改业务代码不会让用户重新下载 3MB 的 three/ammo，
          // 首页（非 3D 页）也不用等 3D 块下完
          manualChunks(id: string) {
            if (/node_modules[\\/](three|@pixiv|ammojs-typed|@react-three)[\\/]/.test(id)) return "vendor-3d";
            if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|zustand)[\\/]/.test(id)) return "vendor-react";
          },
        },
      },
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
