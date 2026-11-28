// 匹配页（B · 卡片桌游）—— 2026-11-27，design/ui-mockups/match-ui-variants 的 B 案。
//
// 这一屏只负责「桌沿」：左列三张厚卡 + 黄铜主键，右列一张票根「凭码加入」。
// 中间整块留给 3D 的窗与月亮（绒布 / 暗角 / 纹理在 Lobby 的背景层，不在这里盖满）。
//
// ★ 与 3D 共存：这里**没有**任何铺满整屏的底色；所有面都压在左右两列（在窗与月亮之外）。
//   底部「明 月 窗」小铜牌是**唯一**伸到中线的元素，而且只挂在 3D 窗真的在屏上时
//   （windowVisible）；取消穿窗 / 老场景里没有窗，那块牌子就不出现。
// ★ 热区：模式卡 h-11（44）、主键 h-12（48）、票根输入与按钮 h-11、公开房入口 h-11、
//   公开这间房那一行也按 44 撑开 —— 真机量法与读数见 docs/game-lobby-ui-b-c.md。
// ★ 选中态 = 金边 + 轻微上浮 + 右侧 ✓（保留新手引导里「右上角亮起 ✓」那一步的说法）。
// ★ 所有文案走 lingui：这一屏没有一句硬编码中文（check-i18n 的 A/B 两条都盯着）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useMoonRect } from "./moonAlign";

/** 首屏选中的那一种开局方式（点卡片只改它，点主键才真的开始）。 */
export type LobbyPick = "match4" | "match8" | "room";

interface ModeCardSpec {
  glyph: string;
  title: string;
  line: string;
  badge: string;
  pick: LobbyPick;
}

export interface MatchLobbyBProps {
  pick: LobbyPick;
  onPick: (pick: LobbyPick) => void;
  /** 黄铜主键（就是会触发穿窗转场的那一颗；接线仍在 Lobby.startPicked） */
  primaryLabel: string;
  onStart: () => void;
  busy: boolean;
  flying: boolean;
  /** 服务端有公开房列表才摆那颗入口（老服务端不摆一个点了 404 的键） */
  publicRoomsCap: boolean;
  onOpenPublicRooms: () => void;
  /** 选中「自定义房间」时才有：公开这间房（别人能搜到） */
  showPublicToggle: boolean;
  publicRoomOn: boolean;
  onTogglePublic: () => void;
  joinCode: string;
  onJoinCode: (code: string) => void;
  onJoin: () => void;
  /** 3D 的窗与月亮在不在屏上（不在 = 老场景 / 取消过穿窗）：只在屏上才画「明 月 窗」铜牌 */
  windowVisible: boolean;
}

export default function MatchLobbyB({
  pick,
  onPick,
  primaryLabel,
  onStart,
  busy,
  flying,
  publicRoomsCap,
  onOpenPublicRooms,
  showPublicToggle,
  publicRoomOn,
  onTogglePublic,
  joinCode,
  onJoinCode,
  onJoin,
  windowVisible,
}: MatchLobbyBProps) {
  const { t } = useLingui();
  const { ref: moonRef, rect: moon } = useMoonRect<HTMLDivElement>();

  const cards: ModeCardSpec[] = [
    { glyph: "4", title: t`4 人匹配`, line: t`你和 3 个对手，一桌人打得快`, badge: t`AI 补位`, pick: "match4" },
    { glyph: "8", title: t`8 人匹配`, line: t`你和 7 个对手，8 个座位的大桌`, badge: t`AI 补位`, pick: "match8" },
    { glyph: "#", title: t`自定义房间`, line: t`开一间房，把房间码念给朋友`, badge: t`房主开局`, pick: "room" },
  ];

  return (
    <div ref={moonRef} className="absolute inset-0" data-lobby-screen="match-b">
      {/* 中线唯一一块 DOM：窗下的铜牌（只在 3D 窗在屏上时出现）。定位用同一份月亮投影，
          与匹配中（C）的光环容器同一个来源（moonAlign），不会两屏各算一个位置。 */}
      {windowVisible && moon && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[1] -translate-x-1/2 -translate-y-1/2"
          style={{ left: moon.cx, top: moon.cy + moon.r + 16 }}
        >
          <span className="lobby-plaque">
            <Trans>明 月 窗</Trans>
          </span>
        </div>
      )}

      {/* ── 左列：手写标题 + 三张厚卡 + 黄铜主键 ── */}
      <div className="absolute bottom-3 left-3 z-[2] flex w-[min(17rem,32vw)] flex-col">
        <span className="lobby-eyebrow">
          <Trans>窗下 · 一桌人</Trans>
        </span>
        <div className="lobby-hand mt-0.5 leading-none">
          <Trans>开一桌？</Trans>
        </div>
        <div data-guide="lobby-modes" className="mt-1.5 flex w-full flex-col gap-1">
          {cards.map((card) => {
            const selected = pick === card.pick;
            return (
              <button
                key={card.pick}
                type="button"
                onClick={() => onPick(card.pick)}
                aria-pressed={selected}
                aria-label={t`${card.title}（${card.line}）`}
                className={`lobby-card-b flex h-11 w-full items-center gap-2 px-2 text-left ${selected ? "is-selected" : ""}`}
              >
                <span aria-hidden className="lobby-seal">
                  {card.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{card.title}</b>
                  <em className="block truncate">{card.line}</em>
                </span>
                {selected ? (
                  <span aria-hidden className="lobby-card-check">
                    ✓
                  </span>
                ) : (
                  <span className="lobby-card-badge">{card.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 主机：黄铜厚牌。★ 点它仍然 await beginFlyThrough()（接线在 Lobby.startPicked，没动） */}
        <div className="mt-1.5">
          <button
            type="button"
            data-guide="lobby-start"
            onClick={onStart}
            disabled={busy || flying}
            aria-keyshortcuts="Enter"
            className="lobby-brass-cta flex h-12 w-full items-center justify-between px-3 disabled:opacity-50"
          >
            <span className="truncate">{busy ? <Trans>正在连接房间服务…</Trans> : primaryLabel}</span>
            <span aria-hidden className="lobby-brass-go">
              →
            </span>
          </button>
          <p className="lobby-note mt-1">
            <Trans>点卡片只选中；这一下才真的发牌（键盘 Enter 也行）。</Trans>
          </p>
        </div>
      </div>

      {/* ── 右列：票根 ── */}
      <div className="absolute bottom-2 right-3 z-[2] flex w-[min(14.75rem,30vw)] flex-col gap-1">
        <form
          data-guide="lobby-join"
          onSubmit={(e) => {
            e.preventDefault();
            onJoin();
          }}
          className="lobby-ticket"
        >
          <div className="flex items-baseline justify-between">
            <span className="lobby-ticket-h">
              <Trans>凭码加入</Trans>
            </span>
            <span className="lobby-ticket-no">
              <Trans>TICKET · 6 位</Trans>
            </span>
          </div>
          <div aria-hidden className="lobby-ticket-dash" />
          <label className="relative block" aria-label={t`房间码`}>
            <span aria-hidden className="flex gap-1">
              {Array.from({ length: 6 }, (_, i) => (
                <span
                  key={i}
                  className={`lobby-code-cell ${i === Math.min(joinCode.length, 5) ? "is-caret" : ""}`}
                >
                  {joinCode[i] ?? ""}
                </span>
              ))}
            </span>
            <input
              value={joinCode}
              onChange={(e) => onJoinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6))}
              placeholder={t`输入 6 位房间码`}
              aria-label={t`房间码`}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              className="absolute inset-0 z-10 w-full bg-transparent text-transparent caret-transparent outline-none placeholder:text-transparent"
            />
          </label>
          <button
            type="submit"
            disabled={busy || joinCode.length !== 6}
            className="lobby-ticket-join mt-2 flex h-11 w-full items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Trans>加入房间</Trans>
            <span aria-hidden>→</span>
          </button>
          <p className="lobby-note mt-1.5 text-center">
            <Trans>房间码念给朋友 · 6 位字母数字</Trans>
          </p>
        </form>

        {/* 公开房入口：有公开房列表才摆（与原来第四张卡同一判据，只是换到右列票根下方） */}
        {publicRoomsCap && (
          <button
            type="button"
            onClick={onOpenPublicRooms}
            className="lobby-ghost-btn flex h-11 w-full items-center gap-2 px-2.5 text-left"
          >
            <span aria-hidden className="lobby-seal is-small">
              🏠
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate">
                <Trans>公开房</Trans>
              </b>
              <em className="block truncate">
                <Trans>看别人开的房，加入或观战</Trans>
              </em>
            </span>
            <span aria-hidden className="lobby-note">
              <Trans>看列表 ›</Trans>
            </span>
          </button>
        )}

        {/* 建房时的一个选项（原来在卡与主键之间；B 的左列太满，挪到右列底部，仍是「下一个动作」） */}
        {showPublicToggle && (
          <label className="lobby-ghost-btn flex h-11 w-full cursor-pointer items-center gap-2 px-2.5">
            <input type="checkbox" checked={publicRoomOn} onChange={onTogglePublic} className="h-4 w-4 accent-[#d8b26a]" />
            <span className="min-w-0 flex-1 text-[11px] leading-tight">
              <Trans>公开这间房（别人能搜到）</Trans>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
