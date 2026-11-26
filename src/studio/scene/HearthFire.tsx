// ★★ 壁炉真火（2026-11-26，`feat/gs-table-fire`，方案 A 的核心之一）
//
// 三件东西：
//   ① **点光源**：暖色、带轻微闪烁（多频正弦叠加，不是随机跳变——随机跳会在低帧率下读成"坏灯"），
//      位置 = 壁炉炉膛（由 gsStep0 的 ANCHOR.fire 经落位常量现算，**别手抄坐标**）；
//   ② **火焰动画**：程序化噪声 shader（自定义 ShaderMaterial + fbm，火焰向上卷动），
//      不是静态图、也不是 3~4 帧循环贴图 —— 噪声 shader 不占贴图内存、可以按炉膛尺寸自由缩放，
//      而且"上卷 + 边缘抖动"是序列贴图做不出来的连续感；
//   ③ **假光池**：炉前地面一块加色渐变形（splat 不吃灯，地面上不会自己亮起来），
//      外加炉口一层柔光。这是"让火在 splat 房间里看起来照到了东西"的唯一办法。
//
// ★★ 所有火焰/光晕网格都必须 `renderOrder={20}`：SparkRenderer 是**透明**材质、renderOrder=10，
//   不写这一位的话火焰（透明、默认 0）会先画，splat 再整片糊上来 —— 验收第一版"壁炉里看不见火"
//   就是这个原因（不是位置错、也不是 shader 没跑）。渲染顺序的约定见 GsStep0Room 文件头。
//
// ★★ 光照边界（别以后有人以为火对墙也生效）：
//   高斯泼溅用的是 ShaderMaterial，three 只给**需要灯**的材质上传灯光 uniform —— 所以这盏
//   点光只照到 mesh：桌子、NPC、卡牌、法阵。**splat 的墙/窗/地板一个像素都不会变亮。**
//   火光"落在桌沿、照到 NPC 侧脸"是 mesh 真实受光；"照到墙"是假的，靠光毯 + 假光池补，
//   别为了"墙也暖一点"去调灯强 —— 那只会让桌子和人过曝，墙照样是冷的。
//
// ★ 数值是米制的（1 世界单位 = 1 m）：点光离桌沿约 0.9 m、离 NPC 约 1.9 m，
//   intensity 4.2 / distance 5.5 / decay 2 ⇒ 桌沿照度 ≈ 4.2/0.81 ≈ 5，NPC 侧 ≈ 1.2；
//   验收截图（`docs/gs-table-light-log.md`）里桌沿的暖边与 NPC 左肩的暖光就是这两个数。
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

/** 火焰片的高度/宽度（m）。★★ 2026-11-26 第 2 版（`feat/gs-layout-fix`）：**0.30 × 0.42**。
 *  上一版 0.38 × 0.55 是按"炉膛开口 0.55 × 0.42"给的，结果火舌比炉口还高 —— 而且锚点在
 *  炉膛**外面**（火焰从地板上舔起来，看着像浮在壁炉前面）。这一版：锚点 = 炉膛内**木柴堆的
 *  上表面**（gsStep0.ANCHOR.fire），高度 0.42 按炉口内净高给，宽度 0.30 只占炉口的一半。 */
const FLAME_W = 0.3;
const FLAME_H = 0.42;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 火焰片：teardrop 轮廓 × 上卷的 fbm；加色混合（黑=透明）。
// 颜色从底部暗红（0.9,0.22,0.04）→ 中段橙（1.0,0.45,0.10）→ 顶部黄白（1.0,0.9,0.62）。
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime;
    // vertical scroll plus a low-frequency sway: the tongue leans but never leaves the core
    vec2 q = vec2(uv.x * 3.2, uv.y * 2.4 - t * 1.9);
    float sway = fbm(vec2(uv.y * 2.0 - t * 0.7, t * 0.45)) - 0.5;
    float n = fbm(q + vec2(sway * 1.1, 0.0) + fbm(q * 1.7) * 0.55);
    // silhouette: a teardrop that narrows upwards; closed at the base, tapered at the tip
    float x = (uv.x - 0.5 + sway * 0.08 * uv.y) * 2.0;
    float halfW = mix(0.62, 0.18, pow(uv.y, 0.8));
    float body = smoothstep(halfW, halfW * 0.18, abs(x))
               * smoothstep(0.0, 0.10, uv.y)
               * smoothstep(1.0, 0.62, uv.y);
    float a = body * smoothstep(0.30, 0.78, n) * 1.5;
    vec3 col = mix(vec3(0.85, 0.16, 0.03), vec3(1.0, 0.46, 0.10), smoothstep(0.15, 0.62, uv.y));
    col = mix(col, vec3(1.0, 0.86, 0.55), smoothstep(0.55, 0.95, uv.y) * smoothstep(0.55, 0.9, n));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

export interface HearthFireProps {
  /** ★ 锚点 = **炉膛内木柴堆的上表面**（火焰的底边就落在这里）。
   *  上一版这个点是"炉心"（火焰片的中心），火焰因此一半在地板下、一半在炉口外；
   *  这一版把它定义成"火从哪烧起来"，火焰/点光/光晕/光池四样都从这个点现算。 */
  position: [number, number, number];
  color?: string;
  baseIntensity?: number;
  distance?: number;
  decay?: number;
  /** 地面高度（假光池贴地；米制场景是 -0.785） */
  floorY?: number;
}

/** 一块径向渐变加色贴图（炉口柔光 / 地面光池共用） */
function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const rg = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.45, outer);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function HearthFire({
  position,
  color = "#ff9a4a",
  baseIntensity = 4.2,
  distance = 5.5,
  decay = 2,
  floorY = -0.775,
}: HearthFireProps) {
  const { camera } = useThree();
  const light = useRef<THREE.PointLight>(null);
  const billboard = useRef<THREE.Group>(null);
  const flameMat = useRef<THREE.ShaderMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSeed: { value: 3.17 } }), []);
  const [px, py, pz] = position;

  // 炉口柔光（竖直片，贴在火焰后面）+ 地面光池（贴地），两张都是加色
  const glowTex = useMemo(() => glowTexture("rgba(255,170,90,0.95)", "rgba(255,90,20,0.35)"), []);
  const poolTex = useMemo(() => glowTexture("rgba(255,140,60,0.55)", "rgba(255,80,16,0.18)"), []);
  useEffect(
    () => () => {
      glowTex.dispose();
      poolTex.dispose();
    },
    [glowTex, poolTex]
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // 多频正弦：7.3 Hz 的火舌主频 + 2.1 Hz 的"呼吸" + 23.7 Hz 的细碎抖动。
    // 幅度 22%：再大就是警灯，再小看不出"活"（真机 60fps 下量过）。
    const flick = 0.78 + 0.22 * (0.5 + 0.5 * (0.62 * Math.sin(t * 7.3) + 0.26 * Math.sin(t * 2.1 + 1.7) + 0.12 * Math.sin(t * 23.7 + 0.3)));
    if (light.current) {
      light.current.intensity = baseIntensity * flick;
      // 炉心轻微跳动（±2.5 cm）：只动灯，火焰片不动 —— 两者一起动会像整团火在平移。
      // 灯比锚点再高一点（0.12）：挪到柴堆上方，桌沿吃到的暖边才和火舌的位置一致。
      light.current.position.set(px + Math.sin(t * 3.1) * 0.025, py + 0.12 + Math.sin(t * 5.7) * 0.02, pz + Math.cos(t * 4.3) * 0.025);
    }
    if (flameMat.current) flameMat.current.uniforms.uTime.value = t;
    // 火焰片绕 y 轴面向相机（只转 y：转 x 会让火焰"躺下"，看着像烧到桌面上）
    if (billboard.current) {
      billboard.current.rotation.y = Math.atan2(camera.position.x - px, camera.position.z - pz);
    }
    if (glowMat.current) glowMat.current.opacity = 0.55 + 0.25 * flick;
  });

  return (
    <group>
      {/* ① 点光：只照 mesh（见文件头 ★★）。castShadow 不开：炉膛在画面左侧边缘，
          阴影贴图那点预算对桌面几乎不可见，却要给每个 mesh 材质多上传一遍 shadow map。 */}
      <pointLight
        ref={light}
        position={[px, py + 0.12, pz]}
        color={color}
        intensity={baseIntensity}
        distance={distance}
        decay={decay}
      />
      {/* ② 火焰：一块 0.30×0.42 m 的面向相机的噪声火焰片 + 一层更小的内焰
          ★ billboard 的**原点就是火苗底边**（= 木柴堆上表面）：子片从原点往上长，
            所以组的位置要抬 FLAME_H/2 让底边正好落在锚点上。
          ★ 绕 y 转的是这一组自己；把锚点坐标写进子节点再绕原点转，火焰会绕着世界原点甩出去。 */}
      <group ref={billboard} position={[px, py + FLAME_H / 2, pz]}>
        <mesh renderOrder={20}>
          <planeGeometry args={[FLAME_W, FLAME_H]} />
          <shaderMaterial
            ref={flameMat}
            uniforms={uniforms}
            vertexShader={VERT}
            fragmentShader={FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* 内焰：同一条 shader、更小更亮（共享 uniforms，省一份时间 uniform） */}
        <mesh renderOrder={20} position={[0, -0.03, 0.005]} scale={[0.55, 0.55, 1]}>
          <planeGeometry args={[FLAME_W, FLAME_H]} />
          <shaderMaterial
            uniforms={uniforms}
            vertexShader={VERT}
            fragmentShader={FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* 炉口柔光：比火焰大一圈的暖光晕（splat 的炉膛是烘死的暗色，这一层让它"亮起来"）。
            ★ 这一版**跟着火焰一起缩到 1.6 倍**（原来 2.6 倍 = 1.0×1.2 m，比炉口还大，
              看上去像炉子前面挂了一团光）。 */}
        <mesh renderOrder={20} position={[0, 0.02, -0.01]} scale={[1.6, 1.5, 1]}>
          <planeGeometry args={[FLAME_W, FLAME_H]} />
          <meshBasicMaterial
            ref={glowMat}
            map={glowTex}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      {/* ③ 地面假光池：splat 地板不吃灯，这一块加色椭圆让炉前"有被照亮的意思"。
          位置**留在炉前地面**（锚点往房间里挪 0.35 m）：它代表的是地面上被火照亮的那一块。 */}
      <mesh renderOrder={20} rotation={[-Math.PI / 2, 0, 0]} position={[px + 0.35, floorY + 0.004, pz - 0.1]}>
        <planeGeometry args={[1.5, 1.1]} />
        <meshBasicMaterial
          map={poolTex}
          transparent
          opacity={0.6}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
