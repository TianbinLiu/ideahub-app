// 「按手机返回键先关掉这一层」—— 全屏 / 沉浸态、评论抽屉这类盖在页面上的一层共用（2026-10-29 真机 2.71 / 2.72 抓到）。
// ★ 为什么要压一格历史：安卓返回键在 Capacitor 里是 webView.goBack()（全 app 没有人监听 backButton），
//   这一层不在历史里的话，返回键直接退出整个页面（详情页全屏时按返回落回首页；评论抽屉开着按返回，收起键盘之后再按一次就离开了这一页）。
//   层打开时压一格**同一个地址**的历史（state 上带记号，保留 react-router 的 idx / key —— useBackOr 读的就是 idx），
//   返回键只弹掉这一格 → popstate → 关掉这一层。
// ★ 用户点 ✕ / 点遮罩关掉时要调 dismiss() 把那一格也弹掉，否则还要多按一次返回才离开这一页。
//   因为点了别的链接而离开（层跟着页面卸载）时**不要**调：那时新路由已经压在上面，弹一格就是把人拽回来。
import { useEffect, useRef } from "react";

const MARK = "__backLayer";

function topLayer(): string | undefined {
  return (window.history.state as Record<string, unknown> | null)?.[MARK] as string | undefined;
}

/**
 * @param active 这一层现在开着没有
 * @param onBack 返回键把这一层关掉时调（只管关，历史已经弹过了）
 * @param key 这一层的名字（同一时刻一层一个名字；记号相同才认是自己）
 * @returns dismiss：用户自己关掉这一层时调，把压的那一格历史弹掉（只弹自己的、只弹一次）
 */
export function useBackLayer(active: boolean, onBack: () => void, key: string): () => void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  /** 已经叫过 history.back()、还没等到 popstate：别再弹第二次（✕ 与 fullscreenchange 这类可能前后脚都来叫，弹两次就离开这一页了） */
  const popping = useRef(false);

  useEffect(() => {
    if (!active) return;
    // 上一次 dismiss 叫的 back() 的 popstate 多半是在监听撤掉之后才到的：重新打开时清掉这个记号，不然这一层再也弹不掉自己的那一格
    popping.current = false;
    // StrictMode 下 effect 会跑两遍：已经是自己压的那一格就不再压
    if (topLayer() !== key) window.history.pushState({ ...((window.history.state as object | null) ?? {}), [MARK]: key }, "");
    const onPop = () => {
      popping.current = false;
      if (topLayer() === key) return;
      onBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [active, key]);

  return () => {
    if (popping.current || topLayer() !== key) return;
    popping.current = true;
    window.history.back();
  };
}
