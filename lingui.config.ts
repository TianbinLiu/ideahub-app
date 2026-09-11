// Lingui 目录配置（多语言方案 D6，2026-09-10 第 1 批接线）。
// ★ 源语言是中文：界面文案就写中文，宏把它当 msgid；zh.po 的 msgstr 留空，编译时自动用源文填。
// ★★ 必须关行号（format-po 默认 lineNumbers:true）：开着的话任何 UI 文件挪一行，build 里那步 extract
//   就会改写入仓的 .po —— 十几个 worktree 并行时冲突成常态，land 与 CI 的「目录没提交」闸也会恒红。
import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "zh",
  locales: ["zh", "en"],
  format: formatter({ lineNumbers: false }),
  catalogs: [{ path: "<rootDir>/src/locales/{locale}", include: ["<rootDir>/src"] }],
});
