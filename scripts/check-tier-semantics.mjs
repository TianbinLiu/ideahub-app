#!/usr/bin/env node
// 构建门禁：**档位语义只读能力位**，不许拿价目表或供应商去推（2026-10-26，出片地区 P2a）。
//
// ★★ 为什么要有它：「真人档」那一行同时是「按发计价（flatCost）」「MiniMax（provider）」「只认一张起拍画面」「带不了声音样本」——
//   四件事碰巧落在同一行上，于是全仓十几处拿前两件代替后两件（`!!tier.flatCost` 判「不画设定帧 / 没有推演」，
//   `providerOf(x) === "minimax"` 判「请求只带一张首帧」，`audio && refImg` 判「带得了声音样本」）。
//   海外 MiniMax H3（P2b）一进档位表，这些代用判据就一起判错：它也是 MiniMax，却收参考图、按秒计价、出声却不收声音样本 ——
//   而每一处错都是零报错（报价多算两张图、选法屏摆错模式、带着声音样本的对话段在花钱之前被契约核对整段拒掉……）。
//   同日把它们全部改读 videoTierTable 的能力位（startOnly / api / refAudio），这里是棘轮：代用判据不会悄悄长回来。
//
// 三条规则（只扫 src/**/*.ts(x)，注释不算）：
//   ① `flatCost` 只在 data/videoTierTable.ts（表本身）与 data/economy.ts 的 segTokens / durationStepsOf 两个函数里出现 ——
//      那是**价目**（报价、按发计价能选哪几个整档时长、clampDuration 的吸附也走 durationStepsOf）。判「是不是真人档」读 startOnly。
//   ② 拿供应商比大小（`providerOf(…) === "minimax"`、`x.provider !== "ark"` 这类）只在 data/videoJobs.ts 与
//      ai/real.ts 的 takeVideoTask 里 —— 那几处问的就是「哪家」（取回凭据按家分流）。请求形状读 api，真人档语义读 startOnly。
//      别处确实问「哪家」的（flowStore 落凭据 / 「任务还在哪家那边跑」那句话、剪辑页重拍只认方舟）写放行标记。
//   ③ `audio && refImg`（任一顺序、带不带 `=== true`，以及 `!audio || !refImg`）一处都不许写 —— 读 refAudio
//      （分镜表开不开读 economy.shotsOkOf）。表本身（videoTierTable.ts）不扫这一条。
//
// 放行：命中行或它上一行写 `tier-semantics-ok: 理由`（理由要写；只写标记不写理由不算）。
// 局限（宁可漏报）：拆成两行写的比较、先存进变量再比的（`const p = providerOf(x); if (p === "minimax")`）抓不到；
//   行尾注释按「空白后面的 //」剥，字符串里带「 //」的那一行可能少扫半行。函数边界按「顶格的 function / 顶格的 }」认（全仓 prettier 排过）。
// ★ 仓内门禁纪律：写完先造真违规试红（--src= 指向改坏的副本）。逐条试过，下面各自变红：
//   ① segmentGen.carryIsHard 写回 `!!t.flatCost || !t.refImg`；② economy.deriveIssue 写回 `if (!tier.flatCost)`（economy 里白名单之外的函数）；
//   ③ real.slotModeOf 写回 `providerOf(sg.videoTier) === "minimax"`；④ economy.voiceTierNames 写回 `x.audio && x.refImg`；
//   ⑤ LeadShotsWizard 写回 `!!tier.refImg && tier.audio === true`；⑥ economy.refAudioSecOf 写回 `!t.audio || !t.refImg`；
//   ⑦ 去掉 CutPage 那一行的放行标记；⑧ 放行标记只写「tier-semantics-ok:」不写理由。
//   反例（不该红）：account.usableTierId 的 `x.refImg === want.refImg && x.audio === want.audio`（那是「能力一样」，不是「两样都有」）。
//
// 用法：node scripts/check-tier-semantics.mjs [--src=<另一份 src 目录，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const srcArg = process.argv.find((a) => a.startsWith("--src="))?.slice("--src=".length);
const SRC = path.resolve(srcArg ?? path.join(root, "src"));

/** 白名单：文件（相对 src，正斜杠）→ 允许的顶层函数名（null = 整个文件） */
const FLAT_OK = new Map([
  ["data/videoTierTable.ts", null],
  ["data/economy.ts", new Set(["segTokens", "durationStepsOf"])],
]);
const PROVIDER_OK = new Map([
  ["data/videoJobs.ts", null],
  ["ai/real.ts", new Set(["takeVideoTask"])],
]);
const AUDIO_REF_OK = new Map([["data/videoTierTable.ts", null]]);

const RULES = [
  {
    name: "flatCost",
    re: /\bflatCost\b/,
    ok: FLAT_OK,
    say: "按发计价表（flatCost）只在 economy.segTokens / durationStepsOf 里读 —— 判「只认一张起拍画面（真人档）」读 VideoTier.startOnly，要整档时长问 economy.durationStepsOf",
  },
  {
    name: "provider",
    re: /\bprovider(?:Of\([^)]*\))?\s*[!=]==?\s*["'](?:minimax|ark)["']|["'](?:minimax|ark)["']\s*[!=]==?\s*[\w.]*\bprovider(?:Of\b)?/,
    ok: PROVIDER_OK,
    say: "拿供应商判档位语义：请求形状读 VideoTier.api、只认起拍画面读 startOnly、带不带声音样本读 refAudio；真问「哪家」的写 tier-semantics-ok: 理由",
  },
  {
    name: "audio&&refImg",
    re: new RegExp(
      [
        // audio [=== true] && …refImg（后面不能再接比较：`x.refImg === want.refImg` 那种是「能力一样」）
        String.raw`\baudio\b(?:\s*===\s*true)?\s*&&\s*!?[\w.()]*\brefImg\b(?!\s*[!=]==?)`,
        // refImg && …audio [=== true]
        String.raw`\brefImg\b\s*&&\s*!?[\w.()]*\baudio\b(?:\s*===\s*true)?(?!\s*[!=]==?)`,
        // !audio || !refImg（任一顺序）
        String.raw`!\s*[\w.()]*\baudio\b\s*\|\|\s*!\s*[\w.()]*\brefImg\b`,
        String.raw`!\s*[\w.()]*\brefImg\b\s*\|\|\s*!\s*[\w.()]*\baudio\b`,
      ].join("|"),
    ),
    ok: AUDIO_REF_OK,
    say: "「带得了声音样本」读 VideoTier.refAudio（分镜表开不开问 economy.shotsOkOf），别拼 audio && refImg —— 海外 MiniMax H3 出声、收参考图，却不收声音样本",
  },
];

const MARK = /tier-semantics-ok:\s*\S/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name === "locales" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * 把一行里字符串字面量的内容换成等长的 x（引号留着）：找注释符号时不被 `accept="image/*"`、`"https://…"` 骗
 * （前者会被当成一段块注释的开头，把后面几百行都当注释跳过 —— 漏报一大片）。位置与原行一一对应。
 */
function maskStrings(line) {
  return line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => m[0] + "x".repeat(m.length - 2) + m[m.length - 1]);
}

/**
 * 一行里的代码部分（注释换成空白）。inBlock = 上一行留下的块注释还没关。返回 [代码, 这一行结束时块注释还开着没有]。
 * 多行块注释（/** … *\/、JSX 的 {/* … *\/}）整段不算；行尾 // 注释不算。
 */
function codeOf(raw, inBlock) {
  let code = raw;
  let masked = maskStrings(raw);
  const blank = (s, from, to) => s.slice(0, from) + " ".repeat(to - from) + s.slice(to);
  let at = 0;
  if (inBlock) {
    const end = masked.indexOf("*/");
    if (end < 0) return ["", true];
    code = blank(code, 0, end + 2);
    masked = blank(masked, 0, end + 2);
    at = end + 2;
  }
  for (;;) {
    const line = masked.indexOf("//", at);
    const block = masked.indexOf("/*", at);
    if (line < 0 && block < 0) return [code, false];
    if (line >= 0 && (block < 0 || line < block)) return [code.slice(0, line), false];
    const end = masked.indexOf("*/", block + 2);
    if (end < 0) return [code.slice(0, block), true];
    code = blank(code, block, end + 2);
    masked = blank(masked, block, end + 2);
    at = end + 2;
  }
}

const hits = [];
let scanned = 0;
for (const file of walk(SRC)) {
  scanned++;
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let fn = null;
  let inBlock = false;
  lines.forEach((raw, i) => {
    const top = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/.exec(raw);
    if (top) fn = top[1];
    const [code, still] = codeOf(raw, inBlock);
    inBlock = still;
    if (code.trim()) {
      for (const r of RULES) {
        if (!r.re.test(code)) continue;
        const allow = r.ok.get(rel);
        if (allow === null || (allow && fn && allow.has(fn))) continue;
        if (MARK.test(raw) || (i > 0 && MARK.test(lines[i - 1]))) continue;
        hits.push(`${rel}:${i + 1}  [${r.name}] ${raw.trim().slice(0, 110)}\n      → ${r.say}`);
      }
    }
    if (/^\}/.test(raw)) fn = null;
  });
}

if (!scanned) {
  console.error(`✗ check-tier-semantics：${SRC} 下一个 .ts / .tsx 都没扫到（路径不对？）`);
  process.exit(1);
}
if (hits.length) {
  console.error(`\n❌ check-tier-semantics：${hits.length} 处拿价目表 / 供应商 / audio && refImg 推档位语义（扫了 ${scanned} 个文件）：\n`);
  for (const h of hits) console.error("  · " + h);
  console.error(
    "\n改法：档位语义读 src/data/videoTierTable.ts 的能力位（startOnly / api / refAudio）；真问「哪家」的那一行或上一行写 tier-semantics-ok: 理由。\n",
  );
  process.exit(1);
}
console.log(`✓ check-tier-semantics：${scanned} 个文件里档位语义都读能力位（flatCost 只在报价 / 整档时长、供应商比较只在取回分流、没有 audio && refImg）`);
