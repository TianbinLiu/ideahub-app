// 对局大厅（2026-11-23）：进对局之前的那一屏 —— 4 人匹配 / 8 人匹配 / 自定义房间 / 凭码加入。
//
// ★ 流程：StudioPage 顶栏的「▶ 开局」不再直接开一局，而是先开这一屏（lobbyStore.openLobby）。
//   玩家选一种开局方式 → 建局（`ui/startFromLobby`，人数由大厅给）→ 大厅收掉、对局 UI 顶上来。
// ★ 为什么不塞进 GameLayer：那一层是"对局中"的仪表盘（它 `if (!state) return null`），
//   而大厅恰恰是**还没有 state** 的那一屏。两件事分开挂（StudioPage 里 `{isLand && <Lobby />}`），
//   竖屏两边都不挂（与对局一致，G1 的竖屏逐字节不变）。
// ★ 这一屏**不挂 3D**：铺满舞台的实底 + 停掉画布的 frameloop（StudioPage 的 canvasCovered 也认大厅），
//   大厅里没有任何一张卡、一个桌面 —— 它只是一张三选一的入口卡。
// ★ 不摆金币 / 血量（主人点名"别塞"）：大厅要回答的只有"这一局怎么开"，
//   那些数是**对局中**的读数，摆在这里既没用又要跟着对局状态走（大厅和局之间就会开始漂）。
//   **例外是券与 token**（2026-11-24 视觉 P0 / docs/game-lobby-ui-benchmark.md #4）：它们是"开一局要用多少"
//   的大厅级信息，摆顶栏，点开钱包；金币仍然只在对局里。
// ★ 联机（2026-11-24）：4/8 人匹配与自定义房间都先问能力位（api/game/rooms.roomsAvailable）；
//   接通了就进服务端队列 / 房间，没接通 / 超时 / 被拒一律自动退回本机 AI 补位，底栏留一句话。
//   轮询在 ui/useLobbyOnline（组件卸载 / 换屏就停）。
//
// ★★ 主 CTA 拆分（2026-11-24 视觉 P0，docs/game-lobby-ui-benchmark.md #13）：
//   以前点卡片即进队 / 建房（误触一次就开局）。现在卡片**只负责选中**（`aria-pressed` + 描边 + 轻微上浮），
//   真正开始的是底栏那颗实心主键（匹配 N 人局 / 创建房间）。
//   · 选中的是**本页 state**、不进 lobbyStore：它不是规则（不参与 `playerCountOf` / 房间状态机），
//     只是"下一个动作的对象"；放进 store 就多一份要在 closeLobby 里记得清的值。
//   · 默认选 4 人（对标 TFT / 金铲铲都有一个默认模式）：主键一进来就能用，但**仍要点一下**才开始。
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router";
import { aiSeatIds, normalizeServerCode, type MatchSize } from "../lobby";
import { QUEUE_TIMEOUT_MS, useLobby, type LobbyNote } from "../lobbyStore";
import { lobbyFailureText, lobbyNoteText } from "../lobbyReasons";
import { useGame } from "../store";
import { ruleFailureText } from "../reasons";
import { playerName } from "../labels";
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
import { setGsHudHidden } from "../../scene/gsHud";
import GameBtn from "./GameBtn";
import RoomScreen from "./RoomScreen";
import PublicRooms from "./PublicRooms";
import { startFromLobby } from "./startFromLobby";
import { useLobbyOnline } from "./useLobbyOnline";
import { usePublicRoomsCap } from "./useSpectateCaps";
import HelpButton from "../../../components/guide/HelpButton";
import { useAutoGuide } from "../../../components/guide/useAutoGuide";

/** 首屏选中的那一种开局方式（点卡片只改它，点主键才真的开始）。 */
type LobbyPick = "match4" | "match8" | "room";

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
   * ★ 只挂在首屏（`screen === "home"`）：等匹配 / 房间那两屏的锚点不在这张图上
   *   （`lobby-modes` / `lobby-start` 都不渲染），弹出来只会是一张没有圈的居中卡片。
   * ★ 与 `if (!open || inGame) return null` 那条早退的关系：hook 排在它前面（check-hook-order），
   *   关着大厅时靠 enabled 为假兜住。
   */
  useAutoGuide("lobby", open && !inGame && screen === "home");

  /**
   * 首屏选中的模式（默认 4 人）。
   * ★ 收掉大厅时归位到默认值：下次从「▶ 开局」/ `?lobby=1` 进来看到的是一张干净的默认选中态，
   *   而不是上一轮留下的 8 人或自定义（关大厅那一刻的"下一个动作"已经结束了）。
   */
  const [pick, setPick] = useState<LobbyPick>("match4");
  useEffect(() => {
    if (!open) setPick("match4");
  }, [open]);

  // ── 明月窗 / 穿窗转场（2026-11-27，feat/gs-moon-window）────────────────────
  /**
   * 镜头与黑幕的真相在 `scene/matchCam`（CameraRig 每帧读它，DOM 黑幕挂在页面层）。
   * 这里只订阅三样：阶段、黑幕、要不要瞬间切换（DEV 截图钩子）。
   * ★ 匹配逻辑（队列 / findMatch / AI 补位）一行没改：转场只是"点主键之后先飞 1.5 s"。
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
  /** 匹配页：首屏 + 镜头在窗正前方（只在这时让 3D 透出来，其余屏仍是原来的不透明底） */
  const matchPage = cinematic && screen === "home" && (camStage === "page" || camStage === "fly");
  /**
   * 大厅一开就把镜头搬到窗正前方（匹配页背景）；关掉时复位。
   * ★ 只在 open 的**跳变**那一刻做：中途重渲 / 取消匹配回到首屏都不该再把镜头搬回去
   *   （取消的语义是"回设计机位"，见 matchCam.cancelMatchCine）。
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current && !inGame) enterMatchPage();
    if (!open && wasOpen.current) leaveMatchPage();
    wasOpen.current = open;
  }, [open, inGame]);
  /** 安卓返回键：穿窗途中按返回 = 立刻取消并复位（不是退出大厅、也不是退出工坊）。 */
  useBackLayer(flying, cancelMatchCine, "match-cine");
  /** 高斯角标（fps / splat 数）是 z-9999 的开发者读数：大厅开着时藏起来，别压住"凭码加入"。
   *  关掉大厅就放回来（读数照旧每秒刷新）。 */
  useEffect(() => {
    setGsHudHidden(open);
    return () => setGsHudHidden(false);
  }, [open]);

  /**
   * 「最近一局回放」入口的数据是 **localStorage**（历史那一份不是 store）：
   * 离开对局前留的那一份回来得比大厅晚（发出一发 history 请求，回来时人已经在看大厅）。
   * 这里订阅 historyCache 的「刚存了一份」通知，重渲一次让入口立刻出现 / 消失
   * （2026-11-24 Bug B 的现场：退出后回大厅，按钮要等下一次重渲才出来）。
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
   * 「最近一局回放」入口（2026-11-24）：联机那一路的房号来自本机记录（`historyLastRoom`，开局成功那一刻写的），
   * 不是服务端事实 —— 大厅这时候没有房间会话；本机单机局没有房号，读的是 `localHistory` 落的那一份。
   * ★ 只在首屏摆（等匹配 / 房间屏里摆一个"上一局"会跟眼前的开局流程抢注意力）。
   * ★ 能力位**明确为假**时不摆**联机**那一路（服务端 docs：读不到 gameHistory = 老服务端，App 不摆联机战绩 / 回放）；
   *   还没探到（null）照摆 —— 大厅先进来、健康探测慢半拍是常态，藏起来等于让刚打完的人找不到入口。
   *   本机记录跟服务器有没有这个端点无关：本机局照摆（否则打完本机局回来，入口直接消失）。
   * ★ 两路都有时打开**更近**的那一局：打完一局本机局之后，上一间联机房的码还挂在 localStorage 里，
   *   不比较的话点开的是那间（多半已过期），而玩家想看的是刚刚这一局。两个时刻含义略有不同
   *   （本机 = 结束时刻，联机 = 开局时刻），但两局不可能同时打，先后次序仍然对得上。
   * ★ 本机记录**坏了**（写失败 / 读不出来）也摆：点开它会如实说「这一局的回放没存下来」。
   *   藏起来等于静默丢掉——玩家只会以为回放功能坏了。
   */
  const accountId = currentUser()?.id ?? null;
  const lastRoomCode = lastHistoryRoomFor(accountId);
  const lastRoomAt = lastRoomCode ? (readLastHistoryRoom()?.at ?? 0) : 0;
  const localAt = localGameOwner();
  const localRead = localAt ? readLatestLocalGame(localAt) : ({ kind: "none" } as const);
  const localReplay = localRead.kind === "ok" ? localRead.record : null;
  const localBroken = localRead.kind === "broken";
  /**
   * 本机那份也可能是**联机局的缓存**（2026-11-24 Bug B：退出房间前留的那一份，房号非空）。
   * 入口的 title 要写对房号 —— 写成「本机对局」会让人以为回放的是单机那一局。
   */
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
   * ★★ 2026-11-24 改口：联机房间这一下**先强制拉一次最新快照再决定**（lobbyStore.prepareStart）——
   *   界面上的人数可能停在旧数据（1/4），拿它决定就会开成一局本机 AI 单机（真机验收的事故）。
   *   `ai` 那一支 = 服务端事实说真人不够，才去建本机 AI 补位局。
   */
  const startMatch = (playerCount: number) => {
    if (online && remoteRoom) {
      void (async () => {
        const out = await useLobby.getState().prepareStart();
        if (out.kind === "ai") setStartFailed(!startFromLobby(out.size));
      })();
      return;
    }
    setStartFailed(!startFromLobby(playerCount));
  };

  const join = () => useLobby.getState().joinByCode();

  /** 主键的文案跟着选中卡变（两种匹配共用"匹配 N 人局"这一句，句尾不带标点）。 */
  const primaryLabel =
    pick === "room" ? t`创建房间` : pick === "match8" ? t`匹配 8 人局` : t`匹配 4 人局`;

  /**
   * 底栏那颗「直接进房」：观战撞上 409（已经是这间房的玩家）时才给。
   * ★ 房号拿不到时**不给**（别递一个空码去撞 BAD_CODE）：那一支只说一句「直接进房」——
   *   玩家自己知道是哪间（他刚从那一行点的）。
   */
  const alreadyCode = publicNote?.kind === "already-player" ? publicNote.code : null;

  /** 公开房列表的空态「去建房」：回大厅首屏并选中「自定义房间」（不是直接建房：还要让人勾公开 / 选人数）。 */
  const createFromPublic = () => {
    useLobby.getState().backHome();
    setPick("room");
  };

  /** 主键那一下：把"选中"变成"走"（点卡片不会走到这里）。
   *  ★ 4/8 人匹配走**穿窗转场**（2026-11-27）：镜头先朝窗户飞 1.5 s、穿过窗洞、黑屏，然后才真的
   *    进匹配队列（`beginFlyThrough()` 的 promise 里再调 `chooseMatch`）。中途取消时它回
   *    "cancelled" —— 这里直接 return，队列一发都不会发（取消 = 没进过匹配）。
   *  ★ 自定义房间不演戏：那一屏是建房 / 邀请朋友，没有"匹配中"这一段。
   *  ★ 老场景（没开高斯档）也不演戏：cinematic 为假，直接走原来的 chooseMatch。
   */
  const startPicked = () => {
    if (busy || flying) return;
    if (pick === "room") {
      useLobby.getState().chooseRoom();
      return;
    }
    const size = pick === "match8" ? 8 : 4;
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
  const onHome = open && !inGame && screen === "home";
  useEffect(() => {
    if (!onHome) return;
    /**
     * ★ 只在焦点**不在**可交互元素上时兜这一下：
     *   · 焦点在卡片 / 按钮上 → Enter 是它自己的默认动作（点卡片 = 选中这一张，不该变成开局）；
     *   · 焦点在输入框里 → Enter 归「加入房间」那个表单；
     *   · 焦点在 body（触屏刚点过空白 / Tab 还没进页面）→ 这才是"按 Enter 开局"。
     *   主键本身是 `<button>`，Tab 到它按 Enter 是浏览器原生行为，不靠这条监听。
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

  /**
   * 凭码加入（2026-11-27）：首屏居中、匹配页右下角，两处共用同一份实现。
   * ★ 联机没接通时也摆着：点了会在底栏说"没连上房间服务"，比藏起来更诚实
   *   （藏起来的话，拿到码的人会以为 App 没有这个功能）。
   */
  const joinForm = (center: boolean) => (
    <form
      data-guide="lobby-join"
      className={`flex w-full items-center gap-1.5 ${center ? "justify-center" : "justify-end"}`}
      onSubmit={(e) => {
        e.preventDefault();
        join();
      }}
    >
      <input
        value={joinCode}
        onChange={(e) => useLobby.getState().setJoinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6))}
        placeholder={t`输入 6 位房间码`}
        aria-label={t`房间码`}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={6}
        className={`h-8 rounded-lg bg-white/[0.06] px-2 text-center font-mono text-[13px] tracking-[0.2em] text-slate-100 ring-1 ring-white/10 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-500 ${center ? "w-32" : "min-w-0 flex-1"}`}
      />
      <GameBtn onClick={join} disabled={busy || !normalizeServerCode(joinCode)}>
        <Trans>加入房间</Trans>
      </GameBtn>
    </form>
  );

  /**
   * 底部主键：唯一能真的进队 / 建房的那一下（首屏底部、匹配页左下角共用）。
   * ★ data-guide="lobby-start"：新手引导「匹配 / 建房」那一步的高亮目标。
   */
  const primaryBlock = (match: boolean) => (
    <div className={match ? "flex w-full flex-none flex-col items-stretch gap-1" : "flex w-full flex-none flex-col items-center gap-1 pb-1"}>
      <button
        type="button"
        data-guide="lobby-start"
        onClick={startPicked}
        disabled={busy || flying}
        aria-keyshortcuts="Enter"
        className={`rounded-xl bg-brand font-black text-ink shadow-[0_6px_20px_rgb(56_189_248_/_0.28)] transition-transform duration-75 active:scale-[0.97] disabled:opacity-50 motion-reduce:transition-none motion-reduce:transform-none ${
          match
            ? "h-10 w-full text-[13px]"
            : "h-[clamp(2.25rem,6.2vh,2.75rem)] w-[clamp(12rem,32vw,20rem)] text-[clamp(12px,1.6vw,14px)]"
        }`}
      >
        {busy ? <Trans>正在连接房间服务…</Trans> : primaryLabel}
      </button>
      <p className={`leading-tight ${match ? "text-[9px] text-slate-400" : "text-[9px] text-slate-500"}`}>
        <Trans>点卡片只选中，不会直接开局；键盘上按 Enter 也能开始。</Trans>
      </p>
    </div>
  );

  if (!open || inGame) return null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col text-slate-100">
      {/*
        ── 三层底（2026-11-27，feat/gs-moon-window）──
        ① 不透明底板：除"匹配页"之外的每一屏都还是原来那张实底（bg-ink）；
           匹配页把它淡出，露出后面 3D 里的明月窗/月亮。
        ② 黑幕：点「匹配」穿窗那一拍淡入（0.4 s），匹配中 / 房间那几屏都盖在它上面。
           z 序 = 底板 → 黑幕 → 内容；3D 画布在更下面（Canvas 是这一层的兄弟节点）。
           页面层还有一张同款的 `ui/MatchCurtain`（z-35）：那是给"匹配成功、大厅整个卸掉"
           之后用的 —— 黑幕得留在大厅外面才能淡出，否则会看见黑屏"啪"地跳回桌子。
        ③ 内容：穿窗那 1.5 s 整体收掉（只留画面），取消键单独摆在右上。
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-ink transition-opacity duration-500"
        style={{ opacity: matchPage ? 0 : 1 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black"
        style={{ opacity: veil, transition: veilInstant ? "none" : "opacity 400ms ease-out" }}
      />
      <div
        className={`relative flex min-h-0 flex-1 flex-col transition-opacity duration-300 ${
          flying ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
      {/* ── 顶栏：标题 + 一句这是什么 + 货币条 + 回工坊 ──
          ★ 2026-11-27（`feat/gs-ui-moon-polish`）：安全区偏移写在**这一行**（`--safe-float-top`，
          见 index.css）。真机横屏 `env(safe-area-inset-top)=41px`，原来 `pt-2` 只给 8px ⇒
          这一排键（含「✕ 返回工坊」）整体压在系统状态栏底下，只有最下 5px 能点。
          偏移写在 header 上而不是单颗键上：这一排的 🎟 / ⚡ / 📼 / ? / ✕ 是一起被状态栏压住的，
          只挪一颗会变成一排高矮不齐的键。 */}
      <header className="flex items-start justify-between gap-2 px-3" style={{ paddingTop: "var(--safe-float-top)" }}>
        <div className="min-w-0">
          <h1 className="text-[14px] font-bold tracking-wide text-slate-100">
            <Trans>对局大厅</Trans>
          </h1>
          <p className="text-[10px] leading-snug text-slate-400">
            <Trans>先选一种开局方式，再点下面那颗键开始；点卡片只选中，不会直接开局。</Trans>
          </p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {/* 🎟 券：这台服务器没有游戏券（能力位为假 / 还没探到 / 没读到余额）时**一格都不摆**。
              与对局内 BagBar 同一条口径（data/gameTicketRules 一处判）。 */}
          {showTickets && (
            <button
              type="button"
              onClick={openWallet}
              title={t`游戏券：每月 ${ticketLimit} 张，出片扣 ${ticketPerGen} 张、不扣 token（${ticketResetDay} 号刷新）；点开钱包`}
              className="flex h-8 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10 active:bg-white/[0.12]"
            >
              <span aria-hidden>🎟</span>
              <span className="tabular-nums">{ticketLeft}</span>
            </button>
          )}
          {/* ⚡ token 余额：钱包镜像还没到（未登录 / 远端请求没回来）时不摆一个空数 */}
          {tokens !== null && (
            <button
              type="button"
              onClick={openWallet}
              title={t`token 余额：出片 / 对话要花它；点开钱包`}
              className="flex h-8 items-center gap-1 rounded-full bg-white/[0.06] px-2.5 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10 active:bg-white/[0.12]"
            >
              <span aria-hidden>⚡</span>
              <span className="tabular-nums">{fmtTokens(tokens)}</span>
            </button>
          )}
          {/* 📼 最近一局回放：联机局看服务端那间房（有历史端点才摆）、本机局看本机存下来的那一份 */}
          {showReplay && (
            <button
              type="button"
              onClick={() => useHistory.getState().openFor({ code: replayCode, myUserId: accountId, latest: replayCode === null })}
              title={replayTitleCode ? t`最近一局：${replayTitleCode}` : t`最近一局：本机对局`}
              className="h-8 flex-none rounded-full bg-white/[0.06] px-2.5 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10 active:bg-white/[0.12]"
            >
              <span aria-hidden>📼</span> <Trans>最近一局回放</Trans>
            </button>
          )}
          {/* ? 玩法说明（2026-11-24）：把这一屏的引导再放一遍。★ 与局内那份 `ingame` 各一颗 ——
              大厅与对局是两个挂载点，一颗键指不到两个屏。 */}
          <HelpButton tour="lobby" className="flex-none" circleClassName="border-white/25" />
          <button
            type="button"
            onClick={() => useLobby.getState().closeLobby()}
            // ★ 2026-11-27（第 1 条）：命中区 44×44 CSS px（原来是 h-8 = 32）。文字键靠 `h-11` 撑高，
            //   左右留 12px 内边距 ⇒ 真实热区 ≥44；行内的其它小键（🎟/⚡/?）保持原高、随这一行一起下移。
            className="h-11 flex-none rounded-full bg-panel/85 px-3 text-[11px] font-semibold text-slate-200 backdrop-blur"
          >
            <Trans>✕ 返回工坊</Trans>
          </button>
        </div>
      </header>

      {/* ── 三屏之一（首屏 / 等匹配 / 房间） ── */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {screen === "home" && (
          // ★ 首屏两套摆法（2026-11-27，feat/gs-moon-window）：
          //   · matchPage = 明月窗背景：左列模式卡 + 主键、右列凭码加入，**中间整块留给窗与月亮**
          //     （852×348 的画幅上窗洞占画面高 20%~80%、x 居中约 210 px 宽；左右两列都在它之外）。
          //   · 否则（老场景 / 取消匹配回到首屏）：还是原来那套"上下两段"布局——
          //     上半居中、主键固定在底部（docs/game-lobby-ui-benchmark.md §1.5 的验收形状）。
          <div className={`flex w-full self-stretch ${matchPage ? "flex-row items-end justify-between gap-3 pb-1" : "flex-col items-center"}`}>
            <div
              className={
                matchPage
                  ? "flex w-[min(17rem,32vw)] flex-none flex-col gap-1.5"
                  : "flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2"
              }
            >
              {/* 三张模式卡：点一下只选中
                  ★ data-guide="lobby-modes"：新手引导「选模式」那一步的高亮目标（components/guide/tours.tsx 的 lobby）。
                    挂在这一行而不是某一张卡上 —— 三张都是同一件事（选一种），挂到第一张上等于教人点 4 人局。 */}
              <div
                data-guide="lobby-modes"
                className={matchPage ? "flex w-full flex-col gap-1.5" : "flex w-full flex-wrap items-stretch justify-center gap-2.5"}
              >
                <ModeCard
                  glyph="4"
                  title={t`4 人匹配`}
                  line={t`你和 3 个对手，一桌人打得快`}
                  badge={t`AI 补位`}
                  selected={pick === "match4"}
                  onSelect={() => setPick("match4")}
                  compact={matchPage}
                />
                <ModeCard
                  glyph="8"
                  title={t`8 人匹配`}
                  line={t`你和 7 个对手，8 个座位的大桌`}
                  badge={t`AI 补位`}
                  selected={pick === "match8"}
                  onSelect={() => setPick("match8")}
                  compact={matchPage}
                />
                <ModeCard
                  glyph="#"
                  title={t`自定义房间`}
                  line={t`开一间房，把房间码念给朋友`}
                  badge={t`房主开局`}
                  selected={pick === "room"}
                  onSelect={() => setPick("room")}
                  compact={matchPage}
                />
                {/* 第四张卡「🏠 公开房」（2026-11-24）：它不是"选中"、是**直接开一屏**（列表在下一屏）。
                    ★ 能力位为假 / 读不到（老服务端）时一格都不摆：点了只有 404。
                    ★ 比三张模式卡窄一档：4 张按原宽在 800×363 上会折行、把主键挤出屏幕；
                      这张卡只有"进列表"一件事，不需要三行说明。 */}
                {publicRoomsCap && <OpenRoomsCard onClick={() => useLobby.getState().openPublicRooms()} compact={matchPage} />}
              </div>

              {/* 「公开这间房」开关（建房时用，缺省关）：只在选中「自定义房间」且服务端有公开房列表时摆。
                  ★ 它不是房间上的一格状态（建完不能改，服务端没有这个端点），是"下一个动作"的一个选项，
                    所以放在这张卡与主键之间、不放进 lobbyStore 的房间对象里。 */}
              {pick === "room" && publicRoomsCap && (
                <label className="flex items-center gap-1.5 text-[10px] leading-snug text-slate-300">
                  <input
                    type="checkbox"
                    checked={publicRoomOn}
                    onChange={() => useLobby.getState().togglePublicRoom()}
                    className="h-3 w-3 accent-brand"
                  />
                  <Trans>公开这间房（别人能搜到）</Trans>
                </label>
              )}
              {/* 匹配页：主键在左列底部；首屏：主键在下面那一段（两处同一份 primaryBlock） */}
              {matchPage && primaryBlock(true)}
              {!matchPage && joinForm(true)}
            </div>
            {matchPage ? (
              // 右列是"凭码加入"：墙是亮的，输入框与灰键单摆着读不清 —— 垫一层薄底
              <div className="flex w-[min(15rem,28vw)] flex-none flex-col items-stretch gap-1.5 rounded-xl bg-ink/45 p-2 ring-1 ring-white/10 backdrop-blur-sm">
                {joinForm(false)}
              </div>
            ) : (
              primaryBlock(false)
            )}
          </div>
        )}

        {screen === "matching" && matchSize !== null && (
          <MatchingScreen
            size={matchSize}
            online={online}
            queue={queue}
            note={note}
            busy={busy}
            matchStartedAt={matchStartedAt}
            onStart={() => startMatch(matchSize)}
          />
        )}

        {screen === "room" && room && (
          <RoomScreen room={room} remote={online ? remoteRoom : null} onStart={() => startMatch(room.size)} />
        )}

        {screen === "public" && <PublicRooms onCreate={createFromPublic} />}
      </div>

      {/* ── 底栏：一次只显示一件事（开局失败 > 退回本机/服务端原因 > 本机规矩 > 联机现状 > 正在连） ── */}
      <footer className="flex min-h-[1.5rem] items-center justify-center gap-2 px-3 pb-1">
        {(startFailed || onlineRun.startFailed) && gameRejection ? (
          <p className="text-center text-[10px] leading-snug text-danger-200">{ruleFailureText(gameRejection.failure)}</p>
        ) : rejection ? (
          <p className="text-center text-[10px] leading-snug text-danger-200">{lobbyFailureText(rejection)}</p>
        ) : note ? (
          <>
            <p className="text-center text-[10px] leading-snug text-slate-300">{lobbyNoteText(note)}</p>
            {/* ★ ALREADY_IN_ROOM 的那颗键（2026-11-24 真机死锁）：服务端说我还在某间房里时，
                只念一句是不够的 —— 那要等 30 分钟房寿命（或去另一台设备退）。这里给一条出路：
                退出那间房 → 按原意（建房 / 进房 / 排队）自动重试一次。 */}
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
            {/* 公开房列表 / 观战被拒的那一句（403 / 429 / 409 各有各的话，见 spectate.spectateNoteOf） */}
            <p className="text-center text-[10px] leading-snug text-slate-300">{lobbyNoteText(publicNote)}</p>
            {/* ★ 409「你已经是这间房的玩家」不是死路：给一颗「直接进房」——按那句里的房号走普通进房
                （服务端对同一间房回 ALREADY_IN_ROOM + 整份快照，lobbyStore.joinByCode 会把那一支当成功）。 */}
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
        ) : busy ? (
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
        )}
      </footer>
      </div>
      {/* 穿窗途中唯一能点的一颗键：取消 = 立刻复位（安卓返回键走 ui/backButton 的层栈，同一个 handler）
          ★ 2026-11-27（第 1 条）：`top-3`（12px）在真机横屏整颗都被状态栏压住（inset-top=41），
          改成统一的安全区偏移；命中区 h-11 = 44×44 CSS px 起（文字键再宽一点）。 */}
      {flying && (
        <button
          type="button"
          onClick={cancelMatchCine}
          style={{ top: "var(--safe-float-top)" }}
          className="absolute right-3 z-10 flex h-11 min-w-[2.75rem] items-center justify-center rounded-full bg-panel/85 px-3 text-xs font-semibold text-slate-200 backdrop-blur ring-1 ring-white/15"
        >
          <Trans>✕ 取消</Trans>
        </button>
      )}
    </div>
  );
}

/**
 * 第四张卡「🏠 公开房」（2026-11-24）：与模式卡同一套长相，但它是**入口**不是"选中"——
 * 点一下直接开列表那一屏（`aria-pressed` 在这里没有意义，所以不写）。
 * ★ 比模式卡窄一档（`6rem~9rem`）：4 张按原宽在 800×363 上会折行，把底栏主键挤出屏幕。
 */
function OpenRoomsCard({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  if (compact) {
    // 匹配页（明月窗背景）用的紧凑版：一行、只有图标 + 标题 + 箭头（高度 ≈ 34 px）
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-lg bg-panel/70 px-2 py-1 text-left ring-1 ring-white/10 active:bg-raised"
      >
        <span aria-hidden className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand/20 text-[12px] font-black text-brand-200">
          🏠
        </span>
        <span className="text-[11px] font-bold leading-tight text-slate-100">
          <Trans>公开房</Trans>
        </span>
        <span className="ml-auto text-[9px] leading-tight text-slate-400">
          <Trans>看列表 ›</Trans>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="lobby-mode-card relative flex w-[clamp(6rem,15vw,9rem)] flex-col items-start gap-1 rounded-xl bg-panel/80 px-2.5 py-2 text-left ring-1 ring-white/10 active:bg-raised"
    >
      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/20 text-[15px] font-black text-brand-200">
        🏠
      </span>
      <span className="text-[12px] font-bold leading-tight text-slate-100">
        <Trans>公开房</Trans>
      </span>
      <span className="text-[10px] leading-snug text-slate-400">
        <Trans>看别人开的房，加入或观战</Trans>
      </span>
      <span className="mt-auto rounded-full bg-white/10 px-1.5 text-[9px] leading-[1.7] text-slate-300">
        <Trans>看列表 ›</Trans>
      </span>
    </button>
  );
}

/**
 * 大厅首屏的一张模式卡（纯展示 + 选中：点它只改选中项，开局是底栏主键的事）。
 * ★ 选中态 = 描边 + 轻微上浮（0.15s，CSS 过渡）；`aria-pressed` 让读屏 / 键盘知道哪张选着。
 */
function ModeCard({
  glyph,
  title,
  line,
  badge,
  selected,
  onSelect,
  compact = false,
}: {
  glyph: string;
  title: string;
  line: string;
  badge: string;
  selected: boolean;
  onSelect: () => void;
  /** 匹配页（明月窗背景）用的一行紧凑版：只留图标 + 标题 + 选中标（不高过 34 px）。 */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${title}（${line}）`}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left ring-1 transition-transform duration-75 ${
          selected
            ? "bg-brand/[0.14] ring-2 ring-brand/70 motion-reduce:translate-y-0"
            : "bg-panel/70 ring-white/10 active:bg-raised"
        }`}
      >
        <span
          aria-hidden
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-black ${
            selected ? "bg-brand/25 text-brand-100" : "bg-brand/20 text-brand-200"
          }`}
        >
          {glyph}
        </span>
        <span className="truncate text-[11px] font-bold leading-tight text-slate-100">{title}</span>
        <span className="ml-auto text-[9px] leading-tight text-slate-400">{selected ? "✓" : badge}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`lobby-mode-card relative flex w-[clamp(8.4rem,23vw,12rem)] flex-col items-start gap-1 rounded-xl px-2.5 py-2 text-left ${
        selected
          ? "-translate-y-0.5 bg-brand/[0.12] ring-2 ring-brand/70 shadow-[0_6px_18px_rgb(56_189_248_/_0.14)] motion-reduce:translate-y-0"
          : "bg-panel/80 ring-1 ring-white/10 active:bg-raised"
      }`}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-black text-ink"
        >
          ✓
        </span>
      )}
      <span
        aria-hidden
        className={`flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-black ${
          selected ? "bg-brand/25 text-brand-100" : "bg-brand/20 text-brand-200"
        }`}
      >
        {glyph}
      </span>
      <span className="text-[12px] font-bold leading-tight text-slate-100">{title}</span>
      <span className="text-[10px] leading-snug text-slate-400">{line}</span>
      <span className="mt-auto rounded-full bg-white/10 px-1.5 text-[9px] leading-[1.7] text-slate-300">{badge}</span>
    </button>
  );
}

/**
 * 4 人 / 8 人匹配那一屏。
 * ★ 联机接通时摆"我 + 等真人"并显示队列人数；没接通 / 超时退回时摆"我 + AI 补位"，
 *   底下明说这一局是 AI 补齐的（与接联机之前那一屏一致）。
 * ★ 2026-11-24 视觉 P0 加了三样（docs/game-lobby-ui-benchmark.md #17 + §1.4 动效）：
 *   · 雷达（纯 CSS conic-gradient 转一圈；`prefers-reduced-motion` 下停成静态圆环）；
 *   · 「已排队 N 秒 · 预计 X」——`queue.etaSec` 是服务端给的估算；没给（null）就按客户端的
 *     60 秒上限说「预计最多 1 分 00 秒」。**读秒是本地事实**（matchStartedAt），不冒充服务端时间；
 *   · 取消匹配保留（取消是安全操作，不加确认弹窗）。
 */
function MatchingScreen({
  size,
  online,
  queue,
  note,
  busy,
  matchStartedAt,
  onStart,
}: {
  size: MatchSize;
  online: boolean;
  queue: { queued: number; need: number; etaSec: number | null } | null;
  note: LobbyNote | null;
  busy: boolean;
  matchStartedAt: number;
  onStart: () => void;
}) {
  const { t } = useLingui();
  const aiIds = aiSeatIds(size - 1);
  const timedOut = note?.kind === "queue-timeout";
  const canStartLocal = !online && !busy;
  // 已排队的读秒：每秒一次重渲（只在联机等匹配时走；本机那一屏没有"排队"这回事）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [online]);
  const waitedSec = matchStartedAt > 0 ? Math.max(0, Math.floor((now - matchStartedAt) / 1_000)) : 0;
  /**
   * 预计等待：`etaSec` 有就念（≥60 秒写成「x 分 xx 秒」）；没有就照 60 秒上限说"最多"。
   * ★ 不把 etaSec 与 60 秒上限取 min：服务端只是估算，客户端那个上限是**兜底**（到点退回 AI），
   *   两个数说的事不同，混在一起会让人以为"预计 60 秒一定会开"。
   */
  const etaText =
    typeof queue?.etaSec === "number"
      ? queue.etaSec >= 60
        ? t`预计 ${Math.floor(queue.etaSec / 60)} 分 ${String(queue.etaSec % 60).padStart(2, "0")} 秒`
        : t`预计 ${Math.max(1, Math.floor(queue.etaSec))} 秒`
      : t`预计最多 ${Math.floor(QUEUE_TIMEOUT_MS / 60_000)} 分 00 秒`;
  const waitingLine = queue && queue.queued > 0 ? t`已排队 ${waitedSec} 秒 · ${etaText}` : t`正在进匹配队列…`;

  return (
    // ★ 宽度按"一排 4 个座位"封顶（4×88 + 3×6 ≈ 370px）：8 人桌正好摆成 4+4，
    //   4 人桌一排，2 人桌两个；不封顶的话 800 宽的横屏会摆成 6+2（看着像漏了两个座位）。
    <div className="flex w-full max-w-[24rem] flex-col items-center gap-1.5">
      {online && <MatchRadar />}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <SeatChip name={t`我`} mine />
        {online
          ? Array.from({ length: size - 1 }, (_, i) => <WaitChip key={i} />)
          : aiIds.map((id) => <SeatChip key={id} name={playerName(id)} />)}
      </div>
      {online ? (
        <>
          <p className="text-center text-[11px] font-semibold leading-snug text-slate-200">{waitingLine}</p>
          {queue && queue.queued > 0 && (
            <p className="text-center text-[10px] leading-snug text-slate-300">
              <Trans>
                正在等真人：这一池 {queue.queued}/{queue.need || size} 人。
              </Trans>
            </p>
          )}
          <p className="text-center text-[10px] leading-snug text-slate-400">
            <Trans>最多等 60 秒，没等到真人就先用 AI 开局。</Trans>
          </p>
          <div className="flex items-center justify-center gap-2">
            <GameBtn onClick={() => useLobby.getState().backHome()}>
              <Trans>取消匹配</Trans>
            </GameBtn>
          </div>
        </>
      ) : (
        <>
          <p className="text-center text-[10px] leading-snug text-slate-300">
            {busy ? (
              <Trans>正在连接房间服务…</Trans>
            ) : timedOut ? (
              <Trans>没匹配到真人，先用 AI 开局。</Trans>
            ) : (
              <Trans>没连上房间服务：这一局 {size - 1} 个座位由 AI 陪玩补齐。</Trans>
            )}
          </p>
          <div className="flex items-center justify-center gap-2">
            <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={onStart} disabled={!canStartLocal}>
              <Trans>用 AI 开局</Trans>
            </GameBtn>
            <GameBtn onClick={() => useLobby.getState().backHome()}>
              <Trans>取消</Trans>
            </GameBtn>
          </div>
        </>
      )}
    </div>
  );
}

/** 等匹配的雷达：一圈扫描扇面 + 中心"我"。纯 CSS（conic-gradient + mask），不单开 Canvas。 */
function MatchRadar() {
  return (
    <div aria-hidden className="relative h-[clamp(2.75rem,8vw,4rem)] w-[clamp(2.75rem,8vw,4rem)]">
      <span className="absolute inset-0 rounded-full ring-1 ring-brand/15" />
      <span className="lobby-radar absolute inset-0 rounded-full" />
      <span className="lobby-radar-glow absolute inset-[36%] rounded-full bg-brand/25 ring-1 ring-brand/50" />
    </div>
  );
}

/** 联机等匹配时"还没坐到人"的那一格（与 SeatChip 同一个长相，不假装是 AI）。 */
function WaitChip() {
  return (
    <div className="flex w-[clamp(4.6rem,11vw,6.5rem)] flex-col items-center gap-0.5 rounded-lg bg-white/[0.02] px-1.5 py-1 ring-1 ring-white/5">
      <span aria-hidden className="text-[11px] font-semibold text-slate-500">
        —
      </span>
      <span className="rounded-full bg-white/[0.04] px-1.5 text-[9px] leading-[1.7] text-slate-500">
        <Trans>等真人</Trans>
      </span>
    </div>
  );
}

/** 匹配那一屏的一格（我 / AI 补位）：与房间的座位块同一套长相，但不带任何操作。 */
function SeatChip({ name, mine = false }: { name: string; mine?: boolean }) {
  return (
    <div
      className={`flex w-[clamp(4.6rem,11vw,6.5rem)] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 ring-1 ${
        mine ? "bg-brand/10 ring-brand/40" : "bg-panel/70 ring-white/10"
      }`}
    >
      <span className="max-w-full truncate text-[11px] font-semibold text-slate-100">{name}</span>
      {/* ★ "我"那一格不再挂一颗写着"我"的徽记（名字已经是"我"，两行同一个词等于没信息）；
          靠底色与描边标出来。AI 那几格才需要"AI 补位"这四个字（§4 的明示）。 */}
      {!mine && (
        <span className="rounded-full bg-white/10 px-1.5 text-[9px] leading-[1.7] text-slate-300">
          <Trans>AI 补位</Trans>
        </span>
      )}
    </div>
  );
}
