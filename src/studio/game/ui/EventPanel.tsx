// 事件屏（G3，§2.3b）：第 2/4/6 回合结算之后的三选一。
//
// ★ 选项**不是固定的三条**：模型军备的 L2 / L3 两条升级线按档位与连胜只出现一条（rules.optionsForPlayer），
//   所以这里画的是 rules.eventOptionsFor 给的那份（界面上看到几条就是几条）。
// ★ 钱够不够不藏选项（点一下会有原因说差多少）；真扣钱在 rules.applyEventChoice。
// ★ 「跳过」是规则给的出口（rules.skipEventChoice 的 ★★）：满背包 + 没钱时三选一可能一个都落不了账，
//   没有这个出口这一局会永远停在事件阶段。
import { Trans, useLingui } from "@lingui/react/macro";
import { eventName, eventOptionText, playerName } from "../labels";
import { EVENT_SKIP_PICK } from "../rules";
import { useGame } from "../store";
import { eventViewOf } from "../view";
import GameBtn from "./GameBtn";

export default function EventPanel() {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const report = useGame((s) => s.report);
  if (!state) return null;
  const eventView = eventViewOf(state, meId);
  if (!eventView) {
    return (
      <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">
        <Trans>这一期没有抽到事件——等下一回合。</Trans>
      </div>
    );
  }
  const title = eventName(eventView.event.id);
  const picked = eventView.picked;
  // ★ "跳过"要单独翻：写在 JS 表达式里的中文 Lingui 抽不到（英文界面上会原样蹦中文，2026-11-23 实机验过）。
  const pickedLabel =
    picked === null
      ? null
      : picked === EVENT_SKIP_PICK
        ? t`跳过`
        : eventOptionText(eventView.options.find((option) => option.id === picked) ?? { id: picked, cost: 0, effects: [] });
  // 上一期的结算就压在事件屏上：事件是"结算之后、下一回合之前"出现的（§2.3b），
  // 玩家在这个屏上必须先看见自己扣了多少、谁被打出局了 —— 否则淘汰提示只闪一下结算屏就没了。
  const mineDamage = report?.summary.damages.find((damage) => damage.playerId === meId) ?? null;
  const eliminatedNames = report?.summary.eliminated.map((id) => playerName(id)).join(" / ") ?? "";

  return (
    <div className="pointer-events-auto w-full max-w-[48rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      <div className="mb-1 flex items-baseline gap-2 text-[10px]">
        <span className="font-semibold text-slate-100">
          <Trans>事件 · {title}</Trans>
        </span>
        <span className="text-slate-400">
          <Trans>三选一（拿不准可以跳过）</Trans>
        </span>
        <span className="ml-auto text-gold-200">
          <Trans>我有 {eventView.gold} 金</Trans>
        </span>
      </div>
      <div className="flex items-stretch gap-1.5">
        {eventView.options.map((option) => {
          const affordable = option.cost <= eventView.gold;
          return (
            <button
              key={option.id}
              type="button"
              // 不设 disabled：钱不够点了要说原因（差多少金），灰着点不动在手机上等于没反应。
              onClick={() => useGame.getState().chooseEvent(option.id)}
              aria-label={t`选事件选项：${eventOptionText(option)}`}
              className="flex-1 rounded-lg bg-white/[0.05] p-1.5 text-left ring-1 ring-white/10 active:bg-white/[0.1]"
            >
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[11px] font-semibold ${affordable ? "text-gold-200" : "text-danger-300"}`}>
                  {option.cost === 0 ? <Trans>免费</Trans> : <Trans>{option.cost} 金</Trans>}
                </span>
                {option.cost > 0 && !affordable && (
                  <span className="text-[9px] text-danger-300">
                    <Trans>（钱不够，会说明差多少）</Trans>
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-slate-200">{eventOptionText(option)}</div>
            </button>
          );
        })}
        {eventView.options.length === 0 && (
          <div className="flex-1 rounded-lg border border-dashed border-white/15 p-2 text-[10px] text-slate-400">
            <Trans>这一期你没有可选的选项（选过了，或者三选一都落不了账）。</Trans>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {picked ? (
          <span className="text-[10px] text-ok-300">
            <Trans>选好了：{pickedLabel}</Trans>
          </span>
        ) : (
          <span className="text-[10px] text-slate-500">
            <Trans>选完自动进回合结算</Trans>
          </span>
        )}
        {/* 上一期结算的一句话（扣血 / 淘汰）：见上面 mineDamage 那段注释 */}
        {mineDamage && (
          <span className="text-[10px] text-slate-400">
            <Trans>
              上期：你第 {mineDamage.rank} 名，−{mineDamage.damage} 血，剩 {mineDamage.hpAfter}
            </Trans>
          </span>
        )}
        {eliminatedNames && (
          <span className="rounded bg-danger/25 px-1.5 text-[10px] font-semibold text-danger-100 ring-1 ring-danger/50">
            <Trans>⚠ 淘汰：{eliminatedNames}</Trans>
          </span>
        )}
        <GameBtn onClick={() => useGame.getState().skipEvent()} className="ml-auto" disabled={Boolean(picked)}>
          <Trans>这次不要（跳过）</Trans>
        </GameBtn>
      </div>
    </div>
  );
}
