// 分镜表：一段视频里的几个镜头 —— 规则的**唯一实现**（N2，2026-10-03 对标 LibTV 节点里的多镜头脚本；
// 方案、取舍与出处见 docs/node-modes-libtv-alignment.md §六）。
//
// 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-shot-script.mjs 直接 import 它跑正反例。
//
// ★★ 文字是唯一真身（与运镜芯片、@ 点名同一个做法）：分镜表**不另存一份结构**，它只是这一段要求（plot）的结构化编辑 ——
//   一个镜头就是原来那一句话，一个字不变；两个以上才写成「镜头1：……」「镜头2：……」。老草稿、做同款、公开配方、
//   对画布说话、方案台里手打的剧情都天然兼容：它们存的、读的从来都是这段文字。
// ★★ 写法照官方提示词指南（火山方舟 Seedance 2.0 提示词指南「使用分镜时序」，2026-10-03 查）：用「镜头1 / 镜头2 / 镜头3」标识、
//   按事件顺序写；**不写每个镜头的秒数** —— 指南原话的意思是模型对精确时间（如 0–3 秒）的支持不稳定，强行限制时长可能导致结果异常，
//   优先让模型按剧情自己分配节奏。（LibTV 的熟练作者会写时间段，我们不跟：出处更硬的那一边是模型的官方指南。）
// ★ 台词写在引号里、前面点明谁说的（「凛说：“……”」）：引号内的字会被配音（segmentGen.hasDialogue 同一判据），
//   说话人的名字是把这句话接到那张人物卡声音样本上的钥匙（音色点名句按卡名说话）。
// ★★ **编辑这条路上一个字都不许吃**（2026-10-03 合进去当天在浏览器里一个键一个键敲才抓到）：输入框的值每敲一个字都是
//   「写回整段文字 → 再从整段文字读出这一格」绕一圈回来的。第一版在读、写两头都 trim，于是行尾刚敲的空格 / 回车当场消失 ——
//   分了镜之后打英文，「Rin walks」变成「Rinwalks」，零报错（一次写进一整串的自动化输入测不出来）。
//   所以 parseShots / joinShots **原样切、原样拼**（只认 joinShots 自己加的那一个换行当分隔），trim 只在发出去之前的 packShots。

/** 一段最多几个镜头。官方示例是三个；10 秒以内的一段塞四个以上，每个镜头不到两三秒，模型顾不过来 */
export const SHOT_MAX = 4;

export interface ShotScript {
  /** 「镜头1」之前的那段总述（人物 / 场景 / 氛围的整体交代）；没有 = 空串 */
  lead: string;
  /** 各个镜头的正文（不带「镜头N：」前缀）。只有一个 = 这段话没分镜 */
  shots: string[];
}

/* i18n-frozen: 镜头标识里的中文数字（「镜头一」），是被解析的输入，不是界面文案 */
const CN_NUM = "一二三四五六七八九";
/** 镜头标识：「镜头1：」「镜头 2:」「镜头三：」「Shot 1:」都认（空格、全半角冒号不挑） */
const MARK = /(镜头|shot)\s*([1-9一二三四五六七八九])\s*[:：]/gi;

function numOf(s: string): number {
  const i = CN_NUM.indexOf(s);
  return i >= 0 ? i + 1 : Number(s);
}

/** 标识前面必须是句子的开头：文首、换行，或者句读 / 空白之后（「看镜头1：」这种句子中间的不算） */
function atBoundary(text: string, at: number): boolean {
  if (at === 0) return true;
  return /[\s。；;！!？?，,、]/.test(text[at - 1]);
}

/** 一格在原文里的起止（左闭右开） */
interface Span {
  from: number;
  to: number;
}

/**
 * 各格在原文里的位置。
 * ★ 认不准就不办：标识必须从 1 起连着数（1、2、3…）、至少两个、都在句子开头，否则整段当一格 ——
 *   判错的方向要安全（把普通句子拆坏比不拆糟得多）。
 * ★ 原样切：一格的内容就是两个标识之间的那些字，只去掉结尾**一个**换行（joinShots 加的那个分隔）。最后一格后面没有分隔，一个字不去。
 */
function layout(src: string): { lead: Span; shots: Span[] } {
  const marks: { at: number; end: number; n: number }[] = [];
  MARK.lastIndex = 0;
  for (let m = MARK.exec(src); m; m = MARK.exec(src)) {
    if (atBoundary(src, m.index)) marks.push({ at: m.index, end: m.index + m[0].length, n: numOf(m[2]) });
  }
  const sequential = marks.length >= 2 && marks.every((k, i) => k.n === i + 1);
  if (!sequential) return { lead: { from: 0, to: 0 }, shots: [{ from: 0, to: src.length }] };
  const cut = (from: number, to: number): Span => ({ from, to: to > from && src[to - 1] === "\n" ? to - 1 : to });
  return {
    lead: cut(0, marks[0].at),
    shots: marks.map((k, i) => (i + 1 < marks.length ? cut(k.end, marks[i + 1].at) : { from: k.end, to: src.length })),
  };
}

/** 把一段话读成分镜（判据与切法见 layout）。没分镜 = `{ lead: "", shots: [整段] }` */
export function parseShots(text: string): ShotScript {
  const src = text || "";
  const l = layout(src);
  return { lead: src.slice(l.lead.from, l.lead.to), shots: l.shots.map((s) => src.slice(s.from, s.to)) };
}

/* i18n-frozen: 分镜标识「镜头N：」是发给视频模型的写法（官方提示词指南的格式），不是界面文案 */
const markOf = (i: number): string => `镜头${i + 1}：`;

/**
 * 把分镜写回一段话。只有一个镜头 = 不带标识的普通句子（与没用分镜表时逐字相同）。
 * ★ 镜头之间用换行隔开（方舟的示例也是一镜一行）；空镜头照样占位（人正在写），出片前由 packShots 收掉。
 * ★ 原样拼、不 trim（文件头 ★★）：与 parseShots 一来一回，每一格的字逐字节不变。
 */
export const joinShots = (script: ShotScript): string => {
  const lead = script.lead || "";
  const shots = script.shots.length ? script.shots : [""];
  if (shots.length === 1) return lead ? `${lead}\n${shots[0]}` : shots[0];
  const body = shots.map((s, i) => `${markOf(i)}${s}`).join("\n");
  return lead ? `${lead}\n${body}` : body;
};

/** 这段话现在有几个镜头（没分镜 = 1） */
export function shotCount(text: string): number {
  return parseShots(text).shots.length;
}

/** 改第 i 个镜头的正文（i 越界 = 不动） */
export function setShot(text: string, i: number, value: string): string {
  const s = parseShots(text);
  if (i < 0 || i >= s.shots.length) return text;
  // 只有一个镜头：就是原来那一句话，原样写回
  if (s.shots.length === 1) return value;
  const shots = s.shots.slice();
  shots[i] = value;
  return joinShots({ lead: s.lead, shots });
}

/** 改总述 */
export function setLead(text: string, value: string): string {
  const s = parseShots(text);
  return joinShots({ lead: value, shots: s.shots });
}

/**
 * 整段文字里的第 pos 个字落在哪一格（shot = -1 是总述）的第几个字。
 * 落在标识上（「镜头2：」中间）或分隔的换行上：算前一格的末尾；刚好在标识后面：那个镜头的开头。
 */
export function boxAt(text: string, pos: number): { shot: number; offset: number } {
  const src = text || "";
  const l = layout(src);
  const p = Math.max(0, Math.min(Number.isFinite(pos) ? pos : src.length, src.length));
  for (let i = l.shots.length - 1; i >= 0; i--) {
    const s = l.shots[i];
    if (p >= s.from) return { shot: i, offset: Math.min(p, s.to) - s.from };
  }
  // 第一个镜头的正文之前：在总述里；落在第一个标识上的算总述的末尾
  return { shot: -1, offset: Math.min(p, l.lead.to) };
}

/**
 * 人在第 i 格（-1 = 总述）里敲字：把那一格写成 value，回新的整段文字，以及光标（那一格里的第 caret 个字）现在该在哪一格。
 *
 * ★ 为什么要回「光标在哪一格」：格子的数目会被敲出来的字改掉 —— 在一句普通的话里手打完「镜头2：」的冒号，输入框当场换成
 *   两格（原来那个框被卸掉，焦点没了，后面的字敲进空气里）；在最后一格里接着打「镜头3：」，多出来的第三格是空的，
 *   而光标还留在第二格。reshaped 为真时由界面把焦点接到 shot / offset 上。
 */
export function typeInto(
  text: string,
  i: number,
  value: string,
  caret: number,
): { text: string; shot: number; offset: number; reshaped: boolean } {
  const s = parseShots(text);
  const c = Math.max(0, Math.min(Number.isFinite(caret) ? caret : value.length, value.length));
  if (i >= s.shots.length) return { text, shot: s.shots.length - 1, offset: 0, reshaped: false };
  let next: string;
  let pos: number;
  if (i < 0) {
    next = joinShots({ lead: value, shots: s.shots });
    pos = c;
  } else if (s.shots.length === 1) {
    next = value;
    pos = c;
  } else {
    const shots = s.shots.slice();
    shots[i] = value;
    next = joinShots({ lead: s.lead, shots });
    // 这一格在新文字里从哪儿开始：总述（带一个换行）+ 前面几个镜头（各带标识与一个换行）+ 自己的标识
    pos = (s.lead ? s.lead.length + 1 : 0) + c + markOf(i).length;
    for (let k = 0; k < i; k++) pos += markOf(k).length + shots[k].length + 1;
  }
  return { text: next, ...boxAt(next, pos), reshaped: shotCount(next) !== s.shots.length };
}

/** 加一个镜头（接在最后）。到上限回原文 */
export function addShot(text: string): string {
  const s = parseShots(text);
  if (s.shots.length >= SHOT_MAX) return text;
  return joinShots({ lead: s.lead, shots: [...s.shots, ""] });
}

/** 删第 i 个镜头。删到只剩一个 = 退回普通句子（总述并回去） */
export function removeShot(text: string, i: number): string {
  const s = parseShots(text);
  if (s.shots.length <= 1 || i < 0 || i >= s.shots.length) return text;
  return joinShots({ lead: s.lead, shots: s.shots.filter((_, k) => k !== i) });
}

/**
 * 出片前收拾：每一格去掉首尾空白、空镜头拿掉、编号重排（「镜头1：……镜头2：（空）镜头3：……」发出去是两个镜头，
 * 不是带着一个空镜头的三个）。没分镜的句子逐字节原样。
 */
export function packShots(text: string): string {
  const s = parseShots(text);
  if (s.shots.length <= 1) return text;
  const lead = s.lead.trim();
  const kept = s.shots.map((x) => x.trim()).filter(Boolean);
  // 镜头全是空的：只剩总述那一句（没有总述 = 空串）
  if (!kept.length) return lead;
  return joinShots({ lead, shots: kept });
}

/**
 * 往一个镜头的光标处插一句台词的骨架：`凛说：“”`，光标落在引号里。
 * ★ 用中文弯引号：引号内的字才会被配音（hasDialogue 的判据），而它也是官方示例的写法。
 */
/* i18n-frozen: 台词骨架「X说：“”」是发给视频模型的写法 */
export const insertLine = (text: string, caret: number, speaker: string): { text: string; caret: number } => {
  const src = text || "";
  const at = Math.max(0, Math.min(Number.isFinite(caret) ? caret : src.length, src.length));
  const before = src.slice(0, at);
  // 前面有字、又不是以句读 / 空白收尾：补一个逗号，别把「他走进来凛说」粘成一串
  const lead = before && !/[\s，。；、,.;!?！？：:]$/.test(before) ? "，" : "";
  const head = `${lead}${speaker}说：“`;
  return { text: `${before}${head}”${src.slice(at)}`, caret: at + head.length };
};
