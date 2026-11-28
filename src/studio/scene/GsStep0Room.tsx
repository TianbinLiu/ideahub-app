// ★ 高斯泼溅第 0 步的"重"那一半：房间那一份 SplatMesh（懒加载）。
//   TableScene 只在 `GsStep0Environment` 判定为"开着且没失败、且这一帧是 room 那一套"时才 import 到这里，
//   大厅/匹配页那一档连这个 chunk 都不会下载（构建产物里是 GsStep0Room-*.js）。
//
// ★★ 2026-11-27（`feat/gs-scene-split`）：**SparkRenderer 不在这里了** —— 它挪去了 `GsSparkStage`
//   （大厅/房间两套场景共用一台，切场景只换 SplatMesh；见那个文件的 ★）。这里只剩：
//   房间 SplatMesh + 环境贴图（DayEnvironment）+ 椅子/毛玻璃裁剪（GsSplatCull）。
//
// 三条不能忘的坑（docs/gs-step0-plan.md §3.3）：
//   ① splat 默认 transparent、depthWrite=false —— 它挡不住之后画的透明物，谁先谁后只看 renderOrder。
//      这里的队伍写死：网格 0 / splat 10 / 玻璃与光效 20。
//   ② splat 不吃灯：DirectionalLight / RectAreaLight 只照桌面与卡牌（见 GsStep0Environment.DayLights）。
//   ③ 一个 Canvas 只能有一个 SparkRenderer：它按帧把场景里所有 SplatMesh 收进自己那个 mesh 里画。
import { useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { SplatMesh } from "@sparkjsdev/spark";
import {
  GS_DAY,
  GS_STEP0_BUDGET,
  GS_STEP0_TRANSFORM,
  gsAssetUrl,
  gsCapability,
  gsFillOn,
  gsLoadMs,
  gsMarkReady,
  gsMaxSplats,
  gsPhaseNow,
  gsQuality,
  gsSplatTier,
  setGsPhase,
} from "./gsStep0";
import { GS_STATS, mountGsHud, updateGsHud } from "./gsHud";
import GsSplatCull from "./GsSplatCull";
import {
  markRoomDisposed,
  markRoomFailed,
  markRoomMounted,
  markRoomReady,
  noteRoomSplatCreated,
  noteRoomSplatDisposed,
} from "./sceneSplit";

/** 白天的"环境光"：真 HDR 还没进仓（plan §4.4 要的是 Poly Haven 1k CC0 ≈1 MB），
 *  先程序化画一张等距柱状图（天顶蓝 → 地平线暖白 → 地面褐 + -x 窗墙那一块高亮）再过 PMREM。
 *  换成真 HDR 时只改这一个函数（RGBELoader → fromEquirectangular），别动别处。 */
function makeDayEquirect(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (g) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    // ★ 2026-11-25（step1）：这间屋子是**月夜**（深蓝紫 + 圆窗的冷月光），不再走白天那组暖色。
    //   天顶 → 地平线 → 地面三段都压暗，地平线那一档只留一点冷白（月光落在窗台/地板上的那一线）。
    sky.addColorStop(0, "#141a2a");
    sky.addColorStop(0.46, "#2b3550");
    sky.addColorStop(0.5, "#5d6b88");
    sky.addColorStop(0.52, "#1d2130");
    sky.addColorStop(1, "#12141a");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // 窗在 -z：three 的 equirect 采样 u = atan2(z, x)/2π + 0.5 ⇒ -z 落在 u=0.25（画布左边 1/4 处）
    const winX = W * 0.25 - 22;
    // 圆窗那一块：冷白（月光），比白天那版暗一档、更偏蓝
    const grd = g.createRadialGradient(winX + 22, H * 0.4, 4, winX + 22, H * 0.4, 62);
    grd.addColorStop(0, "rgba(214, 228, 255, 1)");
    grd.addColorStop(0.45, "rgba(176, 198, 240, 0.5)");
    grd.addColorStop(1, "rgba(150, 172, 214, 0)");
    g.fillStyle = grd;
    g.fillRect(winX - 30, H * 0.22, 110, H * 0.32);
    g.fillStyle = "rgba(226, 236, 255, 0.92)";
    g.fillRect(winX, H * 0.31, 44, H * 0.16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function DayEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    const tex = makeDayEquirect();
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromEquirectangular(tex);
    tex.dispose();
    pmrem.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = GS_DAY.envIntensity;
    return () => {
      // ★ 只清自己写的那一份：关掉这一档之后 MagicStudy.StudyEnv 会写回夜景（同一个字段不能两个主人）
      scene.environment = null;
      scene.environmentIntensity = 1;
      rt.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** 实验档的读数：每帧累加，满 1 秒结算一次 fps 写进 GS_STATS（角标 1 秒刷新，见 gsHud）。
 *  ★ 这一段**生产构建里也要跑**（真机验收要读它），所以不再套 import.meta.env.DEV；
 *    DEV 里额外每 3 秒打一行日志、并把 splat/gl 挂到 window 上方便事后抓。 */
function GsStats({ splat }: { splat: SplatMesh }) {
  const gl = useThree((s) => s.gl);
  // ★ DEV 的读数口子（同 StudioPage 的 __r3fCapture 那条约定）：浏览器里量帧率/draw call 时
  //   控制台日志要"事后"才抓得到，把最近一次读数挂在 window 上更省事。生产构建里整段不存在。
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__gsDebug = { splat, gl };
    return () => {
      delete (window as unknown as Record<string, unknown>).__gsDebug;
    };
  }, [splat, gl]);
  const acc = useMemo(() => ({ frames: 0, t0: performance.now(), updates: 0 }), []);
  useFrame(({ gl: r }) => {
    // draw call / 三角面读的是"上一帧"的数（three 的 info 每次 render 自动归零）
    GS_STATS.calls = r.info.render.calls;
    GS_STATS.tris = r.info.render.triangles;
    // ★ 显示"真的在画几个"：截断档改的是 splat.splats.numSplats（packedSplats 里仍是文件总数）
    GS_STATS.splats = splat.splats?.getNumSplats?.() ?? splat.packedSplats?.numSplats ?? 0;
    acc.frames += 1;
    const now = performance.now();
    const dt = now - acc.t0;
    if (dt < 1000) return;
    GS_STATS.fps = (acc.frames * 1000) / dt;
    acc.frames = 0;
    acc.t0 = now;
    acc.updates += 1;
    updateGsHud();
    if (import.meta.env.DEV && acc.updates % 3 === 0) {
      console.log(
        `[gs] fps≈${GS_STATS.fps.toFixed(1)} calls=${GS_STATS.calls} tris=${GS_STATS.tris} splats=${GS_STATS.splats} load=${gsLoadMs()}ms`,
      );
    }
  });
  return null;
}

function SplatLayer() {
  // ★ 为什么是"在 effect 里建、放 state 里"而不是 useMemo：整棵树在 React.StrictMode 下会
  //   挂载 → 卸载 → 再挂载（本仓 main.tsx 就是 StrictMode）。useMemo 造的资源在第一次卸载时被
  //   cleanup 释放掉，第二次挂载拿到的还是那对**已经 dispose 过**的对象 —— 开发期表现为"splat 永远不出现"。
  //   建/释放成对放在同一个 effect 里，就能让第二份资源干净地从零开始。
  // ★ 2026-11-27（`feat/gs-scene-split`）：SparkRenderer 挪去 `GsSparkStage`（两套场景共用一台，
  //   切场景不重建）；这里只建房间这一份 SplatMesh，卸载时 dispose 它就是"释放"。
  const [splat, setSplat] = useState<SplatMesh | null>(null);
  useLayoutEffect(() => {
    const mesh = new SplatMesh({
      // ★ URL 按「画质档（refined 2M / draft 524k）」×「三档 LOD（full / 1.6 / 1.4 / 1.2）」现读，
      //   在 gsStep0.gsAssetUrl() 里（每次建 mesh 读一次 ⇒ 换档之后重新进工坊生效）。
      url: gsAssetUrl(),
      // ★ 渲染期截断只剩 dev 的 ?max= 成本对照口子（0 = 不截断）。三档 LOD 不靠截断：
      //   截尾会掉整块房间，§15 起改由均匀抽稀的独立文件实现（见 gsStep0.GS_SPLAT_TIER）。
      maxSplats: gsMaxSplats(),
      raycastable: false, // 点选只对 mesh 开 raycaster：splat 的 depthWrite=false 不会替你挡（plan §4.5）
    });
    // 验收标记（`__gsSplit.snapshot()` 的 `splatMeshes` 靠它数；Vite 会压缩类名）
    mesh.userData.gsSplat = "room";
    noteRoomSplatCreated();
    // 房间这一轮挂载的起点（sceneSplit 用来算加载耗时；真机验收的 load= 读数从此处起算）
    markRoomMounted();
    // 角标读数里这几个数不随帧变：在建模这一拍定下来（省得每帧重新解析地址栏）
    GS_STATS.cap = gsMaxSplats();
    GS_STATS.quality = gsQuality();
    GS_STATS.tier = gsSplatTier();
    GS_STATS.fill = gsFillOn();
    GS_STATS.splats = 0;
    setSplat(mesh);
    return () => {
      setSplat(null);
      mesh.dispose();
      noteRoomSplatDisposed();
      markRoomDisposed();
      // ★ 交接的另一半：房间卸掉（开大厅 / 离开工坊）→ 这一档回到 loading。
      //   ① 下一次挂载要重新计时（MatchCurtain 不会拿上一轮的 ready 当"这一次已经好了"）；
      //   ② 失败回退（failed）**不许**打回 loading —— 否则 GsStep0Environment 会再挂一次房间，
      //      形成"失败 → 重试 → 再失败"的循环。
      if (gsPhaseNow() === "ready") setGsPhase("loading");
    };
  }, []);

  useLayoutEffect(() => {
    if (!splat) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      console.warn(`[gs] ${GS_STEP0_BUDGET.timeoutMs} ms 内没就绪 → 回退今天的程序化书房`);
      markRoomFailed();
      setGsPhase("failed");
    }, GS_STEP0_BUDGET.timeoutMs);
    splat.initialized
      .then(() => {
        if (!alive) return;
        window.clearTimeout(timer);
        // ★ 实验档的高斯截断（2026-11-25 实测）：`SplatMesh({maxSplats})` 只是生成器分配容量，
        //   改它不会少画一个高斯（2M 全画，HUD / tris 都对得上）。渲染数读的是
        //   `splat.splats.numSplats` —— 改它 tris 立刻从 4.00M 掉到 1.60M（80 万档，见台账）。
        //   代价：打包数组是空间顺序，截掉尾部 = 房间少一块（那半截的后墙/窗就没了），
        //   所以这一档只用于量填充率（真机 A/B），默认 0 = 全画不截。
        const cap = gsMaxSplats();
        const loaded = splat.splats?.getNumSplats?.() ?? splat.packedSplats?.numSplats ?? 0;
        if (cap > 0 && loaded > cap && splat.splats) {
          // SplatSource 的类型没声明 numSplats，但运行时它就是 PackedSplats（有这一位，渲染数读它）
          (splat.splats as unknown as { numSplats: number }).numSplats = cap;
          console.log(`[gs] 高斯截断：${loaded} → ${cap}（成本对照档，房间会缺一块）`);
        }
        gsMarkReady(); // 真机验收要的"到 splat 出现"那一拍（与进入工坊的 mark 相减 = 首进耗时）
        // 两套场景的读数：房间这一轮真的就绪了（MatchCurtain 靠它撤黑幕）
        markRoomReady();
        console.log(`[gs] splat 就绪：${splat.packedSplats?.numSplats ?? 0} 个高斯`);
        if (import.meta.env.DEV) {
          // 落位对不对，先看这两个包围盒：原始那份应该在 Atlas 相机附近；过了 group 变换之后应该把桌面套进去
          const bb = splat.getBoundingBox();
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(...GS_STEP0_TRANSFORM.position),
            // ★ 带上 tilt（2026-11-25：这一版多了俯仰，只抄 yaw 会把包围盒算歪）
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...GS_STEP0_TRANSFORM.rotation)),
            new THREE.Vector3(GS_STEP0_TRANSFORM.scale, GS_STEP0_TRANSFORM.scale, GS_STEP0_TRANSFORM.scale),
          );
          const world = bb.clone().applyMatrix4(m);
          const f = (v: THREE.Vector3) => v.toArray().map((n) => +n.toFixed(2)).join(",");
          console.log(`[gs] bbox 原始 min(${f(bb.min)}) max(${f(bb.max)}) → 世界 min(${f(world.min)}) max(${f(world.max)})`);
        }
        setGsPhase("ready");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        window.clearTimeout(timer);
        console.warn("[gs] splat 加载失败 → 回退今天的程序化书房", err);
        markRoomFailed();
        setGsPhase("failed");
      });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [splat]);

  if (!splat) return null;
  const tf = GS_STEP0_TRANSFORM;
  return (
    <>
      {/* renderOrder 10：网格 0 / splat 10 / 玻璃与光效 20（plan §3.3-1、§4.5） */}
      <primitive object={splat} position={tf.position} rotation={tf.rotation} scale={tf.scale} renderOrder={10} />
      <GsStats splat={splat} />
    </>
  );
}

export default function GsStep0Room() {
  const gl = useThree((s) => s.gl);
  const support = useMemo(() => gsCapability(gl), [gl]);
  // ★ 小角标跟着这一档一起生灭（这一组件只在实验档且没回退时挂载）：
  //   外面没有 DOM 宿主可以放它（整棵子树在 <Canvas> 里），所以命令式挂到 body 上。
  useLayoutEffect(() => mountGsHud(), []);
  useLayoutEffect(() => {
    if (support.ok) return;
    console.warn(`[gs] WebGL 能力不够（缺 ${support.missing.join(" / ")}）→ 回退今天的程序化书房`);
    markRoomFailed();
    setGsPhase("failed");
  }, [support]);
  if (!support.ok) return null;
  return (
    <>
      <DayEnvironment />
      <SplatLayer />
      {/* ★ splat 里烘死的两把椅子在这里被剪掉（SplatEdit 盒状 SDF，见该文件头） */}
      <GsSplatCull />
    </>
  );
}
