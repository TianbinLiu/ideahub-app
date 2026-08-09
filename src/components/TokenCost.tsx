// 「这一步要花多少 token」的统一提示条。
//
// 为什么要抽出来：以前各处是手写的
//   <p className="text-[11px] text-slate-500">最多需要 X token…</p>
// 结果三件事各写各的——有的忘了判 AI_REAL（演示模式下不烧钱却照报数字，
// 用户以为白花了），有的余额不足时没有出路（"去充值"要么没有、要么链到
// 不存在的 /profile），有的干脆一个字没有（3D 建模 2.4 元一次，全 app 最贵的
// 单次操作，以前静默触发、静默免费）。收成一个组件，这三件就只会漏一次。
import { Link } from "react-router";
import { AI_REAL } from "../ai";
import { canAfford, walletOf } from "../data/account";
import { fmtTokens } from "../data/economy";

export default function TokenCost({
  tokens,
  note,
  /** 上限而非确数（按实际产出结算）时给 true，文案改成"最多" */
  upper = false,
  className = "",
}: {
  tokens: number;
  note?: string;
  upper?: boolean;
  className?: string;
}) {
  // 演示模式下不消耗任何额度，报数字只会误导。但也不能什么都不说——
  // 用户以为自己在测真实生成，得让他知道这一炉是假的
  if (!AI_REAL) {
    return (
      <p className={`text-[11px] text-amber-300/80 ${className}`}>○ 演示模式：本地模拟，不消耗 token</p>
    );
  }
  const w = walletOf();
  const bal = (w?.plan ?? 0) + (w?.addon ?? 0);
  const ok = canAfford(tokens);
  return (
    <p className={`text-[11px] ${ok ? "text-slate-500" : "text-rose-300"} ${className}`}>
      {upper ? "最多消耗" : "预计消耗"} {fmtTokens(tokens)} token
      {note ? ` · ${note}` : ""}
      {!ok && (
        <>
          {" "}· 余额 {fmtTokens(bal)} 不够，
          {/* 路由是 /me，不是 /profile——写错了编译器不拦，运行时点了没反应，
              而这在余额不足时是用户唯一的出路 */}
          <Link to="/me" className="underline">
            去充值
          </Link>
        </>
      )}
    </p>
  );
}
