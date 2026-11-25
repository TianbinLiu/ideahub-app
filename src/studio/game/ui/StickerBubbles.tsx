// 局内贴纸的**气泡**（左下角那一摞；2026-11-24，P1「贴卡 / 表情」）。
//
// ★★ 位置是量出来的，不是试出来的（800×363，舞台 788×351，dev 实测）：
//   · 底边 `STICKER_STACK_BOTTOM` = 2.6rem（41.6px）→ 气泡栈的底落在 y 321.4，
//     正好压在**阶段条**（y 321.3 高 29.8）上沿 —— 那一条是"下一步点哪"，被压住就等于把主操作盖了；
//   · 宽 `STICKER_STACK_WIDTH` = 17.5vw（800 上 140px）→ 右沿 146，**背包条**从 x 148.5 起（留 2.5px）；
//   · 最高 26vh（94.4px）→ 5 条单行气泡（≈93px）装得下；再多裁掉最老的（`flex-col-reverse` + overflow）。
//   · **桌面卡位**在 x 189~537（`scene/layout` 的百分比投影）—— 气泡栈右沿 146 碰不到它。
//   三处都是任务点名"不许挡"的：卡位 / 背包条 / 阶段条。
//   ★ 唯一一处让步（量过、写进 docs/game-lobby.md §7.15）：**创作阶段**那一块面板从 y 136 起，
//     5 条都堆满时气泡栈顶在 227 上下，与它的**左下角**重叠 ~15px（那块只有"道具挂在哪张卡上"的
//     一行小字）。4 条以内（本机局实际最多 4 条：我 2 秒 1 条 + AI 每回合最多 2 条）装得下，不重叠。
//
// ★★ AI 的贴纸**只有本机局播**（`online` 为真时一段都不 seed）：联机局里那些座位是真人，
//   照着脚本给他们编一条表情，就是"编数据"（与 roster.ts 里"别人赞没赞服务端不下发就不摆"同一条）。
//   联机贴纸的缺口写在面板底部那句 `labels.stickerSyncNote(online)`。
//
// ★ 一个 200ms 的时钟同时管三件事：AI 第 2 条的延迟上屏、4 秒后的淡出、过期清理。
//   只在这一摞非空时走表（空的时候连定时器都不挂）—— 这块在 3D 画布上面，能省则省。
// ★ `pointer-events-none`：气泡是读数，永不接住点击（下面那一片桌面卡位照样能拖）。
import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { gameCardArt } from "../art";
import { gameCardName, playerName } from "../labels";
import {
  STICKER_STACK_BOTTOM,
  STICKER_STACK_MAX_HEIGHT,
  STICKER_STACK_WIDTH,
  STICKER_TICK_MS,
  liveStickersAt,
  stickerFadingAt,
} from "../stickers";
import { useStickers } from "../stickerStore";
import { useGame } from "../store";

export default function StickerBubbles() {
  const { t } = useLingui();
  const bubbles = useStickers((s) => s.bubbles);
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const seed = useGame((s) => s.seed);
  const online = useGame((s) => s.online);
  const [now, setNow] = useState(() => Date.now());

  // 这一摞非空时才走表：上屏那一刻（AI 有 1.4 秒延迟）与 4 秒淡出都读 `now`
  useEffect(() => {
    if (bubbles.length === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      // 清过期也在这一拍（store 只在真的少了条目时才写 state，见 prune 的 ★）
      useStickers.getState().prune(tick);
    }, STICKER_TICK_MS);
    return () => clearInterval(timer);
  }, [bubbles.length]);

  // 本机局：每回合由 AI 随机贴 1~2 条（幂等：seedRound 自己判"这一回合播过没有"）
  useEffect(() => {
    if (!state || online) return;
    // 这一局已经结束：不再给"打完的牌桌"添新贴纸（结算屏上冒一条 AI 表情很怪）
    if (state.phase === "over") return;
    const seats = state.players.filter((player) => player.id !== meId && !player.eliminated).map((player) => player.id);
    useStickers.getState().seedRound({ round: state.round, seed, seats, now: Date.now() });
  }, [state, online, meId, seed]);

  // 这一局没了（结束对局 / 被踢回大厅）：整份清掉，下一局从干净的一摞开始
  useEffect(() => {
    if (!state) useStickers.getState().reset();
  }, [state]);

  const live = liveStickersAt(bubbles, now);
  if (live.length === 0) return null;

  return (
    <div
      data-game-stickers="1"
      role="log"
      aria-live="polite"
      aria-label={t`局内贴纸`}
      className="pointer-events-none absolute left-0 z-20 flex flex-col-reverse gap-0.5 overflow-hidden"
      style={{ bottom: STICKER_STACK_BOTTOM, width: STICKER_STACK_WIDTH, maxHeight: STICKER_STACK_MAX_HEIGHT }}
    >
      {live.map((bubble) => {
        const name = bubble.senderName ?? playerName(bubble.senderId);
        return (
          <div
            key={bubble.id}
            data-sticker-bubble={bubble.face?.id ?? bubble.card?.id ?? ""}
            data-sticker-sender={bubble.senderId}
            className={`sticker-bubble flex max-w-full items-center gap-1 rounded-lg bg-panel/90 px-1.5 py-px text-[10px] ring-1 ring-white/10 backdrop-blur ${
              stickerFadingAt(bubble, now) ? "sticker-out" : ""
            }`}
          >
            {/* 发送者名字（任务点名）：本机局没有昵称 → labels.playerName（"我" / "对手 A"） */}
            <span className="max-w-[3.4rem] flex-none truncate text-[9px] text-slate-400" title={name}>
              {name}
            </span>
            {bubble.face ? (
              bubble.face.kind === "mascot" ? (
                <img src={bubble.face.glyph} alt={t`表情`} className="h-[15px] w-[15px] flex-none rounded object-contain" />
              ) : (
                <span className="text-[14px] leading-none">{bubble.face.glyph}</span>
              )
            ) : bubble.card ? (
              // 卡面 + 卡名（与商店 / 背包同一份素材、同一个名字函数）
              <span className="flex min-w-0 items-center gap-1">
                <img src={gameCardArt(bubble.card)} alt="" className="h-[22px] w-[15px] flex-none rounded object-cover" />
                <span className="min-w-0 truncate text-[10px] text-slate-100">{gameCardName(bubble.card)}</span>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
