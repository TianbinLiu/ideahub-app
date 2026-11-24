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
import { lastHistoryRoomFor } from "../historyLastRoom";
import { useHistory } from "../historyStore";
import GameBtn from "./GameBtn";
import RoomScreen from "./RoomScreen";
import { startFromLobby } from "./startFromLobby";
import { useLobbyOnline } from "./useLobbyOnline";

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
  // 对局开着的时候大厅不出现（结束对局那一下会重新开它，见 StudioPage 的顶栏）
  const inGame = useGame((s) => s.state !== null);
  // 开局失败时的原因由对局 store 记着（rules 的失败原因，说人话在 reasons 一处）
  const gameRejection = useGame((s) => s.rejection);
  const [startFailed, setStartFailed] = useState(false);
  // 联机轮询（等匹配 / 房间快照 / 服务端开局 → 本机建局）
  const onlineRun = useLobbyOnline();

  /**
   * 首屏选中的模式（默认 4 人）。
   * ★ 收掉大厅时归位到默认值：下次从「▶ 开局」/ `?lobby=1` 进来看到的是一张干净的默认选中态，
   *   而不是上一轮留下的 8 人或自定义（关大厅那一刻的"下一个动作"已经结束了）。
   */
  const [pick, setPick] = useState<LobbyPick>("match4");
  useEffect(() => {
    if (!open) setPick("match4");
  }, [open]);

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
   * 「最近一局回放」入口（2026-11-24）：房号来自本机记录（`historyLastRoom`，开局成功那一刻写的），
   * 不是服务端事实 —— 大厅这时候没有房间会话。
   * ★ 只在首屏摆（等匹配 / 房间屏里摆一个"上一局"会跟眼前的开局流程抢注意力）。
   * ★ 能力位**明确为假**时不摆（服务端 docs：读不到 gameHistory = 老服务端，App 不摆战绩 / 回放）；
   *   还没探到（null）照摆 —— 大厅先进来、健康探测慢半拍是常态，藏起来等于让刚打完的人找不到入口。
   * ★ 没有记录 / 不是当前账号那一局 → 不摆（理由见 historyLastRoom 的文件头）。
   */
  const accountId = currentUser()?.id ?? null;
  const lastRoomCode = lastHistoryRoomFor(accountId);
  const showReplay = screen === "home" && lastRoomCode !== null && serverGameHistory() !== false;

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

  /** 主键那一下：把"选中"变成"走"（点卡片不会走到这里）。 */
  const startPicked = () => {
    if (busy) return;
    if (pick === "room") useLobby.getState().chooseRoom();
    else useLobby.getState().chooseMatch(pick === "match8" ? 8 : 4);
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

  if (!open || inGame) return null;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink text-slate-100">
      {/* ── 顶栏：标题 + 一句这是什么 + 货币条 + 回工坊 ── */}
      <header className="flex items-start justify-between gap-2 px-3 pt-2">
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
          {/* 📼 最近一局回放：只有真的打过一局联机、且这台服务器有历史端点时才摆 */}
          {showReplay && lastRoomCode && (
            <button
              type="button"
              onClick={() => useHistory.getState().openFor({ code: lastRoomCode, myUserId: accountId })}
              title={t`最近一局：${lastRoomCode}`}
              className="h-8 flex-none rounded-full bg-white/[0.06] px-2.5 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10 active:bg-white/[0.12]"
            >
              <span aria-hidden>📼</span> <Trans>最近一局回放</Trans>
            </button>
          )}
          <button
            type="button"
            onClick={() => useLobby.getState().closeLobby()}
            className="h-8 flex-none rounded-full bg-panel/85 px-3 text-[11px] font-semibold text-slate-200 backdrop-blur"
          >
            <Trans>✕ 返回工坊</Trans>
          </button>
        </div>
      </header>

      {/* ── 三屏之一（首屏 / 等匹配 / 房间） ── */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {screen === "home" && (
          // ★ 首屏自成一个上下两段：上半（模式卡 + 凭码加入）在剩余空间里垂直居中，主键固定在**底部**
          //   （docs/game-lobby-ui-benchmark.md §1.5：主键 y 86–96%）。不这样的话大屏（1384×797）
          //   上主键会飘在屏幕中间，而"底部一颗实心主键"是这一批的验收形状。
          <div className="flex w-full flex-col items-center self-stretch">
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2">
              {/* 三张模式卡：点一下只选中 */}
              <div className="flex w-full flex-wrap items-stretch justify-center gap-2.5">
                <ModeCard
                  glyph="4"
                  title={t`4 人匹配`}
                  line={t`你和 3 个对手，一桌人打得快`}
                  badge={t`AI 补位`}
                  selected={pick === "match4"}
                  onSelect={() => setPick("match4")}
                />
                <ModeCard
                  glyph="8"
                  title={t`8 人匹配`}
                  line={t`你和 7 个对手，8 个座位的大桌`}
                  badge={t`AI 补位`}
                  selected={pick === "match8"}
                  onSelect={() => setPick("match8")}
                />
                <ModeCard
                  glyph="#"
                  title={t`自定义房间`}
                  line={t`开一间房，把房间码念给朋友`}
                  badge={t`房主开局`}
                  selected={pick === "room"}
                  onSelect={() => setPick("room")}
                />
              </div>
              {/* ── 凭房间码加入（联机接通之后才有意义：本机房间的码只在本机） ──
                  ★ 联机没接通时也摆着：点了会在底栏说"没连上房间服务"，比藏起来更诚实
                    （藏起来的话，拿到码的人会以为 App 没有这个功能）。 */}
              <form
                className="flex w-full items-center justify-center gap-1.5"
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
                  className="h-8 w-32 rounded-lg bg-white/[0.06] px-2 text-center font-mono text-[13px] tracking-[0.2em] text-slate-100 ring-1 ring-white/10 placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-500"
                />
                <GameBtn onClick={join} disabled={busy || !normalizeServerCode(joinCode)}>
                  <Trans>加入房间</Trans>
                </GameBtn>
              </form>
            </div>
            {/* 底部主键：唯一能真的进队 / 建房的那一下 */}
            <div className="flex w-full flex-none flex-col items-center gap-1 pb-1">
              <button
                type="button"
                onClick={startPicked}
                disabled={busy}
                aria-keyshortcuts="Enter"
                className="h-[clamp(2.25rem,6.2vh,2.75rem)] w-[clamp(12rem,32vw,20rem)] rounded-xl bg-brand text-[clamp(12px,1.6vw,14px)] font-black text-ink shadow-[0_6px_20px_rgb(56_189_248_/_0.28)] transition-transform duration-75 active:scale-[0.97] disabled:opacity-50 motion-reduce:transition-none motion-reduce:transform-none"
              >
                {busy ? <Trans>正在连接房间服务…</Trans> : primaryLabel}
              </button>
              <p className="text-[9px] leading-tight text-slate-500">
                <Trans>点卡片只选中，不会直接开局；键盘上按 Enter 也能开始。</Trans>
              </p>
            </div>
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
}: {
  glyph: string;
  title: string;
  line: string;
  badge: string;
  selected: boolean;
  onSelect: () => void;
}) {
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
