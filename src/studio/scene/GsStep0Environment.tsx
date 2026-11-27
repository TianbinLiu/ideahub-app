// ★ 高斯泼溅第 0 步的"轻"那一半（它自己会 import spark，所以别放在这里）：
//   · `DayLights`    —— 米制的一档灯：带影 DirectionalLight（管窗光与影）+ RectAreaLight（管窗面泛光）
//                      + NPC 补光 + **壁炉真火（HearthFire：点光 + 噪声火焰 + 假光池）**
//   · `GsStep0Environment` —— 三态切换：关着/失败 = 今天的书房七件；开着 = splat 房间（懒加载）+ 灯组
//
// ★★ 2026-11-26（`feat/gs-table-fire`）：桌面盖板 `GsTableCover` 已删除，桌面改由
//   `WorkshopTable`（旧场景那张长桌）按米制尺寸 2.50×1.17 渲染，随 `GsStep0Environment` 的开关
//   在 TableScene 里二选一。这里不再画任何桌面 —— 房间/灯/火归这一档，桌子归 TableScene 的
//   `<WorkshopTable metric />`（把"桌面尺寸"留在一处，别两个地方各画一半）。
//
// 为什么"splat 那一半"必须懒加载：`@sparkjsdev/spark` 打进来是 16 MB 的解包体积，而这一档默认关。
// 用 `lazy(() => import("./GsStep0Room"))` 之后它只是主包旁边一个**永远不会被请求**的 chunk ——
// 正式体验的加载体积一个字节都不变（构建里能看到单独的 GsStep0Room-*.js）。
import { Component, Suspense, lazy, useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import MagicStudy from "./MagicStudy";
import { GS_DAY, GS_FIRE, GS_FIRE_LIGHT, gsFillOn, gsMarkEntered, gsStep0On, setGsPhase, useGsPhase } from "./gsStep0";
import HearthFire from "./HearthFire";
import { skipIntroCam } from "./introCam";

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

// ── 一档灯（米制：1 世界单位 = 1 米，数值见 gsStep0.GS_DAY 的注释）──────────
// ★ 只照到 mesh：SparkRenderer 的是 ShaderMaterial，three 只给"要灯"的材质上传灯光 uniform（plan §3.3-2）。
//   所以桌面、卡牌、NPC 的亮度要**对着 splat 校**，不要靠加灯（加灯只会让网格更亮、splat 不动）。
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
        // ★ 米制之后桌面 + NPC 只占 ±2 m 左右，阴影框从 ±13.5/±9.5 收到 ±2.4/±1.8 ——
        //   同样 2048² 的阴影图，每米分到的像素多了 6 倍，窗棂影从"糊"变成"看得出格子"。
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.008}
        shadow-camera-left={-2.4}
        shadow-camera-right={2.4}
        shadow-camera-top={1.8}
        shadow-camera-bottom={-1.8}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
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
          无阴影（不写 castShadow）= 不会多出一条影子；强度 0.9 与主光同档，
          窗光仍然是唯一"有方向"的主光。dev 的 ?gs=1&nofill=1 不挂它（A/B 对照）。 */}
      {gsFillOn() && (
        <directionalLight position={GS_DAY.fill.position} intensity={GS_DAY.fill.intensity} color={GS_DAY.fill.color} />
      )}
      {/* ★★ 真火（2026-11-26，方案 A）：壁炉炉膛的程序化火焰 + 闪烁点光 + 假光池。
          位置/颜色/强度全在 gsStep0.GS_FIRE_LIGHT（由落位常量现算，别在这里手抄坐标）。
          ★ 这盏光只照 mesh（桌子 / NPC / 卡牌）；splat 的墙不吃灯，别指望调它能"把墙照亮"
            （见 HearthFire.tsx 文件头的 ★★ 光照边界）。 */}
      {GS_FIRE && (
        <HearthFire
          position={GS_FIRE_LIGHT.position}
          color={GS_FIRE_LIGHT.color}
          baseIntensity={GS_FIRE_LIGHT.intensity}
          distance={GS_FIRE_LIGHT.distance}
          decay={GS_FIRE_LIGHT.decay}
          floorY={-0.785}
        />
      )}
    </>
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

/** 房间/灯/火这一块的三态入口（TableScene 只写这一行） */
export function GsStep0Environment() {
  const phase = useGsPhase();
  // 真机验收要的"从进入工坊到 splat 出现"：这一组件随 TableScene 挂载，从这里开始计时
  //（懒加载的 spark chunk、31/8 MiB 的 spz 下载都算在里面）。只在这一档开着时打。
  //
  // ★★ 2026-11-26（`feat/gs-perf-fire`，真机验收"load 恒为 -"）：依赖数组**不能带 phase**。
  //   这一组件不会重新挂载，phase 在 splat 就绪时 loading→ready；带 phase 的时候这个 effect
  //   会再跑一遍，调 gsMarkEntered() 把 GS_LOAD.ready 清零 —— HUD 的 load 从此恒为 "-"。
  //   计时要的是"这一次进工坊"，所以只在挂载时记一次。
  useLayoutEffect(() => {
    if (!gsStep0On()) return;
    gsMarkEntered();
  }, []);
  // ★ 米制档跳过开场运镜：introCam 的起点是旧尺度（从高处/远处俯冲），米制房间里会从房顶外
  //   飞进来。终点机位是 defaultCamFor 现算的（GS_CAM），不播开场就直接落在正确机位上。
  //   失败回退（failed）不跳：那一屏回到旧场景，旧开场运镜照旧。skipIntroCam 自身幂等，
  //   phase 翻转时重复调用无害（这就是它不跟计时那个 effect 共用的原因）。
  useLayoutEffect(() => {
    if (!gsStep0On() || phase === "failed") return;
    skipIntroCam();
  }, [phase]);
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
