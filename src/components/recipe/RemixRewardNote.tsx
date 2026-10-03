// 同款奖励的那一句话（发布页 / 编辑页共用，模板体系 P3b）。
//
// ★ 句子里的四个数全读 data/remixReward 的 rule（服务端给的）；rule 没有就**什么都不画** ——
//   老服务端 / 离线 / 开关关着时这里不占一个像素，也不许诺任何东西。
// ★ 措辞三条：① 说「平台奖励」—— 钱不是同款作者出的（token 不许在用户之间流转，别让人以为做同款要花钱）；
//   ② 条件说全（别人做的 / 公开发布 / 挂满多久），上限说全（到了上限的不顺延，所以两道都要摆出来）；
//   ③ 不说「一定」「每次都」：发不发在服务端到期那一刻才判（同款被设成私密 / 被下架 / 账号被封都不发）。
import { Trans } from "@lingui/react/macro";
import { fmtTokens } from "../../data/economy";
import { useRemixReward } from "../../hooks/useRemixReward";

export default function RemixRewardNote({ className = "" }: { className?: string }) {
  const { rule, mine } = useRemixReward();
  if (!rule) return null;
  const tokens = fmtTokens(rule.tokens);
  const hours = rule.holdHours;
  const perDay = rule.perDay;
  const perVideo = rule.perVideo;
  const count = mine?.count ?? 0;
  const earned = fmtTokens(mine?.tokens ?? 0);
  return (
    <p data-guide="remix-reward-note" className={`text-[11px] leading-relaxed text-slate-500 ${className}`}>
      <Trans>
        🎁 别人照着这条作品做了同款、公开发布满 {hours} 小时，平台会奖励你 {tokens} token（每天最多 {perDay} 次，每条作品最多 {perVideo} 次）。
      </Trans>
      {count > 0 && (
        <span className="text-emerald-300/90">
          {" "}
          <Trans>你已经拿到过 {count} 次，共 {earned} token。</Trans>
        </span>
      )}
    </p>
  );
}
