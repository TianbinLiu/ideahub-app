// ★★ 大厅 / 匹配页那一套（2026-11-27，`feat/gs-scene-split`）—— **懒加载**。
//
// 里面只有三样东西（主人这一轮点名）：
//   ① 窗景 splat（`WindowSplat`，12 万点的 `window-*.spz`）—— 视差从这里来；
//   ② 窗框 / 内亮边 / 十字棂 / 圆钉 / 铆钉（`MoonWindow` 的那一套几何，一个数没动）；
//   ③ 窗内点光（在 `WindowLook` 里，跟着装扮换颜色/强度）。
//
// ★ **不挂房间那份 1.6M spz**：进大厅不再需要等 24.8 MB。桌子 / NPC / 火 / 灯组也不在这棵子树里
//   —— 匹配页机位在窗前 1.6 m 朝窗看，它们本来就在相机背后（不挂 = 少一份 decode 与每帧开销）。
// ★ 背景色与那盏方向光只服务"窗框要看得见"：窗框是 MeshStandardMaterial，没有灯会是一圈黑；
//   方向光与房间那一盏同方向同色（月光从窗外打进来），但**不投影**——这里没有可投影的墙。
//   窗洞里的亮光来自 `WindowLook`：夜空球 / 月盘 / 平贴图，都不是灯。
// ★ SparkRenderer 不在这里（两套场景共用 `GsSparkStage` 那一台）：本组件只挂窗景 mesh。
import { GS_DAY } from "./gsStep0";
import MoonWindow from "./MoonWindow";

export default function GsLobbyScene() {
  return (
    <>
      <color attach="background" args={[GS_DAY.bg]} />
      {/* 只照窗框的一盏月光（与房间那盏同参数；不投影 = 不建 2048² 阴影图） */}
      <directionalLight position={GS_DAY.sun.position} intensity={GS_DAY.sun.intensity} color={GS_DAY.sun.color} />
      {/* 窗景 splat + 窗框 + 窗内点光（`WindowLook` 里） */}
      <MoonWindow splat />
    </>
  );
}
