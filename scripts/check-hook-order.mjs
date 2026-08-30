// 构建门禁：**组件里不许把 hook 写在早退之后**。
//
// ★★ 为什么值得单开一个检查（这是拿三次事故换来的）：一旦某个 `use*()` 排在
//   `if (x) return …` 后面，那一格状态从有变无的那一拍 hook 数就对不上，React 抛
//   「Rendered fewer/more hooks than expected」—— **整棵树当场崩**。而工坊/画布/剪辑页
//   都没有 ErrorBoundary，屏幕上是一块**空白**，不是一条报错。用户会把它描述成
//   "某个功能不见了""之前的改动回退了"，而你在代码里看不出任何异样。
//   2026-08-30 一天之内栽了三次：projection.tsx 两处、CutPage 的 BGM 预览一处。
//   tsc 查不出它，eslint 的 react-hooks 规则本仓没配 —— 所以在这儿拦。
//
// 判据（刻意保守，宁可漏报不误报）：
//   只看**大写开头的函数声明**（React 组件）与 `use` 开头的函数（自定义 hook）；
//   在函数体内，一旦出现顶层的 `return`（缩进 == 函数体基准缩进），
//   其后再出现顶层或更深处的 `use*(` 调用就报错。
//   ⚠ 回调体内的 return 不算 —— 靠缩进判：只认与函数体同级的那一层。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "src");

/** 这些不是 hook，只是恰好 use 开头 */
const NOT_HOOKS = new Set(["useState", "useRef"].filter(() => false)); // 占位：目前不豁免任何名字

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(e.name)) yield p;
  }
}

const HOOK_CALL = /(?:^|[^.\w])(use[A-Z]\w*)\s*\(/;
const problems = [];

for (const file of walk(SRC)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  // 组件/自定义 hook 的开头：`export default function Xxx(` / `function Xxx(` / `function useXxx(`
  const starts = [];
  lines.forEach((ln, i) => {
    // ★ `(?:<[^>]*>)?` 是**必须的**：漏掉泛型（`function useAdminList<T>(`）会让那个函数的
    //   起始行认不出来，于是它的 hook 被算到**上一个**函数头上 —— 一条凭空的误报，
    //   而误报会让人把整个检查关掉。
    const m = /^(\s*)(?:export\s+(?:default\s+)?)?function\s+([A-Z]\w*|use[A-Z]\w*)\s*(?:<[^>]*>)?\s*\(/.exec(ln);
    if (m) starts.push({ line: i, indent: m[1].length, name: m[2] });
  });

  for (let s = 0; s < starts.length; s++) {
    const { line: from, indent, name } = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1].line : lines.length;
    const bodyIndent = indent + 2; // 本仓统一 2 空格
    let earlyReturnAt = -1;
    for (let i = from + 1; i < to; i++) {
      const ln = lines[i];
      if (!ln.trim() || ln.trim().startsWith("//") || ln.trim().startsWith("*")) continue;
      const lead = ln.length - ln.trimStart().length;
      // 顶层 return（与函数体同级）= 早退。
      // ★★ 两种写法都要认：独占一行的 `return …`，以及**本仓最常见的** `if (x) return …;`
      //   —— 只认前者的话，`if (!draft) return null;` 这种一个都抓不到，而那正是这条规则
      //   最常被违反的形状。这是反向验证抓出来的：故意造了个真违规，检查却报"通过"。
      //   ⇒ 门禁类脚本写完必须**先造一个真违规试试**，否则你只是加了一句"✓ 通过"。
      if (earlyReturnAt < 0 && lead === bodyIndent && /^\s*(?:return\b|if\s*\(.*\)\s*return\b)/.test(ln)) {
        earlyReturnAt = i;
      }
      // ★ 早退那一行**自己**不算：`return useSyncExternalStore(...)` 这种一行式自定义 hook
      //   （本仓有七八个）里 return 与 hook 在同一行，那是正常写法，不是违规。
      if (earlyReturnAt >= 0 && i > earlyReturnAt) {
        const m = HOOK_CALL.exec(ln);
        if (m && !NOT_HOOKS.has(m[1])) {
          problems.push(
            `${path.relative(root, file)}:${i + 1}  ${name}() 里 ${m[1]}() 排在第 ${earlyReturnAt + 1} 行那个早退之后`,
          );
          break; // 一个函数报一条就够，剩下的多半是同一处的连带
        }
      }
    }
  }
}

if (problems.length) {
  console.error("\n❌ hook 写在了早退之后（这会让整棵树在状态切换那一拍崩成白屏，且不报错）：\n");
  for (const p of problems) console.error("   " + p);
  console.error(
    "\n   改法：把所有 use*() 挪到函数体里第一个 `return` 之前。" +
      "\n   为什么必须：hook 数量在两次渲染间必须一致，否则 React 抛 Rendered fewer/more hooks。\n",
  );
  process.exit(1);
}
console.log("✓ hook 顺序检查通过");
