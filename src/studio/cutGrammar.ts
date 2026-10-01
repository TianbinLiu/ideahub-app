// 剪辑台指挥（「对剪辑台说话」）的**句式与解析** —— 唯一实现（docs/cut-autoedit-research.md 的 P2b）。
//
// 两样东西在这里，都把输入当**不可信**的：
//   · parseCutLocal：本地档。直白的句子（「把片段2放慢」「mute clip 3」）不问模型、不花钱，当场办；
//   · parseCutReply：模型档回话的形状检查。模型只许回白名单里的操作（CutOp），别的一概丢掉。
// 落地不在这里（data/cutProject.applyCutOps，只调那边的改法）；操作的形状（CutOp）也定义在那边 ——
// 这里只 import type（依赖方向 studio → data），顺手原样再导出一次，认句式的调用方不用两头找。
//
// ★★ 与 studio/agentGrammar 同一套纪律（那边的文件头写得更细）：
//   · **零运行时 import**（只准 import type），不用 enum / namespace —— scripts/check-cut-grammar.mjs 在构建里
//     直接 import 本文件拿正反例实跑，测试里一条正则都不重打；
//   · **不含界面文案**：这里的中文是被解析的句式本身，check-i18n 按冻结文件对待（FROZEN_FILES）；
//     回给用户的话在 cutAgent 里用 Lingui 说；
//   · 正则一律写**字面量**（写成字符串再 new RegExp，`\d` 会静默退化成字母 d —— CLAUDE.md 那一格）；
//   · 用哪套语法不按界面语言选：中英两套句式并联，一句话用什么语言写的与界面语言无关。
// ★ 本地档判错的方向要安全：**认不准就不办**（回 unclear，交给模型档或者原样告诉人没听懂）。
//   一句话里除了认得的命令词还剩下一截说不清的内容（剥词法，见 leftover）就算认不准 ——
//   「把片段2删掉」办，「把片段2里那个路人删掉」不办（那是圈选重拍的活，删片段就错大了）。

import type { ClipRef, CutOp } from "../data/cutProject";

export type { ClipRef, CutOp };

export interface CutParse {
  ops: CutOp[];
  /** 没认准、所以没动的原句（子句） */
  unclear: string[];
}

// ── 切子句 ──────────────────────────────────────────────────────────────
// 引号里的不切（字幕 / 标题的正文常带逗号句号）：先把引号内容换成占位符再找分隔符，切完按位置取回原文。
const QUOTED = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|‘[^’]*’/g;
const SPLIT_AT = /[;；。！？!?\n，,]/;

interface Clause {
  raw: string;
  /** 这一子句里第一段引号里的内容（不含引号）；没有就是 null */
  quoted: string | null;
  /** 去掉引号那一截之后的句子（命令词在这里找） */
  bare: string;
}

function clausesOf(text: string): Clause[] {
  const masked = text.replace(QUOTED, (m) => "\u0001".repeat(m.length));
  const out: Clause[] = [];
  let from = 0;
  const push = (to: number) => {
    const raw = text.slice(from, to).trim();
    if (raw) {
      const q = raw.match(QUOTED);
      out.push({ raw, quoted: q ? q[0].slice(1, -1).trim() : null, bare: raw.replace(QUOTED, " ").replace(/\s+/g, " ").trim() });
    }
    from = to + 1;
  };
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (!SPLIT_AT.test(ch)) continue;
    // 英文句点只在后面是空白或结尾时才算句末；小数点（1.5 倍）、逗号前后都是数字（1,000）不切
    if ((ch === "," || ch === "，") && /\d/.test(masked[i - 1] ?? "") && /\d/.test(masked[i + 1] ?? "")) continue;
    push(i);
  }
  push(masked.length);
  return out;
}

// ── 数字 ────────────────────────────────────────────────────────────────
const ZH_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 「三」「12」「十二」「二十」→ 数。认不出回 NaN */
function zhInt(raw: string): number {
  const s = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return ZH_DIGIT[s] ?? NaN;
  if (s.length === 2 && s[0] === "十") return 10 + (ZH_DIGIT[s[1]] ?? NaN);
  if (s.length === 2 && s[1] === "十") return (ZH_DIGIT[s[0]] ?? NaN) * 10;
  if (s.length === 3 && s[1] === "十") return (ZH_DIGIT[s[0]] ?? NaN) * 10 + (ZH_DIGIT[s[2]] ?? NaN);
  return NaN;
}

const EN_ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

function enInt(raw: string): number {
  const s = raw.toLowerCase().trim();
  if (EN_ORD[s]) return EN_ORD[s];
  const m = /^(\d+)(?:st|nd|rd|th)?$/.exec(s);
  return m ? Number(m[1]) : NaN;
}

// ── 点名：说的是哪个片段 ─────────────────────────────────────────────────
// ★ 两种编号别混：「片段 N」「第 N 个片段」说的是时间轴上从左数的**位置**；带"段"字的「第 N 段」「段 N」是另一种说法
//   （缩略图上标的「段 N」是这个片段出自稿子的第几段）。换过序 / 切过 / 删过之后两个数对不上，后一种说法就有两种读法 ——
//   这里只把它原样标成 `{ seg }`，由落地那一步核对读法是不是唯一（cutProject.segRefClip），不唯一就不办。
const ZH_CLIP = /第\s*([0-9０-９一二两三四五六七八九十]+)\s*个?\s*片段|片段\s*([0-9０-９一二两三四五六七八九十]+)/g;
// 单说「段3」时前面不能是另一个词的一部分（片段 / 这一段 / 前半段…），后面也不能是秒数（「…段 3 秒处切开」）
const ZH_SEG = /第\s*([0-9０-９一二两三四五六七八九十]+)\s*个?\s*段|(?<![片一这那每各半分前后首末几])段\s*([0-9０-９]+)(?![0-9０-９.]*\s*秒)/g;
const ZH_LAST = /最后(?:一|那)?个?(?:片段|段)|末尾(?:那)?(?:一)?个?(?:片段|段)/g;
// 「全部」「所有」不带"片段"两个字也算点了全部（「全部静音」「全部配音」）：长的写法排在前面，先匹配上的先拿走
const ZH_ALL = /(?:所有|全部|每一?个?|各个?)的?(?:片段|段)|每段|全片|整条片子?|全部|所有的?/g;
const ZH_CUR = /这一?个?(?:片段|段)|选中的(?:片段|段|那个?)?|当前(?:片段|段)/g;
const EN_CLIP = /\bclip\s*#?\s*(\d+)\b|\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+clip\b/gi;
// 英文界面的缩略图标的是「Seg N」：segment / seg 就是带"段"字的那种说法
const EN_SEG = /\b(?:segment|seg)\s*#?\s*(\d+)\b|\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+segment\b/gi;
const EN_LAST = /\b(?:the\s+)?last\s+(?:clip|segment)\b/gi;
const EN_ALL = /\b(?:all|every|each)\s+(?:of\s+)?(?:the\s+)?(?:clips?|segments?)\b|\beverything\b|\ball\b/gi;
const EN_CUR = /\b(?:this|the\s+selected|the\s+current)\s+(?:clip|segment|one)\b/gi;

interface Anchored {
  refs: ClipRef[];
  /** 点名的那几截拿掉之后剩下的句子 */
  shell: string;
}

/** 把一句话里点名片段的那几截找出来、拿掉。数字认不出的（「第零段」）当没点名 */
function anchorsOf(bare: string): Anchored {
  const refs: ClipRef[] = [];
  let shell = bare;
  const take = (re: RegExp, pick: (m: RegExpExecArray) => ClipRef | null) => {
    shell = shell.replace(new RegExp(re.source, re.flags), (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      const ref = pick(m);
      if (ref === null) return args[0] as string;
      if (!refs.some((r) => sameRef(r, ref))) refs.push(ref);
      return " ";
    });
  };
  const segOf = (n: number): ClipRef | null => (Number.isInteger(n) && n >= 1 ? { seg: n } : null);
  take(ZH_LAST, () => "last");
  take(EN_LAST, () => "last");
  take(ZH_ALL, () => "all");
  take(EN_ALL, () => "all");
  take(ZH_CUR, () => "current");
  take(EN_CUR, () => "current");
  take(ZH_CLIP, (m) => {
    const n = zhInt(m[1] ?? m[2] ?? "");
    return Number.isInteger(n) && n >= 1 ? n : null;
  });
  take(EN_CLIP, (m) => {
    const n = enInt(m[1] ?? m[2] ?? "");
    return Number.isInteger(n) && n >= 1 ? n : null;
  });
  // 位置的说法先拿走（「片段3」里也有"段3"两个字），剩下的才轮到带"段"字的说法
  take(ZH_SEG, (m) => segOf(zhInt(m[1] ?? m[2] ?? "")));
  take(EN_SEG, (m) => segOf(enInt(m[1] ?? m[2] ?? "")));
  return { refs, shell: shell.replace(/\s+/g, " ").trim() };
}

/** 两个点名是不是同一个（`{ seg }` 是对象，不能用 === 比） */
function sameRef(a: ClipRef, b: ClipRef): boolean {
  return typeof a === "object" || typeof b === "object" ? typeof a === "object" && typeof b === "object" && a.seg === b.seg : a === b;
}

/**
 * 这句话里用「第 N 段」这种说法点过的数。
 * 模型档开口之前先拿它核对读法（cutAgent）：模型只认从左数的位置，读法不唯一的话它会**不声不响地**按位置办。
 */
export function segRefsIn(text: string): number[] {
  const out: number[] = [];
  for (const c of clausesOf(text)) {
    for (const r of anchorsOf(c.bare).refs) if (typeof r === "object" && !out.includes(r.seg)) out.push(r.seg);
  }
  return out;
}

// ── 命令词 ──────────────────────────────────────────────────────────────
// 每条规则：命中的那一截命令词会从句子里拿掉，剩下的交给 leftover 判"还有没有说不清的内容"。
const ZH_UNDO = /撤销(?:上一步)?|撤回(?:上一步)?|回到上一步|后悔了/;
const ZH_REDO = /重做|恢复刚才(?:那一步)?/;
const EN_UNDO = /\bundo\b/i;
const EN_REDO = /\bredo\b/i;
const ZH_AUTO = /一键成片|(?:帮我|自动)(?:写|配)(?:上)?(?:旁白|字幕|解说)/;
const EN_AUTO = /\bone[- ]tap\s+finish\b|\bauto[- ]?(?:edit|captions?|narrat\w*)\b|\bwrite\s+(?:the\s+)?narration\b/i;

// 「去掉 X」两种语序都认（「去掉标题」「标题去掉」「标题不要了」）—— 只认前一种的话，后一种会落进下面写正文的规则，
// 把标题写成"去掉"两个字（探句子时真抓到过，字幕那条同理）
const ZH_TITLE_OFF = /(?:去掉|删掉|不要|取消|清空)(?:片头)?标题|(?:片头)?标题\s*(?:去掉|删掉|不要了?|取消|清空)/;
const ZH_TITLE = /(?:片头)?标题\s*(?:改成|改为|写成|换成|叫做?|设为|设成|是|[:：])?\s*/;
// ★ 正文没用引号括起来时，必须有一个把正文**引出来**的词（改成 / 叫 / to …）—— 不然「标题不要了」「the title looks wrong」
//   这种在说别的事的话，会被读成"把标题写成后面那半句"。「是 / is」不算：它后面跟的多半是评价（「标题是不是太长了」）
const ZH_TITLE_SET = /(?:片头)?标题\s*(?:改成|改为|写成|换成|叫做?|设为|设成|[:：])\s*/;
const EN_TITLE_OFF = /\b(?:remove|delete|clear|drop|no)\s+(?:the\s+)?(?:opening\s+)?title\b/i;
const EN_TITLE = /\b(?:set\s+|change\s+|make\s+)?(?:the\s+)?(?:opening\s+)?title\s*(?:to|as|is|:)?\s*/i;
const EN_TITLE_SET = /\b(?:set\s+|change\s+|make\s+)?(?:the\s+)?(?:opening\s+)?title\s*(?:to|as|:)\s*/i;
/** 没用引号的正文里出现这些，多半是在问话 / 评价，不是要写进去的字 */
const NOT_BODY = /[?？]|什么|怎么|怎样|如何|吗|是不是|能不能|可不可以/;

const ZH_LINE_OFF = /(?:去掉|删掉|清空|不要|取消)\s*(?:的)?\s*(?:字幕|旁白|台词|解说)|(?:字幕|旁白|台词|解说)\s*(?:去掉|删掉|清空|不要了?|取消)/;
const ZH_LINE = /(?:写(?:一句|上)?\s*)?(?:的)?\s*(?:字幕|旁白|台词|解说)\s*(?:改成|改为|写成|换成|设为|写|是|[:：])?\s*/;
// 没引号时要有引出正文的词（见 ZH_TITLE_SET 的 ★）：「写一句字幕 …」的"写"在前面也算
const ZH_LINE_SET = /写(?:一句|上)?\s*(?:的)?\s*(?:字幕|旁白|台词|解说)\s*[:：]?\s*|(?:的)?\s*(?:字幕|旁白|台词|解说)\s*(?:改成|改为|写成|换成|设为|写上?|[:：])\s*/;
const EN_LINE_OFF = /\b(?:remove|delete|clear|drop)\s+(?:the\s+)?(?:caption|subtitle|narration|line)s?\b|\bno\s+(?:caption|subtitle)s?\b/i;
const EN_LINE = /\b(?:set\s+|change\s+|write\s+)?(?:the\s+)?(?:caption|subtitle|narration|line)s?\s*(?:to|as|is|:)?\s*/i;
const EN_LINE_SET = /\b(?:set\s+|change\s+|write\s+)?(?:the\s+)?(?:caption|subtitle|narration|line)s?\s*(?:to|as|:)\s*/i;
// 没点名片段时说「去掉字幕」= 不烧字幕（字还留着，随时能开回来）；点了名才是删那一段的字（见 clauseOps ②）
const ZH_CAPS_OFF = /(?:不要?|别|关掉|关闭|取消|去掉|删掉)(?:烧)?字幕(?:烧进画面)?|字幕不(?:要)?烧(?:进画面)?|字幕\s*(?:去掉|关掉|关闭|不要了?|取消)/;
const ZH_CAPS_ON = /(?:打开|开启|显示|烧上?)字幕|字幕烧进画面/;
const EN_CAPS_OFF = /\b(?:turn\s+off|hide|disable|remove|no)\s+(?:the\s+)?(?:captions?|subtitles?)\b|\b(?:captions?|subtitles?)\s+off\b/i;
const EN_CAPS_ON = /\b(?:turn\s+on|show|enable|burn(?:\s+in)?)\s+(?:the\s+)?(?:captions?|subtitles?)\b|\b(?:captions?|subtitles?)\s+on\b/i;

const ZH_UNVOICE = /(?:去掉|删掉|取消|不要)\s*(?:的)?\s*配音|配音\s*(?:去掉|删掉|取消|不要了?)/;
const ZH_VOICE = /配上?音|配音|念出来/;
const EN_UNVOICE = /\b(?:remove|delete|drop)\s+(?:the\s+)?voice-?\s?overs?\b/i;
const EN_VOICE = /\b(?:add\s+)?(?:a\s+)?voice-?\s?overs?\b|\bvoice\b|\bnarrate\b/i;

const ZH_MUSIC = /(?:配乐|背景音乐|音乐|bgm)\s*(?:的)?(?:音量)?\s*(?:调到|调成|改成|改为|设为|设成|降到|升到|到)?\s*(\d{1,3})\s*[%％]/i;
const EN_MUSIC = /\b(?:music|bgm|soundtrack)\s*(?:volume)?\s*(?:to|at|=)?\s*(\d{1,3})\s*%/i;

const ZH_UNMUTE = /取消静音|恢复原声|原声恢复|打开原声/;
const ZH_MUTE = /静音|消音|关掉原声|原声关掉|不要原声/;
const ZH_VOLUME = /(?:原声|声音|音量)\s*(?:的)?(?:音量)?\s*(?:调到|调成|改成|改为|设为|设成|降到|升到|到)?\s*(\d{1,3})\s*[%％]/;
const EN_UNMUTE = /\bunmute\b/i;
const EN_MUTE = /\bmute\b/i;
const EN_VOLUME = /\b(?:sound|volume|audio)\s*(?:to|at|=)?\s*(\d{1,3})\s*%/i;

const ZH_END_FADE_OFF = /(?:去掉|取消|不要)\s*(?:片尾|结尾)(?:的)?淡出|(?:片尾|结尾)(?:的)?淡出\s*(?:去掉|取消|不要了?)/;
const ZH_END_FADE = /(?:片尾|结尾)(?:加上?|要|加个)?淡出|淡出(?:片尾|结尾)/;
const EN_END_FADE_OFF = /\b(?:remove|no|drop|cancel)\s+(?:the\s+)?(?:end(?:ing)?\s+fade(?:\s*out)?|fade\s*-?out)\b/i;
const EN_END_FADE = /\bfade\s*-?out(?:\s+at\s+the\s+end)?\b|\bend(?:ing)?\s+fade\b/i;
const ZH_FADE_OFF = /(?:去掉|取消|不要)\s*(?:的)?\s*(?:闪黑|转场|淡入)|(?:闪黑|转场|淡入)\s*(?:去掉|取消|不要了?)/;
const ZH_FADE = /(?:加上?|加个|要)?\s*(?:闪黑|转场|淡入)|从黑里(?:进来|淡入)/;
const EN_FADE_OFF = /\b(?:remove|no|drop|cancel)\s+(?:the\s+)?(?:fade(?:\s*-?in)?|transition)\b/i;
const EN_FADE = /\b(?:add\s+)?(?:a\s+)?(?:fade(?:\s*-?in)?(?:\s+from\s+black)?|fade\s+through\s+black|transition)\b/i;

const ZH_SPEED_NUM = /(?:速度)?\s*(?:调到|调成|改成|改为|设为|设成|放慢到|加快到|加速到|到)?\s*(\d+(?:\.\d+)?)\s*(?:倍速?|[x×])/;
const ZH_SPEED_HALF = /(?:速度)?\s*(?:调到|调成|改成|放慢到)?\s*半倍?速|放慢一半/;
const ZH_SPEED_DOUBLE = /(?:速度)?\s*(?:调到|调成|改成|加快到)?\s*(?:两|二)倍速?|加快一倍/;
const ZH_SPEED_NORMAL = /原速|正常速度|恢复速度|不变速|速度恢复(?:正常)?/;
const ZH_SLOW = /放慢(?:一?点儿?|些)?|慢放|慢一?点儿?|慢些|慢速|减速/;
const ZH_FAST = /加快(?:一?点儿?|些)?|加速|快一?点儿?|快些|快进|快放/;
const EN_SPEED_NUM = /\b(?:at\s+|to\s+)?(\d+(?:\.\d+)?)\s*x\b(?:\s+speed)?/i;
const EN_SPEED_HALF = /\bhalf\s+speed\b/i;
const EN_SPEED_DOUBLE = /\bdouble\s+speed\b/i;
const EN_SPEED_NORMAL = /\bnormal\s+speed\b|\breset\s+(?:the\s+)?speed\b|\boriginal\s+speed\b/i;
const EN_SLOW = /\bslow(?:er)?(?:\s+down)?\b|\bslow\s*-?mo\b/i;
const EN_FAST = /\bspeed\s+up\b|\bfaster\b/i;

const ZH_TRIM_CUT = /(?:去掉|裁掉|剪掉|砍掉|删掉|裁)\s*(开头|前面|头部?|结尾|末尾|后面|尾部?)(?:的)?\s*(\d+(?:\.\d+)?)\s*秒/;
const ZH_TRIM_KEEP = /只(?:留|要|保留)\s*(前|后)(?:面)?\s*(\d+(?:\.\d+)?)\s*秒/;
const EN_TRIM_CUT = /\b(?:trim|cut|remove)\s+(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)\s+(?:off|from)\s+(?:the\s+)?(start|beginning|front|end|tail)(?:\s+of)?\b/i;
const EN_TRIM_KEEP = /\bkeep\s+(?:only\s+)?(?:the\s+)?(first|last)\s+(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)(?:\s+of)?\b/i;
const ZH_SPLIT = /(?:在|从)?\s*第?\s*(\d+(?:\.\d+)?)\s*秒(?:处|的地方|那里)?\s*(?:切开|分割|切一刀|剪开|切)/;
const EN_SPLIT = /\bsplit\b(?:\s+it)?\s*(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)?\b/i;

const ZH_MOVE_TO = /(?:挪|移|放|调|拖|排)到\s*(?:第\s*([0-9０-９一二两三四五六七八九十]+)\s*(?:位|个)?|(最前面?|开头|最开始)|(最后面?|末尾|结尾))/;
const ZH_MOVE_BACK = /前移|往前(?:挪|移)|提前/;
const ZH_MOVE_FWD = /后移|往后(?:挪|移)|推后/;
const EN_MOVE_TO = /\bmove\b(?:\s+it)?\s*to\s+(?:position\s+)?(?:(\d+)|(the\s+(?:front|start|beginning)|first)|(the\s+end|last))\b/i;
const EN_MOVE_BACK = /\bmove\b(?:\s+it)?\s*(?:earlier|forward|left|up)\b/i;
const EN_MOVE_FWD = /\bmove\b(?:\s+it)?\s*(?:later|back(?:ward)?|right|down)\b/i;

const ZH_REMOVE = /删掉|删除|删了|去掉|移除|拿掉|不要了?/;
const EN_REMOVE = /\b(?:delete|remove|drop)\b/i;

/**
 * 命令词拿掉之后，句子里还剩没剩"说不清的内容"。
 * 客套话、助词、把字句的壳拿干净之后还有一截字 / 词，就说明这句话在说命令词之外的事 —— 本地档不敢办。
 */
function leftover(shell: string): string {
  return shell
    // 连着说几件事时的衔接词（「先…然后…最后…」）也算壳：模拟器实测「撤销，然后把片段1静音」因为"然后"两个字被判成没听懂、
    // 白白问了一次模型（花一次对话的钱）。多字的排在单字前面，先匹配上的先拿走
    .replace(/然后|接着|并且|而且|同时|顺便|另外|最后|首先|之后|还有|以及|帮我|给我|一下|一些|麻烦|谢谢/g, " ")
    .replace(/[的了吧呀啊呢嘛哦]|把|将|请|给|让|使|都|也|再|就|要|想|调|改|成|为|到|设|里|上|那|个|和|跟|与|及|在|从|先|还/g, " ")
    .replace(/\b(?:please|pls|thanks?|thank\s+you|the|a|an|to|of|on|in|at|for|from|it|its|and|then|now|also|make|set|turn|put|change|play|can|you|could|would|my|with|by|first|next|finally|afterwards|after\s+that|too|as\s+well|just)\b/gi, " ")
    .replace(/[\s:：、=→\-—'’"“”「」『』()（）%％.。!！?？]+/g, "")
    .trim();
}

/** 把命中的那一截拿掉（只拿第一处） */
function strip(shell: string, re: RegExp): string {
  return shell.replace(re, " ").replace(/\s+/g, " ").trim();
}

const pct = (raw: string): number => Math.max(0, Math.min(100, Number(raw))) / 100;

/**
 * 一个子句 → 操作。认不准回 null（调用方记进 unclear）。
 * `needs`：这类命令要不要点名片段 —— 没点名时落到「现在选中的那个」（current），由落地那一步去核对有没有选中。
 */
function clauseOps(c: Clause): CutOp[] | null {
  const { refs, shell } = anchorsOf(c.bare);
  const targets: ClipRef[] = refs.length > 0 ? refs : ["current"];
  const each = (mk: (clip: ClipRef) => CutOp): CutOp[] => targets.map(mk);
  /** 命令词之外不许再有内容（见 leftover） */
  const clean = (rest: string) => leftover(rest) === "";
  let m: RegExpExecArray | null;

  // ① 不带片段的：撤销 / 重做 / 一键成片 / 标题 / 字幕开关 / 配乐音量 / 片尾淡出
  if (refs.length === 0) {
    if ((ZH_UNDO.test(shell) && clean(strip(shell, ZH_UNDO))) || (EN_UNDO.test(shell) && clean(strip(shell, EN_UNDO)))) return [{ op: "undo" }];
    if ((ZH_REDO.test(shell) && clean(strip(shell, ZH_REDO))) || (EN_REDO.test(shell) && clean(strip(shell, EN_REDO)))) return [{ op: "redo" }];
    if (ZH_AUTO.test(shell) || EN_AUTO.test(shell)) return [{ op: "auto" }];
    if (ZH_TITLE_OFF.test(shell) && clean(strip(shell, ZH_TITLE_OFF))) return [{ op: "title", text: "" }];
    if (EN_TITLE_OFF.test(shell) && clean(strip(shell, EN_TITLE_OFF))) return [{ op: "title", text: "" }];
    for (const [loose, strict] of [[ZH_TITLE, ZH_TITLE_SET], [EN_TITLE, EN_TITLE_SET]] as const) {
      // 标题的正文：有引号认引号里的（引出正文的词可以省）；没引号就认「改成 / 叫 / to」后面那一截（「标题改成 雨夜信使」），
      // 而且那一截不能是问话 / 评价（见 ZH_TITLE_SET 的 ★）
      const re = c.quoted !== null ? loose : strict;
      if (!re.test(shell)) continue;
      const idx = shell.search(re);
      const after = shell.slice(idx).replace(re, "").trim();
      const before = shell.slice(0, idx);
      const text = c.quoted ?? after;
      if (text && clean(before) && (c.quoted !== null ? clean(after) : !NOT_BODY.test(after))) return [{ op: "title", text }];
      return null;
    }
    if (ZH_CAPS_OFF.test(shell) && clean(strip(shell, ZH_CAPS_OFF))) return [{ op: "captions", on: false }];
    if (EN_CAPS_OFF.test(shell) && clean(strip(shell, EN_CAPS_OFF))) return [{ op: "captions", on: false }];
    if (ZH_CAPS_ON.test(shell) && clean(strip(shell, ZH_CAPS_ON))) return [{ op: "captions", on: true }];
    if (EN_CAPS_ON.test(shell) && clean(strip(shell, EN_CAPS_ON))) return [{ op: "captions", on: true }];
  }
  if ((m = ZH_MUSIC.exec(shell)) && clean(strip(shell, ZH_MUSIC))) return [{ op: "music_volume", value: pct(m[1]) }];
  if ((m = EN_MUSIC.exec(shell)) && clean(strip(shell, EN_MUSIC))) return [{ op: "music_volume", value: pct(m[1]) }];
  if (ZH_END_FADE_OFF.test(shell) && clean(strip(shell, ZH_END_FADE_OFF))) return [{ op: "end_fade", on: false }];
  if (EN_END_FADE_OFF.test(shell) && clean(strip(shell, EN_END_FADE_OFF))) return [{ op: "end_fade", on: false }];
  if (ZH_END_FADE.test(shell) && clean(strip(shell, ZH_END_FADE))) return [{ op: "end_fade", on: true }];
  if (EN_END_FADE.test(shell) && clean(strip(shell, EN_END_FADE))) return [{ op: "end_fade", on: true }];

  // ② 字幕 / 配音（先判"去掉"，再判"写 / 配"）
  if (ZH_LINE_OFF.test(shell) && clean(strip(shell, ZH_LINE_OFF))) return each((clip) => ({ op: "line", clip, text: "" }));
  if (EN_LINE_OFF.test(shell) && clean(strip(shell, EN_LINE_OFF))) return each((clip) => ({ op: "line", clip, text: "" }));
  if (ZH_UNVOICE.test(shell) && clean(strip(shell, ZH_UNVOICE))) return each((clip) => ({ op: "unvoice", clip }));
  if (EN_UNVOICE.test(shell) && clean(strip(shell, EN_UNVOICE))) return each((clip) => ({ op: "unvoice", clip }));
  for (const [loose, strict] of [[ZH_LINE, ZH_LINE_SET], [EN_LINE, EN_LINE_SET]] as const) {
    // 与标题同一条规矩：没引号就要有引出正文的词，正文不能是问话 / 评价
    const re = c.quoted !== null ? loose : strict;
    if (!re.test(shell)) continue;
    const idx = shell.search(re);
    const after = shell.slice(idx).replace(re, "").trim();
    const before = shell.slice(0, idx);
    const text = c.quoted ?? after;
    // 写字幕只对点了名的**一个**片段办：没点名 / 点了好几个 / 「全部」都不敢猜这句话该写给谁
    if (text && refs.length === 1 && refs[0] !== "all" && clean(before) && (c.quoted !== null ? clean(after) : !NOT_BODY.test(after))) {
      return [{ op: "line", clip: refs[0], text }];
    }
    return null;
  }
  if (ZH_VOICE.test(shell) && clean(strip(shell, ZH_VOICE))) return (refs.length > 0 ? refs : (["all"] as ClipRef[])).map((clip) => ({ op: "voice", clip }));
  if (EN_VOICE.test(shell) && clean(strip(shell, EN_VOICE))) return (refs.length > 0 ? refs : (["all"] as ClipRef[])).map((clip) => ({ op: "voice", clip }));

  // ③ 原声音量
  if (ZH_UNMUTE.test(shell) && clean(strip(shell, ZH_UNMUTE))) return each((clip) => ({ op: "volume", clip, value: 1 }));
  if (EN_UNMUTE.test(shell) && clean(strip(shell, EN_UNMUTE))) return each((clip) => ({ op: "volume", clip, value: 1 }));
  if (ZH_MUTE.test(shell) && clean(strip(shell, ZH_MUTE))) return each((clip) => ({ op: "volume", clip, value: 0 }));
  if (EN_MUTE.test(shell) && clean(strip(shell, EN_MUTE))) return each((clip) => ({ op: "volume", clip, value: 0 }));
  if ((m = ZH_VOLUME.exec(shell)) && clean(strip(shell, ZH_VOLUME))) return each((clip) => ({ op: "volume", clip, value: pct(m![1]) }));
  if ((m = EN_VOLUME.exec(shell)) && clean(strip(shell, EN_VOLUME))) return each((clip) => ({ op: "volume", clip, value: pct(m![1]) }));

  // ④ 转场
  if (ZH_FADE_OFF.test(shell) && clean(strip(shell, ZH_FADE_OFF))) return each((clip) => ({ op: "fade", clip, on: false }));
  if (EN_FADE_OFF.test(shell) && clean(strip(shell, EN_FADE_OFF))) return each((clip) => ({ op: "fade", clip, on: false }));
  if (ZH_FADE.test(shell) && clean(strip(shell, ZH_FADE))) return each((clip) => ({ op: "fade", clip, on: true }));
  if (EN_FADE.test(shell) && clean(strip(shell, EN_FADE))) return each((clip) => ({ op: "fade", clip, on: true }));

  // ⑤ 变速（先认明说的倍数，再认"快一点 / 慢一点"）
  const speed = (value: number) => each((clip) => ({ op: "speed", clip, value }));
  if ((m = ZH_SPEED_NUM.exec(shell)) && clean(strip(strip(strip(shell, ZH_SPEED_NUM), ZH_SLOW), ZH_FAST))) return speed(Number(m[1]));
  if ((m = EN_SPEED_NUM.exec(shell)) && clean(strip(strip(strip(shell, EN_SPEED_NUM), EN_SLOW), EN_FAST).replace(/\bspeed\b/gi, " "))) return speed(Number(m[1]));
  if (ZH_SPEED_HALF.test(shell) && clean(strip(shell, ZH_SPEED_HALF))) return speed(0.5);
  if (ZH_SPEED_DOUBLE.test(shell) && clean(strip(shell, ZH_SPEED_DOUBLE))) return speed(2);
  if (EN_SPEED_HALF.test(shell) && clean(strip(shell, EN_SPEED_HALF))) return speed(0.5);
  if (EN_SPEED_DOUBLE.test(shell) && clean(strip(shell, EN_SPEED_DOUBLE))) return speed(2);
  if (ZH_SPEED_NORMAL.test(shell) && clean(strip(shell, ZH_SPEED_NORMAL))) return speed(1);
  if (EN_SPEED_NORMAL.test(shell) && clean(strip(shell, EN_SPEED_NORMAL))) return speed(1);
  // 没说倍数的「慢一点 / 快一点」是**相对**的：从这一段现在的速度起挪一档（落地那一步去读现在是几倍）——
  // 写死成 0.75× / 1.5× 的话，已经放慢过的片段再说一次「再慢一点」就纹丝不动
  const step = (dir: 1 | -1) => each((clip) => ({ op: "speed_step", clip, dir }));
  if (ZH_SLOW.test(shell) && clean(strip(shell, ZH_SLOW))) return step(-1);
  if (EN_SLOW.test(shell) && clean(strip(shell, EN_SLOW))) return step(-1);
  if (ZH_FAST.test(shell) && clean(strip(shell, ZH_FAST))) return step(1);
  if (EN_FAST.test(shell) && clean(strip(shell, EN_FAST))) return step(1);

  // ⑥ 裁 / 切 / 挪（都排在"删"前面：「删掉开头 2 秒」里也有"删掉"）
  if ((m = ZH_TRIM_CUT.exec(shell)) && clean(strip(shell, ZH_TRIM_CUT))) {
    const edge = /开头|前面|头/.test(m[1]) ? "start" : "end";
    return each((clip) => ({ op: "trim", clip, edge, sec: Number(m![2]), mode: "cut" }));
  }
  if ((m = ZH_TRIM_KEEP.exec(shell)) && clean(strip(shell, ZH_TRIM_KEEP))) {
    // 只留前 N 秒 = 动的是结尾那一头；只留后 N 秒 = 动的是开头
    const edge = m[1] === "前" ? "end" : "start";
    return each((clip) => ({ op: "trim", clip, edge, sec: Number(m![2]), mode: "keep" }));
  }
  if ((m = EN_TRIM_CUT.exec(shell)) && clean(strip(shell, EN_TRIM_CUT))) {
    const edge = /start|beginning|front/i.test(m[2]) ? "start" : "end";
    return each((clip) => ({ op: "trim", clip, edge, sec: Number(m![1]), mode: "cut" }));
  }
  if ((m = EN_TRIM_KEEP.exec(shell)) && clean(strip(shell, EN_TRIM_KEEP))) {
    const edge = /first/i.test(m[1]) ? "end" : "start";
    return each((clip) => ({ op: "trim", clip, edge, sec: Number(m![2]), mode: "keep" }));
  }
  if ((m = ZH_SPLIT.exec(shell)) && clean(strip(shell, ZH_SPLIT))) return each((clip) => ({ op: "split", clip, at: Number(m![1]) }));
  if ((m = EN_SPLIT.exec(shell)) && clean(strip(shell, EN_SPLIT))) return each((clip) => ({ op: "split", clip, at: Number(m![1]) }));
  // 挪只对点了名的一个片段办（「把所有片段挪到最前」没有意义）
  const one = targets.length === 1 && targets[0] !== "all" ? targets[0] : null;
  if (one !== null) {
    if ((m = ZH_MOVE_TO.exec(shell)) && clean(strip(shell, ZH_MOVE_TO))) {
      const to = m[2] ? "first" : m[3] ? "last" : zhInt(m[1]);
      return typeof to === "number" && !(Number.isInteger(to) && to >= 1) ? null : [{ op: "move", clip: one, to }];
    }
    if ((m = EN_MOVE_TO.exec(shell)) && clean(strip(shell, EN_MOVE_TO))) {
      const to = m[2] ? "first" : m[3] ? "last" : Number(m[1]);
      return typeof to === "number" && !(Number.isInteger(to) && to >= 1) ? null : [{ op: "move", clip: one, to }];
    }
    if (ZH_MOVE_BACK.test(shell) && clean(strip(shell, ZH_MOVE_BACK))) return [{ op: "move", clip: one, to: { delta: -1 } }];
    if (ZH_MOVE_FWD.test(shell) && clean(strip(shell, ZH_MOVE_FWD))) return [{ op: "move", clip: one, to: { delta: 1 } }];
    if (EN_MOVE_BACK.test(shell) && clean(strip(shell, EN_MOVE_BACK))) return [{ op: "move", clip: one, to: { delta: -1 } }];
    if (EN_MOVE_FWD.test(shell) && clean(strip(shell, EN_MOVE_FWD))) return [{ op: "move", clip: one, to: { delta: 1 } }];
  }

  // ⑦ 删片段：**必须点了名**（「删掉」两个字单说，不敢猜删谁），而且不许是「全部」
  if (refs.length > 0 && !refs.includes("all")) {
    if (ZH_REMOVE.test(shell) && clean(strip(shell, ZH_REMOVE))) return refs.map((clip) => ({ op: "remove", clip }));
    if (EN_REMOVE.test(shell) && clean(strip(shell, EN_REMOVE))) return refs.map((clip) => ({ op: "remove", clip }));
  }
  return null;
}

/**
 * 这句话里有没有"删"的意思（哪种说法都算，宁宽勿严）。
 * 模型档回了删片段的操作、而人的话里压根没提过删 —— 那是模型自己加的戏，调用方不办（cutAgent）：
 * 删片段是白名单里最伤的一种操作，模型的输出是不可信输入。
 */
export function mentionsRemove(text: string): boolean {
  return ZH_REMOVE.test(text) || EN_REMOVE.test(text) || /删|剪掉|砍掉|去除|扔掉|\b(?:cut\s+out|get\s+rid\s+of|trash|erase|take\s+out)\b/i.test(text);
}

/** 本地档：一句话 → 操作 + 没认准的子句 */
export function parseCutLocal(text: string): CutParse {
  const ops: CutOp[] = [];
  const unclear: string[] = [];
  for (const c of clausesOf(text)) {
    // 只有客套话的子句（「…，谢谢」「please,」）不算没听懂
    if (c.quoted === null && leftover(c.bare) === "") continue;
    const got = clauseOps(c);
    if (got && got.length > 0) ops.push(...got);
    else unclear.push(c.raw);
  }
  return { ops, unclear };
}

// ── 模型档：回话的形状检查 ───────────────────────────────────────────────

/**
 * 一句话最多办几件事。
 * ★ 48 = 时间轴最多 24 个片段（原生合成器的上限）× 每个片段两件事。原来是 12：2026-10-01 拿真模型量的时候，
 *   「把偶数编号的片段都静音」在 24 个片段的时间轴上正好回了 12 条 —— 再多一个片段，后面的就被丢掉、只办了一半。
 *   模型被要求对"全部"用 "all"（一条顶 N 条），逐个列的只会是"某一部分片段"，所以按片段数的两倍封顶就够。
 */
export const CUT_OPS_MAX = 48;

function refOf(x: unknown): ClipRef | null {
  if (x === "last" || x === "all" || x === "current") return x;
  const n = typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}
const numOf = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
};
const boolOf = (x: unknown): boolean | null => (x === true || x === "true" || x === "on" ? true : x === false || x === "false" || x === "off" ? false : null);

/** 一条模型给的操作 → 白名单里的 CutOp；不认识 / 缺字段 / 越界的回 null */
function cleanOp(raw: unknown): CutOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const clip = refOf(o.clip);
  const value = numOf(o.value);
  const on = boolOf(o.on);
  switch (o.op) {
    case "speed":
      return clip !== null && value !== null && value >= 0.25 && value <= 4 ? { op: "speed", clip, value } : null;
    case "volume":
      // 模型可能给 0~1，也可能给百分数：大于 1 的当百分数
      return clip !== null && value !== null && value >= 0 && value <= 100 ? { op: "volume", clip, value: value > 1 ? value / 100 : value } : null;
    case "fade":
      return clip !== null && on !== null ? { op: "fade", clip, on } : null;
    case "end_fade":
      return on !== null ? { op: "end_fade", on } : null;
    case "remove":
      return clip !== null && clip !== "all" ? { op: "remove", clip } : null;
    case "move": {
      if (clip === null || clip === "all") return null;
      const to = o.to;
      if (to === "first" || to === "last") return { op: "move", clip, to };
      if (to === "earlier" || to === "later") return { op: "move", clip, to: { delta: to === "earlier" ? -1 : 1 } };
      const n = numOf(to);
      return n !== null && Number.isInteger(n) && n >= 1 && n <= 99 ? { op: "move", clip, to: n } : null;
    }
    case "trim": {
      const sec = numOf(o.sec);
      const edge = o.edge === "start" || o.edge === "end" ? o.edge : null;
      const mode = o.mode === "keep" ? "keep" : "cut";
      return clip !== null && edge && sec !== null && sec > 0 && sec < 600 ? { op: "trim", clip, edge, sec, mode } : null;
    }
    case "keep": {
      // 给模型的说法：「只留开头 / 结尾 sec 秒」。翻成 trim：只留开头 = 动的是结尾那一头，反之亦然
      const sec = numOf(o.sec);
      const part = o.part === "first" || o.part === "last" ? o.part : null;
      return clip !== null && part && sec !== null && sec > 0 && sec < 600
        ? { op: "trim", clip, edge: part === "first" ? "end" : "start", sec, mode: "keep" }
        : null;
    }
    case "split": {
      const at = numOf(o.at);
      return clip !== null && clip !== "all" && at !== null && at > 0 && at < 600 ? { op: "split", clip, at } : null;
    }
    case "line":
      return clip !== null && clip !== "all" && typeof o.text === "string" ? { op: "line", clip, text: o.text.replace(/\s+/g, " ").trim() } : null;
    case "title":
      return typeof o.text === "string" ? { op: "title", text: o.text.replace(/\s+/g, " ").trim() } : null;
    case "captions":
      return on !== null ? { op: "captions", on } : null;
    case "voice":
      return clip !== null ? { op: "voice", clip } : null;
    case "unvoice":
      return clip !== null ? { op: "unvoice", clip } : null;
    case "music_volume":
      return value !== null && value >= 0 && value <= 100 ? { op: "music_volume", value: value > 1 ? value / 100 : value } : null;
    case "undo":
      return { op: "undo" };
    case "redo":
      return { op: "redo" };
    case "auto":
      return { op: "auto" };
    default:
      return null;
  }
}

export interface CutReply {
  /** 模型想对人说的一句话（可能是空串） */
  say: string;
  ops: CutOp[];
  /** 被丢掉的条数（不认识的操作 / 缺字段 / 超过上限） */
  dropped: number;
}

/**
 * 模型的回话 → 一句话 + 白名单操作。读不出 JSON 回 null（调用方原话转给人，什么都不办 —— 宁可少办不乱办）。
 * 回话里夹着的客套话、代码块围栏都认；`ops` 里不成形的逐条丢。
 */
export function parseCutReply(raw: string): CutReply | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const list = Array.isArray(o.ops) ? o.ops : [];
  // ★ 键重复的那种写法（`{"op":"speed","clip":1,…,"op":"volume","clip":2,…}`，少了一串 `},{`）是合法的 JSON：
  //   JSON.parse 不报错、重复的键只留最后一对 —— 几条操作悄悄只剩一条。真模型在「一键成片」那边这么写过一次
  //   （见 cutProject.parseAutoPlan）；操作的形状五花八门、没法像旁白那样按原文捞回来，所以原文里的 "op" 比解析出来的
  //   条数多就整句不认（回 null：一件都不办，调用方会明说）——只办其中一条，比一条都不办更糟。
  if ((text.match(/"op"\s*:/g) ?? []).length > list.length) return null;
  const ops: CutOp[] = [];
  let dropped = 0;
  for (const it of list) {
    const op = cleanOp(it);
    if (op && ops.length < CUT_OPS_MAX) ops.push(op);
    else dropped++;
  }
  return { say: typeof o.say === "string" ? o.say.replace(/\s+/g, " ").trim().slice(0, 200) : "", ops, dropped };
}

// ── 面板上的句式（点一下填进输入框）──────────────────────────────────────
// ★ 这张表与 CutOp 同批改：句式只许覆盖 CutOp 里真有的动作，而且每一句都要是本地档**真听得懂**的
//   （check-cut-grammar.mjs 把这张表逐句喂回 parseCutLocal 验）—— 摆一句点了必被拒的话就是"永远点不动的选项"。
export const CUT_PHRASES: Record<"zh" | "en", readonly string[]> = {
  zh: ["把片段2放慢", "片段3静音", "删掉片段2", "把片段3挪到最前面", "片段2从黑里淡入", "片尾淡出", "片段1的字幕改成「…」", "全部配音", "撤销"],
  en: ["slow down clip 2", "mute clip 3", "delete clip 2", "move clip 3 to the front", "fade in clip 2", "fade out at the end", 'set clip 1 caption to "…"', "voice all clips", "undo"],
};
