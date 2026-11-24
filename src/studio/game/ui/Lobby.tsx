// 对局大厅（2026-11-23）：进对局之前的那一屏 —— 4 人匹配 / 8 人匹配 / 自定义房间。
//
// ★ 流程：StudioPage 顶栏的「▶ 开局」不再直接开一局，而是先开这一屏（lobbyStore.openLobby）。
//   玩家选一种开局方式 → 建局（`ui/startFromLobby`，人数由大厅给）→ 大厅收掉、对局 UI 顶上来。
// ★ 为什么不塞进 GameLayer：那一层是"对局中"的仪表盘（它 `if (!state) return null`），
//   而大厅恰恰是**还没有 state** 的那一屏。两件事分开挂（StudioPage 里 `{isLand && <Lobby />}`），
//   竖屏两边都不挂（与对局一致，G1 的竖屏逐字节不变）。
// ★ 这一屏**不挂 3D**：铺满舞台的实底 + 停掉画布的 frameloop（StudioPage 的 canvasCovered 也认大厅），
//   大厅里没有任何一张卡、一个桌面 —— 它只是一张三选一的入口卡。
// ★ 不摆金币 / 券 / 血量（主人点名"别塞"）：大厅要回答的只有"这一局怎么开"，
//   那些数是**对局中**的读数，摆在这里既没用又要跟着对局状态走（大厅和局之间就会开始漂）。
// ★ 联机还没接通：三条路现在都靠 AI 补位（api/game/rooms.ts 的桩全回 unavailable）——
//   所以每一屏都照实说"AI 补位"，不假装在等真人。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { aiSeatIds, type MatchSize } from "../lobby";
import { useLobby } from "../lobbyStore";
import { lobbyFailureText } from "../lobbyReasons";
import { useGame } from "../store";
import { ruleFailureText } from "../reasons";
import { playerName } from "../labels";
import GameBtn from "./GameBtn";
import RoomScreen from "./RoomScreen";
import { startFromLobby } from "./startFromLobby";

export default function Lobby() {
  const { t } = useLingui();
  const open = useLobby((s) => s.open);
  const screen = useLobby((s) => s.screen);
  const room = useLobby((s) => s.room);
  const matchSize = useLobby((s) => s.matchSize);
  const rejection = useLobby((s) => s.rejection);
  // 对局开着的时候大厅不出现（结束对局那一下会重新开它，见 StudioPage 的顶栏）
  const inGame = useGame((s) => s.state !== null);
  // 开局失败时的原因由对局 store 记着（rules 的失败原因，说人话在 reasons 一处）
  const gameRejection = useGame((s) => s.rejection);
  const [startFailed, setStartFailed] = useState(false);

  // 换一屏就把"上一屏开局失败"那句话收掉：不然回到首屏还挂着一条已经无关的红字
  useEffect(() => {
    setStartFailed(false);
  }, [open, screen]);

  if (!open || inGame) return null;

  /** 这一局开起来没有：开不起来时留在这一屏，把对局 store 记下的原因摆出来（不先收大厅） */
  const startMatch = (playerCount: number) => {
    setStartFailed(!startFromLobby(playerCount));
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink text-slate-100">
      {/* ── 顶栏：标题 + 一句这是什么 + 回工坊 ── */}
      <header className="flex items-start justify-between gap-2 px-3 pt-2">
        <div className="min-w-0">
          <h1 className="text-[14px] font-bold tracking-wide text-slate-100">
            <Trans>对局大厅</Trans>
          </h1>
          <p className="text-[10px] leading-snug text-slate-400">
            <Trans>选一种开局方式：4 人 / 8 人匹配，或者开一间自定义房间。</Trans>
          </p>
        </div>
        <button
          type="button"
          onClick={() => useLobby.getState().closeLobby()}
          className="h-8 flex-none rounded-full bg-panel/85 px-3 text-[11px] font-semibold text-slate-200 backdrop-blur"
        >
          <Trans>✕ 返回工坊</Trans>
        </button>
      </header>

      {/* ── 三屏之一（首屏 / 等匹配 / 房间） ── */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3">
        {screen === "home" && (
          <div className="flex w-full flex-wrap items-stretch justify-center gap-2.5">
            <EntryCard
              glyph="4"
              title={t`4 人匹配`}
              line={t`你和 3 个对手，一桌人打得快`}
              badge={t`AI 补位`}
              onClick={() => useLobby.getState().chooseMatch(4)}
            />
            <EntryCard
              glyph="8"
              title={t`8 人匹配`}
              line={t`你和 7 个对手，8 个座位的大桌`}
              badge={t`AI 补位`}
              onClick={() => useLobby.getState().chooseMatch(8)}
            />
            <EntryCard
              glyph="#"
              title={t`自定义房间`}
              line={t`开一间房，把房间码念给朋友`}
              badge={t`房主开局`}
              onClick={() => useLobby.getState().chooseRoom()}
            />
          </div>
        )}

        {screen === "matching" && matchSize !== null && (
          <MatchingScreen size={matchSize} onStart={() => startMatch(matchSize)} />
        )}

        {screen === "room" && room && <RoomScreen room={room} onStart={() => startMatch(room.size)} />}
      </div>

      {/* ── 底栏：一次只显示一件事（开局失败 > 大厅被拒 > 联机现状） ── */}
      <footer className="flex min-h-[1.5rem] items-center justify-center px-3 pb-1">
        {startFailed && gameRejection ? (
          <p className="text-center text-[10px] leading-snug text-danger-200">{ruleFailureText(gameRejection.failure)}</p>
        ) : rejection ? (
          <p className="text-center text-[10px] leading-snug text-danger-200">{lobbyFailureText(rejection)}</p>
        ) : (
          <p className="text-center text-[10px] leading-snug text-slate-400">
            <Trans>联机还没接通：现在开局一律由 AI 陪玩补位，真人匹配要等服务端房间。</Trans>
          </p>
        )}
      </footer>
    </div>
  );
}

/** 大厅首屏的一张入口卡（纯展示：点哪一张由外层决定，这里不判任何状态）。 */
function EntryCard({
  glyph,
  title,
  line,
  badge,
  onClick,
}: {
  glyph: string;
  title: string;
  line: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[clamp(8.4rem,23vw,12rem)] flex-col items-start gap-1 rounded-xl bg-panel/80 px-2.5 py-2 text-left ring-1 ring-white/10 transition-colors active:bg-raised"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/20 text-[15px] font-black text-brand-200"
      >
        {glyph}
      </span>
      <span className="text-[12px] font-bold leading-tight text-slate-100">{title}</span>
      <span className="text-[10px] leading-snug text-slate-400">{line}</span>
      <span className="mt-auto rounded-full bg-white/10 px-1.5 text-[9px] leading-[1.7] text-slate-300">{badge}</span>
    </button>
  );
}

/** 4 人 / 8 人匹配那一屏：座位先按"我 + AI"摆出来，明说这一局是 AI 补齐的。 */
function MatchingScreen({ size, onStart }: { size: MatchSize; onStart: () => void }) {
  const { t } = useLingui();
  const aiIds = aiSeatIds(size - 1);
  return (
    // ★ 宽度按"一排 4 个座位"封顶（4×88 + 3×6 ≈ 370px）：8 人桌正好摆成 4+4，
    //   4 人桌一排，2 人桌两个；不封顶的话 800 宽的横屏会摆成 6+2（看着像漏了两个座位）。
    <div className="flex w-full max-w-[24rem] flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <SeatChip name={t`我`} mine />
        {aiIds.map((id) => (
          <SeatChip key={id} name={playerName(id)} />
        ))}
      </div>
      <p className="text-center text-[10px] leading-snug text-slate-300">
        <Trans>联机还没接通：这一局 {size - 1} 个座位由 AI 陪玩补齐。</Trans>
      </p>
      <div className="flex items-center justify-center gap-2">
        <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={onStart}>
          <Trans>用 AI 开局</Trans>
        </GameBtn>
        <GameBtn onClick={() => useLobby.getState().backHome()}>
          <Trans>取消</Trans>
        </GameBtn>
      </div>
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
