#!/usr/bin/env node
// 构建门禁：「特效同款」预设库（src/data/effectPresets.ts）正反例实跑（2026-10-05 第一批 G）。
//
// ★★ 为什么要有它：预设写错了全都零报错 ——
//   · 占位符写错（人物预设里写成 {P}、两人预设漏了 {B}）：提示词里出现「这件产品」或者第二个人凭空消失，图照画、钱照收；
//   · 动作那句写成「镜头1：…镜头2：…」：会被当成多镜头（shotScript.isMultiShot），出片规则悄悄换掉；
//   · 关键帧里写了镜头运动：出图模型画不出「运动」，只会把它理解成构图的一部分，画得很怪；
//   · 不靠换场景就不成立的预设标了 realOk：真人档拿照片起拍，预设的那个场景根本不会出现。
//   规则一条都不在这里重打：直接 import 那个模块（必须零运行时依赖）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。下面四条各自试过、各自变红：
//   ① 人物预设的动作里写成 {P}；② 两人预设的关键帧漏了 {B}；③ 一条动作写成「镜头1：…」；④ 一条要换场景的预设标了 realOk。
//
// 用法：node scripts/check-effect-presets.mjs [--module=<另一份 effectPresets.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/effectPresets.ts"));
const M = await import(url.pathToFileURL(modPath).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const ok = (what, cond) => {
  ran++;
  if (!cond) problems.push(what);
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`effectPresets.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const P = M.EFFECT_PRESETS;
const MULTI_SHOT = /镜头\s*[0-9一二三四五六七八九十]+\s*[：:]/;
const has = (s, tok) => s.includes(tok);

// (a) 清单本身
{
  const ids = P.map((p) => p.id);
  eq("预设 id 不重复", ids.length, new Set(ids).size);
  for (const p of P) {
    ok(`预设「${p.id}」的 id 要是小写短横线（存进草稿、做示例视频的文件名都用它）`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id));
    ok(`预设「${p.id}」的时长 ${p.sec} 不在 4~10 秒（每一档都夹得进来、也都不算长）`, Number.isInteger(p.sec) && p.sec >= 4 && p.sec <= 10);
    ok(`预设「${p.id}」的画幅不认识：${p.aspect}`, p.aspect === "portrait" || p.aspect === "landscape");
  }
  for (const s of ["person", "duo", "product"]) ok(`主角类型「${s}」一条预设都没有`, P.some((p) => p.subject === s));
}

// (b) 占位符与主角类型对得上
for (const p of P) {
  for (const [what, text] of [["关键帧", p.keyframe], ["动作", p.motion]]) {
    const A = has(text, "{A}");
    const B = has(text, "{B}");
    const Pr = has(text, "{P}");
    if (p.subject === "person") ok(`「${p.id}」${what}：一个人的预设要有 {A}、不能有 {B} / {P}`, A && !B && !Pr);
    if (p.subject === "duo") ok(`「${p.id}」${what}：两人的预设要同时有 {A} 和 {B}、不能有 {P}`, A && B && !Pr);
    if (p.subject === "product") ok(`「${p.id}」${what}：产品预设要有 {P}、不能有 {A} / {B}`, Pr && !A && !B);
    ok(`「${p.id}」${what}里有认不出的占位符`, !/\{(?![ABP]\})[^}]*\}/.test(text));
  }
}

// (c) 一句只做一件事：关键帧只写那一刻（不写镜头运动）；动作一镜到底（不写「镜头1：」）、不写台词
for (const p of P) {
  ok(`「${p.id}」关键帧里写了镜头运动（出图模型画不出运动）：${p.keyframe}`, !p.keyframe.includes("镜头"));
  ok(`「${p.id}」动作写成了分镜表（会被当成多镜头）：${p.motion}`, !MULTI_SHOT.test(p.motion));
  ok(`「${p.id}」动作里有引号台词（特效不配台词，出声的是环境音）`, !/[“”"「」]/.test(p.motion));
}

// (d) 长度：换上 8 个字的名字之后，两句都远在 1.x 档的 400 字上限之内（留给参考图点名句与系统兜底句）
{
  const names = { a: "名字八个字的主角", b: "名字八个字的对手", product: "八个字的一件产品" };
  for (const p of P) {
    const kf = M.effectKeyframe(p, names);
    const mo = M.effectMotion(p, names);
    ok(`「${p.id}」关键帧太长（${kf.length} 字）`, kf.length <= 160);
    ok(`「${p.id}」动作太长（${mo.length} 字）`, mo.length <= 160);
    ok(`「${p.id}」替换之后还剩占位符`, !/\{[ABP]\}/.test(kf + mo));
  }
}

// (e) 真人档：只留 realOk 的人物预设；realOk 只给不靠换场景也成立的那几条
{
  const real = M.effectsOn({ flat: true }).map((p) => p.id);
  const all = M.effectsOn({ flat: false }).map((p) => p.id);
  eq("别的档：全都能用", all, P.map((p) => p.id));
  eq("真人档：环绕 / 时间冻结 / 拉远（照片起拍也成立）", real, ["freeze", "orbit", "pullback"]);
  for (const p of P) if (p.realOk) ok(`「${p.id}」标了 realOk 但不是人物预设`, p.subject === "person");
}

// (f) 替换：名字按点选的先后进 {A}/{B}；名字里的花括号剥掉（叫「{B}」的人不能被当成第二个人）；没给名字有兜底
{
  const duo = M.effectById("faceoff");
  const out = M.effectMotion(duo, { a: "林夏", b: "沈舟" });
  ok("两人预设：{A} = 第一个点的人", out.indexOf("林夏") >= 0 && out.indexOf("林夏") < out.indexOf("沈舟"));
  const tricky = M.effectKeyframe(M.effectById("orbit"), { a: "{B}小明" });
  ok("名字里的花括号要剥掉", tricky.includes("B小明") && !tricky.includes("{"));
  ok("没给名字有兜底称呼", M.effectKeyframe(M.effectById("reveal"), {}).includes("这件产品"));
  eq("找不到的 id", M.effectById("nope"), null);
  eq("castCountOf：一个人 / 两个人 / 产品", [M.castCountOf({ subject: "person" }), M.castCountOf({ subject: "duo" }), M.castCountOf({ subject: "product" })], [1, 2, 0]);
}

if (problems.length) {
  console.error(`\n❌ 特效同款预设检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：预设只在 src/data/effectPresets.ts；两句话都是进模型的，改了要重跑付费样片。\n");
  process.exit(1);
}
console.log(`✓ 特效同款预设检查通过（${ran} 条：清单 / 占位符 / 一句一件事 / 长度 / 真人档 / 替换）`);
