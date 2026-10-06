// 「对话正反打」（跟着做 I，2026-10-05 第一批，方案 docs/canvas-platforms-ecosystem-research.md §五）—— 输入与输出规则的唯一实现：
//   ① 第②步那一发对话（两个人 + 一个情境 → 2~6 句对白）怎么问、回话怎么收；
//   ② 第③步三个机位（双人镜头 / 过肩拍 A / 过肩拍 B）画什么、参考图怎么点名；
//   ③ 一句台词变成一段时，视频提示词怎么写、缺省给几秒。
//
// 纯函数、零运行时依赖（只许 import type）：构建里 scripts/check-dialogue-shots.mjs 直接 import 它跑正反例。
// ★ 调模型、扣钱、说人话在 studio/structuredSkills（runDialogue）与 studio/dialogueDraftStore；出图走 ai/real.generateFrame（单张）。
// ★★ 三个机位**一张接一张**画，不走组图：先画双人镜头，再拿它当图1 画两个过肩 ——
//   ① 过肩那两张要与双人镜头是同一个地方、同一道光、两人同一身衣服，拿双人那张当参考图是最直接的锚；
//   ② 不依赖服务端的组图任务（ideahub-server#106 还没合）：单张出图今天就能用。
// ★★ 一句一段，台词写成「名字说：“……”」：segmentGen.hasDialogue 认引号配音、shotScript.lineSpeakers 认出是谁说的
//   （只带那个人卡上的声音样本；出声的档再加「别出字幕」那一句）。这两处的规矩不在这里另写一份，只照它们认的形状写，
//   构建里那份检查拿 lineSpeakers 的认法逐句核对（check-dialogue-shots.mjs 的 (e)）。
// ★ 台词不进画面：画机位的那几句不写台词（出图模型拿到引号里的字会画成对话框，再当参考图发给视频，字就进了成片）。
// ★ 机位缺省：第一句双人镜头（交代两个人在哪、隔多远），之后谁说话拍谁的正脸（越过另一个人的肩膀）。
//   也可以拍听的人（反应镜头）：那一句写成「画外传来某某的声音」，lineSpeakers 照样认得出是谁说的。
// ★ 站位守 180 度线：双人镜头里 A 在左、B 在右；拍 A 的过肩，B 的肩膀在画面右侧前景、A 在左侧；拍 B 的反过来。
//   两个过肩接在一起时两人的视线才对得上（影视对话戏的基本规矩）。

export type DialogueLang = "zh" | "en";
/** 三个机位：双人镜头 / 拍第一个人的正脸（越过第二个人的肩膀）/ 拍第二个人的正脸 */
export type DialogueAngle = "two" | "faceA" | "faceB";
export const DIALOGUE_ANGLES: readonly DialogueAngle[] = ["two", "faceA", "faceB"];

/** 对白几句：少于 2 句不成对话；多于 6 句就是 6 段，又贵又碎（更长的戏分两次做，三个机位留着接着用） */
export const DIALOGUE_LINES_MIN = 2;
export const DIALOGUE_LINES_MAX = 6;
/** 情境（人的原话）的长度 */
export const SITUATION_MIN = 4;
export const SITUATION_MAX = 200;
/** 收的时候的硬顶（字符）。模型那边的要求写在 DIALOGUE_SYS（台词 20 字内），这里只是兜底；输入框用同一组数 */
export const LINE_TEXT_MAX = 40;
export const LINE_ACT_MAX = 20;
export const DIALOGUE_LEAD_MAX = 80;
const NAME_MAX = 12;

export interface DialogueLine {
  /** 谁说：0 = 第一个人（A），1 = 第二个人（B）—— 按选人时点的先后 */
  who: 0 | 1;
  /** 这句台词（不带引号） */
  text: string;
  /** 说这句时的动作或表情（选填，不写名字） */
  act: string;
  /** 这一句用哪个机位 */
  angle: DialogueAngle;
}
export type DialogueNote =
  /** 模型多写了几句，超出上限的没收 */
  | { kind: "dropped"; count: number }
  /** 台词是空的，整句没收 */
  | { kind: "empty"; count: number }
  /** 说话人不是这两个人（多半是路人）：整句没收 */
  | { kind: "strangers"; names: string[] };
export interface DialoguePlan {
  /** 整体交代（地点、时间、光线与氛围）。可空 */
  lead: string;
  lines: DialogueLine[];
  notes: DialogueNote[];
}

export type DialogueErrorCode = "noJson" | "badJson" | "noLines" | "dupKeys";
/** 形状不对（调用方按 code 说人话，这一次已经计费）。★ 字段显式声明、不用构造函数参数属性：构建里 Node 只剥类型，那种写法它不认 */
export class DialogueError extends Error {
  readonly code: DialogueErrorCode;
  constructor(code: DialogueErrorCode) {
    super(code);
    this.code = code;
    this.name = "DialogueError";
  }
}

/* i18n-frozen: 发给编剧模型的系统提示词（规定输出的 JSON 形状），冻结中文 */
export const DIALOGUE_SYS =
  `你是编剧。用户给出两个人的名字和一个情境（可能还有地点），写这两个人之间的一段对白：${DIALOGUE_LINES_MIN}~${DIALOGUE_LINES_MAX} 句，一般 3~4 句，两人轮流说。` +
  `之后每一句会单独拍成一个几秒的镜头，所以一句只说一件事。` +
  `输出 JSON：{"lead":"整体交代：地点、时间、光线与氛围，40字内","lines":[{"who":"说话人的名字","text":"这句台词，20字内","act":"说这句时的动作或表情，12字内"}]}。` +
  `规矩：说话人只用给出的两个名字；台词口语、简短；不写旁白、不写镜头、不写秒数；动作里不写名字；台词与动作里不要出现引号。` +
  `只输出 JSON，不要解释。`;

/* i18n-frozen: 发给编剧模型的情境（语言那一行按 sceneLang 明说），冻结中文 */
export const dialogueBrief = (o: { situation: string; names: readonly [string, string]; place: string; lang: DialogueLang }): string =>
  [
    o.lang === "en"
      ? "用英文写 lead、text 与 act（字段名照旧，who 里照抄给出的名字）。英文的长度按单词算：lead 不超过 15 个词，text 不超过 12 个词，act 不超过 6 个词。"
      : "用中文写。",
    `两个人：${o.names[0]}、${o.names[1]}`,
    o.place ? `地点：${o.place}` : "",
    `情境：${o.situation}`,
  ]
    .filter(Boolean)
    .join("\n");

/** 正文里不许留的镜头标识（与 shotScript.MARK 认的是同一批写法）：一句里留着「镜头2：」，出片时会被当成多镜头（isMultiShot） */
const MARK_IN_TEXT = /(镜头|shot)\s*[1-9一二三四五六七八九]\s*[:：]/gi;
/** 引号（与 shotScript.LINE_QUOTE 认的是同一批）：台词由这里加引号，模型写进来的引号一律摘掉，别让一句里出现两层 */
const QUOTES = /[「」『』“”"]/g;

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(MARK_IN_TEXT, "").replace(QUOTES, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** 人名这种短词：再去掉首尾的句读 */
function word(v: unknown, max: number): string {
  return clean(v, max).replace(/^[，,。.；;：:、\s]+|[，,。.；;：:、\s]+$/g, "");
}

/** 原文里某个键出现了几次（数重复键用） */
function keyCount(raw: string, key: string): number {
  return (raw.match(new RegExp(`"${key}"\\s*:`, "g")) ?? []).length;
}

/** 缺省机位：第一句双人镜头，之后谁说话拍谁的正脸 */
export function defaultAngle(i: number, who: 0 | 1): DialogueAngle {
  return i === 0 ? "two" : who === 0 ? "faceA" : "faceB";
}

/** 名字里的花括号、引号会和提示词打架：拼进句子之前先剥掉 */
const safeName = (s: string): string => (s || "").replace(/[{}「」『』“”"]/g, "").trim();

/**
 * 模型输出 → 形状检查。形状不对抛 DialogueError（调用方说人话）；能收的收下，收的时候处理掉的事记进 notes。
 * @param names 两个人的卡名（按点的先后）。说话人只认这两个名字，别的整句不收
 * @param max 最多收几句（DIALOGUE_LINES_MAX）
 */
export function parseDialogue(raw: string, names: readonly [string, string], max: number): DialoguePlan {
  const text = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new DialogueError("noJson");
    try {
      data = JSON.parse(m[0]);
    } catch {
      throw new DialogueError("badJson");
    }
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const arr = Array.isArray(data) ? data : obj?.lines;
  if (!Array.isArray(arr)) throw new DialogueError("noLines");
  // 重复键：原文里 "text" 比解析出来的句子多 = 几句被写进了同一个对象（JSON.parse 只留最后一对，静默少了几句）
  if (keyCount(text, "text") > arr.length) throw new DialogueError("dupKeys");

  const a = safeName(names[0]);
  const b = safeName(names[1]);
  const strangers: string[] = [];
  const lines: DialogueLine[] = [];
  let empty = 0;
  for (const it of arr) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const line = clean(o.text, LINE_TEXT_MAX);
    if (!line) {
      empty++;
      continue;
    }
    const speaker = word(o.who, NAME_MAX);
    const who: 0 | 1 | -1 = speaker === a ? 0 : speaker === b ? 1 : -1;
    if (who === -1) {
      if (speaker && !strangers.includes(speaker)) strangers.push(speaker);
      continue;
    }
    // 动作里不写名字（规矩里说了，模型偶尔照写）：开头那个说话人的名字剥掉，免得拼出来「林夏林夏放下杯子」
    let act = clean(o.act, LINE_ACT_MAX);
    const self = who === 0 ? a : b;
    if (self && act.startsWith(self)) act = act.slice(self.length).replace(/^[，,、\s]+/, "").trim();
    lines.push({ who, text: line, act, angle: defaultAngle(lines.length, who) });
  }
  if (!lines.length) throw new DialogueError("noLines");
  const notes: DialogueNote[] = [];
  if (lines.length > max) notes.push({ kind: "dropped", count: lines.length - max });
  if (empty) notes.push({ kind: "empty", count: empty });
  if (strangers.length) notes.push({ kind: "strangers", names: strangers });
  return { lead: clean(obj?.lead, DIALOGUE_LEAD_MAX), lines: lines.slice(0, Math.max(1, max)), notes };
}

/** 句末的标点（拼进另一句话之前去掉，免得「黄昏的天台。。」） */
const TAIL_PUNCT = /[。.！!？?…]+$/;
const END_PUNCT = /[。.！!？?…]$/;
const endWith = (s: string, lang: DialogueLang): string => (!s || END_PUNCT.test(s) ? s : `${s}${lang === "en" ? "." : "。"}`);

/**
 * 画一个机位的那一句（交给 ai/real.generateFrame 的 req；外壳「视频中的一个画面…单一完整画面，不要文字」由它加）。
 * ★ 只写站位与机位，不写台词（文件头 ★ 台词不进画面）。
 * @param ask 人补的一句要求（「沈舟戴着眼镜」）；空 = 照原样重画
 */
/* i18n-frozen: 画对话机位的出图句，进出图模型，冻结中文 */
export const angleMoment = (angle: DialogueAngle, names: readonly [string, string], lead: string, ask = ""): string => {
  const a = safeName(names[0]);
  const b = safeName(names[1]);
  const l = lead.trim().replace(TAIL_PUNCT, "");
  const shot =
    angle === "two"
      ? `中景，双人镜头：${a}在画面左边、${b}在画面右边，两人面对面交谈，都侧身对着镜头`
      : angle === "faceA"
        ? `近景，过肩镜头：镜头在${b}身后，画面右侧前景是${b}虚化的肩膀和后脑，${a}在画面左侧正对镜头、脸看得清楚，看着${b}`
        : `近景，过肩镜头：镜头在${a}身后，画面左侧前景是${a}虚化的肩膀和后脑，${b}在画面右侧正对镜头、脸看得清楚，看着${a}`;
  const extra = ask.trim() ? `。要求：${ask.trim().replace(TAIL_PUNCT, "")}` : "";
  return `${l ? `${l}。` : ""}${shot}；画面里只有这两个人，每个人只出现一次${extra}`;
};

/**
 * 画机位时接在后面的参考图点名句。
 * @param bind ai/real.shotGroupRefs 的「图几是谁」（卡图）；画过肩时它从图2 起编号
 * @param base 第一张参考图是这场戏已经画好的双人镜头（画两个过肩时为真）
 */
/* i18n-frozen: 画对话机位的参考图点名句，进出图模型，冻结中文 */
export const angleRefLine = (bind: string, base: boolean): string => {
  const head = base ? "图1 是这场戏的双人镜头：地方、光线、两人的长相和服装都照它，只把机位换成上面写的" : "";
  const all = [head, bind].filter(Boolean).join("；");
  return all ? `。参考图：${all}；人物的长相、发型与服装与参考图一致` : "";
};

/* i18n-frozen: 视频提示词里的机位那一句（中文），进视频模型 */
const shotZh = (angle: DialogueAngle, a: string, b: string): string =>
  angle === "two" ? `中景双人镜头，${a}和${b}面对面` : angle === "faceA" ? `过肩近景，越过${b}的肩膀拍${a}的正脸` : `过肩近景，越过${a}的肩膀拍${b}的正脸`;
const shotEn = (angle: DialogueAngle, a: string, b: string): string =>
  angle === "two"
    ? `Medium two-shot, ${a} and ${b} face each other`
    : angle === "faceA"
      ? `Over-the-shoulder close-up over ${b}'s shoulder on ${a}'s face`
      : `Over-the-shoulder close-up over ${a}'s shoulder on ${b}'s face`;

/** 这一句的机位拍的是说话的人吗（双人镜头两个人都在画面里，算是） */
export function facesSpeaker(line: Pick<DialogueLine, "who" | "angle">): boolean {
  return line.angle === "two" || (line.angle === "faceA" ? line.who === 0 : line.who === 1);
}

/**
 * 一句台词变成一段时的视频提示词（存进方案的 plot）：整体交代 + 机位 + 谁做什么 + 台词。
 * ★ 一段话、不写「镜头N：」：一句就是一个镜头，写成分镜表的格式会被当成多镜头（shotScript.isMultiShot）。
 * ★ 说话人的名字紧挨在引号前面那一小句里（「林夏说：“……”」）：lineSpeakers 一小句里恰好一个名字才认得准；
 *   动作单写一句放在前面（「林夏放下杯子。林夏说：“……”」）—— 动作里提到另一个人（「看着沈舟」）也不会把说话人弄混。
 * ★ 拍听的人（反应镜头）：说话的人在画外，动作不写（看不见），写「画外传来某某的声音」—— 引号前那一小句里仍然只有说话人。
 */
export function linePlot(line: DialogueLine, names: readonly [string, string], lead: string, lang: DialogueLang): string {
  const a = safeName(names[0]);
  const b = safeName(names[1]);
  const speaker = line.who === 0 ? a : b;
  const listener = line.who === 0 ? b : a;
  const text = line.text.replace(QUOTES, "").trim();
  const act = line.act.replace(QUOTES, "").trim().replace(TAIL_PUNCT, "");
  const on = facesSpeaker(line);
  if (lang === "en") {
    // ★ 英文的句号不是 lineSpeakers 认的断点（它只认全角句号、逗号、分号、问叹号、换行）：说话人前面一律用分号 / 逗号隔开，
    //   否则机位那句里的两个名字会跟说话人算进同一截、整段认不准
    const head = [endWith(lead.trim(), "en"), shotEn(line.angle, a, b)].filter(Boolean).join(" ");
    return on
      ? `${head}; ${act ? `${speaker} ${act}; ` : ""}${speaker} says: "${text}"`
      : `${head}. ${listener} listens quietly; off screen, ${speaker} says: "${text}"`;
  }
  /* i18n-frozen: 一句台词那一段的视频提示词（中文），进视频模型 */
  const zh = on ? `${act ? `${speaker}${act}。` : ""}${speaker}说：“${text}”` : `${listener}静静听着。画外传来${speaker}的声音：“${text}”`;
  return `${endWith(lead.trim(), "zh")}${shotZh(line.angle, a, b)}。${zh}`;
}

/**
 * 这一句缺省给几秒：念完要多久 + 前后各留一点（起势、收尾）。按档位的窗口夹由调用方做（economy.clampDuration）。
 * ★ 语速照剪辑页配音实测的那组数（cutProject.TTS_CPS = 4「字」/ 秒，字母一个折 0.4 个字 = cutProject.LATIN_UNIT）：
 *   这个文件零运行时依赖，数抄在这里、构建里那份检查逐个核对两边相等（check-dialogue-shots.mjs 的 (f)）。
 */
export const SPEECH_CPS = 4;
export const LATIN_UNIT = 0.4;
/** 念之前、念之后各留多少（秒）：人物先有一个起势，说完停一拍再切 */
export const LINE_PAD_SEC = 1.5;
export function lineSec(text: string): number {
  let units = 0;
  for (const ch of text || "") {
    if (/[\s\p{P}\p{S}]/u.test(ch)) continue;
    units += (ch.codePointAt(0) ?? 0) < 0x2e80 ? LATIN_UNIT : 1;
  }
  return Math.ceil(units / SPEECH_CPS + LINE_PAD_SEC);
}

/**
 * 一个机位的画面认的是哪一版（人、整体交代、画幅；过肩还认它照着哪一张双人镜头画的）：变了 → 这张过期，界面提醒重画。
 * @param baseId 过肩照着画的那一张双人镜头的 id（双人镜头自己传 ""）
 */
export function angleKey(angle: DialogueAngle, names: readonly [string, string], lead: string, aspect: string, baseId: string): string {
  return JSON.stringify([angle, safeName(names[0]), safeName(names[1]), lead.trim(), aspect, angle === "two" ? "" : baseId]);
}
