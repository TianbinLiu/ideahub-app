// 「去升级」—— 套餐门槛那一类原因（会员档、免费档限制）旁边那一条能走的路。**全 app 只有这一份**（2026-10-07 收口）。
//
// ★ 落点是「我的」页并直接打开钱包抽屉（`/me?wallet=1`，ProfilePage 读到就开）：原来几处各写一个 `<Link to="/me">`，
//   落在个人页的作品墙上，人还得自己去找右上角那颗钱包键 —— 而套餐与充值都在钱包抽屉里。
// ★ 文字固定「去升级」：付过任何一笔（充值包也算）就能用全部档位，所以这条路既指套餐也指充值，抽屉里两样都有。
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";

/** 打开钱包抽屉的那条地址（ProfilePage 认 `wallet=1`）。别处要跳过去也用它，别手拼 */
export const UPGRADE_HREF = "/me?wallet=1";

export default function UpgradeLink({ className = "underline underline-offset-2" }: { className?: string }) {
  return (
    <Link to={UPGRADE_HREF} className={className}>
      <Trans>去升级</Trans>
    </Link>
  );
}
