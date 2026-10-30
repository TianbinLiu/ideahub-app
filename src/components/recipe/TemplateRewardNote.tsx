// 模板作者奖励的那一句话（模板详情页作者区 / 货架「我的模板」页签共用，2026-10-30，docs/template-author-reward-design.md 第四节 2）。
// 与 RemixRewardNote 同形：只换触发源（别人套用你的模板出片）与几个数。
//
// ★ 句子里的四个数全读 data/templateReward 的 rule（服务端给的）；rule 没有就**什么都不画** ——
//   老服务端 / 离线 / 开关关着时这里不占一个像素，也不许诺任何东西。
// ★ 措辞三条（与同款奖励那句同一套）：① 说「平台奖励」—— 钱不是套用的人出的（token 不许在用户之间流转，别让人以为套模板要多花钱）；
//   ② 条件说全（别人套用 / 公开发布 / 挂满多久），上限说全（到了上限的不顺延，所以两道都要摆出来；每个使用者的那道是防刷、不上屏）；
//   ③ 不说「一定」「每次都」：发不发在服务端到期那一刻才判（作品被设成私密 / 被下架 / 两人之间拉黑 / 自己套自己的都不发）。
import { Trans } from "@lingui/react/macro";
import { fmtTokens } from "../../data/economy";
import { useTemplateReward } from "../../hooks/useTemplateReward";

export default function TemplateRewardNote({ className = "" }: { className?: string }) {
  const { rule } = useTemplateReward();
  if (!rule) return null;
  const tokens = fmtTokens(rule.tokens);
  const hours = rule.holdHours;
  const perDay = rule.perAuthorPerDay;
  const perTemplate = rule.perTemplate;
  return (
    <p data-guide="template-reward-note" className={`text-[11px] leading-relaxed text-slate-500 ${className}`}>
      <Trans>
        🎁 别人套用你的模板出片、公开发布满 {hours} 小时，平台会奖励你 {tokens} token（每天最多 {perDay} 次，每个模板最多 {perTemplate} 次）。
      </Trans>
    </p>
  );
}
