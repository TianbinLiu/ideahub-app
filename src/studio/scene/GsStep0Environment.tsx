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
//
// ★★ 2026-11-27（`feat/gs-scene-split`）：这一层现在按**两套场景**三态切换（判据在 sceneSplit）：
//   · 大厅 / 匹配页（未开局）= `GsLobbyScene`：只有窗景 splat + 窗框 + 窗内点光，**不挂房间**；
//   · 进房间（开局 / 正常工坊）= 房间 splat + 灯组 + 火 + 窗框，**窗洞用平贴图**（`MoonWindow splat={false}`）。
//   两套互斥挂载 → 交接时那一套整体卸载，geometry/纹理跟着 dispose（计数在 sceneSplit 里）。
import { Component, Suspense, lazy, useLayoutEffect, type ReactNode } from "react";
import * as THREE from "three";
import MagicStudy from "./MagicStudy";
import { GS_DAY, GS_FIRE, GS_FIRE_LIGHT, gsFillOn, gsMarkEntered, gsStep0On, setGsPhase, useGsPhase } from "./gsStep0";
import HearthFire from "./HearthFire";
import MoonWindow from "./MoonWindow";
import { skipIntroCam } from "./introCam";
import { skinWeight, useSkinFade, useWindowSkin, WINSKIN_SUN } from "./windowSkin";
import { markSceneKind, resolveSceneKind, type GsSceneKind } from "./sceneSplit";
import SceneSplitProbe from "./SceneSplitProbe";

const GsStep0Room = lazy(() => import("./GsStep0Room"));
/** 大厅那一套（窗景 splat + 窗框 + 窗内点光；见 GsLobbyScene 文件头）—— lazy，进房间后不下载 */
const GsLobbyScene = lazy(() => import("./GsLobbyScene"));
/** 两套场景共用的那一台 SparkRenderer（切场景时不重建：只换 SplatMesh） */
const GsSparkStage = lazy(() => import("./GsSparkStage"));

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
  // ★ 2026-11-27（`feat/gs-window-daynight`）：窗有两套装扮，屋里那盏"窗光"要跟着换。
  //   夜里的值就是 GS_DAY.sun（月光，一个数没动）；白天更暖更亮（`WINSKIN_SUN.day`）。
  //   ★ 只有 mesh（桌子 / NPC / 卡牌）会变亮 —— 墙壁是 splat，受光烘死在点云里，灯照不动它。
  //     墙上的"变亮"只能靠 WindowSkin 里那块加色亮晕，两件事分工不同，别指望这盏灯。
  const weight = skinWeight(useSkinFade(useWindowSkin()));
  const sunColor = new THREE.Color(GS_DAY.sun.color).lerp(new THREE.Color(WINSKIN_SUN.day.color), weight);
  const sunIntensity =
    GS_DAY.sun.intensity * (1 + (WINSKIN_SUN.day.intensityScale - 1) * weight);
  return (
    <>
      <directionalLight
        position={GS_DAY.sun.position}
        intensity={sunIntensity}
        color={sunColor}
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
      {/* ★★ 2026-11-27（feat/gs-moon-window）：这里原来是一盏 **RectAreaLight 窗面泛光**
          （毛玻璃那一版"一块磨砂发光面"的灯）。现在窗洞是通透的夜空 + 一轮月亮，那块漫射面没了：
          · 月光的方向与阴影仍然由上面这盏 DirectionalLight 给（"从窗那侧 -z 斜上方打进来"不变）；
          · 月亮自身的冷光在 `MoonWindow` 里用一盏**只照 mesh** 的点光补（窗内 0.36 m），
            是比 RectAreaLight 更硬一点的光池（主人第 1 条"改成更硬一点的光斑"）。
          删掉 RectAreaLight 同时省掉 `RectAreaLightUniformsLib.init()` 那条容易忘的初始化。 */}
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
export function GsStep0Environment({ sceneKind }: { sceneKind?: GsSceneKind } = {}) {
  const phase = useGsPhase();
  /**
   * 两套场景的判据（★ 由页面层传进来，这里只画、不数）：
   *   · `room` = 开着一局 / 正常工坊 → 房间 splat + 灯组 + 火 + 窗洞平贴图；
   *   · `lobby` = 大厅/匹配页 → 只挂窗景 splat + 窗框 + 窗内点光，房间那份 24.8 MB 不加载。
   *   `sceneKind` 为空时（design/ 的离线抓图页）退回上一帧 / 强制档（见 sceneSplit.resolveSceneKind）。
   */
  const kind = resolveSceneKind(sceneKind);
  // 场景档写进 sceneSplit（切档那一刻记时间、清读数；渲染期不写模块状态）
  useLayoutEffect(() => {
    markSceneKind(kind);
  }, [kind]);
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
  // 两套场景共用的每帧探针（fps / 内存 / "第一帧"读数），切场景时不重挂
  const probe = <SceneSplitProbe />;
  // ★ 两套场景共用**同一台** SparkRenderer：切场景只换 SplatMesh，渲染器不重建
  //   （重建 = 每次进来重新初始化它那套 splat pass 的纹理/program；见 GsSparkStage 文件头）
  const sparkStage = (
    <GsBoundary>
      <Suspense fallback={null}>
        <GsSparkStage />
      </Suspense>
    </GsBoundary>
  );
  // ── 大厅 / 匹配页：窗景 splat + 窗框 + 窗内点光（背景色与月光在 GsLobbyScene 里）──
  // ★ 这里**没有** `<color>` / `<fog>` / DayLights / GsStep0Room：房间那一套整棵不挂，
  //   交接时它整体卸载、SplatMesh 在自己的 cleanup 里 dispose。
  if (kind === "lobby") {
    return (
      <>
        {probe}
        {sparkStage}
        <GsBoundary>
          <Suspense fallback={null}>
            <GsLobbyScene />
          </Suspense>
        </GsBoundary>
      </>
    );
  }
  return (
    <>
      {probe}
      {sparkStage}
      <color attach="background" args={[GS_DAY.bg]} />
      <fog attach="fog" args={[GS_DAY.bg, GS_DAY.fog[0], GS_DAY.fog[1]]} />
      <DayLights />
      {/* 明月窗：夜空球 + 月亮 + 补的窗框/窗棂（2026-11-27）。几何与机位在 ./moonWindow。
          ★ `splat={false}`：房间里窗洞只放平贴图（两套装扮的 webp）——窗景 splat 只在大厅那一套里出现。 */}
      <MoonWindow splat={false} />
      <GsBoundary>
        <Suspense fallback={null}>
          <GsStep0Room />
        </Suspense>
      </GsBoundary>
    </>
  );
}
