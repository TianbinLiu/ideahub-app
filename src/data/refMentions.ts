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
/**
 * 文字模板段的临时参考图上限（2026-10-26 主人授权我定：3 → 4，**只给文字模板段**，普通段仍是 EXTRA_REF_MAX）。
 * 文字模板正文里的「图位」就是同名的临时参考图（见下面的 templateSlotRefs）；主人的例子正好四个图位（女仆装 / 特写 / 披风两张），
 * 付费小验 T0（只挂四张临时参考图、不画帧不挂卡）四张都用在点名的位置。文字模板段有图位就不画帧、通常也不挂卡，
 * 所以多出来的这一张不是拿卡的图位换的。哪一段用哪个上限只问 extraRefMaxOf。
 */
export const TEXT_TPL_EXTRA_MAX = 4;

/**
 * 这一段**最多能带几张**临时参考图 —— 唯一判定（文字模板段 TEXT_TPL_EXTRA_MAX，其余 EXTRA_REF_MAX）。
 * 读它的：加图那一道闸（flowStore.addExtraRef）、出片与参考清单真发几张（segmentGen.segmentExtras）、
 * 参考清单那颗「＋ 参考图」灰不灰（segmentGen.refPlanOf 的 extraMax → RefStrip）。
 * ★ 别在调用点写 `textTpl ? 4 : 3`：两处各写一份，加图时放进去的第 4 张出片时被悄悄截掉（或反过来），零报错。
 * @param o.textTpl 这一段是文字模板段（FlowNode.textTpl 在不在 / SegmentGenInput.textTpl 非空）
 */
export function extraRefMaxOf(o: { textTpl: boolean }): number {
  return o.textTpl ? TEXT_TPL_EXTRA_MAX : EXTRA_REF_MAX;
}

/**
 * 文字模板段的**图位缺口**：模板的图位里，这一段（这一发）找不到同名临时参考图的那几个 —— 唯一判定（2026-10-26 审核抓到）。
 * 认法与 compileMentions 认 `@名字` 同一个：按名字、大小写不分（图位名与临时参考图的名字都过了 cleanRefName）。
 * ★ 为什么缺一个就要拦：图位的图没挂上，正文里的 `@名字` 编译时退成普通文字（只在 noteLoose 那里说一句「没对上」），
 *   这一发照样按纯文字（或少一张图）发出去、视频钱照扣 —— 拍出来的是一段与模板说好的不一样的片。
 * 读它的：出片那一拍的最后一道闸（segmentGen.generateSegment，花钱之前）；套用之后的「待补格」与出片前的门禁在下一步也该读它。
 * @param slots 模板的图位名（TextTplOrigin.slots 的 name）
 * @param extras 这一段真带得出去的临时参考图（segmentExtras：已过 usableExtraRefs、已按上限截过 —— 空地址的当没有）
 */
export function slotGaps(slots: readonly string[], extras: readonly { name: string }[]): string[] {
  const have = new Set(extras.map((x) => x.name.toLowerCase()));
  return slots.filter((n) => !have.has(n.toLowerCase()));
}

/** 任何一种段最多挂几张（usableExtraRefs 只按它截：它答的是「这些图还在不在」，这一段带几张另问 extraRefMaxOf） */
const EXTRA_REF_CEIL = Math.max(EXTRA_REF_MAX, TEXT_TPL_EXTRA_MAX);
/** 名字最长几个字符（进提示词的，占 VIDEO_PROMPT_MAX 的额度：三张全不点名、名字都写满时兜底句约 103 字，量法在 check-ref-mentions） */
export const EXTRA_REF_NAME_MAX = 8;
export const EXTRA_REF_ROLES: readonly ExtraRefRole[] = ["layout", "scene", "prop", "outfit", "style", "free"];

/** 帧在句子里的叫法（中英两套都认，插哪一套由界面定；每组第一个是中文界面插的、最后一个是英文界面插的） */
/* i18n-frozen: 点名语法里帧的叫法，是被解析的输入，不是界面文案 */
export const FRAME_ALIASES: Record<"first" | "last", readonly string[]> = {
  first: ["首帧", "第一帧", "first frame"],
  last: ["尾帧", "最后一帧", "last frame"],
};

/**
 * 这张图还在不在（回炉工程瘦身后地址会变成空串；老数据可能缺字段）。
 * ★ 只按「任何一种段最多挂几张」（EXTRA_REF_CEIL）截 —— 这一段**真带几张**问 extraRefMaxOf（出片那一侧 segmentGen.segmentExtras 一处截）。
 *   2026-10-26 前按 EXTRA_REF_MAX（3）截：文字模板段挂满 4 个图位时，第 4 张在这里就被悄悄丢掉、而正文里还点着它的名字。
 */
export function usableExtraRefs(list: readonly ExtraRef[] | undefined | null): ExtraRef[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is ExtraRef => !!x && typeof x.url === "string" && !!x.url && typeof x.name === "string" && !!x.name).slice(0, EXTRA_REF_CEIL);
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
 * ★ 「第几张图」的叫法也不许当名字（2026-10-26 文字模板，「保留名扩大」）：图 / 图1 / 图一 / 参考图 / 参考图2 / 效果图 / image / image2。
 *   编译出来是「图1（图片4）」—— 两个编号摆在一起，模型照哪一个都说不准；人写的「参考图1、2」与系统兜底句里的「图片3「参考图2」…」
 *   还会撞名又错位（原来临时参考图的默认名正是「参考图 / 参考图2」，所以默认名改成了不以「参考图」打头）。
 * ★ 判据只有一个：拿文字模板认图位的那一套（templateSlotRefs）认 —— 名字本身含着一处图位写法（「草图2」「图1背景」），
 *   或者**接上一个数字就成了图位**（「效果图」「草图」「image」：改写完是「@效果图 3只猫」，再认一遍「效果图 3」又是一个图位，
 *   改写就不幂等了 —— 2026-10-26 审核实跑抓到）。原来另有一份手写的「图 / 图N / 参考图N / imageN」正则，词表与认图位的那份各管各的，
 *   覆盖面对不上；现在什么算图位词只写在 SLOT_WORD 一处。「地图 / 截图」接上数字也认不出图位（左边界），所以照样能用。
 * @param taken 这一段里已经被占的名字（别的临时参考图、卡名）
 */
export function refNameIssue(name: string, taken: readonly string[]): "empty" | "reserved" | "taken" | null {
  const n = cleanRefName(name);
  if (!n) return "empty";
  const low = n.toLowerCase();
  if (MODEL_TOKEN.test(n) || templateSlotRefs(n).hits.length || templateSlotRefs(`${n}1`).hits.length) return "reserved";
  if ([...FRAME_ALIASES.first, ...FRAME_ALIASES.last].some((a) => a.replace(/\s/g, "").toLowerCase() === low)) return "reserved";
  if (taken.some((x) => x.toLowerCase() === low)) return "taken";
  return null;
}

/** 在 base 后面接数字直到不重名（base 本身能用就用它） */
export function uniqueRefName(base: string, taken: readonly string[]): string {
  let b = cleanRefName(base) || "ref";
  // 基名本身是保留字、或者接上数字就成了保留字（「图片2」是模型的写法、「参考图2」是图的编号）就换一个：否则接多少数字都还是保留的
  if (refNameIssue(b, []) === "reserved" || refNameIssue(`${b}1`, []) === "reserved") b = "ref";
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
  const token = mentionText(src[at - 1] ?? "", name, src[at] ?? "");
  return { text: src.slice(0, at) + token + src.slice(at), caret: at + token.length };
}

/**
 * 把 `@name` 放在 prev 与 next 两个字之间要写成什么 —— 插入点名（insertMention）与文字模板改写图位（rewriteSlotMentions）共用。
 * · 名字以字母数字收尾、后面又紧跟字母数字：补一个空格（「@Ref1abc」认不回「Ref1」）；
 * · 前面紧挨着字母数字：也隔开（否则这个 @ 会被当成邮箱里的那种，见 compileMentions）。
 */
function mentionText(prev: string, name: string, next: string): string {
  const lead = WORD.test(prev) ? " " : "";
  const pad = WORD.test(name[name.length - 1] ?? "") && WORD.test(next) ? " " : "";
  return `${lead}@${name}${pad}`;
}

// ── 文字模板的「图位」：正文里的「图4 / 图片4 / 参考图1、2」→ @名字 ─────────────
//
// ★★ 为什么必须改写、不能留着裸的「图N」（2026-10-26 文字模板，事实核对见 docs/text-template-design-2026-10-26.md）：
//   这一发真正发出去的参考图顺序是「帧 → 临时参考图 → 卡片形象图」（segmentGen.refSlotsOf），模型认的「图片N」是**发送顺序**。
//   作者写的「图4（女仆装）」在使用者那一发里可能是图片2、也可能是上一段尾帧之后的图片5 —— 编号必然错位，零报错。
//   改写成 @名字 之后，出片那一拍由 compileMentions 编成「女仆装（图片K）」，K 是真实编号，帧和承接怎么变都对得上。
// ★ 认法「宁可漏认不错认」：漏认的那一处在作者那一屏看得见（认出的图位少一个），错认会把「地图1号」「2个人」改成点名。
//   · 前面是「地 / 试 / 意 / 构 / 蓝 / 截…」这类组成别的词的字（地图、试图、意图、构图、蓝图、截图）不认；
//     「参考图 / 效果图 / 示意图 / 草图…」这些「X图」整个吃进来（改写时一起换掉，不留「参考@披风」）；
//   · 阿拉伯数字后面紧跟字母数字（4K、1080p、图10 里的 1）不认；中文数字后面紧跟汉字（「图一样」）不认，「和 / 与 / 及」除外；
//   · 「参考图1、2」「图1和2」：列举里的光秃数字也算，但它后面（跳过行内空白）必须是文末 / 换行 / 标点 / 连词
//     （「图1、2个人」「图1，2 人」「image 1, 2 girls」里的 2 不算，「参考图1，2-4s」里的 2 是时间码也不算）；
//     「图1-3」展开成三个（最多跨 9）；
//   · 图位词与编号之间不许跨行（行尾的「一张图」+ 下一行的「2-4s」不是图位 2）；
//   · 已经在 @名字 里面的（「@站位草图2」）不动：那是人写的点名。
// ★ 这里只认、只改写；图位叫什么由作者在建模板那一屏起（名字过 refNameIssue，含着图位写法的名字是保留的 —— 否则改写完再认一遍又认出来）。

/** 正文里一处图位写法（左闭右开）；nums 通常一个，「图1-3」这种范围是几个 */
export interface SlotRefHit {
  from: number;
  to: number;
  nums: number[];
}

export interface SlotRefScan {
  hits: SlotRefHit[];
  /** 认出的图位编号（去重、从小到大）—— 编号只是作者的叫法，真正发出去第几张由出片那一拍现算 */
  nums: number[];
  /** 比文字模板段能带的临时参考图多（TEXT_TPL_EXTRA_MAX）：建模板那一屏整句拦 */
  over: boolean;
}

/* i18n-frozen: 文字模板正文里「第几张图」的写法与它两边的边界，是被解析的输入，不是界面文案 */
const SLOT_CN_NUM = "一二三四五六七八九";
/**
 * 「第几张图」里那个「图」字怎么写：「（参考|效果|设计|示意|附|插|草|样）图（片）」或英文 (ref) image / picture / img / pic。
 * ★ 什么算图位词**只写在这里**：SLOT_TOKEN / SLOT_LIST_NEXT / SLOT_RANGE 都从它的 .source 派生，refNameIssue 的保留名也拿 templateSlotRefs 认 ——
 *   原来三处各抄一份词表（前缀表、ref(erence) 前缀、「十」各有各的），覆盖面对不上（2026-10-26 审核）。
 * ★ 只用非捕获组：下面几条按组号取编号。
 */
const SLOT_WORD = /(?:参考|效果|设计|示意|附|插|草|样)?图片?|(?:ref(?:erence)?[ \t]+)?(?:image|picture|img|pic)s?/;
/**
 * 阿拉伯数字的编号后面跟着「-4s / 至6秒」这种：那是一段时间码（「一张图 2-4s：…」里的 2），不是图位。
 * 范围「图1-3」不受影响 —— 它后面没有秒的单位。
 */
const SLOT_TIMECODE_TAIL = /[ \t]*[-–—~～至到][ \t]*\d{1,3}(?:\.\d+)?[ \t]*(?:秒|s(?:ec(?:ond)?s?)?(?![A-Za-z]))/;
/**
 * 一处图位写法：可选的 @ + 图位词 + 编号。分组：1 = @、2 = 图位词、3 = 编号。
 * 编号的右边界写在正则里（阿拉伯数字后面不许紧跟字母数字、不许接着一段时间码；中文数字后面不许紧跟连词以外的汉字），左边界在 slotLeftOk。
 * ★ 词与编号之间只许行内空白（[ \t]），**不许跨行**：原来写的 `\s*`，行尾的「一张图」会和下一行开头的时间码「2-4s」连成一个图位 2，
 *   改写时把换行和「2」一起吃掉，时间轴少一段，零报错（2026-10-26 审核实跑）。
 */
const SLOT_TOKEN = new RegExp(
  String.raw`([@＠])?(${SLOT_WORD.source})[ \t]*#?[ \t]*([1-9]\d?(?![0-9A-Za-z])(?!${SLOT_TIMECODE_TAIL.source})|[一二三四五六七八九](?!(?![和与及跟或])\p{Script=Han}))`,
  "giu",
);
/**
 * 列举里接着的下一个（光秃数字，或再写一遍图位词）。分组：1 = 分隔符（连同两边的空白，改写时原样留着）、2 = 这一项本身（改写的范围）、3 = 编号。
 * ★ 光秃数字最容易错认，右边界最严：跳过行内空白之后，后面只许是文末 / 换行 / 标点 / 连词 ——
 *   「图1，2 人」「image 1, 2 girls」里的 2 是个数，「参考图1，2-4s：…」里的 2 是时间码，都不认（宁可漏认：
 *   「images 1 and 2 here」的 2 也认不出来，作者在体检那一屏看得见少了一个图位，改写成「image 2」就认了）。
 * ★ 同样不许跨行。
 */
const SLOT_LIST_NEXT = new RegExp(
  String.raw`^([ \t]*(?:[、,，和与及跟或&/／]|(?:and|or)(?![A-Za-z]))[ \t]*)((?:${SLOT_WORD.source})?[ \t]*#?[ \t]*([1-9]\d?|[一二三四五六七八九]))(?![0-9A-Za-z])(?![ \t]*[-–—~～至到][ \t]*\d)(?=[ \t]*(?:$|[\r\n]|[和与及跟或&/／]|(?:and|or)(?![A-Za-z])|[^\p{L}\p{N}\s]))`,
  "iu",
);
/** 范围「图1-3」「图1至图3」「images 1-3」（同样不许跨行） */
const SLOT_RANGE = new RegExp(
  String.raw`^[ \t]*[-–—~～至到][ \t]*(?:${SLOT_WORD.source})?[ \t]*([1-9]\d?)(?![0-9A-Za-z])(?!(?![和与及跟或])\p{Script=Han})`,
  "iu",
);
/** 「图」前面是这些字时它是别的词（地图、试图、企图、意图、宏图、版图、拼图、构图、贪图、力图、妄图、希图、谋图、蓝图、截图） */
const SLOT_WORD_BEFORE = /[地试企意宏版拼构贪力妄希谋蓝截]/;
/** 往回找 @ 时碰到这些就停：它们不会出现在名字里（与 NAME_STRIP 同一批） */
const NAME_BREAK = /[\s，。；、：,.;:!?！？()（）「」『』“”"'<>《》【】[\]]/;

const slotNum = (s: string): number => (SLOT_CN_NUM.includes(s) ? SLOT_CN_NUM.indexOf(s) + 1 : Number(s));

/** 左边界：英文前面不许是字母数字；中文「图」前面不许是组成别的词的字；已经在 @名字 里面的不算 */
function slotLeftOk(text: string, at: number, word: string, ownAt: boolean): boolean {
  const prev = text[at - 1] ?? "";
  if (/[A-Za-z]/.test(word[0] ?? "")) {
    if (WORD.test(prev)) return false;
  } else if (/^图/.test(word) && SLOT_WORD_BEFORE.test(prev)) return false;
  if (ownAt) return true;
  // 往回看同一个「词」里有没有 @：有就是人写的点名（@站位草图2）
  for (let i = at - 1; i >= 0 && at - i <= EXTRA_REF_NAME_MAX + 1; i--) {
    const ch = text[i];
    if (ch === "@" || ch === "＠") return false;
    if (NAME_BREAK.test(ch)) break;
  }
  return true;
}

/** 文字模板正文里认出的图位写法（规则见上面那段 ★） */
export function templateSlotRefs(text: string): SlotRefScan {
  const src = text || "";
  const hits: SlotRefHit[] = [];
  const re = new RegExp(SLOT_TOKEN.source, SLOT_TOKEN.flags);
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (!slotLeftOk(src, m.index, m[2], !!m[1])) {
      // 这一处不认：下一轮从它的「图」之后接着找（别跳过整段，免得吃掉紧跟着的真图位）
      re.lastIndex = m.index + 1;
      continue;
    }
    const first = slotNum(m[3]);
    let to = m.index + m[0].length;
    const range = SLOT_RANGE.exec(src.slice(to));
    const end = range ? Number(range[1]) : 0;
    if (range && end > first && end - first <= 8) {
      to += range[0].length;
      hits.push({ from: m.index, to, nums: Array.from({ length: end - first + 1 }, (_, k) => first + k) });
    } else {
      hits.push({ from: m.index, to, nums: [first] });
      // 列举：「参考图1、2」「images 1 and 2」—— 每个光秃数字各算一处，分隔符原样留着
      for (let next = SLOT_LIST_NEXT.exec(src.slice(to)); next; next = SLOT_LIST_NEXT.exec(src.slice(to))) {
        const itemAt = to + next[1].length;
        hits.push({ from: itemAt, to: itemAt + next[2].length, nums: [slotNum(next[3])] });
        to = itemAt + next[2].length;
      }
    }
    re.lastIndex = to;
  }
  const nums = [...new Set(hits.flatMap((h) => h.nums))].sort((a, b) => a - b);
  return { hits, nums, over: nums.length > TEXT_TPL_EXTRA_MAX };
}

/**
 * 把正文里的图位写法换成 `@名字`（names：图位编号 → 名字，名字由作者起、已过 refNameIssue）。
 * · 没给名字的那几处原样留着，编号进 missing（建模板那一屏据此拦「还有图位没起名」）；
 * · 「图1-3」换成「@a、@b、@c」（英文正文用「, 」）；列举里的分隔符原样留着（「参考图1、2」→「@a、@b」）。
 * 改写完再认一遍应当一处都认不出（名字里含着图位写法、或接上数字就成了图位写法的是保留名，见 refNameIssue）。
 * ★ 每一处改完都要能被 compileMentions **认回同一个名字**：它按「最长的先试」认，「@披风」后面紧跟「内衬」时会被另一个图位「披风内衬」截胡 ——
 *   两处都编成「披风内衬（图片2）」，第 1 张图一次都没被点到，零报错（2026-10-26 审核实跑）。所以拿这一段全部图位名、同一套 hitAt 核一遍，
 *   认不回来就在名字后面隔一个空格（hitAt 遇到空格就停）。使用者套用时挂的卡名这里不知道 —— 那是所有 @点名 共有的老问题，不在这一步。
 */
export function rewriteSlotMentions(text: string, names: Readonly<Record<number, string>>): { text: string; missing: number[] } {
  const src = text || "";
  const missing = new Set<number>();
  const cands = candsOf(Object.values(names).filter(Boolean).map((n, i) => ({ key: `slot:${i}`, names: [n], suffix: "" })));
  let out = "";
  let last = 0;
  for (const h of templateSlotRefs(src).hits) {
    const ns = h.nums.map((n) => names[n] || "");
    if (ns.some((x) => !x)) {
      h.nums.filter((n) => !names[n]).forEach((n) => missing.add(n));
      continue;
    }
    out += src.slice(last, h.from);
    const sep = /\p{Script=Han}/u.test(src.slice(h.from, h.to)) ? "、" : ", ";
    out += ns
      .map((nm, k) => {
        const after = k === ns.length - 1 ? src.slice(h.to) : sep;
        const tok = mentionText(k === 0 ? (out[out.length - 1] ?? "") : " ", nm, after[0] ?? "");
        return tok.endsWith(" ") || hitAt(nm + after, cands)?.lower === nm.toLowerCase() ? tok : `${tok} `;
      })
      .join(sep);
    last = h.to;
  }
  out += src.slice(last);
  return { text: out, missing: [...missing].sort((a, b) => a - b) };
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
 * **画帧**时要带上的临时参考图与那句说明 —— 所有画设定帧的路共用（出片前补画 / 推演三套 / 按修改重画，N3 收口）。
 * 不带的话，帧是照着另一个样子画的，出片时帧与参考图互相打架。
 * ★ 站位构图那一类只给**起拍画面**：尾帧也照同一张站位画，这一段就成了一动不动的定格。
 * @param offset 这一发里排在它们前面的参考图张数（底图 + 卡片形象图）：它们的 `<图片N>` 从 offset+1 起
 */
/* i18n-frozen: 画帧提示词里的图片编号写法，发给出图模型 */
export const drawExtraRefs = (extras: readonly ExtraRef[], which: "first" | "last", offset: number): { urls: string[]; line: string } => {
  const list = usableExtraRefs(extras).filter((x) => which === "first" || x.role !== "layout");
  return {
    urls: list.map((x) => x.url),
    line: extraRefLines(
      list.map((x, i) => ({ name: x.name, role: x.role, n: offset + i + 1 })),
      (n) => `<图片${n}>`,
    ),
  };
};

/**
 * 画帧 / 推演用的句子：`@点名` 一律退成名字（画帧那一发的图片编号与出片的不是同一套；名字由 drawExtraRefs 那句接到图上）。
 * 没有 `@` 的句子逐字节原样。
 */
export function plainMentions(text: string, cards: readonly { id: string; name: string }[], extras: readonly ExtraRef[] | undefined): string {
  return compileMentions(
    text,
    mentionTargets({ cards, extras: usableExtraRefs(extras).map((x) => ({ id: x.id, name: x.name, n: null })), frames: {} }),
  ).text;
}

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
