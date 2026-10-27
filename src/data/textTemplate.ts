// 文字模板（纯文字 + 本机封面图的视频模板，2026-10-26 主人点名「给"再做一个视频模板"加一个纯文字 + 上传本地封面图的模板制作」）
// —— 作者那段正文的「体检」规则的**唯一实现**。方案、审核与付费小验读数见 docs/text-template-design-2026-10-26.md。
//
// 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-text-template.mjs 直接 import 它跑正反例
// （主人那段例子 + 付费小验用的中性改写版，见 scripts/fixtures/text-template/）。改一条规则就去那儿补一句正例、一句反例。
//
// 与别的模块的分工（一条规则一处实现）：
//   · 图位（正文里的「图4 / 图片4 / 参考图1、2」→ @名字）在 data/refMentions（templateSlotRefs / rewriteSlotMentions）：
//     点名的语法、保留名都在那儿；这里的 textTplFindings 只收它认出来的结果。
//   · 镜头的读写在 data/shotScript：这里只交出 { lead, shots }，拼成「镜头N：」只走 shotScript.joinShots；
//     存前定型（canonTextTplPrompt）借它的 packShots —— 函数由调用方传进来，因为这个文件不许有运行时依赖。
//   · 「这一档能不能跑这个模板 / 正文放不放得下」在档位表与出片那一侧（出片一步）；这里只回答「正文长什么样」。
//
// ★★ 主人授权我定的、这里落地的几条（2026-10-26，付费小验读数在设计文档第一节）：
//   ① 时间轴（「0-2s」「2–7秒」）只有电影级（Seedance 2.5）认：官方 2.5 指南「2.0 不响应时间戳只响应镜头序号，2.5 响应整数秒的时间戳」，
//      付费小验 A：电影级 936 字五段秒数逐段照做；草稿（2.0 mini）秒数版节奏提前、丢了一拍，「镜头1~4」版四个镜头都做到。
//      ⇒ 草稿 / 高清要跑的模板，时间轴改写成「镜头N：」—— 最多 shotScript.SHOT_MAX（4）段，多了请作者合并（不替他删）；
//      超过 9 段「镜头N：」根本写不出来（shotScript 的标识只认 1~9），直接拦。
//   ② 【X】：官方 2.0 提示词指南的符号约定里【】是**字幕**。一键改成「X：」（独占一行的标题）或直接并进正文（句子中间的），
//      绝不改成「」或“”—— 那两种会被 segmentGen.hasDialogue 认成台词，触发配音并追加「别出字幕」那一句，反而更糟。
//      （付费小验四发里【】都没被画成字，但这是一次的读数；按官方约定改掉不花钱。）
//   ③ 不是台词的引号（「拖拽一个“人物图标”」）一键去掉：同一个道理，引号里的字会被当成台词配音。
//   ④ 内容规则（Play「undress」条款 + 年龄模糊主体）：词表 A（露肤 / 去衣动作）× 词表 B（年龄模糊的主体）。
//      A∧B = 不能上架（本机自用不受影响，出片照常由方舟审）；只 A = 进审时高亮。P1 只在作者那一屏说一句「这种内容上不了市场」。
//   ⑤ 存进本机之前定型：packShots 一遍（发出去之前 segmentGen 还会 pack 一次 —— 存的就是会发的样子，P2 的试炼比对才对得上）。

import type { ShotScript, packShots as PackShots } from "./shotScript";

// ── 三段：【全局设定…】【时间轴…】【全局约束】 ─────────────────────────

export type TplSectionKind = "setting" | "timeline" | "constraint";

export interface TplSection {
  kind: TplSectionKind;
  /** 标题原文（不带【】与冒号） */
  title: string;
  /** 标题那一行在原文里的起点 */
  at: number;
  /** 这一段正文的起点（标题之后；标题与正文同一行时就在那一行里） */
  from: number;
  /** 终点（下一个标题之前 / 文末），左闭右开 */
  to: number;
}

export interface TplSections {
  /** 认出了至少一段。认不出 = 整段都是正文，下面的规则照常能用（「认不出也能整段当正文」） */
  recognized: boolean;
  /** 第一个标题之前的那些字（没认出任何一段 = 全文） */
  preamble: { from: number; to: number };
  sections: TplSection[];
}

/**
 * 标题归哪一段：先认「约束」（「全局约束」里也有「全局」），再认「时间轴」，最后认「设定」。认不出 = 不是段标题。
 * ★ 「镜头」算时间轴：作者写【分镜】【镜头】的也有；但带数字的（「镜头1：」）是分镜标识，不是段标题（见 headingAt）。
 */
const SEC_CONSTRAINT = /约束|限制|禁止|规避|负面|constraint|restriction|negative|avoid|rules?\b/i;
const SEC_TIMELINE = /时间轴|时间线|分镜|镜头|动作|timeline|storyboard|shots?\b|beats?\b|sequence/i;
const SEC_SETTING = /全局|设定|设置|画风|风格|总述|总览|setting|style|global|overview/i;

function sectionKind(title: string): TplSectionKind | null {
  if (SEC_CONSTRAINT.test(title)) return "constraint";
  if (SEC_TIMELINE.test(title)) return "timeline";
  if (SEC_SETTING.test(title)) return "setting";
  return null;
}

/** 行首的【标题】（同一行后面可以接着正文） */
const HEAD_BRACKET = /^[ \t]*【([^【】\n]{1,24})】[ \t]*[：:]?[ \t]*/;
/**
 * 独占一行的「标题：」（【】一键改掉之后段标题长这样；带数字的不算 —— 「镜头1：」是分镜标识）。
 * ★ 词与词之间许一个空格、最多四个词：英文的多词标题（「Global constraints:」）原来认不出，【Global constraints】一键改掉之后
 *   约束那一段就掉进了最后一个镜头（2026-10-26 审核实跑）。总长 2~24 个字在 headingAt 里判。
 */
const HEAD_COLON = /^[ \t]*([^\s【】：:，,。.；;!！?？\d]+(?: [^\s【】：:，,。.；;!！?？\d]+){0,3})[ \t]*[：:][ \t]*$/;

/** 这一行是不是段标题：是的话回标题、种类与正文起点（相对行首）。行尾的 \r（粘进来的 CRLF）不算字 */
function headingAt(raw: string): { title: string; kind: TplSectionKind; body: number } | null {
  const line = raw.replace(/\r$/, "");
  const b = HEAD_BRACKET.exec(line);
  if (b) {
    const kind = sectionKind(b[1]);
    return kind ? { title: b[1].trim(), kind, body: b[0].length } : null;
  }
  const c = HEAD_COLON.exec(line);
  if (c && c[1].length >= 2 && c[1].length <= 24) {
    const kind = sectionKind(c[1]);
    return kind ? { title: c[1].trim(), kind, body: line.length } : null;
  }
  return null;
}

/** 认三段（标题写成【X】或独占一行的「X：」都认 —— 不管作者先点没点「把【】改掉」，认出来的段一样） */
export function sectionsOf(text: string): TplSections {
  const src = text || "";
  const heads: { title: string; kind: TplSectionKind; at: number; from: number }[] = [];
  let at = 0;
  for (const line of src.split("\n")) {
    const h = headingAt(line);
    if (h) heads.push({ title: h.title, kind: h.kind, at, from: at + h.body });
    at += line.length + 1;
  }
  const sections = heads.map((h, i) => ({ ...h, to: i + 1 < heads.length ? heads[i + 1].at : src.length }));
  return { recognized: sections.length > 0, preamble: { from: 0, to: sections.length ? sections[0].at : src.length }, sections };
}

// ── 时间码：「0-2s」「2–7秒」「第0-3秒」 ─────────────────────────────

/** 一段时间轴（秒）以及它的时间码在原文里的起止（左闭右开） */
export interface TimecodeBeat {
  from: number;
  to: number;
  at: number;
  end: number;
  /**
   * 这个时间码前面那截「行首的列表符号」从哪儿起（「- 0-2s：」「**0-2s**：」的行首）；前面没有列表符号 = at。
   * 改写成镜头、并段时上一段的正文切到这里为止 —— 不然下一段的「- 」会拖进上一个镜头的尾巴。
   */
  head: number;
}

/** 时间轴最多几段：「镜头N：」的标识只认 1~9（shotScript 的 MARK），超过 9 段改写不出来，直接拦 */
export const TIMELINE_BEATS_MAX = 9;
/** 时间码的秒数上限：比最长的出片窗口（30 秒）宽一截；再大多半不是时间码（「0-90」分） */
const TIMECODE_SEC_MAX = 60;

/**
 * 一个时间码：可选的「第」+ 起 +（可选单位）+ 连接号 + 止 + 单位（s / sec / seconds / 秒）。
 * 单位缺省时只认**行首**、后面紧跟「：」或「【」的（「0-2：」）—— 「1-2 人」「3-5个苹果」不是时间码。
 */
const TIMECODE =
  /(第[ \t]*)?(\d{1,3}(?:\.\d+)?)[ \t]*(?:秒|s(?:ec(?:ond)?s?)?)?[ \t]*[-–—~～至到][ \t]*(\d{1,3}(?:\.\d+)?)[ \t]*(秒钟?|s(?:ec(?:ond)?s?)?(?![A-Za-z]))?/g;
/**
 * 时间码前面（跳过空格）只能是这些（或行首 / 文首）：前面是汉字 / 字母数字的（「在2-3秒时」「版本1-2s」「waits 1-2 seconds」）
 * 是句子里的一个数，不是时间轴的一段。
 * ★ 收尾的括号也算（「【时间轴】0-2s：」标题与正文写在同一行、「（开场）0-2s：」）：原来漏了，第一段时间码丢掉，
 *   秒数原样留在总述里发给不认时间码的档，还误报「不从 0 起」（2026-10-26 审核实跑）。
 */
const TIMECODE_BEFORE = /[\r\n。.；;，,、：:（(【[「『“"…!！?？】）)\]]/;
/** 行首只有空白和列表符号（「- 」「* 」「• 」「**」）：当作行首 —— Markdown 写的时间轴（「- 0-2s：」「**0-2s**：」）照样认 */
const LIST_HEAD = /^[ \t　\-*•·]*$/;
/** 带单位的时间码后面紧跟这些 = 一段时长（「1-2秒后」「3-5秒内」），不是时间轴的一段 */
const DURATION_AFTER = /[后內内间左之以前]/;

/** 正文里认出的时间码（按出现先后）—— 只管「这是不是一个时间码」；哪几个算时间轴的一段问 timelineOf */
export function timecodeBeats(text: string): TimecodeBeat[] {
  const src = text || "";
  const out: TimecodeBeat[] = [];
  const re = new RegExp(TIMECODE.source, TIMECODE.flags);
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const at = m.index;
    const end = at + m[0].length;
    let j = at - 1;
    while (j >= 0 && /[ \t　]/.test(src[j])) j--;
    const prev = src[j];
    const lineStart = src.lastIndexOf("\n", at - 1) + 1;
    const atLineHead = LIST_HEAD.test(src.slice(lineStart, at));
    const ok = (() => {
      if (!atLineHead && prev !== undefined && !TIMECODE_BEFORE.test(prev)) return false;
      const from = Number(m[2]);
      const to = Number(m[3]);
      if (!(to > from) || to > TIMECODE_SEC_MAX) return false;
      if (m[4]) return !DURATION_AFTER.test(src[end] ?? "");
      // 没写单位：只认行首、后面紧跟「：」或「【」的（Markdown 加粗的「**0-2**：」也算）
      return atLineHead && /^[ \t]*(?:\*\*)?[ \t]*[：:【]/.test(src.slice(end));
    })();
    if (ok) out.push({ from: Number(m[2]), to: Number(m[3]), at, end, head: atLineHead && at > lineStart && /[-*•·]/.test(src.slice(lineStart, at)) ? lineStart : at });
    else re.lastIndex = at + 1;
  }
  return out;
}

/** 时间轴：哪几个时间码算数 */
export interface TplTimeline {
  /** 构成时间轴的那几段（改写成镜头、并段、写到第几秒、有没有跳着写都只认它们） */
  beats: TimecodeBeat[];
  /** 「时间轴」那一段之外认出来的时间码（设定里的「节奏：1-2秒一个动作」）：不参与改写，体检里单独说一句 */
  stray: TimecodeBeat[];
}

/**
 * 哪几个时间码算时间轴的一段 —— 这件事的**唯一判定**（timecodesToShots / mergeBeats / maxTimecodeSec / 体检都问它）。
 * · 认出了「时间轴」那一段：只算落在它里面的（认出几段「时间轴」就取时间码最多的那一段）；别的段里的是 stray。
 *   原来「时间轴」段之外冒出一个假时间码（设定里的「节奏：1-2秒一个动作。」），整条改写就退到兜底那一支：
 *   总述截在「节奏：」、段标题进了镜头、约束拼进最后一个镜头（2026-10-26 审核实跑）。
 *   「时间轴」那一段里一个时间码都没有：没有时间轴（全部是 stray）—— 别拿设定里的一句节奏当时间轴改写。
 * · 没认出「时间轴」那一段（标题写成【剧情】这种认不出的）：全文的时间码都算。
 */
export function timelineOf(text: string): TplTimeline {
  const src = text || "";
  const all = timecodeBeats(src);
  const tls = sectionsOf(src).sections.filter((s) => s.kind === "timeline");
  if (!tls.length) return { beats: all, stray: [] };
  const inside = (s: TplSection) => all.filter((b) => b.at >= s.from && b.at < s.to);
  const tl = tls.reduce((a, s) => (inside(s).length > inside(a).length ? s : a));
  const beats = inside(tl);
  return { beats, stray: all.filter((b) => !beats.includes(b)) };
}

/** 时间轴写到第几秒（没有时间轴 = null）—— 模板时长的缺省值从它来（作者在规格那一步可以改） */
export function maxTimecodeSec(text: string): number | null {
  const { beats } = timelineOf(text);
  return beats.length ? Math.max(...beats.map((b) => b.to)) : null;
}

/**
 * 时间轴有没有跳着写（不从 0 起、或者上一段的止 ≠ 下一段的起）：官方 2.5 指南要求时间轴连续（避免「0-3 秒...5-6 秒...」）。
 * 只提醒、不拦。
 */
export function timecodeGaps(beats: readonly TimecodeBeat[]): boolean {
  return beats.some((b, i) => (i === 0 ? b.from !== 0 : b.from !== beats[i - 1].to));
}

/** 一段正文压成一行：换行处按上一句的收尾补「。」（已有句读就不补；英文补空格） */
function oneLine(s: string): string {
  const parts = s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  let out = "";
  for (const p of parts) {
    if (!out) out = p;
    else if (/[A-Za-z0-9.!?;:,]$/.test(out) && /^[A-Za-z0-9]/.test(p)) out += ` ${p}`;
    else if (/[：:。.！!？?；;，,、】]$/.test(out)) out += p;
    else out += `。${p}`;
  }
  return out;
}

export type ShotConversion =
  /** 没有时间轴：不用改 */
  | { kind: "none" }
  /** 改好了：调用方拿 shotScript.joinShots 拼成「镜头N：」（再 canonTextTplPrompt 定型） */
  | { kind: "ok"; script: ShotScript }
  /** 段数比一段能放的镜头多：请作者合并（mergeBeats）；或者保留秒数、只在认时间码的档（电影级）上跑 */
  | { kind: "merge"; beats: number }
  /** 超过 9 段：「镜头N：」写不出来，秒数写这么密模型也照不过来 —— 拦 */
  | { kind: "tooMany"; beats: number };

/**
 * 把带秒数的时间轴改写成分镜（「镜头1：…」「镜头2：…」），给不认时间码的档（草稿 / 高清）跑。
 * · 每一段的时间码拿掉，正文压成一行当一个镜头（段标题「【拖拽入场】：」留着，【】由 unbracketTitles 另改）；
 * · 认出了「时间轴」那一段时：其余各段（全局设定、全局约束……）连同标题按原来的先后进总述（lead）——
 *   约束放到镜头前面没关系（付费小验 D 就是这么写的，四个镜头都做到）；时间轴那一段在第一个时间码之前的字也进总述，一个字不丢；
 * · 没认出「时间轴」那一段：第一个时间码之前的字是总述；最后一段吃到它后面第一个认得出的段标题为止（【全局约束】），
 *   那个标题起的几段照样进总述 —— 原来最后一段吃到文末，约束拼进了最后一个镜头（2026-10-26 审核实跑，标题写成【剧情】的那种）。
 * · 时间码前面的列表符号（「- 0-2s：」）、后面的加粗收尾（「**0-2s**：」）一起拿掉。
 * @param shotMax 一段最多几个镜头 —— 传 shotScript.SHOT_MAX（这个文件不许有运行时依赖）
 */
export function timecodesToShots(text: string, shotMax: number): ShotConversion {
  const src = text || "";
  const { beats } = timelineOf(src);
  if (!beats.length) return { kind: "none" };
  if (beats.length > TIMELINE_BEATS_MAX) return { kind: "tooMany", beats: beats.length };
  if (beats.length > shotMax) return { kind: "merge", beats: beats.length };
  const sec = sectionsOf(src);
  const tl = sec.sections.find((s) => s.kind === "timeline" && beats.every((b) => b.at >= s.from && b.at < s.to));
  const lastEnd = beats[beats.length - 1].end;
  const tailEnd = tl ? tl.to : (sec.sections.find((s) => s.at >= lastEnd)?.at ?? src.length);
  const leadParts = tl
    ? [src.slice(sec.preamble.from, sec.preamble.to), ...sec.sections.map((s) => (s === tl ? src.slice(tl.from, beats[0].head) : src.slice(s.at, s.to)))]
    : [src.slice(0, beats[0].head), src.slice(tailEnd)];
  const lead = leadParts
    .map((x) => x.trim())
    .filter(Boolean)
    .join("\n");
  const shots = beats.map((b, i) => oneLine(src.slice(b.end, i + 1 < beats.length ? beats[i + 1].head : tailEnd)).replace(/^[\s：:，,、*]+/, ""));
  return { kind: "ok", script: { lead, shots } };
}

/**
 * 把第 i 段与第 i+1 段并成一段（时间码改成「前一段的起 - 后一段的止」，后一段的时间码拿掉、正文接到前一段后面）——
 * 时间轴比一段能放的镜头多时，作者在体检那一屏一下一下地并（替他删哪段他自己定）。越界回原文。
 * ★ 后一段接到前一段**同一行**：不另起一行 —— 另起一行的「【镜头特写与表情特写】」会被 sectionsOf 认成一个新的时间轴段标题。
 */
export function mergeBeats(text: string, i: number): string {
  const src = text || "";
  const { beats } = timelineOf(src);
  const a = beats[i];
  const b = beats[i + 1];
  if (!a || !b) return src;
  // 时间码里最后一个数就是「止」：换成后一段的「止」（照后一段原样的写法，「7」「7.5」都不动）
  const LAST_NUM = /\d+(?:\.\d+)?(?=\D*$)/;
  const tokA = src.slice(a.at, a.end);
  const aTo = LAST_NUM.exec(tokA);
  const bTo = LAST_NUM.exec(src.slice(b.at, b.end));
  if (!aTo || !bTo) return src;
  const newA = tokA.slice(0, aTo.index) + bTo[0] + tokA.slice(aTo.index + aTo[0].length);
  // 后一段行首的列表符号（「- 」）随它的时间码一起拿掉
  const body = src.slice(a.end, b.head).replace(/\s+$/, "");
  // 后一段的时间码后面若紧跟冒号（「2-7：」这种没写单位的），连同加粗的收尾（「**2-4s**：」）一起拿掉
  const rest = src.slice(b.end).replace(b.head < b.at ? /^[ \t]*\**[ \t]*[：:]?[ \t]*/ : /^[ \t]*[：:][ \t]*/, "");
  const glue = !body || /[：:。.！!？?；;，,、】]$/.test(body) ? "" : "。";
  return `${src.slice(0, a.at)}${newA}${body}${glue}${rest}`;
}

// ── 【X】与不是台词的引号 ─────────────────────────────────────

/**
 * 【X】改掉（体检里那一条「一键改」，默认打勾）：
 * · 紧跟在时间码后面（「0-2s【拖拽入场】：」「0-2【落地】：」）→「0-2s：拖拽入场：」：时间码改完必须**还认得出来** ——
 *   直接并成「0-2落地」的话没写单位的那种认不出了，「0-2sDrop in」单位后面紧跟字母也认不出，标题以「后 / 内 / 前」打头的
 *   （「0-2s【后空翻】」）会变成时长短语（2026-10-26 审核实跑：两段时间轴变成零段）。所以中间一律隔一个「：」（英文「: 」）；
 * · 行首的段标题（sectionsOf 认得出种类的）→ 一律改成**独占一行**的「X：」，正文另起一行：sectionsOf 只认独占一行的「X：」，
 *   「【全局约束】：严禁多肢体」改成同一行的「全局约束：严禁多肢体」就认不出了，约束会掉进最后一个镜头（同上，审核实跑）；
 * · 行首、不是段标题的（「【女仆装】黑色女仆裙」）→「女仆装：黑色女仆裙」；
 * · 句子中间的（「以【女仆装形态】落地」）→ 直接并进正文（英文字母与字母之间补一个空格，「x【Drop】y」不粘成一个词）。
 * 绝不改成「」或“”（文件头 ★★ ②）；也**绝不在引号前面放一个冒号**（冒号 + 引号 = 一句台词，quoteSpans 会认成台词、留着配音）——
 * 那种位置用「，」。空的【】直接拿掉。
 * ★ 两颗一键改一起点时走 applyTextTplFixes（先去引号、再改【】，先后在这里定死），界面别自己排先后。
 */
export function unbracketTitles(text: string): string {
  const src = text || "";
  const beatEnds = timecodeBeats(src).map((b) => b.end);
  let out = "";
  let last = 0;
  const re = /【([^【】\n]*)】([ \t]*)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out += src.slice(last, m.index);
    last = m.index + m[0].length;
    const t = m[1].trim();
    if (!t) continue;
    const han = /\p{Script=Han}/u.test(t);
    const colon = han ? "：" : ": ";
    const after = src.slice(last);
    const colonAfter = /^[：:]/.test(after);
    const quoteAfter = /^[「『“"]/.test(after);
    const lineEnd = !after || /^\r?\n/.test(after);
    const lineStart = !src.slice(src.lastIndexOf("\n", m.index - 1) + 1, m.index).trim();
    // 同一行里紧跟在时间码后面（中间只隔空格）
    if (beatEnds.some((end) => end <= m.index && /^[ \t]*$/.test(src.slice(end, m.index)))) {
      out = out.replace(/[ \t]+$/, "");
      out += `${colon}${t}`;
      // 后面本来有冒号就用它（「0-2s：拖拽入场：初始…」）；接着正文就补一个；接着引号用「，」
      if (!colonAfter && !lineEnd) out += quoteAfter ? (han ? "，" : ", ") : colon;
      continue;
    }
    if (lineStart && sectionKind(t)) {
      const skip = /^[：:][ \t]*/.exec(after)?.[0].length ?? 0;
      const rest = after.slice(skip);
      out += !rest || /^\r?\n/.test(rest) ? `${t}${colon.trim()}` : `${t}${colon.trim()}\n`;
      last += skip;
      continue;
    }
    if (colonAfter) out += t;
    else if (lineStart && lineEnd) out += `${t}${colon.trim()}`;
    else if (lineStart) out += quoteAfter ? `${t}${han ? "，" : ", "}` : `${t}${colon}`;
    else {
      const lead = /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t) ? " " : "";
      const tail = m[2] || (/[A-Za-z0-9]$/.test(t) && /^[A-Za-z0-9]/.test(after) ? " " : "");
      out += `${lead}${t}${tail}`;
    }
  }
  return out + src.slice(last);
}

/** 有几处【X】 */
export function bracketCount(text: string): number {
  return ((text || "").match(/【[^【】\n]*】/g) ?? []).length;
}

/**
 * 引号的认法：与 segmentGen.hasDialogue **同一个正则**（构建里 check-text-template.mjs 逐字比对两边的源码）——
 * 「这几处引号会不会被当成台词」与出片那边认的必须是同一批。
 */
const QUOTE = /[「『“"].{1,}?[」』”"]/g;
/** 引号前面是「说 / 道 / 问…」或冒号 = 一句台词（照官方示例「凛说：“……”」）；别的都当成给名词加的引号 */
const SPEECH_BEFORE =
  /(?:说|道|问|喊|叫|答|嚷|念|唱|叹|吼|骂|低语|嘀咕|嘟囔|自语|回答|回应|开口|呢喃)(?:着|了|道)?$|\b(?:says?|said|asks?|asked|shouts?|shouted|whispers?|whispered|repl(?:y|ies|ied)|yells?|yelled|murmurs?|murmured|exclaims?|exclaimed)$/i;

export interface QuoteSpan {
  at: number;
  end: number;
  /** 引号里的字 */
  inner: string;
  /** 像一句台词（前面是「说：」之类）：会配音，留着 */
  dialogue: boolean;
}

/** 正文里的引号（认法与 hasDialogue 同一个） */
export function quoteSpans(text: string): QuoteSpan[] {
  const src = text || "";
  const out: QuoteSpan[] = [];
  const re = new RegExp(QUOTE.source, QUOTE.flags);
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const before = src.slice(0, m.index).replace(/[ \t]+$/, "");
    const dialogue = /[：:]$/.test(before) || SPEECH_BEFORE.test(before.replace(/[，,]$/, ""));
    out.push({ at: m.index, end: m.index + m[0].length, inner: m[0].slice(1, -1), dialogue });
  }
  return out;
}

/** 去掉不是台词的引号（「拖拽一个“人物图标”」→「拖拽一个人物图标」），台词原样留着 */
export function unquoteLabels(text: string): string {
  const src = text || "";
  let out = "";
  let last = 0;
  for (const q of quoteSpans(src)) {
    if (q.dialogue) continue;
    out += src.slice(last, q.at) + q.inner;
    last = q.end;
  }
  return out + src.slice(last);
}

/**
 * 体检那一屏的两颗「一键改」（【X】、不是台词的引号）—— 界面**只调这一个**，先后在这里定死：先去引号、再改【】。
 * ★ 反过来的话「【女仆装】“黑色女仆裙”」先成了「女仆装：“黑色女仆裙”」，冒号 + 引号又被认成一句台词、去引号那一步就不动它了 ——
 *   点的先后不同、结果不同，还多出一段配音（2026-10-26 审核实跑）。unbracketTitles 自己也不在引号前面放冒号，这里再把顺序钉住。
 */
export function applyTextTplFixes(text: string, o: { brackets: boolean; quotes: boolean }): string {
  let s = text || "";
  if (o.quotes) s = unquoteLabels(s);
  if (o.brackets) s = unbracketTitles(s);
  return s;
}

// ── 命令参数（--dur / --ratio …）──────────────────────────────

/**
 * 写在提示词里的命令参数（Seedance 早期认文字指令 --rs / --dur / --rt / --wm…）：时长、画幅、分辨率由我们按档位钉死并按它报价，
 * 混进正文的话要么与报价对不上、要么被服务端的参数钉子整发拒 —— 体检里直接拦（IME 把「--」打成「—」的也认）。
 */
const CMD_PARAM = /(?:^|[\s，,。；;])((?:--|—{1,2}|–{1,2})[ \t]*(?:dur|duration|rs|resolution|rt|ratio|fps|wm|watermark|seed|cf|camerafixed|frames))\b/gi;

export function cmdParams(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(CMD_PARAM.source, CMD_PARAM.flags);
  for (let m = re.exec(text || ""); m; m = re.exec(text || "")) {
    const p = m[1].replace(/\s+/g, "");
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

// ── 内容规则：词表 A（露肤 / 去衣动作）× 词表 B（年龄模糊的主体）──────────

/**
 * 词表 A：露肤 / 去衣的**动作与状态**（Play Sexual Content 政策点名的「undress people」一类）。
 * ★ 认得窄一点：「脱」只认后面跟着衣物的（「摆脱 / 逃脱 / 脱离危险」不算），「脱下 / 脱掉」后面明说是外套、帽子、面具这类
 *   不露肤的也不算（「脱下外套挂好」）；「掀起 / 撩起」只认几个字之内跟着裙 / 衣的（「掀起热潮」不算）；
 *   「透视」只认透视装（Blender 里的「透视视图」不算）。
 * ★ P2 服务端 config/textTemplate 照抄同一份（跨仓 spec 钉一致）；改词表两边一起改。
 */
export const POLICY_EXPOSE: readonly RegExp[] = [
  /脱(?:[下掉去](?!外套|大衣|夹克|风衣|面具|帽|眼镜|手套|头盔|口罩|围巾)|[光衣鞋袜裤裙衫])/g,
  /(?:掀|撩)(?:起|开)?了?[^，,。；;：:\n]{0,4}?(?:裙|衣|袍|下摆|衬衫)/g,
  /剥(?:离|下|去|掉|开)?[^，,。；;：:\n]{0,6}?(?:衣|袜|裙|裤|皮肤|肌肤|身体|腿)/g,
  /解开[^，,。；;：:\n]{0,3}?(?:衣|扣|腰带|胸)/g,
  /(?:皮肤|肌肤|身体)(?:外露|裸露)|裸露|裸体|裸身|半裸|全裸|赤裸|一丝不挂|走光|透视装|透明(?:睡衣|内衣|衣服)|光腿|光着身子|宽衣解带|低领|低胸|深V|乳沟|事业线|内衣|内裤|胸罩|文胸|比基尼|情趣/g,
  /\bundress(?:es|ed|ing)?\b|\bstrip(?:s|ped|ping)?\s+(?:off|down|naked)\b|\btak(?:e|es|ing)\s+off\s+(?:(?:her|his|their|the)\s+)?(?:clothes|shirt|dress|skirt|socks?|stockings?|shoes?|bra|underwear|top|pants|jeans)\b|\bnaked\b|\bnude\b|\btopless\b|\blingerie\b|\bunderwear\b|\bbikini\b|\bsee-?through\b|\bupskirt\b|\bcleavage\b|\blift(?:s|ed|ing)?\s+(?:up\s+)?(?:her|the)\s+skirt\b/gi,
];

/**
 * 词表 B：年龄模糊的主体（「少女」「女孩」「学生」…）—— 单独出现不算问题，与 A 同时出现才不能上架。
 * ★ 2026-10-26 审核补：「女生 / 男生 / 小姑娘 / 学妹 / 妹妹…」与明写的未满 18 岁年龄（「14岁」「十四岁」「两岁」「a 14-year-old」「15 years old」「14yo」）——
 *   原来「一个14岁的女生脱下衬衫」只判成进审，不是不能上架。年龄只认 1~17：前面紧挨着数字的不算（「18岁」里的「8岁」、「二十岁」里的「十岁」）。
 */
export const POLICY_MINOR: readonly RegExp[] = [
  /少女|萝莉|幼女|幼童|幼儿|女童|男童|儿童|孩童|小孩|女孩|男孩|小学生|初中生|中学生|高中生|学生|校服|未成年|正太|女生|男生|小姑娘|小丫头|学妹|学弟|妹妹|童颜/g,
  /(?<![\d.])(?:1[0-7]|[1-9])[ \t]*周?岁/g,
  /(?<![\d一二三四五六七八九十百两])(?:十[一二三四五六七]?|[一二三四五六七八九两])[ \t]*周?岁/g,
  /\bJK\b|\bloli(?:ta)?\b|\bchild(?:ren)?\b|\bkids?\b|\bminors?\b|\bunderage\b|\bteen(?:s|age|aged|ager|agers)?\b|\bpre-?teens?\b|\btweens?\b|\bschool\s?(?:girls?|boys?|uniform)\b|\bgirls?\b|\bboys?\b|\bstudents?\b/gi,
  /\b(?:1[0-7]|[1-9])[- ]?(?:years?[- ]old|y\/?o)\b/gi,
];

/**
 * 「别画它」的词：「严禁出现骨骼错位、多肢体、裸露」是安全约束，不是要画它 —— 这种管得到它后面那一串列举里的每一项。
 * ★ 「不得不」不是禁止（「少女不得不脱下衬衫」）：不用在这里另挡 —— 「不得」后面那个「不」不是一串列举，NEG_SCOPE 不放行（构建里钉着）。
 */
const NEG_DEPICT = /严禁|禁止|切勿|不得|杜绝|避免|不要|不能|不许|不可|\bavoid(?:s|ing)?\b|\bnever\b|\bmust\s+not\b|\bdo(?:es)?\s*n[o']?t\s+(?:show|depict|include)\b/gi;
/**
 * 「没有 / 无 / no / without」：只管**露肤的状态**（「无裸露」「no nudity, never naked」）——
 * 管不到衣物与动作：「无内衣」「no underwear」是没穿，「without a word the girl undresses」是另一回事（2026-10-26 审核实跑）。
 */
const NEG_ABSENT = /无|没有|\bno\b|\bwithout\b/gi;
const EXPOSE_STATE = /^(?:裸露|裸体|裸身|半裸|全裸|赤裸|一丝不挂|走光|(?:皮肤|肌肤|身体)(?:外露|裸露)|naked|nude|topless)$/i;
/**
 * 否定词到命中词之间只许是「一串列举」：可选的「出现 / 有 / 任何」，若干个以「、/ 和 / 或 / and / or」收尾的短项，最后可以有一个程度词。
 * ★ 原来整个小句里只要有否定词就整句作废：「为避免弄湿而脱下衬衫」「Without a word the girl undresses」都不算了 —— 漏判，方向不安全
 *   （2026-10-26 审核实跑）。现在否定只管到紧挨着它的那串列举（「严禁出现骨骼错位、多肢体、裸露」照样不算），中间夹着别的话就照算。
 */
const NEG_SCOPE =
  /^[ \t]*(?:出现|有|露出|任何|any|showing|show)?[ \t]*(?:[^，,。.；;！!？?\n、和与及或]{1,10}?[ \t]*(?:、|和|与|及|或|以及|\/|／|\bor\b|\band\b)[ \t]*)*(?:任何|过度|过多|大面积|明显|多余|any|excessive|visible)?[ \t]*$/i;
const CLAUSE_BREAK = /[，,。.；;！!？?\n]/;

/** 命中词前面（同一小句里）有没有一个管得到它的否定词 */
function negated(clause: string, hit: string): boolean {
  for (const neg of [NEG_DEPICT, NEG_ABSENT]) {
    if (neg === NEG_ABSENT && !EXPOSE_STATE.test(hit)) continue;
    const re = new RegExp(neg.source, neg.flags);
    for (let m = re.exec(clause); m; m = re.exec(clause)) if (NEG_SCOPE.test(clause.slice(m.index + m[0].length))) return true;
  }
  return false;
}

function policyHits(text: string, lists: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    const re = new RegExp(list.source, list.flags);
    for (let m = re.exec(text); m; m = re.exec(text)) {
      let i = m.index - 1;
      while (i >= 0 && !CLAUSE_BREAK.test(text[i])) i--;
      if (!negated(text.slice(i + 1, m.index), m[0]) && !out.includes(m[0])) out.push(m[0]);
    }
  }
  return out;
}

export interface TextTplPolicy {
  /** blocked = A∧B，不能上架；review = 只有 A，进审时高亮；null = 没命中 */
  level: "blocked" | "review" | null;
  /** 命中的词（审核卡片 / 作者那一屏高亮用） */
  expose: string[];
  minor: string[];
}

/**
 * 内容规则（文件头 ★★ ④）。几样公开展示的东西一起看：正文、标题、简介、每个图位的提示 —— 调用方都传进来。
 * P1 只用来在作者那一屏说「这种内容上不了市场」；本机自用不受它影响。
 */
export function textTplPolicyFlags(...parts: readonly string[]): TextTplPolicy {
  const text = parts.filter(Boolean).join("\n");
  const expose = policyHits(text, POLICY_EXPOSE);
  const minor = policyHits(text, POLICY_MINOR);
  return { level: expose.length ? (minor.length ? "blocked" : "review") : null, expose, minor };
}

// ── 体检：作者那一屏要说的几件事 ───────────────────────────────

export type TextTplFinding =
  /** 什么都没写 —— 拦 */
  | { kind: "empty" }
  /** 命令参数（--dur…）—— 拦 */
  | { kind: "params"; hits: string[] }
  /** 有【X】—— 一键改（默认打勾） */
  | { kind: "brackets"; count: number }
  /** 不是台词的引号 —— 一键去掉 */
  | { kind: "labelQuotes"; labels: string[] }
  /** 有台词 —— 只提醒：会配音（这一档出声的话） */
  | { kind: "dialogue"; count: number }
  /** 时间轴：几段、写到第几秒、有没有跳着写，以及改写成镜头那一条路走得通不通（tooMany = 拦） */
  | { kind: "timeline"; beats: number; maxSec: number; gaps: boolean; shots: "ok" | "merge" | "tooMany" }
  /** 「时间轴」那一段之外像时间码的写法（timelineOf 的 stray）：只提醒 —— 它们不改写成镜头、也不算进模板时长 */
  | { kind: "strayTimecodes"; count: number }
  /** 认出的图位（下一步起名）；over = 比文字模板段能带的临时参考图多 —— 拦 */
  | { kind: "slots"; nums: number[]; over: boolean }
  /** 内容规则命中 */
  | { kind: "policy"; level: "blocked" | "review"; expose: string[]; minor: string[] };

/**
 * 体检（建模板第②步那一屏）：只认、只报，一个字都不改 —— 改是作者点了那几颗「一键改」之后的事。
 * @param o.shotMax shotScript.SHOT_MAX
 * @param o.slots   refMentions.templateSlotRefs(text) 的结果（这个文件不许有运行时依赖，由调用方算好传进来）
 * @param o.policyParts 除正文之外一起公开展示的字：标题、简介、每个图位的提示 —— 内容规则一次全算进来，界面只读这一份结论
 *   （原来体检只看正文，标题里写着「少女脱下衬衫」体检里一个字不提，界面要么漏、要么自己再调一次 = 第二个判定点，2026-10-26 审核）。
 *   必填：漏传是零症状的；真没有就传 []。
 */
export function textTplFindings(
  text: string,
  o: { shotMax: number; slots: { nums: readonly number[]; over: boolean }; policyParts: readonly string[] },
): TextTplFinding[] {
  const src = text || "";
  if (!src.trim()) return [{ kind: "empty" }];
  const out: TextTplFinding[] = [];
  const params = cmdParams(src);
  if (params.length) out.push({ kind: "params", hits: params });
  const brackets = bracketCount(src);
  if (brackets) out.push({ kind: "brackets", count: brackets });
  const quotes = quoteSpans(src);
  const labels = quotes.filter((q) => !q.dialogue).map((q) => q.inner);
  if (labels.length) out.push({ kind: "labelQuotes", labels });
  const lines = quotes.filter((q) => q.dialogue).length;
  if (lines) out.push({ kind: "dialogue", count: lines });
  const { beats, stray } = timelineOf(src);
  if (beats.length) {
    const conv = timecodesToShots(src, o.shotMax).kind;
    out.push({
      kind: "timeline",
      beats: beats.length,
      maxSec: Math.max(...beats.map((b) => b.to)),
      gaps: timecodeGaps(beats),
      shots: conv === "tooMany" ? "tooMany" : conv === "merge" ? "merge" : "ok",
    });
  }
  if (stray.length) out.push({ kind: "strayTimecodes", count: stray.length });
  if (o.slots.nums.length) out.push({ kind: "slots", nums: [...o.slots.nums], over: o.slots.over });
  const policy = textTplPolicyFlags(src, ...o.policyParts);
  if (policy.level) out.push({ kind: "policy", level: policy.level, expose: policy.expose, minor: policy.minor });
  return out;
}

/** 体检里有没有拦着不让存的（空 / 命令参数 / 时间轴超过 9 段 / 图位太多）。内容规则不拦存 —— 本机自用不受影响 */
export function textTplBlocked(findings: readonly TextTplFinding[]): boolean {
  return findings.some(
    (f) => f.kind === "empty" || f.kind === "params" || (f.kind === "timeline" && f.shots === "tooMany") || (f.kind === "slots" && f.over),
  );
}

// ── 存前定型 ───────────────────────────────────────────────

/**
 * 存进本机之前把正文定型（文件头 ★★ ⑤）：换行统一成 \n、去掉行尾空白、三个以上的空行压成一个、首尾去空，再 packShots 一遍
 * （「Shot 1:」「镜头 一 :」写成「镜头N：」、空镜头拿掉、编号重排）。
 * ★ 存的就是会发的样子：出片前 segmentGen 还会 packShots 一次，对定型后的正文它一个字都不改（构建里核对）——
 *   P2 服务端拿「发出去的字包含模板正文」认试炼时才对得上（审核意见：漏了 packShots 这一步，作者可能永远过不了试炼）。
 * @param pack 传 shotScript.packShots（这个文件不许有运行时依赖）
 */
export function canonTextTplPrompt(text: string, pack: typeof PackShots): string {
  const flat = (text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t　]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return pack(flat).trim();
}

/**
 * 定型后正文的指纹（FNV-1a 32 位 + 长度）：「这一段的正文还是不是模板原样」只拿它比 —— 只对 canonTextTplPrompt 的结果算。
 * 不是安全用途（防不了故意碰撞）：服务端认试炼时自己再核正文。
 */
export function textTplSig(canon: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${canon.length.toString(36)}-${h.toString(16).padStart(8, "0")}`;
}
