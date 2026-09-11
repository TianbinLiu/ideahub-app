#!/usr/bin/env node
// 构建门禁：运镜 chips 的词表与插 / 摘 / 认（src/studio/cameraVocab.ts）正反例实跑（多语言 PR1，2026-09-11）。
//
// ★★ 为什么要有它：chip 插进去的是**随提示词发给模型的字**，中英两套还都得始终认得出、摘得掉，而判错全是零报错的 ——
//   英文短语里混进 "cg" 会让组稿去铸 3D 建模（economy.STYLE_3D_RE，全 app 最贵的单次操作）；混进引号会被
//   segmentGen.hasDialogue 当成台词；被画布指挥本地档（agentGrammar.isAttrText）认成改设置就白拒一次；
//   摘不干净则 chip 一直亮着、再点一下又插一遍；摘多了则悄悄改掉用户的字（换行、省略号、缩写的点）。
// ★ 规则**一条都不在这里重打**：cameraVocab 与 agentGrammar 直接 import（Node 24 只剥类型）；STYLE_3D_RE 与 hasDialogue
//   所在的文件不是零依赖的，就从源文件里把正则字面量抠出来用 —— 重打一遍就是同一条规则的第二处实现
//   （CLAUDE.md「把正则写成字符串常量」那格）。
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先造真违规试红。上线前逐条试过，每一条都各自变红：
//   ① 把 en 的 static camera 改成 cg static camera（STYLE_3D_RE 命中）；② 删掉摘除的「紧跟前一句的句末」那一步
//   （句中那句摘完剩「。。」）；③ 「摘」的正则去掉 g（三处重复只摘掉两处 —— 只有两处重复的用例测不出来，所以钉的是三处）；
//   ④ 去掉开头露出来的分隔符那一下清理（「，镜头缓缓推近，男孩奔跑」剩「，男孩奔跑」）；
//   ⑤ 开头清理改回连句点一起清（「static camera, .NET logo spins」剩「NET logo spins」）；⑥ 用「，」还是「, 」改回只看最后
//   一个字符（「他说“你好”」接出半角逗号）；⑦ 去掉「!?！？」另起一句（接出「!,」）；⑧ 句首改回捕获组（吃掉前一句的句号）；
//   ⑨ 摘除吃的空白改回 `\s`（连换行一起吃，「男孩奔跑。镜头缓缓推近⏎女孩回头」两行并成「男孩奔跑。女孩回头」）；
//   ⑩ 短语自己的那个标点不再排除连串的点（「镜头缓缓推近...男孩奔跑」剩「..男孩奔跑」）；
//   ⑪ 英文界面插入改回削掉结尾的「.」（「He lives in the U.S.」接出「U.S, slow push-in」）；
//   ⑫ 中文界面插入削尾巴时漏掉空白（「男孩奔跑 ⏎」接出「男孩奔跑 ⏎，镜头缓缓推近」）；⑬ 去掉 `text.trim()` 那道
//   （全空白的原文接出「，镜头缓缓推近」）；⑭ 中文界面削尾巴多削一个「、」（与 main 不再逐字节相同）；
//   ⑮ 「碰到开头」的判据 `at <= lead` 改成 `<`（「镜头缓缓推近，，男孩奔跑」剩「，男孩奔跑」）；⑯ 全角字母不再算中文
//   （「ＯＫ」接出半角逗号）；⑰ 分隔符里去掉「、」（「男孩奔跑、镜头缓缓推近、女孩回头」剩「、、」）；
//   ⑱ 句末里去掉「!?！？」（「男孩奔跑！镜头缓缓推近！女孩回头」剩「！！」）；⑲ 短语自己的标点里去掉「!?！？」
//   （「A boy runs. Slow push-in! A girl turns.」剩「. !」）；⑳ 摘除末尾补回无条件清结尾的空白与分隔符（「男孩奔跑，镜头缓缓推近，女孩回头⏎」
//   剩「男孩奔跑，女孩回头」）；㉑ 改成「摘除碰到结尾才清」（「男孩奔跑，镜头缓缓推近，」剩「男孩奔跑」，用户刚敲的「，」没了）；
//   ㉒ 开头清理改回 `^[\s，,;；、]*`（「镜头缓缓推近⏎  男孩奔跑⏎  女孩回头」第一条丢了缩进）；㉓ 英文短语前面改回只看字母
//   （「non-static camera」点亮固定）；㉔ 后面改回只看字母（「static camera-work」点亮固定）；㉕ 英文词间隔改回 `[\s-]+`
//   （「Pacing: slow⏎Push-in on the ring」点亮推近）。
//
// 用法：node scripts/check-camera-vocab.mjs [--module=<另一份 cameraVocab.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/studio/cameraVocab.ts"));
const V = await import(url.pathToFileURL(modPath).href);
const G = await import(url.pathToFileURL(path.join(root, "src/studio/agentGrammar.ts")).href);

const problems = [];
const fail = (msg) => problems.push(msg);
const show = (v) => JSON.stringify(v);

// ── (a) 形状：零运行时依赖（Node 能直接 import 它的前提）──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`cameraVocab.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`cameraVocab.ts:${i + 1}  不许引 @lingui：短语是发给模型的数据，不是界面文案`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`cameraVocab.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型，跑不了它们）`);
});

// ── (b) 数据：id 不重复；zh 与上线以来插进去的原句逐字相同；en 只收小写 ASCII；每一句只认成它自己 ──
const SHIPPED_ZH = ["镜头缓缓推近", "镜头缓缓拉远", "环绕运镜", "跟拍运镜", "镜头向左平移", "镜头向右平移", "俯拍视角", "仰拍视角", "手持晃动感", "固定镜头"];
const moves = V.CAMERA_MOVES;
const ids = moves.map((m) => m.id);
if (new Set(ids).size !== ids.length) fail(`CAMERA_MOVES 的 id 有重复：${ids.join(",")}`);
if (show(moves.map((m) => m.zh)) !== show(SHIPPED_ZH)) {
  fail(`zh 短语与 2026-08-29 上线以来的原句对不上（老草稿 / 做同款 / 已发布作品的 plot 里躺着的是原句，改了就认不出、摘不掉）：\n      want ${show(SHIPPED_ZH)}\n      got  ${show(moves.map((m) => m.zh))}`);
}
for (const m of moves) {
  if (!/^[a-z]+(?:[ -][a-z]+)*$/.test(m.en)) fail(`en 短语只准小写 ASCII 词（空格 / 连字符隔开），不带引号：${m.id} ${show(m.en)}`);
  for (const [lang, phrase] of [["zh", m.zh], ["en", m.en]]) {
    const got = V.activeMoves(phrase);
    if (show(got) !== show([m.id])) fail(`activeMoves(${show(phrase)})：want ${show([m.id])}，got ${show(got)}（一句只许认成它自己那个运镜）`);
    if (V.movePhrase(m.id, lang) !== phrase) fail(`movePhrase(${m.id}, ${lang})：want ${show(phrase)}，got ${show(V.movePhrase(m.id, lang))}`);
  }
}

// ── (c) 英文短语不许撞上别处的判据（判据从源文件抠，不重打）──
const literalFrom = (file, re, what) => {
  const m = re.exec(fs.readFileSync(path.join(root, file), "utf8"));
  if (!m) {
    fail(`${file}：抠不出 ${what} 的正则字面量（那边改了写法，就同步改这里的抠法）`);
    return null;
  }
  const cut = m[1].lastIndexOf("/");
  return new RegExp(m[1].slice(1, cut), m[1].slice(cut + 1).replace(/[gy]/g, ""));
};
const STYLE_3D_RE = literalFrom("src/data/economy.ts", /const STYLE_3D_RE = (\/.*\/[a-z]*);/, "STYLE_3D_RE");
const DIALOGUE_RE = literalFrom(
  "src/studio/segmentGen.ts",
  /export function hasDialogue\(plot: string\): boolean \{\s*return (\/.*\/)\.test\(plot\);/,
  "hasDialogue",
);
for (const m of moves) {
  // 句末是「. ! ? :」等时插进去的是首字母大写的那一种（insertMove），两种写法都要过这三道
  const upper = m.en.charAt(0).toUpperCase() + m.en.slice(1);
  for (const form of [m.en, upper]) {
    if (STYLE_3D_RE?.test(form)) fail(`en 短语 ${show(form)} 命中 economy.STYLE_3D_RE：插进剧情会让组稿去铸 3D 建模（全 app 最贵的单次操作）`);
    if (DIALOGUE_RE?.test(form)) fail(`en 短语 ${show(form)} 命中 segmentGen.hasDialogue：会被当成台词`);
    for (const before of ["", "a boy runs, ", "男孩奔跑，", "第2段 ", "A boy runs! ", "A boy runs. ", "男孩奔跑！"]) {
      if (G.isAttrText(before + form)) fail(`agentGrammar.isAttrText(${show(before + form)}) 为真：画布指挥本地档会把它当成改设置、白拒一次`);
    }
  }
}

// ── (d) 插入 ──
const insertCases = [
  ["zh", "", "镜头缓缓推近"],
  ["zh", "男孩奔跑。", "男孩奔跑，镜头缓缓推近"],
  // ★ 中文界面与 main 逐字节相同：出片输入不许因为多语言而变 —— 下面几条连怪样子一起钉
  ["zh", "A boy runs.", "A boy runs.，镜头缓缓推近"],
  ["zh", "男孩奔跑！", "男孩奔跑！，镜头缓缓推近"], // 英文界面「!?」另起一句那条规则不许漏到中文界面
  ["zh", "男孩奔跑：", "男孩奔跑：，镜头缓缓推近"], // 冒号同上
  ["zh", "男孩奔跑 \n", "男孩奔跑，镜头缓缓推近"], // 尾巴上的空白与换行照削
  ["zh", "   ", "镜头缓缓推近"], // 全空白按空文本算
  ["zh", "男孩奔跑、", "男孩奔跑、，镜头缓缓推近"], // 只削「，。」与空白，「、」不削
  ["en", "", "slow push-in"],
  ["en", "男孩奔跑。", "男孩奔跑，slow push-in"], // 单独一个「。」只可能是句号：照中文界面换成「，」
  ["en", "男孩奔跑。 ", "男孩奔跑，slow push-in"],
  ["en", "A boy runs;", "A boy runs, slow push-in"], // 分隔符削掉、接我们自己的
  // 用「，」还是「, 」看最后一个字母数字，不看最后一个字符：中文输入法的收尾引号 / 省略号 / 破折号都不在 CJK 符号区里
  ["en", "他说“你好”", "他说“你好”，slow push-in"],
  ["en", "男孩奔跑……", "男孩奔跑……，slow push-in"],
  ["en", "男孩奔跑——", "男孩奔跑——，slow push-in"],
  ["en", "He said “hi”", "He said “hi”, slow push-in"],
  ["en", "A boy runs…", "A boy runs…, slow push-in"],
  ["en", "ＯＫ", "ＯＫ，slow push-in"], // 全角字母按中文算
  // 句末标点是用户的字：不删、不接逗号，另起一句。半角「.」也不削 —— 它同时是缩写 / 缩略语 / 省略号的一部分
  ["en", "A boy runs!", "A boy runs! Slow push-in"],
  ["en", "男孩奔跑！", "男孩奔跑！Slow push-in"],
  ["en", "A boy runs.", "A boy runs. Slow push-in"],
  ["en", "A boy runs. ", "A boy runs. Slow push-in"],
  ["en", "The boy hesitates...", "The boy hesitates... Slow push-in"],
  ["en", "He lives in the U.S.", "He lives in the U.S. Slow push-in"],
  ["en", "Made by Acme Inc.", "Made by Acme Inc. Slow push-in"],
  ["en", "A boy runs:", "A boy runs: Slow push-in"],
  ["en", "男孩犹豫。。。", "男孩犹豫。。。Slow push-in"],
];
for (const [lang, text, want] of insertCases) {
  const got = V.insertMove(text, "pushIn", lang);
  if (got !== want) fail(`insertMove(${show(text)}, pushIn, ${lang})：want ${show(want)}，got ${show(got)}`);
}

// ── (e) 认 ──
const recogCases = [
  ["Slow Push-In", ["pushIn"]],
  ["slow push in", ["pushIn"]],
  ["high angle shot", ["highAngle"]],
  ["an ecstatic camera operator", []],
  ["prestatic camera", []],
  ["static cameras", []],
  ["男孩奔跑，镜头缓缓推近，slow push-in", ["pushIn"]], // 中英两种写法只算一个（上限按 id 数）
  // 连字符紧挨着的算这个词的一部分：意思正相反的「non-static」、复合词都不是这句运镜（误认会占掉 3 个名额里的一个）
  ["A dynamic, non-static camera follows the boy.", []],
  ["A semi-static camera watches the crowd.", []],
  ["A boy runs, static camera-work throughout.", []],
  ["super-slow push-in", []],
  ["A dynamic, non-static camera, slow push-in, orbiting camera", ["pushIn", "orbit"]],
  // 单独的连字符（列表项）照认；词与词之间的连字符照认
  ["- static camera", ["static"]],
  ["-static camera", ["static"]],
  ["slow-push-in", ["pushIn"]],
  // 一句运镜不跨行：「slow」在上一行、「Push-in」在下一行不是推近
  ["Pacing: slow\nPush-in on the ring", []],
];
for (const [text, want] of recogCases) {
  const got = V.activeMoves(text);
  if (show(got) !== show(want)) fail(`activeMoves(${show(text)})：want ${show(want)}，got ${show(got)}`);
}

// ── (f) 摘 ──
const removeCases = [
  ["pushIn", "男孩奔跑，镜头缓缓推近", "男孩奔跑"],
  ["pushIn", "男孩奔跑。镜头缓缓推近", "男孩奔跑。"],
  ["pushIn", "男孩奔跑。镜头缓缓推近。女孩回头", "男孩奔跑。女孩回头"],
  ["pushIn", "镜头缓缓推近，男孩奔跑", "男孩奔跑"],
  ["pushIn", "男孩奔跑，镜头缓缓推近，slow push-in", "男孩奔跑"],
  ["pushIn", "男孩奔跑，镜头缓缓推近，镜头缓缓推近", "男孩奔跑"],
  ["pushIn", "A boy runs, Slow Push-In", "A boy runs"],
  ["pushIn", "A boy runs, slow push in.", "A boy runs."],
  ["pushIn", "slow push-in, a boy runs", "a boy runs"],
  ["pushIn", "A boy runs. Slow push-in. A girl turns.", "A boy runs. A girl turns."],
  ["static", "an ecstatic camera operator, static camera", "an ecstatic camera operator"],
  ["pushIn", "男孩奔跑、镜头缓缓推近", "男孩奔跑"],
  ["pushIn", "男孩奔跑、镜头缓缓推近、女孩回头", "男孩奔跑、女孩回头"],
  ["pushIn", "镜头缓缓推近", ""],
  ["pushIn", "男孩奔跑。镜头缓缓推近 女孩回头", "男孩奔跑。女孩回头"],
  // 每一处都摘：三处才钉得住 g（两处的话 ① 摘一处、⑤ 摘一处，去掉 g 照样过）
  ["pushIn", "男孩奔跑，镜头缓缓推近，镜头缓缓推近，镜头缓缓推近", "男孩奔跑"],
  ["pushIn", "A boy runs, slow push-in, slow push-in, slow push-in", "A boy runs"],
  // 同一句连着两句：「紧跟句末」那一步必须是向后看（捕获组 + "$1" 的写法第二处认不出句首，剩「。。」）
  ["pushIn", "男孩奔跑。镜头缓缓推近。镜头缓缓推近。女孩回头", "男孩奔跑。女孩回头"],
  ["pushIn", "A boy runs. Slow push-in. Slow push-in. A girl turns.", "A boy runs. A girl turns."],
  // 句末与短语自己的标点都认「!?！？」
  ["pushIn", "男孩奔跑！镜头缓缓推近！女孩回头", "男孩奔跑！女孩回头"],
  ["pushIn", "A boy runs. Slow push-in! A girl turns.", "A boy runs. A girl turns."],
  // 开头：摘除露出来的分隔符要清，用户自己本来就有的不许动
  ["pushIn", "，镜头缓缓推近，男孩奔跑", "男孩奔跑"],
  ["pushIn", "镜头缓缓推近，，男孩奔跑", "男孩奔跑"],
  ["static", ".NET logo spins, static camera", ".NET logo spins"],
  ["pushIn", "...然后男孩奔跑，镜头缓缓推近", "...然后男孩奔跑"],
  ["pushIn", "  男孩奔跑，镜头缓缓推近", "  男孩奔跑"],
  ["pushIn", "、男孩奔跑，镜头缓缓推近", "、男孩奔跑"],
  ["pushIn", "  镜头缓缓推近，男孩奔跑", "  男孩奔跑"],
  ["pushIn", "  镜头缓缓推近。男孩奔跑", "  男孩奔跑"],
  // 开头：短语后面紧跟的是用户自己的点（省略号 / .NET / .5），一个都不许吃
  ["pushIn", "镜头缓缓推近，...然后男孩奔跑", "...然后男孩奔跑"],
  ["pushIn", "镜头缓缓推近。。。然后男孩奔跑", "。。。然后男孩奔跑"],
  ["pushIn", "镜头缓缓推近...男孩奔跑", "...男孩奔跑"],
  ["pushIn", "镜头缓缓推近。.NET 标志旋转", ".NET 标志旋转"],
  ["static", "static camera, .NET logo spins", ".NET logo spins"],
  ["static", "static camera. .NET logo spins", ".NET logo spins"],
  ["pushIn", "Slow push-in. ...and the boy runs", "...and the boy runs"],
  ["pushIn", "slow push-in ...and the boy runs", "...and the boy runs"],
  ["pushIn", "slow push-in .5 seconds later", ".5 seconds later"],
  ["pushIn", "镜头缓缓推近\n\n...男孩奔跑", "...男孩奔跑"],
  // 换行是用户的分行：摘完不许把两行并成一行
  ["pushIn", "A boy runs! Slow push-in\nA girl turns.", "A boy runs!\nA girl turns."], // 英文界面只靠点 chip + 打字就走得到
  ["pushIn", "男孩奔跑。镜头缓缓推近\n女孩回头", "男孩奔跑。\n女孩回头"],
  ["pushIn", "第1段。镜头缓缓推近\n第2段。固定镜头", "第1段。\n第2段。固定镜头"],
  ["pushIn", "1. 男孩奔跑\n2. 镜头缓缓推近\n3. 女孩回头", "1. 男孩奔跑\n2.\n3. 女孩回头"],
  ["static", "A boy runs. Static camera.\n\nA girl turns.", "A boy runs.\n\nA girl turns."],
  ["pushIn", "男孩奔跑，镜头缓缓推近\n女孩回头", "男孩奔跑\n女孩回头"],
  ["pushIn", "男孩奔跑，\n镜头缓缓推近，女孩回头", "男孩奔跑，\n女孩回头"],
  // 独占一行的连这一行一起摘，不留空行
  ["pushIn", "男孩奔跑\n镜头缓缓推近\n女孩回头", "男孩奔跑\n女孩回头"],
  ["pushIn", "男孩奔跑。\n镜头缓缓推近\n女孩回头", "男孩奔跑。\n女孩回头"],
  ["pushIn", "镜头缓缓推近\n女孩回头", "女孩回头"],
  // 英文界面另起一句插进去的样子，摘得回来
  ["pushIn", "A boy runs! Slow push-in", "A boy runs!"],
  ["pushIn", "男孩奔跑！Slow push-in", "男孩奔跑！"],
  ["pushIn", "男孩奔跑：Slow push-in", "男孩奔跑："],
  ["static", "A boy runs: Static camera, a girl turns.", "A boy runs: a girl turns."],
  // 别的运镜不受牵连
  ["pushIn", "男孩奔跑，固定镜头，镜头缓缓推近", "男孩奔跑，固定镜头"],
  ["pushIn", "A boy runs, static camera, slow push-in", "A boy runs, static camera"],
  // 结尾一个字都不清：短语在句中 / 开头时，用户结尾的换行、空行、分隔符、空格原样留着
  ["pushIn", "男孩奔跑，镜头缓缓推近，女孩回头\n", "男孩奔跑，女孩回头\n"],
  ["pushIn", "男孩奔跑，镜头缓缓推近，女孩回头；", "男孩奔跑，女孩回头；"],
  ["pushIn", "镜头缓缓推近，男孩奔跑，", "男孩奔跑，"],
  ["pushIn", "第1段：男孩奔跑，镜头缓缓推近\n第2段：女孩回头\n\n", "第1段：男孩奔跑\n第2段：女孩回头\n\n"],
  ["static", "Static camera. A boy runs ", "A boy runs "], // 空格没了的话接着打字就粘成「runsand」
  ["pushIn", "A boy runs, slow push-in, a girl ", "A boy runs, a girl "],
  ["static", "固定镜头，男孩奔跑，镜头缓缓推近，女孩 ", "男孩奔跑，镜头缓缓推近，女孩 "],
  // 短语在结尾、后面是用户刚敲的字（点亮 → 接着敲 → 点灭）：那几个字也原样留着，与 main 逐字节相同
  // （「摘除碰到结尾才清」的写法在这几条上照样吃字）
  ["pushIn", "男孩奔跑，镜头缓缓推近，", "男孩奔跑，"],
  ["pushIn", "男孩奔跑，镜头缓缓推近\n", "男孩奔跑\n"],
  ["pushIn", "A boy runs, slow push-in ", "A boy runs "],
  ["pushIn", "A boy runs. Slow push-in ", "A boy runs. "],
  // 独占一行的连这一行自己的换行一起摘，别的换行不碰；手打在结尾的留一个换行（多留不是改字）
  ["pushIn", "男孩奔跑\n镜头缓缓推近\n", "男孩奔跑\n"],
  ["pushIn", "男孩奔跑\n镜头缓缓推近", "男孩奔跑\n"],
  // 运镜独占第一行：摘掉这一行，下一行的缩进原样留着
  ["pushIn", "镜头缓缓推近\n  男孩奔跑\n  女孩回头", "  男孩奔跑\n  女孩回头"],
  ["static", "固定镜头\n    - 男孩奔跑\n    - 女孩回头", "    - 男孩奔跑\n    - 女孩回头"],
  ["pushIn", "镜头缓缓推近，\n  男孩奔跑", "  男孩奔跑"],
  ["pushIn", "镜头缓缓推近\n\n  男孩奔跑", "  男孩奔跑"],
  ["pushIn", "Slow push-in\n  - a boy runs\n  - a girl turns", "  - a boy runs\n  - a girl turns"],
  // 连字符复合词与跨行的不是这句运镜：只摘真的那一处
  ["static", "A boy runs, static camera-work, static camera", "A boy runs, static camera-work"],
  ["static", "A dynamic, non-static camera, static camera", "A dynamic, non-static camera"],
  ["pushIn", "Pacing: slow\nPush-in on the ring, slow push-in", "Pacing: slow\nPush-in on the ring"],
];
for (const [id, text, want] of removeCases) {
  const got = V.removeMove(text, id);
  if (got !== want) fail(`removeMove(${show(text)}, ${id})：want ${show(want)}，got ${show(got)}`);
  if (V.activeMoves(got).includes(id)) fail(`removeMove(${show(text)}, ${id}) 之后 chip 还亮着：${show(got)}`);
}

// ── (g) 往返：插完再摘 = 原文去掉**插入时削掉的**尾巴，其余逐字节回来（两种界面语言削的不一样，逐条写明）──
//   中文界面插入只削「，。」与空白（与 main 相同），所以用户自己结尾的「、;,」点灭后原样回来；
//   英文界面插入削的是空白与分隔符（EN_TAIL_SEP）和单独一个「。」。摘除自己一个字都不削（removeMove 的 ★★）。
const roundTrips = [
  // [原文, 中文界面插完再摘, 英文界面插完再摘]
  ["", "", ""],
  ["男孩奔跑", "男孩奔跑", "男孩奔跑"],
  ["男孩奔跑。", "男孩奔跑", "男孩奔跑"],
  ["男孩奔跑，", "男孩奔跑", "男孩奔跑"],
  ["男孩奔跑、", "男孩奔跑、", "男孩奔跑"],
  ["A boy runs;", "A boy runs;", "A boy runs"],
  ["男孩奔跑。女孩回头！", "男孩奔跑。女孩回头！", "男孩奔跑。女孩回头！"],
  ["男孩犹豫。。。", "男孩犹豫", "男孩犹豫。。。"],
  ["男孩奔跑\n女孩回头", "男孩奔跑\n女孩回头", "男孩奔跑\n女孩回头"],
  ["A boy runs", "A boy runs", "A boy runs"],
  ["A boy runs.", "A boy runs.", "A boy runs."],
  ["A boy runs, ", "A boy runs,", "A boy runs"], // 中文界面插入只削掉空格、半角逗号留着 —— 点灭照样还回来（与 main 相同）
  ["A boy runs!", "A boy runs!", "A boy runs!"],
  ["A boy runs?", "A boy runs?", "A boy runs?"],
  ["A boy runs:", "A boy runs:", "A boy runs:"],
  ["A boy runs!\nA girl turns.", "A boy runs!\nA girl turns.", "A boy runs!\nA girl turns."],
  ["The boy hesitates...", "The boy hesitates...", "The boy hesitates..."],
  ["He lives in the U.S.", "He lives in the U.S.", "He lives in the U.S."],
  ["Made by Acme Inc.", "Made by Acme Inc.", "Made by Acme Inc."],
  ["他说“你好”", "他说“你好”", "他说“你好”"],
  ["男孩奔跑……", "男孩奔跑……", "男孩奔跑……"],
  ["...然后男孩奔跑", "...然后男孩奔跑", "...然后男孩奔跑"],
  [".NET logo spins", ".NET logo spins", ".NET logo spins"],
  ["  男孩奔跑", "  男孩奔跑", "  男孩奔跑"],
];
for (const [text, wantZh, wantEn] of roundTrips) {
  for (const id of ids) {
    if (V.activeMoves(text).includes(id)) continue;
    for (const [lang, want] of [["zh", wantZh], ["en", wantEn]]) {
      const ins = V.insertMove(text, id, lang);
      if (!V.activeMoves(ins).includes(id)) fail(`insertMove(${show(text)}, ${id}, ${lang}) 之后 chip 没亮：${show(ins)}`);
      const back = V.removeMove(ins, id);
      if (back !== want) fail(`往返 ${lang} ${id}：${show(text)} → ${show(ins)} → ${show(back)}，want ${show(want)}`);
    }
  }
}

if (problems.length) {
  console.error(`\n❌ 运镜词表检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/studio/cameraVocab.ts；zh 短语一个字节都别动（存量文本靠它认得出、摘得掉）。\n");
  process.exit(1);
}
console.log(
  `✓ 运镜词表检查通过（${moves.length} 个运镜 × 中英两套 + ${insertCases.length} 条插入 + ${recogCases.length} 条认法 + ${removeCases.length} 条摘除 + ${roundTrips.length} 组往返）`,
);
