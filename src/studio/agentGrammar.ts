// 画布指挥的**句式与本地解析** —— 唯一实现（D10 第 2 步，统一执行顺序第 6 批）。
//
// ★★ 为什么单拆一个文件：「对画布说话」有两档（studio/canvasAgent 头部），本地档（离线 / 余额不够 / 模型没连上）
//   全靠这里的正则分档，而分档判错的代价不对称 —— 误判成「设置」只是白拒一次，漏判成「要求」会**静默整段覆盖**
//   用户写好的要求（canvasAgent.applyOps 里 require 那一支的 ★★）。这类规则只能靠正反例实跑守住，所以：
//   · **零运行时 import**（只准 `import type`），不用 enum / namespace / 参数属性 —— Node 24 只剥类型就能直接 import，
//     `scripts/check-agent-grammar.mjs` 在构建里拿正反例实跑，测试里一条正则都不重打；
//   · **不含界面文案**：回给用户的话在 canvasAgent 里用 Lingui 拼。这里的中文是**被解析的句式本身**，
//     check-i18n 按冻结文件对待（不计字面量，也不许 import @lingui）。
// ★ 用哪套语法：**不按界面语言选，也不按汉字比例猜**，按段号锚点逐子句分派，中英两套命令词、属性词并联匹配 ——
//   技能原句可以发布给别人装（data/agentSkills），切语言也不重载页面，一句话用什么语言写的与界面语言无关。
//   界面语言只决定：面板插哪套句式（PHRASES）、占位示例（EXAMPLES）、回执与 say 的语言（canvasAgent）。
// ★ 本地档**不产出**推演 / 生成 / 挂卡（花钱，或会整表重写点名句）：认得出来，只回 `paid` 让 canvasAgent 指路。
//   中文本地档新认这三类是中文界面的新能力，拆在 §1 第 27 批，等主人确认。
import type { Lang } from "../i18n/locale";

/** 画布指挥的白名单操作（模型档 parseReply 与本地档 parseLocal 共用；canvasAgent.applyOps 逐条落地或摆成确认卡） */
export type Op =
  /** local = 这条是**本地档**解析出来的（模型那条路不带）。applyOps 据此决定敢不敢覆盖已经写好的要求 —— 见那一支的 ★★ */
  | { op: "require"; seg: number; text: string; local?: boolean }
  | { op: "template"; seg: number; title: string }
  | { op: "untemplate"; seg: number }
  | { op: "cards"; seg: number; add?: string[]; remove?: string[] }
  | { op: "add_segment"; n?: number }
  | { op: "remove_segment"; seg: number }
  | { op: "focus"; seg: number }
  | { op: "cast"; seg: number; map: Record<string, string> }
  | { op: "derive"; seg: number }
  | { op: "generate"; seg: number };

/** 花钱（推演 / 生成）或会整表重写点名句（挂卡）的三类 —— 本地档认得出、不代办 */
export type PaidKind = "derive" | "generate" | "cast";

export interface LocalParse {
  ops: Op[];
  /** 认出是在对某一段说话（或跟在这样一句后面）、但不敢动的原句 */
  unclear: string[];
  /** 说的是段的设置（时长 / 画幅 / 画质）或删段：本地档不办，只指路。段号可能重复，调用方去重 */
  attrSegs: number[];
  /** 同一子句里中英两种段号写法都出现了（「第2段 … segment 3」）：分不清说的是哪一段，不动 */
  mixed: string[];
  /** 认出来的推演 / 生成 / 挂卡：本地档不摆确认卡，只指路 */
  paid: { seg: number; kind: PaidKind }[];
}

/** 一句话最多加几段 —— 模型档 parseReply 与本地档同用这一个数 */
export const ADD_SEGMENTS_MAX = 5;
export function clampAddN(n: number): number {
  return Math.min(ADD_SEGMENTS_MAX, Math.max(1, Math.floor(n) || 1));
}

// ── 切子句 ──────────────────────────────────────────────────────────────
// ★ 引号里的不切（模板名、卡名常带「 · 」和句点）：先把引号内容换成等长的不可见字符再找分隔符，切完回原文取片段。
// ★ 英文句点只在后面是空白或结尾时才算句末（「v1.0」「9:16」不切）。没加引号的名字遇到「. 」照样会被切坏
//   （`use template St. Mary`）—— 面板与示例一律给名字加引号，check-agent-grammar 里钉着这条已知局限。
const QUOTED = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g;
const SPLIT_AT = /[;；。！？!?\n]/;

interface Clause {
  raw: string;
  /** 引号内容遮住之后的同一段（找段号、找分隔符都看它，取原文按下标回 raw） */
  mask: string;
  /** 结束这一子句的那个分隔符（续句并入要求时原样放回） */
  delim: string;
}

function clausesOf(text: string): Clause[] {
  const mask = text.replace(QUOTED, (m) => m[0] + "⁠".repeat(Math.max(0, m.length - 2)) + m[m.length - 1]);
  const out: Clause[] = [];
  let start = 0;
  for (let i = 0; i < mask.length; i += 1) {
    const ch = mask[i];
    if (SPLIT_AT.test(ch) || (ch === "." && (i + 1 >= mask.length || /\s/.test(mask[i + 1])))) {
      out.push({ raw: text.slice(start, i), mask: mask.slice(start, i), delim: ch });
      start = i + 1;
    }
  }
  out.push({ raw: text.slice(start), mask: mask.slice(start), delim: "" });
  return out.filter((c) => c.raw.trim());
}

// ── 段号 ────────────────────────────────────────────────────────────────
const ZH_ANCHOR = /第\s*([0-9０-９一二两三四五六七八九十]+)\s*段/;
/** ★ 刻意不收 scene / shot / clip / part：画面描述里太常见（「a close-up shot 3 of a dog」），收了就会把画面句认成在对某一段下命令 */
const EN_ANCHOR =
  /\b(?:segment|seg)\s*(?:no\.\s*|#\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(\d+)(?:st|nd|rd|th)\s+(?:segment|seg)\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:segment|seg)\b/i;
const EN_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  a: 1, an: 1, another: 1,
};

/** 中文数字 / 全角数字 → int（只到十几，够指段号） */
function zhInt(raw: string): number {
  const s = raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  const M: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (s === "十") return 10;
  if (s.length === 2 && s[0] === "十") return 10 + (M[s[1]] ?? 0);
  if (s.length === 2 && s[1] === "十") return (M[s[0]] ?? 0) * 10;
  return M[s] ?? 0;
}

function enInt(raw: string): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  return EN_NUM[raw.toLowerCase()] ?? 0;
}

// ── 「这句说的是段的设置，不是画面」 ──────────────────────────────────────
// ★★ 判法是**剥词法**（canvasAgent 2026-08 四轮验证定下来的，这里原样搬来并补英文）：把改动动词、属性名、属性值、
//   语气词全部剥掉，剩不下什么才算设置 —— 描述画面的句子剥完一定还剩主体（「镜头**横屏**移动」剩「镜头移动」）。
// ★ 两套词表**合并**剥：中英混输（「第2段 make it vertical」）也要认得出这是设置。
// ★ 必须是**正则字面量**：字符串里的 `\d` 运行时退化成字母 d，那一档就整个死了且零症状（CLAUDE.md 那格坑）。
const ZH_ATTR =
  /(时长|画幅|画质|清晰度|分辨率|竖屏|横屏|极速|标准|高清|超清|标清|原画|电影级|1080p|720p|2k|4k|删掉|删除|删了|去掉|短一?点|长一?点|\d+\s*(?:秒|s)|[一二两三四五六七八九十]+\s*秒)/gi;
/** 改动动词与语气词。★ 只收**功能词**：「画面」「视频」这种内容词一旦收进来，「删掉画面里的路人」会被剥成「里路人」而误判成设置 */
const ZH_VERBS =
  /(改成|换成|变成|设成|调成|设置成|设置为|设为|改为|换为|调到|加到|减到|弄成|调整成|改|换|设|调|弄|把|成|的|吧|了|呗|啊|嘛|请|麻烦|谢谢|帮我|给我|要|想|需要|稍微|大概|左右|再|一下)/gi;
/** 强属性词：出现就是在说设置（剥完剩 ≤1 个英文词、≤3 个汉字才算）。delete / remove 按宾语判：后面只跟 it / this / the segment 才算删段 */
const EN_ATTR_STRONG =
  /\b(?:duration|length|aspect\s+ratio|aspect|orientation|resolution|quality|definition|widescreen|u?hd|fhd|full\s+hd|shorter|longer|(?:fast|standard|hd|ultra|cinematic)\s+(?:tier|quality|mode)|(?:vertical|horizontal|portrait|landscape)\s+(?:video|format|mode|orientation|screen)|(?:1080|720|480|2160)p|[248]k|(?:9|16|1|4|3)\s*:\s*(?:16|9|1|3|4)|\d+(?:\.\d+)?\s*(?:s|secs?|seconds?)|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)[\s-]+(?:secs?|seconds?)|(?:delete|remove|drop)(?=\s*(?:it|this(?:\s+(?:one|segment))?|the\s+segment)?\s*$))\b/gi;
/** 弱属性词：画面里也常出现（vertical pan / portrait lighting / square dance），剥完必须一个词不剩才算 */
const EN_ATTR_WEAK = /\b(?:vertical(?:ly)?|horizontal(?:ly)?|portrait|landscape|square)\b/gi;
const EN_FUNC =
  /\b(?:please|pls|plz|could|can|would|will|you|kindly|just|make|set|change|switch|turn|adjust|update|put|it|its|this|that|the|a|an|to|into|as|in|at|of|for|be|is|should|i|want|like|need|let's|let|me|my|one|bit|little|slightly|more|less|mode|format|thanks|thank|ok|okay|about|around|roughly|and|so|then|now|again|with)\b/gi;
// 「有没有命中」从上面**派生**（带 g 的正则 test 会推进 lastIndex，不能直接复用；抄一份又是同一条规则的第二处实现）
const HIT_ZH = new RegExp(ZH_ATTR.source, "i");
const HIT_STRONG = new RegExp(EN_ATTR_STRONG.source, "i");
const HIT_WEAK = new RegExp(EN_ATTR_WEAK.source, "i");

export function isAttrText(text: string): boolean {
  const zh = HIT_ZH.test(text);
  const strong = HIT_STRONG.test(text);
  const weak = HIT_WEAK.test(text);
  if (!zh && !strong && !weak) return false;
  const left = text
    .replace(EN_ATTR_STRONG, " ")
    .replace(ZH_ATTR, " ")
    .replace(EN_ATTR_WEAK, " ")
    .replace(ZH_VERBS, " ")
    .replace(EN_FUNC, " ");
  const cjk = (left.match(/[㐀-鿿]/g) ?? []).length;
  const words = (left.match(/[a-z0-9]+/gi) ?? []).length;
  if (zh || strong) return cjk <= 3 && words <= 1;
  return cjk === 0 && words === 0;
}

// ── 带段号的命令（模板 / 花钱的三类 / 删段）───────────────────────────────
// 中文模板句**保留 2026-09-10 之前的写法**：只看段号后面那半句，含「模板」时不锚定位置地找「换成 / 套 / 用」——
// 「第2段请用宗主模板」「第2段模板换成宗主」「第2段换个模板，用宗主」都靠它（check-agent-grammar 钉着 6 句）。
const ZH_UNTPL = /(摘掉?|不用|去掉|去除|删掉|取消)模板/;
const ZH_TPL = /(?:换成|套上?|用)\s*(.+?)\s*(?:模板)?$/;
/** 「挂卡：角色位=卡名」「把 1 挂成凛」。★ 要有冒号或等号：「第2段挂卡片在墙上」是画面，不是挂卡 */
const ZH_CAST = /^\s*[:：,，]?\s*(?:挂(?:角色)?卡(?:\s*[:：]|[^=＝→]*[=＝→])|把\s*\S+?\s*挂成)/;
// 下面这几条在 `前半句§后半句` 的壳上整句匹配（§ 占段号的位置）
const ZH_POLITE = String.raw`(?:(?:帮我|请|给我|麻烦|再)\s*)*`;
const ZH_DERIVE = [
  new RegExp(String.raw`^${ZH_POLITE}(?:重新)?推演\s*§\s*(?:的)?\s*(?:三套)?\s*(?:方案)?\s*[吧了呀啊]*$`),
  /^§\s*[:：,，]?\s*(?:重新)?推演\s*(?:一下)?\s*(?:三套)?\s*(?:方案)?\s*[吧了呀啊]*$/,
];
const ZH_GEN = [
  new RegExp(String.raw`^${ZH_POLITE}(?:重新)?(?:生成|出片)\s*§\s*(?:的)?\s*(?:视频)?\s*[吧了呀啊]*$`),
  /^§\s*[:：,，]?\s*(?:重新)?(?:生成|出片)\s*(?:视频)?\s*[吧了呀啊]*$/,
];
/** 「删掉第2段」：只指路（删段在编辑窗底部，已出片的要点两下）。「第2段删掉」由设置词表认 */
const ZH_REMOVE = new RegExp(String.raw`^${ZH_POLITE}把?\s*(?:删掉|删除|删了|去掉)\s*§\s*[吧了呀啊]*$`);

const EN_UNTPL = [
  /^(?:please\s+)?(?:remove|drop|clear|detach|take\s+off)\s+(?:the\s+)?template\s+(?:from|on|of|for)\s+§$/i,
  /^§\s*[:,]?\s*(?:remove|drop|clear|detach)\s+(?:the\s+)?template$/i,
  /^§\s*[:,]?\s*no\s+template$/i,
];
const EN_TPL = [
  /^(?:please\s+)?(?:use|apply|put|set)\s+(?:the\s+)?template\s+(.+?)\s+(?:on|to|for)\s+§$/i,
  /^(?:please\s+)?(?:use|apply)\s+(?:the\s+)?(.+?)\s+template\s+(?:on|to|for)\s+§$/i,
  /^§\s*[:,]?\s*(?:use|apply|set|switch\s+to|change\s+to)?\s*(?:the\s+)?template\s*[:：]?\s*(.+)$/i,
];
const EN_DERIVE = [
  /^(?:please\s+)?(?:re-?)?(?:generate|make|draft|derive|get)\s+(?:3\s+|three\s+)?(?:new\s+)?plans?\s+(?:for|of)\s+§$/i,
  /^(?:please\s+)?re-?plan\s+§$/i,
  /^§\s*[:,]?\s*(?:re-?)?(?:generate|make|draft|derive|get)?\s*(?:3\s+|three\s+)?(?:new\s+)?plans?$/i,
];
const EN_GEN = [
  /^(?:please\s+)?(?:re-?)?(?:generate|render)\s+(?:the\s+)?(?:video\s+(?:for|of)\s+)?§(?:\s+video)?$/i,
  /^§\s*[:,]?\s*(?:re-?)?(?:generate|render)(?:\s+(?:the\s+)?video)?$/i,
];
const EN_CAST = [/^§\s*[:,]?\s*cast\b/i, /^(?:please\s+)?cast\s+.+\s+(?:in|on|for)\s+§$/i];
const EN_REMOVE = /^(?:please\s+)?(?:delete|remove|drop)\s+(?:the\s+)?§$/i;
/** 英文段号前面只许跟这些词（「In segment 3, …」「make segment 2 vertical」）；别的词开头（「a cat in segment 2」）说不清是不是在对这一段说话 */
const EN_PREFIX_OK = /^(?:(?:please|pls|and|then|now|also|for|in|on|at|the|make|set|change|turn|switch|put|把|给|请|麻烦|帮我)\s*,?\s*)*$/i;

const ZH_ADD = /加\s*([0-9０-９一二两三四五]*)\s*段/;
const EN_ADD = /\badd\s+(?:(\d+|a|an|one|another|two|three|four|five)\s+)?(?:more\s+|new\s+)?segments?\b/i;

/** 没有段号的续句里的**命令**（「删掉它」「Generate it」）：它 / it 指谁说不清，不动。★ 先于设置判：删字也在设置词表里 */
const CONT_CMD = [
  new RegExp(String.raw`^(?:(?:帮我|请|给我|麻烦|再|然后|接着|顺便|最后|那就|就)\s*)*把?\s*(?:它|这一?段|那一?段)?\s*(?:重新)?(?:生成|推演|出片|挂卡|删掉|删除|删了|去掉)`),
  /^(?:(?:please|pls|then|and|now|also|ok|okay|so)\s*,?\s*)*(?:re-?)?(?:generate|render|delete|remove|drop|plan|derive|cast)\b/i,
];
/** 客套话：丢掉，不当要求也不报没听懂 */
const THANKS =
  /^(?:谢谢|多谢|谢啦|谢了|感谢|辛苦了?|好的|好滴|ok|okay|thanks?(?:\s+(?:a\s+lot|so\s+much))?|thank\s+you(?:\s+(?:so|very)\s+much)?|thx|ty|cheers|great|cool)[\s,，.。!！~～]*$/i;

const unquote = (s: string) =>
  s
    .trim()
    .replace(/^模板\s*/, "")
    .replace(/^[「『“"](.*)[」』”"]$/, "$1")
    .trim();

function paidOf(shell: string, rest: string): PaidKind | null {
  if (ZH_CAST.test(rest) || EN_CAST.some((re) => re.test(shell))) return "cast";
  if (ZH_DERIVE.some((re) => re.test(shell)) || EN_DERIVE.some((re) => re.test(shell))) return "derive";
  if (ZH_GEN.some((re) => re.test(shell)) || EN_GEN.some((re) => re.test(shell))) return "generate";
  return null;
}

type RequireOp = Extract<Op, { op: "require" }>;

/** 一个带段号的子句。写出要求时回那条要求（后面的纯画面续句要并进它） */
function anchored(r: LocalParse, seg: number, zh: boolean, prefix: string, rest: string, raw: string): RequireOp | null {
  const shell = `${prefix}§${rest}`.trim();
  // ① 模板
  if (zh && ZH_UNTPL.test(rest)) {
    r.ops.push({ op: "untemplate", seg });
    return null;
  }
  const zt = zh && /模板/.test(rest) ? rest.match(ZH_TPL) : null;
  if (zt) {
    r.ops.push({ op: "template", seg, title: unquote(zt[1]) });
    return null;
  }
  if (EN_UNTPL.some((re) => re.test(shell))) {
    r.ops.push({ op: "untemplate", seg });
    return null;
  }
  for (const re of EN_TPL) {
    const et = shell.match(re);
    if (et) {
      r.ops.push({ op: "template", seg, title: unquote(et[1]) });
      return null;
    }
  }
  // ② 花钱 / 重写点名句的三类：认得出，不代办
  const paid = paidOf(shell, rest);
  if (paid) {
    r.paid.push({ seg, kind: paid });
    return null;
  }
  // ③ 删段：只指路
  if (ZH_REMOVE.test(shell) || EN_REMOVE.test(shell)) {
    r.attrSegs.push(seg);
    return null;
  }
  // ④ 英文段号前面跟着别的词
  if (!zh && !EN_PREFIX_OK.test(prefix.trim())) {
    r.unclear.push(raw);
    return null;
  }
  // ⑤ 设置，还是画面
  const body = rest.replace(/^\s*[:：,，\-–—]\s*/, "").trim();
  if (isAttrText(zh ? body : `${prefix} ${body}`)) {
    r.attrSegs.push(seg);
    return null;
  }
  if (body.replace(/[\s\p{P}]/gu, "").length >= 2) {
    const op: RequireOp = { op: "require", seg, text: body, local: true };
    r.ops.push(op);
    return op;
  }
  r.unclear.push(raw);
  return null;
}

/**
 * 本地档：一句话 → 能落地的 ops + 要指路 / 要说清楚没动的那几句。规则窄一点没关系，**说清楚**最重要。
 *
 * 没有段号的续句按这个顺序判（先判的赢）：
 *   ① 命令（「删掉它」「Generate it」）→ unclear —— 它 / it 指谁说不清；
 *   ② 设置（「改成竖屏」「Make it vertical」）→ 归到上一个带段号子句的那一段，只指路；
 *   ③ 客套（「谢谢」「Thanks」）→ 丢掉；
 *   ④ 纯画面描述，而且紧跟在一条要求后面 → 并进那条要求，分隔符原样放回（原来这种续句会被静默丢掉）；
 *   其余 → unclear。
 */
export function parseLocal(text: string): LocalParse {
  const r: LocalParse = { ops: [], unclear: [], attrSegs: [], mixed: [], paid: [] };
  let lastSeg = 0;
  let lastRequire: RequireOp | null = null;
  let prevDelim = "";
  for (const c of clausesOf(text)) {
    const raw = c.raw.trim();
    const delimBefore = prevDelim;
    prevDelim = c.delim;
    const prevRequire = lastRequire;
    lastRequire = null;
    const zm = c.mask.match(ZH_ANCHOR);
    const em = c.mask.match(EN_ANCHOR);
    if (zm && em) {
      r.mixed.push(raw);
      lastSeg = 0;
      continue;
    }
    const m = zm ?? em;
    if (m) {
      const zh = !!zm;
      const seg = zh ? zhInt(m[1]) : enInt(m[1] ?? m[2] ?? m[3]);
      if (!seg) {
        r.unclear.push(raw);
        lastSeg = 0;
        continue;
      }
      lastSeg = seg;
      const at = m.index ?? 0;
      lastRequire = anchored(r, seg, zh, c.raw.slice(0, at), c.raw.slice(at + m[0].length), raw);
      continue;
    }
    const za = c.mask.match(ZH_ADD);
    const ea = za ? null : c.mask.match(EN_ADD);
    if (za || ea) {
      r.ops.push({ op: "add_segment", n: clampAddN(za ? zhInt(za[1] || "1") || 1 : ea?.[1] ? enInt(ea[1]) : 1) });
      lastSeg = 0;
      continue;
    }
    if (lastSeg && CONT_CMD.some((re) => re.test(raw))) {
      r.unclear.push(raw);
      continue;
    }
    if (lastSeg && isAttrText(raw)) {
      r.attrSegs.push(lastSeg);
      continue;
    }
    if (THANKS.test(raw)) continue;
    if (prevRequire) {
      const sep = /[。！？；]/.test(delimBefore) ? delimBefore : delimBefore === "\n" ? "\n" : `${delimBefore} `;
      prevRequire.text = `${prevRequire.text}${sep}${raw}`;
      lastRequire = prevRequire;
      continue;
    }
    r.unclear.push(raw);
  }
  return r;
}

// ── 角色位（模型档与本地档共用）─────────────────────────────────────────────
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
const ALIAS_EDGE = /^(?:the\s+)?(?:(left|right)-?most|far\s+(left|right))$/i;
const ALIAS_KTH = /^(?:the\s+)?(\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)(?:st|nd|rd|th)?\s+(?:one\s+)?from\s+(?:the\s+)?(left|right)$/i;

/** 这是不是一句英文序数别名（leftmost / 2nd from left）。调用方拒绝时据此换一句更准的话 */
export function isOrdinalAlias(raw: string): boolean {
  const s = raw.trim();
  return ALIAS_EDGE.test(s) || ALIAS_KTH.test(s);
}

/**
 * 模型 / 用户说的角色位 → 这个模板真有的那个 label（对不上回 null，调用方整句报可用位子）。
 *   ① 原字样；② 剥「位置 / 编号 / position / slot / #」前缀再对；
 *   ③ 序数方案下的英文别名，**按服务端 markSlots 的下标取**原字样 —— 不产生任何措辞
 *      （server blockoutize.service.js 那条「App 仓不许有序数措辞、不许有第 k 个怎么说的函数」）。
 * ★★ 截断闸：markSlots 是服务端截到 maxRoles 条之后的 roles.map(label)（templates.BLOCKOUT_MAX_ROLES），名次却在全部人里算 ——
 *   截过的清单不连续，「最左边」可能根本不在里面，按下标取会取到另一个人（换错人、零报错）。
 *   清单长度等于上限就说明**可能**截过：别名一律不认，只收原字样。方案判定由调用方问 templates.markSpecOf。
 */
export function resolveRoleLabel(
  tpl: { markSlots?: readonly string[]; roles: readonly { label: string }[] },
  raw: string,
  maxRoles: number,
): string | null {
  const labels = tpl.roles.map((x) => x.label);
  const s = raw.trim();
  if (labels.includes(s)) return s;
  const bare = s.replace(/^(?:位置|编号|position|slot|role|number|no\.?|#)\s*/i, "").trim();
  if (labels.includes(bare)) return bare;
  const slots = tpl.markSlots;
  if (!slots?.length || slots.length >= maxRoles) return null;
  let idx = -1;
  const edge = s.match(ALIAS_EDGE);
  if (edge) idx = (edge[1] ?? edge[2]).toLowerCase() === "left" ? 0 : slots.length - 1;
  const kth = s.match(ALIAS_KTH);
  if (kth) {
    const k = Number(kth[1]) || ORDINALS[kth[1].toLowerCase()] || 0;
    if (k) idx = kth[2].toLowerCase() === "left" ? k - 1 : slots.length - k;
  }
  const hit = idx >= 0 && idx < slots.length ? slots[idx] : undefined;
  return hit !== undefined && labels.includes(hit) ? hit : null;
}

// ── 句式面板与示例（按界面语言取；每一条都在 check-agent-grammar 里实跑过本地档会怎么认）─────────────
export type PhraseId = "require" | "template" | "untemplate" | "cast" | "add" | "remove" | "derive" | "generate";
/** 本地档对这条句式的预期结局。starter = 起手句（填到一半），只许 unclear，绝不许写成要求 */
export type PhraseExpect = "require" | "template" | "untemplate" | "add_segment" | "attr" | "paid" | "starter";
export interface Phrase {
  id: PhraseId;
  make: (seg: number) => string;
  expect: PhraseExpect;
}

export const PHRASES: Record<Lang, readonly Phrase[]> = {
  zh: [
    { id: "require", make: (s) => `第${s}段拍`, expect: "starter" },
    { id: "template", make: (s) => `第${s}段套模板「」`, expect: "template" },
    { id: "untemplate", make: (s) => `第${s}段摘掉模板`, expect: "untemplate" },
    { id: "cast", make: (s) => `第${s}段挂卡：角色位=卡名`, expect: "paid" },
    { id: "add", make: () => "加一段", expect: "add_segment" },
    { id: "remove", make: (s) => `删掉第${s}段`, expect: "attr" },
    { id: "derive", make: (s) => `重新推演第${s}段的方案`, expect: "paid" },
    { id: "generate", make: (s) => `生成第${s}段`, expect: "paid" },
  ],
  en: [
    { id: "require", make: (s) => `Segment ${s}: `, expect: "starter" },
    { id: "template", make: (s) => `Segment ${s}: use template ""`, expect: "template" },
    { id: "untemplate", make: (s) => `Segment ${s}: remove template`, expect: "untemplate" },
    { id: "cast", make: (s) => `Segment ${s}: cast slot = card`, expect: "paid" },
    { id: "add", make: () => "Add a segment", expect: "add_segment" },
    { id: "remove", make: (s) => `Delete segment ${s}`, expect: "attr" },
    { id: "derive", make: (s) => `Re-plan segment ${s}`, expect: "paid" },
    { id: "generate", make: (s) => `Generate segment ${s}`, expect: "paid" },
  ],
};

/** 面板上点一条句式 → 填进输入框的那句 */
export function phraseText(lang: Lang, id: PhraseId, seg: number): string {
  return PHRASES[lang].find((p) => p.id === id)?.make(seg) ?? "";
}

/** 「我的模板」列表点一个 = 第 N 段套它。名字一律加引号（没加引号的名字遇到「. 」「,」会被切坏） */
export const templatePhrase: Record<Lang, (seg: number, title: string) => string> = {
  zh: (s, title) => `第${s}段套模板「${title}」`,
  en: (s, title) => `Segment ${s}: use template "${title}"`,
};

/** 占位与空态里的示例句。describe = 写要求（本地档也办得了），template = 套模板，add = 加一段 */
export const EXAMPLES: Record<Lang, { describe: string; template: string; add: string }> = {
  zh: { describe: "第1段拍主角雨夜狂奔", template: "第2段套宗主模板", add: "加一段" },
  en: { describe: "Segment 1: the hero runs through a rainy night", template: 'Segment 2: use template "Sect Master"', add: "Add a segment" },
};

/**
 * 按语言截断 —— 模型档那几处「截一截再用」都走它（快照里的要求、模型的 say、回执里引的原话）。
 * ★ 原来一律 `slice(0, n)`：n 是按汉字的信息量定的，同一个 n 截英文只剩两三个词、还常切在词中间。
 *   含汉字的照旧按字截（中文输出逐字不变）；不含汉字的按词边界截，上限放宽到 3n。
 */
export function clipForLang(s: string, n: number): string {
  if (/\p{Script=Han}/u.test(s)) return s.slice(0, n);
  const max = n * 3;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  if (/\s/.test(s[max])) return cut.trimEnd();
  // 在最后一个空白处断；整段没有空白（一长串地址 / 编号）就硬切
  const at = cut.search(/\s+\S*$/);
  return at > 0 ? cut.slice(0, at) : cut;
}
