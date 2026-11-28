// 点云廊 / 光尘的 React 挂载点（2026-11-27，`feat/gs-flythrough-dissolve`）。
//
// 数据与建法全在 `flyCloud.ts`（同一份窗景 splat 复制 6 层、一个 SplatMesh + 一个 Points）。
// 这个组件只做三件事：
//   ① 把建好的两个对象挂进场景（懒加载：`WindowLook` 里 `lazy(() => import("./FlyCloud"))`）；
//   ② 每帧把 `flyTimeline.FLY_U` 的 corridor / dust 写到 `SplatMesh.opacity` 与 Points 的 opacity；
//   ③ 建好的头 3 帧"以 0.001 不透明度画一下"预热 —— Spark 的 accumulate program 与 11.5 MB 纹理
//      在第一次真正出现时才建的话，正好卡在 0.6 s 转场开始那一拍。
//
// ★ draw call：这一档只加 2（点云廊 1 次 accumulate + 光尘 1 次 draw）。验收在 `flyCloudStats()`。
// ★ 大厅 → 房间那一拍整个组件卸载，corridor 的 PackedSplats / 纹理跟着 dispose（与窗景 splat 同一条纪律）。
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { useMatchCam } from "./matchCam";
import {
  disposeFlyCloud,
  driveFlyCloud,
  ensureFlyCloud,
  getFlyCloud,
  setFlyCloudCamera,
  subscribeFlyCloud,
} from "./flyCorridor";

export default function FlyCloud() {
  // 建好/换一份时重渲（useSyncExternalStore 的快照就是模块里的那一份对象，稳定）
  const cloud = useSyncExternalStore(subscribeFlyCloud, getFlyCloud);
  /** 阶段变化时兜底 ensure：万一窗景 splat 就绪得晚、用户马上点了匹配，这里同步建（~30 ms） */
  const stage = useMatchCam((s) => s.stage);
  const warm = useRef(0);

  useLayoutEffect(() => {
    ensureFlyCloud();
  }, [stage]);

  useEffect(() => {
    if (!cloud) return;
    warm.current = 3;
  }, [cloud]);

  // 大厅卸载 → 释放（SplatMesh / Points / 纹理）
  useEffect(() => () => disposeFlyCloud(), []);

  useFrame((state) => {
    if (!cloud) return;
    // 「离镜头太近的点淡掉」要相机位置（走廊的 packed 数据就是世界坐标，不用换算）
    setFlyCloudCamera(state.camera.position.x, state.camera.position.y, state.camera.position.z);
    if (warm.current > 0) {
      warm.current -= 1;
      driveFlyCloud(true);
      return;
    }
    driveFlyCloud(false);
  });

  if (!cloud) return null;
  return (
    <>
      <primitive object={cloud.mesh} />
      <primitive object={cloud.dust} />
    </>
  );
}
