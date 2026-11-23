// 屏幕朝向的唯一判据：**画布/窗口此刻是不是宽大于高**。
//
// ★ 为什么要有它（铁律六）：工坊的宽布局（src/studio/StudioPage.tsx 两侧常驻条）与工作流画布的
//   编辑器分窗（components/flow/FlowCanvas.tsx）都要问"现在横着吗"。这条规则原来在 FlowCanvas 里
//   写了一份，工坊再抄一份就是两处 —— 将来谁把"宽大于高"改成"用 screen.orientation.type"，
//   两处表现就会在平板 / 分屏/ 折叠屏上分叉（那几种形态下两者本来就不一致：分屏时窗口是竖的，
//   而设备是横的）。
// ★ 判据就是 `(orientation: landscape)`：它按**视口**宽高比算，不按设备。Android 上用
//   `@capacitor/screen-orientation` 把 Activity 钉成 landscape 之后视口自然变横，这条跟着变；
//   `npm run dev` 里把窗口拖成竖的，这条也跟着变 —— 两种环境同一套判据。
// ★ 除了 MQL 的 change 还得订 window 的 resize：仿真视口（CDP/DevTools 设备模式）只改
//   `matches` **不派发 change**（2026-08-21 实测：翻转后 matches 已变、监听计数恒 0），
//   真机转屏两个都发。快照没变时 useSyncExternalStore 不重渲，多订这一条零成本。
import { useSyncExternalStore } from "react";

const QUERY = "(orientation: landscape)";

export function useIsLandscape(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", cb);
      window.addEventListener("resize", cb);
      return () => {
        mq.removeEventListener("change", cb);
        window.removeEventListener("resize", cb);
      };
    },
    () => window.matchMedia(QUERY).matches,
    // SSR / 首帧：按竖屏算（与 manifest 里冷启动锁的竖屏一致，不会先画一帧宽布局再跳回来）
    () => false,
  );
}

export default useIsLandscape;
