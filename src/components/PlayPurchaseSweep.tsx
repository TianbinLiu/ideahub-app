// 启动时把 Google Play 那边还挂着的购买兑掉（只在 play 渠道有事可做）。
//
// ★★ 为什么必须在启动时也来一遍：兑币那一发可能正好断网，或者用户付完款就把 App 划掉了。
//   Play 的消耗型商品在服务端 consume 之前一直查得到 —— 这是「钱付了没到账」唯一的出路，
//   而端上没有任何别的东西会自己重来。钱包抽屉打开时也扫一次（那是用户会去找的地方）。
// ★ 成功要说出来：静默补上会让用户以为余额自己长了。失败一律安静 —— 没人在等这件事，
//   下一次启动或下一次开钱包还会再试（data/account.sweepPlayPurchases）。
// ★ 延后 3 秒：理由与 UpdateGate 一样，开屏那几秒别抢网络。
// ★ 单独一个文件而不是写在 App.tsx 里：App.tsx 的 useLingui 来自**运行时包**
//   （根组件订阅语言变化用），那一份不给 t；这里要的是宏包那个 useLingui。
//   同一个文件里两个同名 import 会撞。
import { useEffect } from "react";
import { useLingui } from "@lingui/react/macro";
import { sweepPlayPurchases } from "../data/account";
import { fmtTokens } from "../data/economy";
import { showToast } from "../data/toast";

export default function PlayPurchaseSweep() {
  const { t } = useLingui();
  useEffect(() => {
    const timer = setTimeout(() => {
      void sweepPlayPurchases().then((r) => {
        if (r.tokens > 0) showToast(t`已把上一笔 Google Play 购买取回，到账 ${fmtTokens(r.tokens)} token`, 4500);
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [t]);
  return null;
}
