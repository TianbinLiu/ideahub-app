// 「一场戏 → 一段多镜头」—— 跟着做 B（主角定妆 · 多镜头）第③步那一发对话的输入与输出规则，唯一实现
// （2026-10-04 第二期，方案 docs/guided-modes-design.md §二 B）。
//
// 纯函数、零运行时依赖（只许 import type）：构建里 scripts/check-scene-shots.mjs 直接 import 它跑正反例。
// ★ 调模型、扣钱、说人话在 studio/structuredSkills（runSceneToShots）；把几个镜头拼成一段话（「镜头N：」标识）只在
//   data/shotScript.joinShots —— 这里只出**每个镜头的正文**，标识的写法别在这里再抄一份。
// ★★ 模型输出是不可信输入（与「剧本 → 分镜」同一副骨架）：形状不对整发不认（钱在请求成功那一拍扣过一次，不再扣第二次）。
//   方舟 chat 吐 JSON 的三个已知脾气（memory ark-api-facts）各有一道：
//   ① 数组被写成一个对象里重复的键（JSON.parse 只留最后一对）→ 按原文数 "picture" / "speaker" 的个数，对不上整发不认；
//   ② 用哪种语言写由 brief 第一行明说（sceneLang 判，不让模型自己判 —— 提示词是中文的，它照样写中文）；
//   ③ 输出长度：上限在调用方（skillChat 的 maxTokens），拼出来的整段超不超这一档的提示词上限也由调用方核。
// ★ 写法照官方提示词指南（2026-10-03 查，见 shotScript 文件头）：不写每个镜头的秒数；台词写在引号里、前面点明谁说的
//   （引号内的字才会被配音），每句只写一次。说话人的名字是把这句话接到那张卡声音样本上的钥匙（shotScript.lineSpeakers），
//   所以提示词里要求只用给出的卡名；模型另起的名字照收（多半是路人），由界面点出来。
// ★ 镜头正文里不许留「镜头N：」（parseShots 会把它当成新的一格，整段被切坏）；画面与整体交代里不许留引号
//   （引号里的字会被当成台词配音：「门上挂着“营业中”」就会有人念出「营业中」）。

export type SceneLang = "zh" | "en";

/** 一段最多几个人出场。官方 FAQ：一张图里超过 4 人不稳（docs/multi-character-consistency-research.md） */
export const LEAD_CAST_MAX = 4;
/** B 的默认时长（秒）：方案原话「默认 12 秒（高清最长 15、电影级最长 30）」。用的时候按档位的窗口夹（economy.clampDuration）——
 *  选法屏那一行的报价与向导第④步的缺省读的都是它 */
export const LEAD_DEFAULT_SEC = 12;
/** 这场戏写多少字：一两句话。太短拆不出镜头，太长就不是一段了 */
export const SCENE_MIN = 6;
export const SCENE_MAX = 300;

/** 整体交代 / 画面 / 台词 / 景别 / 运镜各自的上限（字符）。模型那边的要求写在 SCENE_SHOTS_SYS，这里是收的时候的硬顶 */
const LEAD_MAX = 80;
const PICTURE_MAX = 120;
const LINE_MAX = 40;
const SIZE_MAX = 8;
const CAMERA_MAX = 12;
const SPEAKER_MAX = 12;

export interface SceneLine {
  speaker: string;
  text: string;
}
export interface SceneShot {
  /** 景别（远景 / 全景 / 中景 / 近景 / 特写），可空 */
  size: string;
  /** 运镜，可空 */
  camera: string;
  picture: string;
  lines: SceneLine[];
}
/** 收的时候顺手处理掉、要让人知道的事（界面说成句子；这里只给事实） */
export type SceneNote =
  /** 模型多给了镜头，超出上限的那几个没收 */
  | { kind: "dropped"; count: number }
  /** 画面是空的镜头，整个没收 */
  | { kind: "empty"; count: number }
  /** 说话人不在给出的卡名里（多半是路人）：照收，声音由模型自己配 */
  | { kind: "strangers"; names: string[] };
export interface ScenePlan {
  /** 整体交代（地点、时间、光线与氛围）。可空 */
  lead: string;
  shots: SceneShot[];
  notes: SceneNote[];
}

export type SceneShotsErrorCode = "noJson" | "badJson" | "noShots" | "dupKeys";
/** 形状不对（调用方按 code 说人话，这一次已经计费）。
 *  ★ 字段显式声明、不用构造函数参数属性（`constructor(readonly code …)`）：构建里 Node 只剥类型，那种写法它不认 */
export class SceneShotsError extends Error {
  readonly code: SceneShotsErrorCode;
  constructor(code: SceneShotsErrorCode) {
    super(code);
    this.code = code;
    this.name = "SceneShotsError";
  }
}

/**
 * 这场戏用哪种语言写（模型就按它写）。拉丁字母够多、又明显多过汉字才算英文 ——
 * 卡名常是中文（「小枫 walks in…」），所以只看这场戏本身，并且宁可判成中文（中文是提示词与镜头标识的母语）。
 */
export function sceneLang(text: string): SceneLang {
  let cjk = 0;
  let latin = 0;
  for (const ch of text || "") {
    if (/[a-zA-Z]/.test(ch)) latin++;
    else if ((ch.codePointAt(0) ?? 0) >= 0x2e80) cjk++;
  }
  return latin >= 12 && latin * 0.4 > cjk ? "en" : "zh";
}

/* i18n-frozen: 发给分镜模型的系统提示词（规定输出的 JSON 形状），冻结中文 */
export const SCENE_SHOTS_SYS =
  `你是分镜师。用户给出一场戏、出场人物的名字和这段视频的时长，把它拆成 2~4 个镜头，按事件顺序，节奏留给画面。` +
  `输出 JSON：{"lead":"整体交代：地点、时间、光线与氛围，40字内","shots":[{"size":"景别（远景/全景/中景/近景/特写）",` +
  `"camera":"运镜（固定/推/拉/摇/移/跟/环绕/手持，6字内）","picture":"这个镜头的画面与动作，60字内，写清谁在做什么",` +
  `"lines":[{"speaker":"说话人","text":"台词，20字内"}]}]}。` +
  `规矩：人物只用给出的名字，不另起名字，不写长相与服装（长相由人物参考图定）；台词只写在 lines 里，每句只写一次，不要在 picture 里复述；` +
  `没有台词的镜头 lines 给空数组；不写每个镜头的秒数；不写「镜头1」之类的编号；画面里不要出现引号。只输出 JSON，不要解释。`;

/* i18n-frozen: 发给分镜模型的这场戏（语言那一行按 sceneLang 明说），冻结中文 */
export const sceneShotsBrief = (o: { scene: string; cast: readonly string[]; durationSec: number; lang: SceneLang }): string =>
  [
    o.lang === "en"
      ? "用英文写 lead、picture 与台词（字段名照旧）。英文的长度按单词算：lead 不超过 15 个词，picture 不超过 25 个词，每句台词不超过 10 个词。"
      : "用中文写。",
    `出场人物：${o.cast.length ? o.cast.join("、") : "（没有指定，按这场戏里的人写）"}`,
    `视频时长：约 ${Math.round(o.durationSec)} 秒`,
    `这场戏：${o.scene}`,
  ].join("\n");

/** 正文里不许留的镜头标识（与 shotScript.MARK 认的是同一批写法） */
const MARK_IN_TEXT = /(镜头|shot)\s*[1-9一二三四五六七八九]\s*[:：]/gi;
/** 引号（与 shotScript.LINE_QUOTE 认的是同一批）：画面 / 交代 / 台词正文里一律摘掉，台词的引号由 shotBodyOf 自己加 */
const QUOTES = /[「」『』“”"]/g;

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(MARK_IN_TEXT, "").replace(QUOTES, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** 景别 / 运镜这种短词：再去掉首尾的句读 */
function word(v: unknown, max: number): string {
  return clean(v, max).replace(/^[，,。.；;：:、\s]+|[，,。.；;：:、\s]+$/g, "");
}

/** 原文里某个键出现了几次（数重复键用） */
function keyCount(raw: string, key: string): number {
  return (raw.match(new RegExp(`"${key}"\\s*:`, "g")) ?? []).length;
}

/**
 * 模型输出 → 形状检查。形状不对抛 SceneShotsError（调用方说人话）；能收的收下，收的时候处理掉的事记进 notes。
 * @param cast 给模型的卡名（说话人不在里面的记成 strangers）
 * @param max 最多收几个镜头（调用方传 shotScript.SHOT_MAX —— 这里不 import 它，零运行时依赖）
 */
export function parseSceneShots(raw: string, cast: readonly string[], max: number): ScenePlan {
  const text = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new SceneShotsError("noJson");
    try {
      data = JSON.parse(m[0]);
    } catch {
      throw new SceneShotsError("badJson");
    }
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const arr = Array.isArray(data) ? data : obj?.shots;
  if (!Array.isArray(arr)) throw new SceneShotsError("noShots");
  // ① 重复键：原文里 "picture" 比解析出来的镜头多 = 几个镜头被写进了同一个对象；台词同理
  const parsedLines = arr.reduce<number>((n, it) => {
    const ls = it && typeof it === "object" ? (it as Record<string, unknown>).lines : null;
    return n + (Array.isArray(ls) ? ls.length : 0);
  }, 0);
  if (keyCount(text, "picture") > arr.length || keyCount(text, "speaker") > parsedLines) throw new SceneShotsError("dupKeys");

  const names = new Set(cast.map((n) => (n || "").trim()).filter(Boolean));
  const strangers: string[] = [];
  const shots: SceneShot[] = [];
  let empty = 0;
  for (const it of arr) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const picture = clean(o.picture, PICTURE_MAX);
    if (!picture) {
      empty++;
      continue;
    }
    const lines: SceneLine[] = [];
    for (const l of Array.isArray(o.lines) ? o.lines : []) {
      const r = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
      const speaker = word(r.speaker, SPEAKER_MAX);
      const said = clean(r.text, LINE_MAX);
      if (!speaker || !said) continue;
      if (names.size && !names.has(speaker) && !strangers.includes(speaker)) strangers.push(speaker);
      lines.push({ speaker, text: said });
    }
    shots.push({ size: word(o.size, SIZE_MAX), camera: word(o.camera, CAMERA_MAX), picture, lines });
  }
  if (!shots.length) throw new SceneShotsError("noShots");
  const notes: SceneNote[] = [];
  if (shots.length > max) notes.push({ kind: "dropped", count: shots.length - max });
  if (empty) notes.push({ kind: "empty", count: empty });
  if (strangers.length) notes.push({ kind: "strangers", names: strangers });
  return { lead: clean(obj?.lead, LEAD_MAX), shots: shots.slice(0, Math.max(1, max)), notes };
}

const END_PUNCT = /[。.！!？?…]$/;

/* i18n-frozen: 镜头正文的写法（「景别，运镜。画面。X说：“台词”」）是发给视频模型的提示词，冻结中文 */
const SAYS_ZH = "说：";

/**
 * 一个镜头的正文（不带「镜头N：」，标识由 shotScript.joinShots 加）：「中景，固定。小枫推门进来。小枫说：“这本书还在吗？”」。
 * ★ 台词用中文弯引号、前面点明谁说的 —— 与 shotScript.insertLine 的写法一致，引号内的字才会被配音、说话人认得出是谁。
 *   英文用直引号（LINE_QUOTE 同样认）：`Rin says: "Still here?"`。
 */
export function shotBodyOf(s: SceneShot, lang: SceneLang): string {
  if (lang === "en") {
    const head = [s.size, s.camera].filter(Boolean).join(", ");
    const pic = END_PUNCT.test(s.picture) ? s.picture : `${s.picture}.`;
    const said = s.lines.map((l) => ` ${l.speaker} says: "${l.text}"`).join("");
    return `${head ? `${head}. ` : ""}${pic}${said}`;
  }
  const head = [s.size, s.camera].filter(Boolean).join("，");
  const pic = END_PUNCT.test(s.picture) ? s.picture : `${s.picture}。`;
  const said = s.lines.map((l) => `${l.speaker}${SAYS_ZH}“${l.text}”`).join("");
  return `${head ? `${head}。` : ""}${pic}${said}`;
}

/** 整体交代收尾：补一个句号（调用方把它当 joinShots 的 lead） */
export function leadOf(plan: ScenePlan, lang: SceneLang): string {
  const l = plan.lead.trim();
  if (!l) return "";
  return END_PUNCT.test(l) ? l : `${l}${lang === "en" ? "." : "。"}`;
}
