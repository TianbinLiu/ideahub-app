import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 火山方舟代理：API Key 只存在于 .env.local 的 ARK_API_KEY（无 VITE_ 前缀=永不进客户端包），
// 由 dev 服务器在转发时注入 Authorization——浏览器端与仓库都接触不到 Key。
// 生产/App 版需换成真实后端代理（ideahub-server 扩展），此处仅覆盖开发与本机运行。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const arkKey = env.ARK_API_KEY ?? "";
  return {
    plugins: [react()],
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
