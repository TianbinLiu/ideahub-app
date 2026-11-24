// 对局内的「👥 玩家」面板（2026-11-24，对局内 P0-1 = docs/game-lobby-ui-benchmark.md §2.1 #2 / #18）。
//
// ★★ 为什么是"左上角一块可开可收的小板"而不是一整屏：
//   一局横屏只有 800×363（真机量过：可用舞台 788×351），而"谁还活着 / 谁交了片"是**边打边瞄**的读数，
//   不是一页要读完的东西。整屏要么挡住桌面卡位、要么挡住底部阶段条 —— 那两样才是这一局的主操作。
//   所以它长在 HUD 左边那条**本来就空着的竖列**里（HUD 药丸居中、宽 30rem；顶栏那一排键在最右边），
//   尺寸见下面 PLAYER_PANEL_CLASS 的 ★：宽 17.5vw（800 上是 140px）、高 ≤38vh 且可滚 —— 实测见
//   docs/game-lobby.md 的"800×363 实测"。
//
// ★★ 举报那一格**今天不摆**（这是本仓纪律，不是漏做）：
//   · 服务端 `models/Report.js` 的 `TARGET_TYPES` 只有 video / comment / danmaku / persona
//     （2026-11-24 核过 server main），`POST /api/branch/reports` 用 z.enum 逐字校验；
//     局内的 UGC（昵称 / 交片提示词 / 生成的片子）**没有任何一个**在服务端有可举报的对象 id
//     —— 回合快照的 entries 只有 userId / prompt / cardNames / videoUrl，没有 BranchVideo id。
//   · 先接一颗 `targetType: "user"` 的键 = 用户点了必然 400（本仓 api/admin.ts 与
//     docs/play-store-checklist.md §6c 已经把这条钉成纪律："服务端先加类型、App 再接"）。
//   · 所以这一格现在只有**真的能用**的那颗：拉黑（`components/BlockButton`，服务端早就有这套关系）。
//     服务端补上 `user`（或 `game-entry`）目标类型之后，这一行接一颗 `ReportButton`
//     （`targetType="user"` / `targetId={seat.userId}`）即可 —— 组件、弹层、理由表、
//     失败话术全都是现成的（铁律六：别新写一套举报流）。
//
// ★ 名单本身**一个数都不在这里算**：单机 / 联机两条来源都在 `studio/game/roster.ts`（零依赖纯函数，
//   `scripts/check-game-ingame.mjs` 直接 import 跑正反例）。这里只负责画。
// ★ AI 座位没有服务端账号 id（`seat.userId === null`）→ 一颗动作键都不摆（任务点名：AI 不显示举报键；
//   拉黑同理 —— 服务端那份关系是按 userId 的，AI 没有这个 id）。
import { useLingui } from "@lingui/react/macro";
import BlockButton from "../../../components/BlockButton";
import { playerName } from "../labels";
import { localRosterOf, onlineRosterOf, type RosterSeat } from "../roster";
import { useRounds } from "../roundsStore";
import { useGame } from "../store";

/**
 * 面板（不是那颗开关键）的尺寸。
 * ★ 三个数都是量出来的（800×363 真机口径 = 舞台 788×351 / 浏览器 DeviceMetrics，见 docs/game-lobby.md）：
 *   · 宽 17.5vw（800 上 = 140px）：上限不是审美，是**HUD 药丸的左沿** —— 它是居中那一条
 *     `w = min(100%, 30rem)`，真机从 x 160 起（面板右沿 12+140 = 152，留 8px）；
 *     再宽就压到回合进度条的第一段（桌面场景卡位更远，在 x 189）；
 *   · 高 ≤24vh（363 上 = 87px）：底部创作面板从 y 148 起（真机量到），面板收在 143 以内，
 *     不压它；同时离背包条（y 275）与阶段条（y 321）都很远；
 *   · 顶点让开顶部那条连接横幅（`top = safe-top + 27px`，横幅高 17px）：横幅与开关键都在
 *     屏幕左上角，不留这一条就会互相盖住（2026-11-24 实测撞到过）；
 *   · 内容超出就滚（8 人局让 8 行都能看到，不靠缩小字号）。
 */
/**
 * 面板的顶点：让开顶部那条连接横幅（它在 `safe-top + 4px`，高 `clamp(1.1rem, 4.6vh, 1.6rem)`）。
 * ★ 三段的数必须与 `ui/ConnectionBanner` 的 top / 高度**同一个公式**：横幅是 vh 定的高
 *   （363 上 17px、797 上 25.6px），写死一个 27px 的话，更高的窗口里横幅会比开关键还高、
 *   两个一起挤在左上角（2026-11-24 在 1384×797 上实测撞到过：横幅底 35.6 > 开关键顶 27.2）。
 */
const PLAYER_PANEL_TOP =
  "calc(env(safe-area-inset-top, 0px) + 0.25rem + clamp(1.1rem, 4.6vh, 1.6rem) + 0.35rem)";

const PLAYER_PANEL_CLASS =
  "pointer-events-auto flex max-h-[clamp(4rem,24vh,12rem)] w-[clamp(7.5rem,17.5vw,12rem)] flex-col overflow-hidden rounded-xl bg-panel/92 ring-1 ring-white/10 backdrop-blur";

/** 一行上的一枚小徽记（只有"拿得到且为真"的状态才出现，见 roster.ts 文件头那张表）。 */
function Badge({ children, title, tone = "muted" }: { children: React.ReactNode; title: string; tone?: "muted" | "ok" | "host" | "warn" }) {
  const cls =
    tone === "host"
      ? "bg-gold/20 text-gold-200"
      : tone === "ok"
        ? "bg-ok/15 text-ok-300"
        : tone === "warn"
          ? "bg-warn/15 text-warn-200"
          : "bg-white/[0.06] text-slate-300";
  // ★ flex-none + nowrap：横屏 140px 一行要放"名字 + 血量 + 几个徽记 + 拉黑"，
  //   徽记一旦允许被压就会**折成两行**（实测"已交"变成"已/交"两根字，整行高度跳一格）。
  //   该让步的是名字（它有 min-w-0 + truncate），徽记不许缩。
  return (
    <span
      title={title}
      className={`flex-none whitespace-nowrap rounded px-1 py-px text-[9px] leading-[1.35] ${cls}`}
    >
      {children}
    </span>
  );
}

export default function PlayerPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const online = useGame((s) => s.online);
  const session = useRounds((s) => s.session);
  const room = useRounds((s) => s.room);
  const snapshot = useRounds((s) => s.snapshot);
  const settlement = useRounds((s) => s.settlement);
  const memberHp = useRounds((s) => s.memberHp);
  const abstainedRound = useRounds((s) => s.abstainedRound);
  if (!state) return null;

  /**
   * 这一桌的名单：联机 = 服务端房间成员（进度 / 房主 / 血都来自快照），
   * 单机 = 本机座位表（我 + AI 补位）。判据只有"有没有联机会话"这一条 —— 别在下面各判一次。
   */
  const onlineSeats: RosterSeat[] | null =
    online && session
      ? onlineRosterOf({
          members: session.members,
          // 房主以房间快照为准（房主转移之后每拍都会变）；还没读到快照时用开局那一份
          hostId: room?.hostId ?? (session.isHost ? session.myUserId : null),
          myUserId: session.myUserId,
          memberHp,
          settlement: settlement?.ranking ?? null,
          entries: snapshot?.entries ?? null,
          round: snapshot?.round ?? null,
          abstainedRound,
        })
      : null;
  const seats: RosterSeat[] =
    onlineSeats ??
    localRosterOf({ players: state.players, entries: state.entries, abstained: state.abstained, meId });

  /** 名字：联机用服务端昵称（拿不到才回 id），单机用座位名的中文（labels.playerName） */
  const nameOf = (seat: RosterSeat): string => seat.name?.trim() || playerName(seat.id);

  return (
    <div
      className="pointer-events-none absolute left-1.5 z-20 flex w-[clamp(7.5rem,17.5vw,12rem)] flex-col items-start gap-1"
      style={{ top: PLAYER_PANEL_TOP }}
    >
      {/* 开关键 = 面板的标题行（2026-11-24 实测：横屏 363 高，单独再占一行标题会白吃 22px，
          那是"能多看一行玩家"的钱）。收起时它是全部（键面自带人数），展开时它是"▴ 收起"。 */}
      <button
        type="button"
        data-game-players-toggle="1"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="ingame-players"
        title={
          open
            ? t`收起玩家列表`
            : onlineSeats
              ? t`本桌玩家：名字 / 血量 / 交片与投票状态`
              : t`本桌玩家：名字 / 血量 / 交片与投票状态（本机局：其余座位由 AI 补位）`
        }
        className={`pointer-events-auto flex w-full items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold backdrop-blur ring-1 ${
          open ? "bg-brand/25 text-brand-100 ring-brand/50" : "bg-panel/85 text-slate-200 ring-white/10"
        }`}
      >
        <span aria-hidden>👥</span>
        <span className="truncate">{open ? t`本桌玩家` : t`玩家`}</span>
        <span className="ml-auto tabular-nums text-slate-400">{seats.length}</span>
        <span aria-hidden className="text-slate-400">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div id="ingame-players" data-game-players="1" className={`${PLAYER_PANEL_CLASS} ingame-rise`}>
          <ul className="min-h-0 flex-1 overflow-y-auto px-0.5 py-0.5">
            {seats.map((seat) => {
              const name = nameOf(seat);
              const mine = seat.isMe;
              // ★ 一行一个玩家（2026-11-24 实测：140px 一行放得下"名字 + 血量 + 徽记 + 拉黑"，
              //   8 人局一屏能看到 5 行；拆成两行时同样高度只看得到 3 行 —— 那是"横向挤一挤"换来的可见行数）
              return (
                <li
                  key={seat.id}
                  data-game-player={seat.id}
                  className="flex items-center gap-0.5 rounded-lg px-0.5 py-0.5 text-[10px] leading-[1.35]"
                >
                  {/* 房主不是一枚单独的徽记，而是名字前面那颗 👑：横屏 140px 里，
                      单独一枚徽记要吃掉 ~22px（内边距 + 间距），而那 22px 正好是"名字还能不能读全" */}
                  <span
                    className={`min-w-0 truncate font-semibold ${mine ? "text-brand-200" : "text-slate-100"}`}
                    title={seat.isHost ? t`${name}（房主：这一局由他推进阶段）` : name}
                  >
                    {seat.isHost && <span aria-hidden className="mr-0.5">👑</span>}
                    {name}
                  </span>
                  <span
                    className={`flex-none text-[9px] tabular-nums ${seat.eliminated ? "text-slate-500" : "text-danger-200"}`}
                  >
                    <span aria-hidden>❤</span> {seat.hp}
                  </span>
                  {seat.isAi && <Badge title={t`AI 补位：这一桌没有这么多真人，空位由 AI 顶上`}>AI</Badge>}
                  {seat.eliminated ? (
                    <Badge title={t`已经出局`} tone="warn">{t`出局`}</Badge>
                  ) : seat.submitted ? (
                    <Badge title={t`这一期已经交片`} tone="ok">{t`已交`}</Badge>
                  ) : (
                    <Badge title={t`这一期还没交片`}>{t`未交`}</Badge>
                  )}
                  {/* 点赞 / 投票：只有**知道为真**时才摆（联机局里别人那两格服务端不下发，
                      拿不到就不摆 —— 见 roster.ts 文件头那张表） */}
                  {seat.liked === true && <Badge title={t`这一期点过赞`} tone="ok">👍</Badge>}
                  {seat.voted === true && <Badge title={t`这一期表过态`} tone="ok">🗳</Badge>}
                  {/* 动作键：只有拿得到服务端账号 id、且不是我自己时才有（AI 座位 userId 为 null）。
                      ★ 举报今天不摆，理由见文件头 ★★（服务端没有玩家目标类型，摆了必然 400）。 */}
                  {seat.userId && !mine && (
                    <span className="ml-auto flex flex-none items-center">
                      <BlockButton userId={seat.userId} userName={name} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
