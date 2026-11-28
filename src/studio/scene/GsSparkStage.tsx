// ★ 一个 Canvas 只有一台 SparkRenderer（两套场景共用这一台，2026-11-27 `feat/gs-scene-split`）。
//
// 为什么从 GsStep0Room / GsLobbyScene 里挪出来：
//   · 两套场景互斥挂载，但**渲染器不该跟着换**：换一次场景就 `new SparkRenderer` + dispose 一台，
//     splat pass 的纹理/program 全要重新初始化一遍（浏览器首轮 `info.programs` +17）。
//     渲染器留在 `GsStep0Environment` 里不动，切场景只换 SplatMesh —— 那才是"释放"该管的东西。
//   · 大厅那一档没有房间，但窗景 splat 也需要有人画：这一台在大厅时就是画窗景的。
//
// ★ 懒加载：`@sparkjsdev/spark` 是 16 MB 的解包体积，与两套场景共用一个 chunk（构建里会看到共享块）。
// ★ 建/放成对放在同一个 effect 里（StrictMode 会挂→卸→再挂，用 useMemo 会拿到已 dispose 的实例）。
// ★ `name` 是验收标记：`__gsSplit.snapshot().sparkRenderers` 数它（Vite 会把类名压成 _aX）。
import { useLayoutEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { SparkRenderer } from "@sparkjsdev/spark";
import { noteSparkCreated, noteSparkDisposed } from "./sceneSplit";

export default function GsSparkStage() {
  const gl = useThree((s) => s.gl);
  const [spark, setSpark] = useState<SparkRenderer | null>(null);
  useLayoutEffect(() => {
    const s = new SparkRenderer({ renderer: gl });
    s.name = "gs-spark";
    noteSparkCreated();
    setSpark(s);
    return () => {
      setSpark(null);
      s.dispose();
      noteSparkDisposed();
    };
  }, [gl]);
  return spark ? <primitive object={spark} /> : null;
}
