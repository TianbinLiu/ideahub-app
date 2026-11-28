// 对局顶栏（A 案「克制极简」）+ 黄铜圆表（B 案）。
//
// 2026-11-28（feat/ui-game-hud-a）：主人拍板「A 的骨架 + B 的圆表 + C 的缝线卡位」。这一份是前两样。
//
// ★ 为什么这一条几乎没有底色：对局下面已经是两层（3D 桌面 + 相机），UI 再糊一块不透明板子
//   就把桌子盖住了。A 案的纪律是"只有字号、留白与 1px 铜线"——所以这里没有面板、没有投影、
//   没有图标底，只有三档：主数字（金币 21px / 回合 16px）、卡名（阶段 11.5px 衬线）、
//   标签（6.5~7px、字距 0.26em）。**不设第三档字号**（设计稿 `?v=a&s=table` 的原话）。
// ★ 信息分两处，各只承担一件事：
//   · 顶栏（A）：阶段 / 回合 / 计时 + 金币（21px 主数字 + 利息预告那一行小字）；
//   · 圆表（B）：**生命值**一个数 —— conic 弧 + 12 道刻线 + 压印牌面。
//     B 案的口径是"每块铜牌只承担一个数"；A 案顶栏右组原来的「生命 78 + 一条血条」整条撤掉，
//     因为同一个数摆两处，一处是仪表、另一处就只是重复（而且血条与圆表抢同一档亮度）。
//     ★ 规则层本来就有血量（rules.START_HP / settleRound 夹在 0~100），所以按主人给的第二选
//       "（或血量，若现有规则里没有血量…）"直接取血量，不必编"本阶段投入卡数"那种假指标。
// ★ 一个数都不在这里算：回合 / 金币 / 血量 / 利息全部来自 view.hud（view.ts 去问 rules）。
//   利息那条小字读的就是 rules.incomeFor（利息 10 金一档、上限 5，已经是线上规则）——
//   这一轮只做展示，不改结算。
// ★ 位置：`--game-hud-top` = 安全区 + 48：上面那一排 44×44 圆键（✕ 结束对局 / ? / ⚙ / 🧩）
//   让出来的高度。左边让开左上角的玩家面板（`--game-hud-left`，它展开时也在那一列里）。
//   `pointer-events-none`：HUD 是读数，不许挡桌面上的卡。
import { useLingui } from "@lingui/react/macro";
import { phaseName } from "../labels";
import { MAX_ROUNDS, START_HP } from "../rules";
import type { HudModel, GameView } from "../view";
import PhaseClock from "./PhaseClock";

/** 一格里的小标签（6.5px + 0.26em 字距）——设计稿 A 案 `.a-stat em` 的那一档 */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <em className="text-[6.5px] not-italic leading-none tracking-[0.26em] text-[#a08a66]">{children}</em>
  );
}

/**
 * 回合：主数字 + 8 道刻线（不是胶囊）。
 * ★ 8 段 = MAX_ROUNDS；联机局的回合数可能超过 8（服务端回合引擎没有上限），所以 8 道刻线只画
 *   前 8 段：超出的回合把 8 段全点亮、aria 的 max 跟着真实回合数走（与 G2 那版 HUD 同一条规矩）。
 */
function RoundTicks({ round }: { round: number }) {
  const { t } = useLingui();
  const shownRound = Math.min(MAX_ROUNDS, round);
  const maxRound = Math.max(MAX_ROUNDS, round);
  return (
    <span data-game-rounds className="flex flex-col gap-[3px] leading-none">
      <Eyebrow>{t`回合`}</Eyebrow>
      <span className="flex items-center gap-2">
        <b className="game-num text-[16px] font-semibold leading-none text-[#f7ecd8]">
          {round}
          <small className="ml-0.5 text-[8px] font-normal tracking-[0.06em] text-[#a08a66]">/ {maxRound}</small>
        </b>
        <span
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={maxRound}
          aria-valuenow={round}
          aria-label={t`对局进度`}
          className="flex items-center gap-[3px]"
        >
          {Array.from({ length: MAX_ROUNDS }, (_, i) => {
            const passed = i + 1 < shownRound;
            const current = i + 1 === shownRound;
            return (
              <span
                key={i}
                className={`h-[2px] w-[9px] ${current ? "bg-[#f7e3ae]" : passed ? "bg-[#d8b26a]/50" : "bg-[#d8b26a]/25"}`}
                style={current ? { boxShadow: "0 0 6px rgb(247 227 174 / 0.8)" } : undefined}
              />
            );
          })}
        </span>
      </span>
    </span>
  );
}

export default function GameHud({ view, center }: { view: GameView; center?: React.ReactNode }) {
  const { t } = useLingui();
  const hud: HudModel = view.hud;
  // 血条宽度按 rules.START_HP 归一；血量在规则层已被夹在 0~100（settleRound），这里只防越界
  const hpPct = Math.max(0, Math.min(100, (hud.hp / START_HP) * 100));
  const round = Math.max(1, hud.round);
  const income = hud.income;

  return (
    <div
      data-game-hud
      className="pointer-events-none absolute inset-x-0 z-10 flex items-start justify-between gap-2 pl-[var(--game-hud-left)] pr-[4.2rem]"
      style={{ top: "var(--game-hud-top)", textShadow: "0 1px 3px rgb(0 0 0 / 0.8)" }}
    >
      {/* ── 左：圆表（B） + 阶段 / 回合 / 计时（A） ── */}
      <div className="flex items-start gap-2.5">
        <div
          data-game-dial
          role="img"
          aria-label={t`生命值 ${hud.hp}`}
          className="game-dial"
          style={{ ["--p" as string]: `${hpPct}%` }}
        >
          <span aria-hidden className="game-dial-ring" />
          <span aria-hidden className="game-dial-ticks" />
          <span className="game-dial-face">
            <b>{hud.hp}</b>
            <em>{t`生命`}</em>
          </span>
        </div>

        <div className="flex items-start gap-3.5 pt-1">
          {/* 阶段：衬线 + 一颗亮着的小点 + 一条 1px 铜线（A 案 `.a-phase`） */}
          <span
            className="lobby-serif flex items-center gap-1 pb-[3px] text-[11.5px] leading-none tracking-[0.16em] text-[#f0e2c6]"
            style={{ borderBottom: "1px solid rgb(216 178 106 / 0.36)" }}
          >
            <i
              aria-hidden
              className="inline-block h-1 w-1 rounded-full bg-[#f7e3ae]"
              style={{ boxShadow: "0 0 6px rgb(247 227 174 / 0.85)" }}
            />
            {phaseName(view.phase)}
          </span>

          <RoundTicks round={round} />

          {/* 计时：本地"这一段已进行多久"（不是倒计时，见 ui/PhaseClock 的文件头） */}
          <span data-game-clockbox className="flex flex-col gap-[3px] leading-none">
            <Eyebrow>{t`计时`}</Eyebrow>
            <PhaseClock round={hud.round} phase={view.phase} timeOnly />
          </span>
        </div>
      </div>

      {/* ── 中：对手条（GameLayer 传进来；A 案顶栏中间那一格本来就是空的） ── */}
      <div className="flex min-w-0 flex-1 items-start justify-end pt-1.5 pr-1">{center}</div>

      {/* ── 右：金币（21px 主数字）+ 利息预告（下一行小字） ── */}
      <div data-game-gold className="flex flex-col items-end gap-[2px] leading-none">
        <Eyebrow>{t`金币`}</Eyebrow>
        <b className="game-num text-[21px] font-semibold leading-none text-[#f7e3ae]">{hud.gold}</b>
        <span className="text-[7px] leading-none tracking-[0.08em] text-[#a08a66]">
          {t`利息 +${income.interest} · 下回合 +${income.total}`}
        </span>
      </div>
    </div>
  );
}
