/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        panel: "#111a33",
        // 第三级表面（2026-10-23，《Refactoring UI》走查 Systemic ①）：ink 与 panel 只差 1.10:1，于是浮层 / 停靠栏各自写死十六进制、
        // 卡片全靠边框分层。raised 给**浮在页面之上**的东西（新手引导卡、生成胶囊、画布上的浮条、剪辑页与工作流页底部停靠栏、工坊弹层），
        // 配 ring-1 ring-white/10，不再描 slate 边。页面里的卡片仍是 panel + border（那一层别动，CLAUDE.md 的卡片容器约定）
        raised: "#192645",
        brand: "#38bdf8",
        gold: "#fbbf24",
      },
    },
  },
  plugins: [],
};
