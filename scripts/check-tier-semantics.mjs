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
// 四条规则（只扫 src/**/*.ts(x)，注释不算）：
//   ① `flatCost` 只在 data/videoTierTable.ts（表本身）与 data/economy.ts 的 segTokens / durationStepsOf 两个函数里出现 ——
//      那是**价目**（报价、按发计价能选哪几个整档时长、clampDuration 的吸附也走 durationStepsOf）。判「是不是真人档」读 startOnly。
//   ② 拿供应商比大小（`providerOf(…) === "minimax"`、`providerOf(tierOf(x).id) === "minimax"`、`x.provider !== "ark"`、
//      `(x.provider ?? "ark") === "minimax"` 这类）只在 data/videoJobs.ts 与 ai/real.ts 的 takeVideoTask 里 ——
//      那几处问的就是「哪家」（取回凭据按家分流）。请求形状读 api，真人档语义读 startOnly。
//      别处确实问「哪家」的（flowStore 落凭据 / 「任务还在哪家那边跑」那句话、剪辑页重拍只认方舟）写放行标记。
//   ③ 同一行代码里 audio 与 refImg 用 && 或 || 连在一起（`audio && refImg`、`!!refImg && !!audio`、`refImg && !startOnly && audio`、
//      `audio === true && refImg === true`、`audio === false || refImg === false`……任一顺序、中间夹几个条件都算）一处都不许写 ——
//      读 refAudio（分镜表开不开读 economy.shotsOkOf）。「能力一样」的比较（`x.refImg === want.refImg && x.audio === want.audio`）
//      先剥掉再判，所以不红。字符串里的字不算（`clearsBlock("audio", …)`）。表本身（videoTierTable.ts）不扫这一条。
//   ④ 按请求形状分流只走 videoTierTable.apiCase：`.api === "…"` / `!== "…"`（任一顺序）与 `switch (….api)` 一处都不许写。
//      等号比较在 TierApi 加成员（P2b 的 minimax-v2）时一个错都不报，新协议会悄悄落进方舟那一支；apiCase 的 cases 缺键是 tsc 错。
//      表本身（videoTierTable.ts）不扫这一条。
//   ⑤ [model-name]（2026-10-26 出片地区 · 主人第 2 件审核）：**说「哪个出片模型」只走 account 那一组**（tierShownModel / tierShownModelId /
//      videoModelsLead / videoModelsNames / voiceModelsNames / refImgModelsNames）——economy.tierModelLabel / tierModelId 与 videoTierTable.modelLabel
//      只在下面 MODEL_NAME_OK 那几个函数里调。为什么要钉：那一组按地区写（地区不知道时只写档位名、不写 Seedance / MiniMax；这个地区给不出的那一家不写），
//      直接调取名函数的地方一律无条件写目录里的模型名 —— 美国的机器第一次打开就看到「Seedance」、海外门禁开着时紧挨着地区那句给被拦的那一家点名，
//      零报错。CLAUDE.md「出片地区」⑥ 原来写着「只走 offeredVideoModels 一处」，却没有任何检查钉住（审核抓到选模板抽屉、选法屏、本段设置、
//      工坊铸段窗、白模化报价五处还在直接调）。白名单里的都写了理由：取名函数本身、出图模型（Seedream，地区门禁只拦出片）、
//      今天一档都走不到的「报不出价」那一支。配方里记着的作者当时用的模型原来也在白名单里（「历史事实」），终审改走 account.recordedModelName：
//      历史事实也是供应商名，地区不知道的美国机器照样印出 Seedance。
//      放行标记是 `model-name-ok: 理由`。
//   ⑥ [secCost]（2026-10-26 出片地区 P2b）：按秒计价（MiniMax H3 三档的 secCost）只在 data/videoTierTable.ts（表本身）与 economy.segTokens 里出现 ——
//      与 flatCost 同一个理由：价目只该有一处读法，第二处读它的地方就是第二份报价（报价 ≠ 实扣零报错）。判「是不是 H3 / 请求怎么拼」读 api（apiCase）。
//   ⑦ [job-tier]（2026-10-26 出片地区 P2b 审核）：落取回凭据的 `rememberVideoJob( … )` 那一整个调用里（跨多行，注释与字符串不算）不许出现 `node.videoTier` ——
//      凭据上的家（provider）、接口版本（api）、档位都按**这一发真正发出去的那一档**算（flowStore.genNode 的 genTier）。定稿永远发给出样片的那一档（方舟），
//      而这一段之后可能在档位那一排换到了同一颗芯片的 MiniMax H3：按 node.videoTier 记的话，发给方舟的那一发被记成 MiniMax V2，
//      取回去问 /v2/video/:id 永远 404，24 小时之后卡上说「钱退不了」，零报错。这一条没有放行标记；一个调用都没扫到也算红（拼法改了这道门就静默失效）。
//
// 放行：命中行或它上一行写 `tier-semantics-ok: 理由`（理由要写；只写标记不写理由不算）；⑤ 用 `model-name-ok: 理由`。
// 局限（宁可漏报）：拆成两行写的比较、先存进变量再比的（`const p = providerOf(x); if (p === "minimax")`、`const ok = t.audio;` 下一行
//   `ok && t.refImg`）、`["minimax-v1"].includes(t.api)` 这类绕开等号的写法抓不到；单读 audio 当「带得了声音样本」也抓不到（那一位本身合法）。
//   行尾注释按「空白后面的 //」剥，字符串里带「 //」的那一行可能少扫半行。函数边界按「顶格的 function / 顶格的 }」认（全仓 prettier 排过）。
// ★ 仓内门禁纪律：写完先造真违规试红（--src= 指向改坏的副本）。逐条试过，下面各自变红：
//   ① segmentGen.carryIsHard 写回 `!!t.flatCost || !t.refImg`；② economy.deriveIssue 写回 `if (!tier.flatCost)`（economy 里白名单之外的函数）；
//   ③ real.slotModeOf 写回 `providerOf(sg.videoTier) === "minimax"`；④ economy.voiceTierNames 写回 `x.audio && x.refImg`（那个函数 2026-10-26 搬去 account.voiceModelsNames 了）；
//   ⑤ LeadShotsWizard 写回 `!!tier.refImg && tier.audio === true`；⑥ economy.refAudioSecOf 写回 `!t.audio || !t.refImg`；
//   ⑦ 去掉 CutPage 那一行的放行标记；⑧ 放行标记只写「tier-semantics-ok:」不写理由。
//   （2026-10-26 审核指出 ③ ② 有洞、补 ④ 时再试，下面各自变红）⑨ `tier.audio === true && tier.refImg === true`；⑩ `!!tier.refImg && !!tier.audio`；
//   ⑪ `x.refImg && !x.startOnly && x.audio`；⑫ `t.audio === false || t.refImg === false`；⑬ `(tier.provider ?? "ark") === "minimax"`；
//   ⑭ `providerOf(tierOf(x).id) === "minimax"`；⑮ real.slotModeOf 写回 `tierOf(sg.videoTier).api === "minimax-v1"`；
//   ⑯ flowStore.nodeDraftEligible 写回 `"ark" === tierOf(node.videoTier).api`；⑰ `switch (tier.api)`。
//   （2026-10-26 加 ⑤ 时再试，下面各自变红）⑱ ModePicker 写回 `{tierModelLabel(tier)}`；⑲ FlowCanvas 选模板抽屉写回 `tierModelLabel(need)`；
//   ⑳ TierRow 的 title 写回 `tierModelId(tier)`；㉑ economy.r2vBlockText 写回 `tierModelLabel(open)`（economy 里白名单之外的函数）；
//   ㉒ account 里白名单之外的函数（offeredVideoModels）调 `modelLabel(`；㉓ 放行标记只写「model-name-ok:」不写理由。
//   （2026-10-26 出片地区 P2b 加 ⑥ 时再试，下面各自变红）㉔ economy.clampDuration 里读 `tierOf(tierId).secCost`（economy 里白名单之外的函数）；
//   ㉕ account 里读 `t.secCost`。
//   （P2b 审核加 ⑦ 时再试，下面各自变红）㉖ flowStore.genNode 的 rememberVideoJob 里 provider 写回 `providerOf(node.videoTier)`；
//   ㉗ 同一个调用里 api 写回 `apiCase(tierOf(node.videoTier).api, …)`；㉘ 把 rememberVideoJob 改名（一个调用都扫不到）。
//   反例（不该红）：account.usableTierId 的 `x.refImg === want.refImg && x.audio === want.audio`（那是「能力一样」，不是「两样都有」）；
//   economy.providerOf 的 `provider ?? "ark"`（唯一那处缺省，后面不接比较）；ModePicker 的 `clearsBlock("audio", …)`（字在字符串里）。
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
const SEC_COST_OK = new Map([
  ["data/videoTierTable.ts", null],
  ["data/economy.ts", new Set(["segTokens"])],
]);
const PROVIDER_OK = new Map([
  ["data/videoJobs.ts", null],
  ["ai/real.ts", new Set(["takeVideoTask"])],
]);
const AUDIO_REF_OK = new Map([["data/videoTierTable.ts", null]]);
/** ⑤ 直接调取名函数的白名单（文件 → 允许的顶层函数名；null = 整个文件）。加一项要写清理由 */
const MODEL_NAME_OK = new Map([
  // modelLabel 的定义本身（零依赖的规则模块）
  ["data/videoTierTable.ts", null],
  [
    "data/economy.ts",
    new Set([
      "tierModelLabel", // 定义本身
      "tierModelId", // 定义本身
      // 「这一档报不出价（某模型的单价未核账）」：今天一档都走不到（开着参考视频 / 白模、价目却是 null 的档一档都没有）；真有了那一档，说的也是它自己的模型
      "r2vBlockOfTier",
      "blockoutBlockOfTier",
      "imageTierPriceIssue", // 出图模型（Seedream）：地区门禁只拦出片
    ]),
  ],
  // 唯一出口：只在地区问到了、这一档又摆得出来时写（见那一组的头注释）
  // recordedModelName：配方里记着的、作者当时用的那个模型（制作过程页）—— 也按地区写（2026-10-26 终审：原来 RecipeView 直接调 modelLabel、无条件写）
  ["data/account.ts", new Set(["tierShownModel", "tierShownModelId", "modelWithTiers", "videoModelsNames", "recordedModelName"])],
  ["ai/arkClient.ts", new Set(["imageModelGoneError", "runImageGroup"])], // 出图模型（Seedream）的报错
  ["studio/ui/NpcDialog.tsx", new Set(["ForgeForm"])], // 铸卡时「本次出图：…」—— 出图模型
]);
const API_OK = new Map([["data/videoTierTable.ts", null]]);

/** ③ 的判法：先把「能力一样」的比较（同一个键两边比：`x.refImg === want.refImg`）剥掉，再看同一行里 audio 与 refImg 有没有被 && / || 连起来 */
const SAME_CAP = /[\w.()?!]*\b(refImg|audio)\b\s*[!=]==?\s*[\w.()?!]*\b\1\b/g;
const JOINED = /\baudio\b[^;]*?(?:&&|\|\|)[^;]*?\brefImg\b|\brefImg\b[^;]*?(?:&&|\|\|)[^;]*?\baudio\b/;

const RULES = [
  {
    name: "flatCost",
    re: /\bflatCost\b/,
    ok: FLAT_OK,
    say: "按发计价表（flatCost）只在 economy.segTokens / durationStepsOf 里读 —— 判「只认一张起拍画面（真人档）」读 VideoTier.startOnly，要整档时长问 economy.durationStepsOf",
  },
  {
    name: "secCost",
    re: /\bsecCost\b/,
    ok: SEC_COST_OK,
    say: "按秒价目（secCost，MiniMax H3 三档）只在 economy.segTokens 里读 —— 要价钱问 segTokens / segmentCost，要判「是不是 H3 / 请求怎么拼」走 apiCase(tier.api, …)",
  },
  {
    name: "provider",
    re: new RegExp(
      [
        // provider / providerOf(…) === "minimax"（providerOf 的参数允许套一层括号：providerOf(tierOf(x).id)）
        String.raw`\bprovider(?:Of\((?:[^()]|\([^()]*\))*\))?\s*[!=]==?\s*["'](?:minimax|ark)["']`,
        // (x.provider ?? "ark") === …：自己补一份缺省再比（缺省只在 economy.providerOf 一处，它后面不接比较）
        String.raw`\bprovider\s*\?\?\s*["'](?:ark|minimax)["']\s*\)\s*[!=]==?`,
        // "minimax" === [(]x.provider / providerOf
        String.raw`["'](?:minimax|ark)["']\s*[!=]==?\s*\(?\s*[\w.]*\bprovider(?:Of\b)?`,
      ].join("|"),
    ),
    ok: PROVIDER_OK,
    say: "拿供应商判档位语义：请求形状走 apiCase、只认起拍画面读 startOnly、带不带声音样本读 refAudio；真问「哪家」的写 tier-semantics-ok: 理由",
  },
  {
    name: "audio&&refImg",
    // 字符串换成等长的 x 再判（maskStrings）：`clearsBlock("audio", …)` 里的字不是代码
    test: (code) => JOINED.test(maskStrings(code).replace(SAME_CAP, " ")),
    ok: AUDIO_REF_OK,
    say: "「带得了声音样本」读 VideoTier.refAudio（分镜表开不开问 economy.shotsOkOf），别拼 audio && refImg —— 海外 MiniMax H3 出声、收参考图，却不收声音样本",
  },
  {
    name: "api==",
    re: new RegExp(
      [
        // x.api === "…" / api !== "…"
        String.raw`\bapi\s*[!=]==?\s*["']`,
        // "…" === x.api
        String.raw`["'][\w-]*["']\s*[!=]==?\s*[\w.()]*\bapi\b`,
        // switch (x.api)：没有穷尽检查的 switch 与等号一样，新成员悄悄落进 default
        String.raw`\bswitch\s*\(\s*[\w.()]*\bapi\s*\)`,
      ].join("|"),
    ),
    ok: API_OK,
    say: "按请求形状分流只走 apiCase(tier.api, { ark: …, \"minimax-v1\": …, \"minimax-v2\": … })（economy 转出）—— 等号与 switch 在 TierApi 加成员时一个错都不报",
  },
  {
    name: "model-name",
    // 调用（后面跟括号），不算 import / export 列表；`.modelLabel(` 这种别人的方法不算
    re: /(?<![\w$.])(?:tierModelLabel|modelLabel|tierModelId)\s*\(/,
    ok: MODEL_NAME_OK,
    mark: /model-name-ok:\s*\S/,
    say: "说「哪个出片模型」只走 account.tierShownModel / tierShownModelId / videoModelsNames（地区不知道时只写档位名、这个地区给不出的那一家不写）；真要写目录里的模型名，写 model-name-ok: 理由",
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

/** ⑦ [job-tier]：落取回凭据的调用（`function rememberVideoJob(` 那个定义不算） */
const JOB_CALL = /(?<![\w$.])rememberVideoJob\s*\(/g;
const JOB_BAD = /\bnode\.videoTier\b/;
const JOB_SAY =
  "取回凭据的 provider / api / videoTier 按这一发真正发出去的那一档算（flowStore.genNode 的 genTier：定稿发给出样片的那一档），别读 node.videoTier —— 这一段之后可能换到了同一颗芯片的另一家";
let jobCalls = 0;

/**
 * ⑦ 在一个文件**去掉注释、字符串换成 x** 之后的整段代码里找 rememberVideoJob( … ) 的每一个调用，按括号配对取出整个参数，看里面有没有 node.videoTier。
 * 跨多行（那个对象字面量几十行）所以不走逐行的 RULES。
 */
function scanJobCalls(rel, codeLines) {
  const joined = codeLines.join("\n");
  for (const m of joined.matchAll(JOB_CALL)) {
    if (/function\s+$/.test(joined.slice(Math.max(0, m.index - 16), m.index))) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = joined.length;
    for (let k = open; k < joined.length; k++) {
      if (joined[k] === "(") depth++;
      else if (joined[k] === ")" && --depth === 0) {
        end = k + 1;
        break;
      }
    }
    jobCalls++;
    const args = joined.slice(open, end);
    const bad = JOB_BAD.exec(args);
    if (bad) {
      const line = joined.slice(0, open + bad.index).split("\n").length;
      hits.push(`${rel}:${line}  [job-tier] rememberVideoJob( … ) 里读了 node.videoTier\n      → ${JOB_SAY}`);
    }
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
  /** 这个文件去掉注释、字符串换成 x 之后的每一行（⑦ 跨行扫用；位置与原行一一对应） */
  const codeLines = [];
  lines.forEach((raw, i) => {
    const top = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/.exec(raw);
    if (top) fn = top[1];
    const [code, still] = codeOf(raw, inBlock);
    inBlock = still;
    codeLines.push(maskStrings(code));
    if (code.trim()) {
      for (const r of RULES) {
        if (!(r.test ? r.test(code) : r.re.test(code))) continue;
        const allow = r.ok.get(rel);
        if (allow === null || (allow && fn && allow.has(fn))) continue;
        const mark = r.mark ?? MARK;
        if (mark.test(raw) || (i > 0 && mark.test(lines[i - 1]))) continue;
        hits.push(`${rel}:${i + 1}  [${r.name}] ${raw.trim().slice(0, 110)}\n      → ${r.say}`);
      }
    }
    if (/^\}/.test(raw)) fn = null;
  });
  scanJobCalls(rel, codeLines);
}

if (!scanned) {
  console.error(`✗ check-tier-semantics：${SRC} 下一个 .ts / .tsx 都没扫到（路径不对？）`);
  process.exit(1);
}
if (!jobCalls) {
  console.error(
    `✗ check-tier-semantics [job-tier]：${SRC} 里一处 rememberVideoJob( … ) 调用都没扫到 —— 改了名字就把 JOB_CALL 一起改，否则这条规则什么都不查`,
  );
  process.exit(1);
}
if (hits.length) {
  console.error(`\n❌ check-tier-semantics：${hits.length} 处拿价目表 / 供应商 / audio && refImg 推档位语义、绕过 account 直接写出片模型名，或落取回凭据时读了这一段现在挂的档（扫了 ${scanned} 个文件）：\n`);
  for (const h of hits) console.error("  · " + h);
  console.error(
    "\n改法：档位语义读 src/data/videoTierTable.ts 的能力位（startOnly / refAudio），请求形状走 apiCase；真问「哪家」的那一行或上一行写 tier-semantics-ok: 理由。\n" +
      "      出片模型名走 account.tierShownModel 那一组（[model-name]）；真要写目录里的名字，那一行或上一行写 model-name-ok: 理由。\n",
  );
  process.exit(1);
}
console.log(
  `✓ check-tier-semantics：${scanned} 个文件里档位语义都读能力位（flatCost 只在报价 / 整档时长、secCost 只在报价、供应商比较只在取回分流、没有 audio && refImg、api 分流只走 apiCase、出片模型名只走 account 那一组、${jobCalls} 处落取回凭据都按真发出去的那一档记）`,
);
