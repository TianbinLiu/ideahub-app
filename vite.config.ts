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

/**
 * 豆包语音合成（openspeech）代理。**与方舟是两套完全不同的东西**——不同域名
 * （openspeech.bytedance.com vs ark.cn-beijing.volces.com）、不同鉴权、不同控制台，
 * ARK_API_KEY 在这里一点用都没有，必须另外开通、另外配 TTS_APPID / TTS_TOKEN。
 *
 * 走自写 middleware 而不是 server.proxy：V1 的鉴权头是
 *   Authorization: Bearer;<token>          ← **是分号不是空格**，写错报 requested grant not found
 * 而且 appid/cluster 要塞进 body，proxy 改不了 body。
 *
 * 没配密钥就 404，前端据此自动退回浏览器内置合成器（见 src/studio/speech.ts）。
 */
const ttsPlugin = (appid: string, token: string) => ({
  name: "doubao-tts",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use(async (
      req: { url?: string; method?: string; on: (ev: string, fn: (c?: unknown) => void) => void },
      res: NodeJS.WritableStream & { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: unknown) => void },
      next: () => void,
    ) => {
      if (req.url !== "/api/tts" || req.method !== "POST") return next();
      if (!appid || !token) {
        res.statusCode = 404;
        return res.end("tts not configured");
      }
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((ok) => {
          req.on("data", (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.on("end", () => ok());
        });
        const { text, voice, speed } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          text: string;
          voice?: string;
          speed?: number;
        };
        const up = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer;${token}` },
          body: JSON.stringify({
            // token 这一项官方原话是"无实际鉴权作用的 fake token"，真正的鉴权在 header
            app: { appid, token: "x", cluster: "volcano_tts" },
            user: { uid: "ideahub" },
            audio: {
              voice_type: voice || "zh_female_linjianvhai_moon_bigtts",
              encoding: "mp3",
              speed_ratio: speed ?? 1.0,
              rate: 24000,
            },
            request: {
              // reqid 每次必须是新的 UUID，复用会被判成重放
              reqid: globalThis.crypto.randomUUID(),
              text: String(text ?? "").slice(0, 300),
              operation: "query",
            },
          }),
        });
        const j = (await up.json()) as { code?: number; data?: string; message?: string };
        if (!up.ok || j.code !== 3000 || !j.data) {
          res.statusCode = 502;
          return res.end(`tts ${up.status} ${j.code ?? ""} ${j.message ?? ""}`.slice(0, 200));
        }
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "no-store");
        res.end(Buffer.from(j.data, "base64"));
      } catch (e) {
        res.statusCode = 502;
        res.end(String(e).slice(0, 200));
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
  // 豆包语音（openspeech）：与 ARK_API_KEY 是两套凭据，见 ttsPlugin 的注释
  const ttsAppid = env.TTS_APPID ?? "";
  const ttsToken = env.TTS_TOKEN ?? "";
  return {
    plugins: [react(), arkFetchPlugin(), ttsPlugin(ttsAppid, ttsToken), cspPlugin()],
    define: {
      // 客户端只知道"有没有钥匙"，不知道钥匙本身
      __AI_REAL__: JSON.stringify(arkKey.length > 0),
      // 同理：客户端只知道"有没有云端嗓子"，不知道凭据本身
      __TTS_REAL__: JSON.stringify(ttsAppid.length > 0 && ttsToken.length > 0),
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
