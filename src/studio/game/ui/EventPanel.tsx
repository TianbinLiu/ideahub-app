// 事件屏（G3，§2.3b）：第 2/4/6 回合结算之后的三选一；G4 §5 按参照图重排（docs/g4-ui-revamp-spec.md §5）。
//
// ★ 参照图上的四件事，逐条落在这一屏：
//   ① **一整块面板**（不是三颗并排的按钮）—— 标题行 / 三张卡 / 底部确认各占一行；
//   ② 每张卡三层：**图标位（发光六边形 + 徽记）+ 标题 + 一行收益 + 花费**；
//   ③ **选中态明显**：金描边 + 右上角那颗勾（参照图靠描边 + 角标认选中）；
//   ④ 确认键在**面板底部正中**（跳过排在它右边，见下面 ★ 跳过）。
// ★ 「免费/跳过那一项」跟另外两张**同一排版**：免费项是 rules 数据里 cost 0 的那一条
//   （每个事件恰好一条），它照样是一张完整的卡 —— 只是在花费那一行写「免费」。
//   旧版三颗选项都是半行字大小的方块、跳过是一颗光秃秃的小键；施工单说的"缩成一行小字"就是那个样子。
// ★ 选项**不是固定的三条**：模型军备的 L2 / L3 两条升级线按档位与连胜只出现一条（rules.optionsForPlayer），
//   免费账号一条都没有（ModelGate，见 docs/g2-game-ui.md「免费账号的升级线只到 L1」）——
//   所以这里画的是 rules.eventOptionsFor 给的那份：2 条时两张卡按同一个宽度居中（行是 justify-center，
//   卡宽是 clamp），不会一张挤成窄条、也不会留一块歪着的空。
// ★ 点卡与扣钱**分两步**：点卡只改本地选中态，真扣钱在底部那颗「确认」（store.chooseEvent →
//   rules.applyEventChoice）。理由两条：参照图就是"先挑一张再确认"；而误触一张 6 金的卡就当场扣钱，
//   代价比多按一下大（同 StylePick「先点一张风格卡，再锁定」）。
// ★ 钱够不够不藏选项（点一下会有原因说差多少）；真扣钱在 rules.applyEventChoice。
// ★ 「跳过」是规则给的出口（rules.skipEventChoice 的 ★★）：满背包 + 没钱时三选一可能一个都落不了账，
//   没有这个出口这一局会永远停在事件阶段。它仍是一颗**真键**（不是一行小字），只是排在确认键右边 ——
//   确认键必须正中（施工单 §5），所以底部那一行是 grid 三格：左边念选中后的金数、中间确认、右边跳过。
// ★ 尺寸：横屏真机 800×363 是底（docs/g2-game-ui.md 末尾那条"面板别按视口算宽"的坑），
//   卡宽 / 卡高 / 字号全部 clamp，一个 px 都不写死。800 宽时实测：卡宽 29vw=232、三张 + 两道缝 716，
//   面板 776 里居中；卡高 44vh≈160（min-h，内容多时自己长高）；确认键 93×35。
// ★ 这一屏占满舞台的下半截：HUD / 对手条 / 右侧道具栏 / 背包条在事件阶段**让位**（见 ui/GameLayer）——
//   800×363 上"背包条 + 阶段条 + 三张卡"叠起来只有 ~115px 给卡，图标和收益都挤没了。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { eventName, eventOptionGlyph, eventOptionName, eventOptionText, playerName } from "../labels";
import { EVENT_SKIP_PICK } from "../rules";
import { useGame } from "../store";
import { eventViewOf } from "../view";
import type { GameView } from "../view";

/**
 * 图标位那个六边形：clip-path 一刀切出正六边形（参照图每张卡正中就是它）。
 * ★ 用 clip-path 而不是图：一个形状 3 个 span 就够，不给安装包加字节；外层是"描边"（稍大一圈的渐变），
 *   内层向内缩 2px 换成暗底 —— clip-path 会把 box-shadow / ring 一起裁掉，所以描边只能靠叠出来。
 */
const HEX = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

export default function EventPanel({ view }: { view: GameView }) {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const report = useGame((s) => s.report);
  // ★ 选中态住在这里（点卡 → 确认才扣钱，见文件头）。hook 必须排在下面两个早退之前（check-hook-order）。
  const [selected, setSelected] = useState<string | null>(null);
  if (!state) return null;
  const eventView = eventViewOf(state, meId);
  if (!eventView) {
    return (
      <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[clamp(0.6rem,1.4vw,0.7rem)] text-slate-300 ring-1 ring-white/10">
        <Trans>这一期没有抽到事件——等下一回合。</Trans>
      </div>
    );
  }
  const title = eventName(eventView.event.id);
  const picked = eventView.picked;
  // 选过之后只念一句"选好了：X"。X 先按卡名认（event 的**全量**选项里找，选过的那条已经不在
  // eventView.options 里了），认不出再回收益那句。
  const pickedOption = picked === null ? null : (eventView.event.options.find((option) => option.id === picked) ?? null);
  // ★ "跳过"要单独翻：写在 JS 表达式里的中文 Lingui 抽不到（英文界面上会原样蹦中文，2026-11-23 实机验过）。
  const pickedLabel =
    picked === null
      ? null
      : picked === EVENT_SKIP_PICK
        ? t`跳过`
        : pickedOption
          ? eventOptionName(pickedOption)
          : eventOptionText({ id: picked, cost: 0, effects: [] });
  // 上一期的结算就压在事件屏上：事件是"结算之后、下一回合之前"出现的（§2.3b），
  // 玩家在这个屏上必须先看见自己扣了多少、谁被打出局了 —— 否则淘汰提示只闪一下结算屏就没了。
  const mineDamage = report?.summary.damages.find((damage) => damage.playerId === meId) ?? null;
  const eliminatedNames = report?.summary.eliminated.map((id) => playerName(id)).join(" / ") ?? "";
  /** 现在选中的那张（null = 还没挑）与它要花多少金 / 确认之后剩多少 */
  const chosen = eventView.options.find((option) => option.id === selected) ?? null;
  const gold = eventView.gold;
  /**
   * 底部左边那一句：把"这一下按下去会发生什么"说清楚（选中之后才说金数，没选就只说下一步）。
   * ★ 这句不是失败原因 —— 真被拒（钱不够 / 选项不可用）的理由仍然只有 GameLayer 那条状态栏说
   *   （铁律六：失败的话只在一处说），这里只是按确认**之前**的账。
   */
  const footerHint = picked
    ? t`选好了：${pickedLabel}`
    : chosen === null
      ? t`先点一张卡，再按确认`
      : chosen.cost === 0
        ? t`这张不要金`
        : chosen.cost <= gold
          ? t`确认后剩 ${gold - chosen.cost} 金`
          : t`还差 ${chosen.cost - gold} 金`;

  return (
    <div className="pointer-events-auto relative w-full max-w-[52rem] overflow-hidden rounded-2xl bg-panel/95 p-1.5 ring-1 ring-white/10 backdrop-blur">
      {/* 顶上那道发光线：参照图的面板是"一整块亮边"，实心描边太重，一道渐变细线就够 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent" />

      {/* ── 标题行：事件名 + 一句说明 + 这一屏要用的两个数（HUD 在事件阶段让位，数从同一份 view 来）── */}
      <div className="flex items-center gap-2 px-1">
        <span className="flex-none text-[clamp(0.72rem,1.75vw,0.88rem)] font-semibold text-slate-100">
          <Trans>事件 · {title}</Trans>
        </span>
        {/* 第几回合：HUD 在事件阶段让位（见 ui/GameLayer），这一句把它带回来 */}
        <span className="flex-none rounded bg-white/[0.07] px-1.5 text-[clamp(0.52rem,1.3vw,0.64rem)] text-slate-300">
          <Trans>第 {view.hud.round} 回合</Trans>
        </span>
        <span className="min-w-0 flex-1 truncate text-[clamp(0.55rem,1.35vw,0.66rem)] text-slate-400">
          <Trans>三选一（拿不准可以跳过）</Trans>
        </span>
        <span className="flex flex-none items-center gap-2 text-[clamp(0.62rem,1.55vw,0.76rem)] font-semibold">
          <span className="text-danger-200" title={t`你现在的血量`}>
            ❤ {view.hud.hp}
          </span>
          <span className="text-gold-200" title={t`你现在有多少金`}>
            🪙 {gold}
          </span>
        </span>
      </div>

      {/* 上一期结算的一句话（扣血 / 淘汰）：见上面 mineDamage 那段注释 */}
      {(mineDamage || eliminatedNames) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[clamp(0.52rem,1.3vw,0.64rem)]">
          {mineDamage && (
            <span className="text-slate-400">
              <Trans>
                上期：你第 {mineDamage.rank} 名，−{mineDamage.damage} 血，剩 {mineDamage.hpAfter}
              </Trans>
            </span>
          )}
          {eliminatedNames && (
            <span className="rounded bg-danger/25 px-1.5 font-semibold text-danger-100 ring-1 ring-danger/50">
              <Trans>⚠ 淘汰：{eliminatedNames}</Trans>
            </span>
          )}
        </div>
      )}

      {/* ── 卡：横排、同一宽度、同一高度（行 items-stretch，花费那行 mt-auto 钉在底部对齐）── */}
      <div className="mt-1.5 flex items-stretch justify-center gap-[clamp(0.35rem,1.1vw,0.7rem)]">
        {eventView.options.map((option) => {
          const active = selected === option.id;
          const affordable = option.cost <= gold;
          return (
            <button
              key={option.id}
              type="button"
              // 不设 disabled：钱不够点了要说原因（差多少金），灰着点不动在手机上等于没反应。
              onClick={() => setSelected(option.id)}
              aria-pressed={active}
              aria-label={t`选事件选项：${eventOptionName(option)}`}
              className={`relative flex min-h-[clamp(7.5rem,44vh,12rem)] w-[clamp(9.5rem,29vw,15rem)] flex-none flex-col items-center overflow-hidden rounded-xl px-2 pb-1.5 pt-1.5 text-center ring-1 transition-colors ${
                active ? "bg-gold/[0.08] ring-2 ring-gold-300" : "bg-white/[0.04] ring-white/10 active:bg-white/[0.09]"
              }`}
            >
              {/* 选中角标：参照图靠左上/右上那颗徽记认选中，这里就在右上角打一个勾 */}
              {active && (
                <span
                  aria-hidden
                  className="absolute right-1 top-1 flex h-[clamp(0.9rem,2.1vw,1.1rem)] w-[clamp(0.9rem,2.1vw,1.1rem)] items-center justify-center rounded-full bg-gold-400 text-[clamp(0.5rem,1.2vw,0.62rem)] font-bold leading-none text-ink"
                >
                  ✓
                </span>
              )}
              {/* 图标 / 插画位：上面这一块是卡面（参照图每张卡上 2/3 是那张发光六边形），
                  底下垫一层径向柔光 —— 纯底色在深面板上看起来是一块死黑，加了光才像"图"。 */}
              <span
                className="relative flex w-full flex-1 items-center justify-center"
                style={{
                  background: active
                    ? "radial-gradient(60% 62% at 50% 46%, rgba(251,191,36,0.20), transparent 72%)"
                    : "radial-gradient(60% 62% at 50% 46%, rgba(56,189,248,0.16), transparent 72%)",
                }}
              >
                <span className="relative flex h-[clamp(2.6rem,6.2vw,3.5rem)] w-[clamp(2.6rem,6.2vw,3.5rem)] items-center justify-center">
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      clipPath: HEX,
                      background: active
                        ? "linear-gradient(160deg,#fde68a,#38bdf8)"
                        : "linear-gradient(160deg,#7dd3fc,#fcd34d)",
                    }}
                  />
                  <span
                    aria-hidden
                    className="absolute inset-[2px]"
                    style={{ clipPath: HEX, background: "linear-gradient(160deg,#16223c,#0b1020)" }}
                  />
                  <span aria-hidden className="relative text-[clamp(0.95rem,2.4vw,1.3rem)] leading-none">
                    {eventOptionGlyph(option)}
                  </span>
                </span>
              </span>
              {/* 文字块钉在卡的下半截（mt-auto）：三张卡的收益有长有短，花费那一行仍然对齐 */}
              <span className="mt-auto flex w-full flex-col items-center gap-0.5">
                {/* 标题（规则层只有 id 与 effects，名字在 labels.eventOptionName）*/}
                <span className="text-[clamp(0.66rem,1.6vw,0.8rem)] font-semibold leading-tight text-slate-100">
                  {eventOptionName(option)}
                </span>
                {/* 一行收益（effects 念成句子，见 labels.eventOptionText）*/}
                <span className="line-clamp-2 text-[clamp(0.55rem,1.35vw,0.66rem)] leading-[1.35] text-slate-400">
                  {eventOptionText(option)}
                </span>
                {/* 花费：**免费那一档也占同一行**（施工单 §5「跟另外两张同样排版」）；钱不够时标红说差多少 */}
                <span
                  className={`mt-0.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[clamp(0.58rem,1.4vw,0.7rem)] font-semibold ring-1 ${
                    option.cost === 0
                      ? "bg-ok/15 text-ok-200 ring-ok/30"
                      : affordable
                        ? "bg-gold/15 text-gold-200 ring-gold/30"
                        : "bg-danger/20 text-danger-200 ring-danger/40"
                  }`}
                >
                  {option.cost === 0 ? (
                    <Trans>免费</Trans>
                  ) : (
                    <>
                      <span aria-hidden className="opacity-80">
                        🪙
                      </span>
                      <Trans>{option.cost} 金</Trans>
                    </>
                  )}
                </span>
              </span>
            </button>
          );
        })}
        {eventView.options.length === 0 && (
          <div className="flex min-h-[clamp(6rem,26vh,9rem)] w-full items-center justify-center rounded-xl border border-dashed border-white/15 px-3 text-center text-[clamp(0.58rem,1.4vw,0.7rem)] text-slate-400">
            <Trans>这一期你没有可选的选项（选过了，或者三选一都落不了账）。</Trans>
          </div>
        )}
      </div>

      {/* ── 底部：确认键**正中**（grid 三格 —— 左右两格等宽，中间那颗才真的居中）── */}
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1">
        <span className="min-w-0 truncate text-[clamp(0.55rem,1.35vw,0.66rem)] text-slate-400">{footerHint}</span>
        <button
          type="button"
          onClick={() => chosen && useGame.getState().chooseEvent(chosen.id)}
          // 没选就是按不动（点不动的理由写在左边那句里 —— 手机上 title 看不见）
          disabled={!chosen}
          className="flex items-center gap-1 rounded-full bg-brand px-7 py-2 text-[clamp(0.66rem,1.55vw,0.78rem)] font-semibold text-ink transition-colors active:bg-brand-300 disabled:bg-white/10 disabled:text-slate-400 disabled:active:bg-white/10"
        >
          <span aria-hidden className="text-[0.9em] font-bold">
            ✓
          </span>
          <Trans>确认</Trans>
        </button>
        <span className="flex justify-end">
          <button
            type="button"
            onClick={() => useGame.getState().skipEvent()}
            disabled={Boolean(picked)}
            className="rounded-full px-2.5 py-1.5 text-[clamp(0.55rem,1.35vw,0.66rem)] text-slate-400 ring-1 ring-white/10 active:bg-white/10 disabled:opacity-40"
          >
            <Trans>这次不要（跳过）</Trans>
          </button>
        </span>
      </div>
    </div>
  );
}
