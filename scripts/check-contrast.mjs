#!/usr/bin/env node
// 构建门禁：**小字不许用 slate-600**（2026-10-15 教材人格评审，wcag-a11y-i18n-6）。
//
// ★★ 为什么要有它：slate-600 在 ink 底上的对比度是 2.50:1，slate-500 是 3.98:1 —— WCAG 2.2 对正文要求 4.5:1，
//   对 ≥ 18.66px 粗体 / 24px 的大字才放到 3:1。而本仓把 slate-600 当「补充说明 / 占位 / 副标题」用了四十来处，
//   全是 9~14px 的小字：真机上灰得读不清，又都是「为什么点不动 / 要花多少钱 / 存在哪儿」这类恰恰该读到的话。
//   同日把 40 处改成 slate-400（CLAUDE.md「空态」那条约定的「补充 text-xs slate-600」一并改口），这里是棘轮：
//   新写的只会被打回，不会悄悄长回去。slate-500 那半（3.98:1）按主人口径不动。
//
// 两条规则（任一条命中就红；同一处只报一次）：
// ★ 规则 A（2026-10-15，按行）：同一行里既有裸的 `text-slate-600`（带 `disabled:` / `hover:` 这类前缀的不算 ——
//   禁用态的字 WCAG 本来就豁免）又有小字号（text-xs / text-sm / text-[9~14px]）。它看的是「行」，所以 className
//   写在常量 / 拼接串里、不挂在任何标签上的那种也抓得到。
// ★ 规则 B（2026-10-19 加，按元素）：裸的 `text-slate-600` 落在某个 JSX 标签的 className 上，而这个元素**里面有字**
//   （JSX 文本、`<Trans>`、`{表达式}` 都算），就算违规 —— **不管同一行有没有字号类**。
//   为什么要加：2.63 发版后验证（10-19）在 #/me 上量到「还没有简介——去设置里写一句吧」14px、2.50:1，源码是
//   `<p className="… text-sm …">` 里包一个 `<span className="text-slate-600">` —— 父元素定字号、子元素定颜色，
//   规则 A 按设计抓不到（它就在原来的头注里写着「抓不到」）。同一种写法当时还有三处（GenTrace / 卡组详情 / Live2D 上传向导）。
//   顺带的事实：slate-600 对 ink 只有 2.50:1，连大字的 3:1 都不够 —— 所以「有字就不许 slate-600」并没有比口径更严，
//   只是把口径「slate-600 只给装饰」照字面执行。
//
// 放行（两条规则共用）：
//   - 装饰：带 `aria-hidden`（›、· 这类分隔符本来就不该让读屏念；`aria-hidden={false}` 不算）—— 规则 A 看那一行，
//     规则 B 只看**这个元素自己**的开标签；自闭合元素（`<Icon … />`）与里面只有自闭合元素的容器（无封面时的占位图标）
//     没有字，规则 B 自然不报 —— 例外是 input / textarea / select：值本身就是字，自闭合也照报。
//   - `contrast-ok: 理由`：写在命中那一行的上一行，或开标签那一行的上一行，或开标签里命中位置之前（JSX 属性之间的 `//` 注释）。
//     用途：亮底卡片上 slate-600 是深字、对比够（CreatePage 的翻牌卡）；禁用态的芯片（WCAG 对不可操作的控件不要求对比度）。
//
// ⚠ 抓不到的（漏报，不是误报 —— 判据刻意保守）：
//   - 颜色从**祖先**继承下来、自己没写颜色的子元素（`<div className="text-slate-600"><b>字</b></div>` 能抓到，因为 div 里有字；
//     但 slate-600 写在一个组件的 prop 里、由组件内部再套到别的元素上，就看不见）；
//   - className 不是字面量写在标签上的（`className={cls}`，cls 在别处拼）—— 规则 A 只在同一行有小字号时兜得住；
//   - 只扫 .tsx；样式写在 .ts / .css 里的不扫（2026-10-19 全仓 .ts / .css 里一处 text-slate-600 都没有）；
//   - 子元素自己另写了颜色（`<span className="text-slate-600"><b className="text-slate-200">…`）规则 B 会照报 —— 这是误报方向，
//     遇到了用 contrast-ok 写明理由。
//   JSX 是用一个小扫描器认的（只认标签、花括号、字符串、模板串与注释，不做完整解析）：JSX 文本里夹着不成对的引号时可能认错，
//   认错的方向一律是「有字」（宁可报出来让人看一眼）。
// ★ 仓内门禁纪律：写完先造真违规试红 —— 2026-10-15 用 --root 指向一份把 EmptyState.tsx 改回 slate-600 的拷贝，确认变红；
//   第一版漏掉了 FlowCanvas 的 `text-[9px]`（见 SMALL 旁的 ★），补上后再红一次。2026-10-19 规则 B 同样造过违规试红
//   （--root 指向一份 src 拷贝：把 ProfilePage 那句改回 slate-600、去掉一处分隔符的 aria-hidden、再加一个多行的「父定字号」
//   与一个只装图标的容器 —— 前三个红、容器不报）；同日复核又抓到三种漏报（同一行另一个元素带 aria-hidden 时整行被放过、
//   `aria-hidden={false}` 被当成隐藏、自闭合的 input 当成没字），补上后再造这三种 + 两个装饰对照试红：三个红、装饰不报。规则 B 第一次跑全仓报 10 处，逐处的结论：
//   正文小字改 slate-400 的 4 处（ProfilePage 空简介、GenTrace 步数、卡组详情「本机计数」、Live2D 上传向导参数表的「没有」）；
//   向导 / 投影窗步骤条之间的「›」5 处是装饰，补 aria-hidden；运镜芯片的禁用态 1 处写 contrast-ok。
//   其余 15 处裸 slate-600 是图标（自闭合 <Icon />）、只装图标的占位容器、已带 aria-hidden / contrast-ok 的，规则 B 不报。
//
// 用法：node scripts/check-contrast.mjs [--root=<另一个仓库根，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const rootArg = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length);
const root = path.resolve(rootArg ?? path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."));
const SRC = path.join(root, "src");

const DIM = /(?<![\w:-])text-slate-600\b/;
const DIM_G = new RegExp(DIM.source, "g"); // 同一份规则派生（CLAUDE.md：别另抄一份字符串）
// ★ 结尾不用 \b：`text-[9px]` 的 `]` 与后面的空格都不是词字符，\b 在那里永远不成立 —— 第一版就这么漏掉了 FlowCanvas 那一处
const SMALL = /(?<![\w:-])(?:text-xs|text-sm|text-\[(?:9|1[0-4])px\])(?![\w-])/;
// 装饰放行：`aria-hidden`、`aria-hidden="true"`、`aria-hidden={true}` 算；`aria-hidden={false}` / `="false"` 不算（10-19 复核抓到原来一律放行）
const HIDDEN = /aria-hidden(?!\s*=\s*(?:\{\s*false\s*\}|["']false["']))/;
// 值本身就是可见文字的控件：自闭合也要报（10-19 复核抓到 `<input className="text-slate-600" />` 原来被当成「没有字」）
const VALUE_TAGS = /^(?:input|textarea|select)$/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".tsx")) yield p;
  }
}

// ── 规则 B 用的小扫描器 ──────────────────────────────────────────────
// 每个函数都返回「扫完之后的下标」；扫过了文件末尾就返回 src.length（调用方据此当作认不出来）。

/** 跳过一个字符串字面量（' 或 "），i 指向开头的引号 */
function skipQuoted(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === q) return j + 1;
    else if (src[j] === "\n" && q !== "`") return j; // JS 的 ' / " 串不跨行：多半是 JSX 文本里的撇号，别一路吃到文件尾
  }
  return src.length;
}

/** 跳过一个模板串（含 `${…}` 嵌套），i 指向开头的反引号 */
function skipTemplate(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === "`") return j + 1;
    else if (src[j] === "$" && src[j + 1] === "{") j = skipBraces(src, j + 1) - 1;
  }
  return src.length;
}

/** 跳过一段 JS 注释（// 或 /* *\/），i 指向第一个 / ；不是注释就原样返回 i */
function skipComment(src, i) {
  if (src[i] !== "/") return i;
  if (src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl < 0 ? src.length : nl;
  }
  if (src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end < 0 ? src.length : end + 2;
  }
  return i;
}

/** 跳过一对花括号（JS 表达式），i 指向 `{` */
function skipBraces(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"') j = skipQuoted(src, j) - 1;
    else if (c === "`") j = skipTemplate(src, j) - 1;
    else if (c === "/" && (src[j + 1] === "/" || src[j + 1] === "*")) j = skipComment(src, j) - 1;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return src.length;
}

const TAG_OPEN = /<([A-Za-z][\w.]*)/y;

/** i 指向 `<Tag`：返回开标签的 { name, end（`>` 之后的下标）, selfClosing }；认不出来回 null */
function scanOpenTag(src, i) {
  TAG_OPEN.lastIndex = i;
  const m = TAG_OPEN.exec(src);
  if (!m) return null;
  for (let j = i + m[0].length; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"') j = skipQuoted(src, j) - 1;
    else if (c === "{") j = skipBraces(src, j) - 1;
    else if (c === "/" && src[j + 1] === ">") return { name: m[1], end: j + 2, selfClosing: true };
    else if (c === "/" && (src[j + 1] === "/" || src[j + 1] === "*")) j = skipComment(src, j) - 1;
    else if (c === ">") return { name: m[1], end: j + 1, selfClosing: false };
  }
  return null;
}

/** pos 落在哪个开标签里：从 pos 往前找 `<Tag`，取第一个「开标签的结尾在 pos 之后」的（最多往前看 40 个，够用） */
function enclosingOpenTag(src, pos) {
  const head = src.slice(0, pos);
  const starts = [];
  for (const m of head.matchAll(/<[A-Za-z]/g)) starts.push(m.index);
  for (let k = starts.length - 1, n = 0; k >= 0 && n < 40; k--, n++) {
    const tag = scanOpenTag(src, starts[k]);
    if (tag && tag.end > pos) return { start: starts[k], ...tag };
  }
  return null;
}

/**
 * 开标签之后到它的闭合标签之间「有没有字」：JSX 文本里非空白的字符、`{表达式}`（注释除外）都算有字；
 * 嵌套的元素只拆掉标签记号、照样看它里面的字（颜色会继承下去）；自闭合元素（图标）不算字。
 * 认不出来（扫到了文件尾也没找到闭合标签）一律回 true —— 宁可报出来。
 */
function hasTextContent(src, from, name) {
  let depth = 1;
  for (let i = from; i < src.length; ) {
    const c = src[i];
    if (c === "{") {
      const j = skipBraces(src, i);
      const inner = src.slice(i + 1, j - 1).trim();
      if (inner && !/^\/\*[\s\S]*\*\/$/.test(inner)) return true;
      i = j;
    } else if (c === "<" && src[i + 1] === "/") {
      const close = src.indexOf(">", i);
      if (close < 0) return true;
      if (src.slice(i + 2, close).trim() === name && --depth === 0) return false;
      i = close + 1;
    } else if (c === "<" && /[A-Za-z]/.test(src[i + 1] ?? "")) {
      const tag = scanOpenTag(src, i);
      if (!tag) return true;
      if (!tag.selfClosing && tag.name === name) depth++;
      i = tag.end;
    } else if (c === "<" && src[i + 1] === ">") {
      i += 2; // 片段 <>…</> 的开头；结尾 </> 由上面那支按名字 "" 处理，不计深度
    } else if (/\s/.test(c)) {
      i++;
    } else {
      return true;
    }
  }
  return true;
}

function lineOf(src, pos) {
  let n = 0;
  for (let i = src.indexOf("\n"); i >= 0 && i < pos; i = src.indexOf("\n", i + 1)) n++;
  return n; // 0 起
}

const problems = new Map(); // "file:line" → 文字
const counts = { A: 0, B: 0 };
let scanned = 0;
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  const rel = path.relative(root, file).split(path.sep).join("/");
  scanned++;
  const report = (i, rule) => {
    const key = `${rel}:${i + 1}`;
    if (problems.has(key)) return;
    counts[rule]++;
    problems.set(key, `${key}: [${rule}] ${lines[i].trim().slice(0, 140)}`);
  };

  // 规则 A：按行
  lines.forEach((line, i) => {
    if (!DIM.test(line) || !SMALL.test(line)) return;
    if (HIDDEN.test(line)) return;
    if (i > 0 && /contrast-ok/.test(lines[i - 1])) return;
    report(i, "A");
  });

  // 规则 B：按元素
  // ★ 只认**这个元素自己**的 aria-hidden（10-19 复核抓到：原来先按「这一行有没有 aria-hidden」跳过，
  //   同一行里另一个元素是装饰时，旁边那段正文小字一起被放过）
  for (const m of src.matchAll(DIM_G)) {
    const pos = m.index;
    const li = lineOf(src, pos);
    if (li > 0 && /contrast-ok/.test(lines[li - 1])) continue;
    const tag = enclosingOpenTag(src, pos);
    if (!tag) continue; // 不在任何标签的属性里（常量 / 拼接串）—— 交给规则 A
    const attrs = src.slice(tag.start, tag.end);
    if (HIDDEN.test(attrs)) continue;
    if (/contrast-ok/.test(src.slice(tag.start, pos))) continue;
    const tagLine = lineOf(src, tag.start);
    if (tagLine > 0 && /contrast-ok/.test(lines[tagLine - 1])) continue;
    // 输入框 / 下拉的值本身就是看得见的字：自闭合也照报
    if (tag.selfClosing && !VALUE_TAGS.test(tag.name)) continue;
    if (!tag.selfClosing && !VALUE_TAGS.test(tag.name) && !hasTextContent(src, tag.end, tag.name)) continue;
    report(li, "B");
  }
}

if (problems.size) {
  console.error(
    `✗ check-contrast：${problems.size} 处小字用了 slate-600（ink 底上只有 2.50:1，读不清）—— 规则 A（同一行有小字号）${counts.A} 处、规则 B（元素里有字）${counts.B} 处：`,
  );
  for (const p of problems.values()) console.error("   " + p);
  console.error("\n   说明 / 占位 / 副标题改 text-slate-400；装饰字符给 aria-hidden；亮底上的深字、禁用态在上一行写 `contrast-ok: 理由`。规则在 CLAUDE.md「约定」里。\n");
  process.exit(1);
}
console.log(`✓ check-contrast：${scanned} 个 .tsx 里没有小字 slate-600（规则 A 按行、规则 B 按元素）`);
