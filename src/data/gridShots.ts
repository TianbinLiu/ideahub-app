// 「一场戏 → 九宫格分镜」—— 跟着做 C（九宫格分镜）的输入与输出规则，唯一实现（2026-10-05 第三期，方案 docs/guided-modes-design.md §二 C、§七）：
//   ① 第②步那一发对话（一场戏 → 4~9 个镜头的分镜清单）怎么问、回话怎么收；
//   ② 第③步怎么画：哪几格进组图、哪几格单画（gridDrawPlan），组图与单画的提示词、参考图怎么点名，画完怎么看图核对；
//   ③ 一格变成一段时视频提示词怎么写。
// ★ ② 的写法 2026-10-07 换过一次（主人「改」，付费验证在 docs/seedream-grid-fix-research.md 第七节）：组图压短 + 参考图标用途、
//   空镜与特写拆出来单画、单画正面写画幅、画完核对人数 / 两个一样的人 / 分格。
//
// 纯函数、零运行时依赖（只许 import type）：构建里 scripts/check-grid-shots.mjs 直接 import 它跑正反例。
// ★ 调模型、扣钱、说人话在 studio/structuredSkills（runSceneToGrid）与 studio/gridDraftStore；出图在 ai/real：组图走 drawShotGroup，
//   组图之后单画的那几格与单格重画都走 drawGridPanel（提示词 panelPrompt，入口 gridDraftStore.drawPanelAt）—— **不走 generateFrame 的外壳**。
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
  | { kind: "strangers"; names: string[] }
  /**
   * 画面描述里点到了名字、who 里却没有的出场人物：补进 who（names 是补进去的人）。
   * ★ 2026-10-07 付费验证：「沈舟站在车厢门口…目光落在林夏身上」、who 只有沈舟 —— 四遍里四遍都把林夏画了进去；
   *   不补的话她一张卡图都带不上（单格重画、落段都按 who 带图），画出来是个陌生人。补了至少人是对的。
   *   只补本来就有人的格子（空镜里的名字多半是「林夏的房间」这种所有格，见 parseGridShots）。
   */
  | { kind: "named"; names: string[] };
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
  `画面里没有人的镜头 who 给空数组；画面只写这一格里看得见的人，不在 who 里的人名字不要出现在画面里（看向画外的人就写望向画外）；` +
  `景别是特写的那一格，画面写清拍的是哪个局部（例：林夏的手指捏着旧信纸），不写整个人在做什么；` +
  `景别要有变化，别每格都是同一个景别；不写台词、不写秒数、不写「镜头1」之类的编号；画面与动作里不要出现引号。` +
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
  const named: string[] = [];
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
    // 画面里点到名、who 里没有的出场人物补进 who（见 GridNote 的 named）：模型照着画面描述画人，who 只决定带谁的图。
    // ★ 只补本来就有人的格子：who 给了空数组的是模型明说的空镜，画面里的名字多半是「林夏的房间」这种所有格 —— 补进去反倒把人画进空镜。
    //   那种由向导在那一格下面提醒一句（namedOutside），让人自己定。
    const shot: GridShot = { size: word(o.size, SIZE_MAX), picture, action: clean(o.action, ACTION_MAX), who };
    if (who.length)
      for (const n of namedOutside(shot, [...names])) {
        who.push(n);
        if (!named.includes(n)) named.push(n);
      }
    shots.push(shot);
  }
  if (!shots.length) throw new GridShotsError("noShots");
  const notes: GridNote[] = [];
  if (shots.length > max) notes.push({ kind: "dropped", count: shots.length - max });
  if (empty) notes.push({ kind: "empty", count: empty });
  if (strangers.length) notes.push({ kind: "strangers", names: strangers });
  if (named.length) notes.push({ kind: "named", names: named });
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
  /** 每张图是这张卡的哪一类图（与 nums 逐个对齐；types.CardView.kind：face / body / detail）。不知道就空串 */
  kinds: string[];
  /** 出片句（types.idLineOf；没写就是卡名，那时不重复） */
  idLine: string;
}

/**
 * 点名参考图的那一句（「图1、图2 是林夏（…）；图3 是场景「灯塔」…」）—— **对话正反打与特效同款**在用（ai/real.shotGroupRefs 的 bind）。
 * ★ 九宫格自己 2026-10-07 起改用 labeledBindLine（标用途、不写外貌）；这两个向导各自付费验过，没跟着换。
 */
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

/* i18n-frozen: 参考图「这张管什么」的说法，进出图模型，冻结中文 */
const KIND_ROLE: Record<string, string> = { face: "的脸", body: "的服装和身形", detail: "的细节" };

/**
 * 九宫格用的点名那一句：**逐张标用途**、不写外貌文字（「图1是林夏的脸，图2是林夏的服装和身形，图3是沈舟」）。
 * ★ 2026-10-07 付费验证（docs/seedream-grid-fix-research.md 第七节）：照官方 Seedance 指南的写法给图标用途（面部参考图 1、妆造参考图 2），
 *   外貌交给图 —— 组图里同一个人画两次的没再出现；单格重画 6/6 干净（原写法 3 张里 1 张沈舟画了两次）。
 * ★ 一张卡带了两张同一类的图（两张全身）就标不出谁管什么，退回「图1、图2是林夏」。
 */
/* i18n-frozen: 九宫格点名参考图的那一句，进出图模型，冻结中文 */
export const labeledBindLine = (refs: readonly GroupRef[]): string =>
  refs
    .map((r) => {
      const nums = r.nums.map((n) => `图${n}`).join("、");
      if (r.type === "character") {
        if (r.nums.length === 1) return `图${r.nums[0]}是${r.name}`;
        const roles = r.nums.map((_, i) => KIND_ROLE[r.kinds[i] ?? ""]);
        const distinct = roles.every(Boolean) && new Set(roles).size === roles.length;
        return distinct ? r.nums.map((n, i) => `图${n}是${r.name}${roles[i]}`).join("，") : `${nums}是${r.name}`;
      }
      if (r.type === "scene") return `${nums}是场景「${r.name}」（只用来定地点的样子，构图照分镜来）`;
      return `${nums}是「${r.name}」`;
    })
    .join("，");

/**
 * 画幅那一句，正面写（「竖版9:16」）。★ 不再接 types.VIDEO_ASPECTS 那句「主体居中偏上，上下留出呼吸空间」：
 *   10-06 单格重画画成上下两格拼图那一次，猜是这句给了往下面再塞一格的空（官方：给视频用的帧写「视频静帧画面」）。
 * @param ratio types.VIDEO_ASPECTS[].ratio
 */
/* i18n-frozen: 九宫格画幅那一句，进出图模型，冻结中文 */
export const gridFraming = (ratio: string): string => (ratio === "16:9" ? "横版16:9" : ratio === "9:16" ? "竖版9:16" : ratio);

/** 景别是不是特写（中文「特写 / 大特写」，英文 close-up / CU / ECU） */
const CLOSE_SIZE = /特写|close[\s-]?up|\bE?CU\b/i;
export const isCloseUp = (size: string): boolean => CLOSE_SIZE.test(size);

/**
 * 一格怎么画：普通格进组图；**空镜**（画面里没有人）与**特写**不进组图，组图画完之后单画（panelPrompt）。
 * ★ 2026-10-07 付费验证：组图的参考图对整组生效（没有「这张图只给第几格」的参数），空镜那一格手里照样拿着两个人的照片 —— 10-06 画进了两个人；
 *   单画、拿组图里的一格定画风、不带人物图之后 4/4 没有主角入镜。特写在组图里画成了两人中景，单画、只带这一格的人之后都只剩那个人
 *   （但还是半身 —— 写分镜时得写明拍的是哪个局部，见 GRID_SHOTS_SYS）。官方示例代码同样把组图拆成单图。
 */
export type PanelKind = "group" | "empty" | "close" | "single";
export function panelKindOf(shot: GridShot): Exclude<PanelKind, "single"> {
  if (!shot.who.length) return "empty";
  return isCloseUp(shot.size) ? "close" : "group";
}

/**
 * 一组画面的画法：哪几格进组图（下标，按原顺序），哪几格之后单画。
 * ★ 进组图的不到两格就不开组图了：一张图走组图只是多等几分钟，那一格改成单画（kind = single，写法同单格重画）。
 */
export function gridDrawPlan(shots: readonly GridShot[]): { group: number[]; singles: { index: number; kind: Exclude<PanelKind, "group"> }[] } {
  const kinds = shots.map(panelKindOf);
  const group = kinds.flatMap((k, i) => (k === "group" ? [i] : []));
  const asGroup = group.length >= 2;
  const singles: { index: number; kind: Exclude<PanelKind, "group"> }[] = [];
  kinds.forEach((k, i) => {
    if (k !== "group") singles.push({ index: i, kind: k });
    else if (!asGroup) singles.push({ index: i, kind: "single" });
  });
  // 空镜排在最后单画：它要拿别的格子定画风（styleRefIndex），没开组图时得先把别的格子画出来
  singles.sort((a, b) => Number(a.kind === "empty") - Number(b.kind === "empty") || a.index - b.index);
  return { group: asGroup ? group : [], singles };
}

/* i18n-frozen: 景别的写法（认分镜里的景别字段），冻结中文 */
const SIZE_RANK: Record<string, number> = { 远景: 0, 全景: 1, 中景: 2, 近景: 3, 特写: 4, 大特写: 5 };

/**
 * 空镜单画时拿哪一格当「地点 / 光线 / 画风」参考：已经画好的格子里景别最宽的（一样宽挑人少的）；一格都没画好就回 -1（那就不带）。
 * ★ 2026-10-07 付费验证：拿组图第 1 格（远景、只有林夏）定画风，空镜 4/4 没画进主角、画风光线接得上；不带的话画风会跑
 *   （人物卡是二次元的，空镜手里一张图都没有）。
 * @param drawn 每一格画好了没有（与 shots 对齐）；exclude = 要画的那一格自己
 */
export function styleRefIndex(shots: readonly GridShot[], drawn: readonly boolean[], exclude: number): number {
  const rank = (k: number) => (SIZE_RANK[shots[k]?.size ?? ""] ?? 2) * 10 + Math.min(9, shots[k]?.who.length ?? 0);
  let best = -1;
  shots.forEach((_, k) => {
    if (k === exclude || !drawn[k]) return;
    if (best < 0 || rank(k) < rank(best)) best = k;
  });
  return best;
}

/** 组图里一格的「有谁」：画面描述已经点到全部在场的人、且不止一个时不再重复（省字数）；只有一个人的格子照写「只有某某」——描述里常带着画外的人 */
/* i18n-frozen: 组图里一格有谁，进出图模型，冻结中文 */
const groupWho = (s: GridShot): string =>
  !s.who.length ? "（画面里没有人）" : s.who.length === 1 ? `（只有${s.who[0]}）` : s.who.every((n) => s.picture.includes(n)) ? "" : `（${s.who.join("、")}）`;

/**
 * 组图那一发的提示词（2026-10-07 付费验证里的新写法）：一个请求按顺序一张一个镜头。
 * ★ 压到 300 字上下（官方：中文提示词不超过 300 字，多了模型会丢细节 —— 10-06 那份 8 格 575 字，空镜与特写正是被丢掉的细节）：
 *   全局规矩只说一次、不写外貌（交给参考图）、画幅正面写；空镜与特写不在这一发里（gridDrawPlan）。
 * ★ 「每人在一张里只出现一次，不出现两个长相、着装一样的人」照留（10-05 付费对比第 6 张多画了一个林夏；后半句是官方 Seedance 指南里防双胞胎的写法）。
 * @param bind labeledBindLine 的结果（没有参考图时为空串）
 * @param framing gridFraming(画幅)
 */
/* i18n-frozen: 组图的出图提示词，进出图模型，冻结中文 */
export const groupPrompt = (o: { lead: string; shots: readonly GridShot[]; bind: string; framing: string }): string => {
  const list = o.shots.map((s, i) => `${i + 1}.${s.size ? `${s.size}，` : ""}${s.picture.replace(TAIL_PUNCT, "")}${groupWho(s)}`).join("；");
  const lead = o.lead.trim().replace(TAIL_PUNCT, "");
  return (
    `${o.bind ? `${o.bind}。` : ""}按顺序生成${o.shots.length}张视频静帧，一张一个镜头：${list}。` +
    `${lead ? `${lead}。` : ""}每张${o.framing}、单个完整画面；每人在一张里只出现一次，不出现两个长相、着装一样的人；无文字。`
  );
};

/**
 * 单画一格的提示词：组图之后单画的空镜 / 特写 / 落单的那一格，与**单格重画**是同一个函数（2026-10-07 付费验证里的新写法）。
 * 直接交给出图模型（ai/real.drawGridPanel），**不走 generateFrame 的外壳**：那层带「上下留出呼吸空间」与「不要分格、拼贴」的否定句。
 * ★ 空镜：图1 是这一组里另一格的画面，只拿来定地点、光线、色调和画风（styleRef）；一张人物图都不带。
 * ★ 普通格：写清画面上下各是什么、整张是同一个连续的场景（正面写，替掉「不要分格」）。
 * @param bind labeledBindLine 的结果（编号已经让出 styleRef 占的图1）
 * @param ask 人补的一句要求（「沈舟只出现一次」）；空 = 照分镜画
 */
/* i18n-frozen: 九宫格单画一格的出图提示词，进出图模型，冻结中文 */
export const panelPrompt = (o: { shot: GridShot; lead: string; ask: string; bind: string; framing: string; styleRef: boolean }): string => {
  const s = o.shot;
  const size = s.size ? `${s.size}，` : "";
  const pic = s.picture.replace(TAIL_PUNCT, "");
  const lead = o.lead.trim().replace(TAIL_PUNCT, "");
  const leadLine = lead ? `${lead}。` : "";
  const ask = o.ask.trim() ? `要求：${o.ask.trim().replace(TAIL_PUNCT, "")}。` : "";
  const style = o.styleRef ? "图1只用来参考地点、光线、色调和画风，不要画出图1里的人。" : "";
  const bind = o.bind ? `${o.bind}。` : "";
  const kind = panelKindOf(s);
  if (kind === "empty")
    return `${style}${bind}一张${o.framing}的视频静帧，单个完整画面：${size}${pic}。${leadLine}画面里没有任何人（没有人物、人影或剪影）；${ask}无文字。`;
  if (kind === "close")
    return `${style}${bind}一张${o.framing}的视频静帧，单个完整画面：特写镜头，只拍局部，主体占满画面：${pic}（只有${s.who.join("、")}）。${leadLine}${ask}无文字。`;
  return (
    `${style}${bind}一张${o.framing}的视频静帧，整张是同一个连续的场景：${size}${pic}（画面里只有${s.who.join("、")}）。${leadLine}` +
    `画面上方是场景的背景，下方是地面。${ask}每人只出现一次，不出现两个长相、着装一样的人；电影感光影，无文字。`
  );
};

/** 单格重画接在画面后面的那一句（参考图点名）；没有参考图时为空。★ 九宫格 2026-10-07 起不再用它（panelPrompt），特效同款还在用 */
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

/**
 * 画面描述里点到了名字、「画面里有」却没有的出场人物（按名单的先后）。收模型回话时补进 who（parseGridShots，GridNote 的 named），
 * 人自己改分镜时由向导在那一格下面提醒一句。★ 认名字就是在句子里找卡名：「林夏」写进了画面，模型就会画她（10-07 付费验证四遍里四遍）。
 */
export function namedOutside(shot: GridShot, cast: readonly string[]): string[] {
  return cast.filter((n) => n && !shot.who.includes(n) && shot.picture.includes(n));
}

// ── 画完让对话模型看一遍（2026-10-07 付费验证里的办法 D）─────────────────────────────

/**
 * 看图核对的系统提示词：只问三件事 —— 分成了几格、一共几个人、有没有两个一样的人。
 * ★ 不给它看分镜要求（先入为主会跟着要求答）；判对错在代码里按分镜算（panelIssues）。
 * ★ JSON 的样子要写成能直接 parse 的（数字、true/false）：付费验证那一次把「景别」写成没加引号的中文，51 次里 7 次读不出来。
 * ★ 景别、有没有字**不问**：那次景别误报 6 次、一次都没多抓到；「有字」会把站名牌、信纸上的字都算进去。
 */
/* i18n-frozen: 看图核对的系统提示词，进对话模型，冻结中文 */
export const PANEL_CHECK_SYS =
  '你是视频分镜画面的质检员。只按这一张图里实际看到的回答，不要猜。只输出一个 JSON 对象，不要别的字，格式：{"panels": 1, "people": 0, "duplicate": false}。' +
  "panels = 画面被边框或明显的分界线分成了几格（单个完整画面就是 1）；" +
  "people = 画面里一共能看到几个人（背影、侧影、远处很小的人、窗户里的人影都算，只露出手或身体局部的也算 1 个，没有人就是 0）；" +
  "duplicate = 有没有两个长相、发型、衣着几乎一样的人同时出现（true 或 false）。";
/* i18n-frozen: 看图核对时给对话模型的那一句，冻结中文 */
export const PANEL_CHECK_ASK = "看这张图。";

export interface PanelCheck {
  panels: number;
  people: number;
  duplicate: boolean;
}

/** 核对的回话 → 三个数。按键名逐个抠（不整段 JSON.parse：模型偶尔给值加引号、偶尔不加）；panels 与 people 抠不出来就当没核对上 */
export function parsePanelCheck(raw: string): PanelCheck | null {
  const text = String(raw ?? "");
  const num = (k: string): number | null => {
    const m = text.match(new RegExp(`"${k}"\\s*:\\s*"?(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const panels = num("panels");
  const people = num("people");
  if (panels === null || people === null) return null;
  const dup = text.match(/"duplicate"\s*:\s*"?(true|false)/i);
  return { panels, people, duplicate: !!dup && dup[1].toLowerCase() === "true" };
}

export type PanelIssue = { kind: "panels"; got: number } | { kind: "people"; got: number; want: number } | { kind: "duplicate" };

/**
 * 按这一格的分镜判：分成了几格、人数对不对、有没有两个一样的人。空 = 没看出问题。
 * ★ 付费验证里不合格的 13 张全落在这三项上（空镜里有人、多画了一个、同一个人两次、拼图、伞下叠了一张半透明的脸），全抓到；
 *   合格的里这三项一次都没误报。车窗里的小人影也会被数进去 —— 标出来由人看一眼，不自动重画。
 */
export function panelIssues(c: PanelCheck, shot: GridShot): PanelIssue[] {
  const out: PanelIssue[] = [];
  if (c.panels > 1) out.push({ kind: "panels", got: c.panels });
  if (c.people !== shot.who.length) out.push({ kind: "people", got: c.people, want: shot.who.length });
  if (c.duplicate) out.push({ kind: "duplicate" });
  return out;
}
