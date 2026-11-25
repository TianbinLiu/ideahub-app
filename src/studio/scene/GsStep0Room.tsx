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
  GS_STEP0_ASSET,
  GS_STEP0_BUDGET,
  GS_STEP0_TRANSFORM,
  gsCapability,
  setGsPhase,
} from "./gsStep0";

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
    sky.addColorStop(0, "#9fc2ee");
    sky.addColorStop(0.46, "#dfe9f6");
    sky.addColorStop(0.5, "#f7eddb");
    sky.addColorStop(0.52, "#6d5d4a");
    sky.addColorStop(1, "#3a3129");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // 窗在 -z：three 的 equirect 采样 u = atan2(z, x)/2π + 0.5 ⇒ -z 落在 u=0.25（画布左边 1/4 处）
    const winX = W * 0.25 - 22;
    const grd = g.createRadialGradient(winX + 22, H * 0.4, 4, winX + 22, H * 0.4, 62);
    grd.addColorStop(0, "rgba(255, 246, 226, 1)");
    grd.addColorStop(0.45, "rgba(255, 236, 205, 0.55)");
    grd.addColorStop(1, "rgba(255, 236, 205, 0)");
    g.fillStyle = grd;
    g.fillRect(winX - 30, H * 0.22, 110, H * 0.32);
    g.fillStyle = "rgba(255, 249, 238, 0.95)";
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

/** DEV：每 3 秒把 draw call / 三角面 / 纹理数 / 帧率打一行 —— 验收清单第 3 条要的就是这几个数 */
function GsDevStats({ splat }: { splat: SplatMesh }) {
  const gl = useThree((s) => s.gl);
  // ★ DEV 的读数口子（同 StudioPage 的 __r3fCapture 那条约定）：浏览器里量帧率/draw call 时
  //   控制台日志要"事后"才抓得到，把最近一次读数挂在 window 上更省事。生产构建里整段不存在。
  useLayoutEffect(() => {
    (window as unknown as Record<string, unknown>).__gsDebug = { splat, gl };
    return () => {
      delete (window as unknown as Record<string, unknown>).__gsDebug;
    };
  }, [splat, gl]);
  const acc = useMemo(() => ({ frames: 0, t0: performance.now(), last: "" }), []);
  useFrame(({ gl: r }) => {
    acc.frames += 1;
    const now = performance.now();
    if (now - acc.t0 < 3000) return;
    const fps = (acc.frames * 1000) / (now - acc.t0);
    const info = r.info;
    acc.last = `fps≈${fps.toFixed(1)} calls=${info.render.calls} tris=${info.render.triangles} tex=${info.memory.textures} splats=${splat.packedSplats?.numSplats ?? 0}`;
    console.log(`[gs] ${acc.last}`);
    acc.frames = 0;
    acc.t0 = now;
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
      url: GS_STEP0_ASSET,
      maxSplats: GS_STEP0_BUDGET.maxSplats,
      raycastable: false, // 点选只对 mesh 开 raycaster：splat 的 depthWrite=false 不会替你挡（plan §4.5）
    });
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
        console.log(`[gs] splat 就绪：${splat.packedSplats?.numSplats ?? 0} 个高斯`);
        if (import.meta.env.DEV) {
          // 落位对不对，先看这两个包围盒：原始那份应该在 Atlas 相机附近；过了 group 变换之后应该把桌面套进去
          const bb = splat.getBoundingBox();
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(...GS_STEP0_TRANSFORM.position),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, GS_STEP0_TRANSFORM.rotation[1], 0)),
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
      {import.meta.env.DEV && <GsDevStats splat={objs.splat} />}
    </>
  );
}

export default function GsStep0Room() {
  const gl = useThree((s) => s.gl);
  const support = useMemo(() => gsCapability(gl), [gl]);
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
