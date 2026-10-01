// 剪辑工程：剪辑页那条时间轴（片段 / 圈选 / 配乐 / 导出档）的数据形状与**全部改法** —— 纯数据 + 纯函数。
//
// ★★ 为什么要有它（2026-09-30，docs/cut-autoedit-research.md 的 P0）：这些东西原来是 CutPage 里的几格 useState ——
//   ① 离开剪辑页就全没了（返回键、点通知、App 被系统回收后从个人页「接着剪」回来）：裁过的、切过的、换过的顺序、
//      还没付钱的圈选、换过的配乐；
//   ② 合并把 draft.segments 换成单段成片之后，时间轴没有任何地方留底 —— 在发布页听出配乐不对，只能回工作流重做一条；
//   ③ 没有撤销（原来 resetTrim 那段注释自己写着"本页没有撤销"）。
//   收成一份可序列化的数据之后三件事一起解决：随 data/cutSession 落盘、合并时把源段留底、快照就是撤销。
// ★ **零运行时依赖**（只准 import type）：scripts/check-cut-project.mjs 在构建里直接 import 本文件跑正反例
//   （Node 只剥类型）。所以这里不许引 @lingui、不许用 enum / namespace；要说给人听的话一律回**代码**（CutIssue），
//   由 CutPage 翻成句子。「一段有多长」也不在这里算（types.segLen 是唯一实现）—— 调用方把 lens 传进来。
// ★ 改法都收在这里而不是散在页面的 onClick 里：之后「对剪辑台说话」的白名单 op 走的是同一批函数，
//   手点与嘴说不许各有一份实现（铁律六）。
// ★ 之后的字幕 / 配音 / 转场 / 变速一律往**片段**上挂（片段内的相对时间）：片段被裁、被挪、被删，它们跟着走。
//   今天「你动过片段、预置音轨会和画面对不上」那条提示正是声音没挂在片段上的后果，新东西别重演。
import type { BranchTree, VideoSegment } from "../types";

/** 一刀落下去两边必须留够的长度（秒）。分割与裁剪**同一个数**：各写一个必然分叉成"能切但切完删不掉" */
export const MIN_CLIP_SEC = 0.4;

/** 时间轴上的一个片段：引用稿子里的第 segIndex 段 + 截取范围（分割出来的兄弟片段共用同一个 segIndex，各占一段区间） */
export interface CutClip {
  id: string;
  segIndex: number;
  /** 入点（秒，片内） */
  start: number;
  /**
   * 出点（秒，片内）。**缺省 = 一直到这一段的片尾**。
   *
   * ★★ 为什么"没裁过尾巴"不记成一个数：一段的真实长度是**后来才知道**的（申报 5 秒的白模段实际 20 秒，
   *   剪辑页从播放器 / 截帧流的 metadata 里现学）。原来出点记的是数，于是每学到一次真实时长都要回头把
   *   "还停在申报值上"的出点改写一遍（learnRealDur 里那句 setClips）—— 有了撤销之后这条路走不通：
   *   撤回到的那份快照里出点还是申报值，而没有人会再替它改写第二次。缺省就是片尾，谁都不用回头改。
   */
  end?: number;
}

/** 圈选标注：哪一段的哪一帧 + 带红圈的标注图 + 修改要求（攒齐了一次性重拍，那一步才花钱） */
export interface CutAnn {
  id: string;
  segIndex: number;
  atSec: number;
  frame: string;
  req: string;
}

/**
 * 配乐。
 * · preset = 组稿时预置的那条原片音轨。**地址不在这里存第二份**，读 studioStore.draftAudioHint（它随剪辑稿落盘）。
 * · local  = 用户挑的本地文件：`ref` 是 `idb:cutbgm:<键>`（blob 进了本地库，重启之后还在）；
 *            存不进本地库时退成会话内的 `blob:` 地址 —— 那种落盘读回来时会被 validateProject 丢掉。
 */
export type CutAudio =
  | { kind: "preset"; volume: number }
  | { kind: "local"; name: string; ref: string; volume: number };

export interface CutProject {
  v: 1;
  /** 这份工程是给哪份稿子的（源段的指纹，见 segSig）。对不上 = 稿子换过了，整份作废、按新稿子重开 */
  sig: string;
  clips: CutClip[];
  anns: CutAnn[];
  /** null = 没有配乐（用户把预置去掉了也是它；"还没初始化"不存在 —— 工程一建出来就定了这一格） */
  audio: CutAudio | null;
  /** 导出档位 id（CutPage 的 RESOLUTIONS） */
  resId: string;
  /**
   * 合并之后留底的源段。稿子的 segments 在合并那一拍换成了单段成片，「回去改」靠这一份还原。
   * ★ 任何时刻源段只在一处：没合并 → draft.segments；合并了 → 这里。两处各留一份就是两份真相。
   */
  merged?: { sources: VideoSegment[]; branchTree?: BranchTree };
}

/** 改不成时的原因代码（CutPage 把它翻成整句人话） */
export type CutIssue =
  /** 找不到这个片段（撤销 / 重做之后选中的那一个已经不在了） */
  | "gone"
  /** 分割点离片段边缘太近 */
  | "edge"
  /** 这样裁完剩下的太短 */
  | "short"
  /** 同一段还有另一半在时间轴上，回到整段会与它重叠 */
  | "sibling"
  /** 时间轴上只剩这一个片段了，不能删 */
  | "last";

export type CutResult = { ok: true; project: CutProject } | { ok: false; issue: CutIssue };

const ok = (project: CutProject): CutResult => ({ ok: true, project });
const no = (issue: CutIssue): CutResult => ({ ok: false, issue });

// ── 指纹与校验 ────────────────────────────────────────────────

/**
 * 源段的指纹：段数 + 各段「标题 | 申报时长」的散列。
 * ★ 只取**不会在剪辑页里变**的两样：圈选重拍换的是成片地址与首尾帧，方舟直链转存换的是地址 —— 都不动它。
 *   它防的是「稿子换了一份、工程还是上一份的」：那时按旧工程铺时间轴，裁剪点会落在别人的片子上。
 */
export function segSig(segs: ReadonlyArray<{ title: string; durationSec: number }>): string {
  let h = 0x811c9dc5; // FNV-1a
  for (const s of segs) {
    const line = `${s.title}|${s.durationSec}\n`;
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `${segs.length}:${(h >>> 0).toString(36)}`;
}

/** 给一份稿子新开一份工程：一段一个片段、整段都要；有预置音轨就挂上 */
export function freshProject(
  segs: ReadonlyArray<{ title: string; durationSec: number }>,
  hasPreset: boolean,
  mkId: () => string,
): CutProject {
  return {
    v: 1,
    sig: segSig(segs),
    clips: segs.map((_, i) => ({ id: mkId(), segIndex: i, start: 0 })),
    anns: [],
    audio: hasPreset ? { kind: "preset", volume: 1 } : null,
    resId: "720",
  };
}

/**
 * 这份工程配不配得上眼前这份稿子。
 * · 稿子已经合好（segments 是单段成片）：工程里必须留着源段，且指纹是那份源段的；
 * · 稿子没合：工程不该带留底，指纹对得上，片段都指着存在的段。
 */
export function projectFits(
  p: CutProject,
  segs: ReadonlyArray<{ title: string; durationSec: number }>,
  merged: boolean,
): boolean {
  if (merged) return !!p.merged && p.merged.sources.length > 0 && p.sig === segSig(p.merged.sources);
  return !p.merged && p.sig === segSig(segs) && p.clips.length > 0 && p.clips.every((c) => c.segIndex < segs.length);
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";

/**
 * 落盘读回来的工程当**不可信输入**：形状不对的零件丢掉，骨架不对整份丢（回 null，调用方按稿子重开）。
 * ★ 一份坏工程不该让剪辑页崩掉 —— 而它恰恰是"上次崩了 / 被杀了"才留下的（与 cutSession.validate 同一条）。
 */
export function validateProject(raw: unknown): CutProject | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !isStr(o.sig) || !Array.isArray(o.clips)) return null;
  const clips: CutClip[] = [];
  for (const c of o.clips as Array<Record<string, unknown> | null>) {
    if (!c || !isStr(c.id) || !isNum(c.segIndex) || c.segIndex < 0 || !Number.isInteger(c.segIndex)) return null;
    if (!isNum(c.start) || c.start < 0) return null;
    if (c.end !== undefined && (!isNum(c.end) || c.end <= c.start)) return null;
    clips.push({ id: c.id, segIndex: c.segIndex, start: c.start, ...(c.end !== undefined ? { end: c.end as number } : {}) });
  }
  if (clips.length === 0) return null;
  const anns: CutAnn[] = [];
  for (const a of (Array.isArray(o.anns) ? o.anns : []) as Array<Record<string, unknown> | null>) {
    if (a && isStr(a.id) && isNum(a.segIndex) && isNum(a.atSec) && isStr(a.frame) && isStr(a.req)) {
      anns.push({ id: a.id, segIndex: a.segIndex, atSec: a.atSec, frame: a.frame, req: a.req });
    }
  }
  let audio: CutAudio | null = null;
  const au = o.audio as Record<string, unknown> | null | undefined;
  if (au && isNum(au.volume)) {
    const volume = Math.max(0, Math.min(1, au.volume));
    if (au.kind === "preset") audio = { kind: "preset", volume };
    // ★ 只认 idb: 指针：会话内的 blob: 地址活不过重启，读回来留着它就是一条点了没声音的配乐
    else if (au.kind === "local" && isStr(au.name) && isStr(au.ref) && au.ref.startsWith("idb:")) {
      audio = { kind: "local", name: au.name, ref: au.ref, volume };
    }
  }
  let merged: CutProject["merged"];
  const m = o.merged as { sources?: unknown; branchTree?: unknown } | undefined;
  if (m && Array.isArray(m.sources) && m.sources.length > 0) {
    const srcOk = (m.sources as Array<Record<string, unknown> | null>).every((s) => !!s && isStr(s.title) && isNum(s.durationSec));
    if (!srcOk) return null; // 留底坏了 = 「回去改」会还原出一份坏稿子，整份不要
    merged = {
      sources: m.sources as VideoSegment[],
      ...(m.branchTree && typeof m.branchTree === "object" ? { branchTree: m.branchTree as BranchTree } : {}),
    };
  }
  return { v: 1, sig: o.sig, clips, anns, audio, resId: isStr(o.resId) ? o.resId : "720", ...(merged ? { merged } : {}) };
}

// ── 读 ────────────────────────────────────────────────────────

/**
 * 这个片段的出点（秒，片内）：没裁过尾巴就是片尾，裁过就是裁的那个数。
 *
 * ★★ 裁过的出点**不拿 lens 去截**（2026-09-30 自查改掉的）：lens 在真实时长还没量出来之前是**申报值**，
 *   而白模复刻 / 参考直出的片子实际比申报长得多（申报 5 秒、实际 20 秒）。从个人页「接着剪」回来、
 *   截帧流还没到的那几秒里，一个裁在第 15 秒的出点会被截成 5 —— 这时点「下一步」，合出来的就只有 5 秒。
 *   出点超过片尾的情形（重拍换来一条更短的片子）由 sanitizeClips 拿**量出来的**长度收拾，不在这里猜。
 */
export function clipEnd(c: CutClip, lens: ReadonlyArray<number>): number {
  return c.end ?? lens[c.segIndex] ?? 0;
}

/** 这个片段在成片里占多长（秒）。下限 0.1：出点还没学到 / 入点落到片尾之外时别算出 0 或负数 */
export function clipDur(c: CutClip, lens: ReadonlyArray<number>): number {
  return Math.max(0.1, clipEnd(c, lens) - c.start);
}

/** 这个片段是不是被裁过（分割出来的兄弟片段另算，见 hasSibling） */
export function clipTrimmed(c: CutClip): boolean {
  return c.start > 0.01 || c.end !== undefined;
}

/** 同一段在时间轴上还有没有别的片段（= 这一段被分割过） */
export function hasSibling(p: CutProject, c: CutClip): boolean {
  return p.clips.some((x) => x.id !== c.id && x.segIndex === c.segIndex);
}

/**
 * 时间轴动过没有（裁过 / 删过 / 换过序 / 切过）。**判据只有这一处**：预置音轨会不会错位、提示摆不摆、
 * 合完之后那句话说不说，读的都是它。
 */
export function timelineTouched(p: CutProject, segCount: number): boolean {
  return p.clips.length !== segCount || p.clips.some((c, i) => c.segIndex !== i || clipTrimmed(c));
}

// ── 改（每一个都回新对象，不动传进来的那份） ─────────────────────

function withClips(p: CutProject, clips: CutClip[]): CutProject {
  return { ...p, clips };
}

/** 把一个片段在 at（秒，片内）处切成两半；后一半用 newId */
export function splitClip(p: CutProject, clipId: string, at: number, newId: string, lens: ReadonlyArray<number>): CutResult {
  const i = p.clips.findIndex((c) => c.id === clipId);
  if (i < 0) return no("gone");
  const c = p.clips[i];
  if (at - c.start < MIN_CLIP_SEC || clipEnd(c, lens) - at < MIN_CLIP_SEC) return no("edge");
  // 后一半原样带着原来的出点（缺省的仍然缺省 = 跟着片尾走）
  const a: CutClip = { ...c, end: at };
  const b: CutClip = { ...c, id: newId, start: at };
  return ok(withClips(p, [...p.clips.slice(0, i), a, b, ...p.clips.slice(i + 1)]));
}

/** 裁头 / 裁尾：把入点或出点挪到 at（秒，片内） */
export function trimClip(
  p: CutProject,
  clipId: string,
  edge: "start" | "end",
  at: number,
  lens: ReadonlyArray<number>,
): CutResult {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return no("gone");
  let next: CutClip;
  if (edge === "start") {
    next = { ...c, start: at <= 0.01 ? 0 : at };
  } else if (at >= (lens[c.segIndex] ?? 0) - 0.01) {
    // 出点落在片尾上 = 没裁尾巴：写回缺省，别留一个"等于片尾"的数（那样这一段会被当成裁过）
    next = { id: c.id, segIndex: c.segIndex, start: c.start };
  } else {
    next = { ...c, end: at };
  }
  if (clipEnd(next, lens) - next.start < MIN_CLIP_SEC) return no("short");
  return ok(withClips(p, p.clips.map((x) => (x.id === clipId ? next : x))));
}

/**
 * 还原这一段的裁剪（回到整段）。
 * ★★ 分割出来的兄弟片段**共用同一个 segIndex**，只靠 start/end 分区间。无条件回到整段 = 与旁边那一半重叠
 *   ⇒ 成片里同一截播两遍（A[0,10] + B[5,10] 出来 15 秒），而两半共用同一张缩略图、屏幕上没有任何重叠提示。
 */
export function resetClip(p: CutProject, clipId: string): CutResult {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return no("gone");
  if (hasSibling(p, c)) return no("sibling");
  return ok(withClips(p, p.clips.map((x) => (x.id === clipId ? { id: x.id, segIndex: x.segIndex, start: 0 } : x))));
}

export function removeClip(p: CutProject, clipId: string): CutResult {
  if (!p.clips.some((c) => c.id === clipId)) return no("gone");
  if (p.clips.length <= 1) return no("last");
  return ok(withClips(p, p.clips.filter((c) => c.id !== clipId)));
}

/**
 * 稿子里**不在时间轴上**的那些段（段号，0 起）：片段被删光了的段。
 *
 * ★★ 为什么要能问出来（2026-09-30）：时间轴落盘之后，「删片段」不再是离开这一页就自动复原的事 ——
 *   而每一段都是花钱炼出来的。撤销只管得到栈里还有的那几步（App 一重启栈就没了），所以必须另有一条
 *   **不靠撤销**的路把段加回来（restoreSeg），否则一段付过钱的成片会在界面上彻底够不着。
 */
export function missingSegs(p: CutProject, segCount: number): number[] {
  const have = new Set(p.clips.map((c) => c.segIndex));
  const out: number[] = [];
  for (let i = 0; i < segCount; i++) if (!have.has(i)) out.push(i);
  return out;
}

/**
 * 把一个不在时间轴上的段整段加回来。落点按段号排：插在第一个段号比它大的片段前面，没有就接在最后
 * （用户换过序的话这只是个合理的起点，加回来之后照常能挪）。已经在时间轴上的段不重复加（原样返回）。
 */
export function restoreSeg(p: CutProject, segIndex: number, newId: string): CutProject {
  if (segIndex < 0 || p.clips.some((c) => c.segIndex === segIndex)) return p;
  const at = p.clips.findIndex((c) => c.segIndex > segIndex);
  const clip: CutClip = { id: newId, segIndex, start: 0 };
  const clips = at < 0 ? [...p.clips, clip] : [...p.clips.slice(0, at), clip, ...p.clips.slice(at)];
  return withClips(p, clips);
}

/** 前移 / 后移一格。到头了原样返回（不算错：按钮本来就该是灰的） */
export function moveClip(p: CutProject, clipId: string, dir: 1 | -1): CutResult {
  const i = p.clips.findIndex((c) => c.id === clipId);
  if (i < 0) return no("gone");
  const j = i + dir;
  if (j < 0 || j >= p.clips.length) return ok(p);
  const next = p.clips.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return ok(withClips(p, next));
}

/** 拖拽换序：把 fromId 挪到 toId 现在的位置 */
export function reorderClip(p: CutProject, fromId: string, toId: string): CutResult {
  const fi = p.clips.findIndex((c) => c.id === fromId);
  const ti = p.clips.findIndex((c) => c.id === toId);
  if (fi < 0 || ti < 0) return no("gone");
  if (fi === ti) return ok(p);
  const next = p.clips.slice();
  const [moved] = next.splice(fi, 1);
  next.splice(ti, 0, moved);
  return ok(withClips(p, next));
}

export function addAnn(p: CutProject, ann: CutAnn): CutProject {
  return { ...p, anns: [...p.anns, ann] };
}

export function removeAnn(p: CutProject, annId: string): CutProject {
  return { ...p, anns: p.anns.filter((a) => a.id !== annId) };
}

/** 这一段的圈选全清（重拍落地之后：它们已经兑现成新的成片了） */
export function dropAnnsOfSeg(p: CutProject, segIndex: number): CutProject {
  return p.anns.some((a) => a.segIndex === segIndex) ? { ...p, anns: p.anns.filter((a) => a.segIndex !== segIndex) } : p;
}

export function setAudio(p: CutProject, audio: CutAudio | null): CutProject {
  return { ...p, audio };
}

export function setAudioVolume(p: CutProject, volume: number): CutProject {
  if (!p.audio) return p;
  return { ...p, audio: { ...p.audio, volume: Math.max(0, Math.min(1, volume)) } };
}

export function setRes(p: CutProject, resId: string): CutProject {
  return p.resId === resId ? p : { ...p, resId };
}

/** 合并那一拍：把源段留底（稿子的 segments 马上要换成单段成片） */
export function markMerged(p: CutProject, sources: VideoSegment[], branchTree: BranchTree | undefined): CutProject {
  return { ...p, merged: { sources, ...(branchTree ? { branchTree } : {}) } };
}

/** 「回去改」：源段已经还原回稿子里了，留底撤掉 */
export function unmarkMerged(p: CutProject): CutProject {
  if (!p.merged) return p;
  const rest: CutProject = { ...p };
  delete rest.merged;
  return rest;
}

/**
 * 量到一段的**真实**长度之后把片段收拾一遍（重拍换来一条更短的片子时才会有东西要收拾）：
 * · 出点落到片尾之外 → 改回"到片尾"；
 * · 入点落到片尾之外 → 这一段只剩它一个就回到整段；它是分割出来的一半就直接拿掉
 *   （回到整段会与另一半重叠，见 resetClip 的 ★★）。
 * 没有要动的原样返回（同一个引用），调用方据此判断要不要写回。
 *
 * ★★ `realLens` 只许放**量出来的**长度，没量过的那一格留 undefined（这一格的片段一个都不动）。
 *   拿申报值来收拾会把用户裁好的片段当成越界的毁掉：申报 5 秒、实际 20 秒的白模段，裁在第 12 秒的入点
 *   按申报值看就是"落到片尾之外"（理由同 clipEnd 的 ★★）。
 */
export function sanitizeClips(p: CutProject, realLens: ReadonlyArray<number | undefined>): CutProject {
  const known = (c: CutClip) => {
    const len = realLens[c.segIndex];
    return len !== undefined && len > 0 ? len : null;
  };
  const startOut = (c: CutClip) => {
    const len = known(c);
    return len !== null && c.start > len - MIN_CLIP_SEC + 0.001;
  };
  const endOut = (c: CutClip) => {
    const len = known(c);
    return len !== null && c.end !== undefined && c.end > len + 0.01;
  };
  if (!p.clips.some((c) => startOut(c) || endOut(c))) return p;
  const clips: CutClip[] = [];
  for (const c of p.clips) {
    if (startOut(c)) {
      if (!hasSibling(p, c)) clips.push({ id: c.id, segIndex: c.segIndex, start: 0 });
    } else if (endOut(c)) {
      clips.push({ id: c.id, segIndex: c.segIndex, start: c.start });
    } else {
      clips.push(c);
    }
  }
  // 极端情形：全是越界的、又都互为兄弟 —— 留第一个并回到整段，时间轴不能空着
  if (clips.length === 0) clips.push({ id: p.clips[0].id, segIndex: p.clips[0].segIndex, start: 0 });
  return withClips(p, clips);
}

// ── 交给合成器的那张表 ─────────────────────────────────────────

export interface TimelineClip {
  /** 公网地址（原生合成器自己流式取） */
  url: string;
  startSec: number;
  /** 缺省 = 到片尾（原生那边不设结束点） */
  endSec?: number;
  /** 稿子里的第几段（0 起），给调用方回头查这一段的画幅 / 有没有声音 */
  segIndex: number;
}

export type TimelineIssue =
  /** 这一段还没有视频（只有设定帧） */
  | "no-video"
  /** 这一段是已经合好的本机成片（idb:），不能再合一次 */
  | "local-merged"
  /** 这一段还不是永久地址（blob: 之类） */
  | "not-permanent";

export type TimelineResult =
  | { ok: true; clips: TimelineClip[]; total: number }
  | { ok: false; issue: TimelineIssue; segNo: number };

/**
 * 时间轴 → 合成器吃的片段表。**这张表只在这里出**：合并拿它喂原生，预览拿它算总时长与播放头。
 * ★ 指着不存在的段的片段直接略过（合并那一拍稿子换成单段成片时，页面会带着旧片段表重渲染一次）。
 */
export function compileTimeline(
  p: CutProject,
  segs: ReadonlyArray<{ videoUrl?: string } | undefined>,
  lens: ReadonlyArray<number>,
): TimelineResult {
  const clips: TimelineClip[] = [];
  let total = 0;
  for (const c of p.clips) {
    const seg = segs[c.segIndex];
    if (!seg) continue;
    const url = (seg.videoUrl || "").trim();
    if (!url) return { ok: false, issue: "no-video", segNo: c.segIndex + 1 };
    if (!/^https?:/i.test(url)) {
      return { ok: false, issue: url.startsWith("idb:") ? "local-merged" : "not-permanent", segNo: c.segIndex + 1 };
    }
    clips.push({ url, startSec: c.start, ...(c.end !== undefined ? { endSec: clipEnd(c, lens) } : {}), segIndex: c.segIndex });
    total += clipDur(c, lens);
  }
  return { ok: true, clips, total };
}
