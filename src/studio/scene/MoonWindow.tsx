// ★★ 明月窗的 3D 那一半（2026-11-27，`feat/gs-moon-window`）—— **只留窗框那一套几何**。
//
// ★ 2026-11-27（`feat/gs-window-daynight`）这个文件被拆过一次：
//   "窗里该放什么"（夜空球 / 月亮盘 / 两套贴图 / 两套 splat / 墙面亮晕 / 窗光）搬到了
//   `WindowSkin.tsx`；这里**只剩窗框 / 内亮边 / 十字棂 / 圆钉 / 铆钉**。
//   ★ 那一套几何**一个数都没改**（主人："窗框 / 内亮边 / 十字棂 / 圆钉 / 铆钉一律不动"），
//     拆出去只是为了让"两套装扮"能整体换掉而不碰到它们 —— 顺带也让 diff 能一眼看出没动。
//
// 三条实现要点（全是"为什么这么画"的坑，原样保留）：
//   ① **毛玻璃在 splat 里抠不掉**，所以不是"删掉玻璃"，而是**用窗景盖住窗洞**：
//      窗景各层都在**透明队列**里、`renderOrder` 排在 splat（10）之后，片元里再做一次
//      "窗洞视锥"裁剪。splat 没有 depthWrite ⇒ 窗景能盖住磨砂玻璃；
//      桌子 / NPC 有深度 ⇒ 窗景被它们挡住（`depthTest: true`）。
//   ② 窗景**不是**全屏叠加：`depthTest` 必须开着。关掉的话，桌子后面那些"穿过窗洞方向"的
//      像素会被涂掉（看起来像桌子被挖了一块）。
//   ③ 窗框 / 窗棂也必须在**透明队列**里（renderOrder 22/23）：Spark 的 splat 不写深度、
//      而且是在不透明物体之后画的 —— 放在不透明队列里的窗框会被磨砂亮边整个盖住
//      （2026-11-27 第一版就是这样，截图里窗框只剩两条细弧）。窗棂必须最后画，
//      它才能压在月亮上；`depthTest` 仍保留，桌子 / NPC 在窗前时照样挡住它。
import * as THREE from "three";
import { WINDOW } from "./moonGeometry";
import WindowLook from "./WindowLook";
import { skinWeight, useSkinFade, useWindowSkin } from "./windowSkin";

/** 十字窗棂往室内偏的距离（m）：穿窗时相机先掠过棂条、后到窗面 —— 那一下正好落在黑幕开始
 *  淡入之后，不会在画面上出现"一根黑条闪一帧"。 */
const BARS_INSET = 0.03;

interface Props {
  /** 窗洞里放不放**窗景 splat**（12 万点的 `window-*.spz`）。
   *  ★ 2026-11-27（`feat/gs-scene-split`）：只有**大厅/匹配页**那一套挂 splat（视差在那儿才看得到）；
   *    进房间之后主人拍板"窗洞改用平贴图"—— 房间那一档传 `false`，连 spz 都不请求。 */
  splat?: boolean;
}

export default function MoonWindow({ splat = true }: Props) {
  // 装扮（day / night）由设备本地时间决定，交叉淡入 0.8 s（判定与曲线都在 windowSkin.ts）
  const skin = useWindowSkin();
  const weight = skinWeight(useSkinFade(skin));

  const [wx, wy, wz] = WINDOW.center;
  return (
    <>
      {/* 窗里的两套装扮 + 窗光（2026-11-27 拆出去的，见文件头） */}
      <WindowLook weight={weight} splat={splat} />

      {/* ── 窗框 / 窗棂：透明队列 + renderOrder 22/23，压在墙与窗景之上 ── */}
      <group position={[wx, wy, wz]}>
        {/* 外框：0.45（窗洞）~0.58 m。略往室内 4 mm，免得与 splat 窗面 z-fighting。 */}
        <mesh position={[0, 0, 0.004]} renderOrder={22}>
          <ringGeometry args={[WINDOW.radius, WINDOW.frameOuter, 96, 1]} />
          <meshStandardMaterial
            color="#221b16"
            roughness={0.62}
            metalness={0.35}
            side={THREE.DoubleSide}
            transparent
            depthWrite={false}
          />
        </mesh>
        {/* 内圈亮边：窗光打在窗框内侧的那一道（很细，不给它加灯） */}
        <mesh position={[0, 0, 0.006]} renderOrder={23}>
          <ringGeometry args={[WINDOW.radius, WINDOW.radius + 0.012, 96, 1]} />
          <meshBasicMaterial color="#9db6d8" transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* 十字棂：0.9 m 长、16 mm 粗；往室内偏 3 cm（穿窗时先掠过它，见 BARS_INSET） */}
        <mesh position={[0, 0, BARS_INSET]} renderOrder={22}>
          <boxGeometry args={[0.016, WINDOW.radius * 2, 0.016]} />
          <meshStandardMaterial color="#1a1512" roughness={0.82} metalness={0.1} transparent depthWrite={false} />
        </mesh>
        <mesh position={[0, 0, BARS_INSET]} renderOrder={22}>
          <boxGeometry args={[WINDOW.radius * 2, 0.016, 0.016]} />
          <meshStandardMaterial color="#1a1512" roughness={0.82} metalness={0.1} transparent depthWrite={false} />
        </mesh>
        {/* 棂条交点上的小圆钉（纯装饰，让"窗棂"读得出是窗而不是一块玻璃） */}
        <mesh position={[0, 0, BARS_INSET + 0.004]} renderOrder={23}>
          <sphereGeometry args={[0.026, 12, 8]} />
          <meshStandardMaterial color="#2c241c" roughness={0.45} metalness={0.5} transparent depthWrite={false} />
        </mesh>
        {/* 窗框上的 4 颗铆钉（0.45 m 圆周四等分）：给内圈一点节奏 */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.515, Math.sin(a) * 0.515, 0.012]} renderOrder={23}>
              <sphereGeometry args={[0.016, 10, 8]} />
              <meshStandardMaterial color="#3a3026" roughness={0.4} metalness={0.5} transparent depthWrite={false} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}
