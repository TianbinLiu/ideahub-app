#!/usr/bin/env node
// 构建门禁：出图档位表与「绝不发一个停用的型号」（2026-10-10，方舟第十批下线：2026-11-24 14:00 北京时间）。
//
// ★★ 为什么要有它：这几种错全是零报错 ——
//   · 价目表（economy.IMAGE_TOKENS_BY_MODEL）与服务端那张对不上：报价 ≠ 实扣，两个方向都不报错（服务端 tests 钉着同一张表，
//     这里钉 App 这一半；改价两边一起改）；
//   · 档位表里某一档的模型不在价目表里：那一档报不出价、按钮灰着（imageTierPriceIssue），像「这档坏了」；
//     价目表里多一个没有档位用的型号：等于给"又悄悄发老型号"留了一条报价对得上的路；
//   · 代码里又出现了一个已经下线的出图型号（4.0 250828 / 4.5 251128 / 5.0 lite 260128）：11-24 之后那一发必然失败，
//     而它多半藏在某个不常走的路上，要到用户撞上才知道；
//   · 兜底视频模型（arkClient.MODELS.video）还是 Seedance 1.0：哪天有人漏传 opts.model 就悄悄发一个停用的型号；
//   · 默认档出不了组图：九宫格那一发整发 400，或只回一张、按一张结算；
//   · 「现做一个主角」引用的档位 id 不在档位表里：imageTierOf 悄悄退回速写（一张图），B 少一张特写、报价也跟着变，零报错。
//   规则一条都不在这里重打：读源文件里那几张表本身（economy.ts 带 Lingui 宏，Node 直接 import 不了，所以按源码读）。
// ★ 仓内门禁纪律：写完先造真违规试红（--economy= / --ark= / --lead= 指向改坏的副本）。逐条试过，下面这几条各自变红：
//   ① 价目表里加回 4-5-251128；② 速写的 model 改回 4-0-250828（价目表与停用型号两条一起红）；③ 速写的 groupOk 改成 false；
//   ④ MODELS.video 改回 doubao-seedance-1-0-pro-250528；⑤ LEAD_IMAGE_TIER 改回 "studio"。
//
// 用法：node scripts/check-image-tiers.mjs [--economy=<economy.ts 副本>] [--ark=<arkClient.ts 副本>] [--lead=<leadCast.ts 副本>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const econPath = path.resolve(arg("economy") ?? path.join(root, "src/data/economy.ts"));
const arkPath = path.resolve(arg("ark") ?? path.join(root, "src/ai/arkClient.ts"));
const leadPath = path.resolve(arg("lead") ?? path.join(root, "src/studio/leadCast.ts"));

const problems = [];
let ran = 0;
const ok = (what, cond) => {
  ran++;
  if (!cond) problems.push(what);
};

/**
 * 出图价目表的**期望值** —— 跨仓契约的 App 这一半（服务端 config/tokens.js 的 IMAGE_TOKENS_BY_MODEL 钉着同一张，在它自己的 tests 里）。
 * ★ 这不是第二份实现：报价只读 economy.ts 那张表，这里只核对它没被改走样。改价 = 两仓一起改（服务端先发），再改这一行。
 * ⚠ 速写那一格 13,333 是**推断、待账单核**（沿用 4.0 的官方价），见 economy.ts 那一格的 ⚠。
 */
const EXPECTED_PRICES = {
  "doubao-seedream-4-0-20260415": 13_333,
  "doubao-seedream-5-0-pro-260628": 40_000,
};

/** 方舟第十批下线（2026-11-24 14:00）里的**出图**型号：App 的代码里一个都不许再出现（注释里讲历史可以） */
const RETIRED_IMAGE_MODELS = ["doubao-seedream-4-0-250828", "doubao-seedream-4-5-251128", "doubao-seedream-5-0-260128"];

/**
 * 去掉注释（行注释 / 块注释），字符串原样留着 —— 停用型号只要出现在**代码**里就算（字符串字面量正是发出去的那个 id）。
 * ★ 一个够用的小扫描器：认 ' " ` 三种字符串（模板里的 ${} 不细分，只是不把里面的 // 当注释），认 // 与块注释。
 *   正则字面量里的 // 罕见，碰上了也只会多删一截代码 —— 方向是「漏报」不是「误报」，这道检查的主路是字符串里的型号 id。
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (q !== "`" && src[i] === "\n") break; // 坏掉的字符串：别把整个文件吞进去
        out += src[i];
        i++;
      }
      out += src[i] ?? "";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 从源码里取出 `<head> … \n};` / `\n];` 那一整块（不含注释） */
function block(src, head, close) {
  const at = src.indexOf(head);
  if (at < 0) return null;
  const end = src.indexOf(close, at);
  if (end < 0) return null;
  return stripComments(src.slice(at + head.length, end));
}

const econ = fs.readFileSync(econPath, "utf8");
const ark = fs.readFileSync(arkPath, "utf8");
const lead = fs.readFileSync(leadPath, "utf8");

// ── 价目表 = 期望的那张，一格不多一格不少 ──
const priceBlock = block(econ, "export const IMAGE_TOKENS_BY_MODEL: Record<string, number> = {", "\n};");
ok("economy.ts 里找不到 IMAGE_TOKENS_BY_MODEL", priceBlock !== null);
const prices = {};
for (const m of (priceBlock ?? "").matchAll(/"([\w.-]+)"\s*:\s*([\d_]+)/g)) prices[m[1]] = Number(m[2].replace(/_/g, ""));
{
  const want = JSON.stringify(Object.entries(EXPECTED_PRICES).sort());
  const got = JSON.stringify(Object.entries(prices).sort());
  ok(`出图价目表与跨仓契约对不上（改价两仓一起改，服务端先发）\n      want ${want}\n      got  ${got}`, want === got);
}

// ── 档位表：每一档的模型都在价目表里，价目表里的每个型号都有档位用；groupOk 每一档都写；默认档能出组图 ──
const tierBlock = block(econ, "export const IMAGE_TIERS: ImageTier[] = [", "\n];");
ok("economy.ts 里找不到 IMAGE_TIERS", tierBlock !== null);
const tiers = (tierBlock ?? "")
  .split(/\n\s{2}\{\s*\n/)
  .slice(1)
  .map((chunk) => ({
    id: /\bid:\s*"([\w-]+)"/.exec(chunk)?.[1] ?? "",
    model: /\bmodel:\s*"([\w.-]+)"/.exec(chunk)?.[1] ?? "",
    groupOk: /\bgroupOk:\s*(true|false)/.exec(chunk)?.[1] ?? "",
  }));
ok("IMAGE_TIERS 一档都没读出来（表的写法变了？改这个检查的读法）", tiers.length > 0);
for (const t of tiers) {
  ok(`IMAGE_TIERS 有一档没写 id：${JSON.stringify(t)}`, !!t.id);
  ok(`「${t.id}」档的模型 ${t.model || "（没写）"} 不在出图价目表里 —— 那一档报不出价`, t.model in prices);
  ok(`「${t.id}」档没写 groupOk（必须显式 true / false，见 ImageTier.groupOk）`, t.groupOk === "true" || t.groupOk === "false");
}
for (const model of Object.keys(prices)) {
  ok(`价目表里的 ${model} 没有任何一档在用 —— 删掉它，别给"又发老型号"留一条报价对得上的路`, tiers.some((t) => t.model === model));
}
const defaultId = /export const DEFAULT_IMAGE_TIER = "([\w-]+)"/.exec(econ)?.[1];
const defaultTier = tiers.find((t) => t.id === defaultId);
ok(`DEFAULT_IMAGE_TIER（${defaultId}）不在 IMAGE_TIERS 里`, !!defaultTier);
ok(
  `默认档「${defaultId}」的模型出不了组图（groupOk 不是 true）—— 九宫格的组图用的就是默认档的模型（arkClient.MODELS.image）`,
  defaultTier?.groupOk === "true",
);

// ── 「现做一个主角」引用的档位必须在表里（不在 = imageTierOf 悄悄退回默认档）──
const leadTier = /export const LEAD_IMAGE_TIER = "([\w-]+)"/.exec(lead)?.[1];
ok("leadCast.ts 里找不到 LEAD_IMAGE_TIER", !!leadTier);
ok(`LEAD_IMAGE_TIER「${leadTier}」不在 IMAGE_TIERS 里 —— imageTierOf 会悄悄退回默认档（一张图），报价与张数一起变`, tiers.some((t) => t.id === leadTier));

// ── 兜底视频模型不许是停用的 Seedance 1.0 ──
const modelsBlock = block(ark, "export const MODELS = {", "\n};");
ok("arkClient.ts 里找不到 MODELS", modelsBlock !== null);
const fallbackVideo = /\bvideo:\s*"([\w.-]+)"/.exec(modelsBlock ?? "")?.[1] ?? "";
ok(`arkClient.MODELS.video 是「${fallbackVideo || "（没读出来）"}」—— 兜底视频模型不许是停用的 Seedance 1.0`, !!fallbackVideo && !/seedance-1-0/.test(fallbackVideo));

// ── 停用的出图型号：src 的代码里一个都不许有（注释里讲历史可以）──
{
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, "src"));
  // 造违规试红时，被替换的那几份按副本读
  const override = new Map([
    [path.join(root, "src/data/economy.ts"), econ],
    [path.join(root, "src/ai/arkClient.ts"), ark],
    [path.join(root, "src/studio/leadCast.ts"), lead],
  ]);
  for (const f of files) {
    const code = stripComments(override.get(f) ?? fs.readFileSync(f, "utf8"));
    for (const id of RETIRED_IMAGE_MODELS) {
      ok(`${path.relative(root, f)} 的代码里还有停用的出图型号 ${id}（方舟 2026-11-24 下线）`, !code.includes(id));
    }
  }
}

if (problems.length) {
  console.error(`\n❌ 出图档位检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：出图档位与价目只在 src/data/economy.ts（IMAGE_TIERS / IMAGE_TOKENS_BY_MODEL）；改价先改服务端 config/tokens.js（服务端先发）。\n");
  process.exit(1);
}
console.log(`✓ 出图档位检查通过（${ran} 条：价目 = 跨仓契约 / 档位都有价 / groupOk 必写、默认档能出组图 / 现做主角的档在表里 / 兜底视频模型 / 代码里没有停用的出图型号）`);
