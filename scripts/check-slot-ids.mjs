#!/usr/bin/env node
// 构建门禁：提示词方案图位 id（src/data/schemeSlotIds.ts）的正反例实跑（多语言 PR2，2026-09-11）。
//
// ★★ 为什么要有它：图位的身份从 tag（名字）挪到了 id，而赋 id 判错全是零报错的，tsc 一个都看不见
//   （schemeShots 是 Record<string, Shot>）——
//   · 认错一格 = 自建卡草稿里一张脸部照片挂到全身那一格上（「已装 · 用它」重装自己的方案那条路，设计 3 的阻断项）；
//   · id 跟着改了 role 的格子走 = 另存内置方案的副本把「全身立绘」改成脸部那格，全身照以脸部 role 铸进卡里、钱照扣；
//   · 存下来的 id 被换掉 = 删掉 / 改掉一格之后，另一格悄悄换成它空出来的内置 id，被删那格的照片出现在它身上（复核第 2 轮）；
//   · 改过去再改回来认不回原 id = 那格的草稿照片（可能是花钱出的 AI 图）从此够不着（复核第 2 轮）；
//   · 同一套里两格拿到同一个 id = 两格显示同一张照片、铸卡时同一张进两次；
//   · 每读一次算出不同的 id = 冷启动一次，草稿照片就对不上格子；
//   · 派生 id 撞上 CardView 的 kind 词 = 人物卡那一格的报错切到场景卡之后画在 body 格上；
//   · 派生 id 复用了本机旧那份的某个 id = 被删掉那格收着的照片挂到另一格上；
//   · 编辑屏开着的时候本机那份被「已装 · 用它」换掉 = 名字、role 一起改了的格子留着原 id，另一套方案里传的全身照以脸部 role 铸卡（复核第 3 轮）；
//   · 调用点传错档（读 / 存编辑屏 / 对齐本机那份）= tsc 看不见，上面几种一样不少（复核第 3 轮，见（f）接线）。
//   这里**直接 import 模块本身**跑（Node 24 只剥类型），规则一条都不在测试里重打。
// ★ 内置表用一份**假的**（同 id、同中文原名，正文换成 P_BODY 这类记号）：验的是算法，不是提示词措辞。
//   真表那几条「不许动」的事实在（e）从源码里核：七个 id 与中文原名逐字不变、各自的 role 不变、每个内置图位的 id 与 tag 键成对、
//   同一个内置 id 在几套内置方案里是同一格（role / 正文 / ref / size / fromCrop 逐项相同）；几个调用点的写法在（f）核。
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先造真违规试红。在拷贝上逐条试过（2026-09-11 复核第 3 轮之后整份重跑），
//   每一条都各自变红（括号里是变红的用例；「9」= 幂等那一节，「序列」= 多次保存的那两段）。改了算法就重跑一遍再改这里：
//   ① B 步不要求 role 相同（12b、12c、20c）；② A 步不要求 role 相同（10b、12c、20c）；③ isValidSlotId 不再拒 kind 词（isValidSlotId、7）；
//   ④ C 步不再避开 reserved（13、13b）；⑤ freshSlotId 不再校验生成器给的值（15）；
//   ⑥ 派生 id 截完不再 trim / 按码点截（坏形状）/ 截到 64 字（6b）；
//   ⑦ 0 步不核 role（16、16b、16c、17、17c、17d、17f~17i、17l、18k、18l、18n、18o、19~19c、20、20b、20d、序列）；
//   ⑧ 不读 before 的 role（17、17i、17l、17m、19、19c、序列）；⑨ 这一次新加的格子不让内置血统（18、18b、18p）；
//   ⑩ 派生 id 不带 role（4、4b、5…）；⑪ A、B 两步对调（11b、11c、13c）；⑫ B 步不认同一位置、改认别处正文相同的格子（11d）；
//   ⑬ A 步不先挑正文相同的（10d、10e、10f、10i）；⑭ A 步比名字两侧都不 trim（10c、10h）；
//   ⑮ 指纹不归一 ref（1c）/ fromCrop（1d）/ 不 trim 正文（1b）；
//   —— 复核第 2 轮补的 ——
//   ⑯ 存下来的新建 id 仍算暂定（18g、18h、18q、9 的 13c / 13d / 18i~18m、序列）；从 prev 认来的新建 id 仍算暂定（9 的 13c / 13d / 18g~18m）；
//   ⑰ 内置血统拿 before 里有格子占着的 id（18l、18m、18n）；只对这一次新加的格子拦（评审建议的那一版，18n）；
//   ⑱ 没有 role 变体（17、17f、17g、19、19c、序列）/ 变体不记原 role（17f、17g、17h、序列）/ 变体拿 before 里别的格子挂着的（17l）/
//      isFreshSlotId 收带 `~` 的（isFreshSlotId、17k、15）；
//   ⑲ 内置血统不看 used（5b、5c、18e、18p）/ 认下内置血统不记进 used（5b、5c、18p）—— 同一套里两格同一个 id；
//   ⑳ A 步空名字当证据（10g）；㉑ A 步「正文相同的先挑」比正文两侧都不 trim（10f、10i）；㉒ 派生 id 不核 role（17m）；
//   ㉓ 0 步不看 used（7、18f）；㉔ 落定不记 used（5、5b、7、8、20e…）；㉕ 内置表的 role 不登记（12c、16、16b、16c、17e）；
//   ㉖ 这一次新加的格子有血统也用自己的 id（18、18b、18p）/ 只按内容让血统（18、18p）；㉗ B 步不比正文（10g、13b）；
//   ㉘ 指纹不含 role（16c）；㉙ 按原名认不核 role（4、16b、16c、18d）。
//   —— 复核第 3 轮补的 ——
//   ㉚ 不核 id 自己写着的 role（20、20b、20c、20d）/ 只核派生的（20b）/ 只核变体的（20、20c、20d）/
//      `lg::名字` 也算写着 role —— 这一条的症状是门禁**卡死**不是变红（C 步接 #n 永远过不了 roleFits），20e 就是为它放的；
//   ㉛ editBefore 不并编辑屏打开时那一版（19、editBefore）/ 打开时那一版排前面（19c、editBefore）；
//   ㉜ 只 trim 回包那一侧、本机那份不 trim：A 步比名字（10h）/ A 步比正文（10i）/ B 步比正文（11e）；
//   ㉝ C 步先按名字、再按内容（1f）。
//   —— 复核第 4 轮补的 ——
//   ㉟ C(ii) 比名字不 trim（1g、1h）；指纹去掉 ref（1i）/ size（1j）/ fromCrop（1k）。（㉞ 那一组「旧版」的变异随 slotHistory 在第 5 轮一起删了）
//   —— 复核第 5 轮补的（拷贝树逐条跑：一棵 src + 门禁的拷贝，每条改一处、跑拷贝里的门禁、再还原）——
//   ㊱ role 变体只给新建 id（17c、17d、17n、17o、16e、16f、U1 / U2 / U4 序列）/ 另存为时内置 id 不给变体（16e、16f）/
//      给了变体不把原 id 放进 held（16f）/ held 不含 before 里变体的原 id（17p）/ C 步不看 held / encodedRole 先读 lg:（17r）；
//   ㊲ S 步整个拿掉（21、21b、21c、21d、21j、9d、（g））/ 不比内容（21e、21g、21h、21m）/ 不核 prev 里的 role（21f、21f2）/ 不核 roleFits（21l、9）/
//      记录里的 id 不进 reserved（21g、21h）/ prev 不登记变体的原 id（21f2）/ 比内容不 trim（21j）/ 不比指纹（21m）；
//   ㊳（f）+（g）：upsertMine 不传 server / 本机没有这一套时 prev 传 undefined / shareScheme 不记 / 推之前就记 / removeScheme 顺手删记录
//      （（f）的写法照过，只有（g）变红）/ SERVER_SLOTS_MAX 改成 0、1 / seedServerSlots 什么都记、什么都不记、盖掉已有的记录 /
//      upsertMine 不记回包 / load 里 persist / 新加一条单行的删除路径 / mine.splice / serverSlots 挪到 `let mine = load()` 下面 /
//      saveScheme 换掉之后才补记 —— 十六条各自变红。应当照过的两条也照过：钉着的两句之间插一行注释、新文件里写 `typeof saveScheme`。
//   另：拷贝上把 B 步的 role 条件单独拿掉（12b、12c、20c、21、21f、9、序列）、freshSlotId 不校验生成器的值（15）也各自变红。
//   —— 复核第 6 轮补的（拷贝树 + NODE_PATH 指到本仓 node_modules，四棵树并行；四十七条，全部符合预期）——
//   ㊴ S 步让位：整条拿掉（21p、21q、21t、（g）5 —— 只留（g）也红）/ 记录里的 id 不在本机那份就一律让（21c、21d、21j…）/ 不看变体的原 id（21t）/
//      在记录里的格子也算（21d）/ 不核 role（21s）/ 不认同一位置那种（21q）；
//   ㊵ V 步：拿掉（21t、21u、21v、（g）6 —— 只留（g）也红）/ 排到 A、B 前面（21w、9b）/ 拿本机那份字面上挂着的原 id（21x）/ 不核原 role（21t）/
//      只按名字、不认同一位置（21v）；
//   ㊶ A、B 收进 align 之后，前几轮的 A、B 变异在新写法上重跑：B 不要 role、A 不要 role、B 先于 A、A 不先挑正文相同的、A 比名字不 trim、
//      空名字当证据、B 不比正文、B 认别处正文相同的 —— 八条各自变红；
//   ㊷ sameContent 不比 role（21n）/ 不比名字（21o）；C 步派生不看 held（17s）；
//   ㊸（f）+（g）：upsertMine 不拿删掉那一刻的本机那份（接线 + 只留（g）也红）/ removeScheme 不记它（只留（g）红）/ upsertMine、saveScheme 先写记录再落方案库
//      （（g）8 配额：只留（g）也红）/ 新加 `mine[i] = …`、`Object.assign(mine…)` / noteServerSlots 少记 ref、fromCrop、两样都少记（（g）1 的 C2）/
//      记录表删最新的、不删、再记一次不挪到最新、存坏了就抛（（g）7）—— 各自变红；
//   ㊹ 该照过的照过：promptSchemes 往 ../types 的 import 里加一个类型名、api/schemes 用 client 里的 apiPatch、JSX 注释 `{/* …saveScheme… *\/}`、
//      行尾 `/* …saveScheme… *\/`、跨行 JSX 注释、整份 CRLF 拷贝、原样拷贝 —— 七条全绿；schemeMarket 新 import "./toast" 变红，报的是「（g）搭不起来」
//      并点名改（g），不是「规则只改 schemeSlotIds.ts」。
//   （e）另在一棵拷贝树上改 promptSchemes / types 试过：specsheet 的 faceCloseup 改成 aux role、fullBody 换正文常量、
//   faceCloseup 换 ref、tag 写成字面量、id 与 BUILTIN_SLOT_ZH 的键配错、改中文原名 —— 六条各自变红；
//   复核第 3 轮补：fullBody 在几套里一起改 role、outfitDetail 改 role —— 各自变红（SHIPPED_ROLE）。
//   （f）拷贝树上：load / apiToScheme 传 before:null、withSlotIds 恒当读、saveScheme 的 before 写成 null / 当成读 / 不并 base /
//   另存为也并 base、upsertMine 不传 prev、编辑屏 base 传 null、自建卡页 keep 用全量 next.slots、drawnSlots 不滤 fromCrop、
//   src 里多一个调用点 —— 十二条各自变红；CRLF / LF 两份原样拷贝照过。
//   复核第 4 轮补（同样在拷贝树上，二十二条各自变红；其中「旧版」那几条随 slotHistory 在第 5 轮删掉，换成上面 ㊳）：upsertMine 不传 prev；
//   removeScheme / saveScheme / upsertMine 换掉之前不记旧版；旧版记成最旧的在前；slotHistory 挪到 `let mine = load()` 下面；多一处 `mine = `；
//   自建卡页 mint 的 tag 改回 slot.tag（连 slotCardTag 的 import 一起删也一样 —— 那样 tsc 也照过）、real 两条回包 / mock 一条回包改回 slot.tag；
//   slotCardTag 改成只读 slot.tag；builtinLineage 的原名读 s.tag；import / 跨行 import / re-export 起别名；当值传出去（赋值、解构改名、
//   命名空间取值）；泛型调用。改过 body()（整行只有 `}` 才算函数收尾）之后，前几轮的九条（load / apiToScheme / withSlotIds / saveScheme 三条 /
//   编辑屏 base / keep 全量 / drawnSlots 不滤）与多一个调用点重跑照样变红；CRLF / LF 两份原样拷贝照过。
//
// 用法：node scripts/check-slot-ids.mjs [--module=<另一份 schemeSlotIds.ts 的路径，造违规试红用>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/schemeSlotIds.ts"));
const S = await import(url.pathToFileURL(modPath).href);
// typescript 只拿来找注释（codeOnly）；与 check-i18n 同一个找法：先从被扫的仓库里找，找不到再从本脚本所在的仓库找
const ts = (() => {
  try {
    return createRequire(path.join(root, "package.json"))("typescript");
  } catch {
    return createRequire(import.meta.url)("typescript");
  }
})();

const problems = [];
const fail = (msg) => problems.push(msg);
const show = (v) => JSON.stringify(v);

/**
 * 源码去掉注释（`//`、`/* … *\/`，JSX 花括号里的 `{/* … *\/}` 也算），换成空格、保留换行 —— 行号与缩进不变（（f）的 body() 按行找函数收尾）。
 * ★★ 为什么不逐行判断（复核第 6 轮）：原先只剥「整行以 // 或 /* 或 * 开头」的行与 ` // ` 之后的半行 —— JSX 注释 `{/* 走 saveScheme *\/}`、
 *   行尾的 `/* 与 saveScheme 同一份 *\/` 被当成代码，报「saveScheme 被当成值用了」；反过来手写一个「遇到 /* 就跳到 *\/」又会被
 *   `accept="image/*"`、`/https?:\/\//` 这类字面量骗，把后面整段代码当注释吞掉。所以先让 TypeScript 解析出字符串 / 模板 / 正则 / JSX 文本
 *   的位置，只在这些字面量**之外**认注释。
 */
function codeOnly(text, rel) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const K = ts.SyntaxKind;
  const LITERAL = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail, K.RegularExpressionLiteral]);
  const spans = [];
  const visit = (node) => {
    if (LITERAL.has(node.kind)) spans.push([node.getStart(sf), node.end]);
    // ★ JsxText 没有前导空白之说，getStart 会把开头的 `//` 当注释跳过去 —— 用 pos
    else if (node.kind === K.JsxText) spans.push([node.pos, node.end]);
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  let s = 0;
  while (at < text.length) {
    while (s < spans.length && spans[s][1] <= at) s++;
    if (s < spans.length && spans[s][0] <= at) {
      out += text.slice(at, spans[s][1]);
      at = spans[s][1];
      continue;
    }
    const two = text.slice(at, at + 2);
    if (two === "//" || two === "/*") {
      const close = two === "//" ? text.indexOf("\n", at) : text.indexOf("*/", at + 2);
      const to = close < 0 ? text.length : two === "//" ? close : close + 2;
      out += text.slice(at, to).replace(/[^\r\n]/g, " ");
      at = to;
      continue;
    }
    out += text[at];
    at++;
  }
  return out;
}

// ── (a) 形状：零运行时依赖（Node 能直接 import 它的前提）──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`schemeSlotIds.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`schemeSlotIds.ts:${i + 1}  不许引 @lingui：图位 id 是身份键，不是界面文案`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`schemeSlotIds.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型，跑不了它们）`);
});

// ── (b) isValidSlotId / isFreshSlotId ──
for (const [x, want] of [
  ["fullBody", true],
  ["lg:A", true],
  ["slot_abc_123", true],
  ["slot_abc~primary~face", true],
  ["x".repeat(80), true],
  ["x".repeat(81), false],
  ["", false],
  [" a", false],
  ["a ", false],
  ["face", false],
  ["body", false],
  ["detail", false],
  [42, false],
  [null, false],
  [undefined, false],
]) {
  if (S.isValidSlotId(x) !== want) fail(`isValidSlotId(${show(x)})：want ${want}`);
}
for (const [x, want] of [
  ["slot_abc_123", true],
  ["fullBody", false],
  ["lg:primary:A", false],
  [" slot_a", false],
  ["slot_a~primary~face", false], // role 变体不算新建 id（它不许是暂定的）
  [7, false],
]) {
  if (S.isFreshSlotId(x) !== want) fail(`isFreshSlotId(${show(x)})：want ${want}`);
}

// ── (c) normalizeSlotIds ──
const B = [
  { id: "fullBody", zh: "全身立绘", role: "primary", prompt: "P_BODY" },
  { id: "faceCloseup", zh: "面部特写", role: "face", prompt: "P_FACE", ref: "face" },
  { id: "sourceCrop", zh: "原片截图", role: "display", prompt: "", fromCrop: true },
];
/** 多一格与 fullBody 同 role 的假内置：只有它在，才分得出 C 步「先按内容、再按名字」的先后（1f） */
const B2 = [...B, { id: "mannequinBody", zh: "白模全身", role: "primary", prompt: "P_MANNEQUIN" }];
const sl = (tag, role, prompt = "", x = {}) => ({ tag, role, prompt, ...x });
const idd = (id, slot) => ({ id, ...slot });
/** 存编辑屏（saveScheme）：before = 本机存着的那一版，新建 / 另存为时 null */
const ed = (before) => ({ edit: { before } });
/** saveScheme 真正交出去的 before：editBefore(本机此刻存着的, 编辑屏打开时那一版)。造违规用的拷贝缺这个导出就记一条失败 */
const eb = (stored, base) => {
  if (typeof S.editBefore !== "function") {
    fail("schemeSlotIds 缺 editBefore 导出（saveScheme 靠它把编辑屏打开时那一版并进 before）");
    return stored;
  }
  return S.editBefore(stored, base);
};
/** opts：null = 读存储 / 读服务端；{ prev, server } = upsertMine 对齐本机那份与记下的服务端那一版；ed(before) = saveScheme 存编辑屏的改动 */
const run = (slots, opts) => {
  try {
    return S.normalizeSlotIds(slots, { builtins: B, ...(opts ?? {}) });
  } catch (e) {
    fail(`normalizeSlotIds 抛了（它在 promptSchemes.load 里跑，抛出去 = 用户整个方案库被覆盖成空）：${e?.message ?? e}\n      输入 ${show(slots)}`);
    return { slots: slots.map((s) => ({ ...s, id: undefined })), changed: false };
  }
};
const idsOf = (r) => r.slots.map((s) => s.id);
const FACE = { ref: "face" };

const OLD_CLEAN = [sl("全身立绘", "primary", "P_BODY"), sl("面部特写", "face", "P_FACE", FACE), sl("原片截图", "display", "", { fromCrop: true })];
const EXPLICIT = [
  idd("keep_me", sl("K", "primary", "k")),
  idd("body", sl("B1", "aux", "1")),
  idd("", sl("B2", "aux", "2")),
  idd(" x ", sl("B3", "aux", "3")),
  idd(42, sl("B4", "aux", "4")),
  idd("keep_me", sl("B5", "aux", "5")),
];
/** 另存 clean 的副本：全身那格改名「正面」（id 还是 fullBody），删了原片截图，新加一格「全身立绘」（复核第 2 轮 P1 的那一份） */
const COPY_STORED = [idd("fullBody", sl("正面", "primary", "x")), idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE)), idd("slot_x", sl("全身立绘", "primary", "mine"))];
const LONG_FRESH = `slot_${"x".repeat(70)}`;
/** 从空白建、发布过的一套（复核第 4 轮 B / C 的那一份）：本机存着的与服务端那份（strip 掉 id）*/
const X0 = [idd("slot_x", sl("正面", "primary", "p1")), idd("slot_f", sl("脸", "face", "f1"))];
const SERVER0 = [sl("正面", "primary", "p1"), sl("脸", "face", "f1")];
const cases = [
  // [名字, 输入, opts, 预期 id]
  // — 内置血统（按内容 / 按原名认回来）—
  ["1 老 clean 三格按内容认回内置", OLD_CLEAN, null, ["fullBody", "faceCloseup", "sourceCrop"]],
  ["1b 英文名、正文带首尾空白 → 按内容认（指纹里正文要 trim；名字不是原名，名字那一步救不了）", [sl("Full body", "primary", " P_BODY ")], null, ["fullBody"]],
  ["1c 英文名、显式 ref:'body' → 与缺省 ref 同一个指纹（编辑屏点过「参考主裁剪」就会写它）", [sl("Full body", "primary", "P_BODY", { ref: "body" })], null, ["fullBody"]],
  ["1d 英文名、显式 fromCrop:false → 与缺省同一个指纹（编辑屏的勾选框会写 false）", [sl("Full body", "primary", "P_BODY", { fromCrop: false })], null, ["fullBody"]],
  ["1e 英文名、size 是空串 → 与缺省同一个指纹", [sl("Full body", "primary", "P_BODY", { size: "" })], null, ["fullBody"]],
  ["2 英文名、内置正文 → 按内容认", [sl("Full body", "primary", "P_BODY")], null, ["fullBody"]],
  ["3 改过措辞之前的副本 → 按名字 + role 认", [sl("全身立绘", "primary", "old words")], null, ["fullBody"]],
  // — 派生 id（带 role）—
  ["4 名字对、role 不对 → 不认内置；派生 id 带 role", [sl("全身立绘", "face", "x")], null, ["lg:face:全身立绘"]],
  ["4b 同名不同 role 的两格 → 派生 id 不同（不同 role 的格子不共用草稿照片）", [sl("特写", "face", "a"), sl("特写", "aux", "b")], null, ["lg:face:特写", "lg:aux:特写"]],
  ["4c role 是坏值 → role 段写空，id 仍合法", [{ tag: "A", role: 7, prompt: "p" }], null, ["lg::A"]],
  ["5 重名同 role → 接 #2", [sl("A", "primary"), sl("A", "primary")], null, ["lg:primary:A", "lg:primary:A#2"]],
  ["5b 两格都叫「全身立绘」→ 内置 id 只给第一格，第二格派生（一套里一个内置 id 只发一次）", [sl("全身立绘", "primary", "a"), sl("全身立绘", "primary", "b")], null, ["fullBody", "lg:primary:全身立绘"]],
  ["5c 两格正文都是内置全身那句 → 内置 id 只给第一格", [sl("Full body", "primary", "P_BODY"), sl("Full body (2)", "primary", "P_BODY")], null, ["fullBody", "lg:primary:Full body (2)"]],
  ["6 空名字 → 按第几格", [sl("  ", "primary", "p")], null, ["lg:primary:#1"]],
  ["6b 名字超过 48 字 → 派生 id 里只留前 48 字（SLOT_ID_MAX 是按这个量的）", [sl("a".repeat(60), "primary", "p")], null, [`lg:primary:${"a".repeat(48)}`]],
  ["7 合法的自带 id 留着；kind 词 / 空串 / 首尾空白 / 非字符串 / 重复的重算", EXPLICIT, null, ["keep_me", "lg:aux:B1", "lg:aux:B2", "lg:aux:B3", "lg:aux:B4", "lg:aux:B5"]],
  ["8 显式的赢过派生的", [idd("lg:primary:A", sl("B", "primary", "b")), sl("A", "primary", "a")], null, ["lg:primary:A", "lg:primary:A#2"]],
  // — 有 prev（upsertMine：服务端回包对齐本机那份）—
  [
    "10 有 prev：名字 + role 认（顺序换了也认得出）",
    [sl("Y", "primary", "y2"), sl("Z", "face", "z2")],
    { prev: [idd("slot_q", sl("Z", "face", "z")), idd("slot_y", sl("Y", "primary", "y"))] },
    ["slot_y", "slot_q"],
  ],
  ["10b 名字相同、role 不同 → 不认", [sl("Z", "primary", "b")], { prev: [idd("slot_q", sl("Z", "face", "a"))] }, ["lg:primary:Z"]],
  ["10c 名字比较要 trim", [sl(" Z ", "face", "b")], { prev: [idd("slot_q", sl("Z", "face", "a"))] }, ["slot_q"]],
  [
    "10d 重名同 role 的两格换了顺序 → 正文相同的先认，不串格",
    [sl("A", "primary", "p2"), sl("A", "primary", "p1")],
    { prev: [idd("slot_1", sl("A", "primary", "p1")), idd("slot_2", sl("A", "primary", "p2"))] },
    ["slot_2", "slot_1"],
  ],
  [
    "10e 重名同 role：前一格正文改了、后一格没改 → 没改的那格先认走自己的 id",
    [sl("A", "primary", "p3"), sl("A", "primary", "p1")],
    { prev: [idd("slot_1", sl("A", "primary", "p1")), idd("slot_2", sl("A", "primary", "p2"))] },
    ["slot_2", "slot_1"],
  ],
  [
    "10f 重名同 role：「正文相同的先挑」那一遍比正文要 trim",
    [sl("A", "primary", "p2 "), sl("A", "primary", "p9")],
    { prev: [idd("slot_1", sl("A", "primary", "p1")), idd("slot_2", sl("A", "primary", "p2"))] },
    ["slot_2", "slot_1"],
  ],
  ["10g 空名字不是证据：prev 里的空名字格子不按名字认", [sl("  ", "primary", "new")], { prev: [idd("slot_q", sl("", "primary", "old"))] }, ["lg:primary:#1"]],
  ["11 有 prev：同位置 + role + 正文（trim）认（改过名也认得出）", [sl("Old", "primary", "p1 ")], { prev: [idd("slot_a", sl("Renamed", "primary", "p1"))] }, ["slot_a"]],
  [
    "11b A 先于 B：两格名字互换、正文都是空的 → 跟着名字走，不按位置",
    [sl("B", "display", ""), sl("A", "display", "")],
    { prev: [idd("slot_a", sl("A", "display", "")), idd("slot_b", sl("B", "display", ""))] },
    ["slot_b", "slot_a"],
  ],
  [
    "11c A 先于 B：名字指向另一格、同位置正文却相同 → 跟着名字走",
    [sl("B", "aux", "p1"), sl("A", "aux", "p2")],
    { prev: [idd("slot_a", sl("A", "aux", "p1")), idd("slot_b", sl("B", "aux", "p2"))] },
    ["slot_b", "slot_a"],
  ],
  [
    "11d B 只认同一位置那格，不认别处正文相同的格子",
    [sl("Q", "primary", "x"), sl("R", "display", "")],
    { prev: [idd("slot_a", sl("X", "display", "")), idd("slot_b", sl("Y", "display", ""))] },
    ["lg:primary:Q", "slot_b"],
  ],
  [
    "12 设计 3 阻断项：名字、正文都不对的格子绝不按位置认",
    [sl("正面", "primary", "pp"), sl("脸", "face", "ff")],
    { prev: [idd("slot_q", sl("头部", "face", "ff2")), idd("slot_y", sl("身体", "primary", "pp2"))] },
    ["lg:primary:正面", "lg:face:脸"],
  ],
  ["12b 同位置同正文、role 不同 → 不认（脸部照片不许挂到全身格）", [sl("身体", "primary", "same")], { prev: [idd("slot_f", sl("脸", "face", "same"))] }, ["lg:primary:身体"]],
  ["12c prev 里的内置 id 挂在 role 不对的格子上（存坏的）→ 不认", [sl("全身立绘", "face", "a")], { prev: [idd("fullBody", sl("全身立绘", "face", "a"))] }, ["lg:face:全身立绘"]],
  ["13 派生 id 不复用本机旧那份的任何 id", [sl("A", "face", "q")], { prev: [idd("lg:face:A", sl("Z", "primary", "p"))] }, ["lg:face:A#2"]],
  ["13b 内置血统 id 被本机旧那份占着 → 也不复用", [sl("全身立绘", "primary", "P_BODY")], { prev: [idd("fullBody", sl("X", "primary", "x"))] }, ["lg:primary:全身立绘"]],
  [
    "13c 有 prev：从本机那份认来的新建 id 就定了，不再让内置血统（否则某一格被删之后，别的格子会悄悄换成它空出来的内置 id）",
    [sl("Y", "primary", "P_BODY")],
    { prev: [idd("fullBody", sl("全身立绘", "primary", "P_BODY")), idd("slot_x", sl("Y", "primary", "p"))] },
    ["slot_x"],
  ],
  [
    "13d 复核第 2 轮 P4：本机改名 + 加了一格「全身立绘」之后「已装 · 用它」→ 那一格留着自己的新建 id，不换成 fullBody",
    [idd("fullBody", sl("全身立绘", "primary", "P_BODY")), idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE))],
    { prev: COPY_STORED },
    ["slot_x", "faceCloseup"],
  ],
  ["14 有 prev：进来的自带 id 一律不看", [idd("slot_y", sl("Q", "face", "z"))], { prev: [idd("slot_y", sl("Y", "primary", "y"))] }, ["lg:face:Q"]],
  // — role 是身份的一部分（2026-09-11 复核：另存内置方案的副本改了 role，id 还是内置 id）—
  ["16 内置 id 挂在 role 不同的格子上（另存副本把全身那格改成脸部）→ 不认，换 id", [idd("fullBody", sl("脸部近照", "face", "x"))], null, ["lg:face:脸部近照"]],
  ["16b 同上、名字没改 → 同样不认", [idd("fullBody", sl("全身立绘", "face", "x"))], null, ["lg:face:全身立绘"]],
  [
    "16c 另存副本把两格的 role 对调 → 各自都不认（也不许靠名字认回对方的内置 id）",
    [idd("fullBody", sl("全身立绘", "face", "P_BODY")), idd("faceCloseup", sl("面部特写", "primary", "P_FACE", FACE))],
    null,
    ["lg:face:全身立绘", "lg:primary:面部特写"],
  ],
  ["16d 内置 id、role 没变、改了名改了正文 → 照认（改名不换身份）", [idd("fullBody", sl("Full", "primary", "x"))], null, ["fullBody"]],
  ["17 存编辑屏：存过的新建 id 那一格 role 变了 → 换成 role 变体（记下原 role）", [idd("slot_x", sl("A", "face", "p"))], ed([idd("slot_x", sl("A", "primary", "p"))]), ["slot_x~primary~face"]],
  ["17b 存编辑屏：role 点错又点回原样（与存着的那一版相同）→ 照认", [idd("slot_x", sl("A2", "primary", "p2"))], ed([idd("slot_x", sl("A", "primary", "p"))]), ["slot_x"]],
  ["17c 存编辑屏：派生 id 的格子 role 改了 → 派生 id 的 role 变体（记下原 id，复核第 5 轮）", [idd("lg:primary:A", sl("A", "face", "p"))], ed([idd("lg:primary:A", sl("A", "primary", "p"))]), ["lg:primary:A~primary~face"]],
  [
    "17d 存编辑屏：同名两格 role 对调 → 各自换成 role 变体（照片都藏起来，不按「名字 + role」跳到另一格上；复核第 5 轮之前是跟着名字走）",
    [idd("lg:face:A", sl("A", "primary", "p")), idd("lg:primary:A", sl("A", "face", "q"))],
    ed([idd("lg:face:A", sl("A", "face", "q")), idd("lg:primary:A", sl("A", "primary", "p"))]),
    ["lg:face:A~face~primary", "lg:primary:A~primary~face"],
  ],
  ["17e 存编辑屏：before 里存坏的 role 盖不掉内置表", [idd("fullBody", sl("全身立绘", "primary", "P_BODY"))], ed([idd("fullBody", sl("全身立绘", "face", "P_BODY"))]), ["fullBody"]],
  // — role 变体（复核第 2 轮：从空白建的格子分两次保存改过去再改回来，照片再也认不回来）—
  ["17f 存编辑屏：role 变体改回原 role → 回到原来那个新建 id", [idd("slot_x~primary~face", sl("A", "primary", "p"))], ed([idd("slot_x~primary~face", sl("A", "face", "p"))]), ["slot_x"]],
  ["17g 存编辑屏：role 变体再换第三种 role → 仍按原 role 记", [idd("slot_x~primary~face", sl("A", "aux", "p"))], ed([idd("slot_x~primary~face", sl("A", "face", "p"))]), ["slot_x~primary~aux"]],
  [
    "17h 存编辑屏：改回原 role 时原 id 被这一套另一格占着 → 不抢，派生",
    [idd("slot_x", sl("B", "primary", "b")), idd("slot_x~primary~face", sl("A", "primary", "a"))],
    ed([idd("slot_x", sl("B", "primary", "b")), idd("slot_x~primary~face", sl("A", "face", "a"))]),
    ["slot_x", "lg:primary:A"],
  ],
  ["17i 存编辑屏：原 id 太长、拼出来的变体超过上限 → 不合法，派生", [idd(LONG_FRESH, sl("A", "face", "p"))], ed([idd(LONG_FRESH, sl("A", "primary", "p"))]), ["lg:face:A"]],
  ["17j 读存储：role 变体原样读回来", [idd("slot_x~primary~face", sl("A", "face", "p"))], null, ["slot_x~primary~face"]],
  ["17k 存编辑屏：role 变体不算这一次新加的，名字对得上内置也不让", [idd("slot_x~face~primary", sl("全身立绘", "primary", "P_BODY"))], ed(null), ["slot_x~face~primary"]],
  [
    "17l 存编辑屏：算出来的变体被本机那一版另一格挂着 → 不给（那一格的照片挂在上面）",
    [idd("slot_x", sl("A", "face", "p"))],
    ed([idd("slot_x", sl("A", "primary", "p")), idd("slot_x~primary~face", sl("B", "face", "q"))]),
    ["lg:face:A"],
  ],
  ["17m 存编辑屏：派生出来的 id 在存着的那一版里挂在另一种 role 上（存坏的）→ 接 #2，不跟到另一种 role 上", [sl("A", "face", "p")], ed([idd("lg:face:A", sl("Z", "primary", "z"))]), ["lg:face:A#2"]],
  // — 派生 id / 内置 id 的 role 变体（复核第 5 轮：改名 + 改 role → 改回 role → 改回名字，派生 id 按当时的名字重算，照片从此够不着）—
  ["17n 存编辑屏：派生 id 的变体改回原 role → 回到原派生 id（名字这中间改过也一样）", [idd("lg:primary:正面~primary~aux", sl("侧面", "primary", "p"))], ed([idd("lg:primary:正面~primary~aux", sl("侧面", "aux", "p"))]), ["lg:primary:正面"]],
  ["17o 存编辑屏：内置 id 的变体改回原 role → 回到 fullBody（名字、正文这中间改过也一样）", [idd("fullBody~primary~face", sl("正面", "primary", "x"))], ed([idd("fullBody~primary~face", sl("正面", "face", "x"))]), ["fullBody"]],
  [
    "17p 存编辑屏：存着的那一版里挂着 fullBody~primary~face，这一次新加一格「全身立绘」→ 不拿 fullBody（原 id 收着的是全身照，held 含变体的原 id）",
    [idd("fullBody~primary~face", sl("正面", "face", "x")), idd("slot_n", sl("全身立绘", "primary", "P_BODY"))],
    ed([idd("fullBody~primary~face", sl("正面", "face", "x"))]),
    ["fullBody~primary~face", "slot_n"],
  ],
  ["17q 读：名字里带 `~` 的派生 id 被读成变体、现 role 对不上 → 接 #2，不死循环", [sl("a~primary~face", "primary", "p")], null, ["lg:primary:a~primary~face#2"]],
  ["17r 读存储：派生 id 的变体原样读回来", [idd("lg:primary:正面~primary~aux", sl("侧面", "aux", "p"))], null, ["lg:primary:正面~primary~aux"]],
  ["16e 存编辑屏（另存为，before 是 null）：内置 id 改了 role → 内置 id 的 role 变体", [idd("fullBody", sl("全身立绘", "face", "x"))], ed(null), ["fullBody~primary~face"]],
  [
    "16f 存编辑屏（另存为）：内置 id 改了 role、同时新加一格「全身立绘」→ 新格子不拿 fullBody（这一次换成变体的原 id 也进 held）",
    [idd("fullBody", sl("正面", "face", "x")), idd("slot_n", sl("全身立绘", "primary", "y"))],
    ed(null),
    ["fullBody~primary~face", "slot_n"],
  ],
  // — 新建 id（freshSlotId）头一回保存时先让内置血统（2026-09-11 复核：从空白建的「全身立绘」拿不到内置那格的草稿照片）—
  [
    "18 存编辑屏：这一次新加的格子、名字 + role 对得上内置 → 让给内置 id（与存量老方案、别人装到手的同一套一致）",
    [idd("slot_a", sl("全身立绘", "primary", "my words")), idd("slot_b", sl("面部特写", "face", "mine"))],
    ed(null),
    ["fullBody", "faceCloseup"],
  ],
  ["18b 存编辑屏：这一次新加的、英文名但内容对得上内置 → 让给内置 id", [idd("slot_a", sl("Full body", "primary", "P_BODY"))], ed(null), ["fullBody"]],
  ["18c 存编辑屏：这一次新加的、对不上内置 → 用它自己", [idd("slot_a", sl("正面", "primary", "a"))], ed(null), ["slot_a"]],
  ["18d 存编辑屏：这一次新加的、名字对得上但 role 不对 → 不让", [idd("slot_a", sl("全身立绘", "face", "a"))], ed(null), ["slot_a"]],
  [
    "18e 存编辑屏：内置 id 已被这一套另一格显式占着 → 不抢",
    [idd("fullBody", sl("X", "primary", "x")), idd("slot_a", sl("全身立绘", "primary", "y"))],
    ed(null),
    ["fullBody", "slot_a"],
  ],
  ["18f 新建 id 重复 → 后一格派生", [idd("slot_a", sl("P", "primary", "a")), idd("slot_a", sl("Q", "primary", "b"))], ed(null), ["slot_a", "lg:primary:Q"]],
  ["18g 存编辑屏：存过的新建 id 改名成内置原名 → 不换（存下来的 id 就定了，照片跟着格子走；收窄 ④：不再与内置方案共用草稿照片，与改动前不同）",[idd("slot_a", sl("全身立绘", "primary", "p"))], ed([idd("slot_a", sl("正面", "primary", "p"))]), ["slot_a"]],
  ["18h 读存储：读回来的新建 id 就是定下来的，名字对得上内置也不让（冷启动一次 id 就变 = 照片对不上格子）", [idd("slot_a", sl("全身立绘", "primary", "P_BODY"))], null, ["slot_a"]],
  ["18i 复核第 2 轮 P1-A：副本里删掉占着 fullBody 的「正面」再保存 → 「全身立绘」留着自己的新建 id", COPY_STORED.slice(1), ed(COPY_STORED), ["faceCloseup", "slot_x"]],
  [
    "18j 复核第 2 轮 P1-B：同上、那一格正文是内置全身那句（按内容对得上）→ 同样不换",
    [idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE)), idd("slot_x", sl("全身", "primary", "P_BODY"))],
    ed([idd("fullBody", sl("正面半身", "primary", "half")), idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE)), idd("slot_x", sl("全身", "primary", "P_BODY"))]),
    ["faceCloseup", "slot_x"],
  ],
  [
    "18k 复核第 2 轮：不删、只把「正面」改成细节 role → 它换成 role 变体，「全身立绘」照样不换",
    [idd("fullBody", sl("正面", "aux", "x")), COPY_STORED[1], COPY_STORED[2]],
    ed(COPY_STORED),
    ["fullBody~primary~aux", "faceCloseup", "slot_x"],
  ],
  [
    "18l 复核第 2 轮 M2：全身那格改成脸部 + 这一次新加一格正文是内置全身那句 → 新格子不拿存着的那一版里 fullBody",
    [idd("fullBody", sl("全身立绘", "face", "P_BODY")), idd("slot_n", sl("侧脸", "primary", "P_BODY"))],
    ed([idd("fullBody", sl("全身立绘", "primary", "P_BODY"))]),
    ["fullBody~primary~face", "slot_n"],
  ],
  ["18m 存编辑屏：删掉「全身立绘」再新加一格同名的 → 新格子不接旧格子的内置 id", [idd("slot_n", sl("全身立绘", "primary", "y"))], ed([idd("fullBody", sl("全身立绘", "primary", "x"))]), ["slot_n"]],
  [
    "18n 存编辑屏：被删那格占着 fullBody，另一格（faceCloseup）改成「全身立绘」+ 全身 role → 它换成自己的 role 变体，也不拿 fullBody",
    [idd("faceCloseup", sl("全身立绘", "primary", "P_FACE"))],
    ed([idd("fullBody", sl("侧脸", "primary", "P_BODY")), idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE))]),
    ["faceCloseup~face~primary"],
  ],
  ["18o 存编辑屏：内置副本那格改成脸部（存成 fullBody~primary~face）再改回全身 role → 回到 fullBody", [idd("fullBody~primary~face", sl("全身立绘", "primary", "P_BODY"))], ed([idd("fullBody~primary~face", sl("全身立绘", "face", "P_BODY"))]), ["fullBody"]],
  ["18s 存编辑屏：老方案里挂在脸部的「全身立绘」（派生 id）改成全身 role → 派生 id 的变体，不换成 fullBody（存下来的 id 就定了，同收窄 ④）", [idd("lg:face:全身立绘", sl("全身立绘", "primary", "P_BODY"))], ed([idd("lg:face:全身立绘", sl("全身立绘", "face", "P_BODY"))]), ["lg:face:全身立绘~face~primary"]],
  [
    "18p 存编辑屏：这一次新加两格都叫「全身立绘」→ 内置 id 只给第一格",
    [idd("slot_a", sl("全身立绘", "primary", "x")), idd("slot_b", sl("全身立绘", "primary", "y"))],
    ed(null),
    ["fullBody", "slot_b"],
  ],
  ["18q 读存储：两格新建 id 都叫「全身立绘」→ 原样读回来", [idd("slot_a", sl("全身立绘", "primary", "x")), idd("slot_b", sl("全身立绘", "primary", "y"))], null, ["slot_a", "slot_b"]],
  [
    "18r 收窄 ④：老方案的派生 id 那两格在后来某次保存里改名成内置原名 → 不换成内置 id（存下来的 id 就定了；代价是不再与内置方案共用草稿照片）",
    [idd("lg:primary:正面", sl("全身立绘", "primary", "x")), idd("lg:face:脸部", sl("面部特写", "face", "y", FACE))],
    ed([idd("lg:primary:正面", sl("正面", "primary", "x")), idd("lg:face:脸部", sl("脸部", "face", "y", FACE))]),
    ["lg:primary:正面", "lg:face:脸部"],
  ],
  // — 编辑屏开着的时候本机那份被换掉（复核第 3 轮：「已装 · 用它」回包到了、编辑屏还开着）—
  [
    "19 存编辑屏：打开时那一版里 slot_x 是全身，此刻存着的那一版（重装换掉了）里没有它 → 名字、role 一起改成脸部 → role 变体，不留原 id",
    [idd("slot_x", sl("脸", "face", "q"))],
    ed(eb([idd("lg:primary:正面", sl("正面", "primary", "p"))], [idd("slot_x", sl("侧面", "primary", "q"))])),
    ["slot_x~primary~face"],
  ],
  [
    "19b 同上、那格是派生 id（重装之后此刻存着的是 lg:primary:A#2，打开时那一版里是 lg:primary:A）→ 派生 id 的 role 变体，不留写着 primary 的 id",
    [idd("lg:primary:A", sl("脸", "face", "q"))],
    ed(eb([idd("lg:primary:A#2", sl("A", "primary", "p"))], [idd("lg:primary:A", sl("A2", "primary", "q"))])),
    ["lg:primary:A~primary~face"],
  ],
  [
    "19c 两份对同一个 id 说法不一样 → 听此刻存着的（role 核不过就换 id，照片收起来）",
    [idd("slot_x", sl("A", "aux", "p"))],
    ed(eb([idd("slot_x", sl("A", "primary", "p"))], [idd("slot_x", sl("A", "aux", "p"))])),
    ["slot_x~primary~aux"],
  ],
  // — id 自己写着的 role（复核第 3 轮：写着 primary 的 id 挂在脸部那格上，冷启动也原样放行）—
  ["20 读存储：派生 id 写着的 role 与格子的 role 不同（存坏的）→ 按现在的 role 重算", [idd("lg:primary:A", sl("脸", "face", "q"))], null, ["lg:face:脸"]],
  ["20b 读存储：role 变体写着的现 role 与格子的 role 不同 → 重算", [idd("slot_x~primary~face", sl("A", "aux", "p"))], null, ["lg:aux:A"]],
  ["20c 有 prev：本机那份里派生 id 写着的 role 与它那格对不上（存坏的）→ 不认", [sl("脸", "face", "q")], { prev: [idd("lg:primary:A", sl("脸", "face", "q"))] }, ["lg:face:脸"]],
  ["20d 存编辑屏：派生 id 写着全身、before 里没有它（只有此刻存着的那一版）→ 改成脸部照样换 id", [idd("lg:primary:A", sl("脸", "face", "q"))], ed([idd("lg:primary:A#2", sl("A", "primary", "p"))]), ["lg:face:脸"]],
  ["20e role 是坏值：派生出来的 `lg::名字` 不算写着 role，接 #2 不死循环", [{ tag: "A", role: 7, prompt: "p" }, { tag: "A", role: 7, prompt: "q" }], null, ["lg::A", "lg::A#2"]],
  // — 本机那份的首尾空白（复核第 3 轮：编辑屏把输入原样存进本机，服务端回来的是 trim 过的；原先的 trim 用例只把空白放在回包那一侧）—
  ["10h 有 prev：本机那份的名字带尾空白、回包 trim 过 → 照认", [sl("Z", "face", "b")], { prev: [idd("slot_q", sl("Z ", "face", "a"))] }, ["slot_q"]],
  [
    "10i 重名同 role：本机那份的正文带尾空白 → 「正文相同的先挑」照样认得出、不串格",
    [sl("A", "primary", "p2"), sl("A", "primary", "p1")],
    { prev: [idd("slot_1", sl("A", "primary", "p1 ")), idd("slot_2", sl("A", "primary", "p2\n"))] },
    ["slot_2", "slot_1"],
  ],
  ["11e 同位置 + role + 正文：本机那份的正文带尾空白 → 照认", [sl("Old", "primary", "p1")], { prev: [idd("slot_a", sl("Renamed", "primary", "p1 "))] }, ["slot_a"]],
  // — 内置血统先按内容、再按名字（假内置表多一格同 role 的，才分得出先后）—
  ["1f 名字是一个内置图位的原名、内容是另一个的 → 按内容认", [sl("白模全身", "primary", "P_BODY")], { builtins: B2 }, ["fullBody"]],
  // — C 步的名字 trim 与指纹里的 ref / size / fromCrop（复核第 4 轮：这几处改坏了，原先的用例照样全过）—
  [
    "1g 存编辑屏：这一次新加的格子叫「全身立绘 」（编辑屏原样存输入）→ C(ii) 按 trim 过的名字认回 fullBody（文件头「放宽」那条）",
    [idd("slot_a", sl("全身立绘 ", "primary", "mine"))],
    ed(null),
    ["fullBody"],
  ],
  ["1h 读存储：老图位名字带尾空白、正文改过 → 按 trim 过的名字 + role 认回", [sl("面部特写 ", "face", "old", FACE)], null, ["faceCloseup"]],
  ["1i 指纹里有 ref：正文与内置脸部那格相同、ref 缺省（= body）→ 不按内容认", [sl("正脸", "face", "P_FACE")], null, ["lg:face:正脸"]],
  ["1j 指纹里有 size：显式写了别的尺寸 → 不按内容认", [sl("Full body", "primary", "P_BODY", { size: "2048x2048" })], null, ["lg:primary:Full body"]],
  ["1k 指纹里有 fromCrop：只展示、空正文、但不是原片裁剪 → 不认 sourceCrop", [sl("Crop", "display", "")], null, ["lg:display:Crop"]],
  // — 服务端那一版（复核第 4、5 轮：删掉再装回来、本机改过再「已装 · 用它」—— 中间隔一次重启也要认得回；promptSchemes.noteServerSlots 记的就是它）—
  ["21 有 prev、记下的服务端那一版与回包逐格内容相同：本机那份改过 role（C1）→ 按位置接回记下的 id", SERVER0, { prev: [idd("slot_x~primary~aux", sl("正面", "aux", "p1")), X0[1]], server: X0 }, ["slot_x", "slot_f"]],
  ["21b 同上、本机那份名字和正文一起改了（C2）→ 按位置接回记下的 id", SERVER0, { prev: [idd("slot_x", sl("正脸", "primary", "p9")), X0[1]], server: X0 }, ["slot_x", "slot_f"]],
  ["21c 删掉再装回来：本机没有这一套（prev 是空数组）、记录还在 → 每一格认回原 id（B）", SERVER0, { prev: [], server: X0 }, ["slot_x", "slot_f"]],
  [
    "21d S 先于 A：本机那份按名字对得上另一个 id，记录按位置对得上 → 听记录（记录就是服务端那一份图位本身）",
    [sl("正面", "primary", "p1"), sl("侧面", "primary", "q")],
    { prev: [idd("slot_b", sl("正面", "primary", "p1"))], server: [idd("slot_a", sl("正面", "primary", "p1")), idd("slot_b", sl("侧面", "primary", "q"))] },
    ["slot_a", "slot_b"],
  ],
  [
    "21e 记录与回包有一格内容不同（别处又推过）→ 整份不认，退回 A、B",
    [sl("正面", "primary", "p1"), sl("脸", "face", "f2")],
    { prev: [idd("slot_x", sl("正脸", "primary", "p9")), X0[1]], server: X0 },
    ["lg:primary:正面", "slot_f"],
  ],
  ["21f 记录里的 id 在本机那份里挂在另一种 role 上 → 不认", [sl("A", "primary", "p")], { prev: [idd("slot_q", sl("Z", "face", "z"))], server: [idd("slot_q", sl("A", "primary", "p"))] }, ["lg:primary:A"]],
  [
    "21f2 记录里的 id 在本机那份里是它的 role 变体、原 role 不同 → 不认（原 id 收着的是原 role 下传的照片）",
    [sl("A", "face", "p")],
    { prev: [idd("slot_q~primary~aux", sl("Z", "aux", "z"))], server: [idd("slot_q", sl("A", "face", "p"))] },
    ["lg:face:A"],
  ],
  ["21g 派生 id 不复用记录里的 id", [sl("A", "face", "q")], { prev: [idd("slot_o", sl("O", "aux", "o"))], server: [idd("lg:face:A", sl("Z", "primary", "p"))] }, ["lg:face:A#2"]],
  ["21h 内置血统不拿记录里挂着的 id（那一格收着的照片不许挂到别的格子上）", [sl("全身立绘", "primary", "P_BODY")], { prev: [], server: [idd("fullBody", sl("正面", "primary", "x"))] }, ["lg:primary:全身立绘"]],
  ["21i 没有 prev 时不看记录（读：自带的 id 照认）", [idd("lg:primary:A", sl("A", "primary", "p"))], { server: [idd("slot_a", sl("A", "primary", "p"))] }, ["lg:primary:A"]],
  [
    "21j 记录按内容比要 trim / 归一：本机记下的名字、正文带尾空白，ref 显式写 body，fromCrop 写 false",
    [sl("正面", "primary", "p1")],
    { prev: [], server: [idd("slot_x", sl("正面 ", "primary", "p1\n", { ref: "body", fromCrop: false }))] },
    ["slot_x"],
  ],
  ["21k 记录格数不同 → 整份不认", [sl("正面", "primary", "p1")], { prev: [], server: X0 }, ["lg:primary:正面"]],
  ["21l 记录里的 id 写着的 role 与格子对不上（存坏的）→ 不认", [sl("正面", "primary", "p1")], { prev: [], server: [idd("lg:face:正面", sl("正面", "primary", "p1"))] }, ["lg:primary:正面"]],
  ["21m 记录里有一格的 ref 不同 → 整份不认（指纹里有 ref）", [sl("正面", "face", "p1", FACE)], { prev: [], server: [idd("slot_x", sl("正面", "face", "p1"))] }, ["lg:face:正面"]],
  // — 复核第 6 轮：记录只差 role / 名字、S 步让位、V 步（按原 role 认回换过 role 的格子）、held 也管派生 id —
  ["21n 记录与回包只差 role → 整份不认（否则一条过期的记录把收着全身照的 id 给了细节格）", [sl("正面", "aux", "p1")], { prev: [], server: [idd("slot_x", sl("正面", "primary", "p1"))] }, ["lg:aux:正面"]],
  ["21o 记录与回包只差名字 → 整份不认", [sl("侧面", "primary", "p1")], { prev: [], server: [idd("slot_x", sl("正面", "primary", "p1"))] }, ["lg:primary:侧面"]],
  [
    "21p S 让位：记下的那一格本机删了、之后又加了一格同名同 role 的（编辑屏挪位置就是这么挪）→ 新格子留着自己的 id（上面传的照片看得见）",
    SERVER0,
    { prev: [X0[1], idd("slot_n", sl("正面", "primary", "p2"))], server: X0 },
    ["slot_n", "slot_f"],
  ],
  ["21q S 让位：新加的一格名字不同、同一位置 role 与正文相同（B 认得上）→ 同样让位", SERVER0, { prev: [idd("slot_n", sl("侧面", "primary", "p1")), X0[1]], server: X0 }, ["slot_n", "slot_f"]],
  ["21r 新加的一格名字、位置都对不上 → 不让位，照走 S（被删那格的 id 接回来）", SERVER0, { prev: [X0[1], idd("slot_n", sl("背面", "primary", "q"))], server: X0 }, ["slot_x", "slot_f"]],
  ["21s 新加的一格同名、role 不同（A、B 本来就不认它）→ 不让位", SERVER0, { prev: [X0[1], idd("slot_n", sl("正面", "aux", "p1"))], server: X0 }, ["slot_x", "slot_f"]],
  [
    "21t S 让位：新加的那一格后来换了 role（本机那份里是它的变体）、按原 role 对得上 → 让位，V 认回它的原 id",
    SERVER0,
    { prev: [X0[1], idd("slot_n~primary~aux", sl("正面", "aux", "p2"))], server: X0 },
    ["slot_n", "slot_f"],
  ],
  ["21u V：记录对不上（或没有）、本机那一格换过 role、名字没改 → 按原 id + 原 role 认回来", SERVER0, { prev: [idd("slot_x~primary~aux", sl("正面", "aux", "p1")), X0[1]] }, ["slot_x", "slot_f"]],
  ["21v V：同上、名字也改了，位置与正文没变 → 同样认回来（V 里 B 那一半）", SERVER0, { prev: [idd("slot_x~primary~aux", sl("侧面", "aux", "p1")), X0[1]] }, ["slot_x", "slot_f"]],
  [
    "21w V 排在 A、B 后面：本机那份里同名同 role 的正经格子先认",
    SERVER0,
    { prev: [idd("slot_x~primary~aux", sl("正面", "aux", "p1")), idd("slot_n", sl("正面", "primary", "p2")), X0[1]] },
    ["slot_n", "slot_f"],
  ],
  [
    "21x V 不拿本机那份里另有一格字面上挂着的原 id（那一格收着它自己的照片）",
    SERVER0,
    { prev: [idd("slot_x", sl("背面", "primary", "q")), idd("slot_x~primary~aux", sl("正面", "aux", "p1")), X0[1]] },
    ["lg:primary:正面", "slot_f"],
  ],
  ["21y V：名字、正文都改过的换过 role 的格子 → 认不回（文件头 ⑤ 写着这一种够不着）", SERVER0, { prev: [idd("slot_x~primary~aux", sl("侧面", "aux", "p9")), X0[1]] }, ["lg:primary:正面", "slot_f"]],
  ["21z V 按原 role 核：原 role 与服务端那一格不同 → 不认（原 id 收着的是原 role 下传的照片）", [sl("正面", "face", "p1"), sl("脸", "face", "f1")], { prev: [idd("slot_x~primary~aux", sl("正面", "aux", "p1")), X0[1]] }, ["lg:face:正面", "slot_f"]],
  ["17s 存编辑屏：没带 id 的格子派生出来的 id 撞上存着的那一版里挂着的派生 id → 接 #2（held 也管派生 id，复核第 5 轮起）", [sl("A", "primary", "q")], ed([idd("lg:primary:A", sl("A", "primary", "p"))]), ["lg:primary:A#2"]],
];
for (const [name, slots, opts, want] of cases) {
  const got = idsOf(run(slots, opts));
  if (show(got) !== show(want)) fail(`${name}\n      want ${show(want)}\n      got  ${show(got)}`);
  if (new Set(got).size !== got.length) fail(`${name}：同一套里两格拿到了同一个 id ${show(got)}（两格显示同一张照片、铸卡时同一张进两次）`);
  // 存编辑屏：本机存着的那一版里某一格占着的 id（内置 / 新建 / 派生 / 变体，四类都算），只许留给带着它进来的那一格
  //   ★ 复核第 6 轮去掉了「派生 id 不在此列」：第 5 轮起派生 id 也进 held（C 步不许派生出存着的那一版里挂着的派生 id，17s）
  const before = opts?.edit?.before;
  if (before) {
    const stored = new Set(before.filter((p) => p && typeof p.id === "string").map((p) => p.id));
    got.forEach((id, i) => {
      if (typeof id === "string" && stored.has(id) && slots[i].id !== id) {
        fail(`${name}：第 ${i + 1} 格拿到了本机存着的另一格的 id ${show(id)}（那一格的草稿照片会出现在它身上）`);
      }
    });
  }
}

// 9 幂等：第二遍（冷启动 load 那一遍：没有 prev、没有 edit）changed=false，而且每一格都是同一个对象
//   （内置图位对象上将来可能有 getter，展开一次就丢了）
for (const [name, slots, opts] of cases) {
  const first = run(slots, opts);
  const again = run(first.slots, null);
  if (again.changed) fail(`9 幂等（${name}）：第二遍 changed 应为 false，got ids ${show(idsOf(again))}`);
  if (again.slots.some((s, i) => s !== first.slots[i])) fail(`9 幂等（${name}）：第二遍应原样返回同一批对象`);
  // 「已装 · 用它」连装两次：拿自己当 prev 再对齐一遍，id 一个都不许变
  const self = run(first.slots, { prev: first.slots });
  if (show(idsOf(self)) !== show(idsOf(first))) fail(`9b 拿自己当 prev（${name}）：want ${show(idsOf(first))}，got ${show(idsOf(self))}`);
  // 编辑屏什么都没改就点保存：拿自己当 before，id 一个都不许变
  const saved = run(first.slots, ed(first.slots));
  if (show(idsOf(saved)) !== show(idsOf(first))) fail(`9c 拿自己当 before（${name}）：want ${show(idsOf(first))}，got ${show(idsOf(saved))}`);
  // 删掉之后装回来、记录就是自己：按位置接回，id 一个都不许变
  const fromServer = run(first.slots, { prev: [], server: first.slots });
  if (show(idsOf(fromServer)) !== show(idsOf(first))) fail(`9d 拿自己当 server（${name}）：want ${show(idsOf(first))}，got ${show(idsOf(fromServer))}`);
}
{
  const r = run(OLD_CLEAN, null);
  if (!r.changed) fail("1 老 clean 三格第一次算 id：changed 应为 true");
  const kept = run([idd("fullBody", sl("全身立绘", "primary", "P_BODY"))], null);
  if (kept.changed) fail("自带合法 id 的图位：changed 应为 false");
}

// 序列：一格从空白建出来，分几次保存换 role 再换回来（复核第 2 轮）。每一次保存都拿上一次存下来的当 before，
//   每一步之后冷启动读一遍 id 都不变；换回原 role 那一下回到最初的新建 id —— 那格的草稿照片跟着回来。
{
  const save = (slots, before) => run(slots, ed(before)).slots;
  const s0 = save([idd("slot_a", sl("正面", "primary", "x"))], null);
  const s1 = save(s0.map((s) => ({ ...s, role: "face" })), s0);
  const s2 = save(s1.map((s) => ({ ...s, role: "aux", tag: "正脸" })), s1); // 顺手改个名：新建 id 系不看名字
  const s3 = save(s2.map((s) => ({ ...s, role: "primary" })), s2);
  const got = [s0, s1, s2, s3].map((x) => x[0].id);
  const want = ["slot_a", "slot_a~primary~face", "slot_a~primary~aux", "slot_a"];
  if (show(got) !== show(want)) fail(`序列 · 从空白建的格子换 role 再换回来：want ${show(want)}\n      got  ${show(got)}`);
  for (const x of [s0, s1, s2, s3]) if (run(x, null).changed) fail(`序列 · 冷启动读回来 id 变了：${show(idsOf({ slots: x }))}`);
}
// 序列：另存 clean → 删掉占着 fullBody 的那格再存 → 冷启动 → 「已装 · 用它」装回老的共享版（复核第 2 轮 P1-A + P4）
{
  const clean = [idd("fullBody", sl("全身立绘", "primary", "P_BODY")), idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE)), idd("sourceCrop", sl("原片截图", "display", "", { fromCrop: true }))];
  const copy = [{ ...clean[0], tag: "正面", prompt: "x" }, clean[1], idd("slot_new", sl("全身立绘", "primary", "mine"))];
  const c1 = run(copy, ed(null)).slots;
  const c2 = run(c1.slice(1), ed(c1)).slots;
  const c3 = run(c2, null).slots;
  const shared = run([sl("全身立绘", "primary", "P_BODY"), sl("面部特写", "face", "P_FACE", FACE)], null).slots;
  const c4 = run(shared, { prev: c1 }).slots;
  const got = [c1, c2, c3, c4].map((x) => x.map((s) => s.id));
  const want = [["fullBody", "faceCloseup", "slot_new"], ["faceCloseup", "slot_new"], ["faceCloseup", "slot_new"], ["slot_new", "faceCloseup"]];
  if (show(got) !== show(want)) fail(`序列 · 另存副本删格 / 重装：want ${show(want)}\n      got  ${show(got)}`);
}
// 序列：派生 id / 内置 id 分几次保存「改名 + 改 role → 改回 role → 改回名字」（复核第 5 轮 U1 / U2 / U4）。
//   每一次保存都拿上一次存下来的当 before；改回原 role 那一下就回到原 id（与名字、正文改没改无关），每一步之后冷启动读一遍 id 都不变。
{
  const save = (slots, before) => run(slots, ed(before)).slots;
  const at0 = (slots, f) => slots.map((s, i) => (i === 0 ? f(s) : s));
  for (const [name, start, steps, want] of [
    [
      "老方案 / 市场装来的派生 id（U1）",
      run([sl("正面", "primary", "p"), sl("脸", "face", "f")], null).slots,
      [(s) => ({ ...s, tag: "侧面", role: "aux" }), (s) => ({ ...s, role: "primary" }), (s) => ({ ...s, tag: "正面" })],
      ["lg:primary:正面", "lg:primary:正面~primary~aux", "lg:primary:正面", "lg:primary:正面"],
    ],
    [
      "市场装来的派生 id、先改 role 再改名（U4）",
      run([sl("正面", "primary", "p"), sl("脸", "face", "f")], null).slots,
      [(s) => ({ ...s, role: "aux" }), (s) => ({ ...s, tag: "侧面" }), (s) => ({ ...s, role: "primary" }), (s) => ({ ...s, tag: "正面" })],
      ["lg:primary:正面", "lg:primary:正面~primary~aux", "lg:primary:正面~primary~aux", "lg:primary:正面", "lg:primary:正面"],
    ],
    [
      "另存 clean 的副本里的内置 id（U2）",
      save([idd("fullBody", sl("全身立绘", "primary", "P_BODY")), idd("faceCloseup", sl("面部特写", "face", "P_FACE", FACE))], null),
      [(s) => ({ ...s, tag: "正面", prompt: "x" }), (s) => ({ ...s, role: "face" }), (s) => ({ ...s, role: "primary" }), (s) => ({ ...s, tag: "全身立绘", prompt: "P_BODY" })],
      ["fullBody", "fullBody", "fullBody~primary~face", "fullBody", "fullBody"],
    ],
  ]) {
    const got = [start[0].id];
    let cur = start;
    for (const step of steps) {
      cur = save(at0(cur, step), cur);
      got.push(cur[0].id);
      if (run(cur, null).changed) fail(`序列 · ${name}：冷启动读回来 id 变了 ${show(idsOf({ slots: cur }))}`);
    }
    if (show(got) !== show(want)) fail(`序列 · ${name}：want ${show(want)}\n      got  ${show(got)}`);
  }
}
// 旧的门禁内小本机库（复核第 4 轮）已删：第 5 轮在拷贝树上改坏 promptSchemes 的旧版记法，门禁全绿 —— 它跑的是门禁里的模型，不是真模块。
//   本机库那几步现在在（g）里拿真的 promptSchemes / schemeMarket 跑。

// 计划接受的收窄（写在这里是为了让它是一个**看得见的决定**，清单见 schemeSlotIds 文件头）：
//   从空白建的方案里的格子（新建 id）与另一套从空白建的、或老方案 / 市场装来的同名格子（派生 id）各有各的 id，草稿照片不共用
//   （改动前按名字共用）。哪天要改回共用，先改这一条并说清为什么。
{
  const x = idsOf(run([idd("slot_x1", sl("正面", "primary", "a"))], ed(null)));
  const y = idsOf(run([idd("slot_y1", sl("正面", "primary", "b"))], ed(null)));
  const legacy = idsOf(run([sl("正面", "primary", "c")], null));
  if (x[0] === y[0]) fail(`两套从空白建的方案里重名的格子不该共用 id：got ${show(x)} / ${show(y)}`);
  if (x[0] === legacy[0]) fail(`从空白建的格子与老方案里同名的格子不该共用 id：got ${show(x)} / ${show(legacy)}`);
}

// 坏形状：一步都不许抛，派生出来的每个 id 都合法、互不相同
{
  const weird = [
    { tag: "A", role: "primary", prompt: "p", size: 5, ref: 7 },
    { tag: "  ", role: undefined, prompt: undefined },
    { tag: `${"a".repeat(47)} b`, role: "aux", prompt: "q" },
    { tag: "😀".repeat(60), role: "aux", prompt: "r" },
    { tag: "😀".repeat(60), role: "aux", prompt: "s" },
    { tag: "B", role: "x".repeat(200), prompt: "t" },
    { id: "slot_w~primary~", tag: "W", role: "display", prompt: "u" },
    { id: "slot_v", tag: "V", role: "x".repeat(20), prompt: "v" },
  ];
  const r = run(weird, null);
  const got = idsOf(r);
  if (got.some((id) => !S.isValidSlotId(id))) fail(`坏形状：派生出了不合法的 id ${show(got)}`);
  if (new Set(got).size !== got.length) fail(`坏形状：派生 id 有重复 ${show(got)}`);
  const r2 = run(weird, { prev: [idd("lg:primary:A", sl("A", "face", "zz")), null, { id: 5, tag: 9 }] });
  if (idsOf(r2).some((id) => !S.isValidSlotId(id))) fail(`坏形状（有 prev）：派生出了不合法的 id ${show(idsOf(r2))}`);
  const r3 = run(weird, ed([null, { id: 5 }, idd("lg:primary:A", sl("A", "face", "zz")), { id: "slot_v", tag: "V", role: "primary" }, { id: "slot_w~primary~", role: 7 }]));
  if (idsOf(r3).some((id) => !S.isValidSlotId(id))) fail(`坏形状（有 before）：派生出了不合法的 id ${show(idsOf(r3))}`);
  if (new Set(idsOf(r3)).size !== idsOf(r3).length) fail(`坏形状（有 before）：id 有重复 ${show(idsOf(r3))}`);
  for (const server of [
    [null, { id: 5, tag: 9 }, idd("slot_v", sl("V", "primary", "v"))],
    "x",
    // 内容逐格相同、id 一半是坏值 / 重复 / kind 词：S 步照走，坏的那几格不接
    weird.map((s, i) => ({ ...s, id: [5, "slot_k", "slot_k", "body", " x", "lg:aux:😀", undefined, "slot_v"][i] })),
  ]) {
    const r4 = run(weird, { prev: [idd("lg:primary:A", sl("A", "face", "zz"))], server });
    if (idsOf(r4).some((id) => !S.isValidSlotId(id))) fail(`坏形状（有记录）：派生出了不合法的 id ${show(idsOf(r4))}`);
    if (new Set(idsOf(r4)).size !== idsOf(r4).length) fail(`坏形状（有记录）：id 有重复 ${show(idsOf(r4))}`);
  }
}

// editBefore：saveScheme 交给 normalizeSlotIds 的 before（此刻存着的 + 编辑屏打开时那一版，复核第 3 轮）
if (typeof S.editBefore === "function") {
  const a = idd("slot_a", sl("A", "primary", "p"));
  const a2 = idd("slot_a", sl("A", "face", "p"));
  const b = idd("slot_b", sl("B", "aux", "q"));
  const form = (r) => (r === null ? null : r.map((p) => `${p.id}|${p.role}`));
  for (const [name, stored, base, want] of [
    ["两份都没有 → null（新建 / 另存为）", null, undefined, null],
    ["只有此刻存着的 → 就是它", [a], null, ["slot_a|primary"]],
    ["只有打开时那一版（此刻那份被删了）→ 就是它", undefined, [b], ["slot_b|aux"]],
    ["此刻存着的排前面、同一个 id 只登记一次（说法不一样听此刻存着的）", [a], [a2, b], ["slot_a|primary", "slot_b|aux"]],
    ["坏元素不带进去", [null, a], [null], ["slot_a|primary"]],
  ]) {
    let got;
    try {
      got = form(S.editBefore(stored, base));
    } catch (e) {
      got = `抛了：${e?.message ?? e}`;
    }
    if (show(got) !== show(want)) fail(`editBefore · ${name}\n      want ${show(want)}\n      got  ${show(got)}`);
  }
}

// ── (d) freshSlotId ──
{
  const seq = ["taken_one", "body", "custom_no_prefix", "slot_taken", "slot_a~primary~face", "slot_new"];
  const got = S.freshSlotId(["taken_one", "slot_taken"], () => seq.shift() ?? "slot_extra");
  if (got !== "slot_new") fail(`15 freshSlotId 先给被占的、kind 词、不带前缀的、role 变体形状的，再给新的：want "slot_new"，got ${show(got)}`);
  const broken = S.freshSlotId(["x"], () => "body");
  if (!S.isFreshSlotId(broken)) fail(`15 freshSlotId 生成器恒给 kind 词：必须退成合法的新建 id，got ${show(broken)}`);
  const noPrefix = S.freshSlotId([], () => "abc");
  if (!S.isFreshSlotId(noPrefix)) fail(`15 freshSlotId 生成器恒给不带前缀的值：必须退成新建 id（不带前缀的不会先让内置血统），got ${show(noPrefix)}`);
  const stuck = S.freshSlotId(["slot_same"], () => "slot_same");
  if (stuck === "slot_same" || !S.isFreshSlotId(stuck)) fail(`15 freshSlotId 生成器恒给被占的值：必须换一个，got ${show(stuck)}`);
  const taken = new Set();
  for (let i = 0; i < 200; i++) {
    const id = S.freshSlotId(taken);
    if (!S.isFreshSlotId(id) || taken.has(id)) {
      fail(`15 freshSlotId 缺省生成器给了不合法、不带前缀或被占的 id：${show(id)}`);
      break;
    }
    taken.add(id);
  }
}

// ── (e) 真表：七个内置图位 id 与中文原名逐字不变，每个内置图位的 id 与 tag 键成对，同一个 id 在几套里是同一格 ──
//   ★ id 是本机存着的自建方案副本里躺着的身份；原名是存进 CardView.tag 的值、也是老方案按名字认回的依据。改哪个都零报错。
//   ★ 同一个 id 在几套内置方案里必须 role / 正文 / ref / size / fromCrop 逐项相同：换方案时照片按 id 接续，
//     而 promptSchemes.builtinLineage 按 id 去重只留第一份 —— 第二套里同一个 id 换了 role，一张脸部照片就接到
//     另一种 role 的格子上、以那种 role 铸进卡里，没有任何提示（复核第 2 轮）。
const SHIPPED = {
  fullBody: "全身立绘",
  faceCloseup: "面部特写",
  sourceCrop: "原片截图",
  mannequinBody: "白模全身",
  outfitDetail: "服装细节",
  mannequinTurnaround: "白模三视图",
  specSheet: "设定规格稿",
};
/**
 * 七个内置图位各自的 role。★ role 是身份的一部分（normalizeSlotIds 的 ★★ role）：内置 id 的 role 由内置表定死，
 *   本机存着的副本里躺着这些 id。哪一格改了 role 却沿用老 id，存量副本里那一格一冷启动就换 id、草稿照片收起来；
 *   真要改 role 就换一个新 id（老 id 留给存量副本）。几套之间逐项相同那条核不出「几套一起改」（复核第 3 轮），所以单独钉。
 */
const SHIPPED_ROLE = {
  fullBody: "primary",
  faceCloseup: "face",
  sourceCrop: "display",
  mannequinBody: "primary",
  outfitDetail: "aux",
  mannequinTurnaround: "display",
  specSheet: "display",
};
{
  const typesSrc = fs.readFileSync(path.join(root, "src/types.ts"), "utf8");
  const tm = /export const BUILTIN_SLOT_ZH = \{([\s\S]*?)\} as const;/.exec(typesSrc);
  if (!tm) {
    fail("src/types.ts：抠不出 `export const BUILTIN_SLOT_ZH = { … } as const;`（那边改了写法，就同步改这里的抠法）");
  } else {
    const table = {};
    for (const m of tm[1].matchAll(/^\s*(\w+):\s*"([^"]*)",?\s*$/gm)) table[m[1]] = m[2];
    if (show(table) !== show(SHIPPED)) {
      fail(`types.BUILTIN_SLOT_ZH 与上线的七对对不上（id 是存量方案里的身份、原名是存进卡里的值，两样都不许改）：\n      want ${show(SHIPPED)}\n      got  ${show(table)}`);
    }
  }
  for (const id of Object.keys(SHIPPED)) {
    if (!S.isValidSlotId(id) || S.isFreshSlotId(id) || id.startsWith("lg:") || id.startsWith("slot_")) {
      fail(`内置图位 id ${show(id)} 不合法，或占了派生 / 新建 id 的前缀（lg: / slot_）`);
    }
  }

  const psSrc = fs.readFileSync(path.join(root, "src/data/promptSchemes.ts"), "utf8");
  const start = psSrc.indexOf("export const BUILTIN_SCHEMES");
  const end = start < 0 ? -1 : psSrc.indexOf("\n];", start);
  if (start < 0 || end < 0) {
    fail("src/data/promptSchemes.ts：找不到 `export const BUILTIN_SCHEMES … ];`（那边改了写法，就同步改这里的抠法）");
  } else {
    // 整行注释先剥掉（注释里举例写的 id 不算数）
    const block = psSrc.slice(start, end).replace(/^\s*\/\/.*$/gm, "");
    const chunks = block.split(/\bid:\s*"scheme_/).slice(1);
    if (chunks.length === 0) fail("promptSchemes.BUILTIN_SCHEMES：一套内置方案都没抠到");
    const seen = new Set();
    /** 内置 id → 第一次见到它的那套方案与那一格的字段 */
    const firstSeen = new Map();
    for (const chunk of chunks) {
      const scheme = `scheme_${chunk.slice(0, chunk.indexOf('"'))}`;
      const idHits = [...chunk.matchAll(/\bid:\s*"([^"]+)"/g)];
      const slotIds = idHits.map((m) => m[1]);
      const pairs = [...chunk.matchAll(/\bid:\s*"([^"]+)",\s*tag:\s*BUILTIN_SLOT_ZH\.(\w+)/g)];
      const tags = [...chunk.matchAll(/\btag:/g)].length;
      if (slotIds.length === 0) fail(`${scheme}：图位一个 id 都没有`);
      if (pairs.length !== slotIds.length || tags !== slotIds.length) {
        fail(`${scheme}：每个内置图位都要写成 id 在前、紧跟 tag: BUILTIN_SLOT_ZH.<同一个键>（抠到 id ${slotIds.length} 个、成对 ${pairs.length} 个、tag ${tags} 个）`);
      }
      for (const [, id, key] of pairs) if (id !== key) fail(`${scheme}：图位 id ${show(id)} 配的是 BUILTIN_SLOT_ZH.${key}（id 与名字必须是同一个键）`);
      if (new Set(slotIds).size !== slotIds.length) fail(`${scheme}：同一套方案里图位 id 重复 ${show(slotIds)}`);
      for (const id of slotIds) {
        if (!(id in SHIPPED)) fail(`${scheme}：图位 id ${show(id)} 不在 types.BUILTIN_SLOT_ZH 里`);
        seen.add(id);
      }
      // 每一格的字段：从它的 id 抠到下一格的 id（图位是 slots 里最后一项，后面只剩括号）
      idHits.forEach((m, k) => {
        const body = chunk.slice(m.index, k + 1 < idHits.length ? idHits[k + 1].index : chunk.length);
        const role = /\brole:\s*"(\w+)"/.exec(body)?.[1];
        const prompt = /\bprompt:\s*(\w+|"[^"]*")/.exec(body)?.[1];
        if (!role || prompt === undefined) {
          fail(`${scheme} 的 ${show(m[1])}：抠不出 role: "…" 或 prompt: …（那边改了写法，就同步改这里的抠法）`);
          return;
        }
        const fields = {
          role,
          prompt,
          ref: /\bref:\s*"(\w+)"/.exec(body)?.[1] ?? "body",
          size: /\bsize:\s*([^,\n}]+)/.exec(body)?.[1]?.trim() ?? "",
          fromCrop: /\bfromCrop:\s*true\b/.test(body),
        };
        if (m[1] in SHIPPED_ROLE && role !== SHIPPED_ROLE[m[1]]) {
          fail(`${scheme} 的内置图位 ${show(m[1])} role 是 ${show(role)}，上线的是 ${show(SHIPPED_ROLE[m[1]])}（role 是身份的一部分：要改 role 就换一个新 id）`);
        }
        const prior = firstSeen.get(m[1]);
        if (!prior) firstSeen.set(m[1], { scheme, fields });
        else if (show(prior.fields) !== show(fields)) {
          fail(`内置图位 ${show(m[1])} 在 ${prior.scheme} 与 ${scheme} 里不是同一格（换方案时照片按 id 接续，role 不同就以另一种 role 铸卡）：\n      ${prior.scheme} ${show(prior.fields)}\n      ${scheme} ${show(fields)}`);
        }
      });
    }
    for (const id of Object.keys(SHIPPED)) if (!seen.has(id)) fail(`types.BUILTIN_SLOT_ZH.${id} 没有任何内置方案在用`);
  }
}

// ── (f) 接线：几个调用点各传哪一档（复核第 3 轮）──
//   ★★ tsc 只逼调用方**选一档**，选没选对它看不见（`{ before: null }` 在哪儿都通过编译），而传错哪一边都零症状：
//     · load / apiToScheme 传成存编辑屏 → 读回来的新建 id 被当成「这一次新加的」换成内置 id，某一格的照片挂到另一格上；
//     · saveScheme 的 before 写成 null / 当成读 → 改了 role 的自建格子留着原 id，照片以另一种 role 铸卡；
//     · saveScheme 不并编辑屏打开时那一版、或编辑屏不交 base → 编辑屏开着时本机那份被「已装 · 用它」换掉，同上；
//     · upsertMine 不传 prev → 重装自己的方案时草稿照片对不上格子，新派生的 id 还会撞上本机旧那份里另一格的 id；
//     · 自建卡页换方案拿 next.slots 全量当「留着」→ 照片换过去落在 fromCrop 格上，本页不画、那句「先收起来了」也不说。
//   ★ 按源码的**写法**核（空白归一后逐字比）：改了写法就同步改这里 —— 有意为之，改接线的人应当来这里说清楚为什么。
//   ★ 另数一遍 src 里这几个函数的调用点：新加一个调用点，就得在这里登记它（并想清楚它该传哪一档）。
{
  const norm = (t) => t.replace(/\s+/g, " ");
  const texts = new Map();
  /** 源码去掉注释之后的样子（codeOnly）：接线一节只核代码 —— 钉着的两句之间插注释照过，注释里写着的调用也不算数 */
  const readRel = (rel) => {
    if (!texts.has(rel)) {
      try {
        texts.set(rel, codeOnly(fs.readFileSync(path.join(root, rel), "utf8"), rel));
      } catch {
        fail(`${rel}：读不到（接线一节要读它）`);
        texts.set(rel, "");
      }
    }
    return texts.get(rel);
  };
  /**
   * 一个函数的函数体：从含 head 的那一行起，到下一行**只有**与它同缩进的 `}` 为止（空白归一；注释已经在 readRel 里剥成空白）。
   * ★ 要整行只有 `}`：多行签名的参数类型收尾是 `}): Promise<…> {`（portraitViews），只比开头的话函数体会被截成只剩签名。
   */
  const body = (rel, head) => {
    const lines = readRel(rel).split(/\r?\n/);
    const i = lines.findIndex((ln) => ln.includes(head));
    if (i < 0) {
      fail(`${rel}：找不到 ${show(head)}（改了写法就同步改 check-slot-ids 的接线一节）`);
      return "";
    }
    const indent = /^\s*/.exec(lines[i])[0];
    const j = lines.findIndex((ln, k) => k > i && ln.trimEnd() === `${indent}}`);
    return norm(lines.slice(i, j < 0 ? undefined : j + 1).join("\n"));
  };
  /** 函数体里某个写法出现几次（`re` 带 g） */
  const countIn = (rel, head, re, want, why) => {
    const b = body(rel, head);
    if (!b) return;
    const n = [...b.matchAll(re)].length;
    if (n !== want) fail(`${rel} 的 ${show(head)}：${re} 应当出现 ${want} 次，got ${n}\n      ${why}`);
  };
  const need = (rel, head, snippets, why) => {
    const b = body(rel, head);
    if (!b) return;
    for (const s of snippets) if (!b.includes(norm(s))) fail(`${rel} 的 ${show(head)}：接线应当含 ${show(s)}\n      ${why}`);
  };

  const PS = "src/data/promptSchemes.ts";
  need(PS, "function load(", ['withSlotIds(s.slots, "read")'], "冷启动是读：当成存编辑屏的话，读回来的新建 id 会按名字换成内置 id");
  need(PS, "export function withSlotIds(", ['normalizeSlotIds(slots, { builtins: builtinLineage(), edit: mode === "read" ? undefined : mode })'], "「读」不许带 edit，「存编辑屏」必须带 before");
  need(
    PS,
    "export function saveScheme(",
    [
      "base: readonly SchemeSlot[] | null): PromptScheme {",
      'const id = s.id && !s.id.startsWith("scheme_") ? s.id : uid("ps");',
      "const ownEdit = id === s.id; const old = mine.find((x) => x.id === id); const next: PromptScheme = {",
      "withSlotIds(s.slots.slice(0, MAX_CARD_VIEWS), { before: editBefore(old?.slots, ownEdit ? base : null) })",
      "mine = [next, ...mine.filter((x) => x.id !== next.id)]; persist(); seedServerSlots(old); emit(); return next;",
    ],
    "存编辑屏的 before = 本机此刻存着的同一套（换掉之前取）+ 编辑屏打开时那一版（只在改自己那一套时并）；base 必填；方案库落盘之后再补记服务端那一版（复核第 6 轮：先写记录会在配额只剩一点时挤掉方案库那一下）",
  );
  need(
    PS,
    "export function upsertMine(",
    [
      "const prev = mine.find((x) => x.id === s.id)?.slots ?? removedSlots.get(s.id) ?? [];",
      "normalizeSlotIds(s.slots, { builtins: builtinLineage(), prev, server: serverSlotsOf(s.id) })",
      "mine = [next, ...mine.filter((x) => x.id !== next.id)]; persist(); noteServerSlots(next.id, next.slots); emit();",
    ],
    "重装要拿记下的服务端那一版与本机那份对齐（本机没有这一套时用这一次会话里删掉那一刻的那一版，再没有才是空数组，照样对齐）；方案库落盘之后把回包记成新的服务端那一版（复核第 4、5、6 轮）",
  );
  need(
    PS,
    "export function removeScheme(",
    ["const old = mine.find((s) => s.id === id); if (old) removedSlots.set(id, old.slots); mine = mine.filter((s) => s.id !== id); persist(); seedServerSlots(old); emit();"],
    "删掉那一刻的本机那份记进 removedSlots（同一次会话里装回来时当 prev，复核第 6 轮）；方案库落盘之后补记服务端那一版（复核第 4、5 轮 B）",
  );
  need(
    PS,
    "function seedServerSlots(",
    ["if (!old || serverSlotsTable().has(old.id)) return;", "if (old.published === undefined && old.author === undefined) return;", "noteServerSlots(old.id, old.slots);"],
    "只补记还没有记录的、发布过或装来的；已经有记录的不许盖（那是推上去 / 装回来时写下的真相）",
  );
  need("src/data/schemeMarket.ts", "export async function shareScheme(", ["if (on) { await pushScheme(s); noteServerSlots(s.id, s.slots); }"], "推上去成功之后才记服务端那一版（没推上去就记，会盖掉上一份对的记录）");
  {
    const ps = readRel(PS);
    const load = ps.indexOf("let mine: PromptScheme[] = load();");
    for (const decl of ["const SERVER_SLOTS_KEY = ", "const SERVER_SLOTS_MAX = ", "let serverSlots: Map<string, SchemeSlot[]> | null = null;", "const removedSlots = new Map<string, SchemeSlot[]>();"]) {
      const at = ps.indexOf(decl);
      if (at < 0 || load < 0 || at > load) fail(`${PS}：${show(decl)} 要声明在 \`let mine = load()\` 上面（那一行在模块初始化时就跑，TDZ 那条纪律）`);
    }
    const cap = Number(/const SERVER_SLOTS_MAX = (\d+);/.exec(ps)?.[1]);
    if (!(cap >= 32)) fail(`${PS}：SERVER_SLOTS_MAX 应当 ≥ 32，got ${cap}（太小的话，装过几套别人的方案之后，自己发布过的那一套的记录就被挤掉，照片够不着）`);
    // ★ 冷启动不许写：load 里不许出现会落盘 / 通知的调用（（g）另在真模块上数 setItem）
    const loadBody = body(PS, "function load(");
    for (const bad of ["setItem(", "persist(", "emit(", "noteServerSlots(", "seedServerSlots(", "removedSlots"]) {
      if (loadBody.includes(bad)) fail(`${PS} 的 load：出现了 ${show(bad)}（启动时一个字节都不许落；load 里读到的东西还得声明在它上面，TDZ）`);
    }
    // ★ removedSlots 一共三处：声明、removeScheme 记、upsertMine 读（上面逐处核了）。多一处读写就在这里登记，并想清楚它是不是还只在内存里
    const removedUses = [...ps.matchAll(/\bremovedSlots\b/g)].length;
    if (removedUses !== 3) fail(`${PS}：removedSlots 应当出现 3 处（声明 / removeScheme 记 / upsertMine 读），got ${removedUses}`);
    // ★ 换掉 mine 的写法一共五处：三处换图位 / 拿掉方案（saveScheme、removeScheme 落盘之后 seedServerSlots，upsertMine 记回包，上面逐处核了），
    //   两处只改 published / examples。新加一处就在这里登记，并想清楚它换不换图位。
    //   ★ ps 已经是去掉注释的代码（readRel）；不管在不在行首都数（复核第 5 轮：`if (x) mine = …;`、`=> (mine = …)` 原先数不到）
    const assigns = [...ps.matchAll(/(?<![.\w])mine\s*=(?!=)/g)].length;
    if (assigns !== 5) fail(`${PS}：\`mine = \` 赋值应当是 5 处（saveScheme / removeScheme / upsertMine 换图位，setSchemeExamples / patchMine 不换），got ${assigns}\n      新加的那一处要是换图位 / 拿掉方案，先 seedServerSlots 再换`);
    // ★ 就地改 mine 的写法不许，核的是这几种（复核第 6 轮：原先只拦数组方法，`mine[i] = { …, slots }` 照过）：
    //   按下标取 mine[…]（读写都不许 —— 本文件一律 find / map）、Object.assign(mine…)、mine.length、会改数组本身的方法。
    //   ⚠ 拦不住的：先 find 出元素再改它的字段（`mine.find(…).slots = …`）—— 真要这么写的人，这一格也请一起补上
    for (const m of ps.matchAll(/(?<![.\w])mine\s*\[|\bObject\.assign\(\s*mine\b|(?<![.\w])mine\.length\b|(?<![.\w])mine\.(?:push|splice|unshift|pop|shift|sort|reverse|fill|copyWithin)\(/g)) {
      fail(`${PS}：出现了 ${show(m[0])} —— mine 只许整个换掉（上面数着换的地方）`);
    }
  }
  // ★ 存进 CardView.tag 的名字只由 slotCardTag 定，内置图位读冻结的中文原名（复核第 4 轮：这几处改回 slot.tag，tsc 与原先的门禁都照过，
  //   而下一批内置图位名接 Lingui 之后，卡里存的就成了界面语言的名字；按名字认回内置 id 也会跟着界面语言变）
  need(PS, "function builtinLineage(", ["const zh = builtinSlotZh(s.id);"], "血统表的原名读冻结表，不读 slot.tag（界面名接 Lingui 之后会变）");
  need(PS, "export function slotCardTag(", ["return (scheme.builtin ? (builtinSlotZh(slot.id) ?? slot.tag) : slot.tag).trim().slice(0, VIEW_TAG_MAX);"], "内置图位存冻结的中文原名，自建的存作者起的名字");
  countIn("src/ai/real.ts", "export async function portraitViews(", /tag: slotCardTag\(o\.scheme, slot\)/g, 2, "两条回包（原片裁剪那格、出图那格）的 tag 都走 slotCardTag");
  countIn("src/mock/ai.ts", "export async function portraitViews(", /tag: slotCardTag\(o\.scheme, slot\)/g, 2, "演示档与 real 同形");
  countIn("src/pages/CustomCardPage.tsx", "async function mint()", /tag: slotCardTag\(scheme, slot\)/g, 1, "自建卡页铸卡时 views 的 tag 走 slotCardTag");
  for (const rel of ["src/ai/real.ts", "src/mock/ai.ts", "src/pages/CustomCardPage.tsx"]) {
    for (const m of readRel(rel).matchAll(/\btag:\s*(?:slot|s)\.tag\b/g)) {
      fail(`${rel}：出现了 ${show(m[0])} —— 存进 CardView.tag 的名字只由 slotCardTag 定（内置图位存冻结的中文原名，不存界面显示名）`);
    }
  }
  need("src/api/schemes.ts", "export function apiToScheme(", ['withSlotIds(Array.isArray(a.slots) ? a.slots : [], "read")'], "服务端回包是读（id 被 strip 了，现算；对齐本机那份由 upsertMine 做）");
  const ED = "src/studio/ui/SchemeEditorSheet.tsx";
  if (!norm(readRel(ED)).includes(norm("const copying = !source || !!source.builtin;"))) fail(`${ED}：找不到 \`const copying = !source || !!source.builtin;\`（base 按它分，改了写法就同步改这里）`);
  need(ED, "function save()", ["copying ? null : (source?.slots ?? null),"], "改自己那套交打开时拷贝的那一版图位，新建 / 另存为交 null");
  const CC = "src/pages/CustomCardPage.tsx";
  need(CC, "function drawnSlots<", ["return slots.filter((s) => !s.fromCrop);"], "本页画得出来的图位 = 去掉 fromCrop");
  if (!norm(readRel(CC)).includes(norm("const pageSlots = useMemo(() => drawnSlots(scheme.slots), [scheme]);"))) fail(`${CC}：pageSlots 应当是 drawnSlots(scheme.slots)（与换方案判收起来的同一把尺）`);
  need(CC, "function changeScheme(", ["const keep = new Set(drawnSlots(next.slots).map((s) => s.id));"], "「新方案里有」只算新方案画得出来的格子");

  // 调用点清点（声明本身不算；注释一律不算 —— codeOnly 剥掉的，含 JSX 里的 `{/* … *\/}` 与行尾的 `/* … *\/`）
  // ★ 名字只写这一处（正则字面量），调用 / 别名 / 裸引用三条都从它的 .source 派生（CLAUDE.md：正则别写成字符串常量）
  const GATED = /\b(withSlotIds|normalizeSlotIds|editBefore|saveScheme|slotCardTag|noteServerSlots|seedServerSlots)\b/;
  /** 调用：名字后面直接跟 `(`，或者先跟一段泛型再 `(`（`normalizeSlotIds<X>(…)` 也是调用）；`function 名字` 是声明 */
  const CALL = new RegExp(String.raw`(?<!function\s)` + GATED.source + String.raw`\s*(?:<[^<>()]*>\s*)?\(`, "g");
  const ALIAS = new RegExp(GATED.source + String.raw`\s+as\b`);
  const BARE = new RegExp(GATED.source, "g");
  const WANT = {
    "src/ai/real.ts": { slotCardTag: 2 },
    "src/api/schemes.ts": { withSlotIds: 1 },
    "src/data/promptSchemes.ts": { withSlotIds: 2, normalizeSlotIds: 2, editBefore: 1, noteServerSlots: 2, seedServerSlots: 2 },
    "src/data/schemeMarket.ts": { noteServerSlots: 1 },
    "src/mock/ai.ts": { slotCardTag: 2 },
    "src/pages/CustomCardPage.tsx": { slotCardTag: 1 },
    "src/studio/ui/SchemeEditorSheet.tsx": { saveScheme: 1 },
  };
  const got = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const rel = path.relative(root, p).split(path.sep).join("/");
        let code = codeOnly(fs.readFileSync(p, "utf8"), rel);
        // ★★ import / export 的花括号清单（可能跨行）：只许用原名，不许 `as` 起别名 —— 别名的调用点下面一个都数不到
        //   （CLAUDE.md「给 import 起别名，而注释里写死了 rg 自查命令」那格；复核第 4 轮实测 `saveScheme as keep` 门禁照过）。清单本身不算裸引用
        code = code.replace(/\b(?:import|export)\s+(?:type\s+)?(?:\w+\s*,\s*)?\{[^}]*\}/g, (stmt) => {
          if (ALIAS.test(stmt)) fail(`${rel}：${show(stmt.replace(/\s+/g, " "))} 给门禁数着的函数起了别名 —— 别名的调用点数不到，用原名`);
          return "";
        });
        for (const m of code.matchAll(CALL)) {
          got[rel] ??= {};
          got[rel][m[1]] = (got[rel][m[1]] ?? 0) + 1;
        }
        // ★ 清单之外出现这些名字只能是调用或声明：当值传出去（`const ids = withSlotIds`、解构改名）同样让调用点数不到
        for (const m of code.matchAll(BARE)) {
          const after = code.slice(m.index + m[0].length);
          const pre = code.slice(Math.max(0, m.index - 12), m.index);
          if (/^\s*(?:<[^<>()]*>\s*)?\(/.test(after) || /function\s+$/.test(pre)) continue;
          // ★ 只当类型用（`typeof saveScheme`）、写在字符串里（`"withSlotIds"`）的不是当值传出去（复核第 5 轮：原先照样报「改成直接调用」）
          if (/\btypeof\s+$/.test(pre) || (/["'`]$/.test(pre) && after[0] === pre[pre.length - 1])) continue;
          fail(`${rel}：${m[1]} 被当成值用了（${show(code.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).replace(/\s+/g, " "))}）—— 调用点数不到，改成直接调用`);
        }
      }
    }
  };
  walk(path.join(root, "src"));
  /** 与遇到的先后无关的形状：文件名、函数名都排序 */
  const canon = (o) => show(Object.keys(o).sort().map((f) => [f, Object.keys(o[f]).sort().map((k) => [k, o[f][k]])]));
  if (canon(got) !== canon(WANT)) {
    fail(
      `src 里 withSlotIds / normalizeSlotIds / editBefore / saveScheme / slotCardTag / noteServerSlots / seedServerSlots 的调用点变了：\n      want ${show(WANT)}\n      got  ${show(got)}\n      新加 / 挪走调用点时在这里登记，并确认它传的是哪一档（读 / 存编辑屏 / 对齐本机那份）、tag 是不是走 slotCardTag、换图位 / 删方案之前补没补记服务端那一版`,
    );
  }
}

// ── (g) 真模块：promptSchemes / api/schemes / schemeMarket 原样跑（复核第 5 轮；第 6 轮补了桩的搭法与五段场景）──
//   ★★ 为什么：第 5 轮在拷贝树上把旧版的上限改成 0、删方案时顺手清掉旧版、只在没发布时才记 —— 门禁全绿（（f）只核写法，
//     序列跑的是门禁里自己写的模型），而删掉再装回来 / 发布后改过再装回来的照片从此够不着。这里把三个真文件拷进临时目录，
//     只换 import：types 只切出 BUILTIN_SLOT_ZH / builtinSlotZh 两段真代码（MAX_CARD_VIEWS / VIEW_TAG_MAX 从 types.ts 抠数），
//     lingui / HTTP / remoteOn 换成桩；localStorage 用内存假的（可以设配额）；服务端按真控制器的形状模仿
//     （z.object strip 掉 slots[].id、trim、装过就回自己那一行）。「重启」= 同一份 localStorage 再 import 一套新模块（草稿照片与内存里的一切都没了）。
//   ★ 草稿照片的键就是图位 id（CustomCardPage 的 schemeShots 按 slot.id 存）：「照片认得回来」= 那一格的 id 回到传照片时那一格的 id。
//   ★ 桩按三个文件**现在** import 了哪些名字现搭（复核第 6 轮：原先写死几个名字 —— 往已有的 import 里多加一个类型名、用一个 client 里本来就有的
//     apiPatch，就整发变红，报的还是「规则只改 schemeSlotIds.ts」）。引了下面 KNOWN 之外的模块，报「搭不起来」并点名来改这一节。
{
  class HarnessError extends Error {}
  const typesSrc = fs.readFileSync(path.join(root, "src/types.ts"), "utf8");
  const zhAt = typesSrc.indexOf("export const BUILTIN_SLOT_ZH");
  const fnAt = typesSrc.indexOf("export function builtinSlotZh");
  const fnEnd = fnAt < 0 ? -1 : typesSrc.indexOf("\n}", fnAt);
  const mcv = /export const MAX_CARD_VIEWS = (\d+);/.exec(typesSrc)?.[1];
  const vtm = /export const VIEW_TAG_MAX = (\d+);/.exec(typesSrc)?.[1];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-slot-ids-"));
  const LIB = "ideahub.promptSchemes";
  const REC = "ideahub.promptSchemes.serverSlots";
  const check = (ok, msg) => {
    if (!ok) fail(`（g）${msg}`);
  };
  /** 三个真文件各自 import 的模块 → 桩的种类（sid / promptSchemes / schemes 是真模块，其余是桩） */
  const KNOWN = {
    "src/data/promptSchemes.ts": { "../types": "types", "@lingui/core/macro": "lingui", "./schemeSlotIds": "sid" },
    "src/api/schemes.ts": { "./client": "client", "../data/promptSchemes": "promptSchemes" },
    "src/data/schemeMarket.ts": { "./videos": "videos", "@lingui/core/macro": "lingui", "../api/schemes": "schemes", "./promptSchemes": "promptSchemes" },
  };
  const IMPORT_RE = /\b(?:import|export)\s+(type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s*as\s+[\w$]+|[\w$]+))\s*from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  /** 一个真文件 import 了哪些模块、各引了哪些名字（整条 `import type` 与 `type X` 名字不算：Node 剥类型时去掉） */
  const importsOf = (rel) => {
    const out = new Map();
    for (const m of codeOnly(fs.readFileSync(path.join(root, rel), "utf8"), rel).matchAll(IMPORT_RE)) {
      if (m[1]) continue;
      const spec = m[3] ?? m[4];
      const names = out.get(spec) ?? new Set();
      out.set(spec, names);
      if (m[4]) continue;
      const clause = m[2].trim();
      if (!clause.startsWith("{")) {
        throw new HarnessError(`${rel}：${show(`import ${clause} from "${spec}"`)} 是默认导入 / 命名空间导入 ——（g）的桩只按名字搭：改成具名导入，或在 scripts/check-slot-ids.mjs 的（g）里给它搭桩`);
      }
      for (const part of clause.slice(1, -1).split(",")) {
        const name = part.trim();
        if (name && !/^type\s/.test(name)) names.add(name.split(/\s+as\s+/)[0].trim());
      }
    }
    return out;
  };
  try {
    if (zhAt < 0 || fnEnd < 0 || !mcv || !vtm) throw new HarnessError("src/types.ts：抠不出 BUILTIN_SLOT_ZH / builtinSlotZh / MAX_CARD_VIEWS / VIEW_TAG_MAX（那边改了写法，就同步改（g）的抠法）");
    const U = (p) => url.pathToFileURL(p).href;
    const stubNames = { types: new Set(), lingui: new Set(), client: new Set(), videos: new Set() };
    for (const [rel, known] of Object.entries(KNOWN)) {
      for (const [spec, names] of importsOf(rel)) {
        const kind = known[spec];
        if (!kind) throw new HarnessError(`${rel} 新 import 了 ${show(spec)}（${show([...names])}）—— 在 scripts/check-slot-ids.mjs 的（g）里登记它（KNOWN），并搭出这几个名字的桩`);
        if (kind in stubNames) for (const x of names) stubNames[kind].add(x);
      }
    }
    const rest = (kind, real) => [...stubNames[kind]].filter((x) => !real.includes(x));
    fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
    fs.writeFileSync(
      path.join(tmp, "types.ts"),
      `${typesSrc.slice(zhAt, fnEnd + 2)}\nexport const CARD_SIZE = "1728x2304";\nexport const MAX_CARD_VIEWS = ${mcv};\nexport const VIEW_TAG_MAX = ${vtm};\n` +
        'let n = 0;\nexport function uid(p = "id") { return p + "_g" + ++n + "_" + Math.random().toString(36).slice(2, 8); }\n' +
        rest("types", ["BUILTIN_SLOT_ZH", "builtinSlotZh", "CARD_SIZE", "MAX_CARD_VIEWS", "VIEW_TAG_MAX", "uid"]).map((x) => `export const ${x} = null;\n`).join(""),
    );
    fs.writeFileSync(path.join(tmp, "lingui.mjs"), [...stubNames.lingui].map((x) => `export const ${x} = (s, ...v) => String.raw({ raw: s }, ...v);\n`).join(""));
    fs.writeFileSync(
      path.join(tmp, "client.mjs"),
      [...stubNames.client]
        .map((x) => {
          const verb = /^api(Get|Post|Put|Patch|Delete)$/.exec(x)?.[1]?.toUpperCase();
          if (!verb) return `export const ${x} = null;\n`;
          return verb === "GET"
            ? `export const ${x} = (p, o) => globalThis.__slotIdsApi("GET", p, undefined, o);\n`
            : `export const ${x} = (p, b) => globalThis.__slotIdsApi(${show(verb)}, p, b);\n`;
        })
        .join(""),
    );
    fs.writeFileSync(path.join(tmp, "videos.mjs"), [...stubNames.videos].map((x) => (x === "remoteOn" ? "export const remoteOn = () => true;\n" : `export const ${x} = null;\n`)).join(""));
    const TARGET = { types: "../types.ts", lingui: "../lingui.mjs", client: "../client.mjs", videos: "../videos.mjs", sid: U(modPath), promptSchemes: "./promptSchemes.ts", schemes: "./schemes.ts" };
    const swap = (rel) => {
      let text = fs.readFileSync(path.join(root, rel), "utf8");
      for (const [spec, kind] of Object.entries(KNOWN[rel])) {
        for (const q of ['"', "'"]) text = text.split(`from ${q}${spec}${q}`).join(`from "${TARGET[kind]}"`);
      }
      return text;
    };
    let gen = 0;
    const boot = async () => {
      const dir = path.join(tmp, `i${++gen}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "promptSchemes.ts"), swap("src/data/promptSchemes.ts"));
      fs.writeFileSync(path.join(dir, "schemes.ts"), swap("src/api/schemes.ts"));
      fs.writeFileSync(path.join(dir, "schemeMarket.ts"), swap("src/data/schemeMarket.ts"));
      return { PS: await import(U(path.join(dir, "promptSchemes.ts"))), MK: await import(U(path.join(dir, "schemeMarket.ts"))) };
    };
    const store = new Map();
    const writes = [];
    /** 假 localStorage 的配额（字数，按 key + value 算）。world() 恢复成不限 */
    let quota = Infinity;
    const used = () => [...store].reduce((k, [a, b]) => k + a.length + b.length, 0);
    const sizeOf = (k) => (store.has(k) ? k.length + store.get(k).length : 0);
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        const val = String(v);
        if (used() - sizeOf(k) + k.length + val.length > quota) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
        writes.push(k);
        store.set(k, val);
      },
      removeItem: (k) => {
        writes.push(k);
        store.delete(k);
      },
    };
    /** 假服务端：推上去 = 覆盖那一行（strip 掉 id、trim），装 = 回那一行（author 照那一行写的）。failPush / losePush 只管下一次推送 */
    const world = (seed) => {
      store.clear();
      writes.length = 0;
      quota = Infinity;
      if (seed) store.set(LIB, JSON.stringify(seed));
      const rows = new Map();
      const trim = (x) => (typeof x === "string" ? x.trim() : "");
      const slotOut = (s) => ({ tag: trim(s.tag), role: s.role, prompt: trim(s.prompt), ...(s.ref ? { ref: s.ref } : {}), ...(trim(s.size) ? { size: trim(s.size) } : {}), ...(s.fromCrop ? { fromCrop: true } : {}) });
      const payload = (id, r) => ({ schemeId: id, title: r.title, intro: r.intro ?? "", faceless: false, author: r.author, slots: r.slots.map((x) => ({ ...x })), examples: [], published: !!r.published });
      let pushMode = null;
      globalThis.__slotIdsApi = async (method, p, b) => {
        const m = /^\/api\/branch\/schemes(?:\/([^/]+))?(?:\/(publish|install))?$/.exec(p);
        const id = m?.[1] && decodeURIComponent(m[1]);
        if (m && method === "POST" && !id) {
          const mode = pushMode;
          pushMode = null;
          if (mode === "fail") throw new Error("网络断了");
          rows.set(b.schemeId, { ...rows.get(b.schemeId), title: b.title, intro: b.intro, author: "我", slots: b.slots.map(slotOut) });
          if (mode === "lost") throw new Error("推上去了，回包没收到");
          return { ok: true, scheme: payload(b.schemeId, rows.get(b.schemeId)) };
        }
        const r = id && rows.get(id);
        if (r && m[2] === "publish") {
          r.published = method === "POST";
          return { ok: true, scheme: payload(id, r) };
        }
        if (r && m[2] === "install" && method === "POST") return { ok: true, alreadyInstalled: true, scheme: payload(id, r) };
        throw new Error(`假服务端没有这一条：${method} ${p}`);
      };
      return { rows, slotOut, failPush: () => (pushMode = "fail"), losePush: () => (pushMode = "lost") };
    };
    /** 冷启动两次：一个字节都不许写、方案库原文不许动、两次算出的 id 相同、读得出的方案一套不少 */
    const cold = async (what, wantSchemes) => {
      const raw = store.get(LIB);
      writes.length = 0;
      const a = await boot();
      const b = await boot();
      const ids = (x) => show(x.PS.mineSchemes().map((s) => s.slots.map((sl) => sl.id)));
      check(writes.length === 0, `${what}：冷启动写了 localStorage ${show(writes)}（启动时一个字节都不许落）`);
      check(store.get(LIB) === raw, `${what}：冷启动改了方案库原文`);
      check(ids(a) === ids(b), `${what}：两次冷启动算出的 id 不一样 ${ids(a)} / ${ids(b)}`);
      check(b.PS.mineSchemes().length === wantSchemes, `${what}：冷启动读出 ${b.PS.mineSchemes().length} 套方案，应当是 ${wantSchemes} 套（load 抛了被吞成空库？）`);
      return b;
    };
    const editAt = (PS, id, k, f) => {
      const cur = PS.schemeOf(id);
      return PS.saveScheme({ id, title: cur.title, intro: cur.intro, faceless: false, slots: cur.slots.map((s, i) => (i === k ? f({ ...s }) : { ...s })) }, cur.slots);
    };
    const edit0 = (PS, id, f) => editAt(PS, id, 0, f);
    const EDITS = { "换了 role（C1）": (s) => ({ ...s, role: "aux" }), "名字和正文一起改了（C2）": (s) => ({ ...s, tag: "正脸", prompt: "p9" }) };
    /**
     * 发布用的三格：普通全身、脸部（ref: face）、原片裁剪（fromCrop）。
     * ★ 复核第 6 轮：原先只有 tag / role / prompt —— noteServerSlots 少记 ref / fromCrop，S 步对任何带这两位的方案（内置方案的副本全都带）永远对不上，门禁照过
     */
    const FIX = () => {
      const a = S.freshSlotId([]);
      const b = S.freshSlotId([a]);
      const c = S.freshSlotId([a, b]);
      return [
        { id: a, tag: "正面", role: "primary", prompt: "p1" },
        { id: b, tag: "脸", role: "face", prompt: "f1", ref: "face" },
        { id: c, tag: "原片", role: "display", prompt: "", fromCrop: true },
      ];
    };
    const LEGACY_SLOTS = [
      { tag: "正面", role: "primary", prompt: "p1" },
      { tag: "脸", role: "face", prompt: "f1", ref: "face" },
      { tag: "原片", role: "display", prompt: "", fromCrop: true },
    ];
    /** 装回来之后，没动过的第 2、3 格 id 不许变 */
    const sameRest = (what, PS, id, ids0) => {
      for (const k of [1, 2]) {
        const now = PS.schemeOf(id)?.slots[k]?.id;
        check(now === ids0[k], `${what}：没动过的第 ${k + 1} 格 id 变了（${show(ids0[k])} → ${show(now)}）`);
      }
    };

    // 1) 这个 App 里发布的：发布 → 改 → 重启 → 在改过的格子上传照片 →「已装 · 用它」/ 删掉再装回来 → 重做一遍改动
    for (const [edit, f] of Object.entries(EDITS)) {
      for (const via of ["「已装 · 用它」", "删掉再装回来"]) {
        const what = `发布 → 本机${edit} → 重启 → 传照片 → ${via}`;
        world();
        let { PS, MK } = await boot();
        const v0 = PS.saveScheme({ title: "我的立绘", intro: "", faceless: false, slots: FIX() }, null);
        check(await MK.shareScheme(v0.id, true), `${what}：发布没成 ${MK.schemeMarketErr()}`);
        edit0(PS, v0.id, f);
        // 再存一次只改标题的（常见）：已经有记录的不许被这一次盖成改过的那一版
        PS.saveScheme({ ...PS.schemeOf(v0.id), title: "我的立绘 2" }, PS.schemeOf(v0.id).slots);
        ({ PS, MK } = await cold(`${what}（重启）`, 1));
        const ids0 = PS.schemeOf(v0.id).slots.map((s) => s.id);
        if (via === "删掉再装回来") PS.removeScheme(v0.id);
        check(!!(await MK.installSharedScheme(v0.id)), `${what}：装不回来 ${MK.schemeMarketErr()}`);
        sameRest(what, PS, v0.id, ids0);
        edit0(PS, v0.id, f);
        const redo = PS.schemeOf(v0.id).slots[0].id;
        check(redo === ids0[0], `${what} → 重做改动：那一格回不到传照片时的 id ${show(ids0[0])}（现在是 ${show(redo)}），照片从此够不着`);
        await cold(`${what}（之后再重启）`, 1);
      }
    }

    // 2) 这个 App 更新之前发布 / 装来的（没有记录）：改 → 重启 → 传照片 →「已装 · 用它」→ 重做一遍改动（seedServerSlots）
    for (const [kind, extra] of [["更新前发布过的", { published: true }], ["更新前装来的", { author: "别人", published: false }]]) {
      for (const [edit, f] of Object.entries(EDITS)) {
        const what = `${kind}老方案 → 本机${edit} → 重启 → 传照片 →「已装 · 用它」`;
        const legacy = { id: "ps_legacy", title: "老方案", intro: "", ...extra, slots: LEGACY_SLOTS };
        const srv = world([legacy]);
        srv.rows.set("ps_legacy", { title: legacy.title, intro: "", author: "我", published: true, slots: legacy.slots.map(srv.slotOut) });
        let { PS, MK } = await cold(`${what}（开机）`, 1);
        edit0(PS, "ps_legacy", f);
        ({ PS, MK } = await cold(`${what}（重启）`, 1));
        const ids0 = PS.schemeOf("ps_legacy").slots.map((s) => s.id);
        check(!!(await MK.installSharedScheme("ps_legacy")), `${what}：装不回来 ${MK.schemeMarketErr()}`);
        sameRest(what, PS, "ps_legacy", ids0);
        edit0(PS, "ps_legacy", f);
        const redo = PS.schemeOf("ps_legacy").slots[0].id;
        check(redo === ids0[0], `${what} → 重做改动：那一格回不到传照片时的 id ${show(ids0[0])}（现在是 ${show(redo)}），照片从此够不着`);
      }
    }

    // 3) 从来没推上去过的本机方案：改、删都不写记录（占配额，还会把删掉的方案留在设备上）
    {
      world([{ id: "ps_local", title: "本机的", intro: "", slots: [{ tag: "正面", role: "primary", prompt: "p1" }] }]);
      const { PS } = await cold("本机自建、没发布过的老方案（开机）", 1);
      edit0(PS, "ps_local", (s) => ({ ...s, tag: "侧面" }));
      PS.removeScheme("ps_local");
      check(!writes.includes(REC), "没发布过、也不是装来的方案，改 / 删的时候写了「服务端那一版」记录");
    }

    // 4) 推上去没成：不写记录（写了会盖掉上一份对的记录）
    {
      const srv = world();
      const { PS, MK } = await boot();
      const v0 = PS.saveScheme({ title: "T", intro: "", faceless: false, slots: [{ id: S.freshSlotId([]), tag: "正面", role: "primary", prompt: "p1" }] }, null);
      srv.failPush();
      writes.length = 0;
      check(!(await MK.shareScheme(v0.id, true)), "推送失败时 shareScheme 应当回 false");
      check(!writes.includes(REC), "推上去没成也写了「服务端那一版」记录（会盖掉上一份对的记录）");
    }

    // 5) 发布之后删掉一格、再加一格同名同 role 的（编辑屏没有上移 / 下移，挪位置就是这么挪），在新格子上传照片 →「已装 · 用它」/ 删掉再装回来
    //   （复核第 6 轮：S 步先于 A、B，记录把被删那格的 id 给了服务端这一格，新格子的 id 在哪一套里都没有了；删掉再装回来还得有删掉那一刻的本机那份）
    for (const via of ["「已装 · 用它」", "删掉再装回来"]) {
      for (const restart of [false, true]) {
        const what = `发布 → 删掉「正面」、再加一格同名同 role 的${restart ? " → 重启" : ""} → 在新格子上传照片 → ${via}`;
        world();
        let { PS, MK } = await boot();
        const v0 = PS.saveScheme({ title: "我的立绘", intro: "", faceless: false, slots: FIX() }, null);
        check(await MK.shareScheme(v0.id, true), `${what}：发布没成 ${MK.schemeMarketErr()}`);
        const cur = PS.schemeOf(v0.id);
        const kept = cur.slots.slice(1).map((s) => ({ ...s }));
        PS.saveScheme({ id: v0.id, title: cur.title, intro: cur.intro, faceless: false, slots: [...kept, { id: S.freshSlotId(kept.map((s) => s.id)), tag: "正面", role: "primary", prompt: "p2" }] }, cur.slots);
        if (restart) ({ PS, MK } = await cold(`${what}（重启）`, 1));
        const photo = PS.schemeOf(v0.id).slots.find((s) => s.tag === "正面")?.id;
        if (via === "删掉再装回来") PS.removeScheme(v0.id);
        check(!!(await MK.installSharedScheme(v0.id)), `${what}：装不回来 ${MK.schemeMarketErr()}`);
        const after = PS.schemeOf(v0.id)?.slots.find((s) => s.tag === "正面")?.id;
        check(after === photo, `${what}：新格子上传的照片看不见了（「正面」那一格的 id ${show(photo)} → ${show(after)}）`);
      }
    }

    // 6) 记录对不上服务端那一行（推上去了、回包没收到）：本机换过 role 的那一格按原 role 认回原 id（V 步，复核第 6 轮）
    {
      const what = "发布 → 改第 2 格名字再发布（推上去了、回包没收到）→ 第 1 格换 role → 重启 → 传照片 →「已装 · 用它」→ 重做换 role";
      const srv = world();
      let { PS, MK } = await boot();
      const v0 = PS.saveScheme({ title: "我的立绘", intro: "", faceless: false, slots: FIX() }, null);
      check(await MK.shareScheme(v0.id, true), `${what}：发布没成 ${MK.schemeMarketErr()}`);
      editAt(PS, v0.id, 1, (s) => ({ ...s, tag: "面部" }));
      srv.losePush();
      check(!(await MK.shareScheme(v0.id, true)), `${what}：回包没收到时 shareScheme 应当回 false`);
      edit0(PS, v0.id, EDITS["换了 role（C1）"]);
      ({ PS, MK } = await cold(`${what}（重启）`, 1));
      const photo = PS.schemeOf(v0.id).slots[0].id;
      check(!!(await MK.installSharedScheme(v0.id)), `${what}：装不回来 ${MK.schemeMarketErr()}`);
      edit0(PS, v0.id, EDITS["换了 role（C1）"]);
      const redo = PS.schemeOf(v0.id).slots[0].id;
      check(redo === photo, `${what}：那一格回不到传照片时的 id ${show(photo)}（现在是 ${show(redo)}），照片从此够不着`);
    }

    // 7) 记录表本身：超过上限从最久没写过的删起、同一套再记一次挪到最新；存坏了不许让保存 / 装回来 / 删掉抛（复核第 6 轮：这几样改坏了原先都照过）
    {
      world();
      const { PS } = await boot();
      const cap = Number(/const SERVER_SLOTS_MAX = (\d+);/.exec(fs.readFileSync(path.join(root, "src/data/promptSchemes.ts"), "utf8"))?.[1]);
      if (cap >= 2) {
        const one = [{ id: "slot_rec", tag: "正面", role: "primary", prompt: "p1" }];
        for (let k = 0; k < cap; k++) PS.noteServerSlots(`ps_rec${k}`, one);
        PS.noteServerSlots("ps_rec0", one);
        PS.noteServerSlots(`ps_rec${cap}`, one);
        let keys = [];
        try {
          keys = JSON.parse(store.get(REC) ?? "[]").map((e) => e[0]);
        } catch {
          /* 下面几条会报 */
        }
        check(keys.length === cap, `记录表：记了 ${cap + 1} 套，落盘的应当正好 ${cap} 套，got ${keys.length}（上限没生效）`);
        check(!keys.includes("ps_rec1"), "记录表：超出上限时应当删掉最久没写过的那一套（ps_rec1），它还在");
        check(keys.includes(`ps_rec${cap}`), "记录表：超出上限时把刚记的那一套删了（删成了最新的）");
        check(keys.includes("ps_rec0"), "记录表：同一套再记一次应当挪到最新，它却被当成最久没写过的删了");
      }
    }
    {
      const srv = world([{ id: "ps_bad", title: "坏记录", intro: "", published: true, slots: LEGACY_SLOTS }]);
      srv.rows.set("ps_bad", { title: "坏记录", intro: "", author: "我", published: true, slots: LEGACY_SLOTS.map(srv.slotOut) });
      store.set(REC, "{bad json");
      const { PS, MK } = await cold("记录存坏了（开机）", 1);
      try {
        edit0(PS, "ps_bad", (s) => ({ ...s, tag: "侧面" }));
        check(!!(await MK.installSharedScheme("ps_bad")), `记录存坏了：装不回来 ${MK.schemeMarketErr()}`);
        PS.removeScheme("ps_bad");
      } catch (e) {
        check(false, `记录存坏了：保存 / 装回来 / 删掉抛了 ${e?.message ?? e}（记录只是少认回几格 id，不许让方案库那几步失败）`);
      }
    }

    // 8) 配额只剩一点：方案库先落盘、记录后写（复核第 6 轮：先写记录会占掉最后那点空间，persist 吞掉配额错误，这一次改动重启就没了）
    //   配额 = 这一次之前用掉的 + 方案库与记录各自要长的那一截里大的那个 + 小的那个的一半：只放得下其中一样，先写谁谁赢
    {
      const OTHER = [
        { tag: "脸", role: "face", prompt: "q".repeat(120), ref: "face" },
        { tag: "身", role: "primary", prompt: "r".repeat(120) },
      ];
      const OLD = { id: "ps_quota", title: "老方案", intro: "", published: true, slots: [{ tag: "正面", role: "primary", prompt: "p".repeat(120) }] };
      const INTRO = "改过的简介".repeat(12);
      const OPS = [
        [
          "装一套别人的方案（upsertMine 记回包）",
          () => world().rows.set("ps_other", { title: "别人的", intro: "", author: "别人", published: true, slots: OTHER }),
          async (W) => void (await W.MK.installSharedScheme("ps_other")),
          (PS) => !!PS.schemeOf("ps_other"),
        ],
        [
          "改一套更新之前发布过的方案（saveScheme 补记）",
          () => world([OLD]),
          async (W) => {
            const cur = W.PS.schemeOf("ps_quota");
            W.PS.saveScheme({ id: "ps_quota", title: cur.title, intro: INTRO, faceless: false, slots: cur.slots.map((s) => ({ ...s })) }, cur.slots);
          },
          (PS) => PS.schemeOf("ps_quota")?.intro === INTRO,
        ],
      ];
      for (const [what, setup, op, ok] of OPS) {
        setup();
        let W = await boot();
        const lib0 = sizeOf(LIB);
        const rec0 = sizeOf(REC);
        await op(W);
        const dLib = sizeOf(LIB) - lib0;
        const dRec = sizeOf(REC) - rec0;
        if (!(dLib >= 20 && dRec >= 20)) {
          check(false, `配额（${what}）：量出来方案库长了 ${dLib}、记录长了 ${dRec}，造不出「只放得下一样」的配额（改了用例就同步改这里）`);
          continue;
        }
        setup();
        W = await boot();
        quota = used() + Math.max(dLib, dRec) + Math.floor(Math.min(dLib, dRec) / 2);
        await op(W);
        quota = Infinity;
        const after = await cold(`配额只剩一点时${what}（重启）`, 1);
        check(ok(after.PS), `配额只剩一点时${what}：重启之后这一次改动没了（先写了记录、占掉了最后那点空间，方案库那一下写失败）`);
      }
    }
  } catch (e) {
    fail(e instanceof HarnessError ? `（g）搭不起来：${e.message}` : `（g）跑真模块的时候抛了：${e?.stack ?? e}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (problems.length) {
  console.error(`\n❌ 方案图位 id 检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  const gProblems = problems.filter((p) => p.startsWith("（g）"));
  if (problems.length > gProblems.length) console.error("\n   改法：规则只改 src/data/schemeSlotIds.ts；内置图位的 id 与中文原名一个字都别动（存量方案与卡片靠它们认）。");
  if (gProblems.length) {
    console.error(
      "\n   （g）那几条是拿真的 promptSchemes / api/schemes / schemeMarket 跑出来的：「搭不起来」「跑真模块的时候抛了」多半是门禁自己的桩没跟上" +
        "（新 import、新导出名、默认导入）—— 改 scripts/check-slot-ids.mjs 的（g）；其余是真行为，照着那一条改那三个文件（接线）或 src/data/schemeSlotIds.ts（规则）。",
    );
  }
  console.error("");
  process.exit(1);
}
console.log(`✓ 方案图位 id 检查通过（${cases.length} 组对齐 + 幂等 + 序列 + 坏形状 + freshSlotId + 内置七个图位 + 接线 + 真模块）`);
