#!/usr/bin/env node
// 构建门禁：import 方向（2026-10-15 教材人格评审，martin-architecture-8）。
//
// ★★ 为什么要有它：CLAUDE.md 写了三条分层铁律（`data → store → 组件` 单向；flowStore 绝不 import studioStore；那几个纯规则模块
//   零运行时依赖、Node 能直接 import 去跑正反例），可它们只长在文档里、靠肉眼守 —— 2026-08-21 收口过的 "mock:" 判据照样长回了三处，
//   说明「写在文档里」挡不住回潮。违反这三条的症状也都是零报错的：data 反过来 import store = Vite 下拿到半初始化的模块（偶发 undefined）；
//   零依赖模块多一个值 import = 它的 check-*.mjs 在 Node 里起不来（或起来了却跑的是另一份实现）。
// ★ 用 TypeScript 自己的解析器扫 import（typescript 是 devDependency，tsc 本来就在 build 串里）：正则扫源码会被注释 / 字符串里的
//   `from "../studio/x"` 骗（本仓注释里到处是这种互相点名），而 `import type` 与 `import { type A }` 这类形状交给 AST 判才靠得住。
// ★ 规则（改规则先改 CLAUDE.md，再改这里）：
//   ① src/data/** 不许 import src/studio、src/pages、src/components、src/hooks（type 也不许：类型该在 types.ts，不该反向借）；
//   ② src/studio/flowStore.ts 不许出现 studioStore（动态 import、类型都算 —— 两个 store 互相 import，Vite 下会拿到半初始化的模块）；
//   ③ 零依赖规则模块（CLAUDE.md 点名、各自有一道 check-*.mjs 直接 import 它跑的那几个）：import 一律 `import type`，
//      值 import 只许来自表里另一个零依赖模块（CLAUDE.md「几个镜头拼成一段话只走 shotScript.joinShots」允许这种）；
//   ③′ recipe.ts 按 CLAUDE.md 的原话是「零 **store** 依赖」不是零依赖（它值引用 economy / refMentions，economy 又引 lingui）：
//      只禁 import src/studio。
//   ④ src/pages/** 与 src/components/** 不直接 import `@capacitor/*`（2026-10-15 装上，教材人格评审第五节「另议」拍板）：原生能力从 utils / data 借 ——
//      插件换版本、web 垫片行为不同只改一处；装之前把 CutPage 的 convertFileSrc 与 VolcCompatToggle 的 browserFinished 各搬进 utils
//      （nativeMerge.nativeFileSrc / openExternal.onBrowserFinished）。
//   不管的：agentGrammar / cutGrammar / cameraVocab
//   的「只准 import type」由各自的 check 脚本 (a) 段管着。
// ★ 仓内门禁纪律：写完先造真违规试红。上线前试过三处，各自变红：往 src/data/danmaku.ts 加 `import { useFlow } from "../studio/flowStore"`；
//   往 flowStore.ts 加 `import type { X } from "./studioStore"`；把 src/data/drawPlan.ts 的 `import type` 改成 `import`。
//
// 用法：node scripts/check-import-direction.mjs [--root=<另一个仓库根，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ts from "typescript";

const rootArg = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length);
const root = path.resolve(rootArg ?? path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."));
const SRC = path.join(root, "src");
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

/** ① data 层不许反向引的几个目录 */
const UPSTREAM_OF_DATA = ["src/studio/", "src/pages/", "src/components/", "src/hooks/"];
/** ③ 零依赖规则模块（CLAUDE.md 点名；每个都有一道 check-*.mjs 直接 import 它跑正反例） */
const ZERO_DEP = [
  "src/data/cutProject.ts",
  "src/data/shotScript.ts",
  "src/data/refMentions.ts",
  "src/data/drawPlan.ts",
  "src/data/gridShots.ts",
  "src/data/sceneShots.ts",
  "src/data/dialogueShots.ts",
  "src/data/effectPresets.ts",
  "src/data/videoTierTable.ts",
  "src/data/videoZoneRules.ts",
  "src/data/cardFit.ts",
  "src/data/guidedModes.ts",
  "src/data/oauthState.ts",
  "src/data/live2dMotionCheck.ts",
];
/** ③′ 零 store 依赖（纯函数、不认识 store，但可以用同层的 data 模块） */
const NO_STORE = ["src/data/recipe.ts"];
const FLOW_STORE = "src/studio/flowStore.ts";

const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 一个文件里的全部 import：静态 import / export … from / 动态 import()；typeOnly = 整条都是类型（擦掉之后不剩运行时依赖） */
function importsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause;
      let typeOnly = false;
      if (c) {
        if (c.isTypeOnly) typeOnly = true;
        else if (!c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0) {
          typeOnly = c.namedBindings.elements.every((el) => el.isTypeOnly);
        }
      }
      out.push({ spec: node.moduleSpecifier.text, line: line(node), typeOnly, kind: "import" });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({ spec: node.moduleSpecifier.text, line: line(node), typeOnly: !!node.isTypeOnly, kind: "export-from" });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = node.arguments[0];
      if (a && ts.isStringLiteral(a)) out.push({ spec: a.text, line: line(node), typeOnly: false, kind: "import()" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 相对路径的 import 解析成仓库里的文件（带扩展名）；包名回 null；解析不到的回原样（让规则按前缀判） */
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return rel(cand);
  }
  return rel(base);
}

const files = walk(SRC);
let scanned = 0;
for (const file of files) {
  const me = rel(file);
  const inData = me.startsWith("src/data/");
  const inUi = me.startsWith("src/pages/") || me.startsWith("src/components/");
  const zeroDep = ZERO_DEP.includes(me);
  const noStore = NO_STORE.includes(me);
  const isFlow = me === FLOW_STORE;
  if (!inData && !zeroDep && !noStore && !isFlow && !inUi) continue;
  scanned++;
  for (const imp of importsOf(file)) {
    const target = resolveSpec(file, imp.spec);
    const where = `${me}:${imp.line}  ${imp.kind} ${JSON.stringify(imp.spec)}`;
    // ④ 页面 / 组件不直接碰原生插件
    if (inUi && imp.spec.startsWith("@capacitor/")) {
      fail(`${where}
      pages / components 不许直接 import @capacitor/*：原生能力从 utils / data 借（utils/nativeMerge.nativeFileSrc、utils/openExternal.onBrowserFinished 那样抽一个），插件换版本只改一处`);
    }
    // ① data 不许反向引 store / 页面 / 组件 / hook
    if (inData && target && UPSTREAM_OF_DATA.some((d) => target.startsWith(d))) {
      fail(`${where}\n      data 层不许 import ${target}（依赖方向单向：data → store → 组件；要共用的逻辑往 data 或 types 挪）`);
    }
    // ② flowStore 绝不认识 studioStore
    if (isFlow && /studioStore/.test(imp.spec)) {
      fail(`${where}\n      flowStore.ts 不许 import studioStore（两个 store 互相 import，Vite 下会拿到半初始化的模块；要同时读写两边的逻辑放 studioStore 或页面里）`);
    }
    // ③ 零依赖模块：只准 import type；值 import 只许来自另一个零依赖模块
    if (zeroDep && !imp.typeOnly && !(target && ZERO_DEP.includes(target))) {
      fail(`${where}\n      零依赖规则模块只准 import type（值引用只许另一个零依赖模块）：它要能被 Node 直接 import 跑正反例，多一个运行时依赖那道 check 就起不来`);
    }
    // ③′ 零 store 依赖
    if (noStore && target && target.startsWith("src/studio/")) {
      fail(`${where}\n      ${me} 是零 store 依赖的纯函数模块（CLAUDE.md），不许 import src/studio`);
    }
  }
}

for (const m of [...ZERO_DEP, ...NO_STORE, FLOW_STORE]) {
  if (!fs.existsSync(path.join(root, m))) fail(`${m} 不存在了 —— 改了名字就把这里的表一起改（否则这条规则对它静默失效）`);
}

if (problems.length) {
  console.error(`\n❌ import 方向检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   规则在 CLAUDE.md「约定」里（依赖方向单向 / flowStore 不认识 studioStore / 零依赖规则模块）；改规则先改那里，再改本脚本头上的表。\n");
  process.exit(1);
}
console.log(`✓ import 方向检查通过（扫了 ${scanned} 个文件：src/data ${files.filter((f) => rel(f).startsWith("src/data/")).length} 个 + flowStore + 零依赖模块 ${ZERO_DEP.length} 个）`);
