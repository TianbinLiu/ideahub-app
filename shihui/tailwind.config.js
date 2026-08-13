/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 水墨纸本配色：整个 App 固定"宣纸底 + 墨色字 + 朱砂点缀"，不做暗色模式——
        // 纸就是纸，跟随系统反色会把水墨画面变成负片。
        paper: "#f7f3ea",
        ink: "#2b2b28",
        cinnabar: "#b3432b",
        mist: "#8a877d",
      },
      fontFamily: {
        kai: ["Kaiti SC", "KaiTi", "STKaiti", "楷体", "serif"],
      },
    },
  },
  plugins: [],
}
