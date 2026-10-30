// 构建门禁：flowStore 里**领了炉号的函数，清 busy 之前必须先问"还是我这一炉"**。
//
// ★★ 规则本身（FlowState.genRun 头上那段 ★★）：出片 / 推演 / 重画 / 改帧 / 挂卡合成都是几分钟的异步，这期间用户完全可以
//   把整条流水线换掉、删掉那一段、甚至换账号。老那一炉回来时若照旧 `set({ busy: false })`，而那时新的一炉可能已经在跑，
//   「同一时刻只炼一段」这道闸就被一个**已经作废的回包**打开 —— 可以并发出第三炉，钱照扣、写回打在别的段上。
//   所以每个 `const myRun = get().genRun + 1` 的函数体里，每一处 `busy: false` 都要挂在 `genRun === myRun` 之后。
//   今天 12 处全挂着（2026-10-15 教材人格评审 feathers-testing-2 清点：不是现存缺陷），但没有会变红的闸 —— flowStore import 了
//   lingui 与 ../ai，没有一道脚本 import 得了它，所以这里按**源文件结构**查，不跑代码（第一刀；要跑行为得先有能 mock 的 runner）。
//
// 判据（刻意保守，宁可漏报不误报 —— 误报会让人把整个检查关掉）：
//   · 只看 src/studio/flowStore.ts；只看含 `const myRun = get().genRun + 1` 的函数体。函数头 = 这一行往上最近的一条
//     缩进更浅的 `xxx: async (…) => {` / `function xxx(…) {`，函数尾 = 函数头之后第一条与它同缩进的 `}` 行（本仓 prettier 2 空格，
//     action 一律 `  genNode: async (id, opts) => {` … `  },`）。
//   · 体内每一处 `busy: false`（注释行不算；`castBusy: false` 这种别的键不算）要么本行、要么前 4 行里有 `genRun === myRun`，
//     要么体内更早的某一行是 `if (get().genRun !== myRun) return`（那种写法之后整段都在"还是我这一炉"里）。都没有 → 报错。
//   · 一个 `myRun` 都找不到、或一处受保护的 `busy: false` 都数不出来 → 也报错：那多半是改了拼法，这道门静默失效比没有更坏。
//   ⚠ 漏报的形状知道有：注释里恰好写着 `genRun === myRun` 挡在前 4 行；早退写在别的分支里而 busy 在另一个分支。都往"不报"的方向错。
//
// 仓内门禁纪律：写完先造真违规试红（照 check-hook-order 的教训 —— 不试红的门禁只是多了一句「✓ 通过」）。
//   2026-10-15 实跑了两个违规（各拷一份 src/studio/flowStore.ts 到 scratchpad 的 genrun-red / genrun-red2 下的 src/studio/，
//   `node scripts/check-gen-run.mjs --root=<那个目录>`）：
//   ① 把 regenProposal 成功收尾那一行 `set(get().genRun === myRun ? { busy: false, genNotice: … } : {})` 改成裸的
//      `set({ busy: false, genNotice: … })` → 「regenProposal() 里这一处 busy: false 没挂在 genRun === myRun 之后」、exit 1（前 4 行那条规则）；
//   ② 把 genNode 里唯一那句 `if (get().genRun !== myRun) return false;` 换成注释 → 它后面那处 `set({ busy: false, err: pendingErr })`
//      被报出来、exit 1（早退那条规则真的在起作用，不是靠前 4 行蒙对的）；
//   真文件 → 「✓ genRun 令牌检查通过（5 个函数、12 处 busy: false 都挂着闸）」、exit 0 —— 5 / 12 与 feathers-testing-2 清点的数一致。
//
// 用法：node scripts/check-gen-run.mjs [--root=<另一个仓库根，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const rootArg = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length);
const root = path.resolve(rootArg ?? path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), ".."));
const FILE = path.join(root, "src", "studio", "flowStore.ts");
const rel = path.relative(root, FILE).split(path.sep).join("/");

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(FILE)) fail(`${rel} 不存在了 —— 改了名字就把这里的路径一起改（否则这条规则对它静默失效）`);
const lines = fs.readFileSync(FILE, "utf8").split(/\r?\n/);

/** 领炉号那一行（拼法改了这里要跟着改，下面的"一个都没找到"会先红） */
const TOKEN = /\bconst myRun = get\(\)\.genRun \+ 1\b/;
/** 清 busy：`busy: false`。前面不许是字母 / 点 —— `castBusy: false`、`s.busy` 之类不是这把闸管的 */
const BUSY_OFF = /(?<![\w.])busy\s*:\s*false\b/;
const GUARD = /genRun === myRun/;
const EARLY = /if \(get\(\)\.genRun !== myRun\) return\b/;
/** 函数头：store action（`  name: async (…) => {`）或普通函数声明（`function name(…) {`）。行尾必须是 `{` */
const HEADER = /^(\s*)(?:[\w$]+\s*:\s*(?:async\s+)?\(.*\)\s*=>\s*\{|(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*(?:<[^>]*>)?\s*\(.*\)\s*\{)\s*$/;
const GUARD_WINDOW = 4;

const isComment = (ln) => {
  const s = ln.trim();
  return s.startsWith("//") || s.startsWith("*") || s.startsWith("/*");
};
const indentOf = (ln) => ln.length - ln.trimStart().length;

/** 从领炉号那一行往上找函数头（缩进更浅的那一条）；再往下找同缩进的 `}` 当函数尾。找不到就跳过（保守：不猜） */
function bodyOf(tokenLine) {
  const tokenIndent = indentOf(lines[tokenLine]);
  let head = -1;
  for (let i = tokenLine - 1; i >= 0; i--) {
    const m = HEADER.exec(lines[i]);
    if (m && m[1].length < tokenIndent) {
      head = i;
      break;
    }
  }
  if (head < 0) return null;
  const headIndent = indentOf(lines[head]);
  const closer = new RegExp(`^\\s{${headIndent}}\\}`);
  for (let i = head + 1; i < lines.length; i++) {
    if (closer.test(lines[i]) && indentOf(lines[i]) === headIndent) return { head, from: head + 1, to: i };
  }
  return null;
}

const problems = [];
let fnCount = 0;
let guardedCount = 0;

lines.forEach((ln, tokenLine) => {
  if (!TOKEN.test(ln) || isComment(ln)) return;
  const body = bodyOf(tokenLine);
  if (!body) {
    problems.push(`${rel}:${tokenLine + 1}  这一行领了炉号，但认不出它所在的函数头 / 函数尾（形状变了就来改 HEADER 的正则，别让这道门静默跳过它）`);
    return;
  }
  fnCount++;
  const name = /^\s*(?:(?:export\s+)?(?:async\s+)?function\s+)?([\w$]+)/.exec(lines[body.head])?.[1] ?? "?";
  let earlyAt = -1;
  for (let i = body.from; i < body.to; i++) {
    const cur = lines[i];
    if (isComment(cur)) continue;
    if (earlyAt < 0 && EARLY.test(cur)) earlyAt = i;
    if (!BUSY_OFF.test(cur)) continue;
    let guarded = GUARD.test(cur);
    for (let j = Math.max(body.from, i - GUARD_WINDOW); !guarded && j < i; j++) guarded = GUARD.test(lines[j]);
    if (!guarded && earlyAt >= 0 && earlyAt < i) guarded = true;
    if (guarded) guardedCount++;
    else problems.push(`${rel}:${i + 1}  ${name}() 里这一处 busy: false 没挂在 genRun === myRun 之后（这个函数在第 ${tokenLine + 1} 行领了炉号）`);
  }
});

if (fnCount === 0) fail(`${rel} 里一处 \`const myRun = get().genRun + 1\` 都没找到 —— 拼法改了就把 TOKEN 一起改，否则这道门什么都不查`);
if (guardedCount === 0 && problems.length === 0) fail(`${rel} 里一处受保护的 busy: false 都没数出来 —— 判据多半失效了（BUSY_OFF / GUARD 的拼法）`);

if (problems.length) {
  console.error("\n❌ 领了炉号的函数里有 busy: false 没问「还是我这一炉」（作废的回包会把「同一时刻只炼一段」的闸打开，可以并发出第三炉）：\n");
  for (const p of problems) console.error("   " + p);
  console.error(
    "\n   改法：写成 set(get().genRun === myRun ? { busy: false, … } : { … })，或在前面先 `if (get().genRun !== myRun) return`。" +
      "\n   为什么必须：见 flowStore FlowState.genRun 头上的 ★★。\n",
  );
  process.exit(1);
}
console.log(`✓ genRun 令牌检查通过（${fnCount} 个函数、${guardedCount} 处 busy: false 都挂着闸）`);
