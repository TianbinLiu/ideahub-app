// 自定义房间那一屏（§3，2026-11-23）：房间码 + 成员表 + 房主的四个动作（开始 / 踢人 / 改人数 / 邀请）。
//
// ★ 这一屏**一条规矩都不判**：
//   · "谁是谁的座位、谁能改人数、踢人踢得到谁、房主离开算什么"全在 lobby.ts（纯函数，
//     scripts/check-game-lobby.mjs 直接跑正反例）；
//   · 联机房间的"谁能开始 / 还差什么"由服务端快照给（`remote.canStart` / `startBlockedBy`），
//     这一屏只照着摆，不在客户端再算一遍（两边各算就是两套话）；
//   · 失败原因由 store 原样留着、由 Lobby 的外壳统一说人话（lobbyReasons 一处）；
//   · 开局那一下走 ui/startFromLobby（两个 store 只有一个地方互相认识）。
// ★ 联机接通（2026-11-24）之后这一屏有两种房间：
//   · `remote != null`：服务端房间。成员 / 准备状态来自 2 秒轮询的快照；**不摆改人数**
//     （服务端没有这个端点，见 api/game/rooms 底部），空座位照实写「AI 补位」
//     （服务端只放真人，开局那一刻本机按座位数把空位补成 AI）。
//   · `remote == null`：本机房间（联机不可用时的退路）。与接联机之前的这一屏逐字节一样。
// ★ 横屏 800×363 的视口里这一屏要塞下：房间码一行 + 最多 8 个座位 + 人数增减 + 两颗键。
//   座位用小方块（`clamp(4.6rem,11vw,6.5rem)`、两行 4 个也能折行），不写 `vw` 的宽度给整块
//   —— 真机上整块按视口算会伸到舞台外面（docs/g3-round-loop.md 那条坑：面板一律 w-full max-w-[…]）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  hostStartDataFresh,
  hostStartLabelOf,
  ROOM_MAX_SIZE,
  ROOM_MIN_SIZE,
  isHostOf,
  roomStartPlan,
  LOCAL_SEAT_ID,
  type LobbyRoom,
  type LobbySeat,
} from "../lobby";
import { useLobby } from "../lobbyStore";
import { playerName } from "../labels";
import type { RemoteRoom } from "../../../api/game/rooms";
import GameBtn from "./GameBtn";

export default function RoomScreen({
  room,
  remote,
  onStart,
}: {
  room: LobbyRoom;
  /** 联机房间的服务端快照；null = 本机房间 */
  remote: RemoteRoom | null;
  /**
   * 房主那颗键（本机房间 = 直接建局；联机房间 = lobbyStore.prepareStart：
   * 先强制拉最新快照，再按服务端事实决定走服务端开局还是 AI 补位）。
   */
  onStart: () => void;
}) {
  const { t } = useLingui();
  const inviteOpen = useLobby((s) => s.inviteOpen);
  const roomSyncedAt = useLobby((s) => s.roomSyncedAt);
  const [copied, setCopied] = useState<"idle" | "ok" | "manual">("idle");
  /**
   * 「这份房间数据还新不新鲜」要在**时间走过**之后自己重算一次（判据 hostStartDataFresh）。
   * ★ 这里不轮询网络（那在 useLobbyOnline，一处定时器）：只是让 label / 提示在"数据变旧"那一刻
   *   跟着变 —— 否则轮询失败之后界面会一直停在最后一次的"1/4 + 用 AI 补位"，那正是事故的形状。
   */
  const [now, setNow] = useState(() => Date.now());
  const online = remote !== null;
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [online]);
  // ★ 两个"我"是同一个值（lobby.LOCAL_SEAT_ID）：房主身份只认它，不认"第 0 个座位"
  const host = isHostOf(room, LOCAL_SEAT_ID);
  const plan = roomStartPlan(room);
  const canShrink = room.size > ROOM_MIN_SIZE;
  const canGrow = room.size < ROOM_MAX_SIZE;
  const mySeat = room.seats.find((seat) => seat.playerId === LOCAL_SEAT_ID) ?? null;
  /**
   * ★★ 联机房间：开局键的语义只认 `hostStartLabelOf` 一处（构建里 check-game-lobby 跑正反例）——
   *   真人够（≥ requiredPlayers）→「开始对局」；真人不够但数据新鲜 →「用 AI 补位开局」；
   *   **数据陈旧（没在同步 / 从没读到）时一律「开始对局」**，点了先强制刷新（见 prepareStart）。
   *   不能拿陈旧数据说"还是我一个人，AI 补位吧"——那会把已经坐上来的真人关在门外。
   */
  const fresh = !online || hostStartDataFresh(roomSyncedAt, now);
  const label = online && remote ? hostStartLabelOf({ memberCount: remote.memberCount, requiredPlayers: remote.requiredPlayers, syncedAt: roomSyncedAt, now }) : "ai";
  // 只有"人够了、但有人没准备"这一种才灰键；陈旧时**不灰**（点下去先刷新，别让按钮点了没反应）
  const startDisabled = online && !!remote && fresh && remote.memberCount >= remote.requiredPlayers && remote.startBlockedBy === "not-all-ready";
  const shortOfHumans = online && label === "ai";

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

      {/* ── 联机状态一句话：几个真人、空位怎么算 ──
          ★ 2026-11-24 接回合引擎之后这句话改过一次：以前写"空位开局时由 AI 补齐"，但服务端的回合只认**真人成员**
            （结算榜按 room.members 算，没有 AI 座位）。再写"AI 补位"就是一句会被下一屏拆穿的假话。 */}
      {online && remote && (
        <p className="text-center text-[10px] leading-snug text-slate-400">
          <Trans>
            联机房间：{remote.memberCount}/{remote.size} 个真人；服务端的回合只算真人，空位不参加这一局。
          </Trans>
        </p>
      )}

      {/* ── 成员表：房主 / 我 / 真人 / AI 补位 / 空位 ──
          ★ 一排 4 个（与匹配那一屏同一条封顶）：8 人桌摆成 4+4，不会出现 7+1 那种像漏了一个人的排法 */}
      <div className="mx-auto flex w-full max-w-[24rem] flex-wrap items-stretch justify-center gap-1.5">
        {room.seats.map((seat) => (
          <SeatTile key={seat.index} seat={seat} host={host} online={online} />
        ))}
      </div>

      {/* ── 人数（房主，2~8）：**联机房间不摆**——服务端没有改人数端点 ──
          ★ 不摆而不是灰着：灰着会让人以为"等一会儿就能改"。真需要改人数就是退出重建。 */}
      {host && !online && (
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
          房主：开始对局（联机走服务端；真人不够时按 AI 补位开）+ 离开房间
          非房主：只有准备 / 离开（§3「非房主只能准备/离开」） */}
      <div className="flex items-center justify-center gap-2">
        {host ? (
          <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={onStart} disabled={startDisabled}>
            {label === "ai" ? <Trans>用 AI 补位开局</Trans> : <Trans>开始对局</Trans>}
          </GameBtn>
        ) : (
          <GameBtn tone="primary" className="px-4 py-1.5 text-[12px]" onClick={() => useLobby.getState().toggleReady()}>
            {mySeat?.ready ? <Trans>取消准备</Trans> : <Trans>准备</Trans>}
          </GameBtn>
        )}
        <GameBtn onClick={() => useLobby.getState().leaveCurrentRoom()}>
          <Trans>离开房间</Trans>
        </GameBtn>
      </div>

      {/* ── 状态那一句：人不够 / 有人没准备 / 数据还没同步上 / AI 补几个 / 等房主 ── */}
      <p className="text-center text-[10px] text-slate-400">
        {shortOfHumans ? (
          <Trans>服务端要至少 {remote?.requiredPlayers ?? 2} 个真人才开局；现在只有你，点一下先用 AI 补位开一局。</Trans>
        ) : host && startDisabled ? (
          <Trans>还有队友没点准备——全员准备好之后房主才能开局。</Trans>
        ) : host && online && !fresh ? (
          // ★ 数据陈旧：不拿它决定 AI 补位。点上面那颗键会先强制刷新，刷新失败就"先别开"。
          <Trans>房间状态还没同步上：点「开始对局」会先拉一次最新的，拉不到就先不开。</Trans>
        ) : host ? (
          online ? (
            <Trans>这一局按 {remote?.memberCount ?? 0} 个真人开：服务端的回合只算真人，空位不参加。</Trans>
          ) : (
            <Trans>开局时 {plan.aiCount} 个座位由 AI 陪玩补齐</Trans>
          )
        ) : mySeat?.ready ? (
          <Trans>已准备，等房主开局</Trans>
        ) : (
          <Trans>等房主开一局：非房主只能准备或离开</Trans>
        )}
      </p>

      {/* ── 邀请卡：联机接通之后这个码真的能进房；没接通时只能给可复制的码 ── */}
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
              {online ? (
                <Trans>把房间码念给朋友：他们在大厅的「加入房间」里输入就能进来。服务端的回合只算真人，空位不参加。</Trans>
              ) : (
                <Trans>联机还没接通：这个码现在只能念给人听，别人还进不来。开局时空位由 AI 补上。</Trans>
              )}
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
function SeatTile({ seat, host, online }: { seat: LobbySeat; host: boolean; online: boolean }) {
  const { t } = useLingui();
  const name = seat.name ?? (seat.playerId ? playerName(seat.playerId) : null);
  // 联机房间只放真人：空座位在服务端不存在，但开局那一刻本机会按座位数把它补成 AI
  const kickable = host && (seat.kind === "ai" || (online && seat.kind === "guest"));
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
        seat.kind === "empty" && !online ? "bg-white/[0.02] ring-white/5" : "bg-panel/70 ring-white/10"
      }`}
    >
      <span className="max-w-full truncate text-[11px] font-semibold text-slate-100">
        {/* ★ 空位的名字位留一个破折号：徽记已经写着"空位 / AI 补位"，两行同一个词等于没信息 */}
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
