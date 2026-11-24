// 自定义房间那一屏（§3，2026-11-23）：房间码 + 成员表 + 房主的四个动作（开始 / 踢 AI / 改人数 / 邀请）。
//
// ★ 这一屏**一条规矩都不判**：
//   · "谁是谁的座位、谁能改人数、踢人踢得到谁、房主离开算什么"全在 lobby.ts（纯函数，
//     scripts/check-game-lobby.mjs 直接跑正反例）；
//   · 失败原因由 store 原样留着、由 Lobby 的外壳统一说人话（lobbyReasons 一处）；
//   · 开局那一下走 ui/startFromLobby（两个 store 只有一个地方互相认识）。
// ★ 「邀请」在联机接通前只能给**房间码**（api/game/rooms.ts 的桩全回 unavailable）——
//   所以那张卡明说"别人还进不来、开局时空位 AI 补"，不假装发出了邀请。
// ★ 横屏 800×363 的视口里这一屏要塞下：房间码一行 + 最多 8 个座位 + 人数增减 + 两颗键。
//   座位用小方块（`clamp(4.6rem,11vw,6.5rem)`、两行 4 个也能折行），不写 `vw` 的宽度给整块
//   —— 真机上整块按视口算会伸到舞台外面（docs/g3-round-loop.md 那条坑：面板一律 w-full max-w-[…]）。
// ★ 「开始对局」的建局动作由外层（ui/Lobby 的 startMatch）递进来：大厅两屏走**同一条**开局路
//   （`ui/startFromLobby`），失败原因也由大厅底栏那一处说 —— 这一屏不算人数、不调 store。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ROOM_MAX_SIZE, ROOM_MIN_SIZE, isHostOf, roomStartPlan, LOCAL_SEAT_ID, type LobbyRoom, type LobbySeat } from "../lobby";
import { useLobby } from "../lobbyStore";
import { playerName } from "../labels";
import GameBtn from "./GameBtn";

export default function RoomScreen({ room, onStart }: { room: LobbyRoom; onStart: () => void }) {
  const { t } = useLingui();
  const inviteOpen = useLobby((s) => s.inviteOpen);
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");
  // ★ 两个"我"是同一个值（lobby.LOCAL_SEAT_ID）：房主身份只认它，不认"第 0 个座位"
  const host = isHostOf(room, LOCAL_SEAT_ID);
  const plan = roomStartPlan(room);
  const canShrink = room.size > ROOM_MIN_SIZE;
  const canGrow = room.size < ROOM_MAX_SIZE;

  /** 复制房间码：老 WebView 上 navigator.clipboard 可能整个 undefined（同 ShareSheet 的退路），
   *  拿不到就把码摆在那里让人长按选中 —— 不假装"已复制"。 */
  const copyCode = () => {
    const clip = navigator.clipboard;
    if (!clip?.writeText) {
      setCopied("manual");
      return;
    }
    void clip.writeText(room.code).then(
      () => setCopied("ok"),
      () => setCopied("manual"),
    );
  };

  const start = () => {
    // 房主开局：空位由 AI 补（plan.aiCount），人数 = 房间人数（规则层只认座位数）；
    // 真正的建局在外层（onStart），这一屏只把"能开"这一下递出去
    onStart();
  };

  return (
    <div className="relative flex w-full max-w-[42rem] flex-col items-center gap-1.5">
      {/* ── 房间码 + 邀请 ── */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-[10px] text-slate-400">
          <Trans>房间码</Trans>
        </span>
        <span
          className="select-all rounded bg-white/10 px-2 py-0.5 font-mono text-[15px] tracking-[0.25em] text-slate-100"
          aria-label={t`房间码 ${room.code}`}
        >
          {room.code}
        </span>
        <GameBtn onClick={() => useLobby.getState().toggleInvite(true)}>
          <Trans>邀请</Trans>
        </GameBtn>
      </div>

      {/* ── 成员表：房主 / 我 / AI 补位 / 空位 ──
          ★ 一排 4 个（与匹配那一屏同一条封顶）：8 人桌摆成 4+4，不会出现 7+1 那种像漏了一个人的排法 */}
      <div className="mx-auto flex w-full max-w-[24rem] flex-wrap items-stretch justify-center gap-1.5">
        {room.seats.map((seat) => (
          <SeatTile key={seat.index} seat={seat} host={host} />
        ))}
      </div>

      {/* ── 人数（房主，2~8） ── */}
      {host && (
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-300">
          <span>
            <Trans>人数</Trans>
          </span>
          <GameBtn onClick={() => useLobby.getState().resizeRoom(room.size - 1)} disabled={!canShrink} title={t`少一个座位`}>
            −
          </GameBtn>
          <span className="w-4 text-center text-[12px] font-semibold tabular-nums text-slate-100">{room.size}</span>
          <GameBtn onClick={() => useLobby.getState().resizeRoom(room.size + 1)} disabled={!canGrow} title={t`多一个座位`}>
            +
          </GameBtn>
          <span className="text-slate-400">
            <Trans>
              {ROOM_MIN_SIZE}~{ROOM_MAX_SIZE} 人，空位开局时 AI 补
            </Trans>
          </span>
        </div>
      )}

      {/* ── 开始 / 准备 / 离开 ──
          房主：开始对局（空位 AI 补）+ 离开房间（房主离开 = 散房）
          非房主：只有准备 / 离开（§3「非房主只能准备/离开」） */}
      <div className="flex items-center justify-center gap-2">
        {host ? (
          <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={start}>
            <Trans>开始对局</Trans>
          </GameBtn>
        ) : (
          <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={() => useLobby.getState().toggleReady()}>
            <Trans>准备</Trans>
          </GameBtn>
        )}
        <GameBtn onClick={() => useLobby.getState().leaveCurrentRoom()}>
          <Trans>离开房间</Trans>
        </GameBtn>
      </div>

      <p className="text-center text-[10px] text-slate-400">
        {host ? (
          <Trans>开局时 {plan.aiCount} 个座位由 AI 陪玩补齐</Trans>
        ) : (
          <Trans>等房主开一局：非房主只能准备或离开</Trans>
        )}
      </p>

      {/* ── 邀请卡：联机没接通时只能给可复制的房间码 ── */}
      {inviteOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-ink/85 p-3"
          onClick={() => useLobby.getState().toggleInvite(false)}
        >
          <div
            className="w-full max-w-[22rem] rounded-xl border border-white/10 bg-raised p-3 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[12px] font-semibold text-slate-100">
              <Trans>邀请别人进这间房</Trans>
            </h3>
            <div className="my-2 select-all font-mono text-[24px] tracking-[0.3em] text-gold-200">{room.code}</div>
            <p className="text-left text-[10px] leading-snug text-slate-300">
              <Trans>
                联机还没接通：这个码现在只能念给人听，别人还进不来。开局时空位由 AI 补上。
              </Trans>
            </p>
            {copied === "manual" && (
              <p className="mt-1 text-left text-[10px] leading-snug text-slate-300">
                <Trans>这台设备不让碰剪贴板——长按上面的房间码选中复制。</Trans>
              </p>
            )}
            <div className="mt-2 flex justify-center gap-2">
              <GameBtn tone="gold" onClick={copyCode}>
                {copied === "ok" ? <Trans>已复制</Trans> : <Trans>复制房间码</Trans>}
              </GameBtn>
              <GameBtn onClick={() => useLobby.getState().toggleInvite(false)}>
                <Trans>关闭</Trans>
              </GameBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 一格座位：谁坐在上面 + 那一格的类型徽记（房主 / 已准备 / AI 补位 / 空位）+ 房主的踢人键。 */
function SeatTile({ seat, host }: { seat: LobbySeat; host: boolean }) {
  const { t } = useLingui();
  const name = seat.playerId ? playerName(seat.playerId) : null;
  const kickable = host && seat.kind === "ai";
  const badge =
    seat.kind === "host" ? (
      <Trans>房主</Trans>
    ) : seat.kind === "guest" ? (
      seat.ready ? (
        <Trans>已准备</Trans>
      ) : (
        <Trans>未准备</Trans>
      )
    ) : seat.kind === "ai" ? (
      <Trans>AI 补位</Trans>
    ) : (
      <Trans>空位</Trans>
    );
  const badgeSkin =
    seat.kind === "host"
      ? "bg-gold/20 text-gold-100"
      : seat.kind === "guest"
        ? seat.ready
          ? "bg-ok/20 text-ok-200"
          : "bg-white/10 text-slate-300"
        : seat.kind === "ai"
          ? "bg-brand/20 text-brand-100"
          : "bg-white/[0.04] text-slate-400";

  return (
    <div
      className={`flex w-[clamp(4.6rem,11vw,6.5rem)] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 ring-1 ${
        seat.kind === "empty" ? "bg-white/[0.02] ring-white/5" : "bg-panel/70 ring-white/10"
      }`}
    >
      <span className="max-w-full truncate text-[11px] font-semibold text-slate-100">
        {/* ★ 空位的名字位留一个破折号：徽记已经写着"空位"，两行同一个词等于没信息 */}
        {name ?? <span aria-hidden>—</span>}
      </span>
      <span className={`rounded-full px-1.5 text-[9px] leading-[1.7] ${badgeSkin}`}>{badge}</span>
      {kickable && (
        <button
          type="button"
          onClick={() => useLobby.getState().kickSeat(seat.index)}
          aria-label={t`踢掉 ${name ?? ""}`}
          className="rounded px-1 text-[9px] leading-[1.6] text-slate-400 ring-1 ring-white/10 active:bg-white/10"
        >
          <Trans>踢掉</Trans>
        </button>
      )}
    </div>
  );
}
