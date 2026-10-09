// 跟着做 C「九宫格分镜」向导的**全部**状态 —— 活在 store 里，不活在组件里（2026-10-05 第三期，方案 docs/guided-modes-design.md §二 C、§七）。
//
// ★★ 为什么（与 leadDraftStore / customCardStore 同一个理由）：向导里有三件花钱的长活 —— AI 写分镜（一次对话）、出一组画面
//   （组图，6 张约 4 分钟、9 张约 6 分钟）、单格重画（一张图）。画布那一面的向导是个抽屉，点一下遮罩就关了；工坊那一面退回选法屏它就卸了。
//   结果写进组件 state 的话，付过钱的画面静默丢掉。放在这里：关了再开原样还在；两个面开的是同一份（同一时刻只会开一个）。
//   出一组画面另外领一张后台任务票（data/jobs）：人不在向导里时由胶囊通知。
// ★★ 一组画面画到一半 App 被系统回收 / 重开：服务端那一组照样画完、照样按张结算（契约「组图」）。受理那一拍把任务号连同那一版分镜
//   记进 localStorage（按账号分开），下次打开向导就接着等、把图取回来 —— 不记的话那几张已经付过钱的图就找不回来了。
//   dev 直连方舟（流式）的那种接不回来，不记。
//   ★★ 这份记录在，就**不再开新的一组**（drawGroup 先接着等它，向导那颗键也换成「接着等上一组」）：受理之后轮询断了 / 等满 22 分钟，
//   都只是「这一头没查到」，服务端那一组照样在画、按张结算 —— 原来那条路说「画面没出成」、groupId 也不清，这一进程里再也不自动接，
//   人一点「整组重出」就另开一组再付一次钱、把记录盖掉（2.62 发版评审抓到）。受理那一发没收到回包、又没问到服务端收没收到时，
//   也记一份（任务号空着），下次接着等时先去问（adoptLost）。
//   ★ 出口有两个，都要当面说清钱：「放弃上一组」（discardParkedGroup：那一组照样按画出来的张数结算、这里不再取回）与落段收尾
//   （resetGridScene：第⑤步铺成之前那一页先说「铺成之后就不再取回」）—— 只有「接着等」一条路的话，接回失败之后人重写过的分镜
//   （付过一次写分镜的钱）只能被换回去，任务号空着、服务端又一直问不到的那种还会把出一组整整挡 23 小时（2.62 发版评审第二轮抓到）。
// ★ 人物用 leadDraftStore 的那一份（castIds + 现做一个人物）：B 与 C 是同一批人（「先把人定死」，下一段多半还是这几个人）。这里只多一张场景卡。
//   ★★ 那份名单只在内存里：一组画面受理那一拍，选了哪些人、哪张场景卡跟着分镜一起记进 localStorage，接着等时还原（2026-10-07 补，
//   此前只记分镜：App 重开后单格重画一张卡图都不带、落段时人物卡挂空）。分镜里点到的人不在选上的人物里时，出一组 / 单格重画 / 落段
//   一律先拦下（gridCastIssue 一处）—— 老记录没记人、卡被删了、人在第 1 步取下了谁，都落在这一道上。
// ★ 表单是**谁的**（leadDraftStore 同一招）：换账号那一拍把上一个人的收进暗格；在跑的长活回来时认「开工那一拍是谁」，写回他自己的那份。
// ★ 依赖方向：data → store → 组件。这里认 ai / data / structuredSkills（它们都不认组件）。
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import {
  AI_REAL,
  ArkNoReply,
  ImageGroupBusy,
  chargeNote,
  chargeOnFail,
  checkGridPanel,
  drawGridPanel,
  drawShotGroup,
  imageUrlToDataUrl,
  listImageGroups,
  shotGroupRefs,
  type ImageGroupState,
} from "../ai";
import { ArkHttpError, fetchImageGroup } from "../ai/arkClient";
import { canAfford, frozenNote, spendTokens } from "../data/account";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import { CHAT_TURN_TOKENS, GRID_CHECK_TOKENS, GRID_PANEL_TOKENS, IMAGE_TOKENS, fmtTokens } from "../data/economy";
import {
  GRID_SHOTS_MAX,
  castGaps,
  gridDrawPlan,
  gridFraming,
  panelIssues,
  panelKindOf,
  panelPlot,
  panelPrompt,
  parsePanelCheck,
  shotKey,
  styleRefIndex,
  type GridLang,
  type GridNote,
  type GridShot,
  type PanelIssue,
} from "../data/gridShots";
import { currentRoute, startJob } from "../data/jobs";
import { aspectOf, uid, type Card, type Proposal, type VideoAspect } from "../types";
import type { AppendSpec } from "./flowStore";
import { restoreCast } from "./leadDraftStore";
import { runSceneToGrid } from "./structuredSkills";

/** 向导的五步：选人物和场景 → 写这场戏（AI 写分镜清单）→ 出分镜画面 → 挑格子 → 一格一段 · 出片 */
export type GridStep = "cast" | "shots" | "draw" | "pick" | "spec";
export const GRID_STEPS: readonly GridStep[] = ["cast", "shots", "draw", "pick", "spec"];

export interface GridPanel {
  /** 本机 dataURL（取回来的 / 重画的）；"" = 还没取回来 */
  image: string;
  /** 方舟临时链接（取回来之前、或取图失败时留着重试） */
  url?: string;
  /** 这张图是按哪一版分镜画的（data/gridShots.shotKey）：分镜改过 → 过期，界面提醒重画 */
  key: string;
  /** 正在取图 / 重画 */
  busy?: "fetch" | "redraw";
  /** 这一格没画成 / 没取回来的原因（整句人话） */
  err?: string;
  /**
   * 画完之后对话模型看的那一遍（data/gridShots：分成几格、几个人、有没有两个一样的人；2026-10-07 主人「改」）。
   * done 的 issues 空 = 没看出问题；failed = 没核对上（why 是钱上的那句，没扣钱时为空）。缺省 = 还没看 / 演示构建不看。
   * ★ 只标出来、不自动重画：重画要花钱，由人看过再点（车窗里的小人影这种也会被数进去）。
   */
  check?: { state: "running" } | { state: "done"; issues: PanelIssue[] } | { state: "failed"; why: string };
}

export interface GridDraft {
  step: GridStep;
  /** 场景卡（可选）。人物在 leadDraftStore.castIds（与 B 同一批人） */
  placeId: string | null;
  /** 这场戏（人的原话） */
  scene: string;
  /** 分镜清单（逐格可改） */
  shots: GridShot[];
  /** 整体交代（地点、时间、光线） */
  lead: string;
  /** 这场戏是哪种语言写的（一格一段的视频提示词按它拼） */
  lang: GridLang;
  /** 分镜是按哪一句戏写的（戏改过之后提醒重写） */
  shotsScene: string;
  shotsDemo: boolean;
  /** 分镜是 AI 写的（false = 人自己写的）：那颗键说「重新写」还是「AI 写分镜」 */
  shotsAi: boolean;
  notes: GridNote[];
  writing: boolean;
  writeErr: string;
  /** 画面：按格（与 shots 下标对齐）。null = 这一格还没画 */
  panels: (GridPanel | null)[];
  /** 正在画 / 接着等的那一组（服务端任务号）；"" = 没在画 */
  groupId: string;
  /** 画到哪了（进度句）；"" = 没在画 */
  drawing: string;
  drawErr: string;
  /** 这一组画完的结局（几格没过审核 / 中途断了 / 按几张收的钱）；"" = 没什么要说 */
  drawNote: string;
  /** 画面的画幅（画之前定：画好的格子就是开头帧，画幅跟着它走） */
  aspect: VideoAspect | null;
  /** 挑中的格子（按点的先后 = 落段的顺序） */
  picks: number[];
  /** 每段时长；null = 缺省（5 秒，按档位的窗口夹） */
  durationSec: number | null;
  /** 向导此刻挂着没有（后台任务票据此决定要不要弹通知） */
  mounted: boolean;
}

export function initialGridDraft(placeId: string | null = null): GridDraft {
  return {
    step: "cast",
    placeId,
    scene: "",
    shots: [],
    lead: "",
    lang: "zh",
    shotsScene: "",
    shotsDemo: false,
    shotsAi: false,
    notes: [],
    writing: false,
    writeErr: "",
    panels: [],
    groupId: "",
    drawing: "",
    drawErr: "",
    drawNote: "",
    aspect: null,
    picks: [],
    durationSec: null,
    mounted: false,
  };
}

export const useGridDraft = create<GridDraft>()(() => initialGridDraft());

/** store 里现在这份是谁的（第一次问时取「内存里这摊活的主人」） */
let draftOwner = "";
function ownerOfDraft(): string {
  if (!draftOwner) draftOwner = workOwner();
  return draftOwner;
}
/** 别的账号做到一半的向导（只在这一进程里，不落盘） */
const parked = new Map<string, GridDraft>();

onOwnerSwitch((prev, next) => {
  const cur = useGridDraft.getState();
  const dirty = !!cur.scene || cur.shots.length > 0 || cur.writing || !!cur.drawing || !!cur.placeId;
  if (dirty) parked.set(prev, { ...cur, mounted: false });
  const back = parked.get(next);
  parked.delete(next);
  useGridDraft.setState({ ...(back ?? initialGridDraft()), mounted: cur.mounted }, true);
  draftOwner = next;
});

/** 写回开工那一拍那个人的那份（换过账号就写进他的暗格，不落进新账号的向导） */
function writeFor(who: string, patch: Partial<GridDraft>): void {
  if (who === ownerOfDraft()) {
    useGridDraft.setState(patch);
    return;
  }
  const p = parked.get(who);
  if (p) parked.set(who, { ...p, ...patch });
}
function stateFor(who: string): GridDraft | undefined {
  return who === ownerOfDraft() ? useGridDraft.getState() : parked.get(who);
}
/** 改某一格的画面（读最新的那份再写，几张图并发取回时不互相覆盖） */
function patchPanel(who: string, i: number, f: (p: GridPanel | null) => GridPanel | null): void {
  const cur = stateFor(who);
  if (!cur || i < 0 || i >= cur.panels.length) return;
  const panels = [...cur.panels];
  panels[i] = f(panels[i]);
  writeFor(who, { panels });
}

export function setGrid(patch: Partial<GridDraft>): void {
  useGridDraft.setState(patch);
}

// ── 在画的那一组记进 localStorage（App 被回收 / 重开后接着等） ─────────────────────────────

const PARKED_KEY = "ideahub-app.gridGroup.v1";
/** 看一遍的结论（存进落盘记录用：只存有结局的那两种） */
type StoredCheck = Exclude<GridPanel["check"], { state: "running" } | undefined>;
interface ParkedGroup {
  /** 服务端任务号；"" = 受理那一发没收到回包、还没确认服务端收没收到（接着等时先按 at 去问，adoptLost） */
  id: string;
  /** 受理时刻（任务号空着时 = 没收到回包的那一刻：认领时按它对服务端的 createdAt） */
  at: number;
  scene: string;
  shots: GridShot[];
  lead: string;
  lang: GridLang;
  aspect: VideoAspect | null;
  /** 画这一组时选上的人物卡 id（按选的先后）。2026-10-07 之前的记录没有这一位 —— 接着等时就还原不了，由 gridCastIssue 拦下、请人回第 1 步选 */
  castIds?: string[];
  /** 画这一组时挑的场景卡；null = 没挑。同上，老记录没有 */
  placeId?: string | null;
  /**
   * 组图里的第 k 张是第几格（gridDrawPlan 的 group：空镜与特写不进组图，2026-10-07 起）。老记录没有 = 一格一张、顺序对应。
   * ★ 接着等时照它把图摆回格子：按下标直接摆的话，空镜那一格会拿到下一格的画面
   */
  cells?: number[];
  /**
   * 已经看过一遍的那几张（按方舟图片链接记）。接着等时这几张取回来直接摆上结论，**不再看一遍、不再收那一次对话的钱** ——
   * 原来接着等会把整组重新取一遍、每张再看一遍（2.62 发版评审抓到：超出按钮上「最多」那个数）。
   */
  checks?: Record<string, StoredCheck>;
}
/** 方舟的图片链接 24 小时就失效：超过这么久的记录不再接 */
const PARKED_TTL_MS = 23 * 3600 * 1000;

/**
 * 受理那一发没收到回包、问服务端时它说「没有这一组」的那一次（按账号；只在这一进程里，不落盘）。
 * ★★ 为什么还留着（2.62 发版评审第二轮抓到）：「没有」可能只是服务端还没落库（请求体还没收完，问的那一发先到了），或两边时钟差得多、
 *   受理时刻没对上 —— 那一组之后照样开画、按张收钱。人再点「画出这一组」时拿它再对一次（reclaimLost：先问最近的几组；
 *   受理那一发回 409 时对 409 带来的那一组），对上了就认领、接着等，不另开一组再付一次钱。
 *   落盘记录在的时候用不上它（drawGroup 一开头就接着等那份记录去了）；人放弃上一组 / 落段收尾时一并忘掉。
 */
const lostAttempts = new Map<string, ParkedGroup>();

/**
 * localStorage 写不进去时（满了 / 被禁用）的退路：记录改记在内存里，这一进程里照样接得回来（App 重开就没了）。
 * ★ 为什么要有它：向导那几句话指人去点「接着等上一组」，那颗键只在有记录时才出现 —— 记录写丢了，那句话就指向一颗不存在的键。
 *   非 null 时它就是全部记录（下一次写进 localStorage 成功时连它一起写进去、再清掉）。
 */
let memParked: Record<string, ParkedGroup> | null = null;
function readParked(): Record<string, ParkedGroup> {
  if (memParked) return { ...memParked };
  try {
    const raw = localStorage.getItem(PARKED_KEY);
    const j = raw ? (JSON.parse(raw) as Record<string, ParkedGroup>) : {};
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}
function writeParked(owner: string, v: ParkedGroup | null): void {
  const all = readParked();
  if (v) all[owner] = v;
  else delete all[owner];
  try {
    localStorage.setItem(PARKED_KEY, JSON.stringify(all));
    memParked = null;
  } catch {
    memParked = all;
  }
}

/** 这个人有没有一组「受理过、还没取回来」的画面（向导打开时问它，有就接着等） */
export function parkedGroupOf(owner = ownerOfDraft()): ParkedGroup | null {
  const g = readParked()[owner];
  if (!g || typeof g.id !== "string" || !Array.isArray(g.shots)) return null;
  if (Date.now() - (Number(g.at) || 0) > PARKED_TTL_MS) {
    writeParked(owner, null);
    return null;
  }
  // 人物与场景卡读不对形状就当没记（还原不了 → gridCastIssue 拦下），别把一个坏值写进向导
  const castIds = Array.isArray(g.castIds) && g.castIds.every((x) => typeof x === "string") ? g.castIds : undefined;
  const placeId = typeof g.placeId === "string" ? g.placeId : null;
  // 格子对照读不对形状就当老记录（一格一张、顺序对应）
  const cells =
    Array.isArray(g.cells) && g.cells.every((x) => Number.isInteger(x) && x >= 0 && x < g.shots.length) ? g.cells : undefined;
  // 看过一遍的结论读不对形状的那几条当没看过（大不了再看一遍），别把坏值摆进格子里
  const checks: Record<string, StoredCheck> = {};
  if (g.checks && typeof g.checks === "object") {
    for (const [url, c] of Object.entries(g.checks as Record<string, unknown>)) {
      const x = c as { state?: unknown; issues?: unknown; why?: unknown } | null;
      if (x?.state === "done" && Array.isArray(x.issues)) checks[url] = { state: "done", issues: x.issues as PanelIssue[] };
      else if (x?.state === "failed" && typeof x.why === "string") checks[url] = { state: "failed", why: x.why };
    }
  }
  return { ...g, castIds, placeId, cells, checks };
}

/** 看完一遍的结论记进这个人那份落盘记录（接着等时据此不再看第二遍）。记录已经撤了（这一组结过了）就不记：不会再接着等了 */
function rememberCheck(owner: string, url: string, check: StoredCheck): void {
  const g = readParked()[owner];
  if (!g) return;
  writeParked(owner, { ...g, checks: { ...(g.checks ?? {}), [url]: check } });
}

/**
 * 两份分镜画出来的画面是不是同一版（逐格比 shotKey：景别 / 画面 / 画面里有谁）。
 * ★ 动作与整体交代不在比较里（shotKey 不认它们，改了也不算画面过期）：所以比出「同一版」时，接着等**留着向导里现在的那一份**
 *   （resumeGroup），不拿记录里的去盖 —— 原来一律换回记录里的，人只改了动作 / 整体交代也会被悄悄换回去（2.62 发版评审第二轮抓到）。
 */
function sameShots(a: readonly GridShot[], b: readonly GridShot[]): boolean {
  return a.length === b.length && a.every((x, i) => shotKey(x) === shotKey(b[i]));
}

/**
 * 接着等上一组会不会换掉向导里现在的分镜：向导里有分镜、画面那几样又不是记录里那一版（接回失败之后人改过 / 重写过）。
 * 空的向导（App 重开过）不算；只改过动作 / 整体交代也不算（接着等时留着现在的，见 sameShots）。
 * 向导打开时只在它为假时自动接；为真时由人点「接着等上一组」（那颗键上写明会换回去），或者「放弃上一组」。
 */
export function resumeReplacesDraft(owner = ownerOfDraft()): boolean {
  const g = parkedGroupOf(owner);
  const s = stateFor(owner);
  return !!g && !!s && s.shots.length > 0 && !sameShots(s.shots, g.shots);
}

/**
 * 放弃上一组（向导第③步「放弃上一组」，确认卡上当面说过钱）：撤掉落盘记录，之后可以按现在的分镜另画一组。
 * ★ 钱：服务端那一组照样画完、照样按画出来的张数结算（预扣多退）—— 放弃只是这一边不再去取，不退、也不多收。确认卡照这个说。
 * ★ 一并忘掉「没收到回包、服务端当时说没有」的那一次（lostAttempts）：人说了放弃，就别再替他认领回来、把分镜换回去。
 * ★ 在画 / 在接着等的时候不许放弃：那一头还在用这份记录（结局时它自己会撤）。
 */
export function discardParkedGroup(): void {
  const s = useGridDraft.getState();
  if (s.drawing || s.writing) return;
  const who = ownerOfDraft();
  writeParked(who, null);
  lostAttempts.delete(who);
  // 向导里那几句指着「接着等上一组」的话一并撤掉：那颗键没了，留着就是指向一颗不存在的键
  useGridDraft.setState({ drawErr: "", groupId: "" });
}

/**
 * 分镜里点到的人不在选上的人物里时那一句（null = 都在）。出一组 / 单格重画 / 落段（gridAppendSpecs）都先问它：
 * 不拦的话那几个人一张卡图都带不上，画出来是陌生人、落段时人物卡挂空（data/gridShots.castGaps 头上记着 10-06 那次）。
 * @param shots 要画 / 要落的那几格；cast 选上的人物（卡片库里还在的）
 */
export function gridCastIssue(shots: readonly GridShot[], cast: readonly Card[]): string | null {
  const gaps = castGaps(shots, cast.map((c) => c.name));
  if (!gaps.length) return null;
  const names = gaps.join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  return t`分镜里写到的「${names}」不在选上的人物里：画面带不上他们的卡图，会画成陌生人——回第 1 步把人选上（或者在分镜里把他们从画面里去掉）`;
}

// ── 第①②步：场景卡、这场戏、分镜清单 ─────────────────────────────────────────

/** 选上 / 取下场景卡（只能挂一张：它当定场参考图，两张地点会打架） */
export function togglePlace(id: string): void {
  const s = useGridDraft.getState();
  useGridDraft.setState({ placeId: s.placeId === id ? null : id });
}

/**
 * AI 写分镜（studio/structuredSkills.runSceneToGrid：一次对话，请求成功那一拍扣一次）。结果写回开工那一拍那个人的向导。
 * ★ 写出新的分镜 = 换掉整张清单：已经画好的画面与挑的格子一起作废（下标对不上了）—— 界面那颗键上写明这一点。
 * ★ 钱上的话按错误**类型**说（ai/failCharge 一处）：形状不对 / 截断那几句自己就说了「已计费」，网络那一档由 chargeNote 补一句。
 */
/**
 * 有一格正在单独画 / 取图吗 —— 这时不许改分镜的**格数与顺序**（删一格、整篇重写、自己写一格）。
 * ★ 为什么（2.62 发版评审第三轮抓到）：单格出图写回是**按格号**落的（drawPanelAt），中途删掉前面一格，
 *   那一格就落到隔壁、原来那格的 busy 永远清不掉 ——「接着等上一组」从此灰着，只剩放弃那一组（付过钱的）一条路。
 */
export function panelsBusy(s: { panels: (GridPanel | null)[] }): boolean {
  return s.panels.some((p) => !!p?.busy);
}

export async function writeShots(o: { cast: string[]; place: string }): Promise<void> {
  const s = useGridDraft.getState();
  if (s.writing || s.drawing) return;
  if (panelsBusy(s)) {
    useGridDraft.setState({ writeErr: t`有一格正在单独画——等它画完再重写分镜（这一下还没花钱）` });
    return;
  }
  const who = ownerOfDraft();
  const scene = s.scene;
  useGridDraft.setState({ writing: true, writeErr: "" });
  try {
    const r = await runSceneToGrid({ scene, cast: o.cast, place: o.place });
    writeFor(who, {
      shots: r.plan.shots,
      lead: r.plan.lead,
      lang: r.lang,
      notes: r.plan.notes,
      shotsScene: scene,
      shotsDemo: r.demo,
      shotsAi: true,
      panels: r.plan.shots.map(() => null),
      picks: [],
      drawNote: "",
      drawErr: "",
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), CHAT_TURN_TOKENS);
    const moneyLine = money?.line ?? "";
    writeFor(who, {
      writeErr: money
        ? t({
            message: `写分镜没成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
        : why,
    });
  } finally {
    writeFor(who, { writing: false });
  }
}

/** 不用 AI：把这场戏当成第一格，自己往下加 */
export function writeShotsByHand(): void {
  const s = useGridDraft.getState();
  if (s.writing || s.drawing || panelsBusy(s)) return;
  const first: GridShot = { size: "", picture: s.scene.trim(), action: "", who: [] };
  useGridDraft.setState({
    shots: [first],
    lead: "",
    notes: [],
    shotsScene: s.scene,
    shotsDemo: false,
    shotsAi: false,
    panels: [null],
    picks: [],
    drawNote: "",
  });
}

/** 改某一格的分镜（画过的那一格会被标成「过期」，由界面提醒重画；正在画一组时不许改 —— 下标会对不上） */
export function editShot(i: number, patch: Partial<GridShot>): void {
  const s = useGridDraft.getState();
  if (s.drawing || i < 0 || i >= s.shots.length) return;
  const shots = [...s.shots];
  shots[i] = { ...shots[i], ...patch };
  useGridDraft.setState({ shots });
}

/** 删掉一格（连同它的画面；挑中的格子跟着重新编号） */
export function removeShot(i: number): void {
  const s = useGridDraft.getState();
  if (s.drawing || panelsBusy(s) || i < 0 || i >= s.shots.length) return;
  useGridDraft.setState({
    shots: s.shots.filter((_, k) => k !== i),
    panels: s.panels.filter((_, k) => k !== i),
    picks: s.picks.filter((k) => k !== i).map((k) => (k > i ? k - 1 : k)),
  });
}

/** 在末尾加一格空的（最多 GRID_SHOTS_MAX 格） */
export function addShot(): void {
  const s = useGridDraft.getState();
  if (s.drawing || s.shots.length >= GRID_SHOTS_MAX) return;
  useGridDraft.setState({ shots: [...s.shots, { size: "", picture: "", action: "", who: [] }], panels: [...s.panels, null] });
}

// ── 第③步：出一组画面 / 单画一格 / 看一遍 ────────────────────────────────────────
//
// ★★ 2026-10-07 主人「改」（付费验证在 docs/seedream-grid-fix-research.md 第七节）：
//   ① 普通格进组图（gridDrawPlan），**空镜与特写组图之后单画**：组图的参考图对整组生效，空镜那一格会被画进人、特写会画成两人中景；
//   ② 单画与单格重画是同一个函数（drawPanelAt），提示词 gridShots.panelPrompt（正面写画幅、参考图标用途）；
//   ③ 每画好一格让对话模型看一遍（checkPanel）：分成几格、几个人、有没有两个一样的人。有问题标在那一格上，**由人决定重画**，不自动花钱。

/**
 * 看一遍要多少：一次看图对话（服务端对 chat 按调用次数定额收 CHAT_TURN_TOKENS，与塞几张图无关 —— 所以一次只看一张，见 ai/real.checkGridPanel）。
 * 算进报价里：一组 = 每格一张图 + 看一遍；重画一格同理。
 */
export const PANEL_CHECK_TOKENS = GRID_CHECK_TOKENS;
/** 一组画面最多要多少（按上限报：方舟只收画出来的那几张，没画出来的退回 —— 契约「组图」；每格再加看一遍）。每格的价只在 economy.GRID_PANEL_TOKENS（选法屏也读它） */
export function groupQuote(n: number): number {
  return GRID_PANEL_TOKENS * n;
}
/** 单画 / 重画一格：一张图 + 看一遍 */
export const PANEL_REDRAW_TOKENS = GRID_PANEL_TOKENS;

/** 审核没过的码（方舟原样）→ 一句人话 */
function failLine(code: string): string {
  return /SensitiveContent|Sensitive/i.test(code) ? t`这一格没过内容审核，没画出来（没收这一张的钱）——改改画面写法再单独重画` : t`这一格没画出来（没收这一张的钱）——单独重画一次`;
}

/**
 * 把这一组的最新进展落进格子里：新画好的那几张去取回来（方舟链接 → 本机 dataURL），没画成的那几格写上原因。
 * ★ 组图里的第 k 张是 cells[k] 那一格（空镜与特写不进组图，gridDrawPlan）：按下标直接摆的话，空镜那一格会拿到下一格的画面。
 * ★ 轮询每一次都回整份列表，取过的不再取（fetched 记着组图里的下标）。
 * ★ 那一格**已经有画面**的不取、不再看一遍（接着等之前已经取回来的 / 接回失败之后人单独画过、付过钱的）：原来接着等会把格子整张清空、
 *   重新取一遍、每张再看一遍 —— 人付过钱的单画被盖掉，看图的钱再收一次（2.62 发版评审抓到）。drawGroup 开画前把格子清空了，那条路不受影响。
 *   ★ 留着的若是**人单独画的那一张**（不是这一组的同一张：链接对不上），这一组里那一格的图服务端照样画了、照样算进按张结算 ——
 *   记进 kept，由结局那一句当面说（第二轮评审抓到：原来不声不响，「按画出来的 N 张收了」里的 N 比看得见的多）。
 * @param checks 落盘记录里已经看过一遍的那几张（按图片链接）：取回来直接摆上结论，不再看
 * @param kept 收「留着人单独画的那张、这一组的图没换上去」的那几格
 */
function absorb(
  who: string,
  keys: string[],
  cells: readonly number[],
  shots: readonly GridShot[],
  st: ImageGroupState,
  fetched: Set<number>,
  pending: Promise<void>[],
  checks?: Readonly<Record<string, StoredCheck>>,
  kept?: Set<number>,
): void {
  for (const f of st.failures) {
    const i = cells[f.index];
    if (i === undefined) continue;
    patchPanel(who, i, (p) => (p?.image ? p : { image: "", key: keys[i], err: failLine(f.code) }));
  }
  for (const img of st.images) {
    const i = cells[img.index];
    if (i === undefined || fetched.has(img.index)) continue;
    fetched.add(img.index);
    const cur = stateFor(who)?.panels[i];
    if (cur?.image) {
      if (cur.url !== img.url) kept?.add(i);
      continue;
    }
    patchPanel(who, i, () => ({ image: "", url: img.url, key: keys[i], busy: "fetch" }));
    pending.push(fetchPanel(who, i, img.url, keys[i], shots[i], checks?.[img.url]));
  }
}

/** 把一张组图取回来（方舟链接 → 本机 dataURL；不计费）。取成之后看一遍 —— 落盘记录里已经有这一张的结论（known）就直接摆上，不再看 */
async function fetchPanel(who: string, i: number, url: string, key: string, shot: GridShot | undefined, known?: StoredCheck): Promise<void> {
  try {
    const image = await imageUrlToDataUrl(url);
    patchPanel(who, i, () => ({ image, url, key, ...(known ? { check: known } : {}) }));
    if (shot && !known) void checkPanel(who, i, shot, image, url);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // 看过一遍的结论跟着留在这一格上（没有画面时界面不画它）：「重新取」时照它摆，不再看一遍（knownCheckOf）——
    // 落盘记录在这一组结过之后就撤了，只靠记录的话，接着等完再点「重新取」又要多收一次看图的钱（第三轮评审抓到）
    patchPanel(who, i, () => ({ image: "", url, key, err: t`画好了、但没取回来（${why}）——点这一格重新取`, ...(known ? { check: known } : {}) }));
  }
}

/** 同时最多看两格：一组画完那一拍别一下子并发七八次对话 */
let checking = 0;
const checkWaiters: (() => void)[] = [];
async function checkSlot(): Promise<() => void> {
  while (checking >= 2) await new Promise<void>((r) => checkWaiters.push(r));
  checking++;
  return () => {
    checking--;
    checkWaiters.shift()?.();
  };
}

/**
 * 画好一格之后让对话模型看一遍（ai/real.checkGridPanel），按这一格的分镜判（gridShots.panelIssues），结论挂在这一格上（GridPanel.check）。
 * ★ 认图不认下标：看完的时候这一格可能已经重画过了（image 换了）—— 那份结论作废、不写。
 * ★ 钱：对话回了（2xx）那一拍服务端已经按一次对话收了钱，本机账本同拍记一次（正式包上是空操作）；读不懂回话也照算。失败按类型说（ai/failCharge）。
 * ★ 演示构建不看（没有对话模型）：check 缺省 = 界面什么都不标。
 * @param url 这张图是组图里取回来的（方舟链接）：结论记进落盘记录，接着等时不再看第二遍（rememberCheck）。单画的那几格不进记录，不传
 */
async function checkPanel(who: string, i: number, shot: GridShot, image: string, url?: string): Promise<void> {
  if (!AI_REAL || !image) return;
  patchPanel(who, i, (p) => (p && p.image === image ? { ...p, check: { state: "running" } } : p));
  const release = await checkSlot();
  try {
    const raw = await checkGridPanel(image);
    spendTokens(PANEL_CHECK_TOKENS);
    const c = parsePanelCheck(raw);
    const check: StoredCheck = c ? { state: "done", issues: panelIssues(c, shot) } : { state: "failed", why: "" };
    if (url) rememberCheck(who, url, check);
    patchPanel(who, i, (p) => (p && p.image === image ? { ...p, check } : p));
  } catch (e) {
    const money = chargeNote(chargeOnFail(e), PANEL_CHECK_TOKENS);
    const check: StoredCheck = { state: "failed", why: money?.line ?? "" };
    // 没看成也记：这一发可能已经收了钱（钱上那句就在 why 里），接着等时再看一遍就是可能再收一次
    if (url) rememberCheck(who, url, check);
    patchPanel(who, i, (p) => (p && p.image === image ? { ...p, check } : p));
  } finally {
    release();
  }
}

/** 一组画完（或接着等完）之后要说的那一句 */
function groupNote(st: ImageGroupState, asked: number): string {
  const got = st.images.length;
  const sep = t({ message: "；", comment: "把几条说明连成一句时的分隔符" });
  const parts: string[] = [];
  if (st.interrupted) parts.push(t`画到第 ${got} 张时断了，画到哪张算哪张`);
  const rejected = st.failures.filter((f) => /Sensitive/i.test(f.code)).length;
  if (rejected) parts.push(t`${rejected} 格没过内容审核`);
  const missing = Math.max(0, asked - got - rejected);
  if (missing && !st.interrupted) parts.push(t`${missing} 格模型没画`);
  // 钱：服务端预扣过就报服务端的实收（打包）；dev 直连按张算（本机账本就是这么记的）；正式包上的免单（管理员）不说钱
  const charged = st.prepaid > 0 ? st.charged : import.meta.env.DEV ? got * IMAGE_TOKENS : null;
  if (got > 0 && charged !== null) {
    const price = fmtTokens(charged);
    parts.push(t`按画出来的 ${got} 张收了 ${price} token`);
  }
  return parts.join(sep);
}

/** 这个人的向导里画好了几格 */
function drawnOf(who: string): number {
  return (stateFor(who)?.panels ?? []).filter((p) => !!p?.image).length;
}

/** 后台任务票收尾：一格都没画好算失败（原因已经写在向导里），否则报画好了几格 */
function closeJob(who: string, job: ReturnType<typeof startJob>): void {
  const got = drawnOf(who);
  if (!got) {
    job.fail(t`九宫格分镜的画面没出成，回去看原因`);
    return;
  }
  job.done({ msg: t`九宫格分镜画好了 ${got} 格`, silent: who === ownerOfDraft() && useGridDraft.getState().mounted });
}

/**
 * 出一组画面 —— 领一张后台任务票，画好一张多一张。结果写回开工那一拍那个人的向导。
 * 先出组图（普通格），再一格一格单画空镜 / 特写 / 落单的那一格（gridDrawPlan）；组图一张都没出来时不再单画
 * （多半是连不上，单画也一样 —— 人再点一次「画出这一组」整组重来）。
 * ★★ 还有一组受理过、没取回来（落盘记录在）就**不开新的一组**，先接着等它（resumeGroup）：那一组按张付过钱，开新的一组要再付一次，
 *   还会把记录盖掉、那几张就再也取不回来。向导那颗键此时写的是「接着等上一组」（旁边另有「放弃上一组」），这里是同一条规矩的兜底。
 *   这一进程里有一次「没收到回包、服务端当时说没有」（lostAttempts）时，开画之前先再对一次（reclaimLost）。
 * @param o.cast 出场人物（卡），o.place 场景卡；画幅在 draft.aspect（画之前定）
 */
export async function drawGroup(o: { cast: Card[]; place: Card | null }): Promise<void> {
  const s0 = useGridDraft.getState();
  if (s0.drawing || s0.writing || !s0.shots.length || !s0.aspect) return;
  // 有一格正在单独画就不开一组（2.62 发版评审第四轮）：整组重出会先把格子清空，单画那张回来落在清空后的格子上，
  // 组图同一格那张就被跳过 —— 按张收了钱、却一眼都没给人看（panelsBusy 头上的 ★ 是同一个缘故）
  if (panelsBusy(s0)) {
    useGridDraft.setState({ drawErr: t`有一格正在单独画——等它画完再整组重出（这一下还没花钱）` });
    return;
  }
  const who = ownerOfDraft();
  if (parkedGroupOf(who)) {
    await resumeGroup();
    return;
  }
  if (await reclaimLost(who)) return;
  // 问的那几秒里向导被别处动过（换了账号 / 又在画了）就不画：下面全按这一刻的那份
  const s = useGridDraft.getState();
  if (panelsBusy(s) && ownerOfDraft() === who) {
    useGridDraft.setState({ drawErr: t`有一格正在单独画——等它画完再整组重出（这一下还没花钱）` });
    return;
  }
  if (s.drawing || s.writing || !s.shots.length || !s.aspect || ownerOfDraft() !== who) return;
  const shots = s.shots.filter((x) => x.picture.trim());
  if (shots.length !== s.shots.length) {
    useGridDraft.setState({ drawErr: t`有几格还没写画面——写上，或者删掉那几格再画` });
    return;
  }
  const castIssue = gridCastIssue(shots, o.cast);
  if (castIssue) {
    useGridDraft.setState({ drawErr: castIssue });
    return;
  }
  const cost = groupQuote(shots.length);
  if (AI_REAL && !canAfford(cost)) {
    const price = fmtTokens(cost);
    useGridDraft.setState({ drawErr: frozenNote() ?? t`画这一组最多要 ${price} token，余额不够——去「我的」页充值` });
    return;
  }
  const page = currentRoute();
  const job = startJob({ kind: "grid-draw", title: t`九宫格分镜 · 出画面`, page, route: page, progress: t`准备参考图…` });
  const keys = shots.map(shotKey);
  const aspect = s.aspect;
  /** 跟着分镜一起记下来的人物与场景卡（App 重开后接着等时还原） */
  const castIds = o.cast.map((c) => c.id);
  const placeId = o.place?.id ?? null;
  const plan = gridDrawPlan(shots);
  /**
   * 开画前那一版格子：新的一组没受理、也不会有哪一组来接管格子的那几种出口，原样放回去（restoreBefore）。
   * ★ 为什么（2.62 发版复核留下的一条，10-08 补）：下面这一行开画就把格子清空了，而这一次常常一张新图都没有 —— 人上一组付过钱的图
   *   却从屏幕上没了（向导不落盘，这一进程里再也找不回来）。两类：① 受理之前就被拒（409「上一组还在画」、余额 / 套餐那类 4xx、5xx、
   *   参考图准备失败），一分没花；② 受理了、却一张都没画出来（!got：分镜没过内容审核、连不上出图服务、连接断了 —— 敏感词是这样到的，
   *   不是受理前的 4xx；预扣全退），或者受理过的这一组在服务端没了（404：过期 / 不是这个账号的，记录也接不回来）。
   * ★ 这几种出口**不放回**（都有一组会来接管格子）：受理过、还在画（started 且不是 404：新的一组按张付过钱，格子归它）；没收到回包、要去问服务端
   *   收没收到（askLost：认领回来的那一组会把格子换掉 / 记下来下次再问，这时摆回旧图只会让两组的图在格子里打架）；
   *   409 而那一组正是「没收到回包的那一次」（claimLost 接管格子）。
   * ★ dev 直连时没收到回包也放回：那一支不去问服务端（askLost 只在打包后成立），没有哪一组会来接管格子。
   * ★ 只在这期间分镜没换过（shots 还是同一份）、格子里也还没有一张新图（也没有哪一格正在取 / 重画）时放回：格子跟着分镜的下标走，
   *   分镜换了旧图就对不上号了。只写着「这一格没画成」的格子不算有图（absorb 把组图的逐格失败写成 { image: "", err }）——
   *   原来判的是「格子是不是 null」，一组被内容审核整组拒掉时每格都挂着那句失败，上一组的图就摆不回来。
   * ★ 「有图」= 本机有这张图（image）**或者**手里还攥着它的方舟链接（url：画好了、没取回来，点那一格能免费重新取，24 小时内有效）——
   *   上一组付过钱、只是取图失败的那几格也要摆回去，丢了链接就再也取不回来（落盘记录在那一组结过之后已经撤了）。
   * ★ 摆回去时撤掉「正在看图」那一态（check.running）：开画那一拍正在看的那几格，看完写回时格子已经清空、结论落了空，
   *   原样摆回去就是一个永远转着的圈。撤掉之后还在看的那几格看完照常写上（checkPanel 认的是同一张图）
   */
  const before = { shots: s.shots, panels: s.panels, picks: s.picks };
  /** 摆回去了回 true（调用方据此说一句「上一版摆回去了」，别再报「画好了 N 格」—— 那 N 格是上一版的） */
  const restoreBefore = (): boolean => {
    // 上一版一张图都没有（头一次画）就不动：摆回去只是把这一次逐格的失败原因抹掉
    if (!before.panels.some((p) => !!p?.image || !!p?.url)) return false;
    const cur = stateFor(who);
    if (!cur || cur.shots !== before.shots || cur.panels.some((p) => !!p?.image || !!p?.url || !!p?.busy)) return false;
    const panels = before.panels.map((p) => {
      if (p?.check?.state !== "running") return p;
      const { check: _running, ...rest } = p;
      return rest;
    });
    writeFor(who, { panels, picks: before.picks });
    return true;
  };
  useGridDraft.setState({ drawing: t`准备参考图…`, drawErr: "", drawNote: "", panels: shots.map(() => null), picks: [] });
  const n = shots.length;
  const say = () => {
    const k = drawnOf(who);
    const line = t`画好 ${k}/${n} 格（一组约几分钟，可以先离开）`;
    writeFor(who, { drawing: line });
    job.update(line);
  };
  const notes: string[] = [];
  /** 服务端受理过这一组了（onStarted 跑过：按张预扣、任务号已记下）。之后再出错只是「这一头没查到」，不是「没出成」 */
  let started = false;
  try {
    if (plan.group.length) {
      const fetched = new Set<number>();
      const pending: Promise<void>[] = [];
      let got = 0;
      try {
        const st = await drawShotGroup({
          shots: plan.group.map((i) => shots[i]),
          lead: s.lead,
          cast: o.cast,
          place: o.place,
          aspect,
          onNote: (x) => notes.push(x),
          onUpdate: (u) => {
            absorb(who, keys, plan.group, shots, u, fetched, pending);
            say();
          },
          onStarted: (id) => {
            started = true;
            // 新的一组受理了：先前那一次「服务端说没有」不用再对（开画之前 reclaimLost 已经对过一次；真在画的话这一发会回 409 而不是受理）
            lostAttempts.delete(who);
            writeFor(who, { groupId: id });
            writeParked(who, { id, at: Date.now(), scene: s.scene, shots, lead: s.lead, lang: s.lang, aspect, castIds, placeId, cells: plan.group });
          },
        });
        got = await settleGroup(who, st, plan.group.length, pending, notes);
      } catch (e) {
        await Promise.all(pending);
        if (e instanceof ImageGroupBusy && e.id) {
          // 服务端说这个人已经有一组在画。落盘记录在的话走不到这里（drawGroup 一开头就接着等它去了），所以能认的只剩一种：
          // 这一进程里「没收到回包、服务端当时说没有」的那一次（lostAttempts）其实收到了 —— 张数与受理时刻对得上（busyIsOurs）就认领、接着等。
          // 对不上（同一个账号在别的设备上开的那一组 / 人放弃过的那一组）就说清楚，不认
          const lost = lostAttempts.get(who);
          if (lost && (await busyIsOurs(e.id, lost))) {
            job.done({ silent: true });
            writeFor(who, { drawing: "" });
            await claimLost(who, lost, e.id);
            return;
          }
          // 新的这一组没受理（一分没花）：上一版格子摆回去（restoreBefore 的 ★）
          restoreBefore();
          writeFor(who, { drawErr: t`上一组画面还在画（同一时间只能画一组）——几分钟后再来` });
          job.fail(t`上一组画面还在画`);
          return;
        }
        const gone = e instanceof ArkHttpError && e.status === 404;
        if (started && !gone) {
          // ★★ 受理过了（按张预扣过、服务端照样在画、画完按拿到手的张数结算）：轮询断了几次 / 等满 22 分钟只是「这一头没查到」。
          //   落盘记录留着、groupId 在 finally 里清掉（向导打开时据此自动接着等）；不说「画面没出成」、不另说钱 —— 钱的结局在接回来那一拍按服务端的账说
          writeFor(who, { drawErr: stillDrawingLine(e) });
          job.fail(t`九宫格分镜的画面还没取回来——回到那一页接着取`);
          return;
        }
        // 受理过、但这一组在服务端没了（404：过期 / 不是这个账号的）：记录留着也接不回来；也没有哪一组会来接管格子，上一版摆回去
        if (started) {
          writeParked(who, null);
          restoreBefore();
        }
        // 受理那一发就连不上（网关 / 代理回 502~504）：说人话，不摆「Ark … 504: {…}」（判据见 upstreamDown）
        const why = upstreamDown(e) ? t`这次没连上出图服务（多半是网络抖了一下），再点一次就行` : e instanceof Error ? e.message : String(e);
        const money = chargeNote(chargeOnFail(e), IMAGE_TOKENS * plan.group.length);
        const moneyLine = money?.line ?? "";
        /** 受理那一发没收到回包、要去问服务端收没收到（adoptLost）：收到了的那一组会接管格子，所以这一支不摆回上一版（restoreBefore 的 ★） */
        const askLost = !started && e instanceof ArkNoReply && !import.meta.env.DEV;
        if (askLost) {
          // 受理那一发没收到回包 ≠ 没受理：问服务端收没收到（adoptLost）。收到了就接回来接着等；**没问到**就把这一次记下来（任务号空着），
          // 下次接着等时再问 —— 原来没问到也当「没受理」，那一组付过钱却再也没人去取（2.62 发版评审抓到）
          writeFor(who, { drawing: t`这一组发出去没收到回包，正在问服务端收没收到…` });
          const rec: ParkedGroup = { id: "", at: Date.now(), scene: s.scene, shots, lead: s.lead, lang: s.lang, aspect, castIds, placeId, cells: plan.group };
          const r = await adoptLost(who, rec);
          if (typeof r === "object") {
            job.done({ silent: true });
            writeFor(who, { drawing: "" });
            await resumeGroup();
            return;
          }
          if (r === "unknown") {
            writeParked(who, rec);
            writeFor(who, {
              drawErr: money
                ? t({
                    message: `这一组发出去没收到回包，也没问到服务端收没收到（${why}）。${moneyLine}点下面「接着等上一组」再问一次：收到了就接着取回来（图不再收钱），没收到再画`,
                    comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
                  })
                : t`这一组发出去没收到回包，也没问到服务端收没收到（${why}）。点下面「接着等上一组」再问一次：收到了就接着取回来（图不再收钱），没收到再画`,
            });
            job.fail(t`九宫格分镜的画面还没确认——回到那一页接着问`);
            return;
          }
          // "none"：服务端说了没有这一组 —— 照下面那句说（钱上那句仍按「没收到回包」那一档，以余额为准）。
          // 这一次记在内存里（lostAttempts）：「没有」可能只是服务端还没落库，人再点「画出这一组」时再对一次
          lostAttempts.set(who, rec);
        }
        // 新的这一组没受理、也不会有哪一组来接管格子（4xx / 5xx / 参考图没准备好）：上一版格子摆回去。
        // 问过服务端说「没有」的那一次不摆 —— 它记在 lostAttempts 里，下次还会再对、认领回来就换掉格子（restoreBefore 的 ★）
        if (!started && !askLost) restoreBefore();
        writeFor(who, {
          drawErr: money
            ? t({
                message: `画面没出成：${why}。${moneyLine}`,
                comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
              })
            : t`画面没出成：${why}`,
        });
        job.fail(t`九宫格分镜的画面没出成，回去看原因`);
        return;
      }
      if (!got) {
        // 受理了、一张都没画出来（敏感词 / 连不上 / 断了，预扣全退）：上一版格子摆回去（restoreBefore 的 ★）
        restoreBefore();
        job.fail(t`九宫格分镜的画面没出成，回去看原因`);
        return;
      }
    }
    for (const sg of plan.singles) {
      say();
      await drawPanelAt(who, sg.index, shots[sg.index], { cast: o.cast, place: o.place, ask: "", aspect, lead: s.lead });
    }
    // 一张新图都没画出来（整组都是单画的格子 —— 只有一两格有人、或者全是空镜 / 特写 —— 而它们全没画成）：上一版格子摆回去。
    // 组图出过图的话格子里有新图，restoreBefore 自己就不动。
    // ★ 摆回去会把这一次逐格写的失败原因（带钱上那句：可能已经扣了 / 已计费）一起盖掉，而这条路上没有别处写 drawErr ——
    //   先把它们收起来、说在 drawErr 里；票也按「没出成」结（closeJob 会把摆回来的旧图数成「画好了 N 格」）
    const singleErrs = [...new Set((stateFor(who)?.panels ?? []).map((p) => p?.err ?? "").filter(Boolean))];
    if (plan.singles.length && restoreBefore()) {
      const why = singleErrs.join(t({ message: "；", comment: "把几条说明连成一句时的分隔符" }));
      writeFor(who, {
        drawErr: why
          ? t({ message: `这一次一格都没画成（${why}）——上一版的图原样摆回去了`, comment: "why 是逐格的失败原因（可能带钱上的那句），用分号连起来" })
          : t`这一次一格都没画成——上一版的图原样摆回去了`,
      });
      job.fail(t`九宫格分镜的画面没出成，回去看原因`);
      return;
    }
    closeJob(who, job);
  } finally {
    // groupId 一并清掉（与 resumeGroup 同）：留着的话向导打开时那道「自动接着等」的闸（!groupId）这一进程里再也不成立
    writeFor(who, { drawing: "", groupId: "" });
  }
}

/** 受理之后这一头没查到进展（轮询断了 / 等满 22 分钟 / 接着等又断了）时那一句：服务端照样在画，指人去点「接着等上一组」 */
function stillDrawingLine(e: unknown): string {
  const why = upstreamDown(e) ? t`没连上出图服务` : e instanceof Error ? e.message : String(e);
  return t`这一组的进展暂时没查到（${why}）——服务端照样在画，画好的图在服务端留 24 小时：点下面「接着等上一组」接着取回来（图不再收钱），别整组重出`;
}

/**
 * 这一组在服务端的样子与「没收到回包的那一次」对得上吗：张数一样、受理时刻离没收到回包的那一刻三分钟以内。
 * ★ 拿手机时钟（rec.at）对服务端时钟（createdAt）：两边差得多时对不上的那一组也可能就是它 —— 所以「对不上」只能说成
 *   「没找到」，不能说成「服务端没收到」（resumeGroup 的 none 那一句）。按服务端时间对要读回包的 Date 头，跨源时 WebView 读不到（不在 CORS 白名单里）
 */
function matchesAttempt(g: Pick<ImageGroupState, "maxImages" | "createdAt">, rec: ParkedGroup): boolean {
  const cells = rec.cells ?? rec.shots.map((_, i) => i);
  return g.maxImages === cells.length && g.createdAt > 0 && Math.abs(g.createdAt - rec.at) < 3 * 60_000;
}

/** 服务端回 409 带来的那一组是不是 rec 那一次（lostAttempts 里那一次；查一次进展，不计费；查不到就当不是 —— 同一个账号在别的设备上开的那一组不认） */
async function busyIsOurs(id: string, rec: ParkedGroup): Promise<boolean> {
  try {
    return matchesAttempt(await fetchImageGroup(id), rec);
  } catch {
    return false;
  }
}

/**
 * 认领：rec 那一次（没收到回包、服务端当时说没有）其实是服务端的 id 那一组 —— 记进落盘记录（任务号补上），接着等。
 * ★ 向导里的分镜已经不是那一版了（人在这期间改过 / 重写过）就**不替人换回去**：只记下来，摆出「接着等上一组」那颗键
 *   （键旁写明会换回去）和「放弃上一组」，由人定。换过账号的（who 不是向导现在的主人）也只记下来，等那个人打开向导时自动接。
 */
async function claimLost(who: string, rec: ParkedGroup, id: string): Promise<void> {
  lostAttempts.delete(who);
  writeParked(who, { ...rec, id });
  if (who === ownerOfDraft() && !resumeReplacesDraft(who)) {
    await resumeGroup();
    return;
  }
  writeFor(who, { drawErr: claimedLine() });
}

/** 那一次（没收到回包）服务端其实收到了、记录已经补上任务号，但这一刻不替人接（分镜改过 / 换了账号）时那一句：指人去点「接着等上一组」 */
function claimedLine(): string {
  return t`上一组（发出去没收到回包的那一次）服务端其实收到了、照样在画：点下面「接着等上一组」把图取回来（图不再收钱），不用再画一组`;
}

/**
 * 开新的一组之前：这一进程里有「没收到回包、服务端当时说没有」的那一次（lostAttempts）就再问一次服务端最近的几组（不计费）。
 * 对上了就认领（claimLost）、回 true —— 不另开一组、不再付一次钱（那一组要是已经画完了，受理新的一组时不会回 409，只有在这里才对得上）。
 * 服务端又说了一次没有就不再记、照常往下画。
 * ★★ **没问到就不画**（2.62 发版评审第三轮抓到）：原来没问到也照常往下画 —— 可那一组要是已经画完了，受理新的一组时不会回 409，
 *   服务端照收第二组的钱，onStarted 又把这条记录删掉，前一组付过钱的图从此对不上号、取不回来。没问到 = 不知道，
 *   宁可让人过一会儿再点一次（不花钱），也别冒着付两次的风险开新的一组。
 */
async function reclaimLost(who: string): Promise<boolean> {
  const lost = lostAttempts.get(who);
  if (!lost) return false;
  writeFor(who, { drawing: t`问服务端收没收到上一组…`, drawErr: "" });
  const recent = await listImageGroups();
  writeFor(who, { drawing: "" });
  const hit = recent?.find((g) => matchesAttempt(g, lost));
  if (hit) {
    await claimLost(who, lost, hit.id);
    return true;
  }
  if (recent) {
    lostAttempts.delete(who);
    return false;
  }
  writeFor(who, {
    drawErr: t`没问到服务端收没收到上一组（网络断了一下）—— 为了不让同一组画面付两次钱，这一次先不开新的一组；过一会儿再点一次（问一下不花钱）`,
  });
  return true;
}

/**
 * 受理那一发没收到回包：问服务端这个人最近的几组里有没有那一组（matchesAttempt），有就认领（任务号写进 rec 落盘，接着等）。
 * ★ 必须卡时间：服务端其实没受理的话，最近的那一组是十几分钟前的旧一组 —— 认成它，旧图就按新分镜的下标摆进格子里了
 * ★★ 三个结局分开（2.62 发版评审抓到）：{ id } = 认领了（任务号）；none = 服务端说了没有；unknown = **没问到**（listImageGroups 回 null，
 *   隔几秒再问、一共问三次）—— 原来没问到也当「没有」，付过钱的那一组就没人去取了。unknown 时调用方把这一次记下来（任务号空着），接着等时再问。
 */
async function adoptLost(who: string, rec: ParkedGroup): Promise<{ id: string } | "none" | "unknown"> {
  for (let k = 0; ; k++) {
    const recent = await listImageGroups();
    if (recent) {
      const hit = recent.find((g) => matchesAttempt(g, rec));
      if (!hit) return "none";
      writeParked(who, { ...rec, id: hit.id });
      return { id: hit.id };
    }
    if (k >= 2) return "unknown";
    await new Promise((r) => setTimeout(r, 3_000 * (k + 1)));
  }
}

/** 一组画完（或接着等完）：等取图收尾、撤掉落盘记录、本机账本按拿到手的张数记、写结局那一句（一张都没有时写失败原因）。回拿到手几张 */
async function settleGroup(who: string, st: ImageGroupState, asked: number, pending: Promise<void>[], notes: string[]): Promise<number> {
  await Promise.all(pending);
  writeParked(who, null);
  const got = st.images.length;
  // 本机账本（dev 直连 / 离线账本）按拿到手的张数记；正式包是服务端结算，这一行是空操作（account.spendTokens）
  if (AI_REAL && got && !st.prepaid) spendTokens(got * IMAGE_TOKENS);
  const sep = t({ message: "；", comment: "把几条说明连成一句时的分隔符" });
  // 一张都没有时，下面那句失败的话已经说全了：groupNote 的「N 格模型没画」在连不上 / 断了的时候还会误导（模型根本没收到）
  const note = [got ? groupNote(st, asked) : "", ...notes].filter(Boolean).join(sep);
  writeFor(who, { groupId: "", drawNote: note });
  if (!got) writeFor(who, { drawErr: groupFailLine(st) });
  return got;
}

/**
 * 这一发没到方舟：服务端连不上出图服务（一张都没画、预扣全退，再点一次就行）。
 * ★ 认码：上游回 5xx、回包里又读不出错误码时，组图任务记成 `HTTP_<状态>`。**线上这版（server dfaa77c）连不上时码是空的**，原话是网关那句固定的机器话
 *   `ark upstream <错误名>`（services/arkGateway：Node fetch 连不上 / 超时 —— 2026-10-06 付费验证撞到 TypeError，10.6 秒 = 连接超时），
 *   所以码空时再认这句兜底。它不是界面文案、不进目录；哪天措辞变了只会退回照抄原话，不会把别的失败认成连不上。
 */
function groupUpstreamDown(st: ImageGroupState): boolean {
  return /^HTTP_50[234]$/.test(st.code) || (!st.code && /^ark upstream \w/.test(st.message));
}

/** 单张出图（单画一格）的同一种失败：服务端网关回 502/503/504。认状态码，不认 message */
function upstreamDown(e: unknown): boolean {
  return e instanceof ArkHttpError && e.status >= 502 && e.status <= 504;
}

/**
 * 一张都没画出来时给人看的那一句（0 张 = 预扣全退 / 没扣）。认码说人话，认不出才照抄原话。
 * ★ 方舟的原话是英文（「The request failed because the input text may contain sensitive information.」）；连不上时是网关的机器话 —— 都别原样摆。
 */
function groupFailLine(st: ImageGroupState): string {
  if (groupUpstreamDown(st)) return t`画面没出成：这次没连上出图服务（多半是网络抖了一下），一张都没画、钱全退了——再点一次「画出这一组」就行`;
  if (st.code === "INTERRUPTED") return t`画面没出成：连接断了，一张都没收到、钱全退了——再点一次「画出这一组」就行`;
  if (/Sensitive/i.test(st.code)) return t`画面没出成：分镜里有内容没过内容审核，一张都没画、钱全退了——改改写法再画`;
  const why = st.message || st.code || t`原因不明`;
  return t`画面没出成：${why}（一张都没画出来，钱全退了）`;
}

/**
 * 接着等上一组（向导打开时发现 localStorage 里有受理过、还没取回来的那一组，或人点「接着等上一组」）：恢复那一版分镜，轮询到有结局、把图取回来。
 * ★ 向导里的分镜在画面那几样（景别 / 画面 / 有谁）上改过时，恢复当时那一版（格子与图按 cells 对应）—— 画面就是按那一版画的。
 *   所以向导只在不会换掉什么的时候自动接（resumeReplacesDraft 为假），否则由人点那颗写明「会换回去」的键，或者放弃上一组。
 * ★★ 向导里还是同一版分镜时（接回失败之后人没改过分镜），**已经有画面的格子留着**：之前取回来的、人单独画过（付过钱）的都不清，
 *   absorb 也不再取、不再看一遍；落盘记录里看过一遍的那几张直接摆上结论（checks）。原来一律整张清空、重取、每张再看一遍
 *   （2.62 发版评审抓到：单画的钱白花、看图的钱收两次，超出按钮上「最多」那个数）。分镜本身也留着向导里现在的那一份（动作 / 整体交代
 *   改过的不换回去，sameShots）；留着人单独画的那一张、这一组的图没换上去的格子，结局那一句当面说（它们也算在按张结算里）。
 * ★ 有一格正在单独画 / 取图时不接（向导那颗键也灰着）：接着等会把那一格清掉，单画回来又跟这一组抢同一格（第二轮评审抓到）。
 * ★ 当时选的人与场景卡一并还原（只在向导里那一项空着时：App 重开后它们本来就是空的；人这一次已经重新选过就不替他改）。
 *   还原不了的（老记录没记、卡被删了）由 gridCastIssue 在重画与落段那一步拦下。
 * ★ 任务号空着的记录（受理那一发没收到回包、当时没问到服务端收没收到）：先问（adoptLost）—— 收到了就认领、接着等；
 *   服务端最近的几组里没找到就撤掉记录（那一次记进内存 lostAttempts：再点「画出这一组」时再对一次）；还是没问到就留着，下次再问。
 *   ★★ 接回来会换掉向导里现在的分镜时（resumeReplacesDraft），**先问、问到了才换**（2.62 发版评审第三轮抓到）：原来一律先换再问，
 *   而这种记录多半是服务端压根没收到 —— 问回来「没有 / 没问到」时，人改过的分镜和单独画过（付过钱）的格子已经白白被换掉了。
 *   换不掉什么的时候（向导是空的 —— App 重开过 / 还是同一版分镜）照旧先换：问回来「没有」时，人至少拿回了那一版分镜、能直接重新画。
 * ★ 空镜与特写不在组图里：接着等完**不替人单画**（App 重开过，别在人没点的时候花钱），在结局那句里说一声、让人点开那一格自己画。
 */
export async function resumeGroup(): Promise<void> {
  const who = ownerOfDraft();
  const g = parkedGroupOf(who);
  const s0 = useGridDraft.getState();
  if (!g || s0.drawing || s0.writing || s0.panels.some((p) => !!p?.busy)) return;
  const cells = g.cells ?? g.shots.map((_, i) => i);
  const asking = !g.id;
  const firstLine = asking ? t`问服务端收没收到上一组…` : t`接着等上一组…`;
  const job = startJob({ kind: "grid-draw", title: t`九宫格分镜 · 出画面`, page: currentRoute(), route: currentRoute(), progress: firstLine });
  /**
   * 把向导换成接回来用的那一份，回接回来用的分镜：同一版就是向导里现在那一份（画面那几样逐格一样，动作 / 整体交代按人改过的），
   * 否则换回画这一组时的那一版。留下的格子：同一版分镜、有画面、按的正是这一格这一版（panelStale 判否）。
   */
  const swapIn = (id: string, line: string): GridShot[] => {
    const s = useGridDraft.getState();
    const same = sameShots(s.shots, g.shots);
    const shots = same ? s.shots : g.shots;
    const panels = shots.map((shot, i) => {
      const p = same ? (s.panels[i] ?? null) : null;
      return p?.image && !panelStale(p, shot) ? p : null;
    });
    if (g.castIds) restoreCast(g.castIds);
    useGridDraft.setState({
      placeId: s.placeId ?? g.placeId ?? null,
      scene: s.scene || g.scene,
      shots,
      lead: same ? s.lead : g.lead,
      lang: same ? s.lang : g.lang,
      aspect: g.aspect ?? s.aspect,
      shotsScene: s.shotsScene || g.scene,
      panels,
      picks: same ? s.picks.filter((i) => !!panels[i]) : [],
      groupId: id,
      step: "draw",
      drawing: line,
      drawErr: "",
      drawNote: "",
    });
    return shots;
  };
  /** null = 还没换（先问、问到了才换）。问的那几秒里 drawing 亮着：改分镜 / 单画 / 写分镜那几条路都被它挡着，换的时候向导还是这一份 */
  let resumed: GridShot[] | null = asking && resumeReplacesDraft(who) ? null : swapIn(g.id, firstLine);
  if (!resumed) writeFor(who, { step: "draw", drawing: firstLine, drawErr: "" });
  const fetched = new Set<number>();
  const pending: Promise<void>[] = [];
  /** 留着人单独画的那张、这一组的图没换上去的格子（absorb 收，结局那一句说） */
  const kept = new Set<number>();
  try {
    let id = g.id;
    if (!id) {
      const r = await adoptLost(who, g);
      if (r === "none") {
        writeParked(who, null);
        // 「没有」可能只是服务端还没落库：记进内存，人再点「画出这一组」时再对一次（lostAttempts）
        lostAttempts.set(who, g);
        // ★ 只说「没找到」，不说「没收到」（第三轮评审抓到）：认领按受理时刻对（matchesAttempt：手机时钟对服务端时钟、前后三分钟，
        //   只看最近的几组），两边时钟差得多时，服务端收到了、照样在画、照样按张收钱的那一组也对不上。
        //   钱上那句照受理那一发的那一档说（这份记录只在受理那一发没收到回包时才会是任务号空着的，drawGroup）—— ai/failCharge 一处，指去余额核对
        const money = chargeNote(chargeOnFail(new ArkNoReply("")), IMAGE_TOKENS * cells.length);
        const moneyLine = money?.line ?? "";
        writeFor(who, {
          drawErr: money
            ? t({
                message: `服务端最近的几组里没找到上一组，多半是没收到。${moneyLine}要画就重新画这一组`,
                comment: "moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
              })
            : t`服务端最近的几组里没找到上一组，多半是没收到——重新画这一组就行`,
        });
        job.fail(t`九宫格分镜的上一组在服务端没找到`);
        return;
      }
      if (r === "unknown") {
        writeFor(who, { drawErr: t`还是没问到服务端收没收到上一组（网络不稳）——网好了再点「接着等上一组」` });
        job.fail(t`九宫格分镜的上一组还没问到`);
        return;
      }
      id = r.id;
      const line = t`接着等上一组…`;
      if (!resumed) {
        // 问的那几秒里换了账号：记录已经补上任务号（adoptLost），不往别人的向导里换 —— 等那个人打开向导时由他接（claimLost 同一条）
        if (ownerOfDraft() !== who) {
          writeFor(who, { drawErr: claimedLine() });
          job.fail(t`九宫格分镜的画面还没取回来——回到那一页接着取`);
          return;
        }
        resumed = swapIn(id, line);
      } else writeFor(who, { groupId: id, drawing: line });
      job.update(line);
    }
    // 走到这里一定换过了（先换的那条路一开头就换了，先问的那条路问到了才换）—— ?? 只是让类型认得出来
    const shots = resumed ?? swapIn(id, t`接着等上一组…`);
    const keys = shots.map(shotKey);
    const n = shots.length;
    const st = await drawShotGroup({
      shots: cells.map((i) => shots[i]),
      lead: g.lead,
      cast: [],
      place: null,
      aspect: g.aspect ?? undefined,
      resumeId: id,
      onUpdate: (u) => {
        absorb(who, keys, cells, shots, u, fetched, pending, g.checks, kept);
        const k = drawnOf(who);
        const line = t`画好 ${k}/${n} 格（一组约几分钟，可以先离开）`;
        writeFor(who, { drawing: line });
        job.update(line);
      },
    });
    const got = await settleGroup(who, st, cells.length, pending, []);
    const listSep = t({ message: "、", comment: "列举几个名字时的分隔符" });
    const sep = t({ message: "；", comment: "把几条说明连成一句时的分隔符" });
    const extra: string[] = [];
    if (kept.size) {
      const list = [...kept]
        .sort((a, b) => a - b)
        .map((i) => i + 1)
        .join(listSep);
      extra.push(t`第 ${list} 格你之前单独画过，留着你画的那一张；这一组里这几格也画了（按画出来的张数结算时算在里面），没有换上去`);
    }
    // 只说还空着的那几格（人之前已经单独画过的不用再画）
    const rest = shots.map((_, i) => i).filter((i) => !cells.includes(i) && !stateFor(who)?.panels[i]?.image);
    if (got && rest.length) {
      const list = rest.map((i) => i + 1).join(listSep);
      extra.push(t`第 ${list} 格是空镜或特写，不放进组图：点开那一格单独画`);
    }
    if (extra.length) {
      const before = stateFor(who)?.drawNote ?? "";
      writeFor(who, { drawNote: [before, ...extra].filter(Boolean).join(sep) });
    }
    closeJob(who, job);
  } catch (e) {
    await Promise.all(pending);
    if (e instanceof ArkHttpError && e.status === 404) {
      // 查不到了（过期 / 不是这个账号的）就别再记着
      writeParked(who, null);
      const why = e.message;
      writeFor(who, { drawErr: t`上一组的画面没接回来：${why}` });
      job.fail(t`九宫格分镜的画面没接回来`);
      return;
    }
    // 断网之类的：记录留着（服务端照样在画），点「接着等上一组」或下次打开再接
    writeFor(who, { drawErr: stillDrawingLine(e) });
    job.fail(t`九宫格分镜的画面还没取回来——回到那一页接着取`);
  } finally {
    writeFor(who, { drawing: "", groupId: "" });
  }
}

/**
 * 这张组图已经看过一遍的结论（取回来就直接摆上、不再看）：取图失败时留在那一格上的（fetchPanel），或落盘记录里按链接记的（rememberCheck）。
 * ★ 「重新取」那条路只问它（第三轮评审抓到：原来不传，上一进程看过的那一张重新取回来又看一遍，多收一次看图的钱）
 */
function knownCheckOf(who: string, p: GridPanel): StoredCheck | undefined {
  if (p.check && p.check.state !== "running") return p.check;
  return p.url ? parkedGroupOf(who)?.checks?.[p.url] : undefined;
}

/** 重新取这一格时 AI 还要不要看一遍（要看就多一次对话的钱）：向导那颗「重新取」键照它说价钱 */
export function refetchWillCheck(i: number): boolean {
  const p = useGridDraft.getState().panels[i];
  return !!p && !knownCheckOf(ownerOfDraft(), p);
}

/** 取图失败的那一格再取一次（图已经付过钱，链接 24 小时内还在）。看过一遍的不再看（knownCheckOf） */
export async function refetchPanel(i: number): Promise<void> {
  const who = ownerOfDraft();
  const s = useGridDraft.getState();
  const p = s.panels[i];
  if (!p?.url || p.busy) return;
  const known = knownCheckOf(who, p);
  patchPanel(who, i, (x) => (x ? { ...x, busy: "fetch", err: undefined } : x));
  await fetchPanel(who, i, p.url, p.key, s.shots[i], known);
}

/**
 * 单画一格：组图之后的空镜 / 特写 / 落单的那一格，与单格重画**同一个函数**。提示词 gridShots.panelPrompt，出图 ai/real.drawGridPanel，画完看一遍。
 * ★ 带什么图：空镜 = 这一组里定画风的那一格（gridShots.styleRefIndex）+ 场景卡，**一张人物图都不带**；特写 = 只带这一格里的人；
 *   别的格 = 这一格里的人 + 场景卡。人物与场景的图、「图几是什么」走 ai/real.shotGroupRefs（这一格里的人**都**带、逐张标用途）。
 * ★ 「这一格里有谁」认 shot.who（模型明说的），不按名字在句子里找（gridShots 文件头）。
 * ★ 钱：出图成功才扣（AI_REAL 下记本机账本；正式包服务端按调用结算）；失败按类型说钱花没花（ai/failCharge）。看一遍那一笔在 checkPanel 里另记。
 * @returns 画成没有
 */
async function drawPanelAt(
  who: string,
  i: number,
  shot: GridShot,
  o: { cast: Card[]; place: Card | null; ask: string; aspect: VideoAspect; lead: string },
): Promise<boolean> {
  const before = stateFor(who)?.panels[i] ?? null;
  patchPanel(who, i, (p) => ({ image: p?.image ?? "", url: p?.url, key: p?.key ?? "", busy: "redraw" }));
  try {
    const kind = panelKindOf(shot);
    let styleRef = "";
    if (kind === "empty") {
      const cur = stateFor(who);
      const k = cur ? styleRefIndex(cur.shots, cur.panels.map((p) => !!p?.image), i) : -1;
      styleRef = k >= 0 ? (cur?.panels[k]?.image ?? "") : "";
    }
    const { refs, labeled } = await shotGroupRefs({
      cast: kind === "empty" ? [] : castOfShot(o.cast, shot),
      place: kind === "close" ? null : o.place,
      panels: 1,
      before: styleRef ? 1 : 0,
    });
    const prompt = panelPrompt({ shot, lead: o.lead, ask: o.ask, bind: labeled, framing: gridFraming(aspectOf(o.aspect).ratio), styleRef: !!styleRef });
    const image = await drawGridPanel(prompt, { aspect: o.aspect, refs: [...(styleRef ? [styleRef] : []), ...refs] });
    if (AI_REAL) spendTokens(IMAGE_TOKENS); // 出图成功才扣，与「重画这一套」同口径
    patchPanel(who, i, () => ({ image, key: shotKey(shot) }));
    void checkPanel(who, i, shot, image);
    return true;
  } catch (e) {
    // 连不上出图服务时原话是「Ark /images/generations 504: {"message":"ark upstream TypeError"}」—— 说人话（判据见 upstreamDown）
    const why = upstreamDown(e) ? t`这次没连上出图服务（多半是网络抖了一下），再点一次就行` : e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), IMAGE_TOKENS);
    const moneyLine = money?.line ?? "";
    const again = !!before?.image;
    const err = money
      ? again
        ? t({
            message: `重画没成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
        : t({
            message: `这一格没画成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
      : again
        ? t`重画没成：${why}`
        : t`这一格没画成：${why}`;
    patchPanel(who, i, () => (before ? { ...before, busy: undefined, err } : { image: "", key: "", err }));
    return false;
  }
}

/**
 * 单格重画（一张图）：人点开那一格、（可选）补一句要求、点「重画这一格」。画法与组图之后的单画同一个函数（drawPanelAt）。
 * ★ 闸都在这里：这一格还没写画面 / 这一格里的人没选上（gridCastIssue）/ 余额不够 —— 都在花钱之前拦下。
 */
export async function redrawPanel(i: number, o: { cast: Card[]; place: Card | null; ask: string }): Promise<void> {
  const s = useGridDraft.getState();
  const shot = s.shots[i];
  if (!shot || s.drawing || !s.aspect || s.panels[i]?.busy) return;
  if (!shot.picture.trim()) {
    patchPanel(ownerOfDraft(), i, (p) => ({ image: p?.image ?? "", key: p?.key ?? "", err: t`这一格还没写画面` }));
    return;
  }
  // 这一格里的人有谁没选上：一张卡图都带不上、会画成陌生人（10-06 付费验证那 ¥0.20 就是这么白花的）—— 先拦下，不花钱
  const castIssue = gridCastIssue([shot], o.cast);
  if (castIssue) {
    patchPanel(ownerOfDraft(), i, (p) => (p ? { ...p, err: castIssue } : { image: "", key: "", err: castIssue }));
    return;
  }
  if (AI_REAL && !canAfford(PANEL_REDRAW_TOKENS)) {
    const price = fmtTokens(PANEL_REDRAW_TOKENS);
    patchPanel(ownerOfDraft(), i, (p) => ({ image: p?.image ?? "", key: p?.key ?? "", err: frozenNote() ?? t`重画一格要 ${price} token，余额不够——去「我的」页充值` }));
    return;
  }
  await drawPanelAt(ownerOfDraft(), i, shot, { cast: o.cast, place: o.place, ask: o.ask, aspect: s.aspect, lead: s.lead });
}

/**
 * 挑中的格子里，画面是按**改之前**那版分镜画的那几格（第几格，从 1 起；按挑的先后）。
 * ★ 与对话正反打（DialogueWizard 的 stale）同一条规矩：过期的画面不许落段 —— 那张旧图会被钉成开头帧（上锁），
 *   而这一段的剧情与挂的人物卡按的是新分镜（比如画面里有沈舟、卡却按新分镜没挂他），出片时帧与卡对不上（2.62 发版评审抓到）。
 */
function stalePicks(d: Pick<GridDraft, "picks" | "shots" | "panels">): number[] {
  return d.picks.filter((i) => panelStale(d.panels[i], d.shots[i])).map((i) => i + 1);
}

/**
 * 这一格的画面是不是按**改之前**那版分镜画的（画面那几样改过：shotKey 对不上）—— 判据只有这一处（第三轮评审抓到原来抄了三份）。
 * 落段的闸（stalePicks / gridStaleIssue）、接着等时留哪几格（resumeGroup）、向导第③④步的「分镜改过」都问它：抄成几份的话，
 * 第④步的标记与落段的闸会对不上（标着没过期、落段却被拦下，或者反过来）。
 */
export function panelStale(p: GridPanel | null | undefined, shot: GridShot | undefined): boolean {
  return !!shot && !!p?.image && p.key !== shotKey(shot);
}

/** 挑中的格子里有过期画面时那一句（null = 没有）。落段（gridAppendSpecs）与向导的出片键问的都是它 */
export function gridStaleIssue(d: Pick<GridDraft, "picks" | "shots" | "panels">): string | null {
  const stale = stalePicks(d);
  if (!stale.length) return null;
  const list = stale.join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  return t`第 ${list} 格的分镜在画好之后改过，画面还是按原来那版画的——回第 3 步重画，或者回第 4 步把它取下`;
}

/** 挑中的那几格的分镜（按挑的先后；挑的格子已经不在了的跳过） */
export function pickedShots(d: Pick<GridDraft, "picks" | "shots">): GridShot[] {
  return d.picks.map((i) => d.shots[i]).filter((s): s is GridShot => !!s);
}

/** 这一格里的人（卡），按 shot.who 的先后（= 模型写的出场先后）排：出图 / 出片都按这个顺序给图 */
function castOfShot(cast: Card[], shot: GridShot): Card[] {
  return shot.who.map((n) => cast.find((c) => c.name === n)).filter((c): c is Card => !!c);
}

// ── 第④⑤步：挑格子、落段 ─────────────────────────────────────────────────────

/** 点一格：没挑就挑上（排在最后），挑过就取下（后面的往前挪） */
export function togglePick(i: number): void {
  const s = useGridDraft.getState();
  const p = s.panels[i];
  if (!p?.image) return;
  useGridDraft.setState({ picks: s.picks.includes(i) ? s.picks.filter((k) => k !== i) : [...s.picks, i] });
}

/**
 * 落成几段之后：清这场戏、分镜与画面、回到第①步，**留着场景卡**（人在 leadDraftStore，本来就留着）。
 * ★ 还没取回来的那一组（落盘记录）与「服务端当时说没有」的那一次一并撤掉：人已经拿这一场戏落了段，留着的话下次打开向导会自动接着等、
 *   把这一场的旧分镜整张换回来、跳回第③步（第二轮评审抓到）。那一组的钱照样按画出来的张数结算 —— 第⑤步的出片键旁边先当面说过
 *   「铺成之后就不再取回」（GridShotsWizard 的 parkedAtLay），想要那几张就先回第③步接着等。
 */
export function resetGridScene(): void {
  const s = useGridDraft.getState();
  const who = ownerOfDraft();
  writeParked(who, null);
  lostAttempts.delete(who);
  useGridDraft.setState({ ...initialGridDraft(s.placeId), mounted: s.mounted }, true);
}

/**
 * 挑中的那几格 → 交给 flowStore 落段的那几份（按挑的先后）。flowStore.appendSpecs 落段、appendSpecsQuote 报价读的是同一份。
 * ★★ 每一格落成一段**参考图直出段**（direct）：这一格的画面当开头帧、上锁（pinned.first —— AI 重画不许动它）、**不承接**上一段
 *   （chain:false：承接会拿上一段的真实尾帧把这一格整张顶掉，付费对比结论 3）。出片规则与 A / B 同一份（data/drawPlan）：
 *   收参考图的两档上帧当参考图发、画面里的人的图一起发、不补画；1.0 两档这一格当首帧硬约束（标准档照旧补画结束帧，报价里有）。
 * ★ 素材只挂**这一格里的人** + 场景卡（「这一镜有谁就只给谁的图」，multi-character 调研的结论）：一格一个镜头，多带别人的图只会把别人画进来。
 * ★ 方案标题存进作品（VideoSegment.title），按作者当时的界面语言定下来（与 B 的「主角定妆 · 多镜头」同一条先例）。
 * ★ 挑中的格子里有人没选上（gridCastIssue）就一段都不落：那一段的人物卡会挂空，出片时那个人的样子由视频模型自己编。
 *   向导把同一句话摆在出片键旁边（键因为没有可落的段而灰着）。
 * ★ 挑中的格子里有画面过期的（gridStaleIssue：分镜在画好之后改过）同样一段都不落，理由同上。
 */
export function gridAppendSpecs(
  d: Pick<GridDraft, "picks" | "shots" | "panels" | "lead" | "lang" | "scene">,
  o: { cast: Card[]; place: Card | null; tierId: string; aspect: VideoAspect; durationSec: number },
): AppendSpec[] {
  if (gridCastIssue(pickedShots(d), o.cast) || gridStaleIssue(d)) return [];
  return d.picks.flatMap((i) => {
    const shot = d.shots[i];
    const panel = d.panels[i];
    if (!shot || !panel?.image) return [];
    const n = i + 1;
    const p: Proposal = {
      id: uid("prop"),
      title: t`九宫格分镜 · 第 ${n} 格`,
      plot: panelPlot(shot, d.lead, d.lang),
      firstFrame: panel.image,
      lastFrame: "",
      durationSec: o.durationSec,
      pinned: { first: true },
    };
    const materials = [...castOfShot(o.cast, shot), ...(o.place ? [o.place] : [])];
    const spec: AppendSpec = {
      proposals: [p],
      chosenId: p.id,
      ...(materials.length ? { materials } : {}),
      videoTier: o.tierId,
      aspect: o.aspect,
      requirement: d.scene.trim(),
      chain: false,
      direct: true,
    };
    return [spec];
  });
}
