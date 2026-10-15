// 「剧本 → 分镜」「按主题改写」两张付费技能面板的**全部**状态 —— 活在 store 里，不活在组件里
// （2026-10-15 教材人格评审 norman-interaction-1 / nygard-reliability-4）。
//
// ★★ 为什么：两张面板等的是模型回话（skillChat 最长 170 秒），钱在请求成功那一拍按次扣（structuredSkills 的 spendTokens，
//   服务端按 CHAT_TURN_TOKENS 收）。此前 plan / busy / step / err 都是组件 useState，而抽屉的遮罩与 ✕ 不判 busy：
//   等回话的那几十秒里点到外面一下，抽屉卸载、回包的 setState 打在已经不存在的组件上 —— 花了钱的分镜 / 改写**静默丢掉**，
//   重开是一张空的输入框，再点一次再扣一次。放在这里之后：请求照跑、结果写进 store，面板只订阅；收起再打开原样接回
//   （连第几步、贴进去的剧本都在）；人不在面板上时由胶囊（data/jobs）说它在跑、好了没。
// ★ 形状照 studio/effectDraftStore：`mounted` 给结局分叉（面板挂着 → 面板自己画；不在 → 胶囊通知）；表单按账号分开
//   （onOwnerSwitch 收进暗格 / 还回来，2.47 设备多账号隔离那条），回包写回开工那一拍那个人的那份（writeFor）。
// ★ 票上的 page 跟着面板走（JobHandle.setPage）：面板挂着时页面自己画进度、胶囊不画；收起之后哪怕还在同一条路由
//   （画布是 StudioPage 的浮层，路由多半是 /studio）胶囊也要出来 —— 「收起但不丢」要让人看得见它还在跑。
//   回程路线用发起那一刻的 currentRoute()（别写死 /flow：画布可能开在 /studio 上）。
// ★ 钱上的话只走 ai/failCharge（chargeOnFail 认类型：没等到回包说「可能已扣」、2xx 却读不出来说「已计费」、
//   余额门 / 形状检查那种裸 Error 一个字不加）。
// ★ 依赖方向：data → store → 组件。这里认 ai / data / structuredSkills（它认 flowStore）；两张面板认这里，反过来绝不。
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import { chargeNote, chargeOnFail } from "../ai";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import { CHAT_TURN_TOKENS } from "../data/economy";
import { currentRoute, heartbeatJob, startJob, type JobHandle } from "../data/jobs";
import { useFlow } from "./flowStore";
import {
  SCRIPT_TO_SHOTS,
  THEME_REWRITE,
  rewritableSegs,
  runScriptToShots,
  runThemeRewrite,
  type RewritePlan,
  type ShotPlan,
  type SkillStepKind,
} from "./structuredSkills";

/** 两张面板共有的那几格 */
interface SheetBase {
  step: SkillStepKind;
  busy: boolean;
  err: string;
  /** 面板此刻挂着没有（见文件头 ★） */
  mounted: boolean;
}

export interface ScriptSkillDraft extends SheetBase {
  script: string;
  plan: ShotPlan | null;
}

export interface ThemeSkillDraft extends SheetBase {
  theme: string;
  plan: RewritePlan | null;
  /** 送去改写那一刻的原文（对照用）：世界会变，确认时按 nodeId 再核一遍 */
  before: ReadonlyMap<string, { title: string; plot: string }>;
  /** 勾着要写回的段（nodeId）。随结果一起落在这里：收起再打开，勾过的不丢 */
  picked: ReadonlySet<string>;
}

export function initialScriptSkill(): ScriptSkillDraft {
  return { script: "", step: "input", plan: null, busy: false, err: "", mounted: false };
}

export function initialThemeSkill(): ThemeSkillDraft {
  return { theme: "", step: "input", plan: null, before: new Map(), picked: new Set(), busy: false, err: "", mounted: false };
}

/**
 * 一张面板的 store + 按账号分开的暗格（两张面板同一副骨架，别各抄一份 onOwnerSwitch）。
 * `dirty` 判「有没有做到一半的东西」—— 空表单不必收进暗格。
 */
function makeSheet<T extends SheetBase>(initial: () => T, dirty: (s: T) => boolean) {
  const use = create<T>()(() => initial());
  /** store 里现在这份是谁的（第一次问时取「内存里这摊活的主人」） */
  let owner = "";
  const ownerOf = (): string => {
    if (!owner) owner = workOwner();
    return owner;
  };
  /** 别的账号做到一半的（只在这一进程里，不落盘 —— 这两张面板本来就不落盘） */
  const parked = new Map<string, T>();
  onOwnerSwitch((prev, next) => {
    const cur = use.getState();
    if (dirty(cur) || cur.busy) parked.set(prev, { ...cur, mounted: false });
    const back = parked.get(next);
    parked.delete(next);
    use.setState({ ...(back ?? initial()), mounted: cur.mounted }, true);
    owner = next;
  });
  /** 写回开工那一拍那个人的那份（换过账号就写进他的暗格，不落进新账号的面板） */
  const writeFor = (who: string, patch: Partial<T>): void => {
    if (who === ownerOf()) {
      use.setState(patch);
      return;
    }
    const p = parked.get(who);
    if (p) parked.set(who, { ...p, ...patch });
  };
  /** 发起的人就是现在这个人、而且面板挂着 —— 结局由面板自己画，票静默撤掉 */
  const sheetOpen = (who: string): boolean => who === ownerOf() && use.getState().mounted;
  /** 清空重来（铺成 / 写回之后：留着的话下次打开还是这份旧结果的确认屏）。在跑时不清；`mounted` 原样保留 */
  const reset = (): void => {
    const cur = use.getState();
    if (cur.busy) return;
    use.setState({ ...initial(), mounted: cur.mounted }, true);
  };
  return { use, ownerOf, writeFor, sheetOpen, reset };
}

const scriptSheet = makeSheet<ScriptSkillDraft>(initialScriptSkill, (s) => !!s.script || !!s.plan || !!s.err);
const themeSheet = makeSheet<ThemeSkillDraft>(initialThemeSkill, (s) => !!s.theme || !!s.plan || !!s.err);

export const useScriptSkill = scriptSheet.use;
export const useThemeSkill = themeSheet.use;

export function setScriptSkill(patch: Partial<ScriptSkillDraft>): void {
  useScriptSkill.setState(patch);
}
export function setThemeSkill(patch: Partial<ThemeSkillDraft>): void {
  useThemeSkill.setState(patch);
}
export const resetScriptSkill = scriptSheet.reset;
export const resetThemeSkill = themeSheet.reset;

/** 在途那一发的票（一张面板同时只跑一发：run 里 busy 就早退）。面板挂 / 卸时把票上的「发起页」换掉 */
let scriptJob: JobHandle | null = null;
let themeJob: JobHandle | null = null;

/** 面板挂上 / 收起（两张面板的 useEffect 各调一次）：记 mounted，并把票上的发起页换掉（见文件头「票上的 page 跟着面板走」） */
export function noteScriptSheet(open: boolean): void {
  useScriptSkill.setState({ mounted: open });
  scriptJob?.setPage(open ? currentRoute() : undefined);
}
export function noteThemeSheet(open: boolean): void {
  useThemeSkill.setState({ mounted: open });
  themeJob?.setPage(open ? currentRoute() : undefined);
}

/** 失败那句话：原因 + 钱上的那句（只问 ai/failCharge；回 null 时一个字不加） */
function failText(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  const money = chargeNote(chargeOnFail(e), CHAT_TURN_TOKENS);
  const moneyLine = money?.line ?? "";
  return money
    ? t({
        message: `${why}。${moneyLine}`,
        comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
      })
    : why;
}

/**
 * 跑「剧本 → 分镜」到确认之前（门禁 / 模型 / 扣钱 / 形状检查都在 structuredSkills.runScriptToShots，这里只管状态与票）。
 * @param tierId 铺出来的段用哪一档（面板按第一段算好传进来，与铺段那一步同一个值）
 */
export async function runScriptSkill(tierId: string): Promise<void> {
  const s = useScriptSkill.getState();
  if (s.busy) return;
  const who = scriptSheet.ownerOf();
  const page = currentRoute();
  const job = startJob({ kind: "skill-shots", title: i18n._(SCRIPT_TO_SHOTS.title), page, route: page, progress: t`拆分镜中…` });
  scriptJob = job;
  const stop = heartbeatJob(job, t`拆分镜中`);
  scriptSheet.writeFor(who, { busy: true, err: "", plan: null, step: "input" });
  try {
    const p = await runScriptToShots(s.script, tierId, (k) => scriptSheet.writeFor(who, { step: k }));
    scriptSheet.writeFor(who, { plan: p, step: "confirm", busy: false });
    if (scriptSheet.sheetOpen(who)) job.done({ silent: true });
    else job.done({ msg: t`分镜拆好了：回画布，从「/」面板打开「剧本 → 分镜」接着铺`, route: page });
  } catch (e) {
    scriptSheet.writeFor(who, { busy: false, err: failText(e), step: "input" });
    if (scriptSheet.sheetOpen(who)) job.done({ silent: true });
    else job.fail(t`分镜没拆成，回去看原因`, page);
  } finally {
    stop();
    if (scriptJob === job) scriptJob = null;
  }
}

/**
 * 跑「按主题改写」到确认之前。送去改写的段在**这一拍**从流水线上取（rewritableSegs），原文随结果一起存下来对照。
 */
export async function runThemeSkill(): Promise<void> {
  const s = useThemeSkill.getState();
  if (s.busy) return;
  const who = themeSheet.ownerOf();
  const page = currentRoute();
  const snapshot = rewritableSegs(useFlow.getState().nodes);
  const job = startJob({ kind: "skill-rewrite", title: i18n._(THEME_REWRITE.title), page, route: page, progress: t`改写中…` });
  themeJob = job;
  const stop = heartbeatJob(job, t`改写中`);
  themeSheet.writeFor(who, { busy: true, err: "", plan: null, step: "input" });
  try {
    const p = await runThemeRewrite(s.theme, snapshot, (k) => themeSheet.writeFor(who, { step: k }));
    themeSheet.writeFor(who, {
      plan: p,
      before: new Map(snapshot.map((x) => [x.nodeId, { title: x.title, plot: x.plot }])),
      picked: new Set(p.items.map((it) => it.nodeId)),
      step: "confirm",
      busy: false,
    });
    if (themeSheet.sheetOpen(who)) job.done({ silent: true });
    else job.done({ msg: t`剧本改写好了：回画布，从「/」面板打开「按主题改写」对照后写回`, route: page });
  } catch (e) {
    themeSheet.writeFor(who, { busy: false, err: failText(e), step: "input" });
    if (themeSheet.sheetOpen(who)) job.done({ silent: true });
    else job.fail(t`剧本没改成，回去看原因`, page);
  } finally {
    stop();
    if (themeJob === job) themeJob = null;
  }
}
