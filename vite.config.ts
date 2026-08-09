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
 * ARK_API_KEY 在这里一点用都没有，必须另外开通、另配 TTS_API_KEY。
 *
 * 走 V3 SSE（api/v3/tts/unidirectional/sse），协议 2026-08-09 实测确认过，不是照文档猜：
 *   请求头 X-Api-Key + X-Api-Resource-Id
 *   响应是 text/event-stream，每帧两行——
 *     event: 352                    ← TTSResponse（音频）；153 = SessionFailed
 *     data: {"code":0,"message":"","data":"<base64 mp3 分片>","sentence":…}
 *   所有帧的 data 按序 base64 解码首尾相接就是完整 mp3。一条 25 字台词回 18 帧 ≈49KB。
 *
 * ★ 为什么不是 V1：V1 要的是**旧版控制台**的 appid + access_token
 *   （Authorization: Bearer;<token>），而新版控制台只发一个 API Key。手上是新版 key，
 *   V1 那条路根本走不通。V3 顺带还解锁了 2.0 音色与 context_texts 语音指令。
 *
 * ★ resource id 决定**用哪代模型、也决定计费商品**，两代要在控制台各自开通：
 *     seed-tts-2.0 → 只能调 2.0 音色（*_uranus_*）
 *     seed-tts-1.0 → 只能调 1.0 音色（*_moon_* / *_mars_*）
 *   本账号实测 1.0 **未开通**（45000030 requested resource not granted），2.0 可用。
 *   所以音色清单（src/studio/voices.ts）只收 2.0。
 *
 * 没配密钥就 404，前端据此自动退回浏览器内置合成器（见 src/studio/speech.ts）。
 */
const ttsPlugin = (apiKey: string) => ({
  name: "doubao-tts",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use(async (
      req: { url?: string; method?: string; on: (ev: string, fn: (c?: unknown) => void) => void },
      res: NodeJS.WritableStream & { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: unknown) => void },
      next: () => void,
    ) => {
      if (req.url !== "/api/tts" || req.method !== "POST") return next();
      if (!apiKey) {
        res.statusCode = 404;
        return res.end("tts not configured");
      }
      try {
        const chunks: Buffer[] = [];
        await new Promise<void>((ok) => {
          req.on("data", (c) => chunks.push(Buffer.from(c as Uint8Array)));
          req.on("end", () => ok());
        });
        const { text, voice, emotion, instruct } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          text: string;
          voice?: string;
          emotion?: string;
          /** 2.0 专属的"语音指令"：一句自然语言，如"你能用更冷静的语气说吗" */
          instruct?: string;
        };
        const speaker = voice || "zh_female_gaolengyujie_uranus_bigtts";
        const is20 = /uranus/.test(speaker);
        const up = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
            "X-Api-Resource-Id": is20 ? "seed-tts-2.0" : "seed-tts-1.0",
            "X-Api-Connect-Id": globalThis.crypto.randomUUID(),
          },
          body: JSON.stringify({
            user: { uid: "ideahub" },
            req_params: {
              // 官方限制文本 ≤1024 字节（UTF-8），且建议 <300 字符
              text: String(text ?? "").slice(0, 300),
              speaker,
              audio_params: {
                format: "mp3",
                sample_rate: 24000,
                // 不主动设 bit_rate 的话 mp3 会掉到 8k，音质损耗很明显（官方注解）
                bit_rate: 64000,
                ...(emotion ? { emotion, emotion_scale: 4 } : {}),
              },
              // ★ additions 的类型是 **jsonstring**（不是 object），传成对象会被整个忽略
              additions: JSON.stringify({
                // 《AI 生成合成内容标识办法》（2025-09-01 施行）要求音频类加显式标识；
                // 火山原生支持"在合成结尾增加音频节奏标识"。上架硬性义务，不是可选项
                aigc_watermark: true,
                // 括号里的旁白（"（从口袋里抽出一叠卡）"）不该念出来
                max_length_to_filter_parenthesis: 100,
                ...(is20 && instruct ? { context_texts: [instruct] } : {}),
              }),
            },
          }),
        });
        const sse = await up.text();
        const parts: Buffer[] = [];
        let errCode = 0;
        let errMsg = "";
        for (const line of sse.split("\n")) {
          if (!line.startsWith("data:")) continue;
          let j: { code?: number; message?: string; data?: string };
          try {
            j = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (j.code && j.code !== 0) {
            errCode = j.code;
            errMsg = j.message ?? "";
          }
          if (typeof j.data === "string" && j.data) parts.push(Buffer.from(j.data, "base64"));
        }
        if (!parts.length) {
          // 把最常见的失败翻成人话——原始 message 全是英文且指向不明
          const hint =
            errCode === 45000030
              ? `资源未开通：控制台要单独开通${is20 ? "「豆包语音合成模型2.0」" : "「大模型语音合成」(1.0)"}`
              : /quota/.test(errMsg)
                ? "额度用完了，去控制台看试用/正式版用量"
                : errCode === 45000001 || up.status === 401 || up.status === 403
                  ? "鉴权失败：检查 .env.local 的 TTS_API_KEY"
                  : "";
          res.statusCode = 502;
          return res.end(`tts ${up.status} code=${errCode || "?"} ${hint || errMsg}`.slice(0, 240));
        }
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "no-store");
        res.end(Buffer.concat(parts));
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
  const ttsKey = env.TTS_API_KEY ?? "";
  return {
    plugins: [react(), arkFetchPlugin(), ttsPlugin(ttsKey), cspPlugin()],
    define: {
      // 客户端只知道"有没有钥匙"，不知道钥匙本身
      __AI_REAL__: JSON.stringify(arkKey.length > 0),
      // 同理：客户端只知道"有没有云端嗓子"，不知道凭据本身
      __TTS_REAL__: JSON.stringify(ttsKey.length > 0),
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
