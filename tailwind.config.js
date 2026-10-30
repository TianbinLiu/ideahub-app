import colors from "tailwindcss/colors";

import colors from "tailwindcss/colors";

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
        // ★ 品牌色与金色是一整条阶梯（2026-10-23，《Refactoring UI》§5.2.2 主色要有 5~10 阶）：brand 就是 Tailwind sky-400、gold 就是 amber-400，
        //   所以阶梯直接借 sky / amber 的，DEFAULT 钉住原来那两个值 —— `bg-brand` / `bg-gold` 一个像素都没变，只是 `brand-200`、`gold-700` 这类从此可用，
        //   淡色不必再拿 `/15` 透明度拼。
        brand: { ...colors.sky, DEFAULT: "#38bdf8" },
        gold: { ...colors.amber, DEFAULT: "#fbbf24" },
        // ★ 语义色只写别名（§5.2.3「组件永远不点名色相」）：danger = rose、warn = amber、ok = emerald、info = sky，**同一张表**，
        //   换名字那一拍一个颜色都没变。组件里不再出现 rose- / amber- / emerald-（构建里 check-warn.mjs 的第二条规则钉着）；
        //   以后要整体调一次警示色，只改这里。sky 保留原名：它在本仓既是 info 也是装饰色，先不动。
        danger: colors.rose,
        warn: colors.amber,
        ok: colors.emerald,
        info: colors.sky,
      },
    },
  },
  plugins: [],
};
