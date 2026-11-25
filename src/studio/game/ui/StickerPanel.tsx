// 局内「😀 贴纸」面板（2026-11-24，P1「贴卡 / 表情」= docs/game-lobby-ui-benchmark.md §2.1 #7 / #8、§2.3 第 3 条）。
//
// ★★ 为什么键长在**背包条右边**（与商店键并排）：800×363 上真正空着的地方只剩下沿那一条 ——
//   上面是 HUD（y 70~96）、对手条（y 104~129）、左上角玩家面板（x 12~152）、右边道具栏（x 725 起）；
//   底部那一条从左到右是"背包条 → 商店键"，再往右到道具栏下沿之间是空的（量过：商店键右沿 651.4、
//   道具栏下沿 y 243，中间没有任何东西）。放在这里既摸得到（拇指那一带），也不与设置（右上）、
//   玩家面板（左上）、阶段条（正下方）打架 —— 任务点名的三处正好都不在这儿。
//   ★ 它由 GameLayer 用 `absolute left-full` 挂在背包条右边（**不进流**）：进流会把整条底部栏
//     推左 25px，左下角的气泡栈就压到背包条上了（那份测量见 ui/StickerBubbles 的 ★★）。
//
// ★★ 面板**只在打开时存在**（不是常驻的一层）：它向上展开，会压在创作面板 / 桌面卡位上，
//   所以"点一下发出去 + 当场收起"才是它的正经用法（云顶的表情轮盘也是选完就关）。
//   气泡（ui/StickerBubbles）才是常驻的那一半 —— 那一半**不许**挡卡位 / 背包条，见那个文件。
//
// ★ 贴一张卡：卡面不复用别的组件，直接用 `ui/GameCardTile` 同一套素材（`art.gameCardArt`）——
//   任务点名"复用来做卡面渲染的组件，别新画一套"：气泡里那张卡就是商店 / 背包里那张卡的同一位图，
//   而卡名走 `labels.gameCardName`（同一个函数，切语言时两边一起翻）。
//
// ★ 节流（同一人 2 秒最多 1 条）在这里**只表现为灰键 + 一行倒计时**；真正的闸在
//   `studio/game/stickerStore` 的 deliver（判据只有 `stickers.stickerWaitMs` 一处）。
//   面板关着时不走表：这块在 3D 画布上面，一屏最多一个"持续动"（大厅 §1.4 那条纪律）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { gameCardArt } from "../art";
import { gameCardName, stickerFaceName, stickerSyncNote } from "../labels";
import { STICKER_FACES, STICKER_TICK_MS, stickerWaitMs, type StickerFace } from "../stickers";
import { useStickers, type StickerSendResult } from "../stickerStore";
import { useGame } from "../store";
import type { GameCard } from "../types";
import type { GameView } from "../view";

export default function StickerPanel({ view }: { view: GameView }) {
  const { t } = useLingui();
  const meId = useGame((s) => s.meId);
  const online = useGame((s) => s.online);
  /** 我在联机局里的服务端昵称（本机局是 null → 气泡按 labels.playerName 念"我"） */
  const myName = online?.myName ?? null;
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** 我上一次贴是什么时候（节流按人记，键就是座位 id） */
  const lastAt = useStickers((s) => s.lastAt[meId]);

  // 面板开着才走表（关着时一个定时器都不留）；250ms 一格够倒计时读得清
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), STICKER_TICK_MS);
    return () => clearInterval(timer);
  }, [open]);

  // 钩子全部走完再算渲染用的东西（下面有依赖 view 的派生值，但**没有早退**）。
  const waitMs = stickerWaitMs(now, lastAt);
  const throttled = waitMs > 0;

  /**
   * 能贴的卡：桌面上的（这一期正在拍的）+ 背包里的。
   * ★ 顺序 = 桌面在前、背包在后：贴出去的多半是"我现在正在用的那张"。
   * ★ 按实例 id 去重（同一张目录卡买了两张是两个 id，各贴各的才对）。
   */
  const cards: GameCard[] = [];
  const seen = new Set<string>();
  for (const card of [...view.table.roles, view.table.scene, ...view.bag.cards]) {
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }

  /** 发一条：成功就收起面板（见文件头 ★★）；被节流挡下就把倒计时刷新一下，不静默失败 */
  const fire = (send: () => StickerSendResult) => {
    const result = send();
    setNow(Date.now());
    if (result.ok) setOpen(false);
  };

  const sendFace = (face: StickerFace) =>
    fire(() => useStickers.getState().sendFace({ faceId: face.id, senderId: meId, senderName: myName, now: Date.now() }));

  const sendCard = (card: GameCard) =>
    fire(() => useStickers.getState().sendCard({ card, senderId: meId, senderName: myName, now: Date.now() }));

  return (
    <div className="relative flex-none">
      <button
        type="button"
        data-game-sticker-toggle="1"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="ingame-stickers"
        aria-label={t`贴纸：贴一个表情或者贴一张我的卡`}
        title={t`贴纸：贴一个表情或者贴一张我的卡`}
        className={`flex h-[clamp(4.1rem,8.4vw,5.9rem)] w-[clamp(2.7rem,5.6vw,3.9rem)] flex-none flex-col items-center justify-center gap-1 rounded-xl bg-panel/90 ring-1 backdrop-blur ${
          open ? "ring-brand/60" : "ring-white/10"
        }`}
      >
        <span aria-hidden className="text-[15px] leading-none">
          😀
        </span>
        <span className="text-[9px] font-semibold leading-none text-slate-200">
          <Trans>贴纸</Trans>
        </span>
      </button>

      {open && (
        <div
          id="ingame-stickers"
          data-game-sticker-panel="1"
          className="ingame-rise absolute bottom-full right-0 z-30 mb-1.5 max-h-[clamp(7rem,44vh,16rem)] w-[clamp(13rem,44vw,20rem)] overflow-y-auto rounded-xl bg-panel/95 p-1.5 ring-1 ring-white/10 backdrop-blur"
        >
          <div className="mb-1 flex items-center gap-1">
            <span className="text-[10px] font-semibold text-slate-100">
              <Trans>贴纸</Trans>
            </span>
            {/* 节流的**可见**那一半：灰键之外还要说清"为什么灰"（否则玩家以为面板坏了） */}
            <span className="min-w-0 truncate text-[9px] text-slate-500">
              {throttled ? (
                <Trans>同一人 2 秒最多 1 条 · 还差 {(waitMs / 1000).toFixed(1)} 秒</Trans>
              ) : (
                <Trans>同一人 2 秒最多 1 条</Trans>
              )}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t`收起贴纸面板`}
              className="ml-auto flex-none rounded px-1 text-[10px] text-slate-400 active:bg-white/10"
            >
              ✕
            </button>
          </div>

          {/* 16 格：8 张看板娘头像 + 8 个内置 emoji（两行，800×363 上量出来 55px 高） */}
          <div className="grid grid-cols-8 gap-1">
            {STICKER_FACES.map((face) => (
              <button
                key={face.id}
                type="button"
                data-sticker-face={face.id}
                onClick={() => sendFace(face)}
                disabled={throttled}
                aria-label={stickerFaceName(face.id)}
                title={stickerFaceName(face.id)}
                className="flex h-[clamp(1.6rem,4.6vh,2.1rem)] items-center justify-center rounded-lg bg-white/[0.06] active:bg-white/[0.16] disabled:opacity-40"
              >
                {face.kind === "mascot" ? (
                  <img src={face.glyph} alt="" className="h-[74%] w-[74%] rounded object-contain" />
                ) : (
                  <span aria-hidden className="text-[15px] leading-none">
                    {face.glyph}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 贴我的卡：卡面 + 卡名（卡面与商店 / 背包同一份素材，卡名同一个 labels 函数） */}
          <div className="mt-1 flex items-center gap-1 overflow-x-auto pb-0.5">
            <span className="flex-none text-[9px] text-slate-400">
              <Trans>贴我的卡</Trans>
            </span>
            {cards.length === 0 ? (
              <span className="text-[9px] text-slate-500">
                <Trans>手上还没有卡——先去商店买一张</Trans>
              </span>
            ) : (
              cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  data-sticker-card={card.id}
                  onClick={() => sendCard(card)}
                  disabled={throttled}
                  aria-label={t`贴「${gameCardName(card)}」`}
                  title={t`贴「${gameCardName(card)}」`}
                  className="flex flex-none items-center gap-1 rounded-lg bg-white/[0.06] px-1 py-0.5 active:bg-white/[0.16] disabled:opacity-40"
                >
                  <img src={gameCardArt(card)} alt="" className="h-[24px] w-[16px] rounded object-cover" />
                  <span className="max-w-[4.5rem] truncate text-[10px] text-slate-100">{gameCardName(card)}</span>
                </button>
              ))
            )}
          </div>

          {/* 联机缺口那一句（任务点名）：判据与话都在 labels.stickerSyncNote 一处 */}
          <div className="mt-0.5 text-[9px] leading-snug text-slate-500">{stickerSyncNote(Boolean(online))}</div>
        </div>
      )}
    </div>
  );
}
