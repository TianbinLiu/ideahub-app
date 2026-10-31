// 「唱一段」（跟着做 L，2026-10-31，方案 docs/canvas-platforms-ecosystem-research.md §五 L 与第十节的付费探测）—— 规则的唯一实现：
//   ① 歌词怎么收（自己写的一段文字 → 几行；AI 写的回话 → 几行）、几行算合格、这一段时长唱得完多少；
//   ② 发给视频模型的那段话怎么写（「唱歌，不是念白」+ 曲风 + 旋律 + 官方台词格式「X台词（唱，情绪）：“……”」+ 歌词分行 + 「成年」）；
//   ③ 让模型写歌词那一发怎么问、回话怎么收。
//
// 纯函数、零运行时依赖（只许 import type）：构建里 scripts/check-song-shots.mjs 直接 import 它跑正反例。
// ★ 调模型、扣钱、说人话在 studio/structuredSkills（runLyrics）与 studio/songDraftStore；落段是一段参考图直出段（songAppendSpec）。
// ★★ 写法是 2026-10-31 付费探测（design/singing-probe-2026-10-31.mjs，¥10.28）选出来的 s2：歌词当台词写（s1）模型是念出来的；
//   明说「唱歌，不是念白」+ 曲风 + 「有清晰的旋律起伏，每一句拖长尾音」+ 官方台词格式 + 歌词分两句一行，mini 中英文都唱出来了（主人听过）；
//   2.5 不比 mini 更会唱。官方 2.5 提示词指南里一个字都没提唱歌，这条路全靠这一发探测，改写法要重验。
// ★ 「成年」钉死：探测里 2.5 那一发把人画成了未成年（童脸 + 童声），与客服外貌口径「成年」同一个理由。
// ★★ 台词格式照 shotScript.lineSpeakers / segmentGen.hasDialogue 认的形状写：引号里的字会被配音，引号前紧挨着的名字是把这句接到
//   那张卡声音样本上的钥匙（「本人声音样本自证」靠的就是它）—— 所以歌词里不许留引号（parseLyrics 摘掉），每行只用「名字台词（唱，情绪）：」开头。
//   构建里那份检查拿 lineSpeakers 本尊逐句核对（check-song-shots.mjs）。
// ★ 一镜到底、不写「镜头N：」：写成分镜表会被当成多镜头（shotScript.isMultiShot），出片规则就变了；唱一段本来就是一条独立的片子。
// ★ 不收用户上传的歌（版权，decisions §五）：这里只有歌词 → 唱，没有音频参考那条路。

export type SongLang = "zh" | "en";

export type SongStyleId = "ballad" | "pop" | "rock" | "guofeng" | "jazz" | "lullaby";
export type SongMoodId = "tender" | "joyful" | "deep" | "strong";

/** 歌词几行：少于 2 行唱不成一段；多于 8 行 30 秒也唱不完（更长的歌分两段做） */
export const LYRIC_LINES_MIN = 2;
export const LYRIC_LINES_MAX = 8;
/** 每行多长（字符，收的时候的硬顶；中文一行 6~14 字最顺口，英文按单词在 lyricsIssue 里另算） */
export const LYRIC_LINE_MAX = 40;
/** 整段歌词的硬顶（字符）：输入框的 maxLength；提示词上限另由 songPromptIssue 按档位核 */
export const LYRICS_TEXT_MAX = 400;
/** 主题（让 AI 写歌词那一句）的长度 */
export const THEME_MIN = 2;
export const THEME_MAX = 120;
/** L 的默认时长（秒）：探测里 5 秒只唱得完两句；四行歌词 15 秒合适（高清上限 15、电影级 30），按档位的窗口夹（economy.clampDuration） */
export const SONG_DEFAULT_SEC = 15;
/**
 * 一秒唱得完多少「单位」（汉字一个算 1、字母一个算 0.4、数字 0.5）。
 * ★ 2026-10-31 探测读数：5 秒里 mini 唱完两句共 16 个汉字（≈ 3.2 / 秒），但尾音被截、听着赶；按 2.5 / 秒留出拖长尾音与前奏的余量。
 *   说话（cutProject.TTS_CPS）是 4 个字 / 秒上下 —— 唱比说慢，别拿配音那组数来套。
 */
export const SING_UNITS_PER_SEC = 2.5;

/* i18n-frozen: 曲风与情绪是发给视频模型的原话（中英各一份，按歌词的语言挑），冻结 */
export const SONG_STYLES: ReadonlyArray<{ id: SongStyleId; zh: string; accZh: string; en: string; accEn: string }> = [
  { id: "ballad", zh: "抒情民谣，慢板", accZh: "背景只有轻柔的钢琴伴奏", en: "a slow acoustic ballad", accEn: "only a soft piano underneath" },
  { id: "pop", zh: "流行歌，中速，节奏明快", accZh: "轻快的鼓点和合成器伴奏", en: "an upbeat pop song at a steady tempo", accEn: "light drums and synths underneath" },
  { id: "rock", zh: "摇滚，有力的节奏", accZh: "失真吉他和鼓的伴奏", en: "a driving rock song", accEn: "distorted guitar and drums underneath" },
  { id: "guofeng", zh: "古风，婉转悠长", accZh: "古筝与竹笛的伴奏", en: "a classical Chinese-style tune, lilting and long", accEn: "guzheng and bamboo flute underneath" },
  { id: "jazz", zh: "爵士，慵懒摇摆", accZh: "低音提琴和钢琴的伴奏", en: "a lazy, swinging jazz number", accEn: "upright bass and piano underneath" },
  { id: "lullaby", zh: "摇篮曲，轻柔缓慢", accZh: "几乎没有伴奏，只有轻轻的哼鸣", en: "a gentle, slow lullaby", accEn: "almost no accompaniment, just a soft hum" },
];
/* i18n-frozen: 情绪是发给视频模型的原话（「X台词（唱，温柔）：」里那个词），冻结 */
export const SONG_MOODS: ReadonlyArray<{ id: SongMoodId; zh: string; en: string }> = [
  { id: "tender", zh: "温柔", en: "tender" },
  { id: "joyful", zh: "欢快", en: "joyful" },
  { id: "deep", zh: "深情", en: "heartfelt" },
  { id: "strong", zh: "有力", en: "powerful" },
];
export const styleById = (id: string | null | undefined) => SONG_STYLES.find((s) => s.id === id) ?? SONG_STYLES[0];
export const moodById = (id: string | null | undefined) => SONG_MOODS.find((m) => m.id === id) ?? SONG_MOODS[0];

/* i18n-frozen: 没挑场景卡时的缺省舞台（发给视频模型），冻结 */
const DEFAULT_SCENE_ZH = "小剧场的舞台上，一支立式麦克风，暖黄的追光，背景一片深蓝。固定机位中景。";
const DEFAULT_SCENE_EN = "On a small theater stage, a standing microphone under a warm spotlight, deep blue backdrop. Fixed medium shot.";

/** 引号（与 shotScript.LINE_QUOTE 认的是同一批）：歌词正文里一律摘掉，台词的引号由 songPrompt 自己加 */
const QUOTES = /[「」『』“”"]/g;
/** 正文里不许留的镜头标识（与 shotScript.MARK 认的是同一批写法） */
const MARK_IN_TEXT = /(镜头|shot)\s*[0-9一二三四五六七八九十]+\s*[:：]/gi;
/** 行尾的句读（拼进引号时统一换成「，」与「。」） */
const TAIL_PUNCT = /[，,。.；;！!？?、\s]+$/;
const HEAD_PUNCT = /^[，,。.；;！!？?、\s]+/;

function cleanLine(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(MARK_IN_TEXT, "").replace(QUOTES, "").replace(/\s+/g, " ").replace(HEAD_PUNCT, "").replace(TAIL_PUNCT, "").trim().slice(0, LYRIC_LINE_MAX).trim();
}

/** 自己写的一段歌词 → 几行：按换行 / 句号 / 斜杠切，摘引号与镜头标识，空行不算 */
export function parseLyrics(text: string): string[] {
  return (text || "")
    .split(/\r?\n|[。；;！？!?]|\s\/\s|\//)
    .map(cleanLine)
    .filter(Boolean);
}

/** 一行唱出来要多少「单位」：汉字 1、字母 0.4、数字 0.5、标点空格 0 */
export function lyricUnits(line: string): number {
  let n = 0;
  for (const ch of line) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x2e80) n += 1;
    else if (/[a-zA-Z]/.test(ch)) n += 0.4;
    else if (/[0-9]/.test(ch)) n += 0.5;
  }
  return n;
}
export const lyricsUnits = (lines: readonly string[]): number => lines.reduce((n, l) => n + lyricUnits(l), 0);
/** 这一段时长唱得完多少单位 */
export const lyricCapUnits = (durationSec: number): number => Math.floor(Math.max(0, durationSec) * SING_UNITS_PER_SEC);
/** 这几行歌词至少要几秒（向上取整到整秒）—— 时长按钮的下限 */
export const lyricsMinSec = (lines: readonly string[]): number => Math.ceil(lyricsUnits(lines) / SING_UNITS_PER_SEC);

/** 歌词是哪种语言（与 sceneShots.sceneLang 同一个判据；不 import 它 —— 零运行时依赖） */
export function songLang(text: string): SongLang {
  let cjk = 0;
  let latin = 0;
  for (const ch of text || "") {
    if (/[a-zA-Z]/.test(ch)) latin++;
    else if ((ch.codePointAt(0) ?? 0) >= 0x2e80) cjk++;
  }
  return latin >= 12 && latin * 0.4 > cjk ? "en" : "zh";
}

export type LyricsIssue =
  /** 行数不够 / 太多 */
  | { code: "few"; min: number }
  | { code: "many"; max: number }
  /** 这一段时长唱不完：要么删几行，要么把时长拉长到 needSec */
  | { code: "over"; needSec: number };

/** 这几行配这个时长行不行（null = 行） */
export function lyricsIssue(lines: readonly string[], durationSec: number): LyricsIssue | null {
  if (lines.length < LYRIC_LINES_MIN) return { code: "few", min: LYRIC_LINES_MIN };
  if (lines.length > LYRIC_LINES_MAX) return { code: "many", max: LYRIC_LINES_MAX };
  if (lyricsUnits(lines) > lyricCapUnits(durationSec)) return { code: "over", needSec: lyricsMinSec(lines) };
  return null;
}

/** 名字里的引号 / 冒号会和台词格式打架：替换前先剥掉 */
const safeName = (s: string): string => s.replace(/[「」『』“”":：（）()]/g, "").trim();

/**
 * 发给视频模型的那段话（存进方案的 plot）。两行歌词合成一句台词（探测里就是这么写的：一句一行时模型会在每行之间停顿）。
 * ★ 一镜到底、不写「镜头N：」；台词只出现在「名字台词（唱，情绪）：“……”」里；「成年」钉死（见文件头）。
 * ★ 「画面上不要出现字幕」那句不在这里写：segmentGen.noSubtitleLine 对出声的档一律接（写两遍只是占字数）。
 */
/* i18n-frozen: 发给视频模型的唱段提示词（舞台、「成年」、台词格式、尾句），冻结中文 */
export function songPrompt(o: { singer: string; lines: readonly string[]; styleId: string; moodId: string; place: string; lang: SongLang }): string {
  const style = styleById(o.styleId);
  const mood = moodById(o.moodId);
  /* i18n-frozen: 没给名字时的兜底称呼，进视频模型 */
  const singer = safeName(o.singer) || (o.lang === "en" ? "The singer" : "主唱");
  const pairs: string[][] = [];
  for (let i = 0; i < o.lines.length; i += 2) pairs.push(o.lines.slice(i, i + 2));
  const place = safeName(o.place);
  if (o.lang === "en") {
    const scene = place ? `${place}. ` : `${DEFAULT_SCENE_EN} `;
    const head = `${scene}${singer} is an adult singing into the microphone — singing, not speaking: ${style.en}, with a clear melody, each line held on a long note, ${style.accEn}.`;
    const lines = pairs.map((p) => `${singer} lyrics (singing, ${mood.en}): "${p.join(", ")}."`);
    return [head, ...lines, "Sing exactly these lyrics, add nothing and leave nothing out."].join("\n");
  }
  /* i18n-frozen: 舞台那一句（中文），进视频模型 */
  const scene = place ? `${place}。` : DEFAULT_SCENE_ZH;
  /* i18n-frozen: 头一句（「成年」/ 唱歌不是念白 / 曲风 / 旋律 / 伴奏），进视频模型 */
  const head = `${scene}${singer}是成年人，对着麦克风唱歌，不是念白：${style.zh}，有清晰的旋律起伏，每一句拖长尾音，${style.accZh}。`;
  /* i18n-frozen: 官方台词格式「名字台词（唱，情绪）：“……”」，进视频模型 */
  const lines = pairs.map((p) => `${singer}台词（唱，${mood.zh}）：“${p.join("，")}。”`);
  /* i18n-frozen: 尾句，进视频模型 */
  const tail = "严格按歌词演唱，不要增减歌词。";
  return [head, ...lines, tail].join("\n");
}

/** 拼出来的整段放不放得进这一档的出片提示词（economy.promptMaxOf 由调用方传进来；超了就得删几行） */
export function songPromptIssue(prompt: string, max: number): { len: number; max: number } | null {
  return prompt.length > max ? { len: prompt.length, max } : null;
}

// ── 让 AI 写歌词（第六条官方结构化技能「一个主题 → 歌词」，studio/structuredSkills.runLyrics）──

export type LyricsErrorCode = "noJson" | "badJson" | "noLines" | "dupKeys";
export class LyricsError extends Error {
  code: LyricsErrorCode;
  constructor(code: LyricsErrorCode) {
    super(code);
    this.code = code;
  }
}

/* i18n-frozen: 发给作词模型的系统提示（发给模型的指令，冻结中文） */
export const LYRICS_SYS =
  `你是作词人。按给出的主题、曲风和行数写一段原创歌词，只输出 JSON：{"lines":["第一句","第二句"]}。` +
  `规矩：每句中文 6~14 个字（英文 4~9 个词），句与句押韵或对仗、唱得顺口；是原创，不抄、不改写任何已有歌曲的歌词；` +
  `不写歌名、不写括号备注、不写「副歌」之类的标记、不出现引号；只输出 JSON，不要解释。`;

/* i18n-frozen: 发给作词模型的主题（语言那一行按 songLang 明说），冻结中文 */
export const lyricsBrief = (o: { theme: string; singer: string; styleId: string; lines: number; lang: SongLang }): string =>
  [
    o.lang === "en" ? "用英文写歌词（字段名照旧）。" : "用中文写。",
    `曲风：${styleById(o.styleId).zh}`,
    `行数：恰好 ${o.lines} 行`,
    `唱的人：${safeName(o.singer) || "（没有指定）"}`,
    `主题：${o.theme}`,
  ].join("\n");

/** 原文里某个键出现了几次（数重复键用） */
function keyCount(raw: string, key: string): number {
  return (raw.match(new RegExp(`"${key}"\\s*:`, "g")) ?? []).length;
}

/**
 * 作词模型的回话 → 几行歌词。形状不对抛 LyricsError（调用方说人话）；多出来的行不收（返回 dropped 给界面说一句）。
 * @param max 最多收几行（调用方传 LYRIC_LINES_MAX 或人要的行数）
 */
export function parseLyricsReply(raw: string, max: number): { lines: string[]; dropped: number } {
  const text = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new LyricsError("noJson");
    try {
      data = JSON.parse(m[0]);
    } catch {
      throw new LyricsError("badJson");
    }
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const arr = Array.isArray(data) ? data : obj?.lines;
  if (!Array.isArray(arr)) throw new LyricsError("noLines");
  // 重复键：原文里 "lines" 出现了不止一次 = 模型把几段写进了同一个对象，JSON.parse 只留最后一段（memory ark-api-facts ①）
  if (keyCount(text, "lines") > 1) throw new LyricsError("dupKeys");
  const all = arr.map(cleanLine).filter(Boolean);
  if (!all.length) throw new LyricsError("noLines");
  return { lines: all.slice(0, max), dropped: Math.max(0, all.length - max) };
}
