// 运镜 chips 的词表，以及「插一句 / 摘一句 / 认出哪几句」—— 三件事的**唯一实现**
// （多语言 PR1，2026-09-11 从 components/flow/CameraChips.tsx 搬出来；那边只剩渲染）。
//
// ★★ 短语是**随提示词发给模型的数据**，不是界面文案：它插进这一段的要求 / 剧情，原样进 Seedream / Seedance。
//   所以不进目录，而是在这里冻结成中英两套 ——
//   · **插哪一套跟着界面语言走**（主人 2026-09-11 拍板）：中文界面插的字节与 2026-08-29 上线以来逐字相同，
//     英文界面插英文；
//   · **认与摘两套始终都管**，与界面语言无关：老草稿、做同款、已发布作品的 plot 里躺着的是中文那句，
//     换成英文界面打开时 chip 照样得亮、点一下照样得摘干净；反过来也一样。
// ★★ 零运行时依赖：scripts/check-camera-vocab.mjs 在构建里用 Node 直接 import 这个文件跑正反例（与
//   check-agent-grammar 同一招，Node 24 只剥类型）。所以只准 `import type`，不许引 Lingui，不许 enum / namespace。
// ★ 正则一律用 `/…/.source` 片段拼：写成字符串常量的话 "\s" 在运行时退化成字母 s，那一档从此匹配不上且零症状
//   （CLAUDE.md「把正则写成字符串常量」那格，本仓栽过两次）。拼接处的字符串片段里**不许出现反斜杠**
//   （现有的片段只有分组与量词符号："(?:" "(?<=" ")" ")?" "|" 这几种及其连写）。
// ★★ 插与摘的总纪律：**只动我们自己插进去的字**。用户的换行、省略号、缩写的点、行首缩进、结尾的空白与分隔符一个都不碰 ——
//   chip 点亮再点灭，屏幕上那段字除了那一句运镜（连同它自己的分隔符）应当原样回来
//   （2026-09-11 两轮评审逐条抓到的六类都是违反了这一条）。
import type { Lang } from "../i18n/locale";

export type CameraMoveId =
  | "pushIn"
  | "pullOut"
  | "orbit"
  | "tracking"
  | "slideLeft"
  | "slideRight"
  | "highAngle"
  | "lowAngle"
  | "handheld"
  | "static";

/**
 * 词表（顺序 = chip 的摆放顺序）。zh 是 2026-08-29 上线以来插进去的原句，**一个字节都不许改**：存量文本靠它认得出、摘得掉。
 * en 只收小写 ASCII 词：不许撞 economy.STYLE_3D_RE（"cg" 之类会让组稿去铸 3D 建模）、不许带引号（segmentGen.hasDialogue
 * 会当成台词）、不许被画布指挥本地档（agentGrammar.isAttrText）认成改设置 —— 三条都由 check-camera-vocab 实跑钉着。
 */
/* i18n-frozen: 插进要求 / 剧情、随提示词发给模型的运镜短语；中英两套都要认得出、摘得掉，不进目录 */
export const CAMERA_MOVES: ReadonlyArray<{ readonly id: CameraMoveId; readonly zh: string; readonly en: string }> = [
  { id: "pushIn", zh: "镜头缓缓推近", en: "slow push-in" },
  { id: "pullOut", zh: "镜头缓缓拉远", en: "slow pull-out" },
  { id: "orbit", zh: "环绕运镜", en: "orbiting camera" },
  { id: "tracking", zh: "跟拍运镜", en: "tracking shot" },
  { id: "slideLeft", zh: "镜头向左平移", en: "camera slides left" },
  { id: "slideRight", zh: "镜头向右平移", en: "camera slides right" },
  { id: "highAngle", zh: "俯拍视角", en: "high-angle shot" },
  { id: "lowAngle", zh: "仰拍视角", en: "low-angle shot" },
  { id: "handheld", zh: "手持晃动感", en: "handheld camera shake" },
  { id: "static", zh: "固定镜头", en: "static camera" },
];

/**
 * ★ 一段最多叠 3 个运镜：海螺官方「一组最多 3 个」、Higgsfield 组合预设同样 ≤3 —— 多了模型顾不过来，
 *   这不是我们的发明是行业口径。同一个运镜的中英两种写法只算一个（activeMoves 按 id 出结果）。
 */
export const CAMERA_MAX_STACK = 3;

const BY_ID = new Map(CAMERA_MOVES.map((m) => [m.id, m] as const));

/**
 * 英文词与词之间：同一行里的空白或连字符都算（slow push in / slow push-in / Slow Push-In 是同一句）。
 * ★ 不含换行：第一版写的是 `[\s-]+`，「Pacing: slow⏎Push-in on the ring」被认成推近，点灭剩「Pacing: on the ring」——
 *   用户那行的「slow」连同换行一起没了（2026-09-11 评审抓到）。一句运镜不会跨两行写。
 */
const WORD_GAP = /(?:[^\S\r\n]|-)+/;
/**
 * 英文短语两头不许紧挨字母：「an ecstatic camera」里没有 static camera，「static cameras」也不是。
 * ★ 紧挨着的连字符算这个词的一部分：「non-static camera」（意思正相反）「semi-static」「static camera-work」「super-slow push-in」
 *   都不是这句运镜。第一版只看字母，于是它们点亮 chip、占掉 3 个名额里的一个，点灭剩「non-」「runs-work」这种断字。
 *   前面单独一个连字符（列表的「- static camera」「-static camera」）仍然认。
 */
const NO_LETTER_BEFORE = /(?<![A-Za-z]-?)/.source;
const NO_LETTER_AFTER = /(?!-?[A-Za-z])/.source;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 水平空白（空格 / 制表 / 全角空格），**不含换行**。摘除时吃的空白一律只吃同一行里的：
 * ★ 第一版写的是 `\s`，而 `\s` 连换行一起吃 ——「A boy runs! Slow push-in⏎A girl turns.」点灭 chip 剩
 *   「A boy runs! A girl turns.」，用户分好的两行被并成一行；列表「2. 镜头缓缓推近⏎3. 女孩回头」摘完第 2、3 条并成一条。
 *   字一个没少、chip 也灭了，所以零症状（2026-09-11 评审抓到）。
 */
const HWS = /[^\S\r\n]*/.source;
const HWS1 = /[^\S\r\n]+/.source;
/** 行首：全文开头，或换行之后 */
const LINE_START = /(?:^|[\r\n])/.source;
/**
 * 紧跟在短语后面、**算这一句自己的**那一个标点（摘短语时连它一起摘）。
 * ★ 连成串的点**不算**：「。。。」「...」是用户自己的省略号，「.NET」「.5」的点是字的一部分 —— 摘了就改了用户的字
 *   （第一版对「镜头缓缓推近...男孩奔跑」拿走一个点剩「..男孩奔跑」，对「static camera, .NET logo spins」把 .NET 的点
 *   当开头残渣清掉剩「NET logo spins」）。「。」只看后面是不是「。」：「镜头缓缓推近。.NET」里那个「。」仍是这一句的句号。
 * ★ 「!?！？」连串整串算这一句的语气（「Slow push-in?!」），摘短语时一起摘 —— 语气跟着那句话走，短语没了它无处可挂。
 */
const OWN_MARK = /(?:[，,;；、:：]|[!?！？]+|。(?!。)|\.(?![.A-Za-z0-9]))/.source;
/** 前一句的句末（含冒号）：短语紧跟在它后面时算「另起一句」 */
const AFTER_STOP = /(?<=[。.!?！？:：])/.source;
/** ① 前面带分隔符的（插入时就是这么接的）：连分隔符一起摘 */
const SEP_BEFORE = HWS + /[，,;；、]/.source + HWS;

/**
 * 摘除的五步（顺序即优先级，每一步对每一处都摘 —— 带 g）：
 *   ① 前面带分隔符：连分隔符一起摘（「男孩奔跑，镜头缓缓推近」→「男孩奔跑」）；
 *   ② 独占一行：连这一行的换行一起摘，不留空行、也不碰上下两行（「男孩奔跑⏎镜头缓缓推近⏎女孩回头」→「男孩奔跑⏎女孩回头」）；
 *   ③ 紧跟前一句的句末：前一句的标点**不碰**，摘自己那一个标点（OWN_MARK）。两种写法二选一 ——
 *      短语前面有空格的，连前面的空格一起摘、后面的空格留给下一句（「A boy runs. Slow push-in. A girl turns.」）；
 *      前面没空格的，摘后面的空格（「男孩奔跑。镜头缓缓推近 女孩回头」→「男孩奔跑。女孩回头」）。
 *      这样短语后面直接是换行时，行尾不会多挂一个空格（「A boy runs! Slow push-in⏎…」→「A boy runs!⏎…」）；
 *   ④ 在行首（缩进之后）：摘自己那一个标点和后面的空格，缩进原样留着（「  镜头缓缓推近。男孩奔跑」→「  男孩奔跑」）；
 *   ⑤ 剩下光秃秃的。
 * ★ ③ 必须是向后看，不能写成捕获组再用 "$1" 放回去：捕获的话第一处把前面的「。」也吃进了匹配、自己后面那个「。」又被
 *   OWN_MARK 吃掉，同一句连着出现两次（「男孩奔跑。镜头缓缓推近。镜头缓缓推近。女孩回头」）时第二处前面已经没有
 *   没被吃掉的句号，掉到 ⑤ 光秃秃地摘，剩「男孩奔跑。。女孩回头」。向后看只读原文、不占位置，每一处都认得出自己在句首。
 */
function stripSteps(v: string): RegExp[] {
  return [
    SEP_BEFORE + v,
    "(?<=" + LINE_START + ")" + HWS + v + "(?:" + HWS + OWN_MARK + ")?" + HWS + /\r?\n/.source,
    AFTER_STOP + "(?:" + HWS1 + v + "(?:" + HWS + OWN_MARK + ")?|" + v + HWS + "(?:" + OWN_MARK + HWS + ")?)",
    "(?<=" + LINE_START + HWS + ")" + v + HWS + "(?:" + OWN_MARK + HWS + ")?",
    v,
  ].map((src) => new RegExp(src, "gi"));
}

/** 用户原有的开头残渣（缩进、分隔符、句点）：摘除落在这一截里或紧挨着它，才算「碰到了开头」（见 removeMove） */
const LEAD_JUNK = /^[\s，,;；、。.]*/;
/**
 * 碰到开头之后清掉的：分隔符（连同它两边同一行里的空白）与整行的空行，**不清句末标点** —— 露在开头的「...」「。。。」「.NET」
 * 都是用户的字。
 * ★ 不清紧挨正文的**行首空白**：第一版写的是 `^[\s，,;；、]*`，`\s` 连换行一起吃 —— 运镜独占第一行时（②连这一行的换行一起摘），
 *   它接着把下一行的缩进也吃掉：「镜头缓缓推近⏎  男孩奔跑⏎  女孩回头」剩「男孩奔跑⏎  女孩回头」，第一条列表项的缩进没了、
 *   后面的还在（2026-09-11 评审抓到）。
 */
const HEAD_EXPOSED = /^(?:[^\S\r\n]*[，,;；、]+[^\S\r\n]*|[^\S\r\n]*\r?\n)*/;

/** 英文界面插入前先削掉的尾巴：空白与分隔符（马上要接我们自己的分隔符）。句末标点**不在里面**，见 insertMove */
const EN_TAIL_SEP = /[\s，、,;；]+$/;
/** 单独一个「。」：中文里它只可能是句号，换成「，」接（与中文界面同一个接法） */
const LONE_CJK_STOP = /(?<!。)。$/;
/** 这些收尾原样留着、另起一句 */
const ENDS_KEEP = /[.。!?！？:：]$/;
const ENDS_HALF_WIDTH = /[.!?:]$/;
/**
 * 英文界面插入时用「，」还是「, 」：看**最后一个字母或数字**是不是汉字（跳过收尾的引号、省略号、破折号、括号）。
 * ★ 不能只看最后一个字符落在哪个区：中文输入法最常打的收尾「”」（U+201D）「……」（U+2026）「——」（U+2014）
 *   都不在 CJK 符号区里，于是「他说“你好”」会接出一个半角逗号 —— 正是这条规则要防的那种"像打错字"。
 *   反过来英文里的弯引号（He said “hi”）按字母 i 判，照样接「, 」。
 * ★ 全角字母 / 数字（ＯＫ、１２）按全角区算中文。一个字母数字都没有的（整句只有标点）才退回看最后一个字符。
 *   两个区按码位比，不塞进正则字符类：区间两端（U+FF00 / U+FFEF）是未分配码位，写原字符在编辑器里看不见，
 *   被人当成乱码"清理"掉一个，这条就静默变窄。
 */
const HAN = /\p{Script=Han}/u;
const LAST_LETTER = /[\p{L}\p{N}](?=[^\p{L}\p{N}]*$)/u;
function inCjkBlock(ch: string): boolean {
  const cu = ch.charCodeAt(0);
  return (cu >= 0x3000 && cu <= 0x303f) || (cu >= 0xff00 && cu <= 0xffef);
}
function endsCjk(s: string): boolean {
  const letter = LAST_LETTER.exec(s)?.[0];
  return letter ? HAN.test(letter) || inCjkBlock(letter) : inCjkBlock(s.slice(-1));
}

// 预编译：每个运镜 × 中英两套，各一条「认」和五条「摘」。
// ★ 「摘」的几条带 g：String.prototype.replace 对全局正则每次都从 lastIndex=0 开始、结束再归零，复用是安全的；
//   「认」的那条不带 g —— 带 g 的 test 会推进 lastIndex，同一条正则第二次 test 会从半截开始找（agentGrammar 的 HIT_* 同理）。
const COMPILED = new Map(
  CAMERA_MOVES.map((m) => {
    const variants = [
      escapeRe(m.zh),
      NO_LETTER_BEFORE + m.en.split(WORD_GAP).map(escapeRe).join(WORD_GAP.source) + NO_LETTER_AFTER,
    ].map((v) => "(?:" + v + ")");
    const entry = {
      hit: variants.map((v) => new RegExp(v, "i")),
      strip: variants.map(stripSteps),
    };
    return [m.id, entry] as const;
  }),
);

/** 文本里有哪几个运镜（按词表顺序、按 id 去重）。中英两套都认，与界面语言无关 */
export function activeMoves(text: string): CameraMoveId[] {
  return CAMERA_MOVES.filter((m) => COMPILED.get(m.id)?.hit.some((re) => re.test(text))).map((m) => m.id);
}

/** 这个运镜在某种语言下插进去的那一句 */
export function movePhrase(id: CameraMoveId, lang: Lang): string {
  return BY_ID.get(id)?.[lang] ?? "";
}

/**
 * 插一句（chip 点亮）。
 * ★ 中文界面：与 2026-08-29 上线以来**逐字节相同**（去掉尾巴上的「，。」与空白，再用「，」接）——
 *   连「A boy runs.，镜头缓缓推近」这种怪样子也原样保留，check-camera-vocab 钉着，别顺手"修"它：
 *   中文界面的出片输入不该因为多语言上线而变一个字节。
 * ★ 英文界面：尾巴上的空白与分隔符去掉；最后一个字母数字是中文就用「，」接，其余用「, 」
 *   （中文句子后面冒一个半角逗号读着像打错字；判法见 endsCjk）。
 * ★ 英文界面、结尾是句末标点（「. 。 ! ? ！ ？ : ：」）：**原样留着、另起一句** —— 半角后面空一格、全角后面不空，首字母大写。
 *   唯一的例外是单独一个「。」：中文里它只可能是句号，照中文界面的接法换成「，」。
 *   ★ 半角句点**不再**换成逗号（多语言 PR1 方案原定「A boy runs.」→「A boy runs, slow push-in」，2026-09-11 评审后改）：
 *     英文的「.」同时是缩写（Inc. / etc.）、首字母缩略（U.S. / e.g.）、省略号（...）的一部分，不查词典分不出哪个是句号。
 *     削掉的话「He lives in the U.S.」接出「U.S, static camera」、点灭还回不来 —— 改的是用户的字。留着另起一句永远不错，
 *     还让点亮再点灭逐字节回到原文。「!?」本来就这么处理（删了语气就变了、接逗号像打错字）；冒号接逗号同样像打错字。
 *   认与摘都不分大小写，所以亮灭与往返不受首字母大写影响。
 */
export function insertMove(text: string, id: CameraMoveId, lang: Lang): string {
  const phrase = movePhrase(id, lang);
  if (lang === "zh") return text.trim() ? `${text.replace(/[，。\s]+$/, "")}，${phrase}` : phrase;
  let body = text.replace(EN_TAIL_SEP, "");
  if (LONE_CJK_STOP.test(body)) body = body.slice(0, -1).replace(EN_TAIL_SEP, "");
  if (!body) return phrase;
  if (ENDS_KEEP.test(body)) {
    return `${body}${ENDS_HALF_WIDTH.test(body) ? " " : ""}${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
  }
  return `${body}${endsCjk(body) ? "，" : ", "}${phrase}`;
}

/**
 * 摘一句（chip 熄灭）：中英两套、**每一处**都摘 —— 之前只摘第一处，同一句出现两次时点完 chip 还亮着，
 * 用户读到的是「点了没反应」。对两套各按 stripSteps 的 ①→⑤ 跑一遍，最后清两头。
 * ★ 开头只清**摘除露出来的**那一截：摘除碰到了开头那串残渣（或紧挨着它）时，记下最靠前的位置 —— 那之前是用户
 *   自己的字（「...然后男孩奔跑」的省略号、「.NET」的点、行首缩进），原样留着；之后的也只清空白与分隔符
 *   （「，镜头缓缓推近，男孩奔跑」摘完露出来的那个「，」），句末标点一律不清（「镜头缓缓推近，...然后男孩奔跑」→「...然后男孩奔跑」）。
 *   摘除一处都没碰到开头就一个字不动。
 * ★★ 结尾**一个字都不清**。短语自己的分隔符已经算在每一步的匹配里（前面的「，」「, 」归 ①、后面的标点归 ③④、独占一行的换行
 *   归 ②），chip 插出来的每一种样子摘完都不剩残渣；剩下的结尾全是用户的字。
 *   ★ 第一版在最后无条件 `.replace(/[\s，,;；、]+$/, "")`，理由是「chip 短语本来就接在结尾」—— 可短语在句中或开头时它照清：
 *     「男孩奔跑，镜头缓缓推近，女孩回头⏎」剩「男孩奔跑，女孩回头」（换行没了）、「Static camera. A boy runs 」剩「A boy runs」
 *     （接着打字就粘成「runsand」）。改成「摘除碰到结尾才清」也不够（2026-09-11 评审给的修法）：点亮、接着敲一个「，」、再点灭，
 *     「男孩奔跑，镜头缓缓推近，」照样剩「男孩奔跑」—— 那个「，」是用户刚敲的。中文界面插入时留下的用户自己的「、;,」
 *     （insertMove 只削「，。」与空白）同理，点灭要原样还回来。不清之后这两种都与 main 逐字节相同。
 *   代价只在手打的文本上：「男孩奔跑⏎镜头缓缓推近」摘完剩「男孩奔跑⏎」，结尾挂一个换行 —— 多留不是改字，main 也是这样。
 * ⚠ 中文仍按子串认（与之前一样）：「不要固定镜头」会点亮「固定」、摘完剩「不要」；英文「not a static camera」同理。
 * ⚠ 已知的小瑕疵（不改用户的字，只是没摘干净）：「，镜头缓缓推近。男孩奔跑」剩「。男孩奔跑」。
 */
export function removeMove(text: string, id: CameraMoveId): string {
  const c = COMPILED.get(id);
  if (!c) return text;
  let out = text;
  let head = Infinity;
  const cut = (re: RegExp): void => {
    const lead = LEAD_JUNK.exec(out)?.[0].length ?? 0;
    out = out.replace(re, (_hit: string, ...rest: unknown[]) => {
      // 回调参数里第一个数字就是这一处的位置（正则里没有捕获组；后面是原串）
      const at = rest.find((v): v is number => typeof v === "number") ?? Infinity;
      if (at <= lead) head = Math.min(head, at);
      return "";
    });
  };
  for (const steps of c.strip) steps.forEach(cut);
  return head === Infinity ? out : out.slice(0, head) + out.slice(head).replace(HEAD_EXPOSED, "");
}
