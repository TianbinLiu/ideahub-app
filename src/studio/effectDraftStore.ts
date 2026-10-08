// 跟着做 G「特效同款」向导的**全部**状态 —— 活在 store 里，不活在组件里（2026-10-05 第一批，方案 docs/canvas-platforms-ecosystem-research.md §五）。
//
// ★★ 为什么（与 gridDraftStore / leadDraftStore 同一个理由）：向导里有一件花钱的长活 —— 画关键帧（一张图 20~30 秒）。画布那一面的向导是个抽屉，
//   点一下遮罩就关了；工坊那一面退回选法屏它就卸了。结果写进组件 state 的话，付过钱的那张图静默丢掉。放在这里：关了再开原样还在。
// ★ 人物用 leadDraftStore 的那一份（castIds，与 B / C 同一批人）：点选的先后就是 {A} / {B}。产品另有两条路：道具卡，或者传一张照片。
// ★ 表单是**谁的**（gridDraftStore 同一招）：换账号那一拍把上一个人的收进暗格；画到一半换了账号，画好的图写回开工那个人的那份。
// ★ 依赖方向：data → store → 组件。这里认 ai / data（它们都不认组件）。
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import { AI_REAL, chargeNote, chargeOnFail, generateFrame, shotGroupRefs } from "../ai";
import { canAfford, frozenNote, spendTokens } from "../data/account";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import { IMAGE_TOKENS, fmtTokens } from "../data/economy";
import { currentRoute, startJob } from "../data/jobs";
import { PRODUCT_PHOTO_BIND, effectById, effectKeyframe, effectMotion, productRefLine, type EffectPreset } from "../data/effectPresets";
import { panelRefLine } from "../data/gridShots";
import { uid, type Card, type Proposal, type VideoAspect } from "../types";
import type { AppendSpec } from "./flowStore";

/** 向导的三步：挑特效 → 挑主角 → 关键帧 · 出片（真人档没有关键帧，第三步只剩出片） */
export type EffectStep = "pick" | "cast" | "go";
export const EFFECT_STEPS: readonly EffectStep[] = ["pick", "cast", "go"];

export interface EffectDraft {
  step: EffectStep;
  presetId: string | null;
  /** 产品：道具卡（与 productImage 二选一，选了卡就清掉照片，反之亦然） */
  productCardId: string | null;
  /** 产品：传的一张照片（本机 dataURL） */
  productImage: string;
  aspect: VideoAspect | null;
  /** 时长；null = 预设的缺省（按档位的窗口夹） */
  durationSec: number | null;
  /** 关键帧（本机 dataURL）；"" = 还没画 */
  keyframe: string;
  /** 关键帧是按哪一版画的（effectKeyOf）：换了预设 / 主角（产品预设是产品）/ 画幅就过期，界面提醒重画 */
  keyframeKey: string;
  drawing: boolean;
  drawErr: string;
  /** 向导此刻挂着没有 */
  mounted: boolean;
}

export function initialEffectDraft(): EffectDraft {
  return {
    step: "pick",
    presetId: null,
    productCardId: null,
    productImage: "",
    aspect: null,
    durationSec: null,
    keyframe: "",
    keyframeKey: "",
    drawing: false,
    drawErr: "",
    mounted: false,
  };
}

export const useEffectDraft = create<EffectDraft>()(() => initialEffectDraft());

let draftOwner = "";
function ownerOfDraft(): string {
  if (!draftOwner) draftOwner = workOwner();
  return draftOwner;
}
const parked = new Map<string, EffectDraft>();

onOwnerSwitch((prev, next) => {
  const cur = useEffectDraft.getState();
  const dirty = !!cur.presetId || !!cur.keyframe || cur.drawing || !!cur.productImage || !!cur.productCardId;
  if (dirty) parked.set(prev, { ...cur, mounted: false });
  const back = parked.get(next);
  parked.delete(next);
  useEffectDraft.setState({ ...(back ?? initialEffectDraft()), mounted: cur.mounted }, true);
  draftOwner = next;
});

function writeFor(who: string, patch: Partial<EffectDraft>): void {
  if (who === ownerOfDraft()) {
    useEffectDraft.setState(patch);
    return;
  }
  const p = parked.get(who);
  if (p) parked.set(who, { ...p, ...patch });
}

export function setEffect(patch: Partial<EffectDraft>): void {
  useEffectDraft.setState(patch);
}

/**
 * 挑一个特效：换了预设就清掉旧的关键帧（画的是另一个画面）与时长（回到新预设的缺省）。
 * ★ 画幅**不**换成预设的缺省（`EffectPreset.aspect` 今天没人读）：沿用向导眼下的那个（传进来的 aspect = 人改过的，或者接上一段的），
 *   这样一条片子里前后几段的画幅不会被一个预设悄悄翻成横的。真要让预设的画幅生效是产品决定，不是改这一处注释。
 */
export function pickPreset(p: EffectPreset, aspect: VideoAspect): void {
  const s = useEffectDraft.getState();
  if (s.drawing) return;
  const same = s.presetId === p.id;
  useEffectDraft.setState({
    presetId: p.id,
    step: "cast",
    ...(same ? {} : { keyframe: "", keyframeKey: "", drawErr: "", durationSec: null, aspect }),
  });
}

export function setProductCard(id: string | null): void {
  useEffectDraft.setState({ productCardId: id, productImage: id ? "" : useEffectDraft.getState().productImage });
}
export function setProductImage(dataUrl: string): void {
  useEffectDraft.setState({ productImage: dataUrl, productCardId: dataUrl ? null : useEffectDraft.getState().productCardId });
}

/**
 * 关键帧是按哪一版画的：预设 + 主角（按点选的先后）+ 产品 + 画幅。照片只取长度与头尾（整串 dataURL 太长，比较没有意义）。
 * ★ 产品预设不算人物：它的关键帧只喂道具卡 / 照片（drawKeyframe），落段也只挂道具卡（effectAppendSpec）—— 人进不了图也进不了段。
 *   而 cast 是 leadDraftStore 那一份、B / C / I 共用：算进来的话，去别的向导点了个人再回来，付过钱的产品关键帧就被判成过期、两颗出片键都灰掉，
 *   产品和画幅一点没变也只能花钱重画。drawKeyframe 与向导判过期都走这一个函数，改这一处两边一起对。
 */
export function effectKeyOf(d: Pick<EffectDraft, "presetId" | "productCardId" | "productImage" | "aspect">, cast: readonly Card[]): string {
  const photo = d.productImage ? `${d.productImage.length}:${d.productImage.slice(-24)}` : "";
  const castIds = effectById(d.presetId)?.subject === "product" ? [] : cast.map((c) => c.id);
  return JSON.stringify([d.presetId, castIds, d.productCardId, photo, d.aspect]);
}

/** 画一张关键帧多少钱（与真扣同一个数：出图成功才扣一张） */
export const KEYFRAME_TOKENS = IMAGE_TOKENS;

/**
 * 画关键帧：把主角放进预设的那一刻。人物走 shotGroupRefs（卡图直通分配 + 「图1 是谁」逐张对，九宫格单格重画同一条），
 * 道具卡同样走它、点名句换成产品那一句；传的照片直接当图1。
 * ★ 出图成功才扣（与「重画这一套」「单格重画」同口径）；失败时钱扣没扣只问 ai/failCharge。
 * ★ 领一张后台任务票（data/jobs）：一张图二三十秒，人可能先关了抽屉 —— 画好 / 没画成由胶囊说，人就在向导里时不弹。
 */
export async function drawKeyframe(o: { cast: Card[]; productCard: Card | null }): Promise<void> {
  const s = useEffectDraft.getState();
  const preset = effectById(s.presetId);
  if (!preset || s.drawing || !s.aspect) return;
  if (AI_REAL && !canAfford(KEYFRAME_TOKENS)) {
    const price = fmtTokens(KEYFRAME_TOKENS);
    useEffectDraft.setState({ drawErr: frozenNote() ?? t`画关键帧要 ${price} token，余额不够——去「我的」页充值` });
    return;
  }
  const who = ownerOfDraft();
  const key = effectKeyOf(s, o.cast);
  const aspect = s.aspect;
  const page = currentRoute();
  const job = startJob({ kind: "effect-keyframe", title: t`特效同款 · 画关键帧`, page, route: page, progress: t`正在画…` });
  writeFor(who, { drawing: true, drawErr: "" });
  try {
    const names = { a: o.cast[0]?.name, b: o.cast[1]?.name, product: o.productCard?.name };
    let refs: string[] = [];
    let line = "";
    if (preset.subject === "product") {
      if (o.productCard) {
        const r = await shotGroupRefs({ cast: [o.productCard], place: null, panels: 1 });
        refs = r.refs;
        line = productRefLine(r.bind);
      } else if (s.productImage) {
        refs = [s.productImage];
        line = productRefLine(PRODUCT_PHOTO_BIND);
      }
    } else {
      const r = await shotGroupRefs({ cast: o.cast, place: null, panels: 1 });
      refs = r.refs;
      line = panelRefLine(r.bind);
    }
    const image = await generateFrame(`${effectKeyframe(preset, names)}${line}`, { aspect, refs: refs.length ? refs : undefined });
    if (AI_REAL) spendTokens(KEYFRAME_TOKENS);
    writeFor(who, { keyframe: image, keyframeKey: key, drawing: false });
    job.done({ msg: t`特效同款的关键帧画好了`, silent: who === ownerOfDraft() && useEffectDraft.getState().mounted });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), KEYFRAME_TOKENS);
    const moneyLine = money?.line ?? "";
    writeFor(who, {
      drawing: false,
      drawErr: money
        ? t({
            message: `关键帧没画成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
        : t`关键帧没画成：${why}`,
    });
    job.fail(t`特效同款的关键帧没画成，回去看原因`);
  }
}

/** 落成一段之后：清掉这一次的关键帧与产品、回到第①步（人在 leadDraftStore，本来就留着） */
export function resetEffect(): void {
  const s = useEffectDraft.getState();
  useEffectDraft.setState({ ...initialEffectDraft(), mounted: s.mounted }, true);
}

/**
 * 交给 flowStore 落段的那一份（appendSpecs 落段、appendSpecsQuote 报价读的是同一份）。
 * ★ 落成一段**参考图直出段**（direct，出片规则与 A / B / C 同一份 data/drawPlan）：关键帧当开头帧、上锁（pinned.first —— AI 重画不许动它）、
 *   **不承接**上一段（chain:false：承接会拿上一段的尾帧把关键帧整张顶掉；特效本来就是一条独立的片子）。
 * ★ 真人档（real）没有关键帧：开头帧留空，segmentGen 的真人档那一支拿真人卡的照片起拍（「真人卡的照片起拍、写一句话出片」，A 在真人档上就是这样）。
 * ★ 素材：人物卡 / 道具卡照挂（2.x 两档会把卡图与关键帧一起发，锁住长相）；传的产品照片不挂（它只喂关键帧，关键帧里已经有它）。
 * @param o.title 方案标题（存进作品，按作者当时的界面语言定下来，由向导传进来 —— 预设的名字是界面文案，不在这一层）
 */
export function effectAppendSpec(
  d: Pick<EffectDraft, "presetId" | "keyframe">,
  o: { cast: Card[]; productCard: Card | null; tierId: string; aspect: VideoAspect; durationSec: number; real: boolean; title: string },
): AppendSpec | null {
  const preset = effectById(d.presetId);
  if (!preset) return null;
  if (!o.real && !d.keyframe) return null;
  const names = { a: o.cast[0]?.name, b: o.cast[1]?.name, product: o.productCard?.name };
  const p: Proposal = {
    id: uid("prop"),
    title: o.title,
    plot: effectMotion(preset, names),
    firstFrame: o.real ? "" : d.keyframe,
    lastFrame: "",
    durationSec: o.durationSec,
    ...(o.real ? {} : { pinned: { first: true } }),
  };
  const materials = preset.subject === "product" ? (o.productCard ? [o.productCard] : []) : o.cast;
  return {
    proposals: [p],
    chosenId: p.id,
    ...(materials.length ? { materials } : {}),
    videoTier: o.tierId,
    aspect: o.aspect,
    requirement: o.title,
    chain: false,
    direct: true,
  };
}
