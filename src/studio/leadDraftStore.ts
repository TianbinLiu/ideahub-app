// 跟着做 B「主角定妆 · 多镜头」向导的**全部**状态 —— 活在 store 里，不活在组件里（2026-10-04 第二期，方案 docs/guided-modes-design.md §二 B）。
//
// ★★ 为什么（与 customCardStore 文件头同一个理由）：向导里有两件花钱的长活 —— 现做主角（两张图，一两分钟）与 AI 拆镜头（一次对话）。
//   画布那一面的向导是个抽屉，点一下遮罩就关了；工坊那一面退回选法屏它就卸了。结果写进组件 state 的话，付过钱的分镜静默丢掉
//   （现做的主角已经落进卡片库，丢的是「选上它」这一步）。放在这里：关了再开原样还在；两个面开的是同一份（同一时刻只会开一个）。
//   现做主角另外领一张后台任务票（data/jobs）：人不在向导里时由胶囊通知。
// ★ 出完片（铺成段）只清这场戏与分镜（resetLeadScene），**留着主角**：下一段多半还是这几个人（「先把人定死」）。
// ★★ 表单是**谁的**（customCardStore 同一招）：换账号那一拍把上一个人的收进暗格、给新的人一份空的；在跑的长活回来时认
//   「开工那一拍是谁」，写回他自己的那份（换过人就写进暗格，不落进新账号的向导）。现做主角那一炉在 leadCast 里另有一道：
//   换过人就作废，不往新账号的卡片库里塞。
// ★ 依赖方向：data → store → 组件。这里认 studio/leadCast 与 structuredSkills（它们都不认组件）。
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import { chargeNote, chargeOnFail } from "../ai/failCharge";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import { CHAT_TURN_TOKENS } from "../data/economy";
import { currentRoute, startJob } from "../data/jobs";
import type { SceneNote } from "../data/sceneShots";
import { forgeLead, type LeadForged } from "./leadCast";
import { runSceneToShots } from "./structuredSkills";

/** 向导的四步：定主角 → 写这场戏 → AI 拆镜头 → 规格 · 出片 */
export type LeadStep = "cast" | "scene" | "shots" | "spec";
export const LEAD_STEPS: readonly LeadStep[] = ["cast", "scene", "shots", "spec"];

export interface LeadDraft {
  step: LeadStep;
  /** 选中的人物卡 id，第一个 = 主角 */
  castIds: string[];
  /** 这场戏（人的原话） */
  scene: string;
  /** 分镜（一段话：整体交代 + 「镜头N：…」，分镜表就地编辑它；出片提示词就是它） */
  script: string;
  /** 这份分镜是按哪一句戏拆的（戏改过之后提醒重拆；手写的分镜记成当时的戏） */
  scriptScene: string;
  /** 演示构建本地切的（不是模型写的） */
  scriptDemo: boolean;
  /** 分镜是 AI 拆的（false = 人选了「自己写镜头」）：那颗键说「重新拆」还是「AI 拆成镜头」 */
  scriptAi: boolean;
  /** 拆的时候顺手处理掉的事（界面说成句子） */
  notes: SceneNote[];
  splitting: boolean;
  splitErr: string;
  /** 时长；null = 缺省（12 秒，按档位的窗口夹） */
  durationSec: number | null;
  /** 「现做一个」那一块开着没有 */
  makerOpen: boolean;
  makerName: string;
  makerDesc: string;
  /** 画风芯片的原话；没挑 = null */
  makerStyle: string | null;
  /** 现做主角的进度句；"" = 没在画 */
  forging: string;
  forgeErr: string;
  /** 画成了、但有话要说（少画了一张 / 没同步到服务器 / 有图没转存） */
  forgeNote: string;
  /** 向导此刻挂着没有（后台任务票据此决定要不要弹通知） */
  mounted: boolean;
}

export function initialLeadDraft(castIds: string[] = []): LeadDraft {
  return {
    step: "cast",
    castIds,
    scene: "",
    script: "",
    scriptScene: "",
    scriptDemo: false,
    scriptAi: false,
    notes: [],
    splitting: false,
    splitErr: "",
    durationSec: null,
    makerOpen: false,
    makerName: "",
    makerDesc: "",
    makerStyle: null,
    forging: "",
    forgeErr: "",
    forgeNote: "",
    mounted: false,
  };
}

export const useLeadDraft = create<LeadDraft>()(() => initialLeadDraft());

/** store 里现在这份是谁的（第一次问时取「内存里这摊活的主人」） */
let draftOwner = "";
function ownerOfDraft(): string {
  if (!draftOwner) draftOwner = workOwner();
  return draftOwner;
}
/** 别的账号做到一半的向导（只在这一进程里，不落盘） */
const parked = new Map<string, LeadDraft>();

onOwnerSwitch((prev, next) => {
  const cur = useLeadDraft.getState();
  const dirty = cur.castIds.length > 0 || !!cur.scene || !!cur.script || cur.splitting || !!cur.forging || !!cur.makerDesc;
  if (dirty) parked.set(prev, { ...cur, mounted: false });
  const back = parked.get(next);
  parked.delete(next);
  useLeadDraft.setState({ ...(back ?? initialLeadDraft()), mounted: cur.mounted }, true);
  draftOwner = next;
});

/** 写回开工那一拍那个人的那份（换过账号就写进他的暗格，不落进新账号的向导） */
function writeFor(who: string, patch: Partial<LeadDraft>): void {
  if (who === ownerOfDraft()) {
    useLeadDraft.setState(patch);
    return;
  }
  const p = parked.get(who);
  if (p) parked.set(who, { ...p, ...patch });
}

function stateFor(who: string): LeadDraft | undefined {
  return who === ownerOfDraft() ? useLeadDraft.getState() : parked.get(who);
}

export function setLead(patch: Partial<LeadDraft>): void {
  useLeadDraft.setState(patch);
}

/** 铺成一段之后：清这场戏与分镜、回到第①步，**留着主角**（下一段多半还是这几个人） */
export function resetLeadScene(): void {
  const s = useLeadDraft.getState();
  useLeadDraft.setState({ ...initialLeadDraft(s.castIds), mounted: s.mounted }, true);
}

/**
 * 选上 / 取下一个人。第一个选上的是主角；满了（max）就不再加。
 * @param live 卡片库里还在的卡：选过又被删掉的卡不占名额（顺手从名单里清掉）
 */
export function toggleCast(id: string, max: number, live: ReadonlySet<string>): void {
  const ids = useLeadDraft.getState().castIds.filter((x) => live.has(x));
  if (ids.includes(id)) useLeadDraft.setState({ castIds: ids.filter((x) => x !== id) });
  else if (ids.length < max) useLeadDraft.setState({ castIds: [...ids, id] });
}

/**
 * 接着等一组九宫格画面时，把画那一组时选的人还原回来（只由 studio/gridDraftStore.resumeGroup 调）。
 * ★ 名单只活在内存里：App 被回收 / 重开之后是空的，而那一组的分镜写的就是这几个人 —— 不还原的话单格重画一张卡图都带不上、落段时人物卡挂空。
 * ★ 只在名单空着时还原：人这一次已经重新选过的话不替他改（缺了谁由 gridDraftStore.gridCastIssue 当面说、拦下重画与落段）。
 */
export function restoreCast(ids: readonly string[]): void {
  if (!ids.length || useLeadDraft.getState().castIds.length) return;
  useLeadDraft.setState({ castIds: [...ids] });
}

/** 把某个人换成主角（挪到第一个） */
export function makeLead(id: string): void {
  const s = useLeadDraft.getState();
  if (!s.castIds.includes(id)) return;
  useLeadDraft.setState({ castIds: [id, ...s.castIds.filter((x) => x !== id)] });
}

/**
 * AI 拆镜头（studio/structuredSkills.runSceneToShots：一次对话，请求成功那一拍扣一次）。结果写回开工那一拍那个人的向导。
 * ★ 钱上的话按错误**类型**说（ai/failCharge 一处）：形状不对 / 截断那几句自己就说了「已计费」，网络那一档由 chargeNote 补一句。
 */
export async function splitScene(o: { tierId: string; cast: string[]; durationSec: number }): Promise<void> {
  const s = useLeadDraft.getState();
  if (s.splitting) return;
  const who = ownerOfDraft();
  const scene = s.scene;
  useLeadDraft.setState({ splitting: true, splitErr: "" });
  try {
    const r = await runSceneToShots({ scene, cast: o.cast, tierId: o.tierId, durationSec: o.durationSec });
    writeFor(who, { script: r.text, scriptScene: scene, scriptDemo: r.demo, scriptAi: true, notes: r.notes });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), CHAT_TURN_TOKENS);
    const moneyLine = money?.line ?? "";
    writeFor(who, {
      splitErr: money
        ? t({
            message: `拆镜头没成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
        : why,
    });
  } finally {
    writeFor(who, { splitting: false });
  }
}

/** 现做主角画成之后要说的话（少画了一张 / 没同步到服务器 / 有图没转存 / 人选满了没选上）。都没有 = "" */
function forgedNote(r: LeadForged, picked: boolean, max: number): string {
  const sep = t({ message: "；", comment: "把几条说明连成一句时的分隔符" });
  const parts: string[] = [];
  if (r.minted < r.want && r.notes.length) parts.push(r.notes.join(sep));
  const name = r.card.name;
  if (r.unsynced) {
    const reason = r.unsynced;
    parts.push(t`「${name}」没同步到服务器（${reason}）——这次打开 App 期间能用，换设备或重开 App 就没了`);
  } else if (r.lostViews.length) {
    const list = r.lostViews.slice(0, 3).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
    const reason = r.lostReason ?? t`上传失败`;
    parts.push(t`${list}没能存到服务器（${reason}）——只留在这台设备上；想留住的话，回卡片详情页把它重新挂一次`);
  }
  if (!picked) parts.push(t`已经选满 ${max} 个人，「${name}」收进了卡片库但没选上——先取下一个再点它`);
  return parts.join(sep);
}

/**
 * 「现做一个主角」：画成就落进卡片库并选上（studio/leadCast.forgeLead）。领一张后台任务票：人不在向导里时胶囊通知。
 * @param castMax 一段最多几个人（满了就只收进卡片库、不选上，并说一句）
 * @param live 开工那一拍卡片库里还在的卡（选过又被删掉的不占名额，同 toggleCast）
 */
export async function forgeIntoCast(castMax: number, live: ReadonlySet<string>): Promise<void> {
  const s = useLeadDraft.getState();
  if (s.forging) return;
  const who = ownerOfDraft();
  const page = currentRoute();
  const job = startJob({ kind: "lead-forge", title: t`现做主角`, page, route: page, progress: t`准备中…` });
  useLeadDraft.setState({ forging: t`准备中…`, forgeErr: "", forgeNote: "" });
  try {
    const r = await forgeLead({
      name: s.makerName,
      desc: s.makerDesc,
      style: s.makerStyle,
      onProgress: (p) => {
        writeFor(who, { forging: p });
        job.update(p);
      },
    });
    const cur = stateFor(who);
    const ids = (cur?.castIds ?? []).filter((x) => live.has(x));
    const picked = ids.includes(r.card.id) || ids.length < castMax;
    writeFor(who, {
      castIds: picked && !ids.includes(r.card.id) ? [...ids, r.card.id] : ids,
      makerOpen: false,
      makerName: "",
      makerDesc: "",
      makerStyle: null,
      forgeNote: forgedNote(r, picked, castMax),
    });
    const name = r.card.name;
    job.done({ msg: t`「${name}」画好了，已收进卡片库`, silent: who === ownerOfDraft() && useLeadDraft.getState().mounted });
  } catch (e) {
    writeFor(who, { forgeErr: e instanceof Error ? e.message : String(e) });
    job.fail(t`现做主角没成，回去看原因`);
  } finally {
    writeFor(who, { forging: "" });
  }
}
