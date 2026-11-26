// ★★ 工坊那张长桌的**唯一实现**（2026-11-26，`feat/gs-table-fire`）。
//
// 来历：这张桌子的几何与材质是从 `TableScene.tsx` 的旧实现（G4 之前那套：
// 深绿毡面 + 金线法阵/边框/角花 + 皮革软包护栏 + 深胡桃木桌沿与桌腿）里**原样搬出来**的。
// 它只被搬过一次（从 TableScene 到本文件），视觉参数一个没改 —— 改的是"尺寸从哪来"：
//  · 老场景：桌面 16×7（竖屏）/ 22×9（横屏），世界单位是"UI 画布"尺度（卡 1.1 宽、人 1.7 高、
//    桌 22 宽，三者本来就不在同一个物理尺度上）。
//  · 高斯测地场景（`metric`）：桌面 2.50（沿 z，房间纵深）× 1.17（沿 x），顶面高 0.765 m ——
//    正是 splat 点云量出来的那张桌子的尺寸/朝向。**桌面顶面仍是世界 y=0**，表体往下包。
//
// 为什么单拎出来：GS 方案 A 的 PBR 盖板（GsStep0Environment 里那张 22×9 木纹盒子）是不对的 ——
// 主人点名"桌面也不对，用原本旧场景的那张桌子"。盖板把 splat 里烘死的桌面压住的同时，也把
// 这张桌子**整块换成了另一张**；正确的做法是让这张旧桌按真实尺寸**替代** splat 桌面，
// 这样卡位/法阵/护栏都还是原来的观感。
//
// ★ 桌面光毯（lightmap）：`metric` 档在毡面上再叠一层 1024×512 的加色光毯
//   （`public/models/study/tex/table-lightmap.png`，生成脚本 `design/gen-table-lightmap.mjs`）：
//   圆窗冷光斑 + 左前壁炉暖光 + 中央法阵自发光。**它只是"烘好的光"**，不是灯：
//    · 桌面材质本身仍是**哑光**（毡面 roughness 0.72，无金属度、无环境反射），
//      桌面上不会出现镜面高光（高斯与卡牌都不喜欢）；
//    · 真正的动态火光在 `HearthFire.tsx`（点光 + 火焰着色器），那盏灯只照 mesh
//      （桌子/NPC/卡牌），splat 不吃灯 —— 见该文件头。
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";

/** 光毯贴图（1024×512，u = 桌面长轴即世界 -z，v = 桌面短轴即世界 -x）。
 *  ★ 路径在 public/models/study/tex 下（那目录本来就装桌面材质）；生成脚本在 design/ 里，
 *    改参数重跑一次就换一张，不用碰代码。 */
export const TABLE_LIGHTMAP_URL = "/models/study/tex/table-lightmap.png";

export interface WorkshopTableProps {
  /** 桌面尺寸：w = 世界 x 方向宽、d = 世界 z 方向长（两套布局共用这一份形状） */
  T: { w: number; d: number; thick: number };
  /** 桌子离地高（到桌面顶面）。缺省 = 老场景那套的隐含高度（桌腿 2.1 + 桌板 0.35，视觉上不落地） */
  height?: number;
  /** 米制装饰档：护栏/桌沿/桌腿/法阵光毯按真实桌子尺寸收细、并叠光毯 */
  metric?: boolean;
  /** splat 里烘死的那张桌子的长边（2.50 m）。给了就得把毡面之外那两截用**木端板**盖住 ——
   *  网格桌面按主人要求收短到 2.15，而点云里那张桌子仍是 2.50，不盖会在两端露出"第二张桌子" */
  splatLen?: number;
}

// ── 毡面：深绿底 + 噪点 + 金色印花（边框 / 庄家弧线 / 中央法阵 / 角花）──────
// ★ 印花按画布比例画：W=2048 时与第 3 步之前的写死值逐像素相同；米制桌用 W=1024
//   （一张 1024×2184 的贴图，比 2048×4376 省 4 倍显存/生成时间，手机上 2 px/mm 足够）。
function makeFeltCloth(T: { w: number; d: number }, metric: boolean): THREE.CanvasTexture {
  const W = metric ? 1024 : 2048;
  const H = Math.round((W * T.d) / T.w);
  const k = W / 2048; // 印花按画布宽度的统一比例缩放（2048 那一档 k=1，与旧值逐像素相同）
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#123c2a";
  ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 13;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const gold = (a: number) => `rgba(214,178,106,${a})`;
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  // 双重边框
  ctx.strokeStyle = gold(0.42);
  ctx.lineWidth = 7 * k;
  rr(52 * k, 52 * k, W - 104 * k, H - 104 * k, 46 * k);
  ctx.stroke();
  ctx.lineWidth = 2.5 * k;
  rr(84 * k, 84 * k, W - 168 * k, H - 168 * k, 34 * k);
  ctx.stroke();
  // 庄家弧线（canvas 顶部 = NPC 侧；米制桌的长轴在画布 v 方向，弧线跟着转 90°）
  ctx.strokeStyle = gold(0.34);
  ctx.lineWidth = 4 * k;
  if (metric) {
    // 长轴沿画布 y：NPC 侧 = 画布顶部。弧线改成沿长边的两条平行细线（毡面中央留白给光毯）
    ctx.beginPath();
    ctx.moveTo(W * 0.18, H * 0.06);
    ctx.quadraticCurveTo(W * 0.5, H * 0.02, W * 0.82, H * 0.06);
    ctx.stroke();
    ctx.lineWidth = 1.8 * k;
    ctx.beginPath();
    ctx.moveTo(W * 0.16, H * 0.1);
    ctx.quadraticCurveTo(W * 0.5, H * 0.06, W * 0.84, H * 0.1);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(W / 2, -H * 0.62, H * 1.02, Math.PI * 0.28, Math.PI * 0.72);
    ctx.stroke();
    ctx.lineWidth = 1.8 * k;
    ctx.beginPath();
    ctx.arc(W / 2, -H * 0.62, H * 1.12, Math.PI * 0.3, Math.PI * 0.7);
    ctx.stroke();
  }
  // 中央法阵（画布中心 = 桌面中心；光毯里还有一圈加色的，位置对得上）
  ctx.strokeStyle = gold(0.3);
  for (const [r, lw] of [
    [150 * k, 3.5 * k],
    [122 * k, 1.6 * k],
  ] as const) {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 2 * k;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(a) * 122 * k, H / 2 + Math.sin(a) * 122 * k);
    ctx.lineTo(
      W / 2 + Math.cos(a) * (i % 2 ? 138 : 150) * k,
      H / 2 + Math.sin(a) * (i % 2 ? 138 : 150) * k,
    );
    ctx.stroke();
  }
  // 四角菱花（米制桌的四角不画：桌宽 1.17 m 时角花只占 1.7 cm，糊成一块噪点，
  // 而且光毯的边光会盖住它；保留边框与中央法阵，观感更干净）
  ctx.strokeStyle = gold(0.36);
  if (!metric) {
    ctx.lineWidth = 2.5 * k;
    for (const [cx, cy] of [
      [150 * k, 150 * k],
      [W - 150 * k, 150 * k],
      [150 * k, H - 150 * k],
      [W - 150 * k, H - 150 * k],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 34 * k);
      ctx.lineTo(cx + 34 * k, cy);
      ctx.lineTo(cx, cy + 34 * k);
      ctx.lineTo(cx - 34 * k, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 9 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = metric ? 4 : 8;
  return tex;
}

function TableCloth({ T, metric }: { T: { w: number; d: number }; metric: boolean }) {
  const cloth = useMemo(() => makeFeltCloth(T, metric), [T, metric]);
  const [nor, rough] = useLoader(THREE.TextureLoader, [
    "/models/study/tex/velour_velvet_nor.jpg",
    "/models/study/tex/velour_velvet_rough.jpg",
  ]);
  const maps = useMemo(() => {
    const mk = (t: THREE.Texture) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      // 贴图密度按桌面尺寸摊：老 16×7 时是 7×3（一个重复≈2.29×2.33 世界单位）；
      // 米制桌按 1 m ≈ 7 个重复摊（与老场景同一个"每米可见细节"密度）。
      if (metric) c.repeat.set(3.5, 7.5);
      else c.repeat.set((7 * T.w) / 16, (3 * T.d) / 7);
      c.needsUpdate = true;
      return c;
    };
    return { n: mk(nor), r: mk(rough) };
  }, [nor, rough, T, metric]);
  useEffect(
    () => () => {
      cloth.dispose();
      maps.n.dispose();
      maps.r.dispose();
    },
    [cloth, maps]
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
      {/* 毡面比桌面小一圈（老 15.8×6.85 = 16-0.2 / 7-0.15，四周露出木框）；
          米制桌按同一比例：0.97×2.35（扣掉 0.1 m 木框） */}
      <planeGeometry args={[T.w - (metric ? 0.2 : 0.2), T.d - (metric ? 0.15 : 0.15)]} />
      <meshPhysicalMaterial
        map={cloth}
        normalMap={maps.n}
        roughnessMap={maps.r}
        // ★ 哑光：毡面 roughness 0.8（要求区间 0.6~0.8 的上沿）、无金属度。
        // ★ 环境反射压到 0.12：掠射角下毡面会把 PMREM 的冷天空/圆窗反射成一大片灰
        //   （验收截图里"桌面右半截发灰"就是它，物理上就是 Fresnel）。这一档本来就被要求
        //   "哑光、不要镜面反光"，所以这一位必须留着，别顺手删。
        roughness={0.78}
        metalness={0}
        // ★ 镜面压死（验收要求"桌面别出镜面反光"）：MeshPhysicalMaterial 的 specularIntensity
        //   直接缩 F0（标准材质的 F0 固定 4%，掠射角 Fresnel 会把圆窗/冷天空反射成一大块灰镜面）。
        //   0.18 ≈ 把反射压到看不见，同时保留 normal/roughness 贴图的毡面质感。
        specularIntensity={0.18}
        envMapIntensity={0.06}
      />
    </mesh>
  );
}

// ── 皮革软包护栏（赌桌围边）：米制档只留 NPC 侧长边 + 两端短边 + 四角圆球 ──────────
// ★ 2026-11-26（`feat/gs-layout-fix`）：玩家换到 **+x**（桌子长边）那一侧之后，去掉的变成 +x 那根
//   （玩家伏桌时胸会穿模）—— 上一版去掉的是 +z 短边那根。NPC 侧（−x）那根留着。
function TableRail({ T, metric, splatLen }: { T: { w: number; d: number }; metric: boolean; splatLen?: number }) {
  const [diff, nor, rough] = useLoader(THREE.TextureLoader, [
    "/models/study/tex/brown_leather_diff.jpg",
    "/models/study/tex/brown_leather_nor.jpg",
    "/models/study/tex/brown_leather_rough.jpg",
  ]);
  const mat = useMemo(() => {
    const mk = (t: THREE.Texture, srgb: boolean) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(9, 1);
      if (srgb) c.colorSpace = THREE.SRGBColorSpace;
      c.needsUpdate = true;
      return c;
    };
    return new THREE.MeshStandardMaterial({
      map: mk(diff, true),
      normalMap: mk(nor, false),
      roughnessMap: mk(rough, false),
      color: "#8a6a4a",
      roughness: 0.8,
    });
  }, [diff, nor, rough]);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.normalMap?.dispose();
      mat.roughnessMap?.dispose();
      mat.dispose();
    },
    [mat]
  );
  // 护栏半径：老桌 22 宽用 0.17；米制桌按 1/5 收（真实赌桌护栏直径 ~7 cm，0.035 m 合适）
  const R = metric ? 0.035 : 0.17;
  const y = metric ? 0.018 : 0.08;
  // 所有"伸出桌面"的量按桌宽比例收：老 0.25/0.14 是 22 宽桌面上的观感
  const out = metric ? 0.025 : 0.25;
  const capInset = metric ? 0.025 : 0.05;
  // 米制档的护栏跟着**splat 那张 2.50 长的桌面**走（网格毡面只有 2.15，两端由木端板补齐）：
  // 短边那两根落在端板外沿上，长边那根要长到端板之外，否则端板两侧会露出一截没有护栏的木边。
  const halfD = (metric ? (splatLen ?? T.d) : T.d) / 2;
  const sideLen = metric ? halfD * 2 + 0.06 : T.d + 0.1;
  return (
    <group>
      {[-halfD - capInset, halfD + capInset].map((z, i) => (
        <mesh key={i} material={mat} position={[0, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[R, R, T.w + (metric ? 0.05 : 0.5), 14]} />
        </mesh>
      ))}
      {/* 长边：米制档只留 NPC 侧（−x）那一根 */}
      {(metric ? [-T.w / 2 - out] : [-T.w / 2 - out, T.w / 2 + out]).map((x, i) => (
        <mesh key={`s${i}`} material={mat} position={[x, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[R, R, sideLen, 14]} />
        </mesh>
      ))}
      {[
        [-T.w / 2 - out, -halfD - capInset],
        [T.w / 2 + out, -halfD - capInset],
        [-T.w / 2 - out, halfD + capInset],
        [T.w / 2 + out, halfD + capInset],
      ].map(([x, z], i) => (
        <mesh key={i} material={mat} position={[x, y, z]}>
          <sphereGeometry args={[R, 12, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function CenterLine({ w, d, metric }: { w: number; d: number; metric: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (mat.current) mat.current.opacity = 0.32 + 0.16 * Math.sin(performance.now() / 700);
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
      {/* ★★ 米制档：中线**沿长边**（世界 z）—— 参考图（《金铲铲之战》对局）里分界线顺着长边走、
          把桌面分成玩家侧 / NPC 侧两半；上一版是沿短边（横着切），方向正好反了。
          plane 绕 x 转 −90° 之后 local x → 世界 x、local y → 世界 z，所以"长"的那一位写在第二个参数。
          长度取 d − 0.1（两端各留 5 cm 不顶到木沿）。 */}
      <planeGeometry args={metric ? [0.006, d - 0.1] : [w - 0.4, 0.07]} />
      <meshBasicMaterial ref={mat} color="#67e8f9" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

// ── 光毯（米制档）：1024×512 的加色贴图压在毡面上 ─────────────────────
// ★ 为什么是"另叠一层加色平面"而不是把 lightmap 当 map 盖上：
//   桌面观感 = 毡面底色 + 金色法阵；光毯只负责**加光**。当 map 会把它自己的颜色盖掉毡面，
//   当 emissiveMap 则要拆掉毡面材质另建一套（毡面的 normal/roughness 贴图就用不上了）。
//   加色层同时满足"哑光桌面"（这层没有高光）与"光毯可单独换图"（脚本重跑即可）。
// ★ UV 朝向（贴图 1024×512 的长轴 = 桌面长轴）：
//   父 group 绕 y 转 90°、子平面绕 x 转 -90° ⇒ 贴图 u 从玩家侧(+z)指向窗侧(-z)、
//   v 从桌右(+x)指向桌左(-x)。所以光毯上"窗光斑"画在 u≈0.7~0.9（远端）、
//   "炉火光"画在 v≈0.85~1（左缘）、中央法阵在 (0.5,0.5)。
function Lightmap({ w, d }: { w: number; d: number }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    const t = new THREE.TextureLoader().load(
      TABLE_LIGHTMAP_URL,
      (loaded) => {
        if (!alive) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 8;
        setTex(loaded);
      },
      undefined,
      () => {
        // 贴图缺失不该让整张桌子消失：console 一声，桌面退回纯毡面（光毯是增强项）
        console.warn("[gs] 桌面光毯没加载出来 → 只画毡面", TABLE_LIGHTMAP_URL);
      }
    );
    return () => {
      alive = false;
      t.dispose();
    };
  }, []);
  if (!tex) return null;
  return (
    <group rotation={[0, Math.PI / 2, 0]} position={[0, 0.007, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[d - 0.2, w - 0.2]} />
        {/* 加色混合、不写深度：光毯只"发光"，不遮挡毡面的金线与法阵 */}
        <meshBasicMaterial
          map={tex}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** 旧场景那张长桌（含毡面/护栏/木沿/桌腿/中线；`metric` 档再加光毯与米制收细）。 */
export default function WorkshopTable({ T, height, metric = false, splatLen }: WorkshopTableProps) {
  const thick = T.thick;
  // 米制档：桌板厚度按真实桌子（0.14）走，桌腿从桌板底落到地板；老场景保持原来的"不落地"观感。
  const legH = metric ? Math.max(0.05, (height ?? 0.765) - thick) : 2.1;
  const legTop = -thick;
  const legY = legTop - legH / 2;
  const legW = metric ? 0.06 : 0.4;
  const legInsetX = metric ? 0.1 : 0.6;
  const legInsetZ = metric ? 0.1 : 0.5;
  // ★★ 木端板（米制档）：网格毡面收短到 2.15 之后，splat 里那张 2.50 的旧桌面会在两端各露出
  //   0.175 m。两块木端板（顶面与毡面同高 y≈0）把这两截盖住 —— 观感是"一张带木框的长桌"，
  //   游戏面（毡面）就是主人要的 2.15。不盖的话 top 视图里能看见两截颜色不同的旧桌面。
  const endPlate = metric && splatLen && splatLen > T.d ? (splatLen - T.d) / 2 : 0;
  const plateZ = T.d / 2 + endPlate / 2;
  return (
    <group>
      {/* 桌体（深胡桃木） */}
      <mesh position={[0, -thick / 2, 0]} receiveShadow>
        <boxGeometry args={[T.w, thick, T.d]} />
        <meshStandardMaterial color="#241a10" roughness={0.8} />
      </mesh>
      <TableCloth T={T} metric={metric} />
      <TableRail T={T} metric={metric} splatLen={splatLen} />
      {metric && <Lightmap w={T.w} d={T.d} />}
      {/* 木端板：把 splat 里长出来的旧桌面盖住（只在 splatLen > d 时出现） */}
      {endPlate > 0 &&
        [-1, 1].map((s) => (
          <mesh key={`end${s}`} position={[0, -0.05, s * plateZ]} castShadow>
            <boxGeometry args={[T.w + 0.06, 0.1, endPlate + 0.02]} />
            <meshStandardMaterial color="#2a1d10" roughness={0.65} />
          </mesh>
        ))}
      {/* 桌沿（木质外框） */}
      {[
        [0, -T.d / 2 - (metric ? 0.03 : 0.14)],
        [0, T.d / 2 + (metric ? 0.03 : 0.14)],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, metric ? -0.03 : -0.06, z]}>
          <boxGeometry args={[T.w + (metric ? 0.06 : 0.6), metric ? 0.06 : 0.24, metric ? 0.03 : 0.3]} />
          <meshStandardMaterial color="#2a1d10" roughness={0.65} />
        </mesh>
      ))}
      {/* 长边木沿：米制档要一直铺到 splat 那张桌子的两头（否则端板两侧各缺一截） */}
      {[-T.w / 2 - (metric ? 0.03 : 0.14), T.w / 2 + (metric ? 0.03 : 0.14)].map((x, i) => (
        <mesh key={i} position={[x, metric ? -0.03 : -0.06, 0]}>
          <boxGeometry
            args={[
              metric ? 0.03 : 0.3,
              metric ? 0.06 : 0.24,
              (metric ? (splatLen ?? T.d) : T.d) + (metric ? 0.06 : 0.6),
            ]}
          />
          <meshStandardMaterial color="#2a1d10" roughness={0.65} />
        </mesh>
      ))}
      {/* 桌腿 */}
      {[
        [-T.w / 2 + legInsetX, -T.d / 2 + legInsetZ],
        [T.w / 2 - legInsetX, -T.d / 2 + legInsetZ],
        [-T.w / 2 + legInsetX, T.d / 2 - legInsetZ],
        [T.w / 2 - legInsetX, T.d / 2 - legInsetZ],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, legY, z]} castShadow>
          <boxGeometry args={[legW, legH, legW]} />
          <meshStandardMaterial color="#20160c" roughness={0.8} />
        </mesh>
      ))}
      <CenterLine w={T.w} d={T.d} metric={metric} />
    </group>
  );
}
