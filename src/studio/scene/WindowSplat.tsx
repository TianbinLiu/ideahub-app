// ★★ 窗洞里的那份 3D 窗景（2026-11-27，`feat/gs-window-daynight`）：ml-sharp（Apple SHARP 的本地
//   一键包）单图 → 3DGS 出来的 `window-moon.spz` / `window-sea.spz`，贴在窗洞位置代替平贴图 ——
//   视差就是从这来的。
//
// 为什么单独一个文件、而且只能 `lazy()` 进来：
//   `@sparkjsdev/spark` 打进来是 16 MB 的解包体积。`GsStep0Room` 已经是懒加载的，这里再来一份
//   **静态** import 就会把 spark 拖回主包 —— 那就等于"关着这一档的人也下载了 16 MB"。
//   所以 `WindowLook.tsx` 用 `lazy(() => import("./WindowSplat"))`，这个模块只在窗景 splat
//   真的要挂的时候才请求。
//
// ★ 一个 Canvas 只能有一个 SparkRenderer（GsStep0Room 文件头 ③）：这里**绝不**新建 SparkRenderer，
//   只建 SplatMesh 放进场景 —— 房间那份 `SparkRenderer`（renderOrder 10 的那个兄弟）会把它一起画。
//
// ★★ 摆法（这是整个文件唯一的"知识"）：
//   ml-sharp 出的是 **OpenCV 相机坐标**（x 右 / y 下 / z 前）、**米制**、0 阶 SH；
//   `.ply` 在 `design/ply2spz.mjs` 之前还过了一道 `.tmp-gs-win/clean_ply.py` 的
//   **投影不变的对数深度压缩**（把单图那种"相对深度"压进 [1.63, 1.98] m 的一个盒子，
//   方向 (x/z, y/z) 一点没改）。所以摆的时候只需要三件事：
//     ① 原点放在**窗洞内容的拍摄机位**上（`WINDOW_VIEW.position`：窗正前方、与窗心等高、1.6 m
//        —— `design/gs-window-shot.tsx` 的默认机位，678² 裁图就是按它裁的）；
//     ② 绕 X 轴转 π：y_cv(下) → −y 世界(下)、z_cv(前) → −z 世界(窗外)；
//     ③ 缩放 **1**（坐标已经是米，不要再按包围盒拟合 —— 拟合会把深度盒一起缩掉，
//        视差跟着变小，而且近处的高斯会跑进屋里）。
//   ⇒ 从那台机位看，splat 的投影与平贴图**逐像素对齐**；换机位才露出视差。
//   ★ 为什么不做"按视场比"的另一种摆法：让原点落在**当前**相机上、按视场反解缩放，只有那一台
//     相机看得对，走一步就错，墙是会露出来的。
import { useLayoutEffect, useState } from "react";
import { SplatMesh } from "@sparkjsdev/spark";
import { WINDOW } from "./moonGeometry";
import { markLobbyWindowReady, noteWindowSplatCreated, noteWindowSplatDisposed } from "./sceneSplit";

/** 窗洞内容的拍摄机位（moonGeometry.WINDOW 现算，别手抄坐标）。 */
export const WINDOW_VIEW = {
  /** 相机到窗面的距离（m）：与 `design/gs-window-shot.tsx` 的缺省 cz 一致 = 1.6 */
  dist: 1.6,
  /** ★ 整份 splat 往室内挪多少（m）。为什么不是 0：
   *  房间点云里有那扇**毛玻璃**（见 `GsSplatCull.WINDOW_GLASS_CULL`），它被裁掉了，
   *  但裁的是一个球（半径 0.46）—— splat 的近端离窗心只有 0.29 m，落在球里会被一起裁掉。
   *  挪 0.3 m 之后近端离线心 0.59 m > 0.46，安全；同时远端 0.3+0.22 = 0.52 m，
   *  在 6° 视角下最多溢出窗洞 5.5 cm（窗框外侧还有 13 cm 的余量，藏在框后面）。
   *  ★ 再往前挪没有好处：视差只由 splat 自己的深度盒（0.22 m）给，与它整体摆在哪儿无关。 */
  forward: 0,
  /** 摆法：OpenCV(y 下 / z 前) → three(y 上 / z 朝向室内)。窗面朝室内是 +z，
   *  窗外是 −z ⇒ splat 的"前"必须对上世界 −z，于是绕 X 转 π。 */
  rotation: [Math.PI, 0, 0] as [number, number, number],
} as const;

/** 原点（世界坐标）：窗心 + 法线 × dist，与窗心等高 */
export function windowViewOrigin(): [number, number, number] {
  const [cx, cy, cz] = WINDOW.center;
  const [nx, , nz] = WINDOW.normal;
  const d = WINDOW_VIEW.dist + WINDOW_VIEW.forward;
  return [cx + nx * d, cy, cz + nz * d];
}

interface Props {
  /** spz 地址（`/models/study/gs/window-*.spz`） */
  url: string;
  /** 0..1 全局不透明度（交叉淡入用它，`SplatMesh.opacity` 是真·全局 alpha 乘数） */
  opacity: number;
  /** 加载完（或失败）回调：失败时上层就只留平贴图 */
  onState?: (state: "ok" | "failed") => void;
  /** 渲染顺序：房间 splat 是 10、夜空球 12 —— 这一层要排在**两者之后**才盖得住烘死的毛玻璃，\n   *  又要排在平贴图（18/19）、亮晕（20）、窗框（22/23）之前。17 正好是这个空档。 */
  renderOrder?: number;
}

export default function WindowSplat({ url, opacity, onState, renderOrder = 17 }: Props) {
  // ★ 同 `GsStep0Room.SplatLayer`：StrictMode 下会挂→卸→再挂，建与释放必须成对放在同一个
  //   effect 里，否则第二次挂载拿到的是已经 dispose 过的那一对（开发期表现为"splat 永远不出现"）。
  //   用 state 而不是 ref：建好之后要触发一次渲染把它挂到场景里。
  const [splat, setSplat] = useState<SplatMesh | null>(null);

  useLayoutEffect(() => {
    const mesh = new SplatMesh({ url, raycastable: false });
    // 验收标记：`__gsSplit.snapshot()` 里 `splatMeshes` 数的是窗景这一份（另一个是房间那份）
    mesh.userData.gsSplat = "window";
    noteWindowSplatCreated();
    let alive = true;
    mesh.initialized
      .then(() => {
        if (!alive) return;
        const box = mesh.getBoundingBox();
        const size = box.max.clone().sub(box.min);
        console.log(
          `[gswin] splat 就绪 ${url}: ${mesh.packedSplats?.numSplats ?? 0} 个高斯，` +
            `局部 bbox ${size.toArray().map((n) => n.toFixed(2)).join("×")} m（应为 1.63~1.98 m 深）`,
        );
        setSplat(mesh);
        // 大厅那一档的"可交互"读数：窗景真的就绪了（`sceneSplit` 里只在 lobby 档记）
        markLobbyWindowReady();
        onState?.("ok");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // 404 是正常路径（老包 / 文件被裁过：只留贴图的那一版）
        console.warn(`[gswin] ${url} 没加载成功 → 这一档只用平贴图`, err);
        onState?.("failed");
      });
    return () => {
      alive = false;
      setSplat(null);
      mesh.dispose();
      noteWindowSplatDisposed();
    };
    // url 变（换装扮）才重建；onState 由调用方用 useCallback 固定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // 不透明度每次变都要写回：Spark 每帧读这一位（交叉淡入就是靠它推进的）
  useLayoutEffect(() => {
    if (splat) splat.opacity = Math.min(1, Math.max(0, opacity));
  }, [splat, opacity]);

  // ★ DEV 读数：窗景 splat 有没有真的进场景、Spark 有没有画它（控制台抓不到时的唯一证据口）
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    const prev = (w.__gsplatdbg as Record<string, unknown>) ?? {};
    w.__gsplatMesh = splat;
    w.__gsplatdbg = {
      ...prev,
      [url]: splat
        ? {
            parent: splat.parent?.type ?? null,
            inScene: !!splat.parent && splat.parent.type === "Scene",
            visible: splat.visible,
            opacity: splat.opacity,
            num: splat.packedSplats?.numSplats ?? 0,
            order: splat.renderOrder,
            pos: splat.position.toArray().map((n) => +n.toFixed(3)),
            scale: splat.scale.toArray().map((n) => +n.toFixed(3)),
          }
        : null,
    };
    return () => {
      const cur = (w.__gsplatdbg as Record<string, unknown>) ?? {};
      delete cur[url];
    };
  }, [splat, url]);

  if (!splat) return null;
  return (
    <primitive
      object={splat}
      position={windowViewOrigin()}
      rotation={WINDOW_VIEW.rotation}
      renderOrder={renderOrder}
    />
  );
}
