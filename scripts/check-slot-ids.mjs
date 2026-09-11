#!/usr/bin/env node
// 构建门禁：内置提示词方案的图位 id，以及「认格子用图位键、显示名只给人看」（多语言 PR2，2026-09-11）。
//
// ★★ 这份门禁是**故意浅**的：文本 / 正则级核对，不做 AST 溯源。第一版做了一千行的 binder 追踪，结果在合理的写法上误报（抽个
//   <SlotRow slot={s}/> 小组件、包一层 `const keyOf = (s) => slotKey(scheme, s)`、`i18n._(s.tag)`、`t({ message: \`…${sl.tag}…\` })`
//   都被拦），还给出错误的改法。**真正的证明是 PR 里描述的等价性 harness**（同一批用户流程在 origin/main 与本分支上逐字节比对，
//   再把内置图位名换成英文、验键与 CardView.tag 都不跟着变）。这里只钉住"哪天有人把最顺手的回退写回来"那几种形状：
//   (a) types.BUILTIN_SLOT_ZH 那张表：七对冻结原名、as const、BuiltinSlotId 与 builtinSlotZh；
//   (b) BUILTIN_SCHEMES 每一格 `id: "x", tag: BUILTIN_SLOT_ZH.x` 的写法、共用 id 在几套里是同一格；再把 builtinSlotZh / slotKey /
//       slotCardTag 从源码抠出来转译实跑（显示名换成英文，键必须还是冻结原名；用户方案原样回 tag）；
//   (c) 自建卡页与它的 store 里"拿显示名 / 图位 id 认格子"的几种写法 —— 逐行正则，扫的是去掉注释、字面量涂空后的代码；
//   (d) portraitViews（real / mock）回包与铸卡写进 CardView 的 tag 走 slotCardTag，交给 portraitViews 的方案是原样那套。
// ★★ (c)(d) **只扫 PAGE / STORE / REAL / MOCK 四个常量列出的文件**：把自建卡那一页的图位逻辑拆到新文件时先把新文件加进来 ——
//   不加的话它一条规则都不过，而键与显示名两边都是 string、tsc 看不见，翻译上线那天才发作。
// ★ (c) 误报的出路：那一行上面写 `// slot-ids-ignore-next-line: 理由`（理由必填，只豁免 (c)），PR 里说清为什么。
// ★ 只读源码、不 import src 模块（types / promptSchemes 引了 Lingui 宏，Node 跑不了）；typescript 只拿来涂空字面量 / 去注释与抠函数
//   转译，找法与 check-i18n 相同（先从被扫的仓库找，--root 指向一份没有 node_modules 的拷贝时退回本脚本所在的仓库）。
// 用法：node scripts/check-slot-ids.mjs [--root=<仓库根：造违规试红时指向一份拷贝；缺省是本脚本所在的仓库>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";

const opt = (n) => process.argv.find((a) => a.startsWith(`${n}=`))?.slice(n.length + 1);
const root = path.resolve(opt("--root") ?? path.join(path.dirname(url.fileURLToPath(import.meta.url)), ".."));
const ts = (() => { try { return createRequire(path.join(root, "package.json"))("typescript"); } catch { return createRequire(import.meta.url)("typescript"); } })();
const K = ts.SyntaxKind;

const TYPES = "src/types.ts";
const SCHEMES = "src/data/promptSchemes.ts";
// ★ (c)(d) 按路径钉的四个文件（见文件头 ★★）：图位逻辑搬家时先改这里
const PAGE = "src/pages/CustomCardPage.tsx";
const STORE = "src/studio/customCardStore.ts";
const REAL = "src/ai/real.ts";
const MOCK = "src/mock/ai.ts";

/** 冻结的七对：id → 中文原名。★ 原名与此前内置图位写死的 tag 逐字相同：存量草稿的键、已铸卡片的 CardView.tag 靠它接得上 */
const SHIPPED = { fullBody: "全身立绘", faceCloseup: "面部特写", sourceCrop: "原片截图", mannequinBody: "白模全身", outfitDetail: "服装细节", mannequinTurnaround: "白模三视图", specSheet: "设定规格稿" };
const KIND_WORDS = new Set(["face", "body", "detail"]);
const IGNORE_RE = /\/\/\s*slot-ids-ignore-next-line\b\s*:?\s*(.*)$/;

const problems = [];
const fail = (msg) => problems.push(msg);
const [show, flat] = [(v) => JSON.stringify(v), (s) => s.replace(/\s+/g, " ").trim()];

/**
 * 去掉注释、把字面量的**内容**涂成空格（字符串 / 模板文本段 / 正则 / JSX 文字；`${…}` 里的代码留着），长度与换行一个不变，下标与
 * 行号和原文对得上：(b) 按 `code` 找括号、(c)(d) 的正则只扫 `code`；`bare` 只去注释、字面量原样（读 id 的值用）。
 * ★ 用 AST 不用扫描器：扫描器分不清 `/` 是除号还是正则，JSX 文字里的撇号会被当成没闭合的字符串、吞掉同一行后面的 `{…}` 表达式 ——
 *   那正是要扫的地方。注释分两头：行首的是**后一个 token** 的前导琐碎，同一行尾巴上的（含花括号里的 JSX 注释）是**前一个 token**
 *   的尾随琐碎 —— 逐个 token 两头都问才一条不漏（第一版只问前导，JSX 注释与行尾注释全漏了，试红时才抓到）。
 */
function blank(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const [code, bare] = [text.split(""), text.split("")];
  const wipe = (a, b, both) => { for (let i = a; i < b; i++) if (code[i] !== "\n" && code[i] !== "\r") (code[i] = " "), both && (bare[i] = " "); };
  const INNER = { [K.StringLiteral]: [1, 1], [K.NoSubstitutionTemplateLiteral]: [1, 1], [K.TemplateHead]: [1, 2], [K.TemplateMiddle]: [1, 2], [K.TemplateTail]: [1, 1], [K.RegularExpressionLiteral]: [1, 1] };
  const [jsx, cmts] = [[], []];
  const visit = (n) => {
    if (n.kind === K.JSDoc) return; // 整块 JSDoc 已按前导琐碎涂掉，不进它的子树
    if (n.kind === K.JsxText) return wipe(n.pos, n.end, false), jsx.push([n.pos, n.end]);
    const kids = n.getChildren(sf);
    if (INNER[n.kind]) wipe(n.getStart(sf) + INNER[n.kind][0], n.end - INNER[n.kind][1], false);
    if (kids.length === 0) cmts.push(...(ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []), ...(ts.getTrailingCommentRanges(text, n.end) ?? []));
    for (const c of kids) visit(c);
  };
  visit(sf);
  // ★ 紧跟在 `>` 后面的 JSX 文字要是以 // 开头，会被当成上一个 token 的尾随注释一路吞到行尾 —— 落在 JSX 文字里的"注释"一律不算
  for (const r of cmts) if (!jsx.some(([a, b]) => r.pos >= a && r.pos < b)) wipe(r.pos, r.end, true);
  return { sf, code: code.join(""), bare: bare.join("") };
}
function load(rel) {
  if (!fs.existsSync(path.join(root, rel))) return fail(`${rel}：读不到（--root 指错了？）`), null;
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  return { rel, text, ...blank(rel, text), lineAt: (pos) => text.slice(0, pos).split("\n").length };
}
const files = Object.fromEntries([TYPES, SCHEMES, PAGE, STORE, REAL, MOCK].map((r) => [r, load(r)]));

/** 涂空代码里，从 open 括号找配对的闭括号，中间按顶层逗号切段（对象的属性 / 数组的元素 / 调用的实参）；不配对回 null */
function pieces(code, open) {
  const CLOSE = { "{": "}", "[": "]", "(": ")" };
  const stack = [CLOSE[code[open]]];
  const parts = [];
  let s = open + 1;
  const cut = (k) => flat(code.slice(s, k)) && parts.push([s, k]);
  for (let k = open + 1; k < code.length; k++) {
    const ch = code[k];
    if (CLOSE[ch]) stack.push(CLOSE[ch]);
    else if (ch === "}" || ch === "]" || ch === ")") {
      if (stack.pop() !== ch) return null;
      if (!stack.length) return cut(k), { close: k, parts };
    } else if (ch === "," && stack.length === 1) cut(k), (s = k + 1);
  }
  return null;
}
/** 对象字面量 `{ … }` 的顶层属性：名字 → 值的**原文**（trim 过）与位置。open 是 `{` 的下标 */
function propsOf(f, open) {
  const p = pieces(f.code, open);
  const props = new Map();
  for (const [s, e] of p?.parts ?? []) {
    const colon = f.code.indexOf(":", s);
    const has = colon >= 0 && colon < e;
    props.set(flat(f.code.slice(s, has ? colon : e)), { val: has ? flat(f.text.slice(colon + 1, e)) : "", pos: s + f.code.slice(s, e).search(/\S/) });
  }
  return p && { close: p.close, props };
}
/** 把源文件里的顶层 function 声明原样抠出来、转译成 JS 实跑（不 import 整个模块）；env 是它们引用的外部名字 */
function extract(f, want, env) {
  const src = f.sf.statements.filter((st) => ts.isFunctionDeclaration(st) && st.name && st.body).map((st) => st.getText(f.sf).replace(/^export\s+/, ""));
  const js = ts.transpileModule(src.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export \{\};?\s*$/m, "");
  try {
    return new Function(...Object.keys(env), `${js}\nreturn { ${want.map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(", ")} };`)(...Object.values(env));
  } catch (e) {
    return fail(`${f.rel}：抠出来的函数跑不起来（${e.message}）—— 那边改了写法，就同步改这里的抠法`), {};
  }
}
let runs = 0;
/** 实跑一条：抛了也算一种 got */
function expect(name, fn, args, want, why) {
  runs++;
  let got;
  try { got = fn(...args); } catch (e) { got = `抛了：${e.message}`; }
  if (got !== want) fail(`${name}(${args.map(show).join(", ")})：want ${show(want)}，got ${show(got)}（${why}）`);
}

// ── (a) types.BUILTIN_SLOT_ZH：七个 ASCII id → 冻结的中文原名 ──────────────────────
const table = {};
let zhFn = null;
if (files[TYPES]) {
  const f = files[TYPES];
  const m = /export\s+const\s+BUILTIN_SLOT_ZH\s*=\s*\{([^}]*)\}\s*as\s+const\b/.exec(f.bare);
  if (!m) fail(`${TYPES}：找不到 export const BUILTIN_SLOT_ZH = { … } as const（BuiltinSlotId 靠 as const 收窄成这几个 id；表要 export）`);
  for (const piece of (m?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = f.lineAt(m.index + m[0].indexOf(piece));
    const p = /^([A-Za-z_$][\w$]*)\s*:\s*"([^"]*)"$/.exec(piece);
    if (!p) fail(`${TYPES}:${at}  BUILTIN_SLOT_ZH 的每一项都写成 id: "中文原名"，id 只准 ASCII 标识符（读到 ${show(flat(piece))}）`);
    else if (Object.hasOwn(table, p[1])) fail(`${TYPES}:${at}  BUILTIN_SLOT_ZH 的 ${p[1]} 写了两遍`);
    else table[p[1]] = p[2];
  }
  const byName = new Map();
  for (const [id, name] of Object.entries(table)) {
    // ★ id 与原名两列都不许是 kind 词，但**理由不同**（写反过一次）：原名是真的运行时键，id 不是键、只是别把两套词混起来
    if (KIND_WORDS.has(id.toLowerCase())) fail(`BUILTIN_SLOT_ZH 的 id ${show(id)} 与 CardView 的 kind 词同名：id 不是运行时的键（键是原名，见 slotKey），这条只为别让读的人把「图位 id」与「卡种 kind」混成一回事 —— 换个 id 名`);
    if (KIND_WORDS.has(name.toLowerCase())) fail(`BUILTIN_SLOT_ZH.${id} 的原名 ${show(name)} 撞上 CardView 的 kind 词：原名就是运行时的键（slotKey 回的就是它），而非人物卡那份 busySlot / slotErr 记的是卡种的 kind、changeType 换卡种时不清 slotErr —— 那条人物卡的报错会贴到另一张卡的那一格上`);
    if (!name || name !== name.trim()) fail(`BUILTIN_SLOT_ZH.${id} 的原名 ${show(name)} 不能空、首尾不能有空白`);
    if (byName.has(name)) fail(`BUILTIN_SLOT_ZH.${id} 与 .${byName.get(name)} 是同一个原名 ${show(name)}：两格同一个键`);
    byName.set(name, id);
  }
  for (const [id, name] of Object.entries(SHIPPED)) {
    if (!Object.hasOwn(table, id)) fail(`BUILTIN_SLOT_ZH 少了 ${id}（${show(name)}）`);
    else if (table[id] !== name) fail(`BUILTIN_SLOT_ZH.${id}：want ${show(name)}，got ${show(table[id])} —— 原名一个字都不许改：存量草稿的键与已铸卡片的 tag 靠它接得上`);
  }
  for (const id of Object.keys(table)) if (!Object.hasOwn(SHIPPED, id)) fail(`BUILTIN_SLOT_ZH 多了 ${id}：新加内置图位先在本脚本的 SHIPPED 里登记（它从此也是冻结的原名）`);
  if (!/export\s+type\s+BuiltinSlotId\s*=\s*keyof\s+typeof\s+BUILTIN_SLOT_ZH\b/.test(f.bare)) fail(`${TYPES}：找不到 export type BuiltinSlotId = keyof typeof BUILTIN_SLOT_ZH`);
  if (!/export\s+function\s+builtinSlotZh\s*\(/.test(f.bare)) fail(`${TYPES}：找不到 export function builtinSlotZh(id)`);
  zhFn = extract(f, ["builtinSlotZh"], { BUILTIN_SLOT_ZH: Object.freeze({ ...table }) }).builtinSlotZh ?? null;
  for (const [id, name] of zhFn ? Object.entries(table) : []) expect("builtinSlotZh", zhFn, [id], name, "表里的 id 回原名");
  for (const id of zhFn ? ["toString", ""] : []) expect("builtinSlotZh", zhFn, [id], undefined, "只认表里的自有属性，不顺原型链查");
}

// ── (b) promptSchemes.BUILTIN_SCHEMES：每一格 `id: "x", tag: BUILTIN_SLOT_ZH.x`，共用 id 是同一格；再实跑 slotKey / slotCardTag ──
const schemes = [];
let slotCount = 0;
if (files[SCHEMES]) {
  const f = files[SCHEMES];
  const head = /export\s+const\s+BUILTIN_SCHEMES\b[^=]*=\s*\[/.exec(f.code);
  const arr = head && pieces(f.code, head.index + head[0].length - 1);
  if (!arr) fail(`${SCHEMES}：找不到 export const BUILTIN_SCHEMES … = [ … ]`);
  const used = new Set();
  const shape = new Map();
  for (const [s, e] of arr?.parts ?? []) {
    const open = f.code.indexOf("{", s);
    const sc = open >= 0 && open < e ? propsOf(f, open) : null;
    if (!sc) { fail(`${SCHEMES}:${f.lineAt(s)}  BUILTIN_SCHEMES 的每一项都要是对象字面量`); continue; }
    const sid = (sc.props.get("id")?.val ?? "").replace(/^"|"$/g, "") || `第 ${schemes.length + 1} 套`;
    if (sc.props.get("builtin")?.val !== "true") fail(`${SCHEMES}:${f.lineAt(open)}  内置方案 ${sid} 要写 builtin: true —— slotKey / slotCardTag 只在内置方案上按 id 取原名，漏了整套退回显示名`);
    const slotsP = sc.props.get("slots");
    const list = slotsP?.val.startsWith("[") ? pieces(f.code, f.code.indexOf("[", slotsP.pos)) : null;
    if (!list) { fail(`${SCHEMES}:${f.lineAt(open)}  内置方案 ${sid} 的 slots 要是数组字面量`); continue; }
    const seen = new Set();
    const scheme = { id: sid, slots: [] };
    for (const [a, b] of list.parts) {
      slotCount++;
      const so = f.code.indexOf("{", a);
      const sl = so >= 0 && so < b ? propsOf(f, so) : null;
      const line = f.lineAt(a + f.code.slice(a, b).search(/\S/));
      if (!sl) { fail(`${SCHEMES}:${line}  ${sid} 的图位要写成对象字面量`); continue; }
      const idm = /^"([A-Za-z_$][\w$]*)"$/.exec(sl.props.get("id")?.val ?? "");
      if (!idm) { fail(`${SCHEMES}:${line}  ${sid} 有一格图位没有 id: "x"（内置图位一律写 id: "x", tag: BUILTIN_SLOT_ZH.x）`); continue; }
      const id = idm[1];
      if (!Object.hasOwn(table, id)) fail(`${SCHEMES}:${line}  ${sid} 的图位 id ${show(id)} 不在 types.BUILTIN_SLOT_ZH 里`);
      // ★★ 「tag 必须原样写成 BUILTIN_SLOT_ZH.<同一个 id>」钉的是**今天**这一步：显示名与冻结原名逐字相同，界面上每个字都与改动前一样；
      //   键本身跟着 id 走、不跟 tag（下面实跑那段就是拿翻译过的 tag 验的）。**翻译内置图位名的那一步（PR3）只放宽这一条**：改成「tag 那个
      //   表达式经一个**读时取值**的 getter 引用同一个 id」（如 `get tag() { return builtinSlotLabel("fullBody"); }`，不是模块加载时算一次的
      //   `tag: builtinSlotLabel("fullBody")` —— App 切语言不重载）。id 必须有、在表里、同一套不重复、共用 id 是同一格、表里的 id 都有人用 —— 照留。
      const tag = sl.props.get("tag")?.val;
      if (tag !== `BUILTIN_SLOT_ZH.${id}`) fail(`${SCHEMES}:${line}  ${sid} 的 id: ${show(id)} 那一格要写 tag: BUILTIN_SLOT_ZH.${id}（读到 ${show(tag ?? "（没有 tag）")}）`);
      if (seen.has(id)) fail(`${SCHEMES}:${line}  ${sid} 里 id ${show(id)} 出现了两次：两格同一个键，会显示同一张照片、铸卡时同一张进两次`);
      seen.add(id), used.add(id);
      const fields = Object.fromEntries(["role", "prompt", "ref", "size", "fromCrop"].map((n) => [n, sl.props.get(n)?.val ?? "（不写）"]));
      const prev = shape.get(id);
      if (!prev) shape.set(id, { sid, fields });
      else for (const n of Object.keys(fields)) if (prev.fields[n] !== fields[n]) fail(`${SCHEMES}:${line}  内置图位 ${id} 在 ${prev.sid} 与 ${sid} 里不是同一格：${n} 一边是 ${show(prev.fields[n])}、一边是 ${show(fields[n])}（同一个 id 就是同一个键，换方案时键对得上的图原样留下）`);
      scheme.slots.push({ id, role: fields.role.replace(/^"|"$/g, ""), prompt: "" });
    }
    schemes.push(scheme);
  }
  for (const id of Object.keys(table)) if (!used.has(id)) fail(`types.BUILTIN_SLOT_ZH.${id} 没有任何内置方案在用（删掉它，或者补上那一格）`);

  // 实跑：内置图位的显示名模拟成翻译之后的样子，键必须仍是冻结原名；用户方案原样回 tag；id 只在 builtin 为真时作数
  const fns = zhFn ? extract(f, ["slotKey", "slotCardTag"], { builtinSlotZh: zhFn, BUILTIN_SLOT_ZH: Object.freeze({ ...table }) }) : {};
  for (const name of zhFn ? ["slotKey", "slotCardTag"] : []) {
    const fn = fns[name];
    if (typeof fn !== "function") { fail(`${SCHEMES}：找不到 export function ${name}(scheme, slot)`); continue; }
    for (const sc of schemes) for (const sl of sc.slots) if (table[sl.id]) expect(name, fn, [{ id: sc.id, builtin: true }, { ...sl, tag: "ENGLISH" }], table[sl.id], "内置图位按 id 取冻结原名，显示名翻译了也不跟着变");
    for (const tag of ["自定义", " 自定义 ", "自".repeat(40)]) expect(name, fn, [{ builtin: false }, { tag, role: "primary", prompt: "" }], tag, "用户方案原样回 tag，不 trim、不截断");
    expect(name, fn, [{ builtin: false, slots: [] }, { id: "fullBody", tag: "自定义", role: "primary", prompt: "" }], "自定义", "id 只在内置方案上作数：用户方案带着 id 也按 tag 认");
  }
}

// ── (c) 自建卡页 + 它的 store：拿显示名 / 图位 id 认格子的几种写法（只扫涂空后的代码，逐行正则） ──
const KEY = "认格子一律用 slotKey(那一格所属的方案, 格子)，slot.tag 只拿去给人看（JSX 文字、alt / title、t`…` 插值）";
const TARGET = "选图 / 移除 / 圈选的目标按图位键记（字段叫 slotKey，不记显示名 tag）；铸卡 / 回包写进 CardView 的 tag 走 slotCardTag";
const ID = `图位的 id 不是键：内置图位按 id 取的是冻结原名、用户方案根本没有 id —— ${KEY}`;
const RULES = [
  [/schemeShots\[[^\]]*\.tag\b/, KEY],
  [/\[[A-Za-z_$][\w$.?]*\.tag\]\s*:/, KEY],
  [/delete\s+\w+\[[^\]]*\.tag\]/, KEY],
  [/\.tag\s*(===|!==)/, KEY],
  [/(===|!==)\s*[A-Za-z_$][\w$.?]*\.tag\b/, KEY],
  [/keep\.has\([^)]*\.tag\b/, KEY],
  [/new Set\((?:[^)]|\([^)]*\))*\.tag\b/, KEY], // 放一层括号进去：`new Set(next.slots.map((s) => s.tag))` 的 .tag 在 (s) 之后
  [/setBusySlot\([^)]*\.tag\b/, KEY],
  [/key=\{[^}]*\.tag\b/, `React key 也是在认格子：${KEY}`],
  [/busySlot\s*===\s*[^;]*\.tag\b/, KEY],
  [/slotErr\??\.key\s*===\s*[^;]*\.tag\b/, KEY],
  [/\btag:\s*[A-Za-z_$][\w$.?]*\.tag\b/, TARGET],
  [/\bannot\??\.tag\b/, TARGET],
  [/annot:\s*\{\s*tag\b/, TARGET],
  [/\{\s*tag:\s*string\s*\}/, TARGET],
  [/schemeShots\[[^\]]*\.id\b/, ID],
  [/\[[A-Za-z_$][\w$.?]*\.id\]\s*:\s*shot\b/, ID],
  [/busySlot\s*===\s*[^;]*\bslot\w*\.id\b/, ID],
  [/slotKey:\s*[A-Za-z_$][\w$.?]*\.id\b/, ID],
];
let scanned = 0;
for (const f of [files[PAGE], files[STORE]].filter(Boolean)) {
  const ignored = new Set();
  f.text.split(/\r?\n/).forEach((ln, i) => {
    const m = IGNORE_RE.exec(ln);
    if (m && !m[1].trim()) fail(`${f.rel}:${i + 1}  slot-ids-ignore-next-line 没写理由（写成 // slot-ids-ignore-next-line: 这一处为什么不算认格子）`);
    else if (m) ignored.add(i + 2);
  });
  f.code.split(/\r?\n/).forEach((ln, i) => {
    scanned++;
    for (const [re, hint] of ignored.has(i + 1) ? [] : RULES) {
      const m = re.exec(ln);
      if (m) fail(`${f.rel}:${i + 1}  ${show(flat(m[0]))} —— ${hint}（真拦错了：那一行上面写 // slot-ids-ignore-next-line: 理由）`);
    }
  });
}
if (files[PAGE]) {
  const f = files[PAGE];
  const imp = /import\s*\{([^}]*)\}\s*from\s*"\.\.\/data\/promptSchemes"/.exec(f.bare);
  for (const n of ["slotKey", "slotCardTag"]) {
    if (!new RegExp(`\\b${n}\\(`).test(f.code)) fail(`${PAGE}：找不到 ${n}( 的调用 —— 认格子 / 铸卡的 tag 只有 promptSchemes 那一份实现`);
    if (!imp || !new RegExp(`\\b${n}\\b`).test(imp[1])) fail(`${PAGE}：要从 "../data/promptSchemes" import ${n}（自己抄一份就是第二份实现）`);
  }
}
if (files[STORE] && !/annot:\s*\{\s*slotKey:\s*string;\s*frame:\s*string\s*\}\s*\|\s*null/.test(files[STORE].bare)) fail(`${STORE}：CustomCardDraft.annot 要是 { slotKey: string; frame: string } | null（圈选改图开在哪一格按图位键记，不记显示名）`);

// ── (d) portraitViews（real / mock）的回包、铸卡写进形象图的 tag、交给 portraitViews 的方案 ──
for (const f of [files[REAL], files[MOCK]].filter(Boolean)) {
  const rows = f.code.split(/\r?\n/);
  const at = rows.findIndex((l) => /^export async function portraitViews\(/.test(l));
  const end = at < 0 ? -1 : rows.findIndex((l, i) => i > at && l === "}");
  if (end < 0) { fail(`${f.rel}：找不到 export async function portraitViews( … 到顶格的 }（那边改了写法，就同步改这里）`); continue; }
  const body = rows.slice(at, end + 1).join("\n");
  const lineOf = (idx) => at + body.slice(0, idx).split("\n").length;
  let pushes = 0;
  for (const m of body.matchAll(/out\.push\(/g)) {
    pushes++;
    const p = pieces(body, m.index + m[0].length - 1);
    const lit = body.slice(m.index, p ? p.close + 1 : m.index + 400);
    if (!/slotKey:\s*slotKey\(o\.scheme,\s*slot\)/.test(lit)) fail(`${f.rel}:${lineOf(m.index)}  portraitViews 的 out.push 要带 slotKey: slotKey(o.scheme, slot)（自建卡页据它把图放回格子）`);
    if (!/\btag:\s*slotCardTag\(o\.scheme,\s*slot\)/.test(lit)) fail(`${f.rel}:${lineOf(m.index)}  portraitViews 的 out.push 要带 tag: slotCardTag(o.scheme, slot)（它是写进 CardView.tag 的值）`);
  }
  if (!pushes) fail(`${f.rel}：portraitViews 里找不到 out.push(（那边改了写法，就同步改这里）`);
  const bad = /\btag:\s*(slot|s|v)\.tag\b/.exec(body);
  if (bad) fail(`${f.rel}:${lineOf(bad.index)}  portraitViews 里写了 ${bad[0]}：回包的 tag 是写进 CardView.tag 的值，走 slotCardTag(o.scheme, slot)`);
}
if (files[PAGE]) {
  const f = files[PAGE];
  const k = f.code.search(/\bkind:\s*roleToKind\(/);
  let open = -1;
  for (let i = k - 1, depth = 0; k >= 0 && i >= 0 && open < 0; i--) {
    if (f.code[i] === "}") depth++;
    else if (f.code[i] === "{") depth === 0 ? (open = i) : depth--;
  }
  const lit = open >= 0 ? pieces(f.code, open) : null;
  const txt = lit ? f.code.slice(open, lit.close + 1) : "";
  if (!lit) fail(`${PAGE}：找不到铸卡时写 kind: roleToKind(…) 的形象图字面量（那边改了写法，就同步改这里）`);
  else if (!/\btag:\s*slotCardTag\(scheme,\s*slot\)/.test(txt) || /\btag:\s*slot\.tag\b/.test(txt)) fail(`${PAGE}:${f.lineAt(open)}  铸卡写进形象图的 tag 要是 slotCardTag(scheme, slot)、不能是 slot.tag（内置图位存冻结原名，不存界面语言的名字）`);
  let calls = 0;
  for (const m of f.code.matchAll(/\bportraitViews\(/g)) {
    calls++;
    const p = pieces(f.code, m.index + m[0].length - 1);
    if (/\bscheme:\s*(scheme\b|\{\s*\.\.\.scheme\b)/.test(p ? f.code.slice(m.index, p.close + 1) : "")) continue;
    fail(`${PAGE}:${f.lineAt(m.index)}  portraitViews 的 scheme 要原样传那一套或写成 { ...scheme, … }：PromptScheme.builtin 是可选位，重建一个字面量把它漏掉是零症状（tsc 不说话、这里也看不见），而 slotKey / slotCardTag 只在 builtin 为真时按 id 取原名 —— PR3 之后这一整批图的键与 CardView.tag 都退回显示名，落在页面根本不读的键上`);
  }
  if (!calls) fail(`${PAGE}：找不到 portraitViews(…) 的调用（那边改了写法，就同步改这里）`);
}

if (problems.length) {
  console.error(`\n❌ 图位 id 检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   门禁是浅的（正文 / 正则级）：改法看每一条后面那句；(c) 真拦错了写 // slot-ids-ignore-next-line: 理由。\n   (c)(d) 只扫文件头 PAGE / STORE / REAL / MOCK 四个文件：图位逻辑搬到新文件时先把它加进去。\n");
  process.exit(1);
}
console.log(`✓ 图位 id 检查通过（${Object.keys(table).length} 个内置原名 · 内置方案 ${slotCount} 格 · builtinSlotZh / slotKey / slotCardTag 实跑 ${runs} 条 · (c) 扫了 ${scanned} 行）`);
