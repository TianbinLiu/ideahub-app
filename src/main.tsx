// DEV：隐藏页（无合成器）下 rAF 停摆，r3f 的尺寸测量与帧循环都依赖 rAF——
// 用 setTimeout 垫片驱动，供 E2E/离屏捕帧使用；页面一旦变为可见立即恢复原生 rAF（满帧率）
if (import.meta.env.DEV && document.visibilityState === "hidden") {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 33) as unknown as number;
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
  // 隐藏页 ResizeObserver 初次回调不派发：常驻低频踢 resize，让（重）挂载的 Canvas 总能完成测量
  const kick = window.setInterval(() => {
    const c = document.querySelector("canvas");
    if (c && c.width <= 400) window.dispatchEvent(new Event("resize"));
  }, 500);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCaf;
      window.clearInterval(kick);
    }
  });
}

import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { pickLang } from "./i18n/locale";
import { activateLang } from "./i18n/activate";
import "./index.css";

/**
 * 开机：先选语言、激活目录，**再动态加载 App**，最后 render（多语言方案 §3.3 / §5.1）。
 *
 * ★★ 不许静态 import App：ESM 静态 import 会提升，整个业务模块图会先于这里的 await 求值，
 *   任何一处模块顶层的翻译调用都会在激活之前执行 —— 正式包白屏、自己好不了。先激活、再动态加载，
 *   这一整类问题就不存在（守卫里「模块顶层只准 msg 描述符」只是第二道）。
 * ★ render 之前 #root 是空的，所以不会「先中文、后英文」闪一下。
 * ★ 失败路径：选中的语言目录加载不出 → 退回中文；中文也不行、或 App 这一块加载不出 → 纯 DOM 双语错误屏。
 *   **绝不**在没有目录的情况下照常渲染：生产构建里宏只剩 id，屏幕会满是一串串 hash。
 */
async function boot(): Promise<void> {
  let ok = false;
  try {
    await activateLang(pickLang());
    ok = true;
  } catch (e) {
    console.error("[i18n] 界面语言目录加载失败，退回中文:", e);
  }
  if (!ok) {
    try {
      await activateLang("zh");
    } catch (e) {
      console.error("[i18n] 中文目录也加载失败:", e);
      return bootError();
    }
  }
  let App: React.ComponentType;
  try {
    ({ default: App } = await import("./App"));
  } catch (e) {
    console.error("[boot] App 加载失败:", e);
    return bootError();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider i18n={i18n}>
        <HashRouter>
          <App />
        </HashRouter>
      </I18nProvider>
    </React.StrictMode>,
  );
}

/**
 * 开机失败的整屏：纯 DOM，不依赖 React 与 i18n（这一刻两样都可能是坏的）。
 * ★ 文案固定双语、冻结：语言都还没选出来，只能两种一起说；给一颗能自救的「重新加载」。
 */
function bootError(): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.replaceChildren();
  const box = document.createElement("div");
  box.style.cssText =
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;color:#cbd5e1;font-size:14px;line-height:1.6;";
  const p = document.createElement("p");
  p.textContent = "界面没能加载出来，请重新加载 · The app failed to load. Please reload.";
  const btn = document.createElement("button");
  btn.textContent = "重新加载 · Reload";
  btn.style.cssText = "border-radius:12px;background:#fbbf24;color:#05070f;font-weight:700;padding:10px 20px;border:0;";
  btn.onclick = () => location.reload();
  box.append(p, btn);
  root.append(box);
}

void boot();
