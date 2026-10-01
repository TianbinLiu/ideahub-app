#!/usr/bin/env node
// 构建门禁：剪辑工程（src/data/cutProject.ts）的改法与校验实跑。
//
// ★★ 为什么要有它：剪辑页的时间轴从"几格 useState"收成了一份落盘的数据，裁 / 切 / 换序 / 删 / 还原、
//   合并留底与「回去改」、落盘读回来的校验都在那个纯模块里。它们错的方式是**零报错**的：
//     · 分割出来的一半回到整段 ⇒ 成片里同一截播两遍；
//     · 工程的指纹对不上却被当成对得上 ⇒ 上一条稿子的裁剪点落在这一条的片子上；
//     · 落盘读回一份坏工程不丢掉 ⇒ 剪辑页崩在某个 undefined 上，而它正是"上次被杀掉"才留下的。
//   而合并只能装机验（浏览器里没有原生合成器），所以这些规则至少要在构建里跑一遍。
// ★ **直接 import 模块本身**（Node 只剥类型），一条规则都不在这里重写 —— 重写一遍就是第二处实现。
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先造真违规试红。上线前试过四处，各自变红：
//   resetClip 去掉兄弟片段那道闸；projectFits 不比指纹；validateProject 放过 blob: 的本地配乐；
//   clipEnd 拿（可能还是申报值的）长度去截裁过的出点 —— 最后这条是写的时候真犯过的。
//
// 用法：node scripts/check-cut-project.mjs [--module=<另一份 cutProject.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/cutProject.ts"));
const C = await import(url.pathToFileURL(modPath).href);

const problems = [];
let ran = 0;
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  ran++;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) fail(`${label}：want ${w}，got ${g}`);
};

// ── 形状：零运行时依赖（Node 能直接 import 它的前提）──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`cutProject.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`cutProject.ts:${i + 1}  不许引 @lingui：这里只回原因代码，话由剪辑页说`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`cutProject.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型，跑不了它们）`);
});

// ── 夹具 ──
const segs3 = [
  { title: "第1段 · 开场", durationSec: 5, videoUrl: "https://cdn.example/a.mp4" },
  { title: "第2段 · 追逐", durationSec: 5, videoUrl: "https://cdn.example/b.mp4" },
  { title: "第3段 · 收尾", durationSec: 10, videoUrl: "https://cdn.example/c.mp4" },
];
const lens3 = [5, 5, 10];
let n = 0;
const mkId = () => `c${++n}`;
const fresh = () => {
  n = 0;
  return C.freshProject(segs3, true, mkId);
};
const must = (r, label) => {
  if (!r.ok) {
    fail(`${label}：本该成功，却回了 ${r.issue}`);
    return fresh();
  }
  return r.project;
};
const issueOf = (r) => (r.ok ? "ok" : r.issue);
const shape = (p) => p.clips.map((c) => `${c.segIndex}[${c.start}-${c.end ?? "尾"}]`).join(" ");

// ── 新开一份 ──
{
  const p = fresh();
  eq("freshProject 一段一个片段、整段都要", shape(p), "0[0-尾] 1[0-尾] 2[0-尾]");
  eq("freshProject 有预置音轨就挂上", p.audio, { kind: "preset", volume: 1 });
  eq("freshProject 没有预置时配乐是 null", C.freshProject(segs3, false, mkId).audio, null);
  eq("没动过的时间轴不算动过", C.timelineTouched(p, 3), false);
  eq("片尾跟着长度走（没学到实测时长之前按申报值）", C.clipEnd(p.clips[2], lens3), 10);
  eq("片尾跟着长度走（学到实测 20 秒之后）", C.clipEnd(p.clips[2], [5, 5, 20]), 20);
}

// ── 分割 ──
{
  const p = fresh();
  const s = must(C.splitClip(p, "c1", 2, "x1", lens3), "分割第 1 段");
  eq("分割：前一半到刀口、后一半从刀口到片尾", shape(s), "0[0-2] 0[2-尾] 1[0-尾] 2[0-尾]");
  eq("分割之后时间轴算动过", C.timelineTouched(s, 3), true);
  eq("分割点离入点太近", issueOf(C.splitClip(p, "c1", 0.2, "x", lens3)), "edge");
  eq("分割点离出点太近", issueOf(C.splitClip(p, "c1", 4.8, "x", lens3)), "edge");
  eq("分割一个不存在的片段", issueOf(C.splitClip(p, "nope", 2, "x", lens3)), "gone");
  eq("原来那份没被动过", shape(p), "0[0-尾] 1[0-尾] 2[0-尾]");
  // 再切后一半：它的出点仍然缺省
  const s2 = must(C.splitClip(s, "x1", 3.5, "x2", lens3), "再切后一半");
  eq("连切两刀", shape(s2), "0[0-2] 0[2-3.5] 0[3.5-尾] 1[0-尾] 2[0-尾]");
}

// ── 裁头裁尾与还原 ──
{
  const p = fresh();
  const a = must(C.trimClip(p, "c3", "start", 2, lens3), "裁头");
  eq("裁头", shape(a), "0[0-尾] 1[0-尾] 2[2-尾]");
  const b = must(C.trimClip(a, "c3", "end", 8, lens3), "裁尾");
  eq("裁尾", shape(b), "0[0-尾] 1[0-尾] 2[2-8]");
  eq("裁过的片段认得出来", C.clipTrimmed(b.clips[2]), true);
  eq("裁完的时长", C.clipDur(b.clips[2], lens3), 6);
  eq("裁到只剩不到下限", issueOf(C.trimClip(b, "c3", "end", 2.2, lens3)), "short");
  eq("入点裁到出点之后", issueOf(C.trimClip(b, "c3", "start", 7.9, lens3)), "short");
  const back = must(C.resetClip(b, "c3"), "还原整段");
  eq("还原整段", shape(back), "0[0-尾] 1[0-尾] 2[0-尾]");
  eq("还原之后不算动过", C.timelineTouched(back, 3), false);
  // 出点正好落在片尾 = 没裁尾巴，不留一个"等于片尾"的数
  const atEnd = must(C.trimClip(p, "c3", "end", 10, lens3), "出点落在片尾");
  eq("出点落在片尾时写回缺省", shape(atEnd), "0[0-尾] 1[0-尾] 2[0-尾]");
  // ★ 最要紧的一条：分割出来的一半不许回到整段（会与另一半重叠，成片里同一截播两遍）
  const sp = must(C.splitClip(p, "c1", 2, "x1", lens3), "分割");
  eq("分割出来的一半不许还原整段", issueOf(C.resetClip(sp, "c1")), "sibling");
  eq("另一半同样不许", issueOf(C.resetClip(sp, "x1")), "sibling");
  eq("hasSibling 认得出兄弟片段", C.hasSibling(sp, sp.clips[0]), true);
  // 删掉另一半之后就能还原了
  const alone = must(C.removeClip(sp, "x1"), "删掉另一半");
  eq("删掉另一半之后能还原", shape(must(C.resetClip(alone, "c1"), "还原")), "0[0-尾] 1[0-尾] 2[0-尾]");
  // ★ 裁过的出点不拿长度去截：真实时长量出来之前 lens 是申报值，申报 5 秒、实际 20 秒的白模段
  //   裁在第 8 秒的出点不许被截成 5（那样合出来只有 5 秒）
  eq("裁过的出点不被申报值截短", C.clipEnd(b.clips[2], [5, 5, 5]), 8);
  eq("时长也按裁的那个数算", C.clipDur(b.clips[2], [5, 5, 5]), 6);
}

// ── 删 / 换序 ──
{
  const p = fresh();
  const d = must(C.removeClip(p, "c2"), "删第 2 段");
  eq("删片段", shape(d), "0[0-尾] 2[0-尾]");
  eq("删过算动过", C.timelineTouched(d, 3), true);
  const one = must(C.removeClip(d, "c3"), "再删一个");
  eq("只剩一个片段时不许删", issueOf(C.removeClip(one, "c1")), "last");
  eq("后移", shape(must(C.moveClip(p, "c1", 1), "后移")), "1[0-尾] 0[0-尾] 2[0-尾]");
  eq("到头了原样返回（同一个引用）", must(C.moveClip(p, "c1", -1), "到头") === p, true);
  eq("拖拽：把第 3 个挪到第 1 个的位置", shape(must(C.reorderClip(p, "c3", "c1"), "拖拽")), "2[0-尾] 0[0-尾] 1[0-尾]");
  eq("换过序算动过", C.timelineTouched(must(C.moveClip(p, "c1", 1), "后移"), 3), true);
}

// ── 删掉的段加回来（不靠撤销的那条路）──
{
  const p = fresh();
  eq("一段都没删时没有缺的", C.missingSegs(p, 3), []);
  const d = must(C.removeClip(must(C.removeClip(p, "c1"), "删第 1 段"), "c2"), "删第 2 段");
  eq("删光了片段的段认得出来", C.missingSegs(d, 3), [0, 1]);
  const r1 = C.restoreSeg(d, 1, "r1");
  eq("加回第 2 段：插在段号比它大的片段前面", shape(r1), "1[0-尾] 2[0-尾]");
  const r0 = C.restoreSeg(r1, 0, "r0");
  eq("再加回第 1 段：回到原来的顺序", shape(r0), "0[0-尾] 1[0-尾] 2[0-尾]");
  eq("加回之后不算动过", C.timelineTouched(r0, 3), false);
  eq("已经在时间轴上的段不重复加", C.restoreSeg(r0, 1, "x") === r0, true);
  // 分割过的段只删了一半：不算缺
  const sp = must(C.removeClip(must(C.splitClip(fresh(), "c1", 2, "x1", lens3), "分割"), "x1"), "删后一半");
  eq("只删了一半的段不算缺", C.missingSegs(sp, 3), []);
  // 最后一段被删：加回来接在最后
  const tail = must(C.removeClip(fresh(), "c3"), "删最后一段");
  eq("最后一段加回来接在最后", shape(C.restoreSeg(tail, 2, "r")), "0[0-尾] 1[0-尾] 2[0-尾]");
}

// ── 圈选 / 配乐 / 档位 ──
{
  let p = fresh();
  p = C.addAnn(p, { id: "a1", segIndex: 0, atSec: 1, frame: "data:image/jpeg;base64,xx", req: "去掉路人" });
  p = C.addAnn(p, { id: "a2", segIndex: 2, atSec: 7, frame: "data:image/jpeg;base64,yy", req: "换成红伞" });
  eq("加圈选", p.anns.map((a) => a.id), ["a1", "a2"]);
  eq("重拍落地后清掉这一段的圈选", C.dropAnnsOfSeg(p, 2).anns.map((a) => a.id), ["a1"]);
  eq("这一段没有圈选时原样返回", C.dropAnnsOfSeg(p, 1) === p, true);
  eq("删一处圈选", C.removeAnn(p, "a1").anns.map((a) => a.id), ["a2"]);
  eq("音量夹在 0~1", C.setAudioVolume(p, 1.7).audio.volume, 1);
  eq("没有配乐时调音量不出错", C.setAudioVolume(C.setAudio(p, null), 0.5).audio, null);
  eq("换档位", C.setRes(p, "1080").resId, "1080");
  eq("档位没变时原样返回", C.setRes(p, "720") === p, true);
}

// ── 指纹：工程配不配得上稿子 ──
{
  const p = fresh();
  eq("自己那份稿子配得上", C.projectFits(p, segs3, false), true);
  // 圈选重拍 / 转存只换成片地址与帧：指纹不该变
  const regen = segs3.map((s) => ({ ...s, videoUrl: "https://cdn.example/new.mp4", firstFrame: "x" }));
  eq("换了成片地址仍然配得上", C.projectFits(p, regen, false), true);
  const other = [{ title: "第1段 · 另一条片子", durationSec: 5 }, segs3[1], segs3[2]];
  eq("换了一条稿子（段数相同）配不上", C.projectFits(p, other, false), false);
  eq("段数不同配不上", C.projectFits(p, segs3.slice(0, 2), false), false);
  eq("稿子合好了而工程没留底：配不上", C.projectFits(p, [{ title: "成片", durationSec: 20 }], true), false);
  const m = C.markMerged(p, segs3, undefined);
  eq("合并留底之后配得上合好的稿子", C.projectFits(m, [{ title: "成片", durationSec: 20 }], true), true);
  eq("带着留底的工程配不上没合的稿子", C.projectFits(m, segs3, false), false);
  const back = C.unmarkMerged(m);
  eq("回去改之后留底撤掉", "merged" in back, false);
  eq("回去改之后又配得上源段", C.projectFits(back, segs3, false), true);
  eq("没有留底时 unmarkMerged 原样返回", C.unmarkMerged(p) === p, true);
}

// ── 落盘读回来的校验 ──
{
  const p = must(C.trimClip(fresh(), "c3", "end", 8, lens3), "裁尾");
  const round = C.validateProject(JSON.parse(JSON.stringify(p)));
  eq("原样存、原样读", round, p);
  eq("不是对象", C.validateProject("x"), null);
  eq("版本不认识", C.validateProject({ ...p, v: 2 }), null);
  eq("片段表空了", C.validateProject({ ...p, clips: [] }), null);
  eq("片段的入点不是数", C.validateProject({ ...p, clips: [{ id: "c", segIndex: 0, start: "0" }] }), null);
  eq("出点不在入点之后", C.validateProject({ ...p, clips: [{ id: "c", segIndex: 0, start: 3, end: 3 }] }), null);
  eq("段号是负的", C.validateProject({ ...p, clips: [{ id: "c", segIndex: -1, start: 0 }] }), null);
  // 零件坏了只丢零件
  const badAnn = C.validateProject({ ...p, anns: [{ id: "a", segIndex: 0 }, { id: "b", segIndex: 0, atSec: 1, frame: "f", req: "r" }] });
  eq("坏的圈选丢掉、好的留着", badAnn.anns.map((a) => a.id), ["b"]);
  // ★ 会话内的 blob: 地址活不过重启：读回来留着它就是一条点了没声音的配乐
  const blobAudio = C.validateProject({ ...p, audio: { kind: "local", name: "a.mp3", ref: "blob:http://x/1", volume: 0.8 } });
  eq("blob: 的本地配乐读回来丢掉", blobAudio.audio, null);
  const idbAudio = C.validateProject({ ...p, audio: { kind: "local", name: "a.mp3", ref: "idb:cutbgm:bgm_x_y", volume: 0.8 } });
  eq("idb: 的本地配乐留着", idbAudio.audio, { kind: "local", name: "a.mp3", ref: "idb:cutbgm:bgm_x_y", volume: 0.8 });
  eq("留底里的源段坏了整份不要", C.validateProject({ ...p, merged: { sources: [{ title: 1 }] } }), null);
  eq("老工程没有档位时按 720", C.validateProject({ ...p, resId: undefined }).resId, "720");
}

// ── 量到真实长度之后的收拾 ──
{
  const p = must(C.trimClip(fresh(), "c3", "start", 7, lens3), "裁头到第 7 秒");
  eq("长度对得上时原样返回", C.sanitizeClips(p, lens3) === p, true);
  // ★ 没量过的那一格（undefined）一个片段都不动：拿申报值收拾会把裁好的片段当成越界的毁掉
  eq("没量过真实长度时一个都不动", C.sanitizeClips(p, [undefined, undefined, undefined]) === p, true);
  // 第 3 段重拍成 5 秒：入点 7 秒落到片尾之外
  eq("入点落到片尾之外的片段回到整段", shape(C.sanitizeClips(p, [5, 5, 5])), "0[0-尾] 1[0-尾] 2[0-尾]");
  // 它若是分割出来的一半：直接拿掉（回到整段会与另一半重叠）；另一半的出点（7）也在片尾之外，改回到片尾
  const sp = must(C.splitClip(fresh(), "c3", 7, "x1", lens3), "在第 7 秒分割");
  eq("落到片尾之外的那一半拿掉、另一半出点回到片尾", shape(C.sanitizeClips(sp, [5, 5, 5])), "0[0-尾] 1[0-尾] 2[0-尾]");
  // 只是出点越界：入点留着，出点改回"到片尾"
  const te = must(C.trimClip(must(C.trimClip(fresh(), "c3", "start", 2, lens3), "裁头"), "c3", "end", 8, lens3), "裁尾");
  eq("出点落到片尾之外时改回到片尾", shape(C.sanitizeClips(te, [5, 5, 6])), "0[0-尾] 1[0-尾] 2[2-尾]");
  eq("出点没越界时不动", C.sanitizeClips(te, [5, 5, 9]) === te, true);
}

// ── 交给合成器的那张表 ──
{
  const p = must(C.trimClip(must(C.removeClip(fresh(), "c2"), "删"), "c3", "end", 8, lens3), "裁");
  const tl = C.compileTimeline(p, segs3, lens3);
  eq("片段表：没裁尾巴的不带出点", tl, {
    ok: true,
    clips: [
      { url: "https://cdn.example/a.mp4", startSec: 0, segIndex: 0 },
      { url: "https://cdn.example/c.mp4", startSec: 0, endSec: 8, segIndex: 2 },
    ],
    total: 13,
  });
  const noVideo = [segs3[0], { ...segs3[1], videoUrl: "" }, segs3[2]];
  eq("有一段没出片", C.compileTimeline(fresh(), noVideo, lens3), { ok: false, issue: "no-video", segNo: 2 });
  const local = [segs3[0], segs3[1], { ...segs3[2], videoUrl: "idb:merged:mv_x_y" }];
  eq("混着一段本机成片", C.compileTimeline(fresh(), local, lens3), { ok: false, issue: "local-merged", segNo: 3 });
  const blob = [{ ...segs3[0], videoUrl: "blob:http://x/1" }, segs3[1], segs3[2]];
  eq("还不是永久地址", C.compileTimeline(fresh(), blob, lens3), { ok: false, issue: "not-permanent", segNo: 1 });
  // 稿子换成单段成片那一拍：指着不存在的段的片段直接略过，别崩
  eq("指着不存在的段的片段略过", C.compileTimeline(fresh(), [segs3[0]], lens3).clips.length, 1);
}

if (problems.length) {
  console.error(`\n❌ 剪辑工程检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/cutProject.ts；真要改预期，先想清楚成片会变成什么样（最贵的两种错：同一截播两遍、裁剪点落到另一条片子上）。\n");
  process.exit(1);
}
console.log(`✓ 剪辑工程检查通过（${ran} 条）`);
