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

// ── 包装层的数（P1）。★ 标着「起始值」的几个没有"对的答案"，是按听感 / 观感调的旋钮：先照教程与常见做法给一个数，
//   真机上听过看过再改 —— 改只改这里，预览（剪辑页的 DOM 叠层）与导出（原生合成器）读的是同一份 ──

/** 变速只给这几档（曲线变速明确不做，见 docs/cut-autoedit-research.md「明确不做」） */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** 闪黑：上一段尾巴淡出到黑、这一段开头从黑淡入，**各**这么久（秒）。起始值 */
export const FADE_SEC = 0.35;
/** 片尾淡出（画面到黑 + 声音收掉）的长度（秒）。起始值 */
export const END_FADE_SEC = 0.8;
/** 有配乐但没开片尾淡出时，声音在最后这么久里收掉 —— 循环的配乐在片尾被一刀切断很刺耳。起始值 */
export const BGM_TAIL_SEC = 0.5;
/** 字幕 / 配音比片段开头晚这么久出来（别贴着切点）。起始值 */
export const LINE_LEAD_SEC = 0.15;
/** 两句配音之间至少隔这么久（上一句念超了，下一句往后顺）。起始值 */
export const VOICE_GAP_SEC = 0.15;
/** 配音念完之后字幕再留这么久。起始值 */
export const CAPTION_LINGER_SEC = 0.25;
/** 一条字幕 / 一句配音至少要有这么长的位置，不够就不出（一闪而过的字没法读，半句话比不念更怪） */
export const LINE_MIN_SEC = 0.3;
/** 片头标题：从第几秒出、挂多久。起始值 */
export const TITLE_AT_SEC = 0.2;
export const TITLE_SEC = 2.6;
/** 有配音的成片里，配乐压到原来的几成（配音为主）。起始值：教程给的配平是「配音 75%、配乐 20%」 */
export const BGM_DUCK = 0.35;
/** 有配音的那一段，原声自动压到几成（人没动过原声滑杆时）。起始值 */
export const BED_GAIN = 0.35;
/**
 * 估算用的语速（每秒几个字）。**只用来估**：给字数封顶、决定要不要先提一档语速；真正排时间用的是合成之后量出来的时长。
 * 出处：服务端 routes/tts.routes.js 头部那条实测「一条 25 字台词 ≈ 49KB」，按 64kbps 折约 6 秒 ≈ 4 字/秒。
 * ⚠ 那是铸卡师那把嗓子（语速 -10）量的，没按配音音色逐个复量。
 */
export const TTS_CPS = 4;
/** 一句字幕 / 旁白最长算多少个"字"（lineUnits 的单位）。再长就该切成两段了 */
export const LINE_MAX = 80;
/** 一句字幕 / 旁白最多存多少个字符（落盘与输入框的硬上限）。服务端 /api/tts 单次上限是 300，留一点余量 */
export const LINE_MAX_CHARS = 240;

/**
 * 一句话念出来有多"长"，单位是「一个汉字」：汉字 / 假名 / 韩文一个算 1，拉丁字母与数字一个算 0.3，空格与标点不算。
 *
 * ★ 为什么不直接数字符（2026-09-30 模拟器上撞到的）：汉字一秒念四个，英文一秒能念十二三个字母。按字符数封顶的话，
 *   6 秒的片段只写得下二十几个字母 —— 四五个英文词，而它本来念得完十五个。
 * ★ 0.3 是照常见语速折的（英文约每分钟 150 词、一词五个字母 ≈ 每秒 12.5 个字母 ≈ 3.75 个"字"，与 TTS_CPS 对得上），
 *   没按音色实测 —— 与 TTS_CPS 一样只用来估，排时间靠合成之后量出来的时长。
 */
export function lineUnits(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (/[\s\p{P}\p{S}]/u.test(ch)) continue;
    n += (ch.codePointAt(0) ?? 0) < 0x2e80 ? 0.3 : 1;
  }
  return n;
}
/** 片头标题的上限（字） */
export const TITLE_MAX = 24;

/**
 * 这一段念得完多长的一句话（单位同 lineUnits：一个汉字算 1；按片段在成片里的时长估）。
 * 字幕页签上的计数拿它当分母、配音合成前拿它把关 —— 「字数按时长封顶」是主人 2026-09-30 定的限量：
 * 配音按字符计费是平台的真成本，现在不向用户收。只写字幕不配音的不拦（写多了只是读不完，由人自己取舍）。
 * ★ 给 1.2 倍的宽裕：念不完时还能提一档语速（见 studio/cutNarration），下限 8 个字（再短的片段也得写得下一句话）。
 */
export function lineCap(outDurSec: number): number {
  return Math.max(8, Math.min(LINE_MAX, Math.floor(outDurSec * TTS_CPS * 1.2)));
}

/**
 * 一条配音：合成好的那份声音 + 它是照着什么合成的。
 * ★ `text` / `voiceId` 记的是**合成那一刻**的字与音色：之后字改了、音色换了，这条配音就"过期"了（voiceStale）——
 *   不悄悄删掉（那是花一次合成换来的），也不悄悄留着装没事（成片里念的会和字幕对不上），由界面标出来让人重配。
 */
export interface CutVoice {
  /** `idb:cutvoice:<键>`：blob 在本地库里（与本地配乐同一种指针，cacheSweep 认得） */
  ref: string;
  /** **量出来的**时长（秒），不是按字数估的 */
  durSec: number;
  voiceId: string;
  text: string;
  /** 合成时用的语速（TTS 的 speech_rate，0 = 原速）。念不完本段时会提一档再合一次，记下来是为了让人看得见 */
  rate?: number;
}

/** 片段上的一句话：既是字幕，也是旁白的稿子（有 voice 才有声音）。一段一句（主人 2026-09-30 定的限量） */
export interface CutLine {
  text: string;
  voice?: CutVoice;
}

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
  // ── 包装层（P1）：都挂在片段上 —— 片段被裁、被挪、被删，它们跟着走 ──
  /** 变速（SPEEDS 里的一档；缺省 1）。画面与原声一起变 */
  speed?: number;
  /**
   * 这一段原声的音量（0~1；0 = 静音）。**缺省 = 自动**：没配音时原样（1），有配音时压到 BED_GAIN（配音为主）。
   * 人动过滑杆之后才是一个明确的数，从此不再自动。
   */
  volume?: number;
  /** 这一段**从黑里进来**（闪黑转场：上一段的尾巴淡出到黑，这一段的开头从黑淡入）。只有这一种转场 */
  fade?: true;
  line?: CutLine;
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
  /** 片头标题（烧在成片开头几秒）。与发布时填的作品标题是两回事：这一个进画面 */
  title?: string;
  /** 字幕**不**烧进画面（只留配音）。缺省是烧：写了字就是想让人看见 */
  capOff?: true;
  /** 配音用哪个音色（TTS 的音色 id）。缺省由剪辑页给（studio/cutNarration 的 DEFAULT_NARRATOR） */
  voiceId?: string;
  /** 片尾淡出：最后一段的画面淡到黑，声音一起收掉 */
  endFade?: true;
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
    const clip: CutClip = { id: c.id, segIndex: c.segIndex, start: c.start, ...(c.end !== undefined ? { end: c.end as number } : {}) };
    // 包装层的零件：形状不对的**只丢那一件**（片段本身留着）—— 一句坏字幕不该让整条时间轴作废
    if (isNum(c.speed) && c.speed !== 1 && (SPEEDS as ReadonlyArray<number>).includes(c.speed)) clip.speed = c.speed;
    if (isNum(c.volume)) clip.volume = Math.max(0, Math.min(1, c.volume));
    if (c.fade === true) clip.fade = true;
    const line = validLine(c.line);
    if (line) clip.line = line;
    clips.push(clip);
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
  const title = isStr(o.title) ? o.title.trim().slice(0, TITLE_MAX) : "";
  return {
    v: 1,
    sig: o.sig,
    clips,
    anns,
    audio,
    resId: isStr(o.resId) ? o.resId : "720",
    ...(title ? { title } : {}),
    ...(o.capOff === true ? { capOff: true as const } : {}),
    ...(isStr(o.voiceId) && /^[a-zA-Z0-9_.-]{1,64}$/.test(o.voiceId) ? { voiceId: o.voiceId } : {}),
    ...(o.endFade === true ? { endFade: true as const } : {}),
    ...(merged ? { merged } : {}),
  };
}

/** 落盘读回来的一句字幕 / 配音。字不成形整句不要；配音不成形只丢配音（字留着） */
function validLine(raw: unknown): CutLine | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  if (!isStr(l.text)) return null;
  const text = l.text.slice(0, LINE_MAX_CHARS);
  if (!text.trim()) return null;
  const v = l.voice as Record<string, unknown> | undefined;
  // ★ 配音只认 idb: 指针（同本地配乐那条：会话内的 blob: 地址活不过重启，留着就是一条点了没声音的配音）
  if (v && isStr(v.ref) && v.ref.startsWith("idb:") && isNum(v.durSec) && v.durSec > 0 && isStr(v.voiceId) && isStr(v.text)) {
    return { text, voice: { ref: v.ref, durSec: v.durSec, voiceId: v.voiceId, text: v.text, ...(isNum(v.rate) && v.rate !== 0 ? { rate: v.rate } : {}) } };
  }
  return { text };
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

/**
 * 这个片段取了素材里多长的一截（秒，**片内**时间）。下限 0.1：出点还没学到 / 入点落到片尾之外时别算出 0 或负数。
 * ★ 变速之后它**不等于**在成片里占多长 —— 那个问 clipOutDur。分割 / 裁剪按片内时间下刀，用这个；
 *   时间轴总长、播放头、字幕与配音的时间一律按成片时间算，用 clipOutDur。
 */
export function clipDur(c: CutClip, lens: ReadonlyArray<number>): number {
  return Math.max(0.1, clipEnd(c, lens) - c.start);
}

/** 这个片段的速度（缺省 1） */
export function clipSpeed(c: CutClip): number {
  return c.speed && c.speed > 0 ? c.speed : 1;
}

/** 这个片段在**成片**里占多长（秒）：取的那一截 ÷ 速度 */
export function clipOutDur(c: CutClip, lens: ReadonlyArray<number>): number {
  return clipDur(c, lens) / clipSpeed(c);
}

/** 这一段的配音是不是真的会响（有配音、量到了时长） */
function voiced(c: CutClip): boolean {
  return !!c.line?.voice && c.line.voice.durSec > 0;
}

/**
 * 这个片段的原声按几成出（**唯一判定**：预览的 <video>.volume 与合成器那张表读的都是它）。
 * 人定过就按人定的；没定过的，有配音时自动压到 BED_GAIN（配音为主），没配音原样。
 */
export function clipVolume(c: CutClip): number {
  if (c.volume !== undefined) return Math.max(0, Math.min(1, c.volume));
  return voiced(c) ? BED_GAIN : 1;
}

/**
 * 时间轴上第 i 个片段与它**前面那个**之间的接缝，是不是同一个镜头在延续：
 *   · 同一段被切开的两半、切点对得上（分割出来的）；
 *   · 后一个是某段的开头、前一个是上一段的结尾，而那一段记着「接着上一段拍的」（VideoSegment.carried）。
 * 为真 = 在这儿加转场会把接缝撕开（剪辑页给提示；之后的一键成片不往这儿加）。
 * 回 null = **不知道**（老剪辑稿没有 carried 这一位）—— 用的地方按「不知道就不自动加」走。
 */
export function seamContinuous(
  p: CutProject,
  i: number,
  segs: ReadonlyArray<{ carried?: boolean } | undefined>,
): boolean | null {
  const cur = p.clips[i];
  const prev = p.clips[i - 1];
  if (!cur || !prev) return false;
  if (prev.segIndex === cur.segIndex) return prev.end !== undefined && Math.abs(prev.end - cur.start) < 0.02;
  // 不是相邻两段的「结尾 → 开头」：中间删过、换过序、裁过头尾，接缝已经不是原来那一条了
  if (cur.segIndex !== prev.segIndex + 1 || cur.start > 0.01 || prev.end !== undefined) return false;
  const carried = segs[cur.segIndex]?.carried;
  return carried === undefined ? null : carried;
}

/** 这一句的配音过期了没有：字改过、或者工程换了音色，而声音还是之前合成的那一版 */
export function voiceStale(line: CutLine | undefined, voiceId: string): boolean {
  const v = line?.voice;
  return !!v && (v.text !== line!.text || v.voiceId !== voiceId);
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
  // 变速也算：预置的原片音轨是按原速从头混的，画面一变速就对不上了
  return p.clips.length !== segCount || p.clips.some((c, i) => c.segIndex !== i || clipTrimmed(c) || clipSpeed(c) !== 1);
}

// ── 改（每一个都回新对象，不动传进来的那份） ─────────────────────

function withClips(p: CutProject, clips: CutClip[]): CutProject {
  return { ...p, clips };
}

/**
 * 换一个片段的截取范围，**别的原样带着**（变速 / 原声 / 转场 / 字幕与配音）。
 * ★ 改范围的地方一律走它，别再手写 `{ id, segIndex, start }` —— 那种写法在片段上只有三格的时候没问题，
 *   包装层挂上来之后就是"裁一刀，这一段的字幕和配音没了"，零报错。
 */
function ranged(c: CutClip, start: number, end: number | undefined): CutClip {
  const next: CutClip = { ...c, start };
  if (end === undefined) delete next.end;
  else next.end = end;
  return next;
}

/** 把一个片段在 at（秒，片内）处切成两半；后一半用 newId */
export function splitClip(p: CutProject, clipId: string, at: number, newId: string, lens: ReadonlyArray<number>): CutResult {
  const i = p.clips.findIndex((c) => c.id === clipId);
  if (i < 0) return no("gone");
  const c = p.clips[i];
  if (at - c.start < MIN_CLIP_SEC || clipEnd(c, lens) - at < MIN_CLIP_SEC) return no("edge");
  // 后一半原样带着原来的出点（缺省的仍然缺省 = 跟着片尾走）
  const a: CutClip = { ...c, end: at };
  // ★ 字幕 / 配音与「从黑里进来」留在**前一半**：一句话不该因为切了一刀变成两句（配音会念两遍），
  //   闪黑说的是这一段的开头 —— 切出来的后一半没有"开头"。变速与原声音量两半都带着（它们说的是整截素材）
  const b: CutClip = { ...c, id: newId, start: at };
  delete b.line;
  delete b.fade;
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
    next = ranged(c, c.start, undefined);
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
  return ok(withClips(p, p.clips.map((x) => (x.id === clipId ? ranged(x, 0, undefined) : x))));
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

// ── 包装层的改法（P1）────────────────────────────────────────────

/** 改一个片段（找不到回 gone）。fn 回同一个引用 = 没变，工程也原样返回 */
function editClip(p: CutProject, clipId: string, fn: (c: CutClip) => CutClip): CutResult {
  const c = p.clips.find((x) => x.id === clipId);
  if (!c) return no("gone");
  const next = fn(c);
  return ok(next === c ? p : withClips(p, p.clips.map((x) => (x.id === clipId ? next : x))));
}

/** 变速。不在 SPEEDS 里的数就近取一档（这个数之后会从「对剪辑台说话」那条路来，是不可信输入）；1 = 回到原速 */
export function setClipSpeed(p: CutProject, clipId: string, speed: number): CutResult {
  const snap = SPEEDS.reduce<number>((best, s) => (Math.abs(s - speed) < Math.abs(best - speed) ? s : best), 1);
  return editClip(p, clipId, (c) => {
    if (clipSpeed(c) === snap) return c;
    const next: CutClip = { ...c };
    if (snap === 1) delete next.speed;
    else next.speed = snap;
    return next;
  });
}

/** 这一段原声的音量（0~1）。null = 交回自动（见 clipVolume） */
export function setClipVolume(p: CutProject, clipId: string, volume: number | null): CutResult {
  return editClip(p, clipId, (c) => {
    const next: CutClip = { ...c };
    if (volume === null) {
      if (c.volume === undefined) return c;
      delete next.volume;
    } else {
      const v = Math.max(0, Math.min(1, volume));
      if (c.volume === v) return c;
      next.volume = v;
    }
    return next;
  });
}

/** 这一段要不要「从黑里进来」（闪黑转场） */
export function setClipFade(p: CutProject, clipId: string, on: boolean): CutResult {
  return editClip(p, clipId, (c) => {
    if (!!c.fade === on) return c;
    const next: CutClip = { ...c };
    if (on) next.fade = true;
    else delete next.fade;
    return next;
  });
}

/**
 * 写这一段的字幕 / 旁白。空串 = 去掉这一句（配音跟着去掉：没有字的配音没法改、也没法对）。
 * ★ 不在这里 trim：输入框一边打字一边写回，trim 掉行尾的空格就打不出英文的词间空格了。
 *   只有空白的那种由排时间的地方（timelinePlan）当成没有。
 * ★ 改字**不动**已有的配音：它从此是"过期"的（voiceStale），由界面标出来 —— 悄悄删掉等于替人扔了一次合成。
 */
export function setClipLine(p: CutProject, clipId: string, text: string): CutResult {
  const t = text.slice(0, LINE_MAX_CHARS);
  return editClip(p, clipId, (c) => {
    if ((c.line?.text ?? "") === t) return c;
    const next: CutClip = { ...c };
    if (t === "") delete next.line;
    else next.line = { ...(c.line ?? {}), text: t };
    return next;
  });
}

/** 挂上 / 去掉这一句的配音。这一段没有字时挂不上（原样返回） */
export function setClipVoice(p: CutProject, clipId: string, voice: CutVoice | null): CutResult {
  return editClip(p, clipId, (c) => {
    if (!c.line) return c;
    if (!voice) {
      if (!c.line.voice) return c;
      return { ...c, line: { text: c.line.text } };
    }
    return { ...c, line: { text: c.line.text, voice } };
  });
}

export function setTitle(p: CutProject, title: string): CutProject {
  const t = title.slice(0, TITLE_MAX);
  if ((p.title ?? "") === t) return p;
  const next: CutProject = { ...p };
  if (t === "") delete next.title;
  else next.title = t;
  return next;
}

/** 字幕烧不烧进画面（关掉之后只留配音） */
export function setCaptionsOn(p: CutProject, on: boolean): CutProject {
  if (!p.capOff === on) return p;
  const next: CutProject = { ...p };
  if (on) delete next.capOff;
  else next.capOff = true;
  return next;
}

export function setVoiceId(p: CutProject, voiceId: string): CutProject {
  return p.voiceId === voiceId ? p : { ...p, voiceId };
}

export function setEndFade(p: CutProject, on: boolean): CutProject {
  if (!!p.endFade === on) return p;
  const next: CutProject = { ...p };
  if (on) next.endFade = true;
  else delete next.endFade;
  return next;
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
      if (!hasSibling(p, c)) clips.push(ranged(c, 0, undefined));
    } else if (endOut(c)) {
      clips.push(ranged(c, c.start, undefined));
    } else {
      clips.push(c);
    }
  }
  // 极端情形：全是越界的、又都互为兄弟 —— 留第一个并回到整段，时间轴不能空着
  if (clips.length === 0) clips.push(ranged(p.clips[0], 0, undefined));
  return withClips(p, clips);
}

// ── 字幕怎么排：版式、分行、分页 ──────────────────────────────────

/** 成片的画幅（像素）。字幕一行放得下几个字跟它有关 */
export interface Frame {
  w: number;
  h: number;
}

export interface CaptionLayout {
  /** 字高 ÷ 画面最短边 */
  sizeRatio: number;
  /** 最后一行的基线离底边多远 ÷ 画面高 */
  bottomRatio: number;
  /** 一行最宽 ÷ 画面宽 */
  maxWidthRatio: number;
  /** 一行放得下几个"全角字宽"（由上面三个数算出来的，分行拿它当尺） */
  unitsPerLine: number;
  /** 标题的字比字幕大几倍 */
  titleScale: number;
  /** 标题第一行的基线离顶边多远 ÷ 画面高 */
  titleTopRatio: number;
  titleUnitsPerLine: number;
}

/**
 * 字幕 / 标题摆在画面的哪儿、多大、一行多宽。**这几个数是量出来的**（2026-09-30，360×800 的视口上量首页那一屏）——
 * 烧进画面的字被自家界面盖住，是最蠢的一种白做：
 *   · 竖屏片在首页是 `object-fit: cover`：9:16 的片子在 9:20 的屏上放大到 450px 宽，左右各裁掉 45px
 *     ⇒ 画面只有中间 **10%~90%** 看得见；
 *   · 右侧操作栏的按钮左缘在屏幕 x=296（按钮盒 296~352、图标 310~338）⇒ 折回画面是宽度的 **75.8%**；
 *   · 左下角的作者 / 标题 / 简介那一块，顶沿离屏幕底 197px（一行标题 + 两行简介 + 一排芯片）= 高度的 **24.6%**，
 *     标题折两行时 221px = 27.6%。
 *   ⇒ 竖屏：最后一行的基线放在离底 **28%**（压着那一块的上沿过）；一行最宽 **58%**（居中时右端在画面 79%，
 *     折回屏幕 x≈310，正好停在操作栏图标的左缘；写满一行才会碰到它）。
 *   · 横屏片在首页是 contain（上下留黑），画面底部没有东西压着；右侧操作栏折回画面是宽度的 82.2%
 *     ⇒ 横屏：基线离底 9%，一行最宽 62%。
 * ★ 字高按**最短边**算（与显式标识同一把尺，见 data/aigcLabel）：竖屏 5%（720 宽上是 36px，一行 11 个字），
 *   横屏 6%（720 高上是 43px，一行 18 个字）。
 * ★ 右下角的显式标识（开头 2.5 秒）在竖屏离底 5%~9%，够不到字幕；横屏与字幕同高，但它在画面 83% 以右、字幕到 81% 为止。
 */
export function captionLayout(frame: Frame): CaptionLayout {
  const w = Math.max(16, frame.w);
  const h = Math.max(16, frame.h);
  const portrait = h >= w;
  const sizeRatio = portrait ? 0.05 : 0.06;
  const maxWidthRatio = portrait ? 0.58 : 0.62;
  const titleScale = 1.5;
  const px = sizeRatio * Math.min(w, h);
  return {
    sizeRatio,
    bottomRatio: portrait ? 0.28 : 0.09,
    maxWidthRatio,
    unitsPerLine: Math.max(4, Math.floor((maxWidthRatio * w) / px)),
    titleScale,
    titleTopRatio: 0.2,
    titleUnitsPerLine: Math.max(3, Math.floor((maxWidthRatio * w) / (px * titleScale))),
  };
}

/**
 * 一个字符占几个"全角字宽"。**估的**（照安卓默认粗体那套字的比例）：汉字 / 假名 / 全角标点 1，
 * 大写字母 0.68，小写与数字 0.58，西文标点 0.36，空格 0.3。往宽里估 —— 估窄了一行会比安全宽度长，
 * 估宽了只是早一点换行。
 */
export function charUnits(ch: string): number {
  if (ch === " ") return 0.3;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) {
    if (code >= 0x41 && code <= 0x5a) return 0.68;
    if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) return 0.58;
    return 0.36;
  }
  // 拉丁扩展 / 西里尔 / 弯引号这一带是窄的；省略号与破折号在中文里按全角画
  if (code < 0x2e80) return code === 0x2026 || code === 0x2014 ? 1 : 0.62;
  return 1;
}

/** 不许出现在行首的标点：粘在前一个词上 */
const CLOSERS = "，。！？、；：,.!?;:…）)」』】》〉”’％%";
/** 不许出现在行尾的标点：粘在后一个词上 */
const OPENERS = "（(「『【《〈“‘";
/** 一个短语到它为止（断在它后面最自然） */
const PHRASE_END = "，。！？、；：,.!?;:…";
/** 行尾的这几个不画出来（短视频字幕的惯例：行尾不带逗号句号；问号、叹号、省略号是语气，留着） */
const LINE_TRIM = "，。、；：,.;:";

interface Tok {
  s: string;
  w: number;
  space: boolean;
}

function unitsOf(s: string): number {
  let w = 0;
  for (const ch of s) w += charUnits(ch);
  return w;
}

type WordSegmenter = { segment(s: string): Iterable<{ segment: string }> };
let segmenter: WordSegmenter | null | undefined;

/**
 * 一串汉字切成词（"然后" "信使" 这种不从中间断开）。用运行环境自带的分词（Intl.Segmenter，WebView 与 Node 都有）；
 * 没有就退成一个字一块 —— 只是断行没那么讲究，不影响别的。
 * ★ 分词只在这一处用、结果随后交给两个渲染器照着画，所以不同机器上分得不一样也不会让预览与成片对不上。
 */
function wordsOf(run: string): string[] {
  if (segmenter === undefined) {
    try {
      const I = Intl as unknown as { Segmenter?: new (locale: string, opts: { granularity: "word" }) => WordSegmenter };
      segmenter = I.Segmenter ? new I.Segmenter("zh", { granularity: "word" }) : null;
    } catch {
      segmenter = null;
    }
  }
  if (!segmenter) return Array.from(run);
  const out: string[] = [];
  for (const { segment } of segmenter.segment(run)) {
    const chars = Array.from(segment);
    // 四个字以内的词不拆；更长的多半是分词器没认出来的一串，按字拆（留着它会让一行排不满）
    if (chars.length <= 4) out.push(segment);
    else out.push(...chars);
  }
  return out;
}

/**
 * 把一句话切成"不能再从中间断开"的小块：汉字按词；一串拉丁字母 / 数字是一个词；
 * 收尾的标点粘在前一块上、起头的标点粘在后一块上；空格单列（落在行尾时不画）。
 */
function tokenize(text: string): Tok[] {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  const out: Tok[] = [];
  const isPunct = (c: string) => CLOSERS.includes(c) || OPENERS.includes(c);
  const narrow = (c: string) => c !== " " && charUnits(c) < 1 && !OPENERS.includes(c);
  const wide = (c: string) => c !== " " && charUnits(c) >= 1 && !isPunct(c);
  let open = "";
  const push = (s: string) => {
    out.push({ s: open + s, w: unitsOf(open + s), space: false });
    open = "";
  };
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === " ") {
      if (out.length > 0 && !out[out.length - 1].space) out.push({ s: " ", w: charUnits(" "), space: true });
      i++;
      continue;
    }
    if (OPENERS.includes(ch)) {
      open += ch;
      i++;
      continue;
    }
    const last = out[out.length - 1];
    if (CLOSERS.includes(ch) && last && !last.space && !open) {
      last.s += ch;
      last.w += charUnits(ch);
      i++;
      continue;
    }
    if (wide(ch)) {
      let run = ch;
      i++;
      while (i < chars.length && wide(chars[i])) run += chars[i++];
      for (const word of wordsOf(run)) push(word);
      continue;
    }
    let s = ch;
    i++;
    if (narrow(ch) && !CLOSERS.includes(ch)) {
      // 词里面的句点 / 撇号（3.5、it’s）不算收尾：后面紧跟着还是窄字符就接着往下并
      while (
        i < chars.length &&
        narrow(chars[i]) &&
        (!CLOSERS.includes(chars[i]) || (i + 1 < chars.length && narrow(chars[i + 1]) && !CLOSERS.includes(chars[i + 1])))
      ) {
        s += chars[i];
        i++;
      }
    }
    push(s);
  }
  if (open) {
    // 落单的起头标点（一句话以「（」结尾）：粘到最后一块后面，别丢字
    const last = out[out.length - 1];
    if (last && !last.space) {
      last.s += open;
      last.w += unitsOf(open);
    } else out.push({ s: open, w: unitsOf(open), space: false });
  }
  while (out.length > 0 && out[out.length - 1].space) out.pop();
  return out;
}

/** 比一行还宽的块（长网址 / 长单词）按字符硬拆 —— 不拆的话那一行会冲出安全宽度 */
function splitWide(toks: Tok[], max: number): Tok[] {
  if (!toks.some((t) => t.w > max)) return toks;
  const out: Tok[] = [];
  for (const t of toks) {
    if (t.w <= max) {
      out.push(t);
      continue;
    }
    let s = "";
    let w = 0;
    for (const ch of t.s) {
      const cw = charUnits(ch);
      if (s && w + cw > max) {
        out.push({ s, w, space: false });
        s = "";
        w = 0;
      }
      s += ch;
      w += cw;
    }
    if (s) out.push({ s, w, space: false });
  }
  return out;
}

/** [from, to) 这一截有多宽（两头的空格不算） */
function spanUnits(toks: Tok[], from: number, to: number): number {
  let a = from;
  let b = to;
  while (a < b && toks[a].space) a++;
  while (b > a && toks[b - 1].space) b--;
  let w = 0;
  for (let i = a; i < b; i++) w += toks[i].w;
  return w;
}

/**
 * 这一块落在行尾时，有多宽是不画出来的（行尾的逗号句号会被 lineText 摘掉）。
 * ★ 量一行放不放得下要减掉它：「…的旧木门，」正好比一行多一个逗号时，这一行其实放得下 ——
 *   按带逗号的宽度判，这句话就只能从词中间断开。
 */
function tailTrim(t: Tok): number {
  let w = 0;
  for (let i = t.s.length - 1; i >= 0 && LINE_TRIM.includes(t.s[i]); i--) w += charUnits(t.s[i]);
  return w;
}

/** [from, to) 当成一行画出来有多宽（行尾不画的标点不算） */
function shownUnits(toks: Tok[], from: number, to: number): number {
  let b = to;
  while (b > from && toks[b - 1].space) b--;
  return b > from ? spanUnits(toks, from, b) - tailTrim(toks[b - 1]) : 0;
}

/** 贪心断行：回每一行的 [from, to)（to 不含行尾的空格） */
function greedyLines(toks: Tok[], from: number, to: number, max: number): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  let start = -1;
  let end = -1;
  let w = 0;
  for (let i = from; i < to; i++) {
    const t = toks[i];
    if (t.space) {
      if (start >= 0) w += t.w;
      continue;
    }
    if (start >= 0 && w + t.w - tailTrim(t) > max + 1e-6) {
      lines.push([start, end]);
      start = -1;
    }
    if (start < 0) {
      start = i;
      w = 0;
    }
    w += t.w;
    end = i + 1;
  }
  if (start >= 0) lines.push([start, end]);
  return lines;
}

/** 引号 / 括号的后半边：一句话在它里面说完时，句号后面还跟着它（「走吧。」） */
const QUOTE_CLOSE = "」』）)】》〉”’";

/** toks[k] 前面那一块是不是把一个短语说完了（以逗号句号之类收尾，后面跟着引号的后半边也算）—— 断在这儿最自然 */
function afterPunct(toks: Tok[], k: number): boolean {
  let prev = k - 1;
  while (prev > 0 && toks[prev].space) prev--;
  let tail = toks[prev]?.s ?? "";
  while (tail.length > 1 && QUOTE_CLOSE.includes(tail[tail.length - 1])) tail = tail.slice(0, -1);
  return tail.length > 0 && PHRASE_END.includes(tail[tail.length - 1]);
}

function lineText(toks: Tok[], from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i++) s += toks[i].s;
  s = s.trim();
  while (s.length > 0 && LINE_TRIM.includes(s[s.length - 1])) s = s.slice(0, -1).trimEnd();
  return s;
}

/**
 * 把 [from, to) **匀**成 n 份，回切点（每一份的起点，不含第一份）。每一份都得过 fits，过不了回 null。
 * 切点挑"离平均分最近的"，落在短语末尾有加分（bonus，单位是字宽）—— 既不让最后一份只剩一两个字，也尽量按短语断。
 * ★ 翻页与页内分行用的是**同一个**函数：翻页时一份 = 一页（fits = 排得进几行），分行时一份 = 一行（fits = 不超宽）。
 */
function evenCuts(
  toks: Tok[],
  from: number,
  to: number,
  n: number,
  fits: (a: number, b: number) => boolean,
  bonus: number,
): number[] | null {
  const total = spanUnits(toks, from, to);
  const cuts: number[] = [];
  let partFrom = from;
  for (let part = 1; part < n; part++) {
    const ideal = (total * part) / n;
    let best = -1;
    let bestScore = Infinity;
    for (let k = partFrom + 1; k < to; k++) {
      if (toks[k].space) continue;
      if (!fits(partFrom, k)) break; // 这一份已经装不下了，再往后只会更装不下
      const score = Math.abs(spanUnits(toks, from, k) - ideal) - (afterPunct(toks, k) ? bonus : 0);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = k;
      }
    }
    if (best < 0) return null;
    cuts.push(best);
    partFrom = best;
  }
  return fits(partFrom, to) ? cuts : null;
}

/** 字幕的一页：同时挂在画面上的那几行 + 这一页有多少字宽（分时间用） */
export interface CaptionPage {
  lines: string[];
  units: number;
}

/**
 * 把一句话排成字幕：一页最多 linesPerPage 行、一行最宽 maxUnits 个全角字宽，一页放不下就翻页。
 *
 * ★★ **分行只在这里算**（预览的 DOM 叠层与原生合成器画的是这里出的同一批行）：两边各断各的，
 *   预览里两行的字幕合出来可能是三行（docs/cut-autoedit-research.md §七「两个渲染器分叉」）。
 * ★ 不是贪心一路填满：那样会排出「信使收到一封没 / 有地址的信」这种拦腰断词的行，最后一页还常常只剩一两个字。
 *   先定要几页（最少的页数），把字**匀**到各页；页内再匀到各行。两级的切点都偏向短语末尾（逗号句号之后）；
 *   汉字按词断（见 wordsOf），英文按单词断。
 */
export function paginateCaption(text: string, maxUnits: number, linesPerPage = 2): CaptionPage[] {
  const max = Math.max(2, maxUnits);
  const lpp = Math.max(1, Math.floor(linesPerPage));
  const toks = splitWide(tokenize(text), max);
  if (toks.length === 0) return [];
  const lineCount = (a: number, b: number) => greedyLines(toks, a, b, max).length;
  const pageFits = (a: number, b: number) => lineCount(a, b) <= lpp;
  const lineFits = (a: number, b: number) => shownUnits(toks, a, b) <= max + 1e-6;
  const n0 = Math.ceil(lineCount(0, toks.length) / lpp);
  let cuts: number[] | null = null;
  // 最少的页数匀不开（切点被标点带偏、某一页装不下）就多给一页再试；试几次都不行退回按行硬切
  for (let n = n0; n <= n0 + 2 && !cuts; n++) cuts = evenCuts(toks, 0, toks.length, n, pageFits, max * 0.6);
  if (!cuts) {
    cuts = [];
    const ls = greedyLines(toks, 0, toks.length, max);
    for (let i = lpp; i < ls.length; i += lpp) cuts.push(ls[i][0]);
  }
  const bounds = [0, ...cuts, toks.length];
  const out: CaptionPage[] = [];
  for (let pi = 0; pi + 1 < bounds.length; pi++) {
    const a = bounds[pi];
    const b = bounds[pi + 1];
    const greedy = greedyLines(toks, a, b, max);
    // 页内分行：行数照贪心的（最少的行数），断点重新匀一遍 —— 别留「十一个字 + 两个字」。
    // 落在短语末尾的加分给到 0.3 行宽：模拟器上合出来看过，0.15 时「他决定亲自去找收信人，不管要走多远」
    // 会为了两行一样宽断成「…去找收信 / 人，不管…」—— 宁可两行差几个字，也别把一个词和它的逗号拆到下一行
    const lineCuts = greedy.length > 1 ? evenCuts(toks, a, b, greedy.length, lineFits, max * 0.3) : null;
    const ranges: Array<[number, number]> = lineCuts
      ? [a, ...lineCuts].map((x, i, arr) => [x, i + 1 < arr.length ? arr[i + 1] : b] as [number, number])
      : greedy;
    const lines = ranges.map(([x, y]) => lineText(toks, x, y)).filter((s) => s.length > 0);
    if (lines.length > 0) out.push({ lines, units: Math.max(0.5, spanUnits(toks, a, b)) });
  }
  return out;
}

// ── 时间轴 → 渲染计划 ─────────────────────────────────────────────

export interface PlanClip {
  clipId: string;
  /** 稿子里的第几段（0 起） */
  segIndex: number;
  /** 片内入点 / 出点（秒） */
  startSec: number;
  endSec: number;
  /** 出点要不要明说给合成器。false = 不设结束点、一直取到片尾（真实长度还没量到时只能这样，见 timelinePlan 的 ★★） */
  endExplicit: boolean;
  speed: number;
  /** 这一段原声的音量（0~1） */
  volume: number;
  /** 在**成片**里的起点 / 时长（秒，变速之后） */
  outStart: number;
  outDur: number;
  /** 开头从黑淡入 / 结尾淡出到黑，各多久（秒；0 = 没有） */
  fadeIn: number;
  fadeOut: number;
}

export interface PlanCaption {
  /** 成片时间轴上的绝对秒 */
  startSec: number;
  endSec: number;
  lines: string[];
  kind: "caption" | "title";
  clipId?: string;
}

export interface PlanVoice {
  clipId: string;
  /** `idb:cutvoice:<键>` */
  ref: string;
  /** 在成片里从第几秒开始念 */
  atSec: number;
  /** 这条配音本身多长 */
  durSec: number;
  /** 真正念出来多长（念到片尾还没完的在片尾掐掉） */
  playSec: number;
  volume: number;
  /** 被上一句挤后了多少秒（0 = 没被挤） */
  lateSec: number;
  /** 念到这一段之外多少秒（0 = 本段之内念完） */
  overSec: number;
}

export interface RenderPlan {
  clips: PlanClip[];
  captions: PlanCaption[];
  voices: PlanVoice[];
  /** 成片总长（秒） */
  total: number;
  /** 配乐再乘的系数（有配音时压低，见 BGM_DUCK） */
  bgmGain: number;
  /** 成片最后这么多秒声音整体收掉（0 = 不收） */
  tailFadeSec: number;
  /** 工程里有没有"长在时间上"的东西（字幕 / 配音 / 闪黑 / 变速 / 片尾淡出 / 配乐）—— 有的话合成之前先把各段的真实长度量出来 */
  timed: boolean;
  /** 时间轴上每一段的长度是不是都靠得住（量过，或者出点是人裁的） */
  exact: boolean;
  /** 位置不够、没排上的那几句（片段 id）：片段太短，或者被上一句配音挤到了片尾之外 */
  dropped: string[];
  layout: CaptionLayout;
}

/**
 * 时间轴 → 渲染计划：每个片段在成片里的起止、每条字幕什么时候出什么时候收、每句配音从第几秒念、
 * 闪黑多长、配乐压到几成。**这份计划只在这里出**（铁律六）：剪辑页的预览（DOM 叠层 / playbackRate / <audio>）
 * 与导出（原生合成器，utils/nativeMerge）是两个渲染器，照的是同一份。
 *
 * @param lens      各段现在按多长算（实测优先，没实测过是申报值）
 * @param realLens  各段**量出来的**长度；没量过的那一格是 undefined
 * @param segCount  稿子里有几段。指着不存在的段的片段直接略过（合并那一拍稿子换成单段成片时，页面会带着旧片段表重渲染一次）
 *
 * ★★ 真实长度没量到的片段（`exact` 为假）：
 *   · 出点**不明说**（endExplicit=false）—— 明说成申报值会把实际更长的片子拦腰截断（申报 5 秒、实际 20 秒的白模段
 *     只剩 5 秒，2026-09-05 那次事故）；
 *   · 闪黑与片尾收声**一律不做** —— 它们按成片时间轴定位，前面有一段的长度不可靠，位置就全是错的：
 *     淡出落在片段中间的话，画面黑下去就再也亮不回来，声音同理。字幕与配音照排（错开几秒不致命），
 *     由调用方把话说出来。合成那条路会先把长度量出来再来问（CutPage.mergeAndGo），所以这只是兜底。
 * ★ 长度量到了的片段，只要工程里有长在时间上的东西（timed），出点就**明说**：合成器按「入点~出点」定每一段多长，
 *   我们排字幕与配音靠的是同一个数 —— 不明说的话两边各算各的。
 */
export function timelinePlan(
  p: CutProject,
  lens: ReadonlyArray<number>,
  realLens: ReadonlyArray<number | undefined>,
  frame: Frame,
  segCount: number,
): RenderPlan {
  const layout = captionLayout(frame);
  const live = p.clips.filter((c) => c.segIndex < segCount);
  const hasText = (c: CutClip) => !!c.line && c.line.text.trim().length > 0;
  const title = (p.title ?? "").trim();
  const timed =
    !!p.endFade || !!p.audio || title.length > 0 || live.some((c) => !!c.fade || hasText(c) || clipSpeed(c) !== 1);
  const exact = live.every((c) => c.end !== undefined || realLens[c.segIndex] !== undefined);

  const clips: PlanClip[] = [];
  let acc = 0;
  for (const c of live) {
    const outDur = clipOutDur(c, lens);
    clips.push({
      clipId: c.id,
      segIndex: c.segIndex,
      startSec: c.start,
      endSec: clipEnd(c, lens),
      endExplicit: c.end !== undefined || (timed && realLens[c.segIndex] !== undefined),
      speed: clipSpeed(c),
      volume: clipVolume(c),
      outStart: acc,
      outDur,
      fadeIn: 0,
      fadeOut: 0,
    });
    acc += outDur;
  }
  const total = acc;

  if (exact) {
    for (let i = 0; i < live.length; i++) {
      const half = clips[i].outDur / 2;
      if (live[i].fade) {
        clips[i].fadeIn = Math.min(FADE_SEC, half);
        if (i > 0) clips[i - 1].fadeOut = Math.min(FADE_SEC, clips[i - 1].outDur / 2);
      }
    }
    if (p.endFade && clips.length > 0) {
      const lastClip = clips[clips.length - 1];
      lastClip.fadeOut = Math.min(END_FADE_SEC, lastClip.outDur / 2);
    }
  }

  const voices: PlanVoice[] = [];
  const captions: PlanCaption[] = [];
  const dropped: string[] = [];
  if (title && total > TITLE_AT_SEC + LINE_MIN_SEC) {
    // 标题不翻页：一次全挂出来，最多四行（TITLE_MAX 个字排不出第五行；真排出来了就截掉，别让它顶到画面外）
    const lines = paginateCaption(title, layout.titleUnitsPerLine, 4)
      .flatMap((pg) => pg.lines)
      .slice(0, 4);
    if (lines.length > 0) captions.push({ startSec: TITLE_AT_SEC, endSec: Math.min(total, TITLE_AT_SEC + TITLE_SEC), lines, kind: "title" });
  }
  let voiceEnd = -1;
  let capEnd = 0;
  for (let i = 0; i < live.length; i++) {
    const c = live[i];
    if (!hasText(c)) continue;
    const pc = clips[i];
    const clipStart = pc.outStart;
    const clipStop = pc.outStart + pc.outDur;
    const lead = Math.min(LINE_LEAD_SEC, pc.outDur / 4);
    let s = clipStart + lead;
    let e = clipStop - Math.min(0.1, pc.outDur / 4);
    const v = c.line!.voice;
    if (v && v.durSec > 0) {
      const want = clipStart + lead;
      // 上一句还没念完（它念到了本段里）：往后顺，两句不叠着念
      const at = Math.max(want, voiceEnd < 0 ? 0 : voiceEnd + VOICE_GAP_SEC);
      const play = Math.min(v.durSec, total - at);
      if (play >= LINE_MIN_SEC) {
        voices.push({
          clipId: c.id,
          ref: v.ref,
          atSec: at,
          durSec: v.durSec,
          playSec: play,
          volume: 1,
          lateSec: Math.max(0, at - want),
          overSec: Math.max(0, at + v.durSec - clipStop),
        });
        voiceEnd = at + play;
        // 字幕跟着声音走：念的时候挂着，念完再留一小会儿
        s = at;
        e = Math.min(total, at + play + CAPTION_LINGER_SEC);
      } else {
        dropped.push(c.id);
        continue;
      }
    }
    // 上一条字幕还挂着（它的配音念超了）：等它收了再出
    s = Math.max(s, capEnd);
    if (e - s < LINE_MIN_SEC) {
      if (!(v && v.durSec > 0)) dropped.push(c.id);
      continue;
    }
    capEnd = e;
    if (p.capOff) continue;
    const pages = paginateCaption(c.line!.text, layout.unitsPerLine, 2);
    const sum = pages.reduce((a, pg) => a + pg.units, 0);
    let t0 = s;
    pages.forEach((pg, k) => {
      const t1 = k === pages.length - 1 ? e : t0 + ((e - s) * pg.units) / sum;
      captions.push({ startSec: t0, endSec: t1, lines: pg.lines, kind: "caption", clipId: c.id });
      t0 = t1;
    });
  }
  captions.sort((a, b) => a.startSec - b.startSec);

  return {
    clips,
    captions,
    voices,
    total,
    bgmGain: voices.length > 0 ? BGM_DUCK : 1,
    tailFadeSec: !exact ? 0 : p.endFade ? Math.min(END_FADE_SEC, total / 2) : p.audio ? Math.min(BGM_TAIL_SEC, total / 2) : 0,
    timed,
    exact,
    dropped,
    layout,
  };
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
  speed: number;
  volume: number;
  /** 这一段在成片里的起点 / 时长（秒）—— 闪黑按成片时间轴定位，要靠它 */
  outStartSec: number;
  outDurSec: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export type TimelineIssue =
  /** 这一段还没有视频（只有设定帧） */
  | "no-video"
  /** 这一段是已经合好的本机成片（idb:），不能再合一次 */
  | "local-merged"
  /** 这一段还不是永久地址（blob: 之类） */
  | "not-permanent";

export type TimelineResult =
  | { ok: true; clips: TimelineClip[]; total: number; plan: RenderPlan }
  | { ok: false; issue: TimelineIssue; segNo: number };

/**
 * 时间轴 → 合成器吃的那张表：渲染计划（timelinePlan）+ 每个片段的地址。**这张表只在这里出**。
 * 地址有问题（没出片 / 不是永久地址）整句拒，不悄悄跳过那一段（成片里少一段，零报错）。
 * ★ `realLens` 与 `frame` 是必填的：漏传没有任何症状，只是闪黑全不做、字幕按错的宽度断行。
 */
export function compileTimeline(
  p: CutProject,
  segs: ReadonlyArray<{ videoUrl?: string } | undefined>,
  lens: ReadonlyArray<number>,
  realLens: ReadonlyArray<number | undefined>,
  frame: Frame,
): TimelineResult {
  const plan = timelinePlan(p, lens, realLens, frame, segs.length);
  const clips: TimelineClip[] = [];
  for (const pc of plan.clips) {
    const url = (segs[pc.segIndex]?.videoUrl || "").trim();
    if (!url) return { ok: false, issue: "no-video", segNo: pc.segIndex + 1 };
    if (!/^https?:/i.test(url)) {
      return { ok: false, issue: url.startsWith("idb:") ? "local-merged" : "not-permanent", segNo: pc.segIndex + 1 };
    }
    clips.push({
      url,
      startSec: pc.startSec,
      ...(pc.endExplicit ? { endSec: pc.endSec } : {}),
      segIndex: pc.segIndex,
      speed: pc.speed,
      volume: pc.volume,
      outStartSec: pc.outStart,
      outDurSec: pc.outDur,
      fadeInSec: pc.fadeIn,
      fadeOutSec: pc.fadeOut,
    });
  }
  return { ok: true, clips, total: plan.total, plan };
}
