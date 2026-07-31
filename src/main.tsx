// DEV：隐藏页（无合成器）下 rAF 停摆，r3f 的尺寸测量与帧循环都依赖 rAF——
// 用 setTimeout 垫片驱动，供 E2E/离屏捕帧使用；正常显示的页面不受影响
if (import.meta.env.DEV && document.visibilityState === "hidden") {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 33) as unknown as number;
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
  // 隐藏页 ResizeObserver 初次回调不派发：常驻低频踢 resize，让（重）挂载的 Canvas 总能完成测量
  window.setInterval(() => {
    const c = document.querySelector("canvas");
    if (c && c.width <= 400) window.dispatchEvent(new Event("resize"));
  }, 500);
}

import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
