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
// ★★ 摆法（这是整个文件唯一的"知识"，2026-11-27 搬到了 `moonGeometry.WINDOW_VIEW`）：
//   ml-sharp 出的是 **OpenCV 相机坐标**（x 右 / y 下 / z 前）、**米制**、0 阶 SH；
//   `.ply` 在 `design/ply2spz.mjs` 之前还过了一道 `.tmp-gs-win/clean_ply.py` 的
//   **投影不变的对数深度压缩**（把单图那种"相对深度"压进 [1.63, 1.98] m 的一个盒子，
//   方向 (x/z, y/z) 一点没改）。所以摆的时候只需要三件事：
//     ① 原点放在**窗洞内容的拍摄机位**上（`WINDOW_VIEW`：窗正前方、与窗心等高、1.6 m）；
//     ② 绕 X 轴转 π：y_cv(下) → −y 世界(下)、z_cv(前) → −z 世界(窗外)；
//     ③ 缩放 **1**（坐标已经是米，不要再按包围盒拟合）。
//   ⇒ 从那台机位看，splat 的投影与平贴图**逐像素对齐**；换机位才露出视差。
//
// ★★ 2026-11-27（`feat/gs-flythrough-dissolve`）：**每点 stagger 的点子在这里**。
//   主人要"贴图散成点、每颗 splat 有 0~0.6 s 随机延迟 + 尺寸 0.2 长到 1.0"。做法：
//   `SplatMesh.objectModifier`（Spark 的 dyno 修饰器，逐 splat 在 shader 里算，**不 CPU 遍历**）：
//     · 每点随机数 = `hashFloat(center)`（点自己的局部坐标 → 稳定、无需额外 attribute）；
//     · `FLY_U.dissolve`（0..1，同一拍由 matchCam 的时间轴写）推到 1 时，所有点都出来；
//     · 不飞的时候 `FLY_U.active = 0` ⇒ 修饰器输出 = 原值，大厅/房间里逐像素不变。
//   ★ 随机延迟给到 0.72 的进度（≈0.43 s），出现过程 0.28（≈0.17 s）——总和正好 0.6 s。
//     改用 CPU 每帧遍历 12 万点会掉帧，而且 Spark 的 program 每帧都会重新读 uniform。
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { SplatMesh, dyno } from "@sparkjsdev/spark";
import { WINDOW_VIEW, windowViewOrigin } from "./moonGeometry";
import { FLY_U } from "./flyTimeline";
import { noteCorridorSkin, type CorridorSkin } from "./flyCorridor";
import { applySplatLook, makeSplatLookUniforms, registerSplatLookMesh } from "./splatLook";
import { markLobbyWindowReady, noteWindowSplatCreated, noteWindowSplatDisposed } from "./sceneSplit";

interface Props {
  /** spz 地址（`/models/study/gs/window-*.spz`） */
  url: string;
  /** 这一份是夜（月）还是昼（海天）—— 点云廊要按同一档加载"只含窗洞内容"的旧 spz（见 flyCorridor）。 */
  skin: CorridorSkin;
  /** 0..1 全局不透明度（交叉淡入用它，`SplatMesh.opacity` 是真·全局 alpha 乘数） */
  opacity: number;
  /** 加载完（或失败）回调：失败时上层就只留平贴图 */
  onState?: (state: "ok" | "failed") => void;
  /** 渲染顺序：房间 splat 是 10、夜空球 12 —— 这一层要排在**两者之后**才盖得住烘死的毛玻璃，\n   *  又要排在平贴图（18/19）、亮晕（20）、窗框（22/23）之前。17 正好是这个空档。 */
  renderOrder?: number;
}

/** 0..1 的平滑过渡（与 flyTimeline 里那条同一条曲线；这里只给"穿窗淡出"用） */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 每点 stagger 的修饰器（dyno；构造一次，uniform 每帧由 `FLY_U` 喂）。
 *  ★ 输出必须"不飞时逐像素等于原值"：`active=0` 时 opacity 乘 1、scales 乘 1。
 *  ★ 2026-11-27（`feat/gs-tunnel-depth`）两件事并进来：
 *    ① **点变大/拉成椭圆**（`splatLook.applySplatLook`，amount = active ⇒ 大厅里原样）；
 *    ② **昼档把近场密点剔掉**（第 2 条"昼用底表纵深"）：穿出窗面之后按**局部 z** 把近处那一层
 *       淡掉、远处（z 到 120 m 的海天）留着 —— 底表自带真纵深，于是昼档不用再复制那么多层。 */
function makeDissolveModifier(
  progress: ReturnType<typeof dyno.dynoFloat>,
  active: ReturnType<typeof dyno.dynoFloat>,
  travel: ReturnType<typeof dyno.dynoFloat>,
  look: ReturnType<typeof makeSplatLookUniforms>,
  daySkin: boolean,
) {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) throw new Error("no gsplat input");
    const g = dyno.splitGsplat(gsplat).outputs;
    // 每点随机延迟（0..1）
    const rnd = dyno.hashFloat(g.center);
    // local = clamp((progress - rnd*0.72) / 0.28, 0, 1)，再做成 smoothstep
    const local = dyno.clamp(
      dyno.div(dyno.sub(progress, dyno.mul(rnd, dyno.dynoConst("float", 0.72))), dyno.dynoConst("float", 0.28)),
      dyno.dynoConst("float", 0),
      dyno.dynoConst("float", 1),
    );
    const eased = dyno.mul(dyno.mul(local, local), dyno.sub(dyno.dynoConst("float", 3), dyno.mul(local, dyno.dynoConst("float", 2))));
    // ★★ 2026-11-27（整图底表之后）：**只让窗洞那一圈化点**。
    //   现在挂的是 `window-*-full.spz`（墙 + 窗框 + 窗外整张图），若整份都跟着散，
    //   墙会化成点、背景露出来 —— 正是主人嫌弃的"背景透明"。判据用**局部坐标的径向距离**：
    //   拍摄机位在原点、窗洞在画面正中，窗洞半径 0.45 m ⇒ 取 0.52 m 内那一圈（含框内侧一点）。
    const c = dyno.split(g.center).outputs;
    const rad2 = dyno.add(dyno.mul(c.x, c.x), dyno.mul(c.y, c.y));
    const inWindow = dyno.lessThan(rad2, dyno.dynoConst("float", 0.52 * 0.52));
    const gate = dyno.select(inWindow, dyno.dynoConst("float", 1), dyno.dynoConst("float", 0));
    const localActive = dyno.mul(active, gate);
    const appear = dyno.mix(dyno.dynoConst("float", 1), eased, localActive);
    // 尺寸从 0.2 长到 1.0（主人给的数）
    const grow = dyno.add(dyno.dynoConst("float", 0.2), dyno.mul(eased, dyno.dynoConst("float", 0.8)));
    const scale = dyno.mix(dyno.dynoConst("float", 1), grow, localActive);
    let out = dyno.combineGsplat({
      gsplat,
      opacity: dyno.mul(g.opacity, appear),
      scales: dyno.mul(g.scales, scale),
    });
    // ① 点变大 / 拉成椭圆：amount = active（大厅里恒 0 ⇒ 逐像素原样）
    out = applySplatLook(out, active, look);
    // ② 昼档穿窗后的近场剔除：zCut 从 1.9 m 长到 7.0 m，近处的密点淡掉、远处海天留着。
    //   ★ 只在 travel 0.24（相机到窗面）之后开始 —— 化点段/穿窗前还要靠这些点画那扇窗。
    if (daySkin) {
      const open = dyno.smoothstep(dyno.dynoConst("float", 0.24), dyno.dynoConst("float", 0.34), travel);
      const k = dyno.smoothstep(dyno.dynoConst("float", 0.3), dyno.dynoConst("float", 0.95), travel);
      const zCut = dyno.mix(dyno.dynoConst("float", 1.9), dyno.dynoConst("float", 7.0), k);
      const far = dyno.smoothstep(zCut, dyno.mul(zCut, dyno.dynoConst("float", 1.4)), c.z);
      const keep = dyno.mix(dyno.dynoConst("float", 1), far, open);
      const g2 = dyno.splitGsplat(out).outputs;
      out = dyno.combineGsplat({ gsplat: out, opacity: dyno.mul(g2.opacity, keep) });
    }
    return { gsplat: out };
  });
}

export default function WindowSplat({ url, skin, opacity, onState, renderOrder = 17 }: Props) {
  // ★ 同 `GsStep0Room.SplatLayer`：StrictMode 下会挂→卸→再挂，建与释放必须成对放在同一个
  //   effect 里，否则第二次挂载拿到的是已经 dispose 过的那一对（开发期表现为"splat 永远不出现"）。
  //   用 state 而不是 ref：建好之后要触发一次渲染把它挂到场景里。
  const [splat, setSplat] = useState<SplatMesh | null>(null);
  /** 装扮交叉淡入那一份基础不透明度（useFrame 里还要乘"穿窗淡出"系数） */
  const baseOpacity = useRef(1);

  // 每点 stagger 的两个 uniform（dyno 对象，shader 每帧取 .value；组件卸载由 GC 收）
  const progress = useMemo(() => dyno.dynoFloat(0), []);
  const active = useMemo(() => dyno.dynoFloat(0), []);
  const travel = useMemo(() => dyno.dynoFloat(0), []);
  const look = useMemo(() => makeSplatLookUniforms(), []);
  const modifier = useMemo(
    () => makeDissolveModifier(progress, active, travel, look, skin === "day"),
    [progress, active, travel, look, skin],
  );
  useFrame(() => {
    progress.value = FLY_U.dissolve.value;
    active.value = FLY_U.active.value;
    travel.value = FLY_U.travel.value;
    if (!splat) return;
    // ★★ 2026-11-27 真机：整图底表的窗洞区域点很密 —— 相机一动，那份稠密点云在近处会重新
    //   读成"一张图"（夜档是撞一屏白，昼档是远端海天糊满屏）。
    //   **夜档**：底表整份淡掉（深度只到 1.8 m，之后没有点，交给点云廊）。
    //   **昼档**：不整份淡，修饰器里按局部 z 把近场那一层剔掉、远处的海天留着
    //   （第 2 条"昼可用底表纵深 ⇒ 少复制层"）；这里只把交叉淡入那一份 baseOpacity 写进去。
    if (skin === "night") {
      const fadeK = 1 - smoothstep(0.04, 0.18, FLY_U.travel.value);
      const op = baseOpacity.current * fadeK;
      if (Math.abs(splat.opacity - op) > 0.001) splat.opacity = op;
      const behind = fadeK <= 0.001 || (FLY_U.travel.value > 0.38 && FLY_U.corridor.value > 0.2);
      if (splat.visible !== !behind) splat.visible = !behind;
    } else if (Math.abs(splat.opacity - baseOpacity.current) > 0.001) {
      splat.opacity = baseOpacity.current;
    }
  });

  useLayoutEffect(() => {
    const mesh = new SplatMesh({ url, raycastable: false });
    // 验收标记：`__gsSplit.snapshot()` 里 `splatMeshes` 数的是窗景这一份（另一个是房间那份）
    mesh.userData.gsSplat = "window";
    // ★ 每点 stagger：在建好之后、挂进场景之前装上（第一次编译就带着它，转场开始那一下不用重编译）
    mesh.objectModifier = modifier;
    mesh.updateGenerator();
    registerSplatLookMesh(mesh);
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
        // 点云廊要"只含窗洞内容"的那份点（整图版含墙，复制出来是墙的隧道）：
        // 告诉 flyCorridor 这一轮哪一档 + 底表点数（点数预算读数要它），
        // 由它自己加载旧 spz 复制层（见那儿的 ★★）
        noteCorridorSkin(skin, mesh.packedSplats?.numSplats ?? 0);
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
    baseOpacity.current = Math.min(1, Math.max(0, opacity));
    if (splat) splat.opacity = baseOpacity.current;
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
