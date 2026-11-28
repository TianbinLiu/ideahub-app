/**
 * 对局**流程机**（相机与浮层唯一的阶段真相）——2026-11-28 主人这一轮点名的第一件事。
 *
 * 为什么要有它：在这之前"现在该摆哪一屏、相机该在哪"是散在组件里的 —— `GameLayer` 判 `state.phase`、
 * `shopOpen`、`previewOpen`，`GameLayer` 的商店 effect 又单独判一次 `phase === "shop" && shopOpen`，
 * `TableCatcher` 再按 `st.orbit` 判相机归谁。同一个问题（"现在在商店吗"）有三处在答，
 * 任何一处改口径（比如第 1 轮不自动开商店）另外两处就继续按老规矩走，界面上表现为"相机进了商店、
 * 商店栏没开"或"商店栏开了、相机还在俯视"。这一轮把**所有阶段判断**收进这一个文件：
 *
 *   matching → stylePick → table → shop → placing → generating → waiting → voting → leaderboard → nextPhase
 *
 * ★ 与 rules 的 `GamePhase` 是两层，不是替换：`GamePhase` 是**规则闸**（卖卡只能在 shop、交片只能在
 *   create……；见 types.GamePhase 的 ★），这一份是**流程/镜头**（哪一屏、相机在哪）。
 *   两层一一对应由 `reconcileMatchFlow` 一处翻译，组件不再自己拼条件。
 *   继承关系：`table` = rules.phase "shop" 且商店栏收起；`placing` = rules.phase "create"；
 *   `voting` 含老界面的 screening + voting 两屏（投票页是下一轮的事，这里先占位）；
 *   `leaderboard` 含老界面的 round-end / event / over（结算小窗是下一轮的事，这里先占位）。
 * ★ 零运行时依赖：只 `import type` 规则层的 GamePhase。scripts/check-game-matchflow.mjs 直接 import
 *   这一份跑正反例（与 rules / phases 同一条纪律：检查脚本用的就是线上那一份，不另写一遍）。
 * ★ 界面**不许**再自己写 `phase === "shop" && shopOpen` 这种组合：要阶段就问 `stage`，要开关就问
 *   store.toggleShop / matchFlow.setShopOpen。
 */

/** 一局从匹配到下一阶段的全过程。顺序与主人给的那条链严格一致。 */
export type MatchStage =
  | "matching"
  | "stylePick"
  | "table"
  | "shop"
  | "placing"
  | "generating"
  | "waiting"
  | "voting"
  | "leaderboard"
  | "nextPhase";

/**
 * 阶段顺序的唯一一份（检查脚本与文档都读它）。
 * ★ 它**不是**"只能沿这个方向走"：商店可以从 table 打开、也可以回到 table；生成失败可以回 placing。
 *   允许的转移在下面每个函数里逐条写（不写一个万能 transition 表 —— 那样错误转移会被静默吞掉）。
 */
export const MATCH_STAGES: readonly MatchStage[] = [
  "matching",
  "stylePick",
  "table",
  "shop",
  "placing",
  "generating",
  "waiting",
  "voting",
  "leaderboard",
  "nextPhase",
];

/**
 * 流程机的全部状态。
 * ★ `phaseIndex` 是**0 起始的第几期**（第 1 回合 = 0）。规则层的 `GameState.round` 是 1 起始，
 *   两者差 1 —— 第 1 轮不开商店这条判据必须拿 0 起始来判（`shopAutoOpen(phaseIndex)`），
 *   拿 round 直接判会变成"第 2 轮起才不开"，线上表现是"第一轮自动开了商店"。
 */
export interface MatchFlowState {
  stage: MatchStage;
  /** 0 起始：第 1 回合 = 0，第 2 回合 = 1…… */
  phaseIndex: number;
}

/** 还没开一局 / 正在匹配：镜头归大厅那一套（scene/matchCam），流程机什么都不管。 */
export const INITIAL_MATCH_FLOW: MatchFlowState = { stage: "matching", phaseIndex: 0 };

/** 对局建起来（匹配完成）：整屏浮层选视频风格（3D 已切到室内，浮层盖在上面）。 */
export function matchFlowAfterStart(): MatchFlowState {
  return { stage: "stylePick", phaseIndex: 0 };
}

/** rules.round（1 起始）→ phaseIndex（0 起始）。坏值按第 1 期算，不把 NaN 传给镜头。 */
export function phaseIndexOf(round: number): number {
  return Number.isFinite(round) ? Math.max(0, Math.floor(round) - 1) : 0;
}

/**
 * ★★ 第 1 轮**不**自动开商店（主人点名，2026-11-28）。
 *
 * 原来 finishStyle / nextRound 都无条件 `shopOpen: true`，第一轮一进来就是商店栏 + 相机贴着铸卡师 ——
 * 而这一轮要的是"先看桌子、选完风格回桌面，玩家手上没有卡，自己点商店才开"。
 * 判据只在**这一个函数**里：`phaseIndex === 0` = 第一轮 = 不开；第 2 轮起照旧自动开
 * （回合间要发利息、要买卡，跳过商店等于让玩家多按一次键）。
 */
export function shopAutoOpen(phaseIndex: number): boolean {
  return phaseIndex > 0;
}

/** 商店按钮能按的两个阶段（桌面 / 商店本身）。生成中、投票页、排行榜里都没有商店可开。 */
export function canToggleShop(stage: MatchStage): boolean {
  return stage === "table" || stage === "shop";
}

/**
 * 商店开关（**幂等**）：目标态与当前一致就原样返回同一个对象。
 * ★ 为什么"同一个对象"也要保证：store 的 set 里 `match` 引用变了就会触发订阅重渲；
 *   而这一下通常来自 StrictMode 的双跑 / 连点商店键 —— 引用不变 = 不抖。
 * ★ 不在可开商店的阶段（placing / generating / waiting / voting / leaderboard）**什么都不做**，
 *   绝不"顺手把 stage 改成 shop"：那会把创建页顶掉、把生成中的相机抢走。
 */
export function setShopOpen(flow: MatchFlowState, open: boolean): MatchFlowState {
  if (!canToggleShop(flow.stage)) return flow;
  const stage: MatchStage = open ? "shop" : "table";
  return flow.stage === stage ? flow : { ...flow, stage };
}

/** 开始出片（画首帧不算；真的点了生成/出片那一发才进来）。只能在桌面 / 摆卡两格进。 */
export function startGenerating(flow: MatchFlowState): MatchFlowState {
  if (flow.stage !== "placing" && flow.stage !== "table") return flow;
  return { ...flow, stage: "generating" };
}

/** 出片结束（成功 / 失败都回摆卡页：失败要能改提示词重试）。 */
export function finishGenerating(flow: MatchFlowState): MatchFlowState {
  return flow.stage === "generating" ? { ...flow, stage: "placing" } : flow;
}

/** 交片了：这一期在等其他人（联机的"等其他人"、单机交给 AI 也是同一格）。 */
export function markSubmitted(flow: MatchFlowState): MatchFlowState {
  if (flow.stage === "waiting") return flow;
  if (flow.stage !== "placing" && flow.stage !== "generating" && flow.stage !== "table") return flow;
  return { ...flow, stage: "waiting" };
}

/** 重交 / 改片：从"等其他人"回到摆卡页（rules 允许改提示词重交）。 */
export function backToPlacing(flow: MatchFlowState): MatchFlowState {
  return flow.stage === "waiting" ? { ...flow, stage: "placing" } : flow;
}

/**
 * 全员就绪 → 视频投票页（专用全屏页，轮流播放每人的段）。
 * ★ 投票页本身是下一轮的事；这一轮只保证流程机能**进得去、出得来**（占位）。
 */
export function enterVoting(flow: MatchFlowState): MatchFlowState {
  if (flow.stage === "voting") return flow;
  // 只从"等其他人 / 桌面 / 摆卡"进；从 stylePick 直接进投票是坏状态，按不动处理。
  if (flow.stage !== "waiting" && flow.stage !== "placing" && flow.stage !== "table") return flow;
  return { ...flow, stage: "voting" };
}

/** 投票页全部投完 → 当前分数排行榜小窗（下一轮做；先占位）。 */
export function openLeaderboard(flow: MatchFlowState): MatchFlowState {
  if (flow.stage === "leaderboard") return flow;
  if (flow.stage !== "voting" && flow.stage !== "waiting") return flow;
  return { ...flow, stage: "leaderboard" };
}

/** 关掉排行榜 → nextPhase（发利息、进下一期之前的过渡格）。 */
export function closeLeaderboard(flow: MatchFlowState): MatchFlowState {
  return flow.stage === "leaderboard" ? { ...flow, stage: "nextPhase" } : flow;
}

/**
 * nextPhase → 下一期的桌面 / 商店。
 * ★ 第 2 期起自动开商店（`shopAutoOpen(1) === true`）；第一期的 nextPhase 理论上走不到，
 *   但真走到也只会回到桌面（不开商店）—— 判据与 finishStyle 同一条，不另写。
 */
export function advancePhase(flow: MatchFlowState, nextPhaseIndex: number): MatchFlowState {
  if (flow.stage !== "nextPhase") return flow;
  const phaseIndex = Number.isFinite(nextPhaseIndex) ? Math.max(0, Math.floor(nextPhaseIndex)) : flow.phaseIndex;
  return { stage: shopAutoOpen(phaseIndex) ? "shop" : "table", phaseIndex };
}

/**
 * 规则阶段 → 流程阶段（store 的**唯一同步点**，每个动作写回 state 之后自动跑一次）。
 *
 * ★ 为什么要"从规则阶段反推"而不是让每个 action 各写一次 match：这一层有 20 多个动作，
 *   漏一个的后果是那一屏/那台相机停在上一格。反推只有这一份翻译表，漏不了。
 * ★ `generating` / `waiting` 在 rules.phase 里**看不出来**（都属于 create），所以这两格在 create 时
 *   原样保留；一旦离开 create（进 screening / 下一期商店），它们被下面这张表覆盖掉 —— 不会残留。
 * ★ `style` 与 `ready` 都算 stylePick：ready 是"我选完了、AI 还没选完"，那一屏仍旧是风格卡
 *   （StylePick 自己有"接着开局"的兜底），切换到一个空白对局桌面反而像是卡住了。
 */
export function reconcileMatchFlow(
  flow: MatchFlowState,
  input: { phase: import("./types").GamePhase | null; shopOpen: boolean },
): MatchFlowState {
  const { phase, shopOpen } = input;
  if (phase === null) return INITIAL_MATCH_FLOW;
  let stage: MatchStage;
  switch (phase) {
    case "style":
    case "ready":
      stage = "stylePick";
      break;
    case "shop":
      // 商店栏开着 = shop；收起 = 桌面（第 1 轮不自动开商店就落在这里：phase 是 shop、shopOpen 是 false）
      stage = shopOpen ? "shop" : "table";
      break;
    case "create":
      // 出片 / 等其他人这两格不在规则阶段里，保留现场（见函数头 ★）
      stage = flow.stage === "generating" || flow.stage === "waiting" ? flow.stage : "placing";
      break;
    case "screening":
    case "voting":
      stage = "voting";
      break;
    case "event":
    case "round-end":
    case "over":
      stage = "leaderboard";
      break;
  }
  if (flow.stage === stage) return flow;
  return { ...flow, stage };
}

/**
 * 流程阶段 → 对局相机（三机位里的哪一台）。
 * ★ `off` = 镜头不归这一套（大厅 / 匹配页 / 工坊日常），交给 scene/matchCam 与 studioStore 原有那一套。
 *   `shop` 是唯一允许自由环视的一格（见 scene/gameCam.ts 的 freeLookEnabled）。
 * ★ 投票页 / 排行榜是下一轮的全屏页：这一轮相机仍停在桌面机位（全屏页会盖住它），
 *   等那两屏做出来时把这里改成 `off` 即可 —— 判据只在这一处。
 */
export function cameraModeOf(stage: MatchStage): "off" | "tableTop" | "npcFront" {
  if (stage === "matching") return "off";
  if (stage === "shop") return "npcFront";
  return "tableTop";
}

/** 自由环视只在这一格允许（离开商店立即禁用 —— 主人点名的那条）。 */
export function freeLookOf(stage: MatchStage): boolean {
  return stage === "shop";
}
