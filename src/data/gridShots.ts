// 「一场戏 → 九宫格分镜」—— 跟着做 C（九宫格分镜）的输入与输出规则，唯一实现（2026-10-05 第三期，方案 docs/guided-modes-design.md §二 C、§七）：
//   ① 第②步那一发对话（一场戏 → 4~9 个镜头的分镜清单）怎么问、回话怎么收；
//   ② 第③步那一发组图（一次画出全部镜头）的提示词与参考图怎么点名；
//   ③ 单格重画画哪个瞬间、一格变成一段时视频提示词怎么写。
//
// 纯函数、零运行时依赖（只许 import type）：构建里 scripts/check-grid-shots.mjs 直接 import 它跑正反例。
// ★ 调模型、扣钱、说人话在 studio/structuredSkills（runSceneToGrid）与 studio/gridDraftStore；出图在 ai/real（drawShotGroup / 单格走 generateFrame）。
// ★★ 每一格写两样（2026-10-05 付费对比的结论 1）：**画面**（这一格画哪个瞬间，给出图）与**动作**（接下来几秒发生什么，给视频）——
//   只写画面的那一格（「木门打开，沈舟站在门里」）出片是一张几乎不动的图：一格是一个瞬间，视频要的是接下来发生什么。
// ★★ 模型输出是不可信输入（与 data/sceneShots 同一副骨架）：形状不对整发不认（钱在请求成功那一拍扣过一次，不再扣第二次）；
//   数组被写成一个对象里重复的键（JSON.parse 只留最后一对）→ 按原文数 "picture" 的个数，对不上整发不认；
//   用哪种语言写由调用方按 data/sceneShots.sceneLang 判了传进来（第一行明说），不让模型自己判。
// ★ 「画面里有谁」是模型明说的（who），不靠在句子里找名字：一格里没有人（远景空镜）时就真的一张人物图都不带 ——
//   按名字找的办法（shotScript.momentCards）一个名字都找不到时会退回「全带」，空镜会被画进人。
// ★ 台词不在这里写：C 是先画面、后视频的做法（LibTV 的九宫格），一格一段只有几秒；要台词的走 B（主角定妆 · 多镜头），
//   或者落段之后在那一段的分镜表里加。

export type GridLang = "zh" | "en";

// ★ 一组最多几个人不在这里另写一个数：C 与 B 是同一批人（studio/leadDraftStore），上限同一个 data/sceneShots.LEAD_CAST_MAX
//   （官方：一张图超过 4 人不稳，docs/multi-character-consistency-research.md）。
/** 分镜清单要几个镜头（问模型时说的范围）。少于 4 格就不成「一组」了，多于 9 格一屏摆不下、也超出组图的预算 */
export const GRID_SHOTS_MIN = 4;
export const GRID_SHOTS_MAX = 9;
/** 一格一段的默认时长（秒）：一格是一个镜头，5 秒够演完「接下来发生的动作」；用的时候按档位的窗口夹（economy.clampDuration） */
export const GRID_DEFAULT_SEC = 5;
/** 组图的协议上限：参考图张数 + 出图张数 ≤ 15（官方「图片生成 API」，2026-10-05 读）。服务端同一个数（config/tokens.GROUP_MAX_IMAGES） */
export const GROUP_TOTAL_MAX = 15;
/** 组图里每个人最多带几张形象图（大头照 + 全身照，官方建议；多视图会被认成几个人） */
export const GROUP_REFS_PER_CHAR = 2;

/** 收的时候的硬顶（字符）。模型那边的要求写在 GRID_SHOTS_SYS，这里只是兜底 */
const LEAD_MAX = 80;
const PICTURE_MAX = 80;
const ACTION_MAX = 60;
const SIZE_MAX = 8;
const NAME_MAX = 12;

export interface GridShot {
  /** 景别（远景 / 全景 / 中景 / 近景 / 特写），可空 */
  size: string;
  /** 这一格画什么：一个瞬间（谁在哪、什么姿势和表情）—— 给出图 */
  picture: string;
  /** 接下来几秒发生的动作 —— 给视频。可空（空了那一段多半拍成一张不动的图，界面会提醒） */
  action: string;
  /** 画面里有谁（卡名；空 = 这一格没有人） */
  who: string[];
}
export type GridNote =
  /** 模型多给了镜头，超出上限的那几个没收 */
  | { kind: "dropped"; count: number }
  /** 画面是空的镜头，整个没收 */
  | { kind: "empty"; count: number }
  /** who 里有不在给出的卡名里的人（多半是路人）：从 who 里拿掉，画面照写 */
  | { kind: "strangers"; names: string[] };
export interface GridPlan {
  /** 整体交代（地点、时间、光线与氛围）。可空 */
  lead: string;
  shots: GridShot[];
  notes: GridNote[];
}

export type GridShotsErrorCode = "noJson" | "badJson" | "noShots" | "dupKeys";
/** 形状不对（调用方按 code 说人话，这一次已经计费）。★ 字段显式声明、不用构造函数参数属性：构建里 Node 只剥类型，那种写法它不认 */
export class GridShotsError extends Error {
  readonly code: GridShotsErrorCode;
  constructor(code: GridShotsErrorCode) {
    super(code);
    this.code = code;
    this.name = "GridShotsError";
  }
}

/* i18n-frozen: 发给分镜模型的系统提示词（规定输出的 JSON 形状），冻结中文 */
export const GRID_SHOTS_SYS =
  `你是分镜师。用户给出一场戏、出场人物的名字（可能还有地点），把它拆成 ${GRID_SHOTS_MIN}~${GRID_SHOTS_MAX} 个镜头的分镜清单，按事件顺序。` +
  `每个镜头之后会先单独画成一张画面，再拍成一段几秒的视频。` +
  `输出 JSON：{"lead":"整体交代：地点、时间、光线与氛围，40字内","shots":[{"size":"景别（远景/全景/中景/近景/特写）",` +
  `"picture":"这一格的画面：一个瞬间，谁在哪、什么姿势和表情，40字内","action":"画面之后接下来几秒发生的动作，25字内",` +
  `"who":["画面里出现的人名"]}]}。` +
  `规矩：人物只用给出的名字，不另起名字，不写长相与服装（长相由人物参考图定）；画面只写一个瞬间，动作写这个瞬间之后接着发生什么；` +
  `画面里没有人的镜头 who 给空数组；景别要有变化，别每格都是同一个景别；不写台词、不写秒数、不写「镜头1」之类的编号；画面与动作里不要出现引号。` +
  `只输出 JSON，不要解释。`;

/* i18n-frozen: 发给分镜模型的这场戏（语言那一行按 sceneLang 明说），冻结中文 */
export const gridShotsBrief = (o: { scene: string; cast: readonly string[]; place: string; lang: GridLang }): string =>
  [
    o.lang === "en"
      ? "用英文写 lead、picture 与 action（字段名照旧，who 里照抄给出的名字）。英文的长度按单词算：lead 不超过 15 个词，picture 不超过 15 个词，action 不超过 10 个词。"
      : "用中文写。",
    `出场人物：${o.cast.length ? o.cast.join("、") : "（没有指定，按这场戏里的人写）"}`,
    o.place ? `地点：${o.place}` : "",
    `这场戏：${o.scene}`,
  ]
    .filter(Boolean)
    .join("\n");

/** 正文里不许留的镜头标识（与 shotScript.MARK 认的是同一批写法）：一格的文字之后会进分镜表，留着就被切成两格 */
const MARK_IN_TEXT = /(镜头|shot)\s*[1-9一二三四五六七八九]\s*[:：]/gi;
/** 引号（与 shotScript.LINE_QUOTE 认的是同一批）：引号里的字会被当成台词配音（「门上挂着“营业中”」就会有人念出来） */
const QUOTES = /[「」『』“”"]/g;

function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(MARK_IN_TEXT, "").replace(QUOTES, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** 景别 / 人名这种短词：再去掉首尾的句读 */
function word(v: unknown, max: number): string {
  return clean(v, max).replace(/^[，,。.；;：:、\s]+|[，,。.；;：:、\s]+$/g, "");
}

/** 原文里某个键出现了几次（数重复键用） */
function keyCount(raw: string, key: string): number {
  return (raw.match(new RegExp(`"${key}"\\s*:`, "g")) ?? []).length;
}

/**
 * 模型输出 → 形状检查。形状不对抛 GridShotsError（调用方说人话）；能收的收下，收的时候处理掉的事记进 notes。
 * @param cast 给模型的卡名（who 里不在里面的记成 strangers、从 who 里拿掉）
 * @param max 最多收几格（GRID_SHOTS_MAX）
 */
export function parseGridShots(raw: string, cast: readonly string[], max: number): GridPlan {
  const text = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new GridShotsError("noJson");
    try {
      data = JSON.parse(m[0]);
    } catch {
      throw new GridShotsError("badJson");
    }
  }
  const obj = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const arr = Array.isArray(data) ? data : obj?.shots;
  if (!Array.isArray(arr)) throw new GridShotsError("noShots");
  // 重复键：原文里 "picture" 比解析出来的镜头多 = 几个镜头被写进了同一个对象（JSON.parse 只留最后一对，静默少了几格）
  if (keyCount(text, "picture") > arr.length) throw new GridShotsError("dupKeys");

  const names = new Set(cast.map((n) => (n || "").trim()).filter(Boolean));
  const strangers: string[] = [];
  const shots: GridShot[] = [];
  let empty = 0;
  for (const it of arr) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
    const picture = clean(o.picture, PICTURE_MAX);
    if (!picture) {
      empty++;
      continue;
    }
    const who: string[] = [];
    for (const w of Array.isArray(o.who) ? o.who : []) {
      const n = word(w, NAME_MAX);
      if (!n || who.includes(n)) continue;
      if (names.size && !names.has(n)) {
        if (!strangers.includes(n)) strangers.push(n);
        continue;
      }
      who.push(n);
    }
    shots.push({ size: word(o.size, SIZE_MAX), picture, action: clean(o.action, ACTION_MAX), who });
  }
  if (!shots.length) throw new GridShotsError("noShots");
  const notes: GridNote[] = [];
  if (shots.length > max) notes.push({ kind: "dropped", count: shots.length - max });
  if (empty) notes.push({ kind: "empty", count: empty });
  if (strangers.length) notes.push({ kind: "strangers", names: strangers });
  return { lead: clean(obj?.lead, LEAD_MAX), shots: shots.slice(0, Math.max(1, max)), notes };
}

const END_PUNCT = /[。.！!？?…]$/;
/** 句末的标点（拼进另一句话之前去掉，免得「推门进来。（画面里…）」） */
const TAIL_PUNCT = /[。.！!？?…]+$/;
const endWith = (s: string, lang: GridLang): string => (!s || END_PUNCT.test(s) ? s : `${s}${lang === "en" ? "." : "。"}`);

/** 整体交代收尾：补一个句号 */
export function gridLeadOf(lead: string, lang: GridLang): string {
  return endWith(lead.trim(), lang);
}

/**
 * 组图这一发最多带几张参考图：参考图 + 张数 ≤ 15（官方），每个人最多两张（大头照 + 全身照），其余每张卡一张。
 * ★ 给 ai/real.prepareMaterialRefs 当直通分配的上限：先每个人一张、再给场景卡一张、预算还有余才补第二张（allocateRefs 的分轮规则）。
 */
export function groupRefsCap(panels: number, chars: number, others: number): number {
  return Math.max(0, Math.min(GROUP_TOTAL_MAX - panels, chars * GROUP_REFS_PER_CHAR + others));
}

/** 组图提示词里那一句「图几是谁」的一项（由 ai/real 按**真正发出去的**参考图逐张对出来，编号与发出去的那批图一一对应） */
export interface GroupRef {
  name: string;
  /** 卡种：character / scene / prop / style …（只认 character 与 scene，别的照卡名说） */
  type: string;
  /** 这张卡占的图号（从 1 起） */
  nums: number[];
  /** 出片句（types.idLineOf；没写就是卡名，那时不重复） */
  idLine: string;
}

/** 组图提示词里点名参考图的那一句（「图1、图2 是林夏（…）；图3 是场景「灯塔」…」） */
/* i18n-frozen: 组图提示词里点名参考图的那一句，进出图模型，冻结中文 */
export const groupBindLine = (refs: readonly GroupRef[]): string =>
  refs
    .map((r) => {
      const nums = r.nums.map((n) => `图${n}`).join("、");
      if (r.type === "character") return `${nums} 是${r.name}${r.idLine && r.idLine !== r.name ? `（${r.idLine}）` : ""}`;
      if (r.type === "scene") return `${nums} 是场景「${r.name}」（只用来定地点的样子，构图照分镜来）`;
      return `${nums} 是「${r.name}」`;
    })
    .join("；");

/* i18n-frozen: 一格里有谁（进出图模型），冻结中文 */
const whoLine = (who: readonly string[]): string => (who.length ? `画面里：${who.join("、")}` : "画面里没有人");

/**
 * 组图那一发的提示词（2026-10-05 付费对比里用的写法 + 两处补丁）：一个请求按顺序一张一个镜头。
 * ★ 两处补丁都来自那次对比：「每个人在一张画面里只出现一次」（第 6 张多画了一个林夏）；「画面里有谁」逐格写明（空镜就真的没有人）。
 * ★ 「单独完整的画面，不要分格、拼贴…」照留：真九宫格那一路模型会排成漫画式的分格，组图要的是一格一张完整的画面。
 * @param bind groupBindLine 的结果（没有参考图时为空串）
 * @param framing 画幅那一句（types.VIDEO_ASPECTS[].promptHint）
 */
/* i18n-frozen: 组图的出图提示词，进出图模型，冻结中文 */
export const groupPrompt = (o: { lead: string; shots: readonly GridShot[]; bind: string; framing: string }): string => {
  const list = o.shots
    .map((s, i) => `${i + 1}. ${s.size ? `${s.size}：` : ""}${s.picture.replace(TAIL_PUNCT, "")}（${whoLine(s.who)}）`)
    .join("；");
  const head = o.bind ? `根据参考图（${o.bind}），` : "";
  const lead = o.lead.trim().replace(TAIL_PUNCT, "");
  return (
    `${head}生成 ${o.shots.length} 张连续的电影分镜画面，按下面的顺序一张一个镜头：${list}。` +
    `每张都是一张单独完整的画面（不要分格、拼贴、边框、文字、对话框、字幕）；每个人在一张画面里只出现一次；` +
    `人物的长相、发型与服装在每张里都与参考图一致；${lead ? `${lead}，` : ""}同一个场景与光线贯穿始终。` +
    `高细节，电影感构图，氛围光。${o.framing}。`
  );
};

/**
 * 单格重画画哪个瞬间（交给 ai/real.generateFrame 的 req；外壳「视频中的一个画面…单一完整画面」由它加）。
 * @param ask 人补的一句要求（「沈舟只出现一次」）；空 = 照分镜重画
 */
/* i18n-frozen: 单格重画的出图句，进出图模型，冻结中文 */
export const panelMoment = (shot: GridShot, lead: string, ask = ""): string => {
  const l = lead.trim().replace(TAIL_PUNCT, "");
  const who = shot.who.length ? `画面里只有${shot.who.join("、")}，每个人只出现一次` : "画面里没有人";
  const extra = ask.trim() ? `。要求：${ask.trim()}` : "";
  return `${l ? `${l}。` : ""}${shot.size ? `${shot.size}，` : ""}${shot.picture.replace(TAIL_PUNCT, "")}（${who}）${extra}`;
};

/** 单格重画接在画面后面的那一句（参考图点名，与组图同一套写法）；没有参考图时为空 */
/* i18n-frozen: 单格重画的参考图点名句，进出图模型，冻结中文 */
export const panelRefLine = (bind: string): string => (bind ? `。参考图：${bind}；人物的长相、发型与服装与参考图一致` : "");

/**
 * 一格变成一段时的视频提示词（存进方案的 plot）：整体交代 + 景别 + 画面（开头那一刻）+ 动作（接下来发生的事）。
 * ★ 一段话、不写「镜头N：」：一格就是一个镜头，写成分镜表的格式会被当成多镜头（shotScript.isMultiShot）。
 */
export function panelPlot(shot: GridShot, lead: string, lang: GridLang): string {
  const parts = [gridLeadOf(lead, lang), endWith(shot.size, lang), endWith(shot.picture, lang), endWith(shot.action, lang)].filter(Boolean);
  return parts.join(lang === "en" ? " " : "");
}

/** 这一格的画面认的是哪一版分镜（画好之后分镜又改了 → 这一格的画面过期，界面提醒重画）。动作改了不算：画面不画动作 */
export function shotKey(shot: GridShot): string {
  return JSON.stringify([shot.size, shot.picture, [...shot.who]]);
}

/**
 * 这几格里点到名（who）、却不在选上的人物里的人（按出现先后、去重）。出一组 / 单格重画 / 落段之前都问它，有就拦下
 * （人话在 studio/gridDraftStore.gridCastIssue）。
 * ★ 2026-10-06 付费验证撞到：App 重开后接着等一组，向导里选的人没还原 —— 单格重画一张卡图都没带、画出两个陌生人（那一张的钱白花），
 *   落段时「只挂这一格里的人」挂空。名字写在分镜里、卡图一张都带不上，全程零报错；回第 1 步取下一个人之后再画也是同一个样子。
 */
export function castGaps(shots: readonly GridShot[], cast: readonly string[]): string[] {
  const have = new Set(cast);
  const out: string[] = [];
  for (const s of shots) for (const n of s.who) if (!have.has(n) && !out.includes(n)) out.push(n);
  return out;
}
