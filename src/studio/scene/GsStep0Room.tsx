// ★ 高斯泼溅第 0 步的"重"那一半：SparkRenderer + SplatMesh（懒加载）。
//   TableScene 只在 `GsStep0Environment` 判定为"开着且没失败"时才 import 到这里，
//   默认关的正式体验连这个 chunk 都不会下载（构建产物里是 GsStep0Room-*.js）。
//
// 三条不能忘的坑（docs/gs-step0-plan.md §3.3）：
//   ① splat 默认 transparent、depthWrite=false —— 它挡不住之后画的透明物，谁先谁后只看 renderOrder。
//      这里的队伍写死：网格 0 / splat 10 / 玻璃与光效 20。
//   ② splat 不吃灯：DirectionalLight / RectAreaLight 只照桌面与卡牌（见 GsStep0Environment.DayLights）。
//   ③ 一个 Canvas 只能有一个 SparkRenderer：它按帧把场景里所有 SplatMesh 收进自己那个 mesh 里画。
import { useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
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
  gsQuality,
  setGsPhase,
} from "./gsStep0";
import { GS_STATS, mountGsHud, updateGsHud } from "./gsHud";

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

function SplatLayer({ gl }: { gl: THREE.WebGLRenderer }) {
  // ★ 为什么是"在 effect 里建、放 state 里"而不是 useMemo：整棵树在 React.StrictMode 下会
  //   挂载 → 卸载 → 再挂载（本仓 main.tsx 就是 StrictMode）。useMemo 造的资源在第一次卸载时被
  //   cleanup 释放掉，第二次挂载拿到的还是那对**已经 dispose 过**的对象 —— 开发期表现为"splat 永远不出现"。
  //   建/释放成对放在同一个 effect 里，就能让第二份资源干净地从零开始。
  const [objs, setObjs] = useState<{ spark: SparkRenderer; splat: SplatMesh } | null>(null);
  useLayoutEffect(() => {
    const spark = new SparkRenderer({ renderer: gl });
    const splat = new SplatMesh({
      // ★ 两档高斯（refined 2M / draft 524k）走同一个开关，URL 在 gsStep0.gsAssetUrl() 里现读
      //   （每次建 mesh 读一次 ⇒ 换档之后重新进工坊生效，见那里的注释）。
      url: gsAssetUrl(),
      // ★ 这一档的高斯上限：设置页临时选 `全部` / 80 万（真机 A/B），dev 还能用 ?max= 覆盖。
      //   在 effect 里现读而不是渲染期读：换档之后重新进工坊才会建新 mesh（这就是量两档的方式）。
      maxSplats: gsMaxSplats(),
      raycastable: false, // 点选只对 mesh 开 raycaster：splat 的 depthWrite=false 不会替你挡（plan §4.5）
    });
    // 角标读数里这两个数不随帧变：在建模这一拍定下来（省得每帧重新解析地址栏）
    GS_STATS.cap = gsMaxSplats();
    GS_STATS.quality = gsQuality();
    GS_STATS.fill = gsFillOn();
    GS_STATS.splats = 0;
    setObjs({ spark, splat });
    return () => {
      setObjs(null);
      splat.dispose();
      spark.dispose();
    };
  }, [gl]);

  useLayoutEffect(() => {
    if (!objs) return;
    const { splat } = objs;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      console.warn(`[gs] ${GS_STEP0_BUDGET.timeoutMs} ms 内没就绪 → 回退今天的程序化书房`);
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
        setGsPhase("failed");
      });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [objs]);

  if (!objs) return null;
  const tf = GS_STEP0_TRANSFORM;
  return (
    <>
      <primitive object={objs.spark} />
      {/* renderOrder 10：网格 0 / splat 10 / 玻璃与光效 20（plan §3.3-1、§4.5） */}
      <primitive object={objs.splat} position={tf.position} rotation={tf.rotation} scale={tf.scale} renderOrder={10} />
      <GsStats splat={objs.splat} />
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
    setGsPhase("failed");
  }, [support]);
  if (!support.ok) return null;
  return (
    <>
      <DayEnvironment />
      <SplatLayer gl={gl} />
    </>
  );
}
