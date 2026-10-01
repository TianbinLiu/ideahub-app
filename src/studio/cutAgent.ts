// 剪辑台指挥（「对剪辑台说话」，docs/cut-autoedit-research.md 的 P2b）：一句话 → 时间轴上的操作。
// 「对画布说话」（studio/canvasAgent）在剪辑页的对应件，规矩是同一套：
//
// · **白名单**：能办的只有 data/cutProject 的 CutOp 里那些 —— 全是不花用户钱的整理活（变速 / 原声 / 转场 /
//   删挪裁切 / 字幕 / 标题 / 配音 / 配乐音量 / 撤销）。要花钱的两件：圈选重拍这里**根本没有对应的操作**
//   （模型编不出来）；重写旁白只会**打开**「一键成片」的面板（那张确认卡才是点头的地方）。
//   模型的输出是不可信输入，钱上的闸在白名单这一层。
// · **三处分工**：听懂一句话在 studio/cutGrammar（句式 + 模型回话的形状检查），落地在 data/cutProject.applyCutOps
//   （只调那边的改法，手点的、一键成片的、嘴说的走同一批函数 —— 铁律六），这里管调模型、算钱、把结果说成人话。
//   前两处是纯函数，构建里拿正反例实跑（check-cut-grammar / check-cut-project）；这里的话走 Lingui。
// · **两档**：直白的句子本地就听得懂（parseCutLocal），不问模型、不花钱；有一截没听懂才问模型
//   （一次对话 = CHAT_TURN_TOKENS），模型没连上 / 余额不够 / 演示构建就老实说哪一截没听懂（铁律八：不静默）。
// · **回执说的是真相**：applied / refused 是落地那一步的结果，不是模型嘴上说的"已经帮你删了"。
//
// ★ 这里只算"该变成什么样"（回一份新工程 + 要调用方去办的几件事），不碰 store：整句话写回一次、只记一步撤销，
//   由剪辑页来做。
// ★ 问模型是几秒到几十秒的事，这期间人可以接着手剪、上一批配音也可能正在一句句写回来。所以落地用的是
//   **回话到的那一刻**的工程（`ctxOf()` 现读），不是开口那一刻的：照旧工程算出来的结果写回去，会把这几秒里的
//   改动整个盖掉。只有一种情况整句不办 —— 时间轴上的片段增删过或换过序：那时「片段 3」已经不是说话时的那个了。
import { t } from "@lingui/core/macro";
import { AI_REAL, skillChat } from "../ai";
import { briefArkReason } from "../ai/arkClient";
import { chargeNote, chargeOnFail } from "../ai/failCharge";
import { zhPrompt } from "../ai/prompts/zhPrompt";
import { canAfford, spendTokens, walletFrozen } from "../data/account";
import {
  applyCutOps,
  segRefClip,
  clipOutDur,
  clipSpeed,
  clipVolume,
  voiceStale,
  type CutClip,
  type CutOp,
  type CutOpsCtx,
  type CutOpsResult,
  type CutProject,
  type CutReceipt,
  type CutRefusal,
} from "../data/cutProject";
import { CHAT_TURN_TOKENS, fmtTokens } from "../data/economy";
import { mentionsRemove, parseCutLocal, parseCutReply, segRefsIn } from "./cutGrammar";
import { cutIssueText } from "./cutIssues";

/** 落地要知道的现状（形状在 data/cutProject）。剪辑页每次**现读**一份给过来 */
export type CutAgentCtx = CutOpsCtx;

export interface CutAgentOutcome {
  /** 给人的一句话（模型的 say，或本地档的说明）；可能是空串 */
  say: string;
  /**
   * `say` 是不是**模型的原话**。是的话界面要标出来（「模型说：」）：它嘴上常说"已经删掉了"，
   * 而办没办成只看 applied / refused（模拟器实测：模型自己加的删片段被拦下，它的话里照样写着"删掉了拖沓的第二段"）
   */
  quote: boolean;
  /** 办成了的，每条一句人话 */
  applied: string[];
  /** 没办的 + 整句原因 */
  refused: string[];
  /** `next` 是照哪一份工程算出来的（调用方写回之前核对 store 里还是不是它） */
  base: CutProject | null;
  /** 改过之后的工程；一处都没改是 null。调用方**一次**写回（整句话只记一步撤销） */
  next: CutProject | null;
  /** 要去合成配音的片段 id */
  voiceIds: string[];
  /** 要撤销 / 重做几步 */
  undo: number;
  redo: number;
  /** 要打开「一键成片」的面板 */
  openAuto: boolean;
  /** 这一句问了模型（一次对话的钱花出去了） */
  paid: boolean;
}

/** 一句话最长收多少字（再长的不是命令，是作文） */
export const CUT_SAY_MAX = 300;
/** 模型那一发的输出上限。操作是几行很短的 JSON，十几条也就三四百 token；顶到上限按"读不出来"处理（不办） */
const AGENT_MAX_TOKENS = 600;
/** 超时要比服务端 /api/ark 的 150 秒长（客户端先放弃 = 服务端照样计费、人却收到失败） */
const AGENT_TIMEOUT_MS = 170_000;

/* i18n-frozen: 剪辑台指挥模型的系统提示词（规定白名单操作与输出的 JSON 形状），冻结中文 */
const SYSTEM =
  `你是手机剪辑台的助手。用户说一句话，你把它翻成对时间轴的操作。只许用下面列出的操作；重拍画面、换音色、调画质、换分辨率、加贴纸滤镜这些这里办不了——` +
  `在 say 里告诉用户办不了，不要编造操作，也不要说"已经办好了"（办没办成由系统回执说）。` +
  `片段用编号指：1 起，按时间轴从左到右的顺序（用户说"片段2""第2段""第二个"都是这个编号）；"last" 是最后一个，"all" 是全部，"current" 是用户现在选中的那个。操作：` +
  `{"op":"speed","clip":2,"value":0.5到2} 变速（只有 0.5 0.75 1 1.25 1.5 2 这几档）；` +
  `{"op":"volume","clip":2,"value":0到1} 这一段原声的音量，0 是静音；` +
  `{"op":"fade","clip":2,"on":true或false} 这一段从黑里淡入（闪黑转场）；` +
  `{"op":"end_fade","on":true或false} 片尾淡出；` +
  `{"op":"remove","clip":2} 删掉这个片段；` +
  `{"op":"move","clip":3,"to":1} 挪到第几位，to 也可以是 "first" "last" "earlier" "later"；` +
  `{"op":"trim","clip":2,"edge":"start"或"end","sec":2} 裁掉开头或结尾的 2 秒；` +
  `{"op":"keep","clip":2,"part":"first"或"last","sec":3} 只留开头或结尾的 3 秒；` +
  `{"op":"split","clip":2,"at":3} 在这一段的第 3 秒切开；` +
  `{"op":"line","clip":2,"text":"…"} 写或改这一段的字幕（也是旁白的稿子），text 给空字符串就是去掉；` +
  `{"op":"title","text":"…"} 片头标题，空字符串就是去掉；` +
  `{"op":"captions","on":true或false} 字幕烧不烧进画面；` +
  `{"op":"voice","clip":2或"all"} 给这一段的字幕配音；{"op":"unvoice","clip":2或"all"} 去掉配音；` +
  `{"op":"music_volume","value":0到1} 配乐音量；{"op":"undo"} 撤销；{"op":"redo"} 重做（这两个要单独办，别和其它操作放在一起）；` +
  `{"op":"auto"} 打开「一键成片」（给每段写旁白、起标题）。` +
  `只输出 JSON：{"say":"回用户的一句话，用用户说话的语言","ops":[…]}。听不懂或办不了就让 ops 为空、在 say 里说明。`;

/* i18n-frozen: 发给模型的时间轴现状里的固定说法，冻结中文 */
const SNAP_ZH = {
  none: "无",
  yes: "是",
  no: "否",
  fade: "从黑里进来",
  voiced: "有配音",
  stale: "配音过期",
  noLine: "没有字幕",
};

/** 时间轴上的片段（指着不存在的段的不算）。与 applyCutOps 里数编号的是同一条规矩 */
function liveClips(ctx: CutAgentCtx): CutClip[] {
  return ctx.project.clips.filter((c) => c.segIndex >= 0 && c.segIndex < ctx.segCount);
}

/** 时间轴现状 → 给模型看的那段话（它得知道一共几个片段、各自现在什么样，才翻得准） */
function snapshot(ctx: CutAgentCtx): string {
  const p = ctx.project;
  const live = liveClips(ctx);
  const total = live.reduce((s, c) => s + clipOutDur(c, ctx.lens), 0);
  const sel = live.findIndex((c) => c.id === ctx.selectedId);
  const rows = live.map((c, i) => {
    const text = (c.line?.text ?? "").trim();
    const bits = [
      zhPrompt`片段${i + 1}`,
      zhPrompt`${clipOutDur(c, ctx.lens).toFixed(1)}秒`,
      zhPrompt`速度${clipSpeed(c)}×`,
      zhPrompt`原声${Math.round(clipVolume(c) * 100)}%`,
      ...(c.fade ? [SNAP_ZH.fade] : []),
      text ? zhPrompt`字幕：${text.slice(0, 40)}` : SNAP_ZH.noLine,
      ...(c.line?.voice ? [voiceStale(c.line, ctx.voiceId) ? SNAP_ZH.stale : SNAP_ZH.voiced] : []),
    ];
    return bits.join("｜");
  });
  const selected = sel >= 0 ? zhPrompt`片段${sel + 1}` : SNAP_ZH.none;
  const music = p.audio ? `${Math.round(p.audio.volume * 100)}%` : SNAP_ZH.none;
  return [
    zhPrompt`【时间轴】共 ${live.length} 个片段，总长 ${total.toFixed(1)} 秒；选中：${selected}`,
    ...rows,
    zhPrompt`【整条】片头标题：${p.title ?? SNAP_ZH.none}；字幕烧进画面：${p.capOff ? SNAP_ZH.no : SNAP_ZH.yes}；片尾淡出：${p.endFade ? SNAP_ZH.yes : SNAP_ZH.no}；配乐：${music}`,
  ].join("\n");
}

/** 秒数写给人看：整数不带小数点，别的留一位（「2 秒」「2.5 秒」） */
const secText = (s: number): string => String(Math.round(s * 10) / 10);

/** 办成了的一件事 → 一句人话 */
function receiptText(r: CutReceipt): string {
  switch (r.kind) {
    case "speed": {
      const { n, speed } = r;
      return t`片段 ${n}：速度 ${speed}×`;
    }
    case "volume": {
      const { n, pct } = r;
      return pct === 0 ? t`片段 ${n}：原声静音` : t`片段 ${n}：原声 ${pct}%`;
    }
    case "fade": {
      const { n } = r;
      return r.on ? t`片段 ${n}：从黑里进来` : t`片段 ${n}：去掉闪黑`;
    }
    case "end_fade":
      return r.on ? t`片尾淡出：开` : t`片尾淡出：关`;
    case "removed": {
      const { n } = r;
      return t`删掉了片段 ${n}`;
    }
    case "moved": {
      const { n, place } = r;
      return t`片段 ${n} 挪到了第 ${place} 位`;
    }
    case "trimmed": {
      const { n } = r;
      const sec = secText(r.sec);
      if (r.mode === "cut") return r.edge === "start" ? t`片段 ${n}：裁掉了开头 ${sec} 秒` : t`片段 ${n}：裁掉了结尾 ${sec} 秒`;
      // keep：edge 是动的那一头 —— 动结尾 = 留下的是开头
      return r.edge === "end" ? t`片段 ${n}：只留了开头 ${sec} 秒` : t`片段 ${n}：只留了结尾 ${sec} 秒`;
    }
    case "split": {
      const { n } = r;
      const at = secText(r.at);
      return t`片段 ${n}：在第 ${at} 秒切开了`;
    }
    case "line": {
      const { n } = r;
      if (!r.on) return t`片段 ${n}：字幕去掉了`;
      return r.long ? t`片段 ${n}：字幕写好了（这一段念不完这么长，配音之前要改短）` : t`片段 ${n}：字幕写好了`;
    }
    case "title":
      if (!r.on) return t`片头标题去掉了`;
      return r.cut ? t`片头标题写好了（太长，后面的没收）` : t`片头标题写好了`;
    case "captions":
      return r.on ? t`字幕烧进画面：开` : t`字幕烧进画面：关`;
    case "voice": {
      const { count } = r;
      return t`开始给 ${count} 句配音`;
    }
    case "unvoiced": {
      const { n } = r;
      return t`片段 ${n}：配音去掉了`;
    }
    case "music": {
      const { pct } = r;
      return t`配乐音量 ${pct}%`;
    }
  }
}

/** 没办的一件事 → 整句原因（铁律八：说清为什么没办、接下来怎么办） */
function refusalText(r: CutRefusal): string {
  switch (r.kind) {
    case "no_current":
      return t`没说是哪个片段：先点选一个片段，或者说「片段 2」这样的编号`;
    case "no_clip": {
      const { ref, count } = r;
      return t`没有片段 ${ref}（时间轴上一共 ${count} 个）`;
    }
    case "issue": {
      const { n } = r;
      const why = cutIssueText(r.issue);
      return t`片段 ${n}：${why}`;
    }
    case "seg_unclear": {
      const { ref } = r;
      return t`时间轴换过序（或者切过、删过），「第 ${ref} 段」说不准是哪一个——按从左数的位置说，比如「片段 2」（每个片段左上角的数字）`;
    }
    case "gone": {
      const { n } = r;
      return t`片段 ${n} 已经不在时间轴上了`;
    }
    case "same_place": {
      const { n } = r;
      return t`片段 ${n} 已经在那个位置了`;
    }
    case "speed_limit": {
      const { n, speed } = r;
      return t`片段 ${n} 已经是 ${speed}× 了，这个方向没有下一档`;
    }
    case "keep_longer": {
      const { n } = r;
      const sec = secText(r.sec);
      const have = secText(r.have);
      return t`片段 ${n} 现在只有 ${have} 秒，留不出 ${sec} 秒`;
    }
    case "unmeasured": {
      const { n } = r;
      return t`片段 ${n} 的真实长度还没量出来，按秒裁会落在错的地方——先点一下它让它播出来，再说一次`;
    }
    case "bad_number": {
      const { n } = r;
      return t`片段 ${n}：这个数用不了`;
    }
    case "not_all":
      return t`这件事不能对全部片段一起办，说一个编号`;
    case "no_line": {
      const { n } = r;
      return t`片段 ${n} 还没有字幕，没有可配音的话`;
    }
    case "line_long": {
      const { n } = r;
      return t`片段 ${n} 的字幕太长，这一段念不完——改短再配`;
    }
    case "nothing_to_voice":
      return t`没有要配音的句子（还没写字幕，或者都配好了）`;
    case "no_voice":
      return t`没有可去掉的配音`;
    case "voice_offline":
      return t`配音要连上服务器才能合成，现在是离线 / 演示模式`;
    case "voice_busy":
      return t`上一批配音还在合成，等它配完再说`;
    case "no_music":
      return t`还没有配乐——先在「音频」页签里加一条`;
    case "history_alone":
      return t`撤销 / 重做要单独说：这一句里别的改动没有办，撤完再说一次`;
  }
}

type Landed = Omit<CutAgentOutcome, "say" | "quote" | "paid">;

/** 落地（data/cutProject.applyCutOps）并把结果说成人话 */
function land(ops: ReadonlyArray<CutOp>, ctx: CutAgentCtx): Landed {
  const r: CutOpsResult = applyCutOps(ops, ctx);
  return {
    applied: r.receipts.map(receiptText),
    refused: r.refusals.map(refusalText),
    base: ctx.project,
    next: r.next,
    voiceIds: r.voiceIds,
    undo: r.undo,
    redo: r.redo,
    openAuto: r.openAuto,
  };
}

const NOTHING: Landed = { applied: [], refused: [], base: null, next: null, voiceIds: [], undo: 0, redo: 0, openAuto: false };

/** 本地档没听懂的那几截，说给人听 */
function unclearSay(unclear: ReadonlyArray<string>): string {
  if (unclear.length === 0) return "";
  // 引号跟着界面语言走（中文「」、英文 “”）：整句连引号一起交给目录
  const list = unclear
    .map((s) => {
      const piece = s.slice(0, 30);
      return t`「${piece}」`;
    })
    .join(" ");
  return t`这几句没听懂：${list}`;
}

/** 时间轴上的片段表（id 按顺序）：等模型回话的那几秒里它变没变，就比这个 */
const lineup = (ctx: CutAgentCtx): string => liveClips(ctx).map((c) => c.id).join("|");

/**
 * 跑一句话。回的是"该变成什么样"（见文件头的 ★），不碰 store。
 * 不抛：模型没连上之类的失败也折成一句话放进 say（连同钱花没花），听得懂的部分照办。
 *
 * @param ctxOf 现读一份现状。这会儿改不了时间轴（正在合成 / 稿子不在了）就回 null
 */
export async function runCutAgent(text: string, ctxOf: () => CutAgentCtx | null): Promise<CutAgentOutcome> {
  const input = text.trim().slice(0, CUT_SAY_MAX);
  if (!input) return { say: "", quote: false, ...NOTHING, paid: false };
  const ctx = ctxOf();
  if (!ctx) return { say: "", quote: false, ...NOTHING, refused: [t`这会儿改不了时间轴（正在合成，或者这条稿子已经不在了）`], paid: false };
  const local = parseCutLocal(input);
  // 整句都听懂了：不问模型、不花钱（同一拍里读、同一拍里办，中间没有等待）
  if (local.unclear.length === 0) return { say: "", quote: false, ...land(local.ops, ctx), paid: false };
  // ★ 问模型之前先核对「第 N 段」这种说法的读法（cutProject.segRefClip）：模型只认从左数的位置，读法不唯一时它会
  //   不声不响地按位置办 —— 办在另一个片段上，回执里的「片段 N」人也未必看得出不对。不唯一就不问（也不花这一次的钱），
  //   请人按位置再说一遍；本地档听懂的那几件照办（其中点了不唯一的"第 N 段"的，落地那一步同样会拒）。
  const vague = segRefsIn(input).filter((n) => segRefClip(ctx.project.clips, ctx.segCount, n) === null);
  if (vague.length > 0) {
    const landed = land(local.ops, ctx);
    const extra = vague.map((ref) => refusalText({ kind: "seg_unclear", ref })).filter((line) => !landed.refused.includes(line));
    return { say: unclearSay(local.unclear), quote: false, ...landed, refused: [...landed.refused, ...extra], paid: false };
  }
  const canModel = AI_REAL && canAfford(CHAT_TURN_TOKENS);
  if (!canModel) {
    // 冻结与余额不足分开说（冻结的人往往满额度，说"余额不够"是假话）；演示构建就说没连上模型
    const price = fmtTokens(CHAT_TURN_TOKENS);
    const why = !AI_REAL
      ? t`现在是演示模式（没有连上模型），只听得懂直白的句式。`
      : walletFrozen()
        ? t`账户欠额冻结中，问不了模型（充值抵扣后恢复）。`
        : t`余额不够问模型（一句 ${price} token）。`;
    return { say: `${why}${unclearSay(local.unclear)}`, quote: false, ...land(local.ops, ctx), paid: false };
  }
  /**
   * 等完模型之后落地：用**现在**的工程（见文件头的 ★）。
   * 「现在选中的那个」仍按开口那一刻算 —— 人说「把这个放慢」时指的是当时亮着的那个，等的这几秒里点了别的不算。
   */
  const settle = (ops: ReadonlyArray<CutOp>): Landed | null => {
    const now = ctxOf();
    if (!now || lineup(now) !== lineup(ctx)) return null;
    return land(ops, { ...now, selectedId: ctx.selectedId });
  };
  const moved = t`等回话的这几秒里时间轴上的片段变了（增删过或换过序），这一句没有落地——再说一次。`;
  let raw: string;
  let truncated: boolean;
  try {
    const r = await skillChat(SYSTEM, zhPrompt`${snapshot(ctx)}\n【用户说】${input}`, { maxTokens: AGENT_MAX_TOKENS, timeoutMs: AGENT_TIMEOUT_MS });
    raw = r.text;
    truncated = r.truncated;
  } catch (e) {
    // 模型没连上：听得懂的那部分照办，没听懂的说出来；这一发的钱花没花只问 ai/failCharge
    const reason = briefArkReason(e, 80);
    const money = chargeNote(chargeOnFail(e), CHAT_TURN_TOKENS);
    const moneyLine = money?.line ?? "";
    const head = money
      ? t({ message: `有一截没听懂，问模型又没问成（${reason}）。${moneyLine}`, comment: "moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）：英文在它前面留一个空格" })
      : t`有一截没听懂，问模型又没问成（${reason}）。`;
    const landed = settle(local.ops);
    return landed
      ? { say: `${head}${unclearSay(local.unclear)}`, quote: false, ...landed, paid: false }
      : { say: `${head}${moved}`, quote: false, ...NOTHING, paid: false };
  }
  spendTokens(CHAT_TURN_TOKENS); // 请求成功才记（与 canvasAgent 同口径）；之后读不出来也不退
  const reply = truncated ? null : parseCutReply(raw);
  if (!reply) {
    // 模型没按约定的格式回（或者回话被截断）：一个操作都不办（宁可少办不乱办），并且**明说**没办。
    // ★ 原话只在它是一句人话时才转给人：模拟器实测，半截 JSON 里带着一句"好的，结尾收了一秒"，原样摆出来会被读成办成了
    const prose = !truncated && !/[{}[\]]/.test(raw) ? raw.replace(/\s+/g, " ").trim().slice(0, 160) : "";
    const why = truncated
      ? t`模型的回话被截断了，这一句一件都没办——换个短一点的说法再试`
      : t`模型没有按约定的格式回话，这一句一件都没办——换个说法再试`;
    return { say: prose, quote: prose !== "", ...NOTHING, refused: [why], paid: true };
  }
  // ★ 删片段是白名单里最伤的一种。人的话里没有任何"删"的意思、模型却回了删：不办（模型的输出是不可信输入）
  const ops = mentionsRemove(input) ? reply.ops : reply.ops.filter((o) => o.op !== "remove");
  const landed = settle(ops);
  if (!landed) return { say: moved, quote: false, ...NOTHING, paid: true };
  // 模型回了白名单之外的操作（重拍、换音色……）、不成形的、或者上面那种没人要的删：一条都没办，说出来 —— 它嘴上多半说的是"办好了"
  const dropped = reply.dropped + (reply.ops.length - ops.length);
  const refused = dropped > 0 ? [...landed.refused, t`模型还回了 ${dropped} 条这里办不了的操作，没有办`] : landed.refused;
  const done = landed.applied.length > 0 || landed.undo > 0 || landed.redo > 0 || landed.openAuto;
  return { say: reply.say || (done || refused.length > 0 ? "" : t`（没有可办的）`), quote: reply.say !== "", ...landed, refused, paid: true };
}
