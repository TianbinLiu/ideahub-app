// 「换形象」按钮：贴在卡组视角下角色模型的**侧旁**，而不是压在顶栏。
//
// 为什么从顶栏搬下来：顶栏是"离开/全局设置"的位置，而换形象是对**画面里那个角色**
// 的操作——放在角色旁边，指向关系不用文字解释。也因此它只在卡组视角出现：其它
// 状态下角色不在画面里（第一人称时你就是她），一个悬空的换装按钮没有指向。
//
// 定位走 PLAYER_SCREEN（3D 锚点每帧投影到屏幕），DOM 侧 rAF 直读——与 NPC 对话气泡
// 同一套，不进 React 状态，跟随时零重渲。
import { useEffect, useRef } from "react";
import { PLAYER_SCREEN, deckCamArrived } from "../scene/cameraOrbit";
import { useStudio } from "../studioStore";

export default function AvatarSwapButton() {
  const deckView = useStudio((s) => s.deckView);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 非卡组视角直接不开 rAF：这颗按钮平时零常驻开销
    if (!deckView) return;
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        el.style.left = `${PLAYER_SCREEN.x * 100}%`;
        el.style.top = `${PLAYER_SCREEN.y * 100}%`;
        // 运镜途中/锚点出屏时隐藏。**pointerEvents 必须跟着 opacity 一起改**：
        // 只清 opacity 会在运镜途中留一颗看不见但能点的按钮，正好压在角色脸上
        const on = deckCamArrived.v && PLAYER_SCREEN.visible;
        el.style.opacity = on ? "1" : "0";
        el.style.pointerEvents = on ? "auto" : "none";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deckView]);

  if (!deckView) return null;
  return (
    <button
      ref={ref}
      onClick={() => useStudio.getState().setAvatarPickerOpen(true)}
      title="换个形象"
      // z-30：投影窗(z-20)之上、形象选择面板(z-40)之下。44px 满足移动端热区下限。
      // 不套全屏容器——那会挡住 canvas 的轨道手势
      className="absolute z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-300/40 bg-[#0c142b]/70 shadow-[0_0_18px_rgba(103,232,249,0.25)] backdrop-blur transition-opacity duration-200"
      style={{ opacity: 0, pointerEvents: "none" }}
    >
      {/* 用户给的 PNG 原图是浅底黑字形（不透明方块），已离线转成"白字形 + alpha"存回
          public/icons/——所以这里**不能再加 invert**，加了就变回黑的、糊在深色底上看不见。
          代价是做不到 currentColor 变色，日后要 hover/激活态得换内联 SVG */}
      <img src="/icons/swap-avatar.png" alt="" draggable={false} className="h-6 w-6 opacity-90" />
    </button>
  );
}
