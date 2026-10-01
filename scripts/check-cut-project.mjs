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
//   包装层（字幕 / 配音 / 变速 / 闪黑，2026-09-30）又试过九处，各自变红：改范围时把片段上挂的字幕变速丢掉；
//   分割把一句话留在两半上；有一段的长度没量过还照排闪黑；没量过的段把出点明说成申报值；配音不等上一句念完；
//   有配音的段原声不压低；`blob:` 的配音读回来留着；字幕的一行比安全宽度宽；把接着拍的接缝报成换场。
//   其中「一行超宽」第一遍没红（用例里没有"断在逗号后面就超宽"的句子），补了用例才红 —— 试红不是走过场。
//   一键成片与「对剪辑台说话」的落地（2026-10-01）又试过二十三处，各自变红。一键成片八处：转场落在任意接缝上；
//   同一个片段的第二句盖掉第一句；自动转场不封顶；转场开关关着还照改；空标题把原标题冲掉；演示档不按念得完的长度截；
//   不知道是不是换场的接缝报成换场；太长的一句被截成半句。落地十二处：编号按"现在的"时间轴认（先删片段 2 再说片段 3
//   就落到别人身上）；「只留 N 秒」把片段放长；长度没量过的片段照样按秒裁；裁 / 切不乘速度；撤销与别的改动混着办；
//   配音办不了还照排；一句话删光；没变也换一份工程（空撤销）；「慢一点」写死成绝对倍数；配好的重配；一句话写给所有片段。
//   「第 N 段」的两种读法又试两处：换过序还按位置认；同一段切成两半还认前一半。
//   配音修剪与真模型量过之后（2026-10-01）又试七处：起音前不留边；只认正的采样；WAV 头里每秒字节数写错；字母的折算退回 0.3；
//   标题按字符个数截；键重复的旁白不捞回来；清单的语言一律判成中文。
//   还有一处：配音还在配的时候，嘴说的那条路照样打开一键成片（界面上那颗入口这时是灰的）。
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
const F = { w: 720, h: 1280 };
const NONE = [undefined, undefined, undefined];
/** 片段表里"取哪一截"那几格（包装层的几格另有用例） */
const core = (c) => ({ url: c.url, startSec: c.startSec, ...(c.endSec !== undefined ? { endSec: c.endSec } : {}), segIndex: c.segIndex });
const r3 = (x) => Math.round(x * 1000) / 1000;
{
  // 没有配乐、没有任何包装：与包装层出现之前逐字相同 —— 没裁尾巴的不带出点（量没量过长度都一样）
  const bare = C.setAudio(must(C.trimClip(must(C.removeClip(fresh(), "c2"), "删"), "c3", "end", 8, lens3), "裁"), null);
  const want = [
    { url: "https://cdn.example/a.mp4", startSec: 0, segIndex: 0 },
    { url: "https://cdn.example/c.mp4", startSec: 0, endSec: 8, segIndex: 2 },
  ];
  const tl = C.compileTimeline(bare, segs3, lens3, NONE, F);
  eq("片段表：没裁尾巴的不带出点", tl.ok && tl.clips.map(core), want);
  eq("片段表：总长", tl.ok && tl.total, 13);
  eq("没有长在时间上的东西：量过长度也不明说出点", C.compileTimeline(bare, segs3, lens3, lens3, F).clips.map(core), want);
  eq("没有包装时每段原速、原声原样、不闪黑", tl.ok && tl.clips.map((c) => [c.speed, c.volume, c.fadeInSec, c.fadeOutSec]), [[1, 1, 0, 0], [1, 1, 0, 0]]);
  eq("每段在成片里的起点与时长", tl.ok && tl.clips.map((c) => [c.outStartSec, c.outDurSec]), [[0, 5], [5, 8]]);
  const noVideo = [segs3[0], { ...segs3[1], videoUrl: "" }, segs3[2]];
  eq("有一段没出片", C.compileTimeline(fresh(), noVideo, lens3, NONE, F), { ok: false, issue: "no-video", segNo: 2 });
  const local = [segs3[0], segs3[1], { ...segs3[2], videoUrl: "idb:merged:mv_x_y" }];
  eq("混着一段本机成片", C.compileTimeline(fresh(), local, lens3, NONE, F), { ok: false, issue: "local-merged", segNo: 3 });
  const blob = [{ ...segs3[0], videoUrl: "blob:http://x/1" }, segs3[1], segs3[2]];
  eq("还不是永久地址", C.compileTimeline(fresh(), blob, lens3, NONE, F), { ok: false, issue: "not-permanent", segNo: 1 });
  // 稿子换成单段成片那一拍：指着不存在的段的片段直接略过，别崩
  eq("指着不存在的段的片段略过", C.compileTimeline(fresh(), [segs3[0]], lens3, NONE, F).clips.length, 1);
  // ★ 有长在时间上的东西（这里是配乐）+ 长度量过：出点明说 —— 合成器按它定每一段多长，我们排字幕靠的是同一个数
  const timed = C.compileTimeline(fresh(), segs3, [5, 5, 20], [5, 5, 20], F);
  eq("有包装且量过长度：出点明说成量到的那个数", timed.ok && timed.clips.map((c) => c.endSec), [5, 5, 20]);
  // ★★ 没量过的那一段出点**不许**明说：明说成申报值会把实际更长的片子拦腰截断（申报 5 秒、实际 20 秒）
  const part = C.compileTimeline(fresh(), segs3, lens3, [5, undefined, 10], F);
  eq("没量过的那一段不明说出点", part.ok && part.clips.map((c) => c.endSec ?? null), [5, null, 10]);
}

// ── 包装层：变速 / 原声 / 闪黑 / 字幕 / 配音挂在片段上 ──
const voiceOf = (text, durSec, voiceId = "v1") => ({ ref: "idb:cutvoice:vo_x_y", durSec, voiceId, text });
const bareProj = () => C.setAudio(fresh(), null);
{
  let p = bareProj();
  p = must(C.setClipSpeed(p, "c3", 1.3), "变速");
  eq("变速就近取一档", p.clips[2].speed, 1.25);
  eq("变速之后在成片里占的长度", C.clipOutDur(p.clips[2], lens3), 8);
  eq("变速不改取的那一截", C.clipDur(p.clips[2], lens3), 10);
  eq("变速算动过（预置音轨会对不上）", C.timelineTouched(p, 3), true);
  eq("回到原速：这一格拿掉", "speed" in must(C.setClipSpeed(p, "c3", 1), "原速").clips[2], false);
  eq("速度没变时原样返回", must(C.setClipSpeed(p, "c3", 1.25), "同速") === p, true);
  eq("找不到片段", issueOf(C.setClipSpeed(p, "nope", 2)), "gone");

  p = must(C.setClipLine(p, "c3", "雨停了，她收起伞。"), "写字幕");
  p = must(C.setClipFade(p, "c3", true), "闪黑");
  p = must(C.setClipVolume(p, "c3", 0.6), "原声");
  // ★ 改范围的几条路都不许把包装层丢掉（原来它们手写 { id, segIndex, start }，片段上只有三格时没问题）
  const keeps = (q, label) => {
    const c = q.clips.find((x) => x.id === "c3");
    eq(`${label}：字幕 / 变速 / 原声 / 闪黑都还在`, [c.line?.text, c.speed, c.volume, c.fade], ["雨停了，她收起伞。", 1.25, 0.6, true]);
  };
  const trimmed = must(C.trimClip(must(C.trimClip(p, "c3", "start", 2, lens3), "裁头"), "c3", "end", 8, lens3), "裁尾");
  keeps(trimmed, "裁头裁尾");
  keeps(must(C.trimClip(trimmed, "c3", "end", 10, lens3), "出点回到片尾"), "出点回到片尾");
  keeps(must(C.resetClip(trimmed, "c3"), "还原"), "还原整段");
  keeps(C.sanitizeClips(trimmed, [5, 5, 6]), "量到更短的长度之后收拾");
  keeps(must(C.moveClip(p, "c3", -1), "前移"), "换序");
  // 分割：一句话留在前一半（配音不该念两遍），闪黑说的是开头、也留在前一半；变速与原声两半都带着
  const sp = must(C.splitClip(p, "c3", 5, "x3", lens3), "分割");
  const [a, b] = [sp.clips[2], sp.clips[3]];
  eq("分割：前一半留着字幕与闪黑", [a.line?.text, a.fade], ["雨停了，她收起伞。", true]);
  eq("分割：后一半没有字幕、不闪黑", ["line" in b, "fade" in b], [false, false]);
  eq("分割：两半都带着变速与原声", [a.speed, b.speed, a.volume, b.volume], [1.25, 1.25, 0.6, 0.6]);
}
{
  let p = must(C.setClipLine(bareProj(), "c1", "第一句"), "写字幕");
  eq("没配音、没动过滑杆：原声原样", C.clipVolume(p.clips[0]), 1);
  p = must(C.setClipVoice(p, "c1", voiceOf("第一句", 2)), "挂配音");
  eq("有配音、没动过滑杆：原声自动压低", C.clipVolume(p.clips[0]), C.BED_GAIN);
  eq("人定过音量就按人定的", C.clipVolume(must(C.setClipVolume(p, "c1", 0.9), "定音量").clips[0]), 0.9);
  eq("交回自动", C.clipVolume(must(C.setClipVolume(must(C.setClipVolume(p, "c1", 0.9), "定"), "c1", null), "交回").clips[0]), C.BED_GAIN);
  eq("配音与字对得上：不算过期", C.voiceStale(p.clips[0].line, "v1"), false);
  const edited = must(C.setClipLine(p, "c1", "第一句改了"), "改字");
  eq("改字不丢配音", edited.clips[0].line.voice?.durSec, 2);
  eq("改过字：配音过期", C.voiceStale(edited.clips[0].line, "v1"), true);
  eq("换了音色：配音过期", C.voiceStale(p.clips[0].line, "v2"), true);
  eq("字清空：这一句连配音一起去掉", "line" in must(C.setClipLine(p, "c1", ""), "清空").clips[0], false);
  eq("去掉配音、字留着", must(C.setClipVoice(p, "c1", null), "去配音").clips[0].line, { text: "第一句" });
  eq("没有字时挂不上配音", "line" in must(C.setClipVoice(bareProj(), "c1", voiceOf("x", 1)), "挂").clips[0], false);
  eq("一句话有上限", must(C.setClipLine(p, "c1", "字".repeat(500)), "超长").clips[0].line.text.length, C.LINE_MAX_CHARS);
  eq("念得完多长跟着时长走", [C.lineCap(5), C.lineCap(1), C.lineCap(60)], [24, 8, C.LINE_MAX]);
  // 长度按"念出来多久"算：汉字一个算 1、字母数字一个算 0.4（真的语音合成量出来的）、空格标点不算 ——
  // 按字符数封顶的话英文一段只写得下四五个词
  eq("汉字一个算一个、标点不算", C.lineUnits("雨停了，她收起伞。"), 7);
  eq("英文按字母折算（27 个字母 × 0.4）", Math.round(C.lineUnits("He decides to deliver it himself.") * 10) / 10, 10.8);
  eq("6 秒的片段写得下一句十几个词的英文", Math.ceil(C.lineUnits("In the rain, a courier finds a letter with no address.")) <= C.lineCap(6), true);
  // 工程级的那几格
  let q = C.setTitle(p, "雨夜霓虹");
  q = C.setCaptionsOn(q, false);
  q = C.setVoiceId(q, "zh_female_x");
  q = C.setEndFade(q, true);
  eq("标题 / 不烧字幕 / 音色 / 片尾淡出", [q.title, q.capOff, q.voiceId, q.endFade], ["雨夜霓虹", true, "zh_female_x", true]);
  eq("标题清空：这一格拿掉", "title" in C.setTitle(q, ""), false);
  eq("字幕开回来：这一格拿掉", "capOff" in C.setCaptionsOn(q, true), false);
  eq("没变时原样返回", [C.setTitle(q, "雨夜霓虹") === q, C.setCaptionsOn(q, false) === q, C.setEndFade(q, true) === q, C.setVoiceId(q, "zh_female_x") === q], [true, true, true, true]);
  // 落盘读回来
  const full = must(C.setClipFade(must(C.setClipSpeed(q, "c2", 2), "变速"), "c2", true), "闪黑");
  eq("带着包装层原样存、原样读", C.validateProject(JSON.parse(JSON.stringify(full))), full);
  const dirty = JSON.parse(JSON.stringify(full));
  dirty.clips[1].speed = 3; // 不在档位里
  dirty.clips[0].line.voice.ref = "blob:http://x/1"; // 活不过重启
  dirty.clips[2].line = { text: "   " }; // 只有空白
  dirty.voiceId = "bad id!";
  const back = C.validateProject(dirty);
  eq("不认识的速度丢掉、片段留着", ["speed" in back.clips[1], back.clips[1].fade], [false, true]);
  eq("blob: 的配音丢掉、字留着", back.clips[0].line, { text: "第一句" });
  eq("只有空白的字幕不要", "line" in back.clips[2], false);
  eq("不成形的音色 id 不要", "voiceId" in back, false);
}

// ── 接缝是不是同一个镜头在延续（该不该加转场）──
{
  const p = bareProj();
  const carried = [{}, { carried: true }, { carried: false }];
  eq("第一个片段前面没有接缝", C.seamContinuous(p, 0, carried), false);
  eq("接着上一段尾帧拍的：延续", C.seamContinuous(p, 1, carried), true);
  eq("明写了不是接着拍的：换场", C.seamContinuous(p, 2, carried), false);
  eq("老剪辑稿没有这一位：不知道", C.seamContinuous(p, 1, [{}, {}, {}]), null);
  const sp = must(C.splitClip(p, "c1", 2, "x1", lens3), "分割");
  eq("分割出来的两半、切点对得上：延续", C.seamContinuous(sp, 1, carried), true);
  // 接缝被动过（上一段裁了尾巴 / 这一段裁了头 / 中间删了一段 / 换了序）就不再是原来那条
  eq("上一段裁过尾巴：不算延续", C.seamContinuous(must(C.trimClip(p, "c1", "end", 3, lens3), "裁尾"), 1, carried), false);
  eq("这一段裁过头：不算延续", C.seamContinuous(must(C.trimClip(p, "c2", "start", 1, lens3), "裁头"), 1, carried), false);
  eq("换过序：不算延续", C.seamContinuous(must(C.moveClip(p, "c2", -1), "前移"), 1, carried), false);
  eq("同一段的两半之间裁掉了一截：不算延续", C.seamContinuous(must(C.trimClip(sp, "x1", "start", 3, lens3), "后一半裁头"), 1, carried), false);
}

// ── 字幕分行分页 ──
{
  const lines = (text, max, lpp) => C.paginateCaption(text, max, lpp).map((pg) => pg.lines);
  const units = (s) => [...s].reduce((w, ch) => w + C.charUnits(ch), 0);
  eq("短的一行放下", lines("你好", 11), [["你好"]]);
  eq("空的 / 只有空白", [lines("", 11), lines("   \n ", 11)], [[], []]);
  // ★ 短语整个整个地装页、页内两行挑差不多宽的断点 —— 不是贪心填满（那样会排出「信使收到一封没 / 有地址的信」）
  eq("按短语分页、两行差不多宽、行尾不带逗号句号", lines("雨夜里，信使收到一封没有地址的信，他决定亲自去找收信人。", 11), [
    ["雨夜里，信使收到", "一封没有地址的信"],
    ["他决定亲自去找收信人"],
  ]);
  eq("断在标点后面有加分", lines("他推开门，屋里没有人", 8), [["他推开门", "屋里没有人"]]);
  // 两行一样宽（9 + 9）要把「收信人，」拆开；宁可 11 + 7，断在逗号后面
  eq("宁可两行不一样宽，也不把词和逗号拆到下一行", lines("他决定亲自去找收信人，不管要走多远。", 11), [["他决定亲自去找收信人", "不管要走多远"]]);
  eq("问号叹号留着", lines("真的吗？真的！", 11), [["真的吗？真的！"]]);
  // 行尾的逗号不画，量宽度时也不算它：前半句正好 11 个字加一个逗号，照样一行放下、断在逗号后面
  eq("行尾不画的逗号不占宽度", lines("他推开那扇吱呀的旧木门，屋里没有人", 11), [["他推开那扇吱呀的旧木门", "屋里没有人"]]);
  // 汉字按词断（运行环境的分词器，随版本可能略有出入），所以这几条只验性质、不钉逐字结果
  const quoted = lines("他说：「走吧。」然后转身离开了这座城，再也没有回来过", 9).flat();
  eq("收尾的标点不落在行首", quoted.filter((ln) => "，。！？、；：」』）".includes(ln[0])), []);
  eq("起头的标点不落在行尾", quoted.filter((ln) => "「『（".includes(ln[ln.length - 1])), []);
  eq("一个字都不丢（行尾的逗号句号除外）", quoted.join("").replace(/[，。]/g, ""), "他说：「走吧」然后转身离开了这座城再也没有回来过");
  // 最后一页不该只剩一两个字（贪心填满两行之后剩一个「市」字单独翻一页）
  const pagesOf = C.paginateCaption("信使收到一封没有地址的信然后转身离开了这座城市", 11);
  eq("字匀到各页：最后一页不是孤零零一两个字", pagesOf.length === 2 && pagesOf[1].units >= 6, true);
  const seg = typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter("zh", { granularity: "word" }).segment("然后转身")].map((x) => x.segment) : [];
  if (seg.includes("然后")) {
    const broken = lines("他说完然后转身离开了这座城市的最后一条街然后消失", 9).flat();
    eq("词不从中间断开（然 / 后）", broken.filter((ln) => ln.endsWith("然") || ln.startsWith("后")), []);
  }
  // 英文按单词断；三行的量匀成两页（一行 + 两行），不是贪心的「两行 + 孤零零一个 dog」
  eq("英文按词断，不从词中间断", lines("The quick brown fox jumps over the lazy dog.", 11), [["The quick brown fox"], ["jumps over", "the lazy dog"]]);
  eq("词里的句点 / 撇号不拆", lines("It’s 3.5 km away", 30), [["It’s 3.5 km away"]]);
  // 一行不许比安全宽度宽（估宽了只是早换行，估窄了才会冲出去）
  for (const [text, max] of [
    ["雨夜里，信使收到一封没有地址的信，他决定亲自去找收信人。", 11],
    ["The quick brown fox jumps over the lazy dog, then naps.", 11],
    ["https://example.com/a-very-long-url-that-never-ends-and-keeps-going", 11],
    ["混排 mixed 中英 English 文本 text 也要守住宽度", 7],
    // 逗号前面那半句比一行多一个字：断在逗号后面最自然，可那样第一行就超宽了 —— 宁可从别处断
    ["他推开那扇吱呀响的旧木门，屋里空无一人", 11],
  ]) {
    const all = C.paginateCaption(text, max).flatMap((pg) => pg.lines);
    eq(`每一行都不超宽：${text.slice(0, 12)}…`, all.filter((ln) => units(ln) > max + 1e-6), []);
    eq(`每一页最多两行：${text.slice(0, 12)}…`, C.paginateCaption(text, max).filter((pg) => pg.lines.length > 2), []);
  }
  eq("比一行还宽的词硬拆、一个字不丢", C.paginateCaption("abcdefghijklmnopqrstuvwxyz0123456789", 5).flatMap((pg) => pg.lines).join(""), "abcdefghijklmnopqrstuvwxyz0123456789");
  eq("标题最多排四行", lines("这是一个很长很长的片头标题它会折成好几行", 7, 4)[0].length <= 4, true);
  // 版式：竖屏 720×1280 一行 11 个字、横屏 1280×720 一行 18 个字（数是量出来的，见 captionLayout）
  eq("竖屏一行几个字", [C.captionLayout(F).unitsPerLine, C.captionLayout(F).titleUnitsPerLine], [11, 7]);
  eq("横屏一行几个字", [C.captionLayout({ w: 1280, h: 720 }).unitsPerLine, C.captionLayout({ w: 1280, h: 720 }).titleUnitsPerLine], [18, 12]);
  eq("1080P 与 720P 排出来的行一样（版式按比例给）", C.captionLayout({ w: 1080, h: 1920 }).unitsPerLine, 11);
}

// ── 渲染计划：字幕 / 配音排在成片时间轴的哪儿 ──
{
  const plan = (p, real = lens3) => C.timelinePlan(p, lens3, real, F, 3);
  const base = plan(bareProj());
  eq("什么都没加：没有长在时间上的东西", [base.timed, base.exact, base.total, base.captions.length, base.voices.length, base.bgmGain, base.tailFadeSec], [false, true, 20, 0, 0, 1, 0]);
  eq("各段在成片里的起点", base.clips.map((c) => c.outStart), [0, 5, 10]);
  eq("有配乐就算长在时间上（片尾要收声）", [plan(fresh()).timed, plan(fresh()).tailFadeSec], [true, C.BGM_TAIL_SEC]);

  // 变速：后面的段跟着往前挪
  const fast = plan(must(C.setClipSpeed(bareProj(), "c1", 2), "变速"));
  eq("变速之后的起点与总长", [fast.clips.map((c) => c.outStart), fast.total], [[0, 2.5, 7.5], 17.5]);

  // 闪黑：这一段从黑里进来 = 上一段尾巴淡出 + 这一段开头淡入
  const fadeP = C.setEndFade(must(C.setClipFade(bareProj(), "c2", true), "闪黑"), true);
  const fd = plan(fadeP);
  eq("闪黑落在接缝两侧、片尾淡出落在最后一段", fd.clips.map((c) => [c.fadeIn, c.fadeOut]), [[0, C.FADE_SEC], [C.FADE_SEC, 0], [0, C.END_FADE_SEC]]);
  eq("片尾声音跟着收", fd.tailFadeSec, C.END_FADE_SEC);
  // ★★ 有一段的长度没量过：闪黑与片尾收声一律不做（位置全是错的 —— 淡出落在片段中间，画面黑下去就亮不回来）
  const unsure = plan(fadeP, [5, undefined, 10]);
  eq("长度靠不住时不闪黑、不收声", [unsure.exact, unsure.clips.map((c) => [c.fadeIn, c.fadeOut]), unsure.tailFadeSec], [false, [[0, 0], [0, 0], [0, 0]], 0]);
  eq("出点是人裁的也算靠得住", plan(must(C.trimClip(fadeP, "c2", "end", 3, lens3), "裁尾"), [5, undefined, 10]).exact, true);
  // 很短的片段：淡入淡出各自最多占一半
  const tiny = plan(must(C.setClipFade(must(C.trimClip(bareProj(), "c2", "end", 0.5, lens3), "裁到半秒"), "c2", true), "闪黑"));
  eq("淡入不比半个片段长", tiny.clips[1].fadeIn, 0.25);

  // 只有字幕、没有配音：整段挂着（开头晚一点出、结尾早一点收）
  const cap = plan(must(C.setClipLine(bareProj(), "c2", "你好世界"), "字幕"));
  eq("没配音的字幕挂满这一段", cap.captions.map((c) => [r3(c.startSec), r3(c.endSec), c.lines, c.kind, c.clipId]), [[5.15, 9.9, ["你好世界"], "caption", "c2"]]);
  eq("只有字幕时配乐不压", cap.bgmGain, 1);

  // 配音：从片段开头稍后念，字幕跟着声音走
  const v1 = must(C.setClipVoice(must(C.setClipLine(bareProj(), "c1", "第一句"), "字"), "c1", voiceOf("第一句", 3)), "配音");
  const pv = plan(v1);
  eq("配音排在片段开头稍后", pv.voices.map((v) => [r3(v.atSec), v.durSec, v.playSec, v.lateSec, v.overSec]), [[0.15, 3, 3, 0, 0]]);
  eq("字幕跟着配音：念完再留一小会儿", pv.captions.map((c) => [r3(c.startSec), r3(c.endSec)]), [[0.15, 3.4]]);
  eq("有配音：配乐压低、这一段原声压低", [pv.bgmGain, pv.clips[0].volume, pv.clips[1].volume], [C.BGM_DUCK, C.BED_GAIN, 1]);

  // 念超了：下一句往后顺，不叠着念
  let over = must(C.setClipVoice(must(C.setClipLine(bareProj(), "c1", "很长的一句"), "字"), "c1", voiceOf("很长的一句", 6)), "配音");
  over = must(C.setClipVoice(must(C.setClipLine(over, "c2", "第二句"), "字"), "c2", voiceOf("第二句", 2)), "配音");
  const po = plan(over);
  eq("念超了记下超出多少", r3(po.voices[0].overSec), 1.15);
  eq("下一句往后顺", [r3(po.voices[1].atSec), r3(po.voices[1].lateSec)], [6.3, 1.15]);
  eq("两条字幕不叠着", po.captions[1].startSec >= po.captions[0].endSec, true);

  // 念到片尾还没完：在片尾掐掉
  const tail = plan(must(C.setClipVoice(must(C.setClipLine(bareProj(), "c3", "收尾的话"), "字"), "c3", voiceOf("收尾的话", 12)), "配音"));
  eq("片尾掐掉", [r3(tail.voices[0].playSec), r3(tail.voices[0].overSec)], [9.85, 2.15]);

  // 位置不够：片段太短，字幕不出、并且记下来
  const short = plan(must(C.setClipLine(must(C.trimClip(bareProj(), "c2", "end", 0.5, lens3), "裁到半秒"), "c2", "来不及看"), "字"));
  eq("太短的片段排不上字幕", [short.captions.length, short.dropped], [0, ["c2"]]);

  // 不烧字幕：配音照念
  const off = plan(C.setCaptionsOn(v1, false));
  eq("不烧字幕时只留配音", [off.captions.length, off.voices.length], [0, 1]);

  // 片头标题
  const tt = plan(C.setTitle(bareProj(), "雨夜霓虹：迷失信使"));
  eq("片头标题", tt.captions.map((c) => [c.kind, c.startSec, r3(c.endSec), c.lines]), [["title", C.TITLE_AT_SEC, r3(C.TITLE_AT_SEC + C.TITLE_SEC), ["雨夜霓虹", "迷失信使"]]]);
  eq("只有空白的标题不算", plan(C.setTitle(bareProj(), "   ")).captions.length, 0);

  // 一句话翻两页：时间按字数分
  const two = plan(must(C.setClipLine(bareProj(), "c3", "雨夜里，信使收到一封没有地址的信，他决定亲自去找收信人。"), "字"));
  eq("翻页：两页首尾相接、盖满这一段", [two.captions.length, r3(two.captions[0].startSec), two.captions[0].endSec === two.captions[1].startSec, r3(two.captions[1].endSec)], [2, 10.15, true, 19.9]);
  eq("翻页：字多的那一页挂得久", two.captions[0].endSec - two.captions[0].startSec > two.captions[1].endSec - two.captions[1].startSec, true);
}

// ── 一键成片：给模型的清单、模型输出的形状检查（不可信输入）、落地 ──
{
  const segsA = [
    { title: "第1段 · 开场", plot: "中景 · 缓推 · 铺垫。雨夜的码头上，信使推开仓库的铁门。他浑身湿透。", carried: false },
    { title: "第2段 · 追逐", plot: "他在货架之间奔跑，身后的手电光越来越近。", carried: true },
    { title: "第3段 · 收尾", plot: "天亮了。信使坐在海堤上，把那封信折好放进口袋。", carried: false },
  ];
  const p = bareProj();
  const brief = C.autoBrief(p, segsA, lens3);
  eq("清单：一个片段一行、编号从 1 起、带时长与念得完的长度", brief.map((b) => [b.n, b.clipId, b.durSec, b.cap]), [[1, "c1", 5, 24], [2, "c2", 5, 24], [3, "c3", 10, 48]]);
  eq("清单：接缝的三种说法", brief.map((b) => b.seam), ["first", "same-shot", "scene-change"]);
  eq("清单：老剪辑稿不知道是不是接着拍的", C.autoBrief(p, [{}, {}, {}], lens3).map((b) => b.seam), ["first", "unknown", "unknown"]);
  // 删过段、变过速之后：编号重排，时长按成片里的算，接缝重新判（中间删了一段就不再是原来那条接缝）
  const edited = must(C.setClipSpeed(must(C.removeClip(p, "c2"), "删"), "c3", 2), "变速");
  eq("清单跟着时间轴走", C.autoBrief(edited, segsA, lens3).map((b) => [b.n, b.clipId, b.durSec, b.seam]), [[1, "c1", 5, "first"], [2, "c3", 5, "scene-change"]]);

  // 清单是什么语言：字母折成"字"之后比汉字多才算英文；夹着几个英文专有名词的中文描述仍然是中文
  eq("中文描述", C.briefLang(brief), "zh");
  eq("英文描述", C.briefLang(C.autoBrief(p, [{ plot: "Wide shot. A lighthouse keeper climbs the spiral stairs at dusk." }, { plot: "He lights the great lamp." }, { plot: "Morning. A girl runs along the pier." }], lens3)), "en");
  eq("夹着英文专有名词的中文描述算中文", C.briefLang(C.autoBrief(p, [{ plot: "机器人 WALL-E 在废弃的游乐园里醒来，胸口的指示灯忽明忽暗。" }, { plot: "小女孩 Alice 擦去它脸上的灰。" }, { plot: "他们一起走过黄昏的街道。" }], lens3)), "zh");
  eq("一句描述都没有（只有段名）：按段名判，中文段名算中文", C.briefLang(C.autoBrief(p, [{ title: "第1段" }, { title: "第2段" }, { title: "第3段" }], lens3)), "zh");
  eq("英文旁白的上限折成单词数", [C.capWords(28), C.capWords(24), C.capWords(8), C.capWords(2)], [14, 12, 4, 3]);

  const good = JSON.stringify({
    title: "《雨夜信使》",
    lines: [{ clip: 1, text: "雨夜里，他推开了那扇门。" }, { clip: 2, text: "有人追了上来。" }, { clip: 3, text: "天亮的时候，信还在他手里。" }],
    fades: [3],
    music: "低沉的钢琴",
  });
  const r = C.parseAutoPlan(good, brief);
  eq("形状对的原样收下（标题摘掉书名号，编号换回片段 id）", r.ok && r.plan, {
    title: "雨夜信使",
    lines: [{ clipId: "c1", text: "雨夜里，他推开了那扇门。" }, { clipId: "c2", text: "有人追了上来。" }, { clipId: "c3", text: "天亮的时候，信还在他手里。" }],
    fades: ["c3"],
    music: "低沉的钢琴",
  });
  eq("包在代码块与客套话里的 JSON 也读得出", C.parseAutoPlan("好的，这是结果：\n```json\n" + good + "\n```\n希望有帮助", brief).ok, true);

  // ★ 不可信输入：编号越界 / 重复 / 不是整数 / 缺字段 / 混进别的类型
  const bad = C.parseAutoPlan(
    JSON.stringify({
      title: 12,
      lines: [{ clip: 9, text: "越界" }, { clip: "2", text: "字符串编号也认" }, { clip: 2, text: "同一段的第二句" }, { clip: 1.5, text: "不是整数" }, { clip: 3 }, "乱入", null],
      fades: [1, 2, 3, 3, 7, "x"],
      music: 5,
    }),
    brief,
  );
  eq("越界 / 重复 / 不成形的行丢掉，没拿到话的片段留空", bad.ok && bad.plan.lines, [{ clipId: "c1", text: "" }, { clipId: "c2", text: "字符串编号也认" }, { clipId: "c3", text: "" }]);
  eq("转场只落在明确换了场的接缝上（第一个片段、接着拍的都不行），不重复", bad.ok && bad.plan.fades, ["c3"]);
  eq("标题 / 配乐建议不是字符串就当没有", bad.ok && [bad.plan.title, bad.plan.music], ["", ""]);
  // ★ 真模型写出来过的坏形状：lines 里只有一个对象、键重复（少了 "},{"）—— 合法 JSON，JSON.parse 只留最后一对
  const dupKeys = C.parseAutoPlan('{"title":"雨夜信使","lines":[{"clip":1,"text":"雨夜里，他推开了那扇门。","clip":2,"text":"有人追了上来。","clip":3,"text":"天亮的时候，信还在他手里。"}],"fades":[3],"music":"钢琴"}', brief);
  eq("键重复的写法：每一句都捞得回来", dupKeys.ok && dupKeys.plan.lines.map((l) => l.text), ["雨夜里，他推开了那扇门。", "有人追了上来。", "天亮的时候，信还在他手里。"]);
  const dupEsc = C.parseAutoPlan('{"title":"t","lines":[{"clip":1,"text":"他说：\\"走吧\\"","clip":2,"text":"第二句"}]}', brief);
  eq("捞回来的句子里带转义引号也读得对", dupEsc.ok && dupEsc.plan.lines.map((l) => l.text), ['他说："走吧"', "第二句", ""]);

  const unknownSeams = C.parseAutoPlan(JSON.stringify({ title: "t", lines: [], fades: [2, 3] }), C.autoBrief(p, [{}, {}, {}], lens3));
  eq("不知道是不是换场的接缝上不加转场", unknownSeams.ok && unknownSeams.plan.fades, []);
  const long = C.parseAutoPlan(JSON.stringify({ lines: [{ clip: 1, text: "字".repeat(60) }] }), brief);
  eq("太长的一句不截（截出来是半句话）—— 由确认卡标出来", long.ok && long.plan.lines[0].text.length, 60);
  eq("存储上限仍然封顶", (() => { const x = C.parseAutoPlan(JSON.stringify({ lines: [{ clip: 1, text: "字".repeat(999) }] }), brief); return x.ok && x.plan.lines[0].text.length; })(), C.LINE_MAX_CHARS);
  eq("回话里没有 JSON", C.parseAutoPlan("抱歉，我没法完成这个请求。", brief), { ok: false, issue: "no-json" });
  eq("半截 JSON（被截断）", C.parseAutoPlan('{"title": "雨夜信使", "lines": [{"clip": 1, "text": "雨夜里', brief), { ok: false, issue: "no-json" });
  eq("有花括号但读不出来", C.parseAutoPlan('{"title": 雨夜信使}', brief), { ok: false, issue: "bad-json" });
  eq("读得出但不是对象", C.parseAutoPlan("[1, 2]", brief), { ok: false, issue: "bad-json" });
  eq("一句能用的话、一个能用的标题都没有", C.parseAutoPlan(JSON.stringify({ title: "  ", lines: [{ clip: 8, text: "x" }] }), brief), { ok: false, issue: "empty" });
  eq("只有标题也算数", C.parseAutoPlan(JSON.stringify({ title: "雨夜信使" }), brief).ok, true);
  // 转场最多 AUTO_FADES_MAX 处
  const segs6 = Array.from({ length: 6 }, (_, i) => ({ title: `第${i + 1}段`, durationSec: 5, plot: "画面", carried: false }));
  let k = 0;
  const p6 = C.freshProject(segs6, false, () => `s${++k}`);
  const many = C.parseAutoPlan(JSON.stringify({ title: "t", fades: [2, 3, 4, 5, 6] }), C.autoBrief(p6, segs6, [5, 5, 5, 5, 5, 5]));
  eq("自动加的转场有上限", many.ok && many.plan.fades, ["s2", "s3", "s4"].slice(0, C.AUTO_FADES_MAX));

  // 演示档：不冒充模型
  const demo = C.demoAutoPlan(brief);
  eq("演示档：每段取画面描述的第一句（跳过镜头行）", demo.lines.map((l) => l.text), ["雨夜的码头上，信使推开仓库的铁门。", "他在货架之间奔跑，身后的手电光越来越近。", "天亮了。"]);
  eq("演示档：不加转场、不起标题", [demo.fades, demo.title, demo.music], [[], "", ""]);
  const tight = C.demoAutoPlan([{ ...brief[0], cap: 8 }]);
  eq("演示档：截到这一段念得完的长度", C.lineUnits(tight.lines[0].text) <= 8, true);

  // 落地：确认卡上看到的就是写进去的
  const plan = r.ok ? r.plan : null;
  const applied = C.applyAutoPlan(p, plan, { captions: true, fades: true, endFade: true });
  eq("落地：标题、每段一句、转场、片尾淡出", [applied.title, applied.clips.map((c) => c.line?.text), applied.clips.map((c) => !!c.fade), applied.endFade, "capOff" in applied], ["雨夜信使", ["雨夜里，他推开了那扇门。", "有人追了上来。", "天亮的时候，信还在他手里。"], [false, false, true], true, false]);
  eq("落地不动别的（片段范围 / 配乐 / 档位）", [shape(applied), applied.audio, applied.resId], [shape(p), p.audio, p.resId]);
  // 原来的东西怎么处理
  let had = must(C.setClipVoice(must(C.setClipLine(p, "c1", "雨夜里，他推开了那扇门。"), "字"), "c1", voiceOf("雨夜里，他推开了那扇门。", 2)), "配音");
  had = must(C.setClipFade(must(C.setClipLine(had, "c2", "原来的一句"), "字"), "c2", true), "闪黑");
  const over = C.applyAutoPlan(had, { ...plan, lines: [plan.lines[0], { clipId: "c2", text: "" }, plan.lines[2]] }, { captions: false, fades: true, endFade: false });
  eq("字没变的那一句：配音还作数", [over.clips[0].line.voice?.durSec, C.voiceStale(over.clips[0].line, "v1")], [2, false]);
  eq("表里是空串的片段：原来的字幕去掉", "line" in over.clips[1], false);
  eq("转场开着：不在表里的片段不再从黑里进来", over.clips.map((c) => !!c.fade), [false, false, true]);
  eq("开关关着就写成关", ["endFade" in over, over.capOff], [false, true]);
  const keepFades = C.applyAutoPlan(had, plan, { captions: true, fades: false, endFade: true });
  eq("转场关着：原来的转场一个不动", keepFades.clips.map((c) => !!c.fade), [false, true, false]);
  const gone = C.applyAutoPlan(must(C.removeClip(p, "c2"), "删"), plan, { captions: true, fades: true, endFade: true });
  eq("表里的片段已经被删了：跳过那一行，别的照写", gone.clips.map((c) => [c.id, c.line?.text]), [["c1", "雨夜里，他推开了那扇门。"], ["c3", "天亮的时候，信还在他手里。"]]);
  eq("标题是空的：不动原来的标题", C.applyAutoPlan(C.setTitle(p, "原标题"), { ...plan, title: "" }, { captions: true, fades: true, endFade: true }).title, "原标题");
}

// ── 对剪辑台说话：白名单操作落地（applyCutOps）──
{
  let k = 0;
  const ctxOf = (p, over = {}) => ({
    project: p,
    lens: lens3,
    realLens: lens3,
    segCount: 3,
    selectedId: null,
    voiceId: "v1",
    voice: "ok",
    newId: () => `n${++k}`,
    ...over,
  });
  const go = (ops, p = bareProj(), over) => C.applyCutOps(ops, ctxOf(p, over));
  const kinds = (r) => r.refusals.map((x) => x.kind);

  // 基本：一句话几件事，回执带的是说话那一刻的编号
  let r = go([{ op: "speed", clip: 2, value: 0.5 }, { op: "volume", clip: 3, value: 0 }, { op: "end_fade", on: true }]);
  eq("一句话三件事：各办各的", [r.receipts, r.refusals, r.next.clips.map((c) => [c.id, c.speed, c.volume]), r.next.endFade], [
    [{ kind: "speed", n: 2, speed: 0.5 }, { kind: "volume", n: 3, pct: 0 }, { kind: "end_fade", on: true }],
    [],
    [["c1", null, null], ["c2", 0.5, null], ["c3", null, 0]],
    true,
  ]);
  {
    const p = bareProj();
    const before = JSON.stringify(p);
    go([{ op: "remove", clip: 1 }, { op: "speed", clip: 2, value: 2 }, { op: "title", text: "雨夜" }], p);
    eq("传进来的那份工程不动（回的是新对象）", JSON.stringify(p), before);
  }

  // ★ 点名认 id 不认下标：先删片段 2、再说片段 3，说的是删之前的第 3 个
  r = go([{ op: "remove", clip: 2 }, { op: "volume", clip: 3, value: 0 }]);
  eq("先删片段 2 再说片段 3：落在原来的第 3 个上", [r.next.clips.map((c) => [c.id, c.volume]), r.receipts], [
    [["c1", null], ["c3", 0]],
    [{ kind: "removed", n: 2 }, { kind: "volume", n: 3, pct: 0 }],
  ]);
  r = go([{ op: "remove", clip: 2 }, { op: "speed", clip: 2, value: 0.5 }]);
  eq("同一句话里前面已经删了它：后面那件不办、说出来", [r.refusals, r.receipts.length], [[{ kind: "gone", n: 2 }], 1]);

  // 没变的也照报，但不产生一步空撤销
  r = go([{ op: "speed", clip: 1, value: 1 }]);
  eq("本来就是那个样子：照报、工程不换（不记一步空撤销）", [r.receipts, r.next], [[{ kind: "speed", n: 1, speed: 1 }], null]);

  // 点名的几种
  r = go([{ op: "volume", clip: "current", value: 0 }]);
  eq("没点名也没选中：不办", [kinds(r), r.next], [["no_current"], null]);
  r = go([{ op: "volume", clip: "current", value: 0 }], bareProj(), { selectedId: "c2" });
  eq("没点名：落在选中的那个上", r.next.clips.map((c) => c.volume ?? null), [null, 0, null]);
  r = go([{ op: "speed", clip: "current", value: 2 }, { op: "volume", clip: "current", value: 0 }]);
  eq("同一个原因只说一次", r.refusals, [{ kind: "no_current" }]);
  r = go([{ op: "volume", clip: 9, value: 0 }]);
  eq("没有这个编号", r.refusals, [{ kind: "no_clip", ref: 9, count: 3 }]);
  r = go([{ op: "volume", clip: "all", value: 0.3 }]);
  eq("全部", [r.next.clips.map((c) => c.volume), r.receipts.map((x) => [x.n, x.pct])], [[0.3, 0.3, 0.3], [[1, 30], [2, 30], [3, 30]]]);
  r = go([{ op: "fade", clip: "last", on: true }]);
  eq("最后一个", r.next.clips.map((c) => !!c.fade), [false, false, true]);
  r = go([{ op: "volume", clip: "last", value: 0 }, { op: "volume", clip: 3, value: 0 }], bareProj(), { segCount: 2 });
  eq("指着不存在的段的片段不占编号", [r.next.clips.map((c) => c.volume ?? null), r.refusals], [[null, 0, null], [{ kind: "no_clip", ref: 3, count: 2 }]]);

  // ★ 「第 N 段」（带"段"字的说法）：只有"位置 N"与"标着段 N 的那个"是同一个片段才办
  r = go([{ op: "volume", clip: { seg: 3 }, value: 0 }]);
  eq("没动过的时间轴：第 3 段就是片段 3", r.next.clips.map((c) => c.volume ?? null), [null, null, 0]);
  {
    const moved = must(C.reorderClip(bareProj(), "c3", "c1"), "换序"); // c3 c1 c2
    r = go([{ op: "volume", clip: { seg: 3 }, value: 0 }], moved);
    eq("换过序：第 3 段有两种读法（位置 3 的 / 标着段3 的），不办", [r.refusals, r.next], [[{ kind: "seg_unclear", ref: 3 }], null]);
    r = go([{ op: "volume", clip: 3, value: 0 }], moved);
    eq("换过序：按位置说「片段 3」照办，落在从左数第 3 个上", r.next.clips.map((c) => [c.id, c.volume ?? null]), [["c3", null], ["c1", null], ["c2", 0]]);
    const cutUp = must(C.splitClip(bareProj(), "c2", 2, "h2", lens3), "切"); // c1 c2 h2 c3
    r = go([{ op: "remove", clip: { seg: 2 } }, { op: "remove", clip: { seg: 1 } }], cutUp);
    eq("切过：第 2 段有两个片段，不办；没受影响的第 1 段照办", [r.refusals, r.next.clips.map((c) => c.id)], [[{ kind: "seg_unclear", ref: 2 }], ["c2", "h2", "c3"]]);
    const fewer = must(C.removeClip(bareProj(), "c1"), "删"); // c2 c3
    r = go([{ op: "volume", clip: { seg: 3 }, value: 0 }, { op: "volume", clip: { seg: 2 }, value: 0 }], fewer);
    eq("删过前面的：第 3 段 / 第 2 段都对不上位置，不办", [r.refusals, r.next], [[{ kind: "seg_unclear", ref: 3 }, { kind: "seg_unclear", ref: 2 }], null]);
    eq(
      "segRefClip：读法唯一才回片段",
      [C.segRefClip(bareProj().clips, 3, 2), C.segRefClip(moved.clips, 3, 2), C.segRefClip(moved.clips, 3, 3), C.segRefClip(cutUp.clips, 3, 1), C.segRefClip(cutUp.clips, 3, 2), C.segRefClip(cutUp.clips, 3, 3), C.segRefClip(bareProj().clips, 3, 9), C.segRefClip(bareProj().clips, 3, 1.5)],
      ["c2", null, null, "c1", null, null, null, null],
    );
  }

  // 变速：明说的倍数就近取档；「慢一点 / 快一点」从现在的速度起挪一档
  r = go([{ op: "speed", clip: 1, value: 0.6 }]);
  eq("不在档上的倍数就近取一档，回执说的是真落到的那一档", r.receipts, [{ kind: "speed", n: 1, speed: 0.5 }]);
  r = go([{ op: "speed_step", clip: 1, dir: -1 }]);
  eq("慢一档：1× → 0.75×", [r.next?.clips[0].speed, r.receipts], [0.75, [{ kind: "speed", n: 1, speed: 0.75 }]]);
  r = go([{ op: "speed_step", clip: 1, dir: -1 }], must(C.setClipSpeed(bareProj(), "c1", 0.75), "变速"));
  eq("再慢一档：0.75× → 0.5×（不是纹丝不动）", r.next?.clips[0].speed, 0.5);
  r = go([{ op: "speed_step", clip: 1, dir: -1 }], must(C.setClipSpeed(bareProj(), "c1", 0.5), "变速"));
  eq("已经最慢：不办、说出来", [r.refusals, r.next], [[{ kind: "speed_limit", n: 1, speed: 0.5 }], null]);
  r = go([{ op: "speed_step", clip: 1, dir: 1 }, { op: "speed_step", clip: 1, dir: 1 }]);
  eq("一句话里快两档：1× → 1.25× → 1.5×", r.next?.clips[0].speed, 1.5);
  r = go([{ op: "speed_step", clip: 2, dir: 1 }], must(C.setClipSpeed(bareProj(), "c2", 2), "变速"));
  eq("已经最快", r.refusals, [{ kind: "speed_limit", n: 2, speed: 2 }]);

  // 裁：秒是成片里的秒
  r = go([{ op: "trim", clip: 3, edge: "start", sec: 2, mode: "cut" }]);
  eq("裁掉开头 2 秒", shape(r.next), "0[0-尾] 1[0-尾] 2[2-尾]");
  r = go([{ op: "trim", clip: 3, edge: "end", sec: 2, mode: "cut" }]);
  eq("裁掉结尾 2 秒", shape(r.next), "0[0-尾] 1[0-尾] 2[0-8]");
  r = go([{ op: "trim", clip: 3, edge: "end", sec: 3, mode: "keep" }]);
  eq("只留开头 3 秒（动的是结尾）", [shape(r.next), r.receipts], ["0[0-尾] 1[0-尾] 2[0-3]", [{ kind: "trimmed", n: 3, edge: "end", mode: "keep", sec: 3 }]]);
  r = go([{ op: "trim", clip: 3, edge: "start", sec: 3, mode: "keep" }]);
  eq("只留结尾 3 秒（动的是开头）", shape(r.next), "0[0-尾] 1[0-尾] 2[7-尾]");
  {
    const fast = must(C.setClipSpeed(bareProj(), "c3", 2), "变速"); // 10 秒素材、成片里 5 秒
    eq("变速片段：裁掉开头 2 秒成片 = 4 秒素材", shape(go([{ op: "trim", clip: 3, edge: "start", sec: 2, mode: "cut" }], fast).next), "0[0-尾] 1[0-尾] 2[4-尾]");
    eq("变速片段：只留开头 2 秒成片 = 4 秒素材", shape(go([{ op: "trim", clip: 3, edge: "end", sec: 2, mode: "keep" }], fast).next), "0[0-尾] 1[0-尾] 2[0-4]");
    eq("变速片段：在第 2 秒切开 = 素材的第 4 秒", shape(go([{ op: "split", clip: 3, at: 2 }], fast).next), "0[0-尾] 1[0-尾] 2[0-4] 2[4-尾]");
    r = go([{ op: "trim", clip: 3, edge: "end", sec: 6, mode: "keep" }], fast);
    eq("变速片段：成片里只有 5 秒，留不出 6 秒", r.refusals, [{ kind: "keep_longer", n: 3, sec: 6, have: 5 }]);
  }
  r = go([{ op: "trim", clip: 1, edge: "start", sec: 4.8, mode: "cut" }]);
  eq("裁完剩下的太短：改法自己拒，原因是同一份代码", [r.refusals, r.next], [[{ kind: "issue", n: 1, issue: "short" }], null]);
  r = go([{ op: "trim", clip: 1, edge: "start", sec: 0, mode: "cut" }, { op: "split", clip: 1, at: -1 }]);
  eq("0 秒 / 负数：不办", [r.refusals, r.next], [[{ kind: "bad_number", n: 1 }], null]);
  {
    // ★ 「只留 N 秒」只许往短里裁
    const cut3 = must(C.trimClip(bareProj(), "c3", "end", 3, lens3), "裁到 3 秒");
    r = go([{ op: "trim", clip: 3, edge: "end", sec: 4, mode: "keep" }], cut3);
    eq("只留开头 4 秒，可它只有 3 秒：不办（不许把裁过的片段放长）", [r.refusals, r.next], [[{ kind: "keep_longer", n: 3, sec: 4, have: 3 }], null]);
    const halves = must(C.splitClip(bareProj(), "c3", 5, "h2", lens3), "切");
    r = go([{ op: "trim", clip: 3, edge: "start", sec: 8, mode: "keep" }], halves);
    eq("分割出来的前一半只留结尾 8 秒：不办（照算会伸进另一半，同一截播两遍）", [kinds(r), r.next], [["keep_longer"], null]);
  }
  {
    // ★ 长度没量出来的片段，按秒下刀的都不办
    const un = { realLens: [5, undefined, 10] };
    r = go([{ op: "trim", clip: 2, edge: "end", sec: 2, mode: "cut" }, { op: "split", clip: 2, at: 2 }], bareProj(), un);
    eq("没量过长度的片段：裁 / 切都不办", [r.refusals, r.next], [[{ kind: "unmeasured", n: 2 }], null]);
    r = go([{ op: "speed", clip: 2, value: 2 }, { op: "trim", clip: 3, edge: "end", sec: 2, mode: "cut" }], bareProj(), un);
    eq("没量过长度不碍别的操作，量过的片段照裁", [shape(r.next), r.next.clips[1].speed, r.refusals], ["0[0-尾] 1[0-尾] 2[0-8]", 2, []]);
    const cut = must(C.trimClip(bareProj(), "c2", "end", 3, lens3), "裁");
    r = go([{ op: "trim", clip: 2, edge: "end", sec: 1, mode: "cut" }], cut, un);
    eq("出点是人定过的就不算没量过", shape(r.next), "0[0-尾] 1[0-2] 2[0-尾]");
  }

  // 切
  k = 0;
  r = go([{ op: "split", clip: 3, at: 3 }]);
  eq("在第 3 秒切开：后一半用给的新 id", [shape(r.next), r.next.clips.map((c) => c.id), r.receipts], ["0[0-尾] 1[0-尾] 2[0-3] 2[3-尾]", ["c1", "c2", "c3", "n1"], [{ kind: "split", n: 3, at: 3 }]]);
  r = go([{ op: "split", clip: 3, at: 3 }, { op: "speed", clip: 4, value: 0.5 }, { op: "speed", clip: 9, value: 0.5 }]);
  eq("切完再指「切出来的那一半」：这一句里指不到，原因说清楚；真没有的编号另说", [r.refusals, r.next.clips.length, r.next.clips.every((c) => c.speed === undefined)], [[{ kind: "new_half", ref: 4 }, { kind: "no_clip", ref: 9, count: 3 }], 4, true]);
  r = go([{ op: "split", clip: 3, at: 0.1 }, { op: "split", clip: "all", at: 2 }]);
  eq("离边缘太近 / 对全部切：不办", [r.refusals, r.next], [[{ kind: "issue", n: 3, issue: "edge" }, { kind: "not_all" }], null]);

  // 挪
  r = go([{ op: "move", clip: 3, to: "first" }]);
  eq("挪到最前", [r.next.clips.map((c) => c.id), r.receipts], [["c3", "c1", "c2"], [{ kind: "moved", n: 3, place: 1 }]]);
  eq("挪到第 2 位", go([{ op: "move", clip: 1, to: 2 }]).next.clips.map((c) => c.id), ["c2", "c1", "c3"]);
  eq("位置越界就落在最后", go([{ op: "move", clip: 1, to: 99 }]).next.clips.map((c) => c.id), ["c2", "c3", "c1"]);
  eq("后移一格", go([{ op: "move", clip: 1, to: { delta: 1 } }]).next.clips.map((c) => c.id), ["c2", "c1", "c3"]);
  r = go([{ op: "move", clip: 1, to: { delta: -1 } }, { op: "move", clip: 3, to: "last" }, { op: "move", clip: "all", to: 1 }]);
  eq("已经在那儿 / 对全部挪：不办", [r.refusals, r.next], [[{ kind: "same_place", n: 1 }, { kind: "same_place", n: 3 }, { kind: "not_all" }], null]);
  r = go([{ op: "remove", clip: 1 }, { op: "move", clip: 3, to: "first" }]);
  eq("位置按现在的时间轴数（前面删过一个）", r.next.clips.map((c) => c.id), ["c3", "c2"]);

  // 删
  r = go([{ op: "remove", clip: "all" }]);
  eq("一句话删光：不办", [r.refusals, r.next], [[{ kind: "not_all" }], null]);
  r = go([{ op: "remove", clip: 1 }, { op: "remove", clip: 2 }, { op: "remove", clip: 3 }]);
  eq("删到只剩一个：最后那个不许删", [r.next.clips.map((c) => c.id), r.refusals], [["c3"], [{ kind: "issue", n: 3, issue: "last" }]]);

  // 字幕 / 标题
  r = go([{ op: "line", clip: 1, text: "雨停了。" }, { op: "line", clip: 2, text: "字".repeat(30) }]);
  eq("写字幕；这一段念不完的照写但标出来", [r.next.clips.map((c) => c.line?.text?.length ?? 0), r.receipts.map((x) => x.long)], [[4, 30, 0], [false, true]]);
  r = go([{ op: "line", clip: "all", text: "同一句" }]);
  eq("同一句话不写给所有片段", [r.refusals, r.next], [[{ kind: "not_all" }], null]);
  {
    const two = must(C.setClipLine(must(C.setClipLine(bareProj(), "c1", "一"), "字"), "c3", "三"), "字");
    r = go([{ op: "line", clip: "all", text: "" }], two);
    eq("去掉全部字幕可以", r.next.clips.map((c) => "line" in c), [false, false, false]);
  }
  r = go([{ op: "title", text: "标".repeat(C.TITLE_MAX + 5) }]);
  eq("标题太长：只收前 TITLE_MAX 个字，回执说出来", [r.next.title.length, r.receipts], [C.TITLE_MAX, [{ kind: "title", on: true, cut: true }]]);
  // ★ 标题的上限按念出来 / 排出来的长度算，不按字符个数：英文 24 个字符才三四个词（真模型起的英文标题被拦腰截过）
  eq("英文标题按折算后的长度算，不在 24 个字符处截", C.clipTitle("The Lighthouse Keeper's Promise"), "The Lighthouse Keeper's Promise");
  eq("中文标题仍然是 24 个字", C.clipTitle("标".repeat(30)).length, 24);
  eq("再长也不超过字符的硬上限", C.clipTitle("a ".repeat(60)).length <= C.TITLE_MAX_CHARS, true);
  eq("落盘读回、模型起的、嘴上说的走同一把尺", [C.setTitle(bareProj(), "The Lighthouse Keeper's Promise").title, go([{ op: "title", text: "The Lighthouse Keeper's Promise" }]).receipts], ["The Lighthouse Keeper's Promise", [{ kind: "title", on: true, cut: false }]]);
  r = go([{ op: "title", text: "" }, { op: "captions", on: false }], C.setTitle(bareProj(), "原标题"));
  eq("去掉标题、不烧字幕", ["title" in r.next, r.next.capOff, r.receipts], [false, true, [{ kind: "title", on: false, cut: false }, { kind: "captions", on: false }]]);

  // 配音
  {
    const lined = must(C.setClipLine(must(C.setClipLine(bareProj(), "c1", "雨停了。"), "字"), "c3", "天亮了。"), "字");
    r = go([{ op: "voice", clip: "all" }], lined);
    eq("全部配音：有字的那几个，按时间轴顺序；没字的不算被拒", [r.voiceIds, r.receipts, r.refusals, r.next], [["c1", "c3"], [{ kind: "voice", count: 2 }], [], null]);
    r = go([{ op: "voice", clip: 2 }], lined);
    eq("点名配音可它没有字", [r.voiceIds, r.refusals], [[], [{ kind: "no_line", n: 2 }]]);
    r = go([{ op: "voice", clip: "all" }]);
    eq("全部配音可一句字幕都没有", [r.voiceIds, r.refusals], [[], [{ kind: "nothing_to_voice" }]]);
    const voiced = must(C.setClipVoice(lined, "c1", voiceOf("雨停了。", 1.2)), "配音");
    r = go([{ op: "voice", clip: "all" }], voiced);
    eq("全部配音：配好且没过期的不重配", r.voiceIds, ["c3"]);
    r = go([{ op: "voice", clip: 1 }], voiced);
    eq("点名的那一个照配（人就是要重来一遍）", r.voiceIds, ["c1"]);
    r = go([{ op: "voice", clip: "all" }], voiced, { voiceId: "v2" });
    eq("换过音色：过期的重配", r.voiceIds, ["c1", "c3"]);
    r = go([{ op: "line", clip: 2, text: "有人追了上来。" }, { op: "voice", clip: 2 }], lined);
    eq("同一句话里先写字再配音", [r.voiceIds, r.next.clips[1].line.text], [["c2"], "有人追了上来。"]);
    r = go([{ op: "voice", clip: 1 }, { op: "remove", clip: 1 }], lined);
    eq("配音排上了、后面又把它删了：不配", r.voiceIds, []);
    const long = must(C.setClipLine(bareProj(), "c1", "字".repeat(30)), "字");
    r = go([{ op: "voice", clip: 1 }], long);
    eq("字幕太长念不完：不配", [r.voiceIds, r.refusals], [[], [{ kind: "line_long", n: 1 }]]);
    r = go([{ op: "voice", clip: "all" }], lined, { voice: "busy" });
    eq("上一批还在配：不办", [r.voiceIds, r.refusals], [[], [{ kind: "voice_busy" }]]);
    r = go([{ op: "voice", clip: "all" }], lined, { voice: "offline" });
    eq("离线 / 演示构建没有语音合成：不办", [r.voiceIds, r.refusals], [[], [{ kind: "voice_offline" }]]);
    r = go([{ op: "unvoice", clip: "all" }], voiced);
    eq("去掉全部配音：只动真有配音的", [r.next.clips[0].line, r.receipts], [{ text: "雨停了。" }, [{ kind: "unvoiced", n: 1 }]]);
    r = go([{ op: "unvoice", clip: "all" }], lined);
    eq("去掉全部配音可一个都没有", [r.refusals, r.next], [[{ kind: "no_voice" }], null]);
  }

  // 配乐音量
  r = go([{ op: "music_volume", value: 0.4 }]);
  eq("没有配乐：不办", [r.refusals, r.next], [[{ kind: "no_music" }], null]);
  r = go([{ op: "music_volume", value: 0.4 }], fresh());
  eq("配乐音量", [r.next.audio, r.receipts], [{ kind: "preset", volume: 0.4 }, [{ kind: "music", pct: 40 }]]);

  // ★ 撤销 / 重做不与别的改动混办
  r = go([{ op: "undo" }, { op: "undo" }]);
  eq("撤销两步：只报步数，工程不在这里动", [r.undo, r.redo, r.next, r.refusals], [2, 0, null, []]);
  r = go([{ op: "undo" }, { op: "volume", clip: 1, value: 0 }, { op: "redo" }]);
  eq("撤销与别的改动说在一句里：只办撤销 / 重做，别的不办、说出来", [r.undo, r.redo, r.next, r.receipts, r.refusals], [1, 1, null, [], [{ kind: "history_alone" }]]);

  // 一键成片：只是打开面板
  r = go([{ op: "auto" }, { op: "end_fade", on: true }]);
  eq("打开一键成片，别的照办", [r.openAuto, r.next.endFade], [true, true]);
  r = go([{ op: "auto" }], bareProj(), { voice: "busy" });
  eq("配音还在配的时候不开一键成片（界面上那颗入口这时是灰的，嘴说的不许绕过去）", [r.openAuto, r.refusals], [false, [{ kind: "voice_busy" }]]);
  eq("离线 / 演示构建照样能开一键成片（它有演示档）", go([{ op: "auto" }], bareProj(), { voice: "offline" }).openAuto, true);
  eq("空的操作表", go([]), { receipts: [], refusals: [], next: null, voiceIds: [], undo: 0, redo: 0, openAuto: false });
}

// ── 配音文件的修剪：判据（哪一截算"有话"）与 WAV 编码 ──
{
  const rate = 1000; // 好算：一个采样就是一毫秒
  const mk = (leadMs, voicedMs, tailMs, amp = 0.5) => [...Array(leadMs).fill(0), ...Array(voicedMs).fill(amp), ...Array(tailMs).fill(0)];
  eq("切掉首尾静音：起音前留 40ms、收尾后留 80ms", C.voiceBounds(mk(450, 2000, 400), rate), { start: 410, end: 2530 });
  eq("开头没有那么多静音：从头起", C.voiceBounds(mk(10, 2000, 400), rate), { start: 0, end: 2090 });
  eq("结尾没有那么多静音：到尾", C.voiceBounds(mk(450, 2000, 20), rate), { start: 410, end: 2470 });
  eq("底噪不算有声", C.voiceBounds([...Array(300).fill(0.005), ...Array(1000).fill(0.5), ...Array(300).fill(-0.005)], rate), { start: 260, end: 1380 });
  eq("负的采样也算有声（看绝对值）", C.voiceBounds(mk(300, 1000, 300, -0.5), rate), { start: 260, end: 1380 });
  eq("中间的停顿不切", C.voiceBounds([...mk(100, 500, 0), ...Array(600).fill(0), ...mk(0, 500, 100)], rate), { start: 60, end: 1780 });
  eq("整条都是静的：不切", C.voiceBounds(Array(2000).fill(0), rate), null);
  eq("留下的不到 0.1 秒：不切（别切出一条空的）", C.voiceBounds([0, 0, 0.5, 0, 0], rate), null);
  const pcm = new Float32Array(mk(450, 2000, 400));
  eq("定型数组也认", C.voiceBounds(pcm, rate), { start: 410, end: 2530 });

  const wav = new DataView(C.wavBytes([0, 1, -1, 0.5, 2, -2], 24000));
  const str = (at, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(at + i)));
  eq("WAV 头：RIFF / WAVE / fmt / data 四个标记", [str(0, 4), str(8, 4), str(12, 4), str(36, 4)], ["RIFF", "WAVE", "fmt ", "data"]);
  eq("WAV 头：长度两格对得上", [wav.byteLength, wav.getUint32(4, true), wav.getUint32(40, true)], [44 + 12, 36 + 12, 12]);
  eq("WAV 头：16 位单声道 PCM，采样率与每秒字节数", [wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint32(28, true), wav.getUint16(32, true), wav.getUint16(34, true)], [1, 1, 24000, 48000, 2, 16]);
  eq("采样折成 16 位（越界的钳住）", [0, 1, 2, 3, 4, 5].map((i) => wav.getInt16(44 + i * 2, true)), [0, 32767, -32768, 16384, 32767, -32768]);
}

if (problems.length) {
  console.error(`\n❌ 剪辑工程检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/cutProject.ts；真要改预期，先想清楚成片会变成什么样（最贵的两种错：同一截播两遍、裁剪点落到另一条片子上）。\n");
  process.exit(1);
}
console.log(`✓ 剪辑工程检查通过（${ran} 条）`);
