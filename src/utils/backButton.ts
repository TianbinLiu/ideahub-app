// 安卓物理返回键的接管 —— **唯一**一处 `App.addListener("backButton")`（2026-10-29，2.73）。
// ★ 为什么要接管：没人监听时 Capacitor 的默认行为是 webView.goBack()（HashRouter 下 = 退回上一个路由），
//   于是盖在页面上的那一层（评论框、底部面板、确认框、全屏）开着时按返回，直接离开了整个页面（真机 2.71 / 2.72 抓到）。
// ★ 为什么不用「开一层就压一格历史」那个办法（2.73 第一版这么写过，发版前复核推翻）：页面在层开着时自己 navigate
//   （从草稿抽屉打开草稿、删卡之后 navigate(-1)、退出登录 replace 回首页）会被那格历史搅乱 —— 返回键「按了没反应」一次，
//   或者 replace 换掉的是那一格而不是页面。听返回键本身就不碰历史，这些全都照旧。
// ★ 一挂监听，Capacitor 就不再替我们 goBack：没有开着的层时这里照原样 history.back()，退到底（canGoBack 为假）就 exitApp，
//   与原来的默认行为一致（原来退到底是 Activity 结束）。
// ★ 层是一个栈（后开的在上面）：确认卡叠在抽屉上时返回键只关上面那层。层的 onBack 回 false = 这会儿不许关（删除在途），这一下返回什么都不做。
// ⚠ 只在原生壳里接管；浏览器（npm run dev）里返回键仍是浏览器自己的后退，层不会跟着关 —— 验法见 window.__back（开发 / e2e 构建）。
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

type Layer = { id: number; onBack: () => void | boolean };
const stack: Layer[] = [];
let seq = 0;
let installed = false;

/** 返回键按下时做什么（导出给开发构建的 window.__back 实跑） */
export function handleBack(canGoBack: boolean): void {
  const top = stack[stack.length - 1];
  if (top) {
    top.onBack();
    return;
  }
  if (canGoBack) window.history.back();
  else void App.exitApp();
}

function install(): void {
  if (installed) return;
  installed = true;
  if (Capacitor.isNativePlatform()) void App.addListener("backButton", ({ canGoBack }) => handleBack(canGoBack));
  if (import.meta.env.DEV || import.meta.env.MODE === "e2e") {
    (window as unknown as { __back?: () => void }).__back = () => handleBack(window.history.length > 1);
  }
}

/** 压一层：返回键先交给它。回的是撤掉这一层的函数（层关掉 / 卸载时调） */
export function pushBackLayer(onBack: () => void | boolean): () => void {
  install();
  const id = ++seq;
  stack.push({ id, onBack });
  return () => {
    const i = stack.findIndex((l) => l.id === id);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 现在有几层开着（只给调试 / 测试看） */
export function openBackLayers(): number {
  return stack.length;
}
