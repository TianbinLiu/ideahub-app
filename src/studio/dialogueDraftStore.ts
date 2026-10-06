// 跟着做 I「对话正反打」向导的**全部**状态 —— 活在 store 里，不活在组件里（2026-10-05 第一批，方案 docs/canvas-platforms-ecosystem-research.md §五）。
//
// ★★ 为什么（与 gridDraftStore / effectDraftStore 同一个理由）：向导里有花钱的长活 —— AI 写对白（一次对话）、画三个机位（三张图：
//   先画双人镜头、再拿它当参考并行画两个过肩，约一分钟）、单张重画。画布那一面的向导是个抽屉，点一下遮罩就关了；工坊那一面退回选法屏它就卸了。
//   结果写进组件 state 的话，付过钱的图静默丢掉。放在这里：关了再开原样还在。画三个机位另外领一张后台任务票（data/jobs）：人不在时由胶囊通知。
// ★ 人物用 leadDraftStore 的那一份（castIds，与 B / C / G 同一批人）：点选的先后就是 A / B（台词的 who 0 / 1）。这里只多一张场景卡。
// ★ 表单是**谁的**（gridDraftStore 同一招）：换账号那一拍把上一个人的收进暗格；画到一半换了账号，画好的图写回开工那个人的那份。
// ★ 落成几段之后**留着三个机位**（resetDialogueLines 只清对白）：同一个地方接着往下说，机位不用再画、不用再花钱；
//   换人 / 改整体交代 / 换画幅会把它们标成过期（data/dialogueShots.angleKey），界面提醒重画。
// ★ 依赖方向：data → store → 组件。这里认 ai / data / structuredSkills（它们都不认组件）。
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import { AI_REAL, chargeNote, chargeOnFail, generateFrame, shotGroupRefs } from "../ai";
import { canAfford, frozenNote, spendTokens } from "../data/account";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import {
  DIALOGUE_LINES_MAX,
  angleKey,
  angleMoment,
  angleRefLine,
  defaultAngle,
  lineSec,
  linePlot,
  type DialogueAngle,
  type DialogueLang,
  type DialogueLine,
  type DialogueNote,
} from "../data/dialogueShots";
import { CHAT_TURN_TOKENS, IMAGE_TOKENS, clampDuration, fmtTokens } from "../data/economy";
import { currentRoute, startJob } from "../data/jobs";
import { uid, type Card, type Proposal, type VideoAspect } from "../types";
import type { AppendSpec } from "./flowStore";
import { runDialogue } from "./structuredSkills";

/** 向导的四步：两个人和场景 → 写对白 → 画三个机位 → 一句一段 · 出片 */
export type DialogueStep = "cast" | "lines" | "angles" | "spec";
export const DIALOGUE_STEPS: readonly DialogueStep[] = ["cast", "lines", "angles", "spec"];

export interface AnglePanel {
  /** 这一张的 id：过肩照着哪一张双人镜头画的，认的就是它（双人镜头重画过 → 两个过肩过期） */
  id: string;
  /** 本机 dataURL；"" = 没画成 */
  image: string;
  /** 按哪一版画的（data/dialogueShots.angleKey）：人 / 整体交代 / 画幅 / 双人镜头变了 → 过期 */
  key: string;
  /** 正在画 */
  busy?: boolean;
  /** 这一张没画成的原因（整句人话） */
  err?: string;
}
export type AnglePanels = Record<DialogueAngle, AnglePanel | null>;
const NO_PANELS: AnglePanels = { two: null, faceA: null, faceB: null };

export interface DialogueDraft {
  step: DialogueStep;
  /** 场景卡（可选）。人在 leadDraftStore.castIds（前两个就是 A / B） */
  placeId: string | null;
  /** 情境（人的原话） */
  situation: string;
  /** 整体交代（地点、时间、光线）：画机位与每一段的视频提示词都用它 */
  lead: string;
  /** 对白是哪种语言写的（一句一段的视频提示词按它拼） */
  lang: DialogueLang;
  lines: DialogueLine[];
  /** 对白是按哪一句情境写的（情境改过之后提醒重写） */
  linesSituation: string;
  /** 对白是 AI 写的（false = 自己写的）：那颗键说「重新写」还是「AI 写」 */
  linesAi: boolean;
  linesDemo: boolean;
  notes: DialogueNote[];
  writing: boolean;
  writeErr: string;
  /** 画面的画幅（画之前定：画好的机位就是每一段的开头，画幅跟着它走） */
  aspect: VideoAspect | null;
  panels: AnglePanels;
  /** 正在画三个机位（进度句）；"" = 没在画（单张重画看各自的 busy） */
  drawing: string;
  drawErr: string;
  /** 画完要说的一句（参考图上的提示：某张卡没有图之类）；"" = 没什么要说 */
  drawNote: string;
  /** 向导此刻挂着没有（后台任务票据此决定要不要弹通知） */
  mounted: boolean;
}

export function initialDialogueDraft(): DialogueDraft {
  return {
    step: "cast",
    placeId: null,
    situation: "",
    lead: "",
    lang: "zh",
    lines: [],
    linesSituation: "",
    linesAi: false,
    linesDemo: false,
    notes: [],
    writing: false,
    writeErr: "",
    aspect: null,
    panels: NO_PANELS,
    drawing: "",
    drawErr: "",
    drawNote: "",
    mounted: false,
  };
}

export const useDialogueDraft = create<DialogueDraft>()(() => initialDialogueDraft());

/** store 里现在这份是谁的（第一次问时取「内存里这摊活的主人」） */
let draftOwner = "";
function ownerOfDraft(): string {
  if (!draftOwner) draftOwner = workOwner();
  return draftOwner;
}
/** 别的账号做到一半的向导（只在这一进程里，不落盘） */
const parked = new Map<string, DialogueDraft>();

onOwnerSwitch((prev, next) => {
  const cur = useDialogueDraft.getState();
  const dirty = !!cur.situation || cur.lines.length > 0 || cur.writing || !!cur.drawing || !!cur.placeId || Object.values(cur.panels).some(Boolean);
  if (dirty) parked.set(prev, { ...cur, mounted: false });
  const back = parked.get(next);
  parked.delete(next);
  useDialogueDraft.setState({ ...(back ?? initialDialogueDraft()), mounted: cur.mounted }, true);
  draftOwner = next;
});

/** 写回开工那一拍那个人的那份（换过账号就写进他的暗格，不落进新账号的向导） */
function writeFor(who: string, patch: Partial<DialogueDraft>): void {
  if (who === ownerOfDraft()) {
    useDialogueDraft.setState(patch);
    return;
  }
  const p = parked.get(who);
  if (p) parked.set(who, { ...p, ...patch });
}
function stateFor(who: string): DialogueDraft | undefined {
  return who === ownerOfDraft() ? useDialogueDraft.getState() : parked.get(who);
}
/** 改某一个机位（读最新的那份再写：两个过肩并行画完时不互相覆盖） */
function patchPanel(who: string, angle: DialogueAngle, f: (p: AnglePanel | null) => AnglePanel | null): void {
  const cur = stateFor(who);
  if (!cur) return;
  writeFor(who, { panels: { ...cur.panels, [angle]: f(cur.panels[angle]) } });
}

export function setDialogue(patch: Partial<DialogueDraft>): void {
  useDialogueDraft.setState(patch);
}

/** 选上 / 取下场景卡（只能挂一张：它当定场参考图，两张地点会打架） */
export function toggleDialoguePlace(id: string): void {
  const s = useDialogueDraft.getState();
  useDialogueDraft.setState({ placeId: s.placeId === id ? null : id });
}

/** 三个机位里有没有画好的（画好之后画幅就不许换了：每一张都是某几段的开头画面） */
export function anyAngle(d: Pick<DialogueDraft, "panels">): boolean {
  return Object.values(d.panels).some((p) => !!p?.image);
}

// ── 第②步：对白 ─────────────────────────────────────────────────────────

/**
 * AI 写对白（studio/structuredSkills.runDialogue：一次对话，请求成功那一拍扣一次）。结果写回开工那一拍那个人的向导。
 * ★ 三个机位已经画好时**整体交代沿用原来的**（机位是照着它画的；换一句交代它们就全过期了）—— 接着往下说的那种用法不该白花三张图的钱。
 *   要换地方，在这一步把整体交代改掉、再去第③步重画。
 * ★ 钱上的话按错误**类型**说（ai/failCharge 一处）：形状不对 / 截断那几句自己就说了「已计费」，网络那一档由 chargeNote 补一句。
 */
export async function writeLines(o: { names: readonly [string, string]; place: string }): Promise<void> {
  const s = useDialogueDraft.getState();
  if (s.writing || s.drawing) return;
  const who = ownerOfDraft();
  const situation = s.situation;
  useDialogueDraft.setState({ writing: true, writeErr: "" });
  try {
    const r = await runDialogue({ situation, names: o.names, place: o.place });
    const cur = stateFor(who);
    const keepLead = !!cur?.lead.trim() && !!cur && anyAngle(cur);
    writeFor(who, {
      lines: r.plan.lines,
      ...(keepLead ? {} : { lead: r.plan.lead }),
      lang: r.lang,
      notes: r.plan.notes,
      linesSituation: situation,
      linesDemo: r.demo,
      linesAi: true,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), CHAT_TURN_TOKENS);
    const moneyLine = money?.line ?? "";
    writeFor(who, {
      writeErr: money
        ? t({
            message: `写对白没成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
        : why,
    });
  } finally {
    writeFor(who, { writing: false });
  }
}

/** 不用 AI：两个空句子（第一个人先说），自己往里写 */
export function linesByHand(): void {
  const s = useDialogueDraft.getState();
  if (s.writing) return;
  useDialogueDraft.setState({
    lines: [
      { who: 0, text: "", act: "", angle: defaultAngle(0, 0) },
      { who: 1, text: "", act: "", angle: defaultAngle(1, 1) },
    ],
    notes: [],
    linesSituation: s.situation,
    linesDemo: false,
    linesAi: false,
  });
}

/**
 * 改某一句。换说话人时，机位若还是缺省的那个（拍原来说话的人）就跟着换成拍新说话的人 —— 人挑过的机位不动。
 */
export function editLine(i: number, patch: Partial<DialogueLine>): void {
  const s = useDialogueDraft.getState();
  const line = s.lines[i];
  if (!line) return;
  const next = { ...line, ...patch };
  if (patch.who !== undefined && patch.who !== line.who && patch.angle === undefined && line.angle === defaultAngle(i, line.who)) {
    next.angle = defaultAngle(i, patch.who);
  }
  const lines = [...s.lines];
  lines[i] = next;
  useDialogueDraft.setState({ lines });
}

export function removeLine(i: number): void {
  const s = useDialogueDraft.getState();
  if (i < 0 || i >= s.lines.length) return;
  useDialogueDraft.setState({ lines: s.lines.filter((_, k) => k !== i) });
}

/** 在末尾加一句：换另一个人说（两人轮流），机位拍他 */
export function addLine(): void {
  const s = useDialogueDraft.getState();
  if (s.lines.length >= DIALOGUE_LINES_MAX) return;
  const last = s.lines[s.lines.length - 1];
  const who: 0 | 1 = last ? (last.who === 0 ? 1 : 0) : 0;
  useDialogueDraft.setState({ lines: [...s.lines, { who, text: "", act: "", angle: defaultAngle(s.lines.length, who) }] });
}

// ── 第③步：三个机位 ─────────────────────────────────────────────────────

/** 画一个机位多少钱（与真扣同一个数：出图成功才扣一张） */
export const ANGLE_TOKENS = IMAGE_TOKENS;
/** 三个机位一起画最多多少（三张都画成才是这个数；没画成的那张不收） */
export const ANGLES_TOKENS = IMAGE_TOKENS * 3;

/**
 * 画一个机位：双人镜头只带卡图；过肩把画好的双人镜头放在图1（地方、光线、两人的衣服都照它），卡图从图2 起（ai/real.shotGroupRefs 的 before）。
 * 出图成功才扣一张（与「重画这一套」「单格重画」同口径）。失败抛错，由调用方说钱花没花。
 */
async function drawOne(
  angle: DialogueAngle,
  o: { cast: Card[]; place: Card | null; names: readonly [string, string]; lead: string; aspect: VideoAspect; base: AnglePanel | null; ask: string; notes: string[] },
): Promise<AnglePanel> {
  const base = angle !== "two" && o.base?.image ? o.base : null;
  const { refs, bind } = await shotGroupRefs({ cast: o.cast, place: o.place, panels: 1, before: base ? 1 : 0, onNote: (n) => o.notes.push(n) });
  const all = [...(base ? [base.image] : []), ...refs];
  const image = await generateFrame(`${angleMoment(angle, o.names, o.lead, o.ask)}${angleRefLine(bind, !!base)}`, {
    aspect: o.aspect,
    refs: all.length ? all : undefined,
  });
  if (AI_REAL) spendTokens(ANGLE_TOKENS);
  return { id: uid("ang"), image, key: angleKey(angle, o.names, o.lead, o.aspect, base?.id ?? "") };
}

/** 没画成的那一张：原因 + 钱扣没扣（ai/failCharge 一处） */
function drawFailLine(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  const money = chargeNote(chargeOnFail(e), ANGLE_TOKENS);
  const moneyLine = money?.line ?? "";
  return money
    ? t({
        message: `没画成：${why}。${moneyLine}`,
        comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
      })
    : t`没画成：${why}`;
}

/**
 * 画三个机位 —— 领一张后台任务票：先画双人镜头，画成了再拿它当参考**并行**画两个过肩。结果写回开工那一拍那个人的向导。
 * ★ 双人镜头没画成就停（两个过肩要照着它画，没有它就对不上）：只花了没画成的那一张的钱（多半没扣，按类型说）。
 * @param o.cast 两个人（按点的先后 = A / B），o.place 场景卡；画幅在 draft.aspect（画之前定）
 */
export async function drawAngles(o: { cast: Card[]; place: Card | null }): Promise<void> {
  const s = useDialogueDraft.getState();
  if (s.drawing || s.writing || !s.aspect || o.cast.length !== 2) return;
  if (AI_REAL && !canAfford(ANGLES_TOKENS)) {
    const price = fmtTokens(ANGLES_TOKENS);
    useDialogueDraft.setState({ drawErr: frozenNote() ?? t`画三个机位最多要 ${price} token，余额不够——去「我的」页充值` });
    return;
  }
  const who = ownerOfDraft();
  const page = currentRoute();
  const names: [string, string] = [o.cast[0].name, o.cast[1].name];
  const lead = s.lead;
  const aspect = s.aspect;
  const notes: string[] = [];
  const job = startJob({ kind: "dialogue-angles", title: t`对话正反打 · 画机位`, page, route: page, progress: t`先画双人镜头…` });
  const busy = (p: AnglePanel | null): AnglePanel => ({ id: p?.id ?? "", image: p?.image ?? "", key: p?.key ?? "", busy: true });
  writeFor(who, { drawing: t`先画双人镜头…`, drawErr: "", drawNote: "", panels: { two: busy(s.panels.two), faceA: busy(s.panels.faceA), faceB: busy(s.panels.faceB) } });
  const settle = (angle: DialogueAngle, before: AnglePanel | null, err: string) =>
    patchPanel(who, angle, () => (before?.image ? { ...before, busy: undefined, err } : { id: "", image: "", key: "", err }));
  try {
    let two: AnglePanel;
    try {
      two = await drawOne("two", { cast: o.cast, place: o.place, names, lead, aspect, base: null, ask: "", notes });
      patchPanel(who, "two", () => two);
    } catch (e) {
      const err = drawFailLine(e);
      settle("two", s.panels.two, err);
      // 两个过肩没开画：退回原样（原来有图就留着原来的图）
      patchPanel(who, "faceA", () => (s.panels.faceA ? { ...s.panels.faceA, busy: undefined } : null));
      patchPanel(who, "faceB", () => (s.panels.faceB ? { ...s.panels.faceB, busy: undefined } : null));
      writeFor(who, { drawErr: t`双人镜头${err}——两个过肩要照着它画，先没开画` });
      job.fail(t`对话正反打的机位没画成，回去看原因`);
      return;
    }
    const line = t`双人镜头画好了，正在画两个过肩…`;
    writeFor(who, { drawing: line });
    job.update(line);
    const results = await Promise.allSettled(
      (["faceA", "faceB"] as const).map(async (angle) => {
        try {
          const p = await drawOne(angle, { cast: o.cast, place: o.place, names, lead, aspect, base: two, ask: "", notes });
          patchPanel(who, angle, () => p);
        } catch (e) {
          settle(angle, s.panels[angle], drawFailLine(e));
          throw e;
        }
      }),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    const sep = t({ message: "；", comment: "把几条说明连成一句时的分隔符" });
    writeFor(who, { drawNote: notes.join(sep) });
    if (failed) {
      writeFor(who, { drawErr: t`有 ${failed} 个过肩没画成——点那一张单独重画` });
      job.fail(t`对话正反打有 ${failed} 个机位没画成，回去看原因`);
      return;
    }
    job.done({ msg: t`对话正反打的三个机位画好了`, silent: who === ownerOfDraft() && !!stateFor(who)?.mounted });
  } finally {
    writeFor(who, { drawing: "" });
  }
}

/**
 * 单张重画（一张图）。过肩照着现在那张双人镜头画（没有双人镜头就先别画过肩：对不上）。
 * @param ask 人补的一句要求（「沈舟戴着眼镜」）；空 = 照原样重画
 */
export async function redrawAngle(angle: DialogueAngle, o: { cast: Card[]; place: Card | null; ask: string }): Promise<void> {
  const s = useDialogueDraft.getState();
  const before = s.panels[angle];
  if (s.drawing || !s.aspect || o.cast.length !== 2 || before?.busy) return;
  const who = ownerOfDraft();
  const base = s.panels.two;
  if (angle !== "two" && !base?.image) {
    patchPanel(who, angle, (p) => ({ id: p?.id ?? "", image: p?.image ?? "", key: p?.key ?? "", err: t`先把双人镜头画出来：过肩要照着它画` }));
    return;
  }
  if (AI_REAL && !canAfford(ANGLE_TOKENS)) {
    const price = fmtTokens(ANGLE_TOKENS);
    patchPanel(who, angle, (p) => ({ id: p?.id ?? "", image: p?.image ?? "", key: p?.key ?? "", err: frozenNote() ?? t`重画一张要 ${price} token，余额不够——去「我的」页充值` }));
    return;
  }
  const names: [string, string] = [o.cast[0].name, o.cast[1].name];
  const notes: string[] = [];
  patchPanel(who, angle, (p) => ({ id: p?.id ?? "", image: p?.image ?? "", key: p?.key ?? "", busy: true }));
  try {
    const p = await drawOne(angle, { cast: o.cast, place: o.place, names, lead: s.lead, aspect: s.aspect, base, ask: o.ask, notes });
    patchPanel(who, angle, () => p);
    if (notes.length) writeFor(who, { drawNote: notes.join(t({ message: "；", comment: "把几条说明连成一句时的分隔符" })) });
  } catch (e) {
    const err = drawFailLine(e);
    patchPanel(who, angle, () => (before?.image ? { ...before, busy: undefined, err } : { id: "", image: "", key: "", err }));
  }
}

// ── 第④步：落段 ─────────────────────────────────────────────────────────

/** 落成几段之后：清对白与情境、回到第②步，**留着**场景卡、整体交代与三个机位（同一个地方接着往下说，机位不用再画） */
export function resetDialogueLines(): void {
  const s = useDialogueDraft.getState();
  useDialogueDraft.setState({
    situation: "",
    lines: [],
    linesSituation: "",
    linesAi: false,
    linesDemo: false,
    notes: [],
    writeErr: "",
    drawErr: "",
    step: "lines",
    mounted: s.mounted,
  });
}

/** 这一句缺省几秒（念完要多久 + 前后留白，按档位的窗口夹） */
export function lineDurationOf(line: Pick<DialogueLine, "text">, tierId: string): number {
  return clampDuration(lineSec(line.text), tierId);
}

/**
 * 对白 → 交给 flowStore 落段的那几份（一句一段，按对白的先后）。flowStore.appendSpecs 落段、appendSpecsQuote 报价读的是同一份。
 * ★ 每一句落成一段**参考图直出段**（direct，出片规则与 A / B / C 同一份 data/drawPlan）：那一句的机位画面当开头帧、上锁（pinned.first），
 *   **不承接**上一段（chain:false：正反打本来就是切镜头；承接会拿上一段的尾帧把机位画面整张顶掉）。
 * ★ 素材挂两个人 + 场景卡：三个机位里两个人都在画面上（过肩那一位是背影），声音样本只带说话的那个人（segmentGen 按台词认，不在这里挑）。
 * ★ 没写台词的句子、机位还没画好 / 过期的句子不落（界面上那颗键在这种时候灰着、并说清哪一句）。
 * ★ 方案标题存进作品（VideoSegment.title），按作者当时的界面语言定下来（与 B / C 同一条先例）。
 */
export function dialogueAppendSpecs(
  d: Pick<DialogueDraft, "lines" | "panels" | "lead" | "lang" | "situation">,
  o: { cast: Card[]; place: Card | null; tierId: string; aspect: VideoAspect },
): AppendSpec[] {
  if (o.cast.length !== 2) return [];
  const names: [string, string] = [o.cast[0].name, o.cast[1].name];
  const materials = [...o.cast, ...(o.place ? [o.place] : [])];
  return d.lines.flatMap((line, i) => {
    const panel = d.panels[line.angle];
    if (!line.text.trim() || !panel?.image) return [];
    const n = i + 1;
    const p: Proposal = {
      id: uid("prop"),
      title: t`对话正反打 · 第 ${n} 句`,
      plot: linePlot(line, names, d.lead, d.lang),
      firstFrame: panel.image,
      lastFrame: "",
      durationSec: lineDurationOf(line, o.tierId),
      pinned: { first: true },
    };
    const spec: AppendSpec = {
      proposals: [p],
      chosenId: p.id,
      materials,
      videoTier: o.tierId,
      aspect: o.aspect,
      requirement: d.situation.trim() || d.lead.trim(),
      chain: false,
      direct: true,
    };
    return [spec];
  });
}
