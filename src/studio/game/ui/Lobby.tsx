// 对局大厅（2026-11-23）：进对局之前的那一屏 —— 4 人匹配 / 8 人匹配 / 自定义房间 / 凭码加入。
//
// ★ 流程：StudioPage 顶栏的「▶ 开局」不再直接开一局，而是先开这一屏（lobbyStore.openLobby）。
//   玩家选一种开局方式 → 建局（`ui/startFromLobby`，人数由大厅给）→ 大厅收掉、对局 UI 顶上来。
// ★ 为什么不塞进 GameLayer：那一层是"对局中"的仪表盘（它 `if (!state) return null`），
//   而大厅恰恰是**还没有 state** 的那一屏。两件事分开挂（StudioPage 里 `{isLand && <Lobby />}`），
//   竖屏两边都不挂（与对局一致，G1 的竖屏逐字节不变）。
//
// ★★ 三屏换皮（2026-11-27，design/ui-mockups/match-ui-variants；主人拍板 B / C / B）：
//   匹配页 = B「卡片桌游」（绒布 + 黄铜金 + 米白、衬线标题 + 手写体、三张厚卡 + 票根）；
//   匹配中 = C「沉浸全屏」（月亮被三圈呼吸光环围住，UI 收到屏幕边缘）；
//   加载页 = B（三张发牌顺序卡 + 黄铜进度环）。
//   · 三屏都**不盖满**：底是半透明绒布 / 冷色暗角，中间留给 3D 的窗与月亮
//     （只有老场景 / 取消过穿窗、没有窗可看时，bg-ink 才回来当实底）。
//   · 匹配逻辑一行没改：findMatch / 队列 / AI 补位 / 超时 / 房间全在 lobbyStore 与
//     useLobbyOnline 里；这里只换画法。
//   · 穿窗时间线一行没改：主键仍然 `await beginFlyThrough()`（接线在 startPicked）。
//   · 加载页是**开局前的过场**：startFromLobby 之前播 ~1.6 s 进度环，取消 = 什么都没发出去。
//     它不改变"谁在什么时候开局"，只是把黑幕换成一屏"正在铺桌"。
//
// ★ 不摆金币 / 血量（主人点名"别塞"）：大厅要回答的只有"这一局怎么开"，
//   那些数是**对局中**的读数，摆在这里既没用又要跟着对局状态走（大厅和局之间就会开始漂）。
//   例外是券与 token（2026-11-24 视觉 P0 / docs/game-lobby-ui-benchmark.md #4）：它们是"开一局要用多少"
//   的大厅级信息，摆顶栏，点开钱包；金币仍然只在对局里。
// ★ 联机（2026-11-24）：4/8 人匹配与自定义房间都先问能力位（api/game/rooms.roomsAvailable）；
//   接通了就进服务端队列 / 房间，没接通 / 超时 / 被拒一律自动退回本机 AI 补位，底栏留一句话。
//   轮询在 ui/useLobbyOnline（组件卸载 / 换屏就停）。
//
// ★★ 主 CTA 拆分（2026-11-24 视觉 P0，docs/game-lobby-ui-benchmark.md #13）：
//   点卡片**只负责选中**（`aria-pressed` + 金边 + ✓），真正开始的是那颗黄铜主键
//   （落座 · 匹配 N 人 / 开一间房 · 落座）。点卡片即进队的误触就是这么消掉的。
//
// ★ 历史 / 回放入口、券 / token、公开房、公开这间房开关全部保留（只是换了摆位）：
//   公开房入口挪到右列票根下方（左列三张厚卡 + 主键已经占满高度，第四张卡在 348px 上会顶到标题）；
//   公开这间房开关同理，是"建房那一下的一个选项"，放在右列底部仍然与「开一间房」挨着。
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router";
import { type MatchSize } from "../lobby";
import { useLobby } from "../lobbyStore";
import { lobbyFailureText, lobbyNoteText } from "../lobbyReasons";
import { useGame } from "../store";
import { ruleFailureText } from "../reasons";
import { useGameTickets } from "../../../hooks/useGameTickets";
import { useAccountVersion } from "../../../hooks/useAccount";
import { currentUser, walletOf } from "../../../data/account";
import { fmtTokens } from "../../../data/economy";
import { resetDayOf } from "../../../data/gameTicketRules";
import { serverGameHistory } from "../../../data/serverCaps";
import { UPGRADE_HREF } from "../../../components/UpgradeLink";
import { lastHistoryRoomFor, readLastHistoryRoom } from "../historyLastRoom";
import { readLatestLocalGame } from "../localHistory";
import { localGameOwner } from "../localHistoryOwner";
import { subscribeHistoryCache } from "../historyCache";
import { useHistory } from "../historyStore";
import { useBackLayer } from "../../../hooks/useBackLayer";
import {
  beginFlyThrough,
  cancelMatchCine,
  enterMatchPage,
  leaveMatchPage,
  useMatchCam,
} from "../../scene/matchCam";
import { useGsPhase } from "../../scene/gsStep0";
import { markLobbyOpened } from "../../scene/sceneSplit";
import { setGsHudHidden } from "../../scene/gsHud";
import GameBtn from "./GameBtn";
import RoomScreen from "./RoomScreen";
import PublicRooms from "./PublicRooms";
import MatchLobbyB, { type LobbyPick } from "./MatchLobbyB";
import SearchingC from "./SearchingC";
import DealingB from "./DealingB";
import { moonScreenRect } from "./moonAlign";
import { startFromLobby } from "./startFromLobby";
import { useLobbyOnline } from "./useLobbyOnline";
import { usePublicRoomsCap } from "./useSpectateCaps";
import HelpButton from "../../../components/guide/HelpButton";
import { useAutoGuide } from "../../../components/guide/useAutoGuide";

/** 开局过场（B 加载页）的时长：1.6 s ≈ 穿窗后"人已经到桌前"的呼吸感，又不至于让人等得烦。 */
const DEAL_MS = 1600;
/** DEV / 验收冻结时的进度（与设计稿 B-loading 的 62% 同一格，截图可比）。 */
const DEAL_HOLD_AT = 0.62;

/** 首屏选中的那一种开局方式在 startFromLobby 之前记下来的意图（加载页取消 = 什么都不发）。 */
interface Dealing {
  /** 座位数：4 / 8 是匹配，自定义房间是 2~8（所以不能收窄成 MatchSize） */
  size: number;
}

export default function Lobby() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const open = useLobby((s) => s.open);
  const screen = useLobby((s) => s.screen);
  const room = useLobby((s) => s.room);
  const matchSize = useLobby((s) => s.matchSize);
  const matchStartedAt = useLobby((s) => s.matchStartedAt);
  const rejection = useLobby((s) => s.rejection);
  const online = useLobby((s) => s.online);
  const remoteRoom = useLobby((s) => s.remoteRoom);
  const queue = useLobby((s) => s.queue);
  const note = useLobby((s) => s.note);
  const busy = useLobby((s) => s.busy);
  const serverOnline = useLobby((s) => s.serverOnline);
  const joinCode = useLobby((s) => s.joinCode);
  /** 「公开这间房（别人能搜到）」开关（建房时用；缺省关。服务端建房参数 `visibility`） */
  const publicRoomOn = useLobby((s) => s.publicRoomOn);
  /** 公开房列表那一屏的原因（与底栏共用一句人话；列表自己的错误也走这里） */
  const publicNote = useLobby((s) => s.publicNote);
  /**
   * 这台服务端有没有公开房列表（能力位 `gamePublicRooms`）。
   * ★ 读不到 / 为假 = 老服务端 = **第四张卡与「公开这间房」开关都不摆**（点了只有 404）。
   */
  const publicRoomsCap = usePublicRoomsCap();
  // 对局开着的时候大厅不出现（结束对局那一下会重新开它，见 StudioPage 的顶栏）
  const inGame = useGame((s) => s.state !== null);
  // 开局失败时的原因由对局 store 记着（rules 的失败原因，说人话在 reasons 一处）
  const gameRejection = useGame((s) => s.rejection);
  const [startFailed, setStartFailed] = useState(false);
  // 联机轮询（等匹配 / 房间快照 / 服务端开局 → 本机建局）
  const onlineRun = useLobbyOnline();

  /**
   * 新手引导（2026-11-24，docs/game-lobby-ui-benchmark.md §2.1 #19）：**第一次进大厅的首屏**自动弹一次
   * （tours.tsx 的 `lobby`：选模式 → 主键 → 凭码加入），看过之后只剩右上角那颗 `?`。
   * ★ 只挂在首屏（`screen === "home"`）：等匹配 / 房间那两屏的锚点不在这张图上。
   * ★ 与 `if (!open || inGame) return null` 那条早退的关系：hook 排在它前面（check-hook-order），
   *   关着大厅时靠 enabled 为假兜住。
   */
  useAutoGuide("lobby", open && !inGame && screen === "home");

  /**
   * 首屏选中的模式（默认 4 人）。
   * ★ 收掉大厅时归位到默认值：下次进来看到的是一张干净的默认选中态。
   */
  const [pick, setPick] = useState<LobbyPick>("match4");
  useEffect(() => {
    if (!open) setPick("match4");
  }, [open]);

  // ── 开局过场（B 加载页）──────────────────────────────────────────────────
  const [dealing, setDealing] = useState<Dealing | null>(null);
  /** 0..1：过场自己的计时（不是服务端进度；见 DealingB 文件头） */
  const [dealProgress, setDealProgress] = useState(0);
  const dealingRef = useRef<Dealing | null>(null);
  dealingRef.current = dealing;
  const dealProgressRef = useRef(0);
  dealProgressRef.current = dealProgress;
  /** DEV / 模拟器验收：把过场钉在 62%（`__lobbyUi.hold()`），免得 1.6 s 的窗口抓不住 */
  const holdRef = useRef(false);
  const beginDealingRef = useRef<(size: number) => void>(() => {});
  const finishDealingRef = useRef<() => void>(() => {});
  const cancelDealingRef = useRef<() => void>(() => {});

  const beginDealing = (size: number) => {
    if (dealingRef.current) return;
    dealingRef.current = { size };
    setDealProgress(0);
    setDealing(dealingRef.current);
  };
  beginDealingRef.current = beginDealing;

  /** 过场走完：真的建局（这是全局唯一那一下 startFromLobby）。 */
  const finishDealing = () => {
    const d = dealingRef.current;
    if (!d) return;
    dealingRef.current = null;
    setDealing(null);
    setDealProgress(0);
    if (!useLobby.getState().open) return;
    if (!startFromLobby(d.size)) setStartFailed(true);
  };
  finishDealingRef.current = finishDealing;

  /** 取消开局：startFromLobby 还没调，所以什么都没发出去（不欠房间 / 不欠队列）。
   *  ★ 回大厅首屏后把镜头搬回窗正前方：B 首屏的背景就是窗与月亮（从房间开局那一支也要回来一致）。 */
  const cancelDealing = () => {
    dealingRef.current = null;
    setDealing(null);
    setDealProgress(0);
    useLobby.getState().backHome();
    enterMatchPage();
  };
  cancelDealingRef.current = cancelDealing;

  // 过场计时：rAF 只在这 1.6 s 里跑；hold 时钉在 62%（验收截图用），放开后接着走。
  useEffect(() => {
    if (!dealing) return;
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    let done = false;
    const step = (nowMs: number) => {
      elapsed += Math.max(0, Math.min(100, nowMs - last));
      last = nowMs;
      const p = Math.min(1, elapsed / DEAL_MS);
      const shown = holdRef.current ? Math.min(DEAL_HOLD_AT, p) : p;
      setDealProgress(shown);
      if (p >= 1 && !holdRef.current) {
        if (!done) {
          done = true;
          finishDealingRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [dealing]);

  // 大厅被收掉（返回工坊 / 路由卸载）：过场一并作废，别留一个永远不会走完的计时
  useEffect(() => {
    if (open) return;
    dealingRef.current = null;
    setDealing(null);
    setDealProgress(0);
  }, [open]);

  // DEV / 模拟器验收钩子（与 __matchCam / __gsAccept 同一把开关）
  const lobbyRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const accept =
      import.meta.env.DEV ||
      (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
    if (!accept) return;
    const api = {
      /** 把过场钉在 62%（截图 / 真机验收用） */
      hold(on = true) {
        holdRef.current = on;
      },
      /** 直接从首屏开一段过场（不必真的点开局）；hold 默认为真 */
      startDealing(size: number = 4) {
        holdRef.current = true;
        beginDealingRef.current(size);
      },
      /** 放开冻结，过场接着走完 → 真的开局（验收"加载页之后的 StylePick"用） */
      release() {
        holdRef.current = false;
      },
      cancel() {
        cancelDealingRef.current();
      },
      state() {
        return {
          open: useLobby.getState().open,
          screen: useLobby.getState().screen,
          dealing: dealingRef.current !== null,
          progress: dealProgressRef.current,
        };
      },
      /** 月亮在屏幕上的投影（与匹配中光环 / 加载页进度环同一个函数算的） */
      moonRect() {
        const el = lobbyRootRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return moonScreenRect(r.width, r.height);
      },
    };
    (window as unknown as Record<string, unknown>).__lobbyUi = api;
    return () => {
      delete (window as unknown as Record<string, unknown>).__lobbyUi;
    };
  }, []);

  // ── 明月窗 / 穿窗转场（2026-11-27，feat/gs-moon-window）────────────────────
  /**
   * 镜头与黑幕的真相在 `scene/matchCam`（CameraRig 每帧读它，DOM 黑幕挂在页面层）。
   * 这里只订阅三样：阶段、黑幕、要不要瞬间切换（DEV 截图钩子）。
   * ★ 匹配逻辑（队列 / findMatch / AI 补位）一行没改：转场只是"点主键之后先飞 2.4 s"。
   * ★ 老场景（高斯档关着 / splat 加载失败）没有明月窗可看：`cinematic` 为假，大厅原样不透明。
   */
  const camStage = useMatchCam((s) => s.stage);
  const veil = useMatchCam((s) => s.veil);
  const veilInstant = useMatchCam((s) => s.instant);
  /** 高斯米制场景开着没有（与 StudioPage / TableScene 同一个判据）。关着 / 失败 = 没有明月窗可看，
   *  大厅保持原样（不透明底、不做转场）；判据订阅而不是读一次：splat 超时失败那一拍要能翻过来。 */
  const gsPhase = useGsPhase();
  const cinematic = gsPhase === "loading" || gsPhase === "ready";
  /** 正在穿窗：把大厅首屏 UI 收掉，画面只剩窗与月亮（穿出去之后黑幕已经盖上了） */
  const flying = camStage === "fly";
  /**
   * 背景透不透：只有"窗与月亮在屏上、而且这一屏就要它当背景"时，才让 3D 透出来。
   *   · 匹配页 / 匹配中 / 加载页（从匹配中进） → 透；
   *   · 房间 / 公开房 / 老场景 → 不透（bg-ink 实底，与换皮之前一致）。
   * ★ stage 的 page / fly / outside 三种都算"窗景这一档"：outside 是刚穿出去、黑幕还盖着的那一拍。
   */
  const onWindowStage = cinematic && (camStage === "page" || camStage === "fly" || camStage === "outside");
  const windowVisible = onWindowStage && (screen === "home" || screen === "matching" || dealing !== null);

  /**
   * 大厅一开就把镜头搬到窗正前方（匹配页背景）；关掉时复位。
   * ★ 只在 open 的**跳变**那一刻做：中途重渲 / 取消匹配回到首屏都不该再把镜头搬回去
   *   （取消由 MatchCurtain 的屏幕切换收口，见那个文件）。
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && !inGame) {
      // 冷启动 `?lobby=1` 的 boot 标记到这里交棒：从这以后场景挂哪一档只认 lobbyStore.open
      markLobbyOpened();
      enterMatchPage();
    }
    if (!open && wasOpen.current) leaveMatchPage();
    wasOpen.current = open;
  }, [open, inGame]);
  /** 安卓返回键：穿窗途中按返回 = 立刻取消并复位（不是退出大厅、也不是退出工坊）。 */
  useBackLayer(flying, cancelMatchCine, "match-cine");
  /** 安卓返回键：加载页 = 取消开局（还没 startFromLobby，取消是干净的）。 */
  useBackLayer(dealing !== null, cancelDealing, "lobby-dealing");
  /** 安卓返回键：匹配中 = 取消匹配回大厅首屏（与左下角那颗取消同一件事）。 */
  useBackLayer(!dealing && screen === "matching", () => useLobby.getState().backHome(), "lobby-matching");
  /** 高斯角标（fps / splat 数）是 z-9999 的开发者读数：大厅开着时藏起来，别压住"凭码加入"。
   *  关掉大厅就放回来（读数照旧每秒刷新）。 */
  useEffect(() => {
    setGsHudHidden(open);
    return () => setGsHudHidden(false);
  }, [open]);

  /**
   * 「最近一局回放」入口的数据是 **localStorage**（历史那一份不是 store）：
   * 离开对局前留的那一份回来得比大厅晚（发出一发 history 请求，回来时人已经在看大厅）。
   * 这里订阅 historyCache 的「刚存了一份」通知，重渲一次让入口立刻出现 / 消失。
   */
  const [, setHistoryTick] = useState(0);
  useEffect(() => subscribeHistoryCache(() => setHistoryTick((n) => n + 1)), []);

  /** 顶栏货币条：券（能力位 + 余额都到位才摆）与 token 余额（钱包快照有才摆）。 */
  const ticket = useGameTickets();
  useAccountVersion(); // 钱包镜像变化时重渲（钱包不是 zustand，靠账号版本号订阅）
  const wallet = walletOf();
  const tokens = wallet ? wallet.plan + wallet.addon : null;
  const showTickets = ticket.mode === "ticket" || ticket.mode === "empty";
  const ticketLeft = ticket.tickets?.left ?? 0;
  const ticketLimit = ticket.tickets?.limit ?? 0;
  const ticketPerGen = ticket.tickets?.perGeneration ?? 1;
  const ticketResetDay = resetDayOf(ticket.tickets?.nextResetAt ?? "");
  /** 钱包页是全仓唯一一处（components/UpgradeLink 的 UPGRADE_HREF）；别在这儿手拼 /me?wallet=1 */
  const openWallet = () => navigate(UPGRADE_HREF);

  /**
   * 「最近一局回放」入口（2026-11-24）：联机那一路的房号来自本机记录，本机单机局读 localHistory。
   * ★ 只在首屏摆（等匹配 / 房间屏里摆一个"上一局"会跟眼前的开局流程抢注意力）。
   * ★ 能力位明确为假时不摆联机那一路；本机记录照摆。
   * ★ 两路都有时打开**更近**的那一局（打完本机局回来，上一间联机房的码可能还挂着）。
   */
  const accountId = currentUser()?.id ?? null;
  const lastRoomCode = lastHistoryRoomFor(accountId);
  const lastRoomAt = lastRoomCode ? (readLastHistoryRoom()?.at ?? 0) : 0;
  const localAt = localGameOwner();
  const localRead = localAt ? readLatestLocalGame(localAt) : ({ kind: "none" } as const);
  const localReplay = localRead.kind === "ok" ? localRead.record : null;
  const localBroken = localRead.kind === "broken";
  const localRoomCode = localReplay && localReplay.history.room.code.trim() ? localReplay.history.room.code.trim() : null;
  const preferLocal = localReplay !== null && (!lastRoomCode || localReplay.savedAt >= lastRoomAt);
  const replayCode = preferLocal ? null : lastRoomCode;
  const replayTitleCode = replayCode ?? localRoomCode;
  const showReplay =
    screen === "home" &&
    (localReplay !== null || localBroken || (lastRoomCode !== null && serverGameHistory() !== false));

  // 换一屏就把"上一屏开局失败"那句话收掉：不然回到首屏还挂着一条已经无关的红字
  useEffect(() => {
    setStartFailed(false);
  }, [open, screen]);

  /**
   * 「开始」那一下：联机房间先问服务端（房主 / 全员准备由服务端判），本机房间直接建局。
   * ★ 联机房间不在这里 startFromLobby：服务端开局成功之后 `remoteRoom.status` 变 playing，
   *   由 useLobbyOnline 统一建局（房主 / 非房主两个入口同一条路，不会一个先建一个后建）。
   * ★★ 2026-11-24 改口：联机房间这一下**先强制拉一次最新快照再决定**（lobbyStore.prepareStart）。
   * ★★ 2026-11-27：无论哪条路，真正 startFromLobby 之前先播一屏 B 加载页（beginDealing）；
   *   取消 = 回大厅首屏、什么都没发出去。
   */
  const startMatch = (playerCount: MatchSize | number) => {
    if (dealingRef.current) return;
    const size = (playerCount === 8 ? 8 : playerCount === 4 ? 4 : playerCount) as MatchSize;
    if (online && remoteRoom) {
      void (async () => {
        const out = await useLobby.getState().prepareStart();
        if (!useLobby.getState().open) return;
        if (out.kind === "ai") beginDealingRef.current(out.size);
      })();
      return;
    }
    beginDealingRef.current(size);
  };

  const join = () => useLobby.getState().joinByCode();

  /** 黄铜主键的文案跟着选中卡变（B 案：读作「落座 · …」）。 */
  const primaryLabel =
    pick === "room" ? t`开一间房 · 落座` : pick === "match8" ? t`落座 · 匹配 8 人` : t`落座 · 匹配 4 人`;

  /**
   * 底栏那颗「直接进房」：观战撞上 409（已经是这间房的玩家）时才给。
   * ★ 房号拿不到时**不给**（别递一个空码去撞 BAD_CODE）。
   */
  const alreadyCode = publicNote?.kind === "already-player" ? publicNote.code : null;

  /** 公开房列表的空态「去建房」：回大厅首屏并选中「自定义房间」。 */
  const createFromPublic = () => {
    useLobby.getState().backHome();
    setPick("room");
  };

  const onHome = open && !inGame && screen === "home";

  /**
   * 主键那一下：把"选中"变成"走"（点卡片不会走到这里）。
   * ★ 4/8 人匹配走**穿窗转场**（2026-11-27）：镜头先朝窗户飞、穿过窗洞、黑屏，然后才真的
   *    进匹配队列（`beginFlyThrough()` 的 promise 里再调 `chooseMatch`）。中途取消时它回
   *    "cancelled" —— 这里直接 return，队列一发都不会发（取消 = 没进过匹配）。
   * ★ 自定义房间不演戏：那一屏是建房 / 邀请朋友，没有"匹配中"这一段。
   * ★ 老场景（没开高斯档）也不演戏：cinematic 为假，直接走原来的 chooseMatch。
   */
  const startPicked = () => {
    if (busy || flying || dealingRef.current) return;
    if (pick === "room") {
      useLobby.getState().chooseRoom();
      return;
    }
    const size: MatchSize = pick === "match8" ? 8 : 4;
    if (!cinematic) {
      useLobby.getState().chooseMatch(size);
      return;
    }
    void (async () => {
      const out = await beginFlyThrough();
      if (out === "cancelled") return;
      // 飞行途中用户可能把大厅关了（返回键先把转场取消掉，这里只是再兜一道）
      if (!useLobby.getState().open) return;
      useLobby.getState().chooseMatch(size);
    })();
  };

  // 键盘 / 遥控的 Enter 触发主键。★ 用 ref 而不是把 startPicked 放进依赖：
  //   它每次渲染都是新函数，放进依赖会每帧重挂监听；而监听要读的永远是最新那一位。
  const startPickedRef = useRef(startPicked);
  startPickedRef.current = startPicked;
  useEffect(() => {
    if (!onHome) return;
    /**
     * ★ 只在焦点**不在**可交互元素上时兜这一下：
     *   · 焦点在卡片 / 按钮上 → Enter 是它自己的默认动作（点卡片 = 选中这一张，不该变成开局）；
     *   · 焦点在输入框里 → Enter 归「加入房间」那个表单；
     *   · 焦点在 body → 这才是"按 Enter 开局"。
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest("input, textarea, select, button, a, [role='button'], [contenteditable='true']")) return;
      event.preventDefault();
      startPickedRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHome]);

  if (!open || inGame) return null;

  const bChrome = screen === "home";
  /** 顶栏那颗联机状态（B 案把它从底栏搬到右上；房间 / 公开房仍用底栏那一句完整说明） */
  const onlineLabel =
    serverOnline === true ? t`联机已接通` : serverOnline === false ? t`没连上房间服务` : t`正在连房间服务…`;

  /**
   * 底栏：一次只显示一件事（开局失败 > 退回本机/服务端原因 > 本机规矩 > 联机现状 > 正在连）。
   * ★ 首屏（B）只留"要人动手 / 要看一眼"的那几种（失败 / 原因）；"联机已接通"这种常态
   *   已经在右上那颗状态点里了，不再占底栏一条 —— B 案的两列底部需要这点高度。
   */
  const footerNode =
    (startFailed || onlineRun.startFailed) && gameRejection ? (
      <p className="text-center text-[10px] leading-snug text-danger-200">{ruleFailureText(gameRejection.failure)}</p>
    ) : rejection ? (
      <p className="text-center text-[10px] leading-snug text-danger-200">{lobbyFailureText(rejection)}</p>
    ) : note ? (
      <>
        <p className="text-center text-[10px] leading-snug text-slate-300">{lobbyNoteText(note)}</p>
        {note.kind === "in-room" && (
          <GameBtn
            tone="primary"
            className="flex-none px-2 py-0.5 text-[10px]"
            onClick={() => void useLobby.getState().leaveStuckRoom()}
            disabled={busy}
          >
            <Trans>退出那间房</Trans>
          </GameBtn>
        )}
      </>
    ) : publicNote ? (
      <>
        <p className="text-center text-[10px] leading-snug text-slate-300">{lobbyNoteText(publicNote)}</p>
        {alreadyCode && (
          <GameBtn
            tone="primary"
            className="flex-none px-2 py-0.5 text-[10px]"
            onClick={() => useLobby.getState().joinPublicRoom(alreadyCode)}
            disabled={busy}
          >
            <Trans>直接进房</Trans>
          </GameBtn>
        )}
      </>
    ) : screen !== "home" ? (
      busy ? (
        <p className="text-center text-[10px] leading-snug text-slate-300">
          <Trans>正在连接房间服务…</Trans>
        </p>
      ) : serverOnline === true ? (
        <p className="text-center text-[10px] leading-snug text-slate-400">
          <Trans>联机已接通：匹配会等真人；自定义房间的空位不参加回合。</Trans>
        </p>
      ) : serverOnline === false ? (
        <p className="text-center text-[10px] leading-snug text-slate-400">
          <Trans>没连上房间服务：现在开局一律由 AI 陪玩补位。</Trans>
        </p>
      ) : (
        <p className="text-center text-[10px] leading-snug text-slate-400">
          <Trans>正在连房间服务…</Trans>
        </p>
      )
    ) : null;

  return (
    <div
      ref={lobbyRootRef}
      data-lobby-screen={dealing ? "dealing" : screen}
      className="absolute inset-0 z-40 flex flex-col overflow-hidden text-[#ece4d2]"
    >
      {/*
        ── 四层底（2026-11-27，feat/ui-match-b-c）──
        ① 不透明底板：老场景 / 房间 / 公开房这些没有"窗景当背景"的屏仍然是 bg-ink 实底；
           匹配页 / 匹配中 / 加载页把它淡出，露出后面 3D 里的明月窗。
        ② 绒布层（B）：半透明暗角 + 织物纹，中间留空给窗与月亮（不是一块盖满的纯色）。
        ③ 冷色暗幕（C）：匹配中那一屏的屏幕边缘压暗 + 一点点星；中间同样留空。
        ④ 黑幕：点「匹配」穿窗那一拍淡入；z 序 = 底 → 内容；3D 画布在更下面。
           页面层还有一张同款的 `ui/MatchCurtain`（z-35）：那是给"匹配成功、大厅整个卸掉"
           之后用的 —— 黑幕得留在大厅外面才能淡出。
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-ink transition-opacity duration-500"
        style={{ opacity: windowVisible ? 0 : 1 }}
      />
      {(bChrome || dealing !== null) && <div aria-hidden className="lobby-velvet pointer-events-none absolute inset-0" />}
      {screen === "matching" && !dealing && (
        <div aria-hidden className="lobby-c-scrim pointer-events-none absolute inset-0" />
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black"
        style={{ opacity: veil, transition: veilInstant ? "none" : "opacity 400ms ease-out" }}
      />

      {dealing ? (
        // ── 加载页（B）：开局前过场 ──
        <DealingB size={dealing.size} progress={dealProgress} windowVisible={windowVisible} onCancel={cancelDealing} />
      ) : screen === "matching" && matchSize !== null ? (
        // ── 匹配中（C）：沉浸全屏 ──
        <SearchingC
          size={matchSize}
          online={online}
          queue={queue}
          note={note}
          busy={busy}
          matchStartedAt={matchStartedAt}
          windowVisible={windowVisible}
          onStart={() => startMatch(matchSize)}
          onCancel={() => useLobby.getState().backHome()}
        />
      ) : (
        // ── 首屏（B）/ 房间 / 公开房：共用顶栏 + 底栏壳 ──
        <div
          className={`relative flex min-h-0 flex-1 flex-col transition-opacity duration-300 ${
            flying ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          {/* 顶栏：B 案是「IDEAHUB WORKSHOP」小字 + 衬线「对局大厅」；房间 / 公开房仍用原来那份。 */}
          <header className="relative z-[4] flex items-start justify-between gap-2 px-3" style={{ paddingTop: "var(--safe-float-top)" }}>
            <div className="min-w-0">
              {bChrome && <div className="lobby-eyebrow">IDEAHUB WORKSHOP</div>}
              <h1
                className={
                  bChrome
                    ? "lobby-serif mt-1 text-[19px] font-semibold leading-none tracking-[0.08em] text-[#f8efdd] drop-shadow-[0_1px_0_rgba(0,0,0,0.55)]"
                    : "text-[14px] font-bold tracking-wide text-slate-100"
                }
              >
                <Trans>对局大厅</Trans>
              </h1>
              {!bChrome && (
                <p className="text-[10px] leading-snug text-slate-400">
                  <Trans>先选一种开局方式，再点下面那颗键开始；点卡片只选中，不会直接开局。</Trans>
                </p>
              )}
            </div>
            <div className="flex flex-none items-center gap-1">
              {/* 联机状态（B 案：右上角一颗绿点 + 一句；房间 / 公开房不在这里，底栏有完整句子） */}
              {bChrome && (
                <span className="lobby-online mr-1 hidden sm:inline-flex" title={onlineLabel}>
                  <i aria-hidden className={serverOnline === true ? "is-ok" : serverOnline === false ? "is-off" : ""} />
                  <span className="truncate">{onlineLabel}</span>
                </span>
              )}
              {/* 🎟 券：这台服务器没有游戏券时一格都不摆（与对局内 BagBar 同一条口径）。 */}
              {showTickets && (
                <button
                  type="button"
                  onClick={openWallet}
                  title={t`游戏券：每月 ${ticketLimit} 张，出片扣 ${ticketPerGen} 张、不扣 token（${ticketResetDay} 号刷新）；点开钱包`}
                  className="lobby-chip-hit flex h-11 items-center px-0.5"
                >
                  <span className="lobby-chip">
                    <span aria-hidden>🎟</span>
                    <span className="tabular-nums">{ticketLeft}</span>
                  </span>
                </button>
              )}
              {/* ⚡ token 余额：钱包镜像还没到（未登录 / 远端请求没回来）时不摆一个空数 */}
              {tokens !== null && (
                <button
                  type="button"
                  onClick={openWallet}
                  title={t`token 余额：出片 / 对话要花它；点开钱包`}
                  className="lobby-chip-hit flex h-11 items-center px-0.5"
                >
                  <span className="lobby-chip">
                    <span aria-hidden>⚡</span>
                    <span className="tabular-nums">{fmtTokens(tokens)}</span>
                  </span>
                </button>
              )}
              {/* 📼 最近一局回放：联机局看服务端那间房（有历史端点才摆）、本机局看本机存下来的那一份 */}
              {showReplay && (
                <button
                  type="button"
                  onClick={() => useHistory.getState().openFor({ code: replayCode, myUserId: accountId, latest: replayCode === null })}
                  title={replayTitleCode ? t`最近一局：${replayTitleCode}` : t`最近一局：本机对局`}
                  className="lobby-chip-hit flex h-11 items-center px-0.5"
                >
                  <span className="lobby-chip">
                    <span aria-hidden>📼</span>
                    <Trans>最近一局回放</Trans>
                  </span>
                </button>
              )}
              {/* ? 玩法说明：把这一屏的引导再放一遍。★ 与局内那份 `ingame` 各一颗。 */}
              <HelpButton tour="lobby" className="flex-none" circleClassName="border-white/25" />
              <button
                type="button"
                onClick={() => useLobby.getState().closeLobby()}
                // ★ 命中区 44×44 CSS px：`h-11` 撑高，左右留 12px 内边距 ⇒ 真实热区 ≥44。
                className="h-11 flex-none rounded-full bg-panel/85 px-3 text-[11px] font-semibold text-slate-200 backdrop-blur"
              >
                <Trans>✕ 返回工坊</Trans>
              </button>
            </div>
          </header>

          {/* ── 三屏之一（首屏 / 房间 / 公开房） ── */}
          <div className="relative flex min-h-0 flex-1 flex-col px-3">
            {screen === "home" && (
              <MatchLobbyB
                pick={pick}
                onPick={setPick}
                primaryLabel={primaryLabel}
                onStart={startPicked}
                busy={busy}
                flying={flying}
                publicRoomsCap={publicRoomsCap}
                onOpenPublicRooms={() => useLobby.getState().openPublicRooms()}
                showPublicToggle={pick === "room" && publicRoomsCap}
                publicRoomOn={publicRoomOn}
                onTogglePublic={() => useLobby.getState().togglePublicRoom()}
                joinCode={joinCode}
                onJoinCode={(code) => useLobby.getState().setJoinCode(code)}
                onJoin={join}
                windowVisible={windowVisible}
              />
            )}

            {screen === "room" && room && (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <RoomScreen room={room} remote={online ? remoteRoom : null} onStart={() => startMatch(room.size)} />
              </div>
            )}

            {screen === "public" && (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <PublicRooms onCreate={createFromPublic} />
              </div>
            )}
          </div>

          {/* ── 底栏：一次只显示一件事（失败 / 原因 / 联机现状；首屏只留前两种） ── */}
          {footerNode && (
            <footer className="flex min-h-[1.5rem] flex-none items-center justify-center gap-2 px-3 pb-1">{footerNode}</footer>
          )}
        </div>
      )}

      {/* 穿窗途中唯一能点的一颗键：取消 = 立刻复位（安卓返回键走 ui/backButton 的层栈，同一个 handler）
          ★ `top` 用统一的安全区偏移（真机横屏 inset-top=41px，`top-3` 整颗会被状态栏压住）。 */}
      {flying && (
        <button
          type="button"
          onClick={cancelMatchCine}
          style={{ top: "var(--safe-float-top)" }}
          className="absolute right-3 z-50 flex h-11 min-w-[2.75rem] items-center justify-center rounded-full bg-panel/85 px-3 text-xs font-semibold text-slate-200 backdrop-blur ring-1 ring-white/15"
        >
          <Trans>✕ 取消</Trans>
        </button>
      )}
    </div>
  );
}
