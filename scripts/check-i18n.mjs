#!/usr/bin/env node
// 构建门禁：**防新的中文界面文案漏进来**（多语言方案 §7，2026-09-10 统一执行顺序第 1 批）。
//
// ★★ 为什么要有它：界面接上 Lingui 之后，「英文界面里冒出一句中文」是零报错的 —— tsc 不管、构建不管、
//   浏览器里中文用户也看不出来。存量七千多处中文要分批迁移，没有闸的话迁移速度永远赶不上新增速度。
//   所以这里做**棘轮**：存量记进基线，只拦新增；迁掉一处就跑 --update 把基线收紧一格。
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先人为造一个真违规，确认它会红；宁可漏报不误报 ——
//   假警报会让人把整个检查关掉，那比没有检查更坏。
//
// 检查项：
//   A 中文字面量棘轮：StringLiteral / NoSubstitutionTemplateLiteral / JsxText；TemplateExpression 整段算一条。
//     只按真汉字判（纯全角标点不算）。基线 { file: { hash(去首尾空白的文本): 次数 } }，与行号无关。
//     排除：console.* 的参数、new RegExp() 的参数、类型位置的字面量、Lingui 宏内部、zhPrompt`…` 标签模板、
//     带 `/* i18n-frozen: 理由 */` 的声明、`// i18n-ignore-next-line: 理由`（理由必填）、src/mock/ai.ts、src/data/agreements.tsx。
//   B 宏用法：模块顶层出现会立刻翻译的调用（t`` / t() / plural / select / i18n._( / i18n.t(）→ 失败（只准 msg / defineMessage）；
//     .tsx 从 @lingui/core/macro 引 t → 失败（组件里用 useLingui 的 t，否则切语言不重渲）；zhPrompt 模板里出现宏 → 失败；
//     src/ai/prompts/** import @lingui → 失败；useMemo / useCallback 里用了宏而依赖里没有 locale / i18n → 只提醒。
//   C 冻结声明：`/* i18n-frozen: 理由 */` 修饰的声明，初始化式里出现宏 → 失败（协议串被误翻是零报错的）。
//   E 缺译棘轮：src/locales/en.po 里 msgstr 为空的条数不得超过基线。
//
// 用法：
//   node scripts/check-i18n.mjs                        检查（构建链里跑的就是这个）
//   node scripts/check-i18n.mjs --update               把基线收紧到当前（只减不增；有新增时仍然失败）
//   node scripts/check-i18n.mjs --update --accept-new  接受新增（让基线 diff 出现在 PR 里，评审看得见）
//   --root=<仓库根> --baseline=<基线路径>               试跑用（缺省：本脚本所在仓库、scripts/i18n-baseline.json）
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => argv.find((a) => a.startsWith(`${n}=`))?.slice(n.length + 1);

const root = path.resolve(opt("--root") ?? path.join(path.dirname(url.fileURLToPath(import.meta.url)), ".."));
const ts = createRequire(path.join(root, "package.json"))("typescript");
const SRC = path.join(root, "src");
const BASELINE = path.resolve(root, opt("--baseline") ?? "scripts/i18n-baseline.json");
const EN_PO = path.join(SRC, "locales", "en.po");
const UPDATE = flag("--update");
const ACCEPT_NEW = flag("--accept-new");

const HAN = /\p{Script=Han}/u;
const EXEMPT = new Set(["src/mock/ai.ts", "src/data/agreements.tsx"]);
/** 宏（出现在这些里面的中文是「已经进目录的」，不算漏） */
const MACRO_FNS = new Set(["t", "msg", "defineMessage", "plural", "select", "selectOrdinal"]);
/** 其中**调用那一刻就翻译**的：模块顶层禁用（会冻结在开机语言） */
const TRANSLATING = new Set(["t", "plural", "select", "selectOrdinal"]);
const MACRO_JSX = new Set(["Trans", "Plural", "Select", "SelectOrdinal"]);
const PROMPT_TAG = "zhPrompt";
const IGNORE_RE = /\/\/\s*i18n-ignore-next-line\b\s*:?\s*(.*)$/;
const FROZEN_RE = /i18n-frozen\s*:\s*\S/;

const relOf = (f) => path.relative(root, f).split(path.sep).join("/");
const hashOf = (s) => crypto.createHash("sha1").update(s.trim()).digest("hex").slice(0, 16);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) yield p;
  }
}

const problems = [];
const warnings = [];
/** @type {Record<string, Record<string, number>>} */
const current = {};
/** @type {Record<string, Record<string, {text: string, line: number}>>} */
const samples = {};

for (const file of walk(SRC)) {
  const rel = relOf(file);
  const text = fs.readFileSync(file, "utf8");
  const isTsx = file.endsWith(".tsx");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const exempt = EXEMPT.has(rel);

  // i18n-ignore-next-line：理由必填；被豁免的是**下一行**（1 基行号）
  const ignored = new Set();
  text.split(/\r?\n/).forEach((ln, i) => {
    const m = IGNORE_RE.exec(ln);
    if (!m) return;
    if (!m[1].trim()) problems.push(`${rel}:${i + 1}  i18n-ignore-next-line 没写理由（写成 // i18n-ignore-next-line: 这句为什么不翻）`);
    else ignored.add(i + 2);
  });

  // B：import 形状
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const mod = st.moduleSpecifier.text;
    if (rel.startsWith("src/ai/prompts/") && mod.startsWith("@lingui")) {
      problems.push(`${rel}:${lineOf(st)}  src/ai/prompts 下不许 import ${mod}：发给模型的指令冻结中文，不进目录`);
    }
    const nb = st.importClause?.namedBindings;
    if (isTsx && mod === "@lingui/core/macro" && nb && ts.isNamedImports(nb)) {
      if (nb.elements.some((e) => (e.propertyName ?? e.name).text === "t")) {
        problems.push(`${rel}:${lineOf(st)}  .tsx 里别从 @lingui/core/macro 引 t：组件里用 useLingui() 给的 t，否则切语言时这一处不重渲`);
      }
    }
  }

  const count = (node, raw) => {
    if (exempt || !HAN.test(raw) || ignored.has(lineOf(node))) return;
    const h = hashOf(raw);
    (current[rel] ??= {})[h] = ((current[rel] ??= {})[h] ?? 0) + 1;
    (samples[rel] ??= {})[h] ??= { text: raw.trim().replace(/\s+/g, " ").slice(0, 48), line: lineOf(node) };
  };

  /** 这个节点是不是一次宏 / 翻译调用；是的话回它的名字 */
  const macroName = (node) => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && MACRO_FNS.has(node.tag.text)) return node.tag.text;
    if (ts.isCallExpression(node)) {
      const ex = node.expression;
      if (ts.isIdentifier(ex) && MACRO_FNS.has(ex.text)) return ex.text;
      if (ts.isPropertyAccessExpression(ex) && ts.isIdentifier(ex.expression) && ex.expression.text === "i18n" && (ex.name.text === "_" || ex.name.text === "t")) return `i18n.${ex.name.text}`;
    }
    return "";
  };
  const containsMacro = (node) => {
    let hit = false;
    const go = (n) => {
      if (hit) return;
      if (macroName(n)) hit = true;
      else ts.forEachChild(n, go);
    };
    go(node);
    return hit;
  };

  const visit = (node, c) => {
    // 类型位置（'a' | 'b' 这种）不是文案
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    let n = c;

    if (ts.isVariableStatement(node)) {
      const cs = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
      if (cs.some((r) => FROZEN_RE.test(text.slice(r.pos, r.end)))) n = { ...n, frozen: true };
    }
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) n = { ...n, depth: c.depth + 1 };

    const mName = macroName(node);
    if (mName) {
      const translating = TRANSLATING.has(mName) || mName.startsWith("i18n.");
      if (translating && c.depth === 0) {
        problems.push(`${rel}:${lineOf(node)}  模块顶层调用了 ${mName}：那一刻就翻译，会冻结在开机语言（顶层只准 msg / defineMessage 描述符，渲染时再翻）`);
      }
      if (c.prompt) problems.push(`${rel}:${lineOf(node)}  zhPrompt 模板里出现了 ${mName}：发给模型的指令冻结中文，不许进目录`);
      if (c.frozen) problems.push(`${rel}:${lineOf(node)}  i18n-frozen 的声明里出现了 ${mName}：冻结的协议串 / 提示词不许翻译`);
      if (mName !== "i18n._" && mName !== "i18n.t") n = { ...n, macro: true };
    }
    if (ts.isCallExpression(node)) {
      const ex = node.expression;
      if (ts.isPropertyAccessExpression(ex) && ts.isIdentifier(ex.expression) && ex.expression.text === "console") n = { ...n, skip: true };
      // useMemo / useCallback：用了宏而依赖里没有 locale / i18n → 切语言后这一处停在旧语言（只提醒）
      if (ts.isIdentifier(ex) && (ex.text === "useMemo" || ex.text === "useCallback") && node.arguments.length >= 1) {
        const deps = node.arguments[1];
        if (containsMacro(node.arguments[0]) && !(deps && /locale|i18n/.test(deps.getText(sf)))) {
          warnings.push(`${rel}:${lineOf(node)}  ${ex.text} 里用了宏，依赖里没有 locale / i18n：切语言后这一处可能停在旧语言`);
        }
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp") n = { ...n, skip: true };
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === PROMPT_TAG) n = { ...n, prompt: true };
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
      if (ts.isIdentifier(tag) && MACRO_JSX.has(tag.text)) {
        if (c.frozen) problems.push(`${rel}:${lineOf(node)}  i18n-frozen 的声明里出现了 <${tag.text}>`);
        n = { ...n, macro: true };
      }
    }

    const quiet = n.skip || n.macro || n.prompt || n.frozen;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!quiet) count(node, node.text);
      return;
    }
    if (ts.isJsxText(node)) {
      if (!quiet) count(node, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      // 整段算一条（与片段怎么切无关）；插值表达式里还可能有别的字面量，照样往下看
      if (!quiet) count(node, node.getText(sf));
      for (const span of node.templateSpans) visit(span.expression, n);
      return;
    }
    ts.forEachChild(node, (ch) => visit(ch, n));
  };
  visit(sf, { depth: 0, skip: false, macro: false, prompt: false, frozen: false });
}

// E：en.po 缺译条数（msgid 非空、msgstr 为空；多行 msgid / msgstr 都认）
function countMissing(po) {
  if (!fs.existsSync(po)) return 0;
  const lines = fs.readFileSync(po, "utf8").split(/\r?\n/);
  let missing = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^msgid "(.*)"$/.exec(lines[i]);
    if (!m) continue;
    let id = m[1];
    let j = i + 1;
    while (j < lines.length && /^".*"$/.test(lines[j])) id += lines[j++].slice(1, -1);
    if (id === "") continue; // 文件头
    const s = /^msgstr "(.*)"$/.exec(lines[j] ?? "");
    if (!s) continue;
    let str = s[1];
    let k = j + 1;
    while (k < lines.length && /^".*"$/.test(lines[k])) str += lines[k++].slice(1, -1);
    if (str === "") missing++;
  }
  return missing;
}
const enMissing = countMissing(EN_PO);

const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
const total = Object.values(current).reduce((s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0);

const added = [];
for (const [f, m] of Object.entries(current)) {
  for (const [h, cnt] of Object.entries(m)) {
    const was = base?.files?.[f]?.[h] ?? 0;
    if (cnt > was) added.push({ f, h, more: cnt - was, ...samples[f][h] });
  }
}
let stale = 0;
for (const [f, m] of Object.entries(base?.files ?? {})) {
  for (const [h, cnt] of Object.entries(m)) stale += Math.max(0, cnt - (current[f]?.[h] ?? 0));
}

if (!base && !(UPDATE && ACCEPT_NEW)) {
  problems.push(`没有基线 ${relOf(BASELINE)}：第一次用 node scripts/check-i18n.mjs --update --accept-new 生成`);
} else if (added.length && !ACCEPT_NEW) {
  const list = added
    .slice(0, 30)
    .map((a) => `   ${a.f}:${a.line}  「${a.text}」${a.more > 1 ? ` ×${a.more}` : ""}`)
    .join("\n");
  problems.push(
    `新增了 ${added.reduce((s, a) => s + a.more, 0)} 处中文界面字面量（基线之外）：\n${list}${added.length > 30 ? `\n   …另有 ${added.length - 30} 处` : ""}\n` +
      "   改法：界面文案用 Lingui 宏（组件 <Trans> / useLingui 的 t，.ts 里 t / msg）并在 en.po 填英文（D8 a）；\n" +
      "   发给模型的指令用 zhPrompt`…` 或放进 i18n-frozen 声明；确实不该翻的加 // i18n-ignore-next-line: 理由。",
  );
}
if (base && enMissing > (base.enMissing ?? 0) && !ACCEPT_NEW) {
  problems.push(`src/locales/en.po 缺译 ${enMissing} 条，基线是 ${base.enMissing ?? 0}：新文案要同一个 PR 带英文（D8 a）——把 msgstr 填上`);
}

if (UPDATE && !(added.length && !ACCEPT_NEW) && !(base && enMissing > (base.enMissing ?? 0) && !ACCEPT_NEW)) {
  const next = { version: 1, enMissing: ACCEPT_NEW || !base ? enMissing : Math.min(base.enMissing ?? 0, enMissing), files: {} };
  for (const f of Object.keys(current).sort()) {
    for (const h of Object.keys(current[f]).sort()) {
      const cnt = current[f][h];
      const v = ACCEPT_NEW || !base ? cnt : Math.min(base.files?.[f]?.[h] ?? 0, cnt);
      if (v > 0) (next.files[f] ??= {})[h] = v;
    }
  }
  fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 1)}\n`);
  console.log(`✓ 基线已写入 ${relOf(BASELINE)}（中文字面量 ${total} 处，en 缺译 ${next.enMissing} 条）`);
}

for (const w of warnings.slice(0, 20)) console.warn(`⚠ ${w}`);
if (warnings.length > 20) console.warn(`⚠ …另有 ${warnings.length - 20} 条提醒`);

if (problems.length) {
  console.error("\n❌ i18n 检查没过：\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(
  `✓ i18n 检查通过（中文字面量 ${total} 处，均在基线内；en 缺译 ${enMissing} 条）` +
    (stale ? `；基线里有 ${stale} 处已经不在代码里了，跑 --update 收紧` : ""),
);
