// 公开房列表（2026-11-24）：大厅第四张卡「🏠 公开房」点开的那一屏。
//
// ★ 一行回答五件事（任务点名）：房主名 / 模式 / 人数 x/y / 状态 / 那一颗键。
//   键只有两种：`joinable`（服务端判：waiting 且没坐满）→「加入」；否则 →「观战」（能力位为真才摆）。
//   **不自己算** joinable：拿 state / members 再推一遍，等哪天服务端改了"满员也列出来"的口径就是两把尺。
// ★ 三个页签（等真人 / 进行中 / 已结束）不是一个列表的三个滤镜：服务端的 `state` 是**必选**查询参数
//   （缺省只回 waiting），所以点页签就是换一份列表、页码从 1 重来。
// ★ 下拉刷新用 pointer 事件（不是 touch）：模拟器 / 桌面浏览器拖一下也要能刷新，而触屏上这同样是
//   pointerdown → pointermove；只在 `scrollTop === 0` 且往下拖时才算，绝不抢滚动。
// ★ 滚到底加载更多：`hasMore`（服务端给的，`page × limit < total`）为真才发下一发；按房号去重
//   （实时列表翻页期间会位移，服务端只保证"同一秒按 _id 兜底"，跨请求管不了）。
// ★ 空列表与"没读到"是两件事：真的一间都没有 →「现在没有公开房」+「去建房」；
//   读失败 → 说清没读到、给「重试」（铁律八：失败要响，不能装成空）。
import { useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLobby } from "../lobbyStore";
import { roomModeText, roomStateText } from "../lobbyReasons";
import { useSpectate } from "../spectateStore";
import { useSpectateCap } from "./useSpectateCaps";
import type { PublicRoomRow, RemoteRoomState } from "../../../api/game/rooms";
import type { LobbyNote } from "../lobbyStore";
import GameBtn from "./GameBtn";

/** 下拉多少像素才触发刷新（按拖了多远算，不是松手那一刻的位移） */
const PULL_TRIGGER = 26;
/** 拉到最多显示这么高（再拉也不涨，给一个"到底了"的手感） */
const PULL_MAX = 44;

/** 三个页签（服务端的 `state` 三态；文案在 lobbyReasons.roomStateText 一份）。 */
const STATES: RemoteRoomState[] = ["waiting", "playing", "over"];

export default function PublicRooms({ onCreate }: { onCreate: () => void }) {
  const state = useLobby((s) => s.publicState);
  const rooms = useLobby((s) => s.publicRooms);
  const total = useLobby((s) => s.publicTotal);
  const hasMore = useLobby((s) => s.publicHasMore);
  const loading = useLobby((s) => s.publicLoading);
  const note = useLobby((s) => s.publicNote);
  const busy = useLobby((s) => s.busy);
  /** 能力位：读不到 / 为假时不摆「观战」键（点了会 404） */
  const canSpectate = useSpectateCap();

  const listRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<{ startY: number } | null>(null);
  const [pull, setPull] = useState(0);

  const refresh = () => void useLobby.getState().refreshPublicRooms();
  const loadMore = () => void useLobby.getState().loadMorePublicRooms();

  /** 滚到底加载更多：离底 24px 以内就发（阈值不是 0：惯性滚动最后那一下常常差几像素） */
  const onScroll = () => {
    const el = listRef.current;
    if (!el || !hasMore || loading !== "idle") return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) loadMore();
  };

  // ── 下拉刷新 ──
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el || el.scrollTop > 0) return;
    pullRef.current = { startY: event.clientY };
    // 捕获这一串 pointer：鼠标拖出列表再松手也要收到 pointerup（否则指示条会卡在屏幕上）
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pullRef.current;
    if (!start) return;
    const el = listRef.current;
    if (!el || el.scrollTop > 0) {
      // 已经滚下去了 = 这一下是正常滚动，不是下拉
      pullRef.current = null;
      setPull(0);
      return;
    }
    const dy = event.clientY - start.startY;
    setPull(dy > 0 ? Math.min(PULL_MAX, dy * 0.5) : 0);
  };
  const endPull = () => {
    if (!pullRef.current) return;
    pullRef.current = null;
    if (pull >= PULL_TRIGGER && loading === "idle") refresh();
    setPull(0);
  };

  const join = (room: PublicRoomRow) => {
    if (busy || loading !== "idle") return;
    useLobby.getState().joinPublicRoom(room.code);
  };
  const watch = (room: PublicRoomRow) => {
    if (busy || loading !== "idle") return;
    void useLobby.getState().enterSpectate(room.code).then((entry) => {
      // 进席成功才开观战屏（失败原因已经在 publicNote 里，由大厅底栏说）
      if (entry) void useSpectate.getState().enter(entry);
    });
  };

  const empty = rooms.length === 0 && loading !== "refresh";
  const failed = note !== null && rooms.length === 0 && loading !== "refresh";

  return (
    <div className="flex h-full min-h-0 w-full max-w-[44rem] flex-col items-center gap-1">
      {/* 顶栏：标题 + 总数 + 刷新 + 返回（返回是回大厅首屏，不是关大厅） */}
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <h2 className="text-[12px] font-bold text-slate-100">🏠 <Trans>公开房</Trans></h2>
        <span className="text-[10px] text-slate-400">
          <Trans>一共 {total} 间</Trans>
        </span>
        <span className="min-w-0 flex-1" />
        <GameBtn onClick={refresh} disabled={loading !== "idle"}>
          {loading === "refresh" ? <Trans>正在刷新…</Trans> : <Trans>刷新</Trans>}
        </GameBtn>
        <GameBtn onClick={() => useLobby.getState().backHome()}>
          <Trans>‹ 返回</Trans>
        </GameBtn>
      </div>

      {/* 三个页签：换页签 = 换一份列表（服务端的 state 是必选查询参数） */}
      <div className="flex w-full items-center gap-1.5">
        {STATES.map((one) => (
          <button
            key={one}
            type="button"
            onClick={() => useLobby.getState().pickPublicState(one)}
            aria-pressed={state === one}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
              state === one
                ? "bg-brand/20 text-brand-100 ring-brand/50"
                : "bg-white/[0.04] text-slate-300 ring-white/10 active:bg-white/[0.1]"
            }`}
          >
            {roomStateText(one)}
          </button>
        ))}
        <span className="min-w-0 flex-1" />
        <span className="text-[9px] text-slate-500">
          <Trans>下拉刷新 · 滚到底加载更多</Trans>
        </span>
      </div>

      {/* 下拉指示条：只在拖着的时候占位（松手 / 刷新完成就收回去） */}
      <div
        aria-hidden={pull === 0}
        style={{ height: pull }}
        className="flex w-full flex-none items-center justify-center overflow-hidden text-[10px] text-slate-400 transition-[height] duration-100 motion-reduce:transition-none"
      >
        {pull > 0 &&
          (pull >= PULL_TRIGGER ? <Trans>松开刷新</Trans> : <Trans>下拉刷新</Trans>)}
      </div>

      {/* 列表本体：唯一一个滚动区（横向不滚） */}
      <div
        ref={listRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPull}
        onPointerCancel={endPull}
        className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto overscroll-y-contain rounded-xl bg-panel/40 p-1 ring-1 ring-white/5"
      >
        {rooms.map((room) => (
          <div
            key={room.code}
            className="flex flex-none items-center gap-2 rounded-lg bg-panel/90 px-2 py-1 ring-1 ring-white/10"
          >
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-100">
              {room.hostName ?? <Trans>房主（昵称读不到）</Trans>}
            </span>
            <span className="flex-none text-[10px] text-slate-400">{roomModeText(room.mode)}</span>
            <span className="w-10 flex-none text-right text-[10px] tabular-nums text-slate-300">
              {room.members}/{room.seats}
            </span>
            <span
              className={`flex-none rounded-full px-1.5 text-[9px] leading-[1.7] ${
                room.state === "waiting"
                  ? "bg-brand/15 text-brand-100"
                  : room.state === "playing"
                    ? "bg-gold/20 text-gold-100"
                    : "bg-white/10 text-slate-300"
              }`}
            >
              {roomStateText(room.state)}
            </span>
            {room.joinable ? (
              <GameBtn tone="primary" className="flex-none px-2 py-0.5 text-[10px]" onClick={() => join(room)} disabled={busy || loading !== "idle"}>
                <Trans>加入</Trans>
              </GameBtn>
            ) : canSpectate ? (
              <GameBtn className="flex-none px-2 py-0.5 text-[10px]" onClick={() => watch(room)} disabled={busy || loading !== "idle"}>
                <Trans>观战</Trans>
              </GameBtn>
            ) : (
              // 能力位为假 / 读不到：这一行没有能做的动作，留一格空（别摆一颗点了 404 的键）
              <span className="w-9 flex-none" />
            )}
          </div>
        ))}

        {loading === "more" && (
          <p className="flex-none py-1 text-center text-[10px] text-slate-400">
            <Trans>正在加载更多…</Trans>
          </p>
        )}

        {empty && failed && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-[11px] font-semibold text-slate-200">
              <Trans>没读到公开房列表</Trans>
            </p>
            <p className="max-w-[26rem] text-[10px] leading-snug text-slate-400">
              <PublicNoteHint note={note} />
            </p>
            <GameBtn tone="primary" onClick={refresh}>
              <Trans>重试</Trans>
            </GameBtn>
          </div>
        )}

        {empty && !failed && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-[11px] font-semibold text-slate-200">
              <Trans>现在没有公开房</Trans>
            </p>
            <p className="max-w-[26rem] text-[10px] leading-snug text-slate-400">
              {state === "waiting" ? (
                <Trans>等一会儿再看看，或者自己开一间公开房让别人搜到。</Trans>
              ) : (
                <Trans>这个页签下暂时没有房；换个页签看看，或者自己开一间。</Trans>
              )}
            </p>
            <GameBtn tone="primary" onClick={onCreate}>
              <Trans>去建房</Trans>
            </GameBtn>
          </div>
        )}
      </div>

      {hasMore && loading === "idle" && rooms.length > 0 && (
        <button
          type="button"
          onClick={loadMore}
          className="flex-none text-[10px] text-brand-200 active:opacity-80"
        >
          <Trans>加载更多</Trans>
        </button>
      )}
    </div>
  );
}

/** 列表读失败时那句原因（说人话在这一处，不在 store 里）。 */
function PublicNoteHint({ note }: { note: LobbyNote | null }) {
  if (!note) return <Trans>下拉刷新或点「刷新」再试一次。</Trans>;
  switch (note.kind) {
    case "offline":
      return <Trans>没连上房间服务：可能是网络抖了一下，过一会儿再刷新。</Trans>;
    case "public-rooms-off":
      return <Trans>这台服务器把公开房列表关掉了。</Trans>;
    case "code":
      return <Trans>房间服务回了没见过的错误：{note.code}</Trans>;
    default:
      return <Trans>过一会儿再刷新一次。</Trans>;
  }
}
