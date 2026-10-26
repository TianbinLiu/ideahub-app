#!/usr/bin/env node
// 构建门禁：Live2D 上传向导第 ⑤ 步「动没动」的判定（src/data/live2dMotionCheck.ts）正反例实跑（2026-10-26，upload-verify-honest）。
//
// ★★ 为什么要有它：那一列 ✓ / ⚠ 判错的两个方向都零报错 —— 放松一格 = 哑动作（曲线全写给模型里没有的参数）又被打上 ✓，
//   作者照着一列绿勾把它发布出去；收紧一格 = 每个真动作都标「看不出变化」，人很快学会无视它。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖）。
// ★ 这里只钉「判定」那一半；「采样」那一半（挂 beforeModelUpdate、按真实下标读、归一化、扣呼吸）在 companionModel.probeParams，
//   要真的 Cubism 运行时才跑得起来 —— 阈值是在浏览器里拿官方看板娘量的，量法与数值写在 live2dMotionCheck 的常量旁边。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面七条各自变红：
//   ① 去掉 MOVE_K（只比绝对下限）；② 不看 skip；③ 视线动过时不跳过头部角度；④ 帧数不够也下结论；
//   ⑤ judgeOwn 对「模型里没有这个参数」回 moved；⑥ 不看 idleFixed（待机没钉住也照常比）；⑦ 基线没量成也回 unknown（不分 noBase）；
//   ⑧ mergeProbes 只留第一遍（不取更宽的那一份）。
//
// 用法：node scripts/check-live2d-motion-check.mjs [--module=<另一份 live2dMotionCheck.ts 的路径，造违规试红用>]
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const M = await import(url.pathToFileURL(path.resolve(modArg ?? path.join(root, "src/data/live2dMotionCheck.ts"))).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

/**
 * 造一份采样：swings[i] = 第 i 个下标在窗口里的起伏（min 取 0.4，max = 0.4 + 起伏），其余格默认。
 * 下标 0 = 头左右、1 = 头上下（gaze）、2 = 嘴、3 = 左眼、4 = 眉毛、5 = 物理输出（skip）、6 = 一个 Part
 */
const N = 7;
function probe(swings = {}, extra = {}) {
  const min = Array(N).fill(0.4);
  const max = min.map((v, i) => v + (swings[i] ?? 0));
  return { frames: 150, min, max, skip: [2, 3, 5], gaze: [0, 1], gazed: false, mouth: 2, eye: 3, idleFixed: true, ...extra };
}
const idle = probe({ 0: 0.08, 1: 0.05, 5: 0.3 }); // 待机：头轻轻晃，物理输出被风吹着晃得更多

// ── judgeMotion：真动作 / 哑动作 ──
eq("待机本身（同样的起伏）= 看不出变化", M.judgeMotion(idle, probe({ 0: 0.08, 1: 0.05 })), "still");
eq("哑动作：模型停住（起伏比待机还小）", M.judgeMotion(idle, probe({ 0: 0.01 })), "still");
eq("点头：头上下起伏 0.5（待机 0.05）", M.judgeMotion(idle, probe({ 1: 0.5 })), "moved");
eq("表情：眉毛从 0 到 0.3（待机里不动）", M.judgeMotion(idle, probe({ 4: 0.3 })), "moved");
eq("Part 不透明度从 0 到 1（pose 切换 / 动作切补片）", M.judgeMotion(idle, probe({ 6: 1 })), "moved");
eq("起伏只比待机大一点点（1.2 倍）= 看不出变化", M.judgeMotion(idle, probe({ 0: 0.08 * 1.2 })), "still");
eq("起伏是待机的 2 倍 = 动了", M.judgeMotion(idle, probe({ 0: 0.16 })), "moved");
eq("待机里完全不动的参数：起伏低于绝对下限 = 看不出变化", M.judgeMotion(idle, probe({ 4: M.MOVE_ABS * 0.8 })), "still");
eq("待机里完全不动的参数：起伏超过绝对下限 = 动了", M.judgeMotion(idle, probe({ 4: M.MOVE_ABS * 1.5 })), "moved");

// ── 不看的下标 ──
eq("只有物理输出在晃（风）= 看不出变化", M.judgeMotion(idle, probe({ 5: 0.9 })), "still");
eq("只有嘴在动（我们自己写的口型）= 看不出变化", M.judgeMotion(idle, probe({ 2: 0.5 })), "still");
eq("基线那一份的 skip 也算", M.judgeMotion({ ...idle, skip: [2, 3, 5, 4] }, probe({ 4: 0.5 })), "still");
eq("窗口里有人碰过视线：头部角度的起伏不算", M.judgeMotion(idle, probe({ 0: 0.5 }, { gazed: true })), "still");
eq("基线那几秒有人碰过视线：头部角度一样不算", M.judgeMotion({ ...idle, gazed: true }, probe({ 0: 0.5 })), "still");
eq("视线动过、但眉毛真动了 = 动了", M.judgeMotion(idle, probe({ 0: 0.5, 4: 0.3 }, { gazed: true })), "moved");

// ── 没量到 ──
eq("这一项帧太少（页面在后台）= 没量到", M.judgeMotion(idle, probe({ 1: 0.5 }, { frames: M.PROBE_MIN_FRAMES - 1 })), "unknown");
eq("基线帧太少 = 基线没量成（与这一项没量到分开说）", M.judgeMotion({ ...idle, frames: 0 }, probe({ 1: 0.5 })), "noBase");
eq("帧数正好够 = 照常判", M.judgeMotion(idle, probe({ 1: 0.5 }, { frames: M.PROBE_MIN_FRAMES })), "moved");
eq("没有基线 = 基线没量成", M.judgeMotion(null, probe({ 1: 0.5 })), "noBase");
eq("基线、这一项都没量到 = 先说基线", M.judgeMotion(null, null), "noBase");
eq("没有采样 = 没量到", M.judgeMotion(idle, null), "unknown");

// ── 待机没钉住（companionModel.pinIdleForProbe 的 ★★：随机换了一段待机，起伏没法与基线比）──
eq("这一项的窗口里待机没钉住：起伏再大也不说动了 = 没量到", M.judgeMotion(idle, probe({ 1: 0.9 }, { idleFixed: false })), "unknown");
eq("这一项的窗口里待机没钉住：不动也不说看不出变化 = 没量到", M.judgeMotion(idle, probe({}, { idleFixed: false })), "unknown");
eq("基线那几秒待机没钉住 = 基线没量成", M.judgeMotion({ ...idle, idleFixed: false }, probe({ 1: 0.9 })), "noBase");
eq("idleFixed 缺这一格（不是 true）= 不当真", M.judgeMotion(idle, { ...probe({ 1: 0.9 }), idleFixed: undefined }), "unknown");
eq("probeUsable：帧够、钉住了 = 能用", M.probeUsable(probe()), true);
eq("probeUsable：没钉住 = 不能用", M.probeUsable(probe({}, { idleFixed: false })), false);
eq("probeUsable：null = 不能用", M.probeUsable(null), false);
eq("中途换了模型（参数个数对不上）= 没量到", M.judgeMotion(idle, { ...probe({ 1: 0.5 }), min: [0.4], max: [0.9] }), "unknown");

// ── mergeProbes：基线量两遍合起来 ──
{
  const a = probe({ 0: 0.08 }, { frames: 120 });
  const b = { ...probe({ 0: 0.08 }, { frames: 130 }), min: probe().min.map((v, i) => (i === 0 ? 0.35 : v)) }; // 第二遍采到了更低的谷
  const m = M.mergeProbes(a, b);
  eq("合起来：帧数相加", m?.frames, 250);
  eq("合起来：每个下标取更宽的那一份（谷来自第二遍、峰来自第一遍）", [m?.min[0], m?.max[0]].map((v) => +v.toFixed(3)), [0.35, 0.48]);
  eq("合起来：比原来那一份宽的基线，同一个起伏就不再算动了", [M.judgeMotion(a, probe({ 0: 0.13 })), M.judgeMotion(m, probe({ 0: 0.13 }))], ["moved", "still"]);
  eq("合起来：skip 取并集", M.mergeProbes(probe(), probe({}, { skip: [4] }))?.skip.includes(4), true);
  eq("合起来：视线任一遍动过就算", M.mergeProbes(probe(), probe({}, { gazed: true }))?.gazed, true);
  eq("合起来：任一遍待机没钉住，整份不当真", M.probeUsable(M.mergeProbes(probe(), probe({}, { idleFixed: false }))), false);
  eq("合起来：缺一遍 = 基线没量成", M.mergeProbes(probe(), null), null);
  eq("合起来：两遍不是同一个模型 = 基线没量成", M.mergeProbes(probe(), { ...probe(), min: [0.4], max: [0.9] }), null);
}

// ── judgeOwn：嘴 / 眼 ──
eq("说话：嘴起伏 0.47 = 动了", M.judgeOwn(probe({ 2: 0.47 }), "mouth"), "moved");
eq("说话：嘴几乎不动（被动作曲线盖掉）= 看不出变化", M.judgeOwn(probe({ 2: 0.05 }), "mouth"), "still");
eq("说话：模型里没有口型参数 = 看不出变化", M.judgeOwn(probe({ 2: 0.47 }, { mouth: -1 }), "mouth"), "still");
eq("眨眼：眼睛 1 → 0 = 动了", M.judgeOwn(probe({ 3: 1 }), "eye"), "moved");
eq("眨眼：量程 0~2 的眼睛闭一次（归一化 0.5）= 动了", M.judgeOwn(probe({ 3: 0.5 }), "eye"), "moved");
eq("眨眼：模型里没有眼睛参数 = 看不出变化", M.judgeOwn(probe({ 3: 1 }, { eye: -1 }), "eye"), "still");
eq("眨眼：帧太少 = 没量到", M.judgeOwn(probe({ 3: 1 }, { frames: 2 }), "eye"), "unknown");
eq("没有采样 = 没量到", M.judgeOwn(null, "mouth"), "unknown");
eq("嘴 / 眼只看自己那个参数，待机钉没钉住都照常判", M.judgeOwn(probe({ 2: 0.47 }, { idleFixed: false }), "mouth"), "moved");

if (problems.length) {
  console.error(`✗ check-live2d-motion-check：${problems.length}/${ran} 条没过（src/data/live2dMotionCheck.ts）`);
  for (const p of problems) console.error("  · " + p);
  process.exit(1);
}
console.log(`✓ check-live2d-motion-check：${ran} 条正反例全过`);
