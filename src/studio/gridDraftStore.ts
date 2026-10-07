// 跟着做 C「九宫格分镜」向导的**全部**状态 —— 活在 store 里，不活在组件里（2026-10-05 第三期，方案 docs/guided-modes-design.md §二 C、§七）。
//
// ★★ 为什么（与 leadDraftStore / customCardStore 同一个理由）：向导里有三件花钱的长活 —— AI 写分镜（一次对话）、出一组画面
//   （组图，6 张约 4 分钟、9 张约 6 分钟）、单格重画（一张图）。画布那一面的向导是个抽屉，点一下遮罩就关了；工坊那一面退回选法屏它就卸了。
//   结果写进组件 state 的话，付过钱的画面静默丢掉。放在这里：关了再开原样还在；两个面开的是同一份（同一时刻只会开一个）。
//   出一组画面另外领一张后台任务票（data/jobs）：人不在向导里时由胶囊通知。
// ★★ 一组画面画到一半 App 被系统回收 / 重开：服务端那一组照样画完、照样按张结算（契约「组图」）。受理那一拍把任务号连同那一版分镜
//   记进 localStorage（按账号分开），下次打开向导就接着等、把图取回来 —— 不记的话那几张已经付过钱的图就找不回来了。
//   dev 直连方舟（流式）的那种接不回来，不记。
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
  drawShotGroup,
  generateFrame,
  imageUrlToDataUrl,
  listImageGroups,
  shotGroupRefs,
  type ImageGroupState,
} from "../ai";
import { ArkHttpError } from "../ai/arkClient";
import { canAfford, frozenNote, spendTokens } from "../data/account";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import { CHAT_TURN_TOKENS, IMAGE_TOKENS, fmtTokens } from "../data/economy";
import { GRID_SHOTS_MAX, castGaps, panelMoment, panelPlot, panelRefLine, shotKey, type GridLang, type GridNote, type GridShot } from "../data/gridShots";
import { currentRoute, startJob } from "../data/jobs";
import { uid, type Card, type Proposal, type VideoAspect } from "../types";
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
interface ParkedGroup {
  id: string;
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
}
/** 方舟的图片链接 24 小时就失效：超过这么久的记录不再接 */
const PARKED_TTL_MS = 23 * 3600 * 1000;

function readParked(): Record<string, ParkedGroup> {
  try {
    const raw = localStorage.getItem(PARKED_KEY);
    const j = raw ? (JSON.parse(raw) as Record<string, ParkedGroup>) : {};
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}
function writeParked(owner: string, v: ParkedGroup | null): void {
  try {
    const all = readParked();
    if (v) all[owner] = v;
    else delete all[owner];
    localStorage.setItem(PARKED_KEY, JSON.stringify(all));
  } catch {
    /* 存不进去：这一组只是接不回来（画面照样在内存里），不拦正事 */
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
  return { ...g, castIds, placeId };
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
export async function writeShots(o: { cast: string[]; place: string }): Promise<void> {
  const s = useGridDraft.getState();
  if (s.writing || s.drawing) return;
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
  if (s.writing || s.drawing) return;
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
  if (s.drawing || i < 0 || i >= s.shots.length) return;
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

// ── 第③步：出一组画面 / 单格重画 ──────────────────────────────────────────────

/** 一组画面最多要多少（按上限报：方舟只收画出来的那几张，没画出来的退回 —— 契约「组图」） */
export function groupQuote(n: number): number {
  return IMAGE_TOKENS * n;
}
/** 单格重画一张 */
export const PANEL_REDRAW_TOKENS = IMAGE_TOKENS;

/** 审核没过的码（方舟原样）→ 一句人话 */
function failLine(code: string): string {
  return /SensitiveContent|Sensitive/i.test(code) ? t`这一格没过内容审核，没画出来（没收这一张的钱）——改改画面写法再单独重画` : t`这一格没画出来（没收这一张的钱）——单独重画一次`;
}

/**
 * 把这一组的最新进展落进格子里：新画好的那几张去取回来（方舟链接 → 本机 dataURL），没画成的那几格写上原因。
 * ★ 轮询每一次都回整份列表，取过的不再取（fetched 记着）；两张并行取，别把手机的流量一下子占满。
 */
function absorb(who: string, keys: string[], st: ImageGroupState, fetched: Set<number>, pending: Promise<void>[]): void {
  for (const f of st.failures) {
    if (f.index < 0 || f.index >= keys.length) continue;
    patchPanel(who, f.index, (p) => (p?.image ? p : { image: "", key: keys[f.index], err: failLine(f.code) }));
  }
  for (const img of st.images) {
    const i = img.index;
    if (i < 0 || i >= keys.length || fetched.has(i)) continue;
    fetched.add(i);
    patchPanel(who, i, () => ({ image: "", url: img.url, key: keys[i], busy: "fetch" }));
    pending.push(fetchPanel(who, i, img.url, keys[i]));
  }
}

async function fetchPanel(who: string, i: number, url: string, key: string): Promise<void> {
  try {
    const image = await imageUrlToDataUrl(url);
    patchPanel(who, i, () => ({ image, url, key }));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    patchPanel(who, i, () => ({ image: "", url, key, err: t`画好了、但没取回来（${why}）——点这一格重新取` }));
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

/**
 * 出一组画面（组图）—— 领一张后台任务票，画好一张多一张。结果写回开工那一拍那个人的向导。
 * @param o.cast 出场人物（卡），o.place 场景卡；画幅在 draft.aspect（画之前定）
 */
export async function drawGroup(o: { cast: Card[]; place: Card | null }): Promise<void> {
  const s = useGridDraft.getState();
  if (s.drawing || s.writing || !s.shots.length || !s.aspect) return;
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
  const who = ownerOfDraft();
  const page = currentRoute();
  const job = startJob({ kind: "grid-draw", title: t`九宫格分镜 · 出画面`, page, route: page, progress: t`准备参考图…` });
  const keys = shots.map(shotKey);
  const aspect = s.aspect;
  /** 跟着分镜一起记下来的人物与场景卡（App 重开后接着等时还原） */
  const castIds = o.cast.map((c) => c.id);
  const placeId = o.place?.id ?? null;
  useGridDraft.setState({ drawing: t`准备参考图…`, drawErr: "", drawNote: "", panels: shots.map(() => null), picks: [] });
  const fetched = new Set<number>();
  const pending: Promise<void>[] = [];
  const notes: string[] = [];
  const onUpdate = (st: ImageGroupState) => {
    absorb(who, keys, st, fetched, pending);
    const k = st.images.length;
    const n = shots.length;
    const line = t`画好 ${k}/${n} 格（一组约几分钟，可以先离开）`;
    writeFor(who, { drawing: line });
    job.update(line);
  };
  try {
    const st = await drawShotGroup({
      shots,
      lead: s.lead,
      cast: o.cast,
      place: o.place,
      aspect,
      onNote: (n) => notes.push(n),
      onUpdate,
      onStarted: (id) => {
        writeFor(who, { groupId: id });
        writeParked(who, { id, at: Date.now(), scene: s.scene, shots, lead: s.lead, lang: s.lang, aspect, castIds, placeId });
      },
    });
    await finishGroup(who, st, shots.length, pending, job, notes);
  } catch (e) {
    if (e instanceof ImageGroupBusy && e.id) {
      // 服务端说这个人已经有一组在画：是上一次受理过、还没取回来的那一组就接着等它（它记着自己的那一版分镜），否则说清楚
      const g = parkedGroupOf(who);
      if (g && g.id === e.id) {
        job.done({ silent: true });
        writeFor(who, { drawing: "" });
        await resumeGroup();
        return;
      }
      writeFor(who, { drawErr: t`上一组画面还在画（同一时间只能画一组）——几分钟后再来` });
      job.fail(t`上一组画面还在画`);
    } else if (e instanceof ArkNoReply && !import.meta.env.DEV && (await adoptLost(who, shots, s, aspect, castIds, placeId))) {
      // 受理那一发没收到回包、但服务端其实受理了：接回来接着等
      job.done({ silent: true });
      writeFor(who, { drawing: "" });
      await resumeGroup();
      return;
    } else {
      // 受理那一发就连不上（网关 / 代理回 502~504）：说人话，不摆「Ark … 504: {…}」（判据见 upstreamDown）
      const why = upstreamDown(e) ? t`这次没连上出图服务（多半是网络抖了一下），再点一次就行` : e instanceof Error ? e.message : String(e);
      const money = chargeNote(chargeOnFail(e), cost);
      const moneyLine = money?.line ?? "";
      writeFor(who, {
        drawErr: money
          ? t({
              message: `画面没出成：${why}。${moneyLine}`,
              comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
            })
          : t`画面没出成：${why}`,
      });
      job.fail(t`九宫格分镜的画面没出成，回去看原因`);
    }
    await Promise.all(pending);
  } finally {
    writeFor(who, { drawing: "" });
  }
}

/** 受理那一发没收到回包：问服务端这个人最近的几组里有没有刚开的那一组（张数对得上、三分钟内受理的），有就认领（任务号 + 这一版分镜记下来，接着等）。
 *  ★ 必须卡时间：服务端其实没受理的话，最近的那一组是十几分钟前的旧一组 —— 认成它，旧图就按新分镜的下标摆进格子里了 */
async function adoptLost(who: string, shots: GridShot[], s: GridDraft, aspect: VideoAspect, castIds: string[], placeId: string | null): Promise<boolean> {
  const recent = await listImageGroups();
  const hit = recent.find((g) => g.maxImages === shots.length && g.createdAt > 0 && Date.now() - g.createdAt < 3 * 60_000);
  if (!hit) return false;
  writeParked(who, { id: hit.id, at: Date.now(), scene: s.scene, shots, lead: s.lead, lang: s.lang, aspect, castIds, placeId });
  return true;
}

async function finishGroup(
  who: string,
  st: ImageGroupState,
  asked: number,
  pending: Promise<void>[],
  job: ReturnType<typeof startJob>,
  notes: string[],
): Promise<void> {
  await Promise.all(pending);
  writeParked(who, null);
  const got = st.images.length;
  // 本机账本（dev 直连 / 离线账本）按拿到手的张数记；正式包是服务端结算，这一行是空操作（account.spendTokens）
  if (AI_REAL && got && !st.prepaid) spendTokens(got * IMAGE_TOKENS);
  const sep = t({ message: "；", comment: "把几条说明连成一句时的分隔符" });
  // 一张都没有时，下面那句失败的话已经说全了：groupNote 的「N 格模型没画」在连不上 / 断了的时候还会误导（模型根本没收到）
  const note = [got ? groupNote(st, asked) : "", ...notes].filter(Boolean).join(sep);
  writeFor(who, { groupId: "", drawNote: note });
  if (!got) {
    writeFor(who, { drawErr: groupFailLine(st) });
    job.fail(t`九宫格分镜的画面没出成，回去看原因`);
    return;
  }
  job.done({ msg: t`九宫格分镜画好了 ${got} 格`, silent: who === ownerOfDraft() && useGridDraft.getState().mounted });
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

/** 单张出图（单格重画）的同一种失败：服务端网关回 502/503/504。认状态码，不认 message */
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
 * 接着等上一组（向导打开时发现 localStorage 里有受理过、还没取回来的那一组）：恢复那一版分镜，轮询到有结局、把图取回来。
 * ★ 当时那一版分镜原样恢复（格子与图按下标对应）：人在这期间改过的分镜会被换回去 —— 画面就是按那一版画的。
 * ★ 当时选的人与场景卡一并还原（只在向导里那一项空着时：App 重开后它们本来就是空的；人这一次已经重新选过就不替他改）。
 *   还原不了的（老记录没记、卡被删了）由 gridCastIssue 在重画与落段那一步拦下。
 */
export async function resumeGroup(): Promise<void> {
  const who = ownerOfDraft();
  const g = parkedGroupOf(who);
  const s = useGridDraft.getState();
  if (!g || s.drawing) return;
  const keys = g.shots.map(shotKey);
  const job = startJob({ kind: "grid-draw", title: t`九宫格分镜 · 出画面`, page: currentRoute(), route: currentRoute(), progress: t`接着等上一组…` });
  if (g.castIds) restoreCast(g.castIds);
  useGridDraft.setState({
    placeId: s.placeId ?? g.placeId ?? null,
    scene: s.scene || g.scene,
    shots: g.shots,
    lead: g.lead,
    lang: g.lang,
    aspect: g.aspect ?? s.aspect,
    shotsScene: s.shotsScene || g.scene,
    panels: g.shots.map(() => null),
    picks: [],
    groupId: g.id,
    step: "draw",
    drawing: t`接着等上一组…`,
    drawErr: "",
    drawNote: "",
  });
  const fetched = new Set<number>();
  const pending: Promise<void>[] = [];
  try {
    const st = await drawShotGroup({
      shots: g.shots,
      lead: g.lead,
      cast: [],
      place: null,
      aspect: g.aspect ?? undefined,
      resumeId: g.id,
      onUpdate: (u) => {
        absorb(who, keys, u, fetched, pending);
        const k = u.images.length;
        const n = g.shots.length;
        const line = t`画好 ${k}/${n} 格（一组约几分钟，可以先离开）`;
        writeFor(who, { drawing: line });
        job.update(line);
      },
    });
    await finishGroup(who, st, g.shots.length, pending, job, []);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // 查不到了（过期 / 不是这个账号的）就别再记着；断网之类的留着，下次打开再接
    if (e instanceof ArkHttpError && e.status === 404) writeParked(who, null);
    writeFor(who, { drawErr: t`上一组的画面没接回来：${why}` });
    job.fail(t`九宫格分镜的画面没接回来`);
    await Promise.all(pending);
  } finally {
    writeFor(who, { drawing: "", groupId: "" });
  }
}

/** 取图失败的那一格再取一次（图已经付过钱，链接 24 小时内还在） */
export async function refetchPanel(i: number): Promise<void> {
  const who = ownerOfDraft();
  const p = useGridDraft.getState().panels[i];
  if (!p?.url || p.busy) return;
  patchPanel(who, i, (x) => (x ? { ...x, busy: "fetch", err: undefined } : x));
  await fetchPanel(who, i, p.url, p.key);
}

/**
 * 单格重画（一张图）：带这一格里的人的卡图（没有人就只带场景卡）+ 这一格的画面 +（可选）补一句要求，走 generateFrame（与画帧同一个外壳）。
 * ★ 「这一格里有谁」认 shot.who（模型明说的），不按名字在句子里找：空镜就真的一张人物图都不带（gridShots 文件头）。
 * ★ 参考图与「图几是谁」与整组同一份（ai/real.shotGroupRefs：这一格里的人**都**带、逐张点名）—— 不走画帧那条「只带第一个人物」的老规矩：
 *   重画的这一格要与整组里的别的格子是同一批人，2026-10-05 付费对比里逐格重画就是这么带的（格子裁图 + 两个人的图），照文字改对了人。
 * ★ 钱：成功才扣（AI_REAL 下记本机账本；正式包服务端按调用结算）；失败按类型说钱花没花（ai/failCharge）。
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
  const who = ownerOfDraft();
  const before = s.panels[i];
  patchPanel(who, i, (p) => ({ image: p?.image ?? "", url: p?.url, key: p?.key ?? "", busy: "redraw" }));
  try {
    const notes: string[] = [];
    const { refs, bind } = await shotGroupRefs({ cast: castOfShot(o.cast, shot), place: o.place, panels: 1, onNote: (n) => notes.push(n) });
    const image = await generateFrame(`${panelMoment(shot, s.lead, o.ask)}${panelRefLine(bind)}`, {
      aspect: s.aspect,
      refs: refs.length ? refs : undefined,
    });
    if (AI_REAL) spendTokens(PANEL_REDRAW_TOKENS); // 出图成功才扣，与「重画这一套」同口径
    patchPanel(who, i, () => ({ image, key: shotKey(shot) }));
  } catch (e) {
    // 连不上出图服务时原话是「Ark /images/generations 504: {"message":"ark upstream TypeError"}」—— 说人话（判据见 upstreamDown）
    const why = upstreamDown(e) ? t`这次没连上出图服务（多半是网络抖了一下），再点一次就行` : e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), PANEL_REDRAW_TOKENS);
    const moneyLine = money?.line ?? "";
    const err = money
      ? t({
          message: `重画没成：${why}。${moneyLine}`,
          comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
        })
      : t`重画没成：${why}`;
    patchPanel(who, i, () => (before ? { ...before, busy: undefined, err } : { image: "", key: "", err }));
  }
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

/** 落成几段之后：清这场戏、分镜与画面、回到第①步，**留着场景卡**（人在 leadDraftStore，本来就留着） */
export function resetGridScene(): void {
  const s = useGridDraft.getState();
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
 */
export function gridAppendSpecs(
  d: Pick<GridDraft, "picks" | "shots" | "panels" | "lead" | "lang" | "scene">,
  o: { cast: Card[]; place: Card | null; tierId: string; aspect: VideoAspect; durationSec: number },
): AppendSpec[] {
  if (gridCastIssue(pickedShots(d), o.cast)) return [];
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
