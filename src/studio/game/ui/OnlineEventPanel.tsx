/**
 * 事件屏 · 联机版（2026-11-23 服务端出题，G5 联机第三块）：题面**全部来自服务端**那一份。
 *
 * ★★ 为什么要与单机那份（ui/EventPanel）分开：两边的**数据来源与落地路径完全不同** ——
 *   单机读 `rules.GAME_EVENTS`（view.eventViewOf），扣钱与效果都在本地 `rules.applyEventChoice`；
 *   联机读 `GET rounds/events`（同一房间同一回合同一道题，`eventId` 一致），选择写
 *   `POST rounds/events/choice`（幂等、第一选作数），而 **hp 是服务端落库的那一半** ——
 *   App 只落 `effects.client`（金币 / 档位 / 道具上限 / 免费刷新 / 随机卡），
 *   新血量从房间快照 `members[].hp` 读回来，**不再应用一次**（不然回 15 变回 30）。
 *   塞进同一个组件，第一次改事件就会有一边改不到（同一屏两个真相是铁律六的经典形状）。
 *   ★ 卡本身那张皮是共用的（ui/EventCard）：单机与联机长得一模一样，改版只改一处。
 * ★ 三步的落点（点卡 → 确认）：
 *   ① 点卡只改本地选中态（误触一张 6 金的卡就当场扣钱，代价比多按一下大）；
 *   ② 确认 → `roundsStore.chooseEvent`（POST 服务端）；
 *   ③ POST 成功之后 → `store.chooseOnlineEvent`（扣金币 + 只应用 `effects.client`）
 *      → `roundsStore.refreshRoom()` 把服务端记的新 hp 读回来（HUD 那个 ❤ 是服务端那一份）。
 *   ★ ②③ 的顺序不能反：先落本地效果再 POST，POST 失败时本机扣了钱、服务端没记，钱就对不上了。
 * ★ 服务端已经记过我这一选（`myChoice` 非空，例如中途刷新回来）：只补一个本机表态、**不重放效果**
 *   （见 store.markOnlineEventChosen 的 ★）—— 本机那份效果本来就随刷新一起丢了。
 * ★ `allChosen` 只念一句、**绝不拿来拦「下一回合」**：服务端刻意不拦（效果在 App 本地落，卡在这
 *   对整桌没有好处）。回包里只有布尔、没有人数，所以这里说的是「全员都选好了 / 还有人没选」，
 *   不是 `x/y`（要 x/y 得让服务端多发两个数，本轮不改契约）。
 * ★ 被淘汰的人服务端回 `PLAYER_ELIMINATED`（读不到题）—— 那条路在 roundsStore 里落成 `none`，
 *   本机照常停结算屏，不会进这一屏。
 */
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { modelUpgradeGate } from "../genTier";
import { eventName, eventOptionName, eventOptionText, eventServerText } from "../labels";
import { onlineChoiceOf, onlineOptionsFor, onlineServerHpOf } from "../onlineHost";
import { EVENT_SKIP_PICK } from "../rules";
import { useRounds } from "../roundsStore";
import { useGame } from "../store";
import type { GameEventOption } from "../types";
import type { RemoteEventOption } from "../../../api/game/rounds";
import EventCard from "./EventCard";

/**
 * 服务端选项 → 卡面 / 收益那句要的形状。
 * ★ `art` 按 id 拼的是同一个文件（`public/events/<id>.webp`）：服务端下发的选项 id 与 rules 的
 *   事件表逐字一致（跨仓同一份数据），所以插画 / 字形 / 卡名都能复用本机那份。
 * ★ `effects` 只放 `client` 那一半：这一份会进 `eventOptionText`（念收益）与
 *   `rules.applyOnlineEventChoice`（真落地）—— hp 绝不能混进来。
 */
function faceOf(option: RemoteEventOption): GameEventOption {
  return { id: option.id, cost: option.cost, effects: option.effects.client, art: `public/events/${option.id}.webp` };
}

/**
 * 卡名：先问本机目录（按 id 认，随界面语言翻），认不出才用服务端下发的中文卡名。
 * ★ 服务端下发的是中文（`label`，给老 App / 认不出的 id 兜底）：英文界面上如果优先用它，
 *   屏幕上就会出现中文卡名（`check-i18n` 拦不住的那类回退）。
 */
function nameOf(option: RemoteEventOption): string {
  const local = eventOptionName(faceOf(option));
  return local === option.id ? (option.label ?? option.id) : local;
}

/** 一行收益：`effects.client` 那句 + 服务端落库的那一半（今天只有回血）。 */
function textOf(option: RemoteEventOption): string {
  const parts = [eventOptionText(faceOf(option))];
  const hp = onlineServerHpOf(option);
  if (hp > 0) parts.push(eventServerText(hp));
  return parts.filter((part) => part.length > 0).join("；");
}

export default function OnlineEventPanel() {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const busy = useRounds((s) => s.busy);
  const event = useRounds((s) => s.event);
  // ★ 选中态住在这里（点卡 → 确认才发请求，见文件头）。hook 必须排在早退之前（check-hook-order）。
  const [selected, setSelected] = useState<string | null>(null);

  if (!state || !event) {
    return (
      <div className="pointer-events-auto rounded-xl bg-panel/90 px-3 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">
        <Trans>正在读取服务端的事件…</Trans>
      </div>
    );
  }
  const me = state.players.find((player) => player.id === meId);
  if (!me) return null;
  const gold = me.gold;
  // ★ 服务端给的是**全量**选项（它不知道本机的套餐档位与连胜）：升级线在本地筛，
  //   判据仍然是 rules.optionAvailable（`onlineOptionsFor` 的唯一实现）。
  const options = onlineOptionsFor(me, event.options, modelUpgradeGate());
  const picked = event.myChoice;
  const pickedLabel =
    picked === null
      ? null
      : picked === EVENT_SKIP_PICK
        ? t`跳过`
        : (() => {
            const found = event.options.find((option) => option.id === picked);
            return found ? nameOf(found) : picked;
          })();
  const chosen = options.find((option) => option.id === selected) ?? null;
  /** 事件名：同上，先问本机目录（认不出才用服务端 title）。 */
  const localTitle = eventName(event.eventId);
  const title = localTitle === event.eventId ? (event.title ?? event.eventId) : localTitle;

  /**
   * 底部左边那一句：把"这一下按下去会发生什么"说清楚。
   * ★ 这不是失败原因 —— 真被拒的理由仍然只有 GameLayer 那条状态栏说（铁律六：失败的话只在一处说），
   *   这里只是按确认**之前**的账。
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

  /**
   * 确认：**先**写服务端，**再**落本地。
   * ★ POST 失败（网络 / 已翻篇）时本地一分钱都不扣 —— 界面照旧停在这一屏，原因在底栏。
   * ★ 本地落的是 `onlineChoiceOf(option)`：只含 `client` 效果 + 花费；hp 由服务端在这一次
   *   原子更新里落库，界面随后读房间快照（`refreshRoom`）拿到新血量。
   */
  const confirm = async () => {
    if (!chosen) return;
    const ok = await useRounds.getState().chooseEvent(chosen.id);
    if (!ok) return;
    useGame.getState().chooseOnlineEvent(onlineChoiceOf(chosen));
    void useRounds.getState().refreshRoom();
  };

  /** 跳过 = 一个表态（服务端也认 "skip"）：本地什么都不改，只记下这个选择并收屏。 */
  const skip = async () => {
    const ok = await useRounds.getState().chooseEvent(EVENT_SKIP_PICK);
    if (!ok) return;
    useGame.getState().chooseOnlineEvent({ optionId: EVENT_SKIP_PICK, cost: 0, clientEffects: [] });
  };

  return (
    <div className="pointer-events-auto relative w-full max-w-[52rem] overflow-hidden rounded-2xl bg-panel/95 p-1.5 ring-1 ring-white/10 backdrop-blur">
      {/* 顶上那道发光线：与单机那份同一块面板的观感 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent" />

      {/* ── 标题行：事件名 + 这是服务端出的题 + 两个数（HUD 在事件阶段让位）── */}
      <div className="flex items-center gap-2 px-1">
        <span className="flex-none text-[clamp(0.72rem,1.75vw,0.88rem)] font-semibold text-slate-100">
          <Trans>事件 · {title}</Trans>
        </span>
        <span className="flex-none rounded bg-white/[0.07] px-1.5 text-[clamp(0.52rem,1.3vw,0.64rem)] text-slate-300">
          <Trans>第 {event.round} 回合</Trans>
        </span>
        <span className="min-w-0 flex-1 truncate text-[clamp(0.55rem,1.35vw,0.66rem)] text-slate-400">
          {event.allChosen ? (
            <Trans>服务端出题（同一道题）· 全员都选好了</Trans>
          ) : (
            <Trans>服务端出题（同一道题）· 还有人没选，不挡下一回合</Trans>
          )}
        </span>
        <span className="flex flex-none items-center gap-2 text-[clamp(0.62rem,1.55vw,0.76rem)] font-semibold">
          <span className="text-danger-200" title={t`你现在的血量（服务端给的数）`}>
            ❤ {me.hp}
          </span>
          <span className="text-gold-200" title={t`你现在有多少金`}>
            🪙 {gold}
          </span>
        </span>
      </div>

      {/* ── 卡：与单机那份同一张皮（ui/EventCard），横排同一宽度 ── */}
      <div className="mt-1.5 flex items-stretch justify-center gap-[clamp(0.35rem,1.1vw,0.7rem)]">
        {options.map((option) => (
          <EventCard
            key={option.id}
            option={faceOf(option)}
            name={nameOf(option)}
            text={textOf(option)}
            gold={gold}
            active={selected === option.id}
            ariaLabel={t`选事件选项：${nameOf(option)}`}
            onSelect={() => setSelected(option.id)}
          />
        ))}
        {options.length === 0 && (
          <div className="flex min-h-[clamp(6rem,26vh,9rem)] w-full items-center justify-center rounded-xl border border-dashed border-white/15 px-3 text-center text-[clamp(0.58rem,1.4vw,0.7rem)] text-slate-400">
            <Trans>这一期你没有可选的选项（选过了，或者档位不够）。</Trans>
          </div>
        )}
      </div>

      {/* ── 底部：确认键正中（grid 三格），跳过排在它右边 ── */}
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1">
        <span className="min-w-0 truncate text-[clamp(0.55rem,1.35vw,0.66rem)] text-slate-400">{footerHint}</span>
        <button
          type="button"
          onClick={() => void confirm()}
          // 没选 / 服务端已经记过我这一选 / 另一个动作在飞：按不动（点不动的理由写在左边那句里）
          disabled={!chosen || Boolean(picked) || busy}
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
            onClick={() => void skip()}
            disabled={Boolean(picked) || busy}
            className="rounded-full px-2.5 py-1.5 text-[clamp(0.55rem,1.35vw,0.66rem)] text-slate-400 ring-1 ring-white/10 active:bg-white/10 disabled:opacity-40"
          >
            <Trans>这次不要（跳过）</Trans>
          </button>
        </span>
      </div>
    </div>
  );
}
