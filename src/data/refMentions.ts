// 参考清单的「@ 点名」与「临时参考图」—— 规则的**唯一实现**（N1，2026-10-03 对标 LibTV 节点里的内联引用，
// 方案与取舍见 docs/node-modes-libtv-alignment.md §六）。
//
// 住在 data 层（公开配方的投影 data/recipe 也要读它，依赖方向 data → store → 组件）。
// 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-ref-mentions.mjs 直接 import 它跑正反例 ——
// 改一条规则就去那儿补一句正例、一句反例。
//
// ★★ 三种东西能被点名，出片时换成的东西**不一样**，理由各不相同：
//   · 临时参考图（不是卡的一次性图：站位草图、道具照片…）→ 「名字（图片N）」。N 是这一发的真实发送编号
//     （segmentGen 现算，别在界面上自己数）。**名字留着**：人写的是「递来@杯子」，光换成「递来图片5」读不通，
//     「递来杯子（图片5）」两种写法（「参考@草图 的站位」/「递来@杯子」）都通。
//   · 首帧 / 尾帧 → 同样接上「（图片N）」（帧当参考图发的那两档）；走首尾帧协议参数的档上没有编号，只留叫法本身。
//   · 素材卡 → 只留**卡名**，不接编号。卡的身份绑定仍由 ai/real 的紧凑式点名句管（「凛=@图片4@图片5」，
//     一张卡常带两三张图、谁被预算挤掉也只有那一处知道）；正文里靠名字指人是付费 A/B 验过的现行做法。
//     在这里把卡也内联成编号 = 同一条绑定规则的第二处实现，错一位就是「张三的脸给了李四」。
// ★ 没被点名的临时参考图由系统按**用途**补一句（extraRefLines）；点过名的不再重复（省提示词额度，
//   也免得系统那句与用户自己写的那半句打架）。
// ★ 认不出的 `@xxx`：只摘掉 `@` 本身、名字当普通文字留下 —— 留着它，模型会把后面当成一个不存在的引用
//   （紧凑式点名句用的正是 `@图片N`）。模型自己的写法（@图片3 / @视频1 / @音频2）原样不动。
// ★ 紧跟在字母数字后面的 `@`（邮箱、账号名那种）不是点名，原样留着。

/** 临时参考图的用途：决定没点名时系统替它说哪句话 */
export type ExtraRefRole = "layout" | "scene" | "prop" | "outfit" | "style" | "free";

/**
 * 一张临时参考图（只在这一段生效，不是卡）。
 * ★ `url` 与帧同形：本机是 dataURL，出片那一拍才转存成公网地址（segmentGen）；回炉工程里它会被瘦身成空串 ——
 *   读的地方一律先过 usableExtraRefs（空地址的当没有）。
 */
export interface ExtraRef {
  id: string;
  url: string;
  /** 人在句子里叫它的名字（不带 @），同一段内不重名、也不与卡名 / 帧的叫法重名 */
  name: string;
  role: ExtraRefRole;
}

/** 一段最多几张。★ 它们与帧、卡片形象图抢同一份参考图预算（高清档一共 9 张）：再多就是拿卡的图位换 */
export const EXTRA_REF_MAX = 3;
/** 名字最长几个字符（进提示词的，占 VIDEO_PROMPT_MAX 的额度：三张全不点名、名字都写满时兜底句约 103 字，量法在 check-ref-mentions） */
export const EXTRA_REF_NAME_MAX = 8;
export const EXTRA_REF_ROLES: readonly ExtraRefRole[] = ["layout", "scene", "prop", "outfit", "style", "free"];

/** 帧在句子里的叫法（中英两套都认，插哪一套由界面定；每组第一个是中文界面插的、最后一个是英文界面插的） */
/* i18n-frozen: 点名语法里帧的叫法，是被解析的输入，不是界面文案 */
export const FRAME_ALIASES: Record<"first" | "last", readonly string[]> = {
  first: ["首帧", "第一帧", "first frame"],
  last: ["尾帧", "最后一帧", "last frame"],
};

/** 这张图还在不在（回炉工程瘦身后地址会变成空串；老数据可能缺字段） */
export function usableExtraRefs(list: readonly ExtraRef[] | undefined | null): ExtraRef[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is ExtraRef => !!x && typeof x.url === "string" && !!x.url && typeof x.name === "string" && !!x.name).slice(0, EXTRA_REF_MAX);
}

// ── 名字 ────────────────────────────────────────────────

/** 名字里不许有的字符：`@`、空白、会被读成句读的标点（名字要能在句子里被无歧义地认回来） */
const NAME_STRIP = /[@＠\s，。；、：,.;:!?！？()（）「」『』“”"'<>《》【】[\]]/g;

/** 把人敲的名字收拾成能点名的形状 */
export function cleanRefName(raw: string): string {
  return (raw || "").replace(NAME_STRIP, "").slice(0, EXTRA_REF_NAME_MAX);
}

/** 模型自己的引用写法：名字长成这样就会与真编号混在一起 */
const MODEL_TOKEN = /^(?:图片|视频|音频)\d*$/;

/**
 * 这个名字能不能用 —— null = 能；否则是哪一种不能（话由界面说）。
 * @param taken 这一段里已经被占的名字（别的临时参考图、卡名）
 */
export function refNameIssue(name: string, taken: readonly string[]): "empty" | "reserved" | "taken" | null {
  const n = cleanRefName(name);
  if (!n) return "empty";
  const low = n.toLowerCase();
  if (MODEL_TOKEN.test(n)) return "reserved";
  if ([...FRAME_ALIASES.first, ...FRAME_ALIASES.last].some((a) => a.replace(/\s/g, "").toLowerCase() === low)) return "reserved";
  if (taken.some((x) => x.toLowerCase() === low)) return "taken";
  return null;
}

/** 在 base 后面接数字直到不重名（base 本身能用就用它） */
export function uniqueRefName(base: string, taken: readonly string[]): string {
  let b = cleanRefName(base) || "ref";
  // 基名本身是保留字（「图片」接上数字正是模型的写法）就换一个：否则接多少数字都还是保留的
  if (refNameIssue(b, []) === "reserved" || MODEL_TOKEN.test(`${b}1`)) b = "ref";
  if (!refNameIssue(b, taken)) return b;
  for (let i = 2; i < 100; i++) {
    const cand = `${b.slice(0, EXTRA_REF_NAME_MAX - String(i).length)}${i}`;
    if (!refNameIssue(cand, taken)) return cand;
  }
  return b;
}

// ── 点名：解析与编译 ──────────────────────────────────────

/** 一个能被点名的东西 */
export interface MentionTarget {
  /** 记账用的键：`card:<id>` / `extra:<id>` / `frame:first` / `frame:last` */
  key: string;
  /** 人在句子里写的名字（不带 @）；一个目标可以有几个叫法 */
  names: readonly string[];
  /** 出片时接在名字后面的那一截（`（图片3）`；没有编号可接 = 空串）。名字本身照人写的原样留下 */
  suffix: string;
}

export interface CompiledMentions {
  text: string;
  /** 被点到名的目标（MentionTarget.key） */
  used: Set<string>;
  /** 写了 `@` 却没对上任何目标的那几个词（界面拿去提醒；发出去时它们只是普通文字） */
  loose: string[];
}

const WORD = /[A-Za-z0-9_]/;
/** `@` 后面像名字的那一截（认不出时拿它当「人想点的名」） */
const LOOSE = /^[^\s@＠，。；、：,.;:!?！？()（）「」『』“”"'<>《》【】[\]]{1,16}/;
const MODEL_REF = /^(?:图片|视频|音频)\d/;

/** 名字以字母数字收尾时，后面不许紧跟字母数字（`@Ref1` 不该吃掉 `@Ref12` 的前半截） */
function boundaryOk(name: string, next: string | undefined): boolean {
  if (!next) return true;
  return !(WORD.test(name[name.length - 1] ?? "") && WORD.test(next));
}

interface Cand {
  lower: string;
  len: number;
  target: MentionTarget;
}

function candsOf(targets: readonly MentionTarget[]): Cand[] {
  const out: Cand[] = [];
  for (const target of targets) for (const n of target.names) if (n) out.push({ lower: n.toLowerCase(), len: n.length, target });
  // 最长的先试：「凛的师父」不该被「凛」截胡
  return out.sort((a, b) => b.len - a.len);
}

function hitAt(rest: string, cands: readonly Cand[]): Cand | undefined {
  const low = rest.toLowerCase();
  return cands.find((c) => low.startsWith(c.lower) && boundaryOk(rest.slice(0, c.len), rest[c.len]));
}

/**
 * 把句子里的 `@名字` 换成出片用的写法。
 * ★ 没有任何 `@` 的句子**逐字节原样返回** —— 不用这个功能的人，发出去的提示词一个字都不变。
 */
export function compileMentions(text: string, targets: readonly MentionTarget[]): CompiledMentions {
  const used = new Set<string>();
  const loose: string[] = [];
  if (!text || !/[@＠]/.test(text)) return { text: text || "", used, loose };
  const cands = candsOf(targets);
  let out = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    // 紧跟在字母数字后面的 @ 不是点名（a@b.com）
    if ((ch !== "@" && ch !== "＠") || WORD.test(text[i - 1] ?? "")) {
      out += ch;
      i++;
      continue;
    }
    const rest = text.slice(i + 1);
    const hit = hitAt(rest, cands);
    if (hit) {
      // 名字照人写的原样留下（大小写、用的哪个叫法都不动），后面接编号
      out += rest.slice(0, hit.len) + hit.target.suffix;
      used.add(hit.target.key);
      i += 1 + hit.len;
      continue;
    }
    // 模型自己的引用写法原样留着
    if (MODEL_REF.test(rest)) {
      out += "@";
      i++;
      continue;
    }
    const m = LOOSE.exec(rest);
    if (m) {
      loose.push(m[0]);
      i++; // 只摘掉 @，名字当普通文字留下
      continue;
    }
    // 后面不像名字（空白 / 标点 / 句尾）：这个 @ 不是点名，原样留着
    out += ch;
    i++;
  }
  return { text: out, used, loose };
}

/** 句子里点到了谁（不改字）—— 界面标「已点名」用，与 compileMentions 同一套认法 */
export function mentionedKeys(text: string, targets: readonly MentionTarget[]): Set<string> {
  return compileMentions(text, targets).used;
}

/** 把所有 `@from` 换成 `repl`（改名 / 删除时收拾句子；认法与编译同一套边界规则） */
function replaceMention(text: string, from: string, repl: string): string {
  if (!text || !from || !/[@＠]/.test(text)) return text;
  const low = from.toLowerCase();
  let out = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (
      (ch === "@" || ch === "＠") &&
      !WORD.test(text[i - 1] ?? "") &&
      text.slice(i + 1, i + 1 + from.length).toLowerCase() === low &&
      boundaryOk(from, text[i + 1 + from.length])
    ) {
      out += repl;
      i += 1 + from.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 改名：句子里的 `@旧名` 跟着换成 `@新名` */
export function renameMention(text: string, from: string, to: string): string {
  return replaceMention(text, from, `@${to}`);
}

/** 这张图不在了：句子里的 `@名字` 退成普通文字（留着 @ 的话它会被当成没对上的点名） */
export function dropMention(text: string, name: string): string {
  return replaceMention(text, name, name);
}

/**
 * 往句子的光标处插一个点名。
 * ★ 名字以字母数字收尾、后面又紧跟字母数字时补一个空格 —— 不补的话「@Ref1abc」认不回「Ref1」。
 */
export function insertMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const src = text || "";
  const at = Math.max(0, Math.min(Number.isFinite(caret) ? caret : src.length, src.length));
  const next = src[at] ?? "";
  const pad = WORD.test(name[name.length - 1] ?? "") && WORD.test(next) ? " " : "";
  // 前面紧挨着字母数字时也要隔开：否则这个 @ 会被当成邮箱里的那种（见 compileMentions）
  const lead = WORD.test(src[at - 1] ?? "") ? " " : "";
  const token = `${lead}@${name}${pad}`;
  return { text: src.slice(0, at) + token + src.slice(at), caret: at + token.length };
}

// ── 没点名的临时参考图：系统按用途补一句 ─────────────────────

/**
 * 用途 → 接在「图片N「名字」」后面的那半句。
 * ★ 每句都写了「只取什么」：不写的话模型会把整张图当成要复现的画面（站位草图里的火柴人被原样画进片子）。
 * ★ 字数是从提示词硬顶里扣的（三张全不点名约 90 字），再想加词先量。
 */
/* i18n-frozen: 临时参考图的用途句，发给视频 / 出图模型 */
export const EXTRA_ROLE_LINE: Record<ExtraRefRole, string> = {
  layout: "只取人物站位与构图，不照搬长相画风",
  scene: "是场景参考，保持其空间结构与光线",
  prop: "是道具参考，保持其外形与材质",
  outfit: "是服装参考，只取款式与配色",
  style: "是画风参考，只取色调与质感，不照搬内容",
  free: "是补充参考",
};

/**
 * 没被点名的那几张，系统替它们说一句（接在提示词尾巴上）。
 * @param tok 编号怎么写：视频提示词是「图片N」（与帧的时序点名句同一写法），画帧那边是「<图片N>」
 */
/* i18n-frozen: 临时参考图的系统兜底句，发给视频 / 出图模型 */
export const extraRefLines = (
  items: readonly { name: string; role: ExtraRefRole; n: number }[],
  tok: (n: number) => string = (n) => `图片${n}`,
): string => {
  if (!items.length) return "";
  return `。另附参考图：${items.map((x) => `${tok(x.n)}「${x.name}」${EXTRA_ROLE_LINE[x.role] ?? EXTRA_ROLE_LINE.free}`).join("；")}`;
};

/**
 * 这一发的点名目标表 —— 出片（segmentGen）与界面（参考清单标「已点名」）共用的**唯一拼法**。
 * @param frames 帧的编号；null = 这一发里帧不是参考图（走首尾帧协议参数 / 根本没有帧）
 * @param extras 临时参考图的编号；n 为 null = 这一发没把它发出去（档位不收），点名退成它的名字
 */
/* i18n-frozen: 点名编译后接在名字后面的编号写法（图片N），发给视频模型 */
export const mentionTargets = (o: {
  cards: readonly { id: string; name: string }[];
  extras: readonly { id: string; name: string; n: number | null }[];
  frames: { first?: number | null; last?: number | null };
}): MentionTarget[] => {
  const num = (n: number | null | undefined) => (n ? `（图片${n}）` : "");
  const out: MentionTarget[] = [];
  for (const x of o.extras) out.push({ key: `extra:${x.id}`, names: [x.name], suffix: num(x.n) });
  if (o.frames.first !== undefined) out.push({ key: "frame:first", names: FRAME_ALIASES.first, suffix: num(o.frames.first) });
  if (o.frames.last !== undefined) out.push({ key: "frame:last", names: FRAME_ALIASES.last, suffix: num(o.frames.last) });
  // 卡排在最后只影响同名时谁赢（名字查重已经挡住了同名，这里是兜底）：临时参考图与帧优先
  for (const c of o.cards) if (c.name) out.push({ key: `card:${c.id}`, names: [c.name], suffix: "" });
  return out;
};
