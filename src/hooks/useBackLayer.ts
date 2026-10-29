// 「按手机返回键先关掉这一层」—— 全屏 / 沉浸态、所有底部抽屉与对话框共用（2026-10-29 真机 2.71 / 2.72 抓到）。
// ★ 为什么要压一格历史：安卓返回键在 Capacitor 里是 webView.goBack()（全 app 没有人监听 backButton），
//   这一层不在历史里的话，返回键直接退出整个页面（详情页全屏时按返回落回首页；评论抽屉开着按返回，收起键盘之后再按一次就离开了这一页）。
//   层打开时压一格**同一个地址**的历史（state 上带记号，保留 react-router 的 idx / key —— useBackOr 读的就是 idx），
//   返回键只弹掉这一格 → popstate → 关掉这一层。
// ★ 层不是因为返回键关掉的（点 ✕、点遮罩、点了里面的某个动作）：关掉之后那一格还在最上面，就自己弹掉
//   （晚一拍再看：同一个点击里接着 navigate 去了别处的话，新路由已经压在上面，那一格就留着 —— 弹它就是把人拽回来）。
//   不弹的话，人关掉抽屉之后按返回会「没反应」一次。
// ★ 记号按**实例**发（名字 + 序号）：确认卡常叠在抽屉上，两层各认各的记号，返回键先弹上面那格、只关上面那层。
// ⚠ 已知的小缝：一次点击同时关掉叠着的两层时，下面那层的那一格留在历史里（它关的那一拍上面那格还没弹完），多按一次返回才离开。
import { useEffect, useRef } from "react";

const MARK = "__backLayer";
let seq = 0;

function topLayer(): string | undefined {
  return (window.history.state as Record<string, unknown> | null)?.[MARK] as string | undefined;
}

/**
 * @param active 这一层现在开着没有（只在开着时挂载的组件传 true）
 * @param onBack 返回键把这一层关掉时调（历史已经弹过了）。回 false = 这会儿不许关（删除在途）：那一格再压回去，这一下返回只是被拦住。
 *   永远不许关的层（强制更新）别接这个 hook
 * @param name 这一层叫什么（记号 = 名字 + 实例序号）
 * @returns dismiss：要在关掉的**同一拍**就弹掉那一格时调（全屏的 ✕）；不调也会在关掉之后自己弹
 */
export function useBackLayer(active: boolean, onBack: () => void | boolean, name: string): () => void {
  const keyRef = useRef("");
  if (!keyRef.current) keyRef.current = `${name}#${++seq}`;
  const key = keyRef.current;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  /** 已经叫过 history.back()、还没等到 popstate：别再弹第二次 */
  const popping = useRef(false);
  /** 关掉之后晚一拍的那个自弹计时器（StrictMode 下 effect 卸了又装，装回来时要撤掉它，不然 dev 里抽屉一开就被自己关掉） */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (popping.current || topLayer() !== key) return;
    popping.current = true;
    window.history.back();
  };

  useEffect(() => {
    if (!active) return;
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    popping.current = false;
    const push = () => window.history.pushState({ ...((window.history.state as object | null) ?? {}), [MARK]: key }, "");
    // StrictMode 下 effect 会跑两遍：已经是自己压的那一格就不再压
    if (topLayer() !== key) push();
    const onPop = () => {
      popping.current = false;
      // 还是我这一格（上面那层的那一格刚被弹掉）：不动
      if (topLayer() === key) return;
      if (onBackRef.current() === false) push();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // 不是返回键关的：那一格还在最上面就自己弹掉（晚一拍：同一个点击里的 navigate 先落地）
      pending.current = setTimeout(() => {
        pending.current = null;
        dismiss();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismiss 只读 ref 与 key（key 每个实例恒定）
  }, [active, key]);

  return dismiss;
}
