import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

// ★ 与 ideahub-app 同一套真假切换约定：有 ARK_API_KEY 才算"真 AI 构建"。
//   骨架阶段 real 实现是空壳，__AI_REAL__ 恒为 false 也能完整跑通全部页面（全走 mock）。
//   注意 ideahub 的教训：mock 是静默的，页面上必须有可见标识（见 App.tsx 的 MockBadge），
//   不要让"没配 key"变成一个只有开发者自己知道的状态。
export default defineConfig(({ mode }) => {
  // ESM 配置文件里没有 __dirname；loadEnv 用 cwd（vite 总是从本目录启动）
  const env = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react()],
    define: {
      __AI_REAL__: JSON.stringify(Boolean(env.ARK_API_KEY)),
    },
    server: {
      port: 5174, // 主 App dev 用 5173/5178，错开
      strictPort: true,
    },
  }
})
