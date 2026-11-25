// ★ 高斯泼溅第 0 步的"轻"那一半（它自己会 import spark，所以别放在这里）：
//   · `GsTableCover` —— 方案 A 的 PBR 盖板（顶面 y=0、外扩 2 mm·单位、往下包 0.5 单位）
//   · `DayLights`    —— 白天一档：带影 DirectionalLight（管窗光与影）+ RectAreaLight（管窗面泛光）
//   · `GsStep0Environment` —— 三态切换：关着/失败 = 今天的书房七件；开着 = splat 房间（懒加载）+ 白天灯组
//
// 为什么"splat 那一半"必须懒加载：`@sparkjsdev/spark` 打进来是 16 MB 的解包体积，而这一档默认关。
// 用 `lazy(() => import("./GsStep0Room"))` 之后它只是主包旁边一个**永远不会被请求**的 chunk ——
// 正式体验的加载体积一个字节都不变（构建里能看到单独的 GsStep0Room-*.js）。
import { Component, Suspense, lazy, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { sceneLayout } from "./layout";
import { useIsLandscape } from "../../hooks/useIsLandscape";
import MagicStudy from "./MagicStudy";
import { GS_DAY, gsFillOn, gsMarkEntered, gsStep0On, setGsPhase, useGsPhase } from "./gsStep0";

const GsStep0Room = lazy(() => import("./GsStep0Room"));

/** 今天的房间 + 灯组（2026-11-25 之前 TableScene 顶部那六行，逐字搬过来，一个数没改） */
function LegacyRoom() {
  return (
    <>
      <color attach="background" args={["#05070f"]} />
      <fog attach="fog" args={["#05070f", 16, 40]} />
      <ambientLight intensity={0.2} color="#aab6ff" />
      <directionalLight position={[3, 9, -6]} intensity={0.32} color="#7f9dff" />
      <pointLight position={[0, 4.6, 0.6]} intensity={13} color="#ffd9a8" decay={1.9} />
      <pointLight position={[0, 2.4, -1.8]} intensity={11} color="#8fb8ff" decay={1.9} />
      <MagicStudy />
    </>
  );
}

// ── 白天一档的光 ─────────────────────────────────────────
// ★ 只照到 mesh：SparkRenderer 的是 ShaderMaterial，three 只给"要灯"的材质上传灯光 uniform（plan §3.3-2）。
//   所以桌面盖板与卡牌的亮度要**对着 splat 校**，不要靠加灯（加灯只会让网格更亮、splat 不动）。
function DayLights() {
  const rect = useRef<THREE.RectAreaLight>(null);
  useLayoutEffect(() => {
    // ★ RectAreaLight 在 WebGL 下不 init 就是黑的（plan §4.4）；不 init 也会静默不亮，最难查
    void import("three/examples/jsm/lights/RectAreaLightUniformsLib.js").then((m) => {
      m.RectAreaLightUniformsLib.init();
      rect.current?.lookAt(0, 0, 0);
    });
  }, []);
  return (
    <>
      <directionalLight
        position={GS_DAY.sun.position}
        intensity={GS_DAY.sun.intensity}
        color={GS_DAY.sun.color}
        castShadow
        // 阴影框只框"窗 + 桌面"那一块：框整间房 = 把有限的阴影像素摊薄，窗棂的影就没了（plan §4.4）
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-left={-13.5}
        shadow-camera-right={13.5}
        shadow-camera-top={9.5}
        shadow-camera-bottom={-9.5}
        shadow-camera-near={1}
        shadow-camera-far={40}
      />
      <rectAreaLight
        ref={rect}
        position={GS_DAY.window.position}
        width={GS_DAY.window.width}
        height={GS_DAY.window.height}
        intensity={GS_DAY.window.intensity}
        color="#eaf2ff"
      />
      {/* ★ NPC 补光：从相机这一侧（+z）略高处往桌子对面打，参数与依据见 gsStep0.GS_DAY.fill。
          无阴影（不写 castShadow）= 不会多出一条影子；强度 0.9 明显低于主光 2.4，
          窗光仍然是唯一"有方向"的主光。dev 的 ?gs=1&nofill=1 不挂它（A/B 对照）。 */}
      {gsFillOn() && (
        <directionalLight position={GS_DAY.fill.position} intensity={GS_DAY.fill.intensity} color={GS_DAY.fill.color} />
      )}
    </>
  );
}

// ── 方案 A 的桌面盖板 ────────────────────────────────────
/** 可重复的伪随机（同一个种子每次刷新画出一模一样的木纹，截图对比才有意义） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 木纹 albedo（1024²，板缝沿长轴 X ⇒ 纹理里是横向板带；repeat.set(2,1) 见下） */
function drawWood(g: CanvasRenderingContext2D, S: number): void {
  const rand = lcg(20261125);
  g.fillStyle = "#8d6340";
  g.fillRect(0, 0, S, S);
  let y = 0;
  while (y < S) {
    const h = 0.055 * S + rand() * 0.035 * S; // 60~90 px 那一档
    g.fillStyle = `rgba(${(150 + rand() * 26) | 0},${(105 + rand() * 20) | 0},${(64 + rand() * 16) | 0},0.5)`;
    g.fillRect(0, y, S, h);
    // 年轮：沿板长的细条带（正弦 + 每行错相，避免像直尺）
    for (let i = 0; i < 18; i++) {
      const yy = y + rand() * h;
      g.strokeStyle = `rgba(${(66 + rand() * 40) | 0},${(42 + rand() * 26) | 0},${(24 + rand() * 16) | 0},${0.05 + rand() * 0.1})`;
      g.lineWidth = 0.8 + rand() * 2;
      g.beginPath();
      for (let x = 0; x <= S; x += 10) {
        const dy = Math.sin(x / (40 + rand() * 20) + rand() * 0.02) * (1.5 + rand() * 2.5);
        if (x === 0) g.moveTo(x, yy + dy);
        else g.lineTo(x, yy + dy);
      }
      g.stroke();
    }
    // 板缝（一条深色线，下缘再压一道亮点当倒角）
    g.fillStyle = "rgba(30, 19, 11, 0.8)";
    g.fillRect(0, y + h - 1.6, S, 1.6);
    g.fillStyle = "rgba(255, 239, 214, 0.07)";
    g.fillRect(0, y + h, S, 1);
    y += h;
  }
  // 节疤：三处同心椭圆
  for (let k = 0; k < 3; k++) {
    const cx = rand() * S;
    const cy = rand() * S;
    for (let r = 16; r > 2; r -= 3) {
      g.strokeStyle = `rgba(52, 32, 18, ${0.1 + (16 - r) * 0.012})`;
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(cx, cy, r * 1.7, r, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

/** 由 albedo 的亮度算 normal（灰度 Sobel → 法线，plan §4.3 第 3 条），强度 0.35 */
function normalFrom(lum: Float32Array, S: number): THREE.DataTexture {
  const out = new Uint8Array(S * S * 4);
  const at = (x: number, y: number) => lum[((y + S) % S) * S + ((x + S) % S)];
  const k = 0.35 * 6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * k;
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * k;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      out[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** 桌面盖板：顶面 y=0，比桌面外扩 0.04 单位、往下包 0.5 单位（≈6 cm 厚的桌板）。见 plan §4.2 方案 A。 */
export function GsTableCover() {
  const T = sceneLayout(useIsLandscape()).table;
  const maps = useMemo(() => {
    const S = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    if (!g) return null;
    drawWood(g, S);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 1); // 木纹沿长轴 X 走两遍；v 方向一遍，板缝密度才对得上桌面宽度
    map.anisotropy = 4;
    // 512² 的亮度图拿来算 normal：1024² 全套会多占一倍显存，桌面斜看这点起伏 512 就够
    const N = 512;
    const lum = new Float32Array(N * N);
    const px = g.getImageData(0, 0, S, S).data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const si = ((y * 2) * S + x * 2) * 4;
        lum[y * N + x] = (px[si] * 0.299 + px[si + 1] * 0.587 + px[si + 2] * 0.114) / 255;
      }
    }
    return { map, normal: normalFrom(lum, N) };
  }, []);
  useLayoutEffect(() => {
    if (!maps) return;
    return () => {
      maps.map.dispose();
      maps.normal.dispose();
    };
  }, [maps]);
  if (!maps) return null;
  return (
    <mesh position={[0, -0.25, 0]} receiveShadow castShadow>
      <boxGeometry args={[T.w + 0.04, 0.5, T.d + 0.04]} />
      <meshStandardMaterial
        map={maps.map}
        normalMap={maps.normal}
        normalScale={new THREE.Vector2(0.35, 0.35)}
        roughness={0.62}
        metalness={0}
        envMapIntensity={0.5}
      />
    </mesh>
  );
}

/** splat 子树自己的兜底：正常加载失败走 `initialized` 的 reject，这里接"同步抛错/渲染期出错"那一种 */
class GsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[gs] splat 子树抛错 → 回退今天的程序化书房", err);
    setGsPhase("failed");
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 房间/灯/桌面这一块的三态入口（TableScene 只写这一行） */
export function GsStep0Environment() {
  const phase = useGsPhase();
  // 真机验收要的"从进入工坊到 splat 出现"：这一组件随 TableScene 挂载，从这里开始计时
  //（懒加载的 spark chunk、29.8 MiB 的 spz 下载都算在里面）。只在这一档开着时打。
  useLayoutEffect(() => {
    if (gsStep0On()) gsMarkEntered();
  }, []);
  if (!gsStep0On() || phase === "off" || phase === "failed") return <LegacyRoom />;
  return (
    <>
      <color attach="background" args={[GS_DAY.bg]} />
      <fog attach="fog" args={[GS_DAY.bg, GS_DAY.fog[0], GS_DAY.fog[1]]} />
      <DayLights />
      <GsBoundary>
        <Suspense fallback={null}>
          <GsStep0Room />
        </Suspense>
      </GsBoundary>
    </>
  );
}
