// 「正则写成字符串再 new RegExp」的形状闸，给几道按正反例实跑的构建检查共用（2026-10-15 教材人格评审，feathers-testing-4）。
//
// ★★ 为什么要有它：`"\d"` 在 JS 字符串里是转义序列，运行时退化成字母 `d` —— 那一档从此永远匹配不上，而且**零症状**
//   （构建过、类型过、不报错；CLAUDE.md 坑表「把正则写成字符串常量再 new RegExp」，canvasAgent 的词表上真栽过）。
//   原来只有 check-cut-grammar 装了一道（而且一刀切拦所有引号开头的实参），agentGrammar / refMentions / shotScript / cutProject
//   四道都没有：下一次有人把 agentGrammar.ts 里的 String.raw`…` 写成普通模板串，`\s` 退成 `s`，脚本照绿。
// ★ 只拦真会坏的那种形状：`new RegExp(` 的实参以 " ' ` 开头、不是 `String.raw` 前缀、而且串里出现**未转义的反斜杠 + 字母**
//   （`(?<!\\)\\[A-Za-z]`）。放行：从字面量 `.source` 派生（实参不是引号开头）、`String.raw`、双写的 `\\s`、
//   只插值 `.source` 的模板串（shotScript.ts:323 `new RegExp(`\\s*[：:]?\\s*(?:${LINE_QUOTE.source})`, "g")` 那种 —— 老闸会误报它）。
// ⚠ 逐行看，所以两种写法管不到、要靠各自脚本的正反例：实参跨行的模板串只看第一行；先把正则源码存进数组再 `.map((s) => new RegExp(s))`
//   （cameraVocab.ts 那种）这里根本看不见 `new RegExp(` 后面跟着什么。

/**
 * @param {string} src 源码全文
 * @param {string} label 报错里的文件名（例 "agentGrammar.ts"）
 * @returns {string[]} 问题行（空数组 = 没问题）
 */
export function regexStringIssues(src, label) {
  const problems = [];
  src.split(/\r?\n/).forEach((ln, i) => {
    // 注释里的示例不算（本文件头上就写着一个）
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    const at = /new RegExp\(\s*/g;
    let m;
    while ((m = at.exec(ln))) {
      const rest = ln.slice(m.index + m[0].length);
      if (rest.startsWith("String.raw")) continue;
      const q = rest[0];
      if (q !== '"' && q !== "'" && q !== "`") continue;
      // 找同一行里配对的收尾引号（跳过被反斜杠转义的那个）；找不到就看到行尾
      let j = 1;
      while (j < rest.length && rest[j] !== q) j += rest[j] === "\\" ? 2 : 1;
      const body = rest.slice(1, j);
      if (/(?<!\\)\\[A-Za-z]/.test(body)) {
        problems.push(
          `${label}:${i + 1}  正则写字面量，别写成字符串再 new RegExp（串里的 \\字母 会静默退化成字母本身；要拼就 String.raw 或从字面量的 .source 派生）：${ln.trim().slice(0, 100)}`,
        );
      }
    }
  });
  return problems;
}
