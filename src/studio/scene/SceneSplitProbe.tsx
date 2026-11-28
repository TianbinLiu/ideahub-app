// 两套场景共用的每帧探针（`sceneSplit` 的"读数手"）：
//   · 记"大厅/房间的窗景就绪之后**第一帧**"——黑幕撤不撤、验收的"可交互"读数都看它；
//   · 每秒结算一次 fps / draw call / `renderer.info.memory`，写进 sceneSplit 的模块级快照。
//
// ★ 为什么挂在 `GsStep0Environment` 里（而不是 GsStep0Room）：大厅那一档没有 GsStep0Room，
//   而大厅 fps 正是这一轮要报的数之一。这个探针在两套场景里都活着、切场景时不重挂。
// ★ 时钟用 `performance.now()`（与 `mark*` 系列同一时钟）；r3f 的 `clock.elapsedTime`
//   是"从页面加载算起"的另一条轴，混用会把"加载耗时"算歪。
import { useLayoutEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { registerSceneRenderer, sceneSplitTick } from "./sceneSplit";

export default function SceneSplitProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    registerSceneRenderer(gl, scene);
    // DEV 读数口子：验收要在控制台/截图脚本里数场景里挂了几个 SplatMesh（生产构建里不存在）
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__gsScene = scene;
    return () => {
      registerSceneRenderer(null);
      if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>).__gsScene;
    };
  }, [gl, scene]);
  useFrame(() => {
    sceneSplitTick(performance.now());
  });
  return null;
}
