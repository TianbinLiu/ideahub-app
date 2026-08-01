// 卡片工坊 3D 场景：长桌 + 中线 + NPC 铸卡师 + 卡组 + 市场平摊 + 节点链 + 拖拽层。
// 固定机位只露出双方手部/上身与桌面（NPC 不建头部模型）。
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { ThreeEvent, advance, useFrame, useLoader, useThree } from "@react-three/fiber";
import { NodeSlot } from "../../types";
import { activePath, chosenProposal, composable, placeholderVisible, useStudio, Flight } from "../studioStore";
import {
  CARD,
  CHAIN,
  COMPOSE_POS,
  DECK_CAM,
  DECK_POS,
  DEFAULT_CAM,
  FLOAT_Y,
  LEFT_STACK,
  MARKET,
  SPREAD,
  TABLE,
  chainX,
  focusCam,
} from "./layout";
import { npcModelUrl } from "../quality";

// 购入模型 Milltina（默认铸卡师）的配置（模块级常量：内联对象会让 TripoNpc 的 memo 每帧重建）
// FBX 静止姿势是 T-pose；轴向实测：x−=垂臂（z 是水平前摆别用），微量 z 让手贴身
const MILLTINA_CFG = {
  scale: 3.35,
  y: -2.55,
  z: -4.3,
  yaw: 0,
  pose: {
    lArm: [-1.15, 0, 0.12] as [number, number, number],
    rArm: [-1.15, 0, -0.12] as [number, number, number],
  },
  // 双马尾/牛耳/缎带/前发弹簧物理（骨链名匹配，忽略大小写与符号）
  springs: ["twintail", "cowear", "ribbon", "fronthair"],
  // 白发白裙在烛光暗房过亮：暖灰乘暗；浅色模型描边用固定深紫黑
  look: { tint: 0xbfb2a4, outlineColor: 0x2a2230 },
  // 她的眼睑妆重——半眯基线调低（0.22 会像厚眼影）
  blinkBase: 0.05,
  // 俯身滑移：Q 版站位靠后，前移 0.45 让胸口落上桌沿
  leanSlide: { z: 0.45, y: -0.02 },
};
const MILLTINA_MORPHS = { blink: "vrc.blink ", mouthOpen: "vrc.v_aa", smile: "eye_joy" };
import {
  cardBackTexture,
  cardFaceTexture,
  labelTexture,
  placeholderTexture,
  proposalTexture,
  ringTexture,
} from "./cardTexture";
import CardMesh from "./CardMesh";
import MagicStudy from "./MagicStudy";
import VrmNpc from "./VrmNpc";
import TripoNpc from "./TripoNpc";
import PlayerArms from "./PlayerArms";

// 默认 = 全身版（站立↔对话俯身状态机，用户定稿）；?npc=tripo 早期全身试验版 / ?npc=vrm 回退 VRM
const NPC_VARIANT = new URLSearchParams(window.location.search).get("npc") ?? "full";
const USE_TRIPO_NPC = NPC_VARIANT === "tripo" || NPC_VARIANT === "full";

// ── 节点链布局：窗口化，溢出的最早节点收到左侧堆 ──────────────
export interface ChainLayout {
  items: Array<{ node: NodeSlot; x: number | null; stackIndex: number }>;
  placeholderX: number | null;
}

export function computeChain(root: NodeSlot | null): ChainLayout {
  const path = activePath(root);
  const ph = placeholderVisible(root);
  const total = path.length + (ph ? 1 : 0);
  const start = Math.max(0, total - CHAIN.maxVisible);
  return {
    items: path.map((node, i) => ({
      node,
      x: i < start ? null : chainX(i - start),
      stackIndex: i,
    })),
    placeholderX: ph ? chainX(path.length - start) : null,
  };
}

// ── 相机：朝目标位姿缓动（transient 直读 store，避免订阅延迟一帧） ──
// RIG_LOOK 提到模块级：自由视角手势（TableCatcher）平移相机时需同步平移视线锚点
const RIG_LOOK = new THREE.Vector3(...DEFAULT_CAM.look);
function CameraRig() {
  const tmp = useRef(new THREE.Vector3());
  const deckAnim = useRef<{ p: number; start: THREE.Vector3 } | null>(null);
  const prevDeck = useRef(false);
  const lastCamObj = useRef<unknown>(null);
  useFrame(({ camera }, dt) => {
    const st = useStudio.getState();
    // 自由视角：rig 停止驱动（手势直接挪相机）；任何交互 action 设了新机位对象 → 纠正镜头退出
    if (st.freeCam) {
      if (lastCamObj.current === st.camera) {
        prevDeck.current = st.deckView;
        return;
      }
      useStudio.setState({ freeCam: false });
    }
    lastCamObj.current = st.camera;
    const target = st.camera.kind === "default" ? DEFAULT_CAM : st.camera;
    // 手机竖屏（aspect<0.62）垂直 FOV 固定→水平视野变窄→卡组机位下人脸过大：自动后撤一档
    const narrowPull =
      st.deckView && (camera as THREE.PerspectiveCamera).aspect < 0.62 ? -0.3 : 0;
    if (st.deckView && !prevDeck.current) {
      deckAnim.current = { p: 0, start: camera.position.clone() };
    }
    prevDeck.current = st.deckView;
    if (!st.deckView) deckAnim.current = null;
    const anim = deckAnim.current;
    if (anim && st.deckView) {
      // 滑梯运镜：头顶起点 → 左外侧高点拉远 → 左前低点收进 → 悬停在玩家前方桌沿高度。
      // 三次贝塞尔，全程 lookAt 玩家；quintic 缓动 + 控制点收拢 = 起段旋转平缓不晕
      anim.p = Math.min(1, anim.p + dt / 3.0);
      const p = anim.p * anim.p * anim.p * (anim.p * (anim.p * 6 - 15) + 10);
      const P0 = anim.start;
      const [ex, ey, ez] = DECK_CAM.pos;
      const c1x = -2.8;
      const c1y = Math.max(3.2, P0.y * 0.5);
      const c1z = 3.9;
      const c2x = -2.3;
      const c2y = 0.9;
      const c2z = 3.9;
      const u = 1 - p;
      const bez = (a: number, b: number, c: number, d: number) =>
        u * u * u * a + 3 * u * u * p * b + 3 * u * p * p * c + p * p * p * d;
      camera.position.set(
        bez(P0.x, c1x, c2x, ex),
        bez(P0.y, c1y, c2y, ey),
        bez(P0.z, c1z, c2z, ez + narrowPull),
      );
      RIG_LOOK.lerp(tmp.current.set(...DECK_CAM.look), Math.min(1, p * 2.4));
      camera.lookAt(RIG_LOOK);
      if (anim.p >= 1) deckAnim.current = null;
      return;
    }
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(tmp.current.set(target.pos[0], target.pos[1], target.pos[2] + narrowPull), k);
    RIG_LOOK.lerp(tmp.current.set(...target.look), k);
    camera.lookAt(RIG_LOOK);
  });
  return null;
}

// ── 桌子与环境 ───────────────────────────────────────────────
// ── 赌桌绒呢桌布：深绿毡面 + 噪点 + 金色印花（边框/庄家弧线/中央法阵/角花） ──
function makeFeltCloth(): THREE.CanvasTexture {
  const W = 2048;
  const H = 896;
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
  ctx.lineWidth = 7;
  rr(52, 52, W - 104, H - 104, 46);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  rr(84, 84, W - 168, H - 168, 34);
  ctx.stroke();
  // 庄家弧线（canvas 顶部 = NPC 侧）
  ctx.strokeStyle = gold(0.34);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W / 2, -H * 0.62, H * 1.02, Math.PI * 0.28, Math.PI * 0.72);
  ctx.stroke();
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(W / 2, -H * 0.62, H * 1.12, Math.PI * 0.3, Math.PI * 0.7);
  ctx.stroke();
  // 中央法阵
  ctx.strokeStyle = gold(0.3);
  for (const [r, lw] of [
    [150, 3.5],
    [122, 1.6],
  ] as const) {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(a) * 122, H / 2 + Math.sin(a) * 122);
    ctx.lineTo(W / 2 + Math.cos(a) * (i % 2 ? 138 : 150), H / 2 + Math.sin(a) * (i % 2 ? 138 : 150));
    ctx.stroke();
  }
  // 四角菱花
  ctx.strokeStyle = gold(0.36);
  ctx.lineWidth = 2.5;
  for (const [cx, cy] of [
    [150, 150],
    [W - 150, 150],
    [150, H - 150],
    [W - 150, H - 150],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 34);
    ctx.lineTo(cx + 34, cy);
    ctx.lineTo(cx, cy + 34);
    ctx.lineTo(cx - 34, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function TableCloth() {
  const cloth = useMemo(() => makeFeltCloth(), []);
  const [nor, rough] = useLoader(THREE.TextureLoader, [
    "/models/study/tex/velour_velvet_nor.jpg",
    "/models/study/tex/velour_velvet_rough.jpg",
  ]);
  const maps = useMemo(() => {
    const mk = (t: THREE.Texture) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(7, 3);
      c.needsUpdate = true;
      return c;
    };
    return { n: mk(nor), r: mk(rough) };
  }, [nor, rough]);
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
      <planeGeometry args={[15.8, 6.85]} />
      <meshStandardMaterial map={cloth} normalMap={maps.n} roughnessMap={maps.r} />
    </mesh>
  );
}

// ── 皮革软包护栏（赌桌围边）：四边圆柱 + 四角圆球 ──────────────
function TableRail() {
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
  const R = 0.17;
  const y = 0.08;
  return (
    <group>
      {[-TABLE.d / 2 - 0.05, TABLE.d / 2 + 0.05].map((z, i) => (
        <mesh key={i} material={mat} position={[0, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[R, R, TABLE.w + 0.5, 14]} />
        </mesh>
      ))}
      {[-TABLE.w / 2 - 0.25, TABLE.w / 2 + 0.25].map((x, i) => (
        <mesh key={i} material={mat} position={[x, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[R, R, TABLE.d + 0.1, 14]} />
        </mesh>
      ))}
      {[
        [-TABLE.w / 2 - 0.25, -TABLE.d / 2 - 0.05],
        [TABLE.w / 2 + 0.25, -TABLE.d / 2 - 0.05],
        [-TABLE.w / 2 - 0.25, TABLE.d / 2 + 0.05],
        [TABLE.w / 2 + 0.25, TABLE.d / 2 + 0.05],
      ].map(([x, z], i) => (
        <mesh key={i} material={mat} position={[x, y, z]}>
          <sphereGeometry args={[R, 12, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function Table() {
  return (
    <group>
      {/* 桌体（深胡桃木） */}
      <mesh position={[0, -TABLE.thick / 2, 0]}>
        <boxGeometry args={[TABLE.w, TABLE.thick, TABLE.d]} />
        <meshStandardMaterial color="#241a10" roughness={0.8} />
      </mesh>
      <TableCloth />
      <TableRail />
      {/* 桌沿（木质外框） */}
      {[
        [0, -TABLE.d / 2 - 0.14],
        [0, TABLE.d / 2 + 0.14],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, -0.06, z]}>
          <boxGeometry args={[TABLE.w + 0.6, 0.24, 0.3]} />
          <meshStandardMaterial color="#2a1d10" roughness={0.65} />
        </mesh>
      ))}
      {[-TABLE.w / 2 - 0.14, TABLE.w / 2 + 0.14].map((x, i) => (
        <mesh key={i} position={[x, -0.06, 0]}>
          <boxGeometry args={[0.3, 0.24, TABLE.d + 0.6]} />
          <meshStandardMaterial color="#2a1d10" roughness={0.65} />
        </mesh>
      ))}
      {/* 桌腿 */}
      {[
        [-TABLE.w / 2 + 0.6, -TABLE.d / 2 + 0.5],
        [TABLE.w / 2 - 0.6, -TABLE.d / 2 + 0.5],
        [-TABLE.w / 2 + 0.6, TABLE.d / 2 - 0.5],
        [TABLE.w / 2 - 0.6, TABLE.d / 2 - 0.5],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, -1.35, z]}>
          <boxGeometry args={[0.4, 2.1, 0.4]} />
          <meshStandardMaterial color="#20160c" />
        </mesh>
      ))}
      <CenterLine />
    </group>
  );
}

function CenterLine() {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (mat.current) mat.current.opacity = 0.32 + 0.16 * Math.sin(performance.now() / 700);
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
      <planeGeometry args={[TABLE.w - 0.4, 0.07]} />
      <meshBasicMaterial ref={mat} color="#67e8f9" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

// ── 合成按钮（中线右端的发光圆台） ────────────────────────────
function ComposePad() {
  const root = useStudio((s) => s.root);
  const composing = useStudio((s) => s.composing);
  const enabled = composable(root) && !composing;
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!mat.current) return;
    mat.current.emissiveIntensity = enabled ? 0.5 + 0.25 * Math.sin(performance.now() / 350) : 0.08;
  });
  const labelMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: labelTexture("合成视频"), transparent: true, depthWrite: false }),
    []
  );
  useEffect(() => () => labelMat.dispose(), [labelMat]);
  return (
    <group
      position={COMPOSE_POS}
      onClick={(e) => {
        e.stopPropagation();
        if (enabled) void useStudio.getState().composeNow();
      }}
    >
      <mesh>
        <cylinderGeometry args={[0.42, 0.5, 0.1, 28]} />
        <meshStandardMaterial ref={mat} color={enabled ? "#7c5c12" : "#2a3350"} emissive="#fbbf24" emissiveIntensity={0.1} />
      </mesh>
      {/* 俯视机位：标签平贴桌面更易读 */}
      <mesh position={[-0.2, 0.015, 0.82]} rotation={[-Math.PI / 2, 0, 0]} material={labelMat}>
        <planeGeometry args={[1.35, 0.34]} />
      </mesh>
    </group>
  );
}

// ── NPC 铸卡师：躯干 + 程序化双臂（无头部） ───────────────────
function placeBone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, dir: THREE.Vector3) {
  dir.subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}
const UP = new THREE.Vector3(0, 1, 0);

function Npc() {
  const torso = useRef<THREE.Group>(null);
  const lUpper = useRef<THREE.Mesh>(null);
  const lFore = useRef<THREE.Mesh>(null);
  const rUpper = useRef<THREE.Mesh>(null);
  const rFore = useRef<THREE.Mesh>(null);
  const lHand = useRef<THREE.Mesh>(null);
  const rHand = useRef<THREE.Mesh>(null);
  // 对话视角：躯干前倾（慵懒）、整体下沉
  const dialogLean = useStudio((s) => s.dialogView && !s.market.open);
  const cur = useRef({
    lH: new THREE.Vector3(-0.95, 0.2, -3.05),
    rH: new THREE.Vector3(0.95, 0.2, -3.05),
    lE: new THREE.Vector3(-1.1, 0.9, -3.4),
    rE: new THREE.Vector3(1.1, 0.9, -3.4),
  });
  const tmp = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3(), e: new THREE.Vector3(), d: new THREE.Vector3() });

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const { market, dialog, dialogView } = useStudio.getState();
    const wob = dialog.busy ? Math.sin(t * 7) * 0.12 : 0;
    const lazy = dialogView && !market.open && !dialog.busy;
    let lT: [number, number, number];
    let rT: [number, number, number];
    // 手肘显式目标：慵懒姿态双肘搭在桌面；其余姿态用中点外扩公式
    let lET: [number, number, number] | null = null;
    let rET: [number, number, number] | null = null;
    if (dialog.busy) {
      lT = [-0.6, 1.3 + wob, -2.9];
      rT = [0.6, 1.3 - wob, -2.9];
    } else if (market.open) {
      // 摊完卡后双手扶在两侧桌沿，不遮挡卡面
      lT = [-1.95, 0.3, -2.5];
      rT = [1.95, 0.3, -2.5];
    } else if (lazy) {
      // 慵懒对坐：左手肘撑桌、小臂立起托着推荐卡下缘；右小臂搭在桌面自己身前
      lT = [-0.5, 1.12 + Math.sin(t * 1.1) * 0.02, -3.3];
      rT = [0.6, 0.14, -2.3];
      lET = [-0.98, 0.16, -3.05];
      rET = [0.95, 0.15, -3.0];
    } else {
      lT = [-0.8, 0.18 + Math.sin(t * 1.3) * 0.03, -2.55];
      rT = [0.8, 0.18 + Math.cos(t * 1.15) * 0.03, -2.55];
    }
    const k = 1 - Math.exp(-dt * 5);
    const { a, b, e, d } = tmp.current;
    cur.current.lH.lerp(a.set(...lT), k);
    cur.current.rH.lerp(a.set(...rT), k);
    if (torso.current) torso.current.position.y = Math.sin(t * 1.2) * (lazy ? 0.015 : 0.03);

    const shY = lazy ? 0.98 : 1.08;
    const shZ = lazy ? -3.5 : -3.72;
    // 左臂
    a.set(-0.68, shY, shZ);
    if (lET) e.set(...lET);
    else {
      e.copy(a).add(cur.current.lH).multiplyScalar(0.5);
      e.x -= 0.42;
      e.y += 0.12;
    }
    cur.current.lE.lerp(e, k);
    if (lUpper.current) placeBone(lUpper.current, a, cur.current.lE, d);
    b.copy(cur.current.lH);
    if (lFore.current) placeBone(lFore.current, cur.current.lE, b, d);
    if (lHand.current) lHand.current.position.copy(b);
    // 右臂
    a.set(0.68, shY, shZ);
    if (rET) e.set(...rET);
    else {
      e.copy(a).add(cur.current.rH).multiplyScalar(0.5);
      e.x += 0.42;
      e.y += 0.12;
    }
    cur.current.rE.lerp(e, k);
    if (rUpper.current) placeBone(rUpper.current, a, cur.current.rE, d);
    b.copy(cur.current.rH);
    if (rFore.current) placeBone(rFore.current, cur.current.rE, b, d);
    if (rHand.current) rHand.current.position.copy(b);
  });

  const sleeve = "#1f2a47";
  const glove = "#3b4a77";
  const torsoY = dialogLean ? 0.38 : 0.55;
  const torsoZ = dialogLean ? -3.9 : -4.05;
  return (
    <group>
      <group ref={torso}>
        {/* 躯干（无头、纤细）：贴着桌面远边缘；对话时前倾下沉，只露胸部以上 */}
        <mesh position={[0, torsoY, torsoZ]} rotation={[dialogLean ? 0.3 : 0, 0, 0]} scale={[0.98, 1, 0.68]}>
          <capsuleGeometry args={[0.62, 0.95, 4, 14]} />
          <meshStandardMaterial color="#1c2745" roughness={0.7} />
        </mesh>
        {/* 双肩（窄肩） */}
        <mesh position={[-0.68, dialogLean ? 0.98 : 1.08, dialogLean ? -3.5 : -3.72]}>
          <sphereGeometry args={[0.19, 14, 14]} />
          <meshStandardMaterial color={sleeve} />
        </mesh>
        <mesh position={[0.68, dialogLean ? 0.98 : 1.08, dialogLean ? -3.5 : -3.72]}>
          <sphereGeometry args={[0.19, 14, 14]} />
          <meshStandardMaterial color={sleeve} />
        </mesh>
        {/* 胸前徽记（微仰角） */}
        <mesh position={[0, dialogLean ? 0.82 : 0.95, dialogLean ? -3.36 : -3.55]} rotation={[-0.6, 0, 0]}>
          <circleGeometry args={[0.15, 24]} />
          <meshStandardMaterial color="#0b1020" emissive="#67e8f9" emissiveIntensity={1.6} />
        </mesh>
      </group>
      <mesh ref={lUpper}>
        <cylinderGeometry args={[0.11, 0.125, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={lFore}>
        <cylinderGeometry args={[0.09, 0.11, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={rUpper}>
        <cylinderGeometry args={[0.11, 0.125, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={rFore}>
        <cylinderGeometry args={[0.09, 0.11, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={lHand}>
        <sphereGeometry args={[0.13, 14, 14]} />
        <meshStandardMaterial color={glove} />
      </mesh>
      <mesh ref={rHand}>
        <sphereGeometry args={[0.13, 14, 14]} />
        <meshStandardMaterial color={glove} />
      </mesh>
    </group>
  );
}

// ── 用户侧前臂（画面底部入镜） ────────────────────────────────
function StaticBone({
  a,
  b,
  r,
  color,
}: {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  color: string;
}) {
  const { mid, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(vb, va);
    const l = dir.length();
    return {
      mid: new THREE.Vector3().addVectors(va, vb).multiplyScalar(0.5),
      quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()),
      len: l,
    };
  }, [a, b]);
  return (
    <mesh position={mid} quaternion={quat} scale={[1, len, 1]}>
      <cylinderGeometry args={[r, r * 1.25, 1, 12]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

// 玩家手臂：Tripo 3D 形象（男/女可选），加载失败/未就绪时回退旧程序化双手
function PlayerHandsSwitch() {
  const avatar = useStudio((s) => s.playerAvatar);
  return (
    <Suspense fallback={<UserHands />}>
      <PlayerArms avatar={avatar} />
    </Suspense>
  );
}

function UserHands() {
  return (
    <group>
      <StaticBone a={[-1.45, -0.7, 5.3]} b={[-1.0, 0.06, 3.6]} r={0.26} color="#26334f" />
      <StaticBone a={[1.45, -0.7, 5.3]} b={[1.0, 0.06, 3.6]} r={0.26} color="#26334f" />
      <mesh position={[-1.0, 0.1, 3.5]}>
        <sphereGeometry args={[0.27, 16, 16]} />
        <meshStandardMaterial color="#d4a97c" roughness={0.6} />
      </mesh>
      <mesh position={[1.0, 0.1, 3.5]}>
        <sphereGeometry args={[0.27, 16, 16]} />
        <meshStandardMaterial color="#d4a97c" roughness={0.6} />
      </mesh>
    </group>
  );
}

// ── 卡组（堆叠；空组只剩虚位标记） ────────────────────────────
function DeckStack() {
  const deck = useStudio((s) => s.deck);
  const backMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: cardBackTexture(), transparent: true, side: THREE.DoubleSide }),
    []
  );
  const markerMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: ringTexture("#475569"), transparent: true, side: THREE.DoubleSide });
    m.opacity = 0.55;
    return m;
  }, []);
  const shown = Math.min(deck.length, 24);
  // 复用同一材质只换 map，避免随 deck.length 反复新建材质
  const countMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }), []);
  countMat.map = labelTexture(`卡组 ${deck.length}`, "#e2e8f0");
  useEffect(() => {
    const mats = [backMat, markerMat, countMat];
    return () => mats.forEach((m) => m.dispose());
  }, [backMat, markerMat, countMat]);
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        // 点卡组：进入卡组浏览视角（镜头拍玩家思考 + 投影横滑）
        useStudio.getState().openDeckView();
      }}
    >
      {/* 卡组虚位标记 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[DECK_POS[0], 0.009, DECK_POS[2]]} material={markerMat}>
        <planeGeometry args={[CARD.w * 1.1, CARD.h * 1.08]} />
      </mesh>
      {Array.from({ length: shown }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, ((i * 37) % 11) * 0.012 - 0.06]}
          position={[DECK_POS[0], 0.012 + i * 0.014, DECK_POS[2]]}
          material={backMat}
        >
          <planeGeometry args={[CARD.w, CARD.h]} />
        </mesh>
      ))}
      <mesh position={[DECK_POS[0], 0.12, DECK_POS[2] - 0.62]} rotation={[-Math.PI / 2, 0, 0]} material={countMat}>
        <planeGeometry args={[1.1, 0.3]} />
      </mesh>
    </group>
  );
}

// ── 卡组展开排（供浏览/拖拽/点选） ────────────────────────────
const dragState = { x: 0, z: 0, startX: 0, startZ: 0, moved: false };

function DeckSpread() {
  const deck = useStudio((s) => s.deck);
  const open = useStudio((s) => s.spreadOpen);
  const center = useStudio((s) => s.spreadCenter);
  if (!open || deck.length === 0) return null;
  const start = Math.min(Math.max(0, center - 2), Math.max(0, deck.length - SPREAD.maxVisible));
  const visible = deck.slice(start, start + SPREAD.maxVisible);
  return (
    <group>
      {visible.map((card, i) => {
        const idx = start + i;
        const isCenter = idx === center;
        const x = SPREAD.centerX + (i - (visible.length - 1) / 2) * SPREAD.dx;
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            from={DECK_POS}
            target={[x, isCenter ? 0.16 : 0.04 + i * 0.012, SPREAD.z + (isCenter ? 0.1 : 0)]}
            scale={isCenter ? 1.07 : 0.98}
            hoverLift
            onPointerDown={(e) => {
              e.stopPropagation();
              dragState.startX = e.point.x;
              dragState.startZ = e.point.z;
              dragState.x = e.point.x;
              dragState.z = e.point.z;
              dragState.moved = false;
              useStudio.getState().setDrag(card.id);
            }}
          />
        );
      })}
    </group>
  );
}

// ── 拖拽层：卡片跟随指针，松手落在空白卡位上则入槽 ─────────────
function DragLayer() {
  const dragCardId = useStudio((s) => s.dragCardId);
  const deck = useStudio((s) => s.deck);
  const root = useStudio((s) => s.root);
  const card = deck.find((c) => c.id === dragCardId) ?? null;
  const ghost = useRef<THREE.Group>(null);

  const phX = computeChain(root).placeholderX;

  useEffect(() => {
    if (!dragCardId) return;
    const onUp = () => {
      const st = useStudio.getState();
      const id = st.dragCardId;
      if (!id) return;
      const nearPlaceholder =
        phX != null && Math.abs(dragState.x - phX) < 1.0 && Math.abs(dragState.z - CHAIN.rowZ) < 1.2;
      if (dragState.moved && nearPlaceholder && phX != null) {
        const cam = focusCam(phX, CHAIN.rowZ);
        st.dropOnPlaceholder(id, cam.pos, cam.look);
      } else if (!dragState.moved) st.pickDeckCard(id);
      st.setDrag(null);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [dragCardId, phX]);

  useFrame(() => {
    if (ghost.current) {
      ghost.current.position.set(dragState.x, 0.45, dragState.z);
      ghost.current.rotation.z = (dragState.x - dragState.startX) * -0.06;
    }
  });

  if (!card) return null;
  return (
    <group>
      {/* 捕获指针移动的隐形平面 */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.3, 0]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          dragState.x = e.point.x;
          dragState.z = e.point.z;
          if (Math.hypot(e.point.x - dragState.startX, e.point.z - dragState.startZ) > 0.25) dragState.moved = true;
        }}
      >
        <planeGeometry args={[TABLE.w + 6, TABLE.d + 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={ghost}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CARD.w, CARD.h]} />
          <meshBasicMaterial map={cardFaceTexture(card)} transparent opacity={0.92} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

// ── 市场平摊（NPC 侧一排扑克式摊开） ──────────────────────────
function MarketFan() {
  const market = useStudio((s) => s.market);
  const detail = useStudio((s) => s.marketDetail);
  if (!market.open) return null;
  return (
    <group>
      {market.items.map((card, i) => {
        // 竖屏视野窄：两排各 perRow 张
        const row = Math.floor(i / MARKET.perRow);
        const col = i % MARKET.perRow;
        const rowCount = Math.min(MARKET.perRow, market.items.length - row * MARKET.perRow);
        const x = (col - (rowCount - 1) / 2) * MARKET.dx;
        const z = MARKET.rowsZ[Math.min(row, MARKET.rowsZ.length - 1)];
        const cam = focusCam(x, z);
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            from={[0.9, 0.9, -3.2]}
            target={[x, MARKET.lift + i * 0.004, z]}
            rotZ={(col - (rowCount - 1) / 2) * -0.04}
            hoverLift
            ring={detail?.id === card.id ? "#fbbf24" : null}
            onClick={(e) => {
              e.stopPropagation();
              useStudio.getState().viewMarketCard(card, cam.pos, cam.look);
            }}
          />
        );
      })}
    </group>
  );
}

// ── 节点链：光束 + 节点卡（收起/展开三方案）+ 虚线空白卡位 ─────
function Beam({ x1, x2, z }: { x1: number; x2: number; z: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (mat.current) mat.current.opacity = 0.4 + 0.3 * Math.sin(performance.now() / 320);
  });
  const len = Math.max(0.08, x2 - x1 - CARD.w + 0.15);
  return (
    <mesh position={[(x1 + x2) / 2, 0.018, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[len, 0.13]} />
      <meshBasicMaterial ref={mat} color="#67e8f9" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function Placeholder({ x }: { x: number }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: placeholderTexture(), transparent: true, side: THREE.DoubleSide }),
    []
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    mat.opacity = 0.6 + 0.3 * Math.sin(performance.now() / 520);
    const m = ref.current;
    if (!m) return;
    // 聚焦占位卡（编辑投影打开）时悬浮
    const st = useStudio.getState();
    const floating = st.focus != null && st.focus.nodeId === null && st.projection != null;
    const targetY = floating ? FLOAT_Y : CARD.lift;
    m.position.y += (targetY - m.position.y) * (1 - Math.exp(-dt * 9));
    m.position.x = x;
  });
  return (
    <mesh
      ref={ref}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[x, CARD.lift, CHAIN.rowZ]}
      material={mat}
      onClick={(e) => {
        e.stopPropagation();
        const cam = focusCam(x, CHAIN.rowZ);
        useStudio.getState().focusPlaceholder(cam.pos, cam.look);
      }}
    >
      <planeGeometry args={[CARD.w, CARD.h]} />
    </mesh>
  );
}

function NodeChainView() {
  const root = useStudio((s) => s.root);
  const focus = useStudio((s) => s.focus);
  const projection = useStudio((s) => s.projection);
  const layout = computeChain(root);
  const visibleXs: number[] = [];

  const cards: ReactNode[] = [];
  let stackCount = 0;
  layout.items.forEach(({ node, x }) => {
    const chosen = chosenProposal(node);
    if (x == null) {
      // 左侧收起堆
      if (chosen) {
        const y = 0.012 + stackCount * 0.02;
        cards.push(
          <CardMesh
            key={node.id}
            tex={proposalTexture(chosen)}
            target={[LEFT_STACK[0], y, LEFT_STACK[2]]}
            rotZ={stackCount * 0.05 - 0.04}
            scale={0.92}
            onClick={(e) => {
              e.stopPropagation();
              useStudio.getState().npcSay("更早的节点先收在左边了，长片树图浏览会在后续版本开放。");
            }}
          />
        );
        stackCount++;
      }
      return;
    }
    visibleXs.push(x);
    // 聚焦中的卡悬浮 + 高亮描边；选定后显示选定方案卡面，未选定（生成中/未选）显示虚框卡面
    const floating = focus?.nodeId === node.id && projection != null;
    const y = floating ? FLOAT_Y : CARD.lift;
    cards.push(
      <CardMesh
        key={node.id}
        tex={chosen ? proposalTexture(chosen) : placeholderTexture()}
        target={[x, y, CHAIN.rowZ]}
        hoverLift={!floating}
        ring={floating ? "#67e8f9" : null}
        onClick={(e) => {
          e.stopPropagation();
          const st = useStudio.getState();
          const cam = focusCam(x, CHAIN.rowZ);
          st.focusNode(node.id, cam.pos, cam.look);
        }}
      />
    );
  });

  return (
    <group>
      {/* 相邻可见节点之间 + 末节点到空白卡位的光束 */}
      {visibleXs.map((x, i) => {
        const next = i + 1 < visibleXs.length ? visibleXs[i + 1] : layout.placeholderX;
        if (next == null) return null;
        return <Beam key={i} x1={x} x2={next} z={CHAIN.rowZ} />;
      })}
      {stackCount > 0 && visibleXs.length > 0 && <Beam x1={LEFT_STACK[0]} x2={visibleXs[0]} z={CHAIN.rowZ} />}
      {cards}
      {layout.placeholderX != null && <Placeholder x={layout.placeholderX} />}
    </group>
  );
}

// ── 生成的卡飞入卡组 ─────────────────────────────────────────
function FlightCard({ f }: { f: Flight }) {
  const group = useRef<THREE.Group>(null);
  const landed = useRef(false);
  const start = useRef<number | null>(null);
  const fromV = useMemo(() => new THREE.Vector3(...f.from), [f]);
  const toV = useMemo(() => {
    const len = useStudio.getState().deck.length;
    return new THREE.Vector3(DECK_POS[0], 0.06 + len * 0.014, DECK_POS[2]);
  }, []);
  useFrame(({ clock }) => {
    if (!group.current || landed.current) return;
    if (start.current == null) start.current = clock.elapsedTime + f.delay;
    const t = (clock.elapsedTime - start.current) / 0.78;
    if (t < 0) {
      group.current.visible = false;
      return;
    }
    group.current.visible = true;
    const e = Math.min(1, 1 - Math.pow(1 - Math.min(t, 1), 3));
    group.current.position.lerpVectors(fromV, toV, e);
    group.current.position.y += Math.sin(Math.min(t, 1) * Math.PI) * 1.5;
    group.current.rotation.y = e * Math.PI * 2;
    if (t >= 1) {
      landed.current = true;
      useStudio.getState().landFlight(f.id);
    }
  });
  return (
    <group ref={group} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CARD.w * 0.92, CARD.h * 0.92]} />
        <meshBasicMaterial map={cardFaceTexture(f.card)} transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Flights() {
  const flights = useStudio((s) => s.flights);
  return (
    <>
      {flights.map((f) => (
        <FlightCard key={f.id} f={f} />
      ))}
    </>
  );
}

// ── DEV 离屏捕帧：手动驱动帧循环，供无合成器环境（隐藏页/E2E）截取 3D 画面 ──
function CaptureHook() {
  const gl = useThree((s) => s.gl);
  const clock = useThree((s) => s.clock);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__r3fCam = camera;
  }, [camera]);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__r3fCapture = (frames = 60) => {
      const orig = clock.getDelta.bind(clock);
      // 伪造 33ms 步长推进动画（真实 rAF 停摆时 dt≈0，缓动永不收敛）
      clock.getDelta = () => {
        clock.elapsedTime += 1 / 30;
        return 1 / 30;
      };
      setFrameloop("never");
      try {
        for (let i = 0; i < frames; i++) advance(performance.now() + i * 33, true);
      } finally {
        clock.getDelta = orig;
        setFrameloop("always");
      }
      return gl.domElement.toDataURL("image/jpeg", 0.85);
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__r3fCapture;
    };
  }, [gl, clock, setFrameloop]);
  return null;
}

// ── 对话视角的桌面：用户真实卡组整齐摊开（正面朝上、可点击）+ NPC 手中的 AI 推荐卡 ──
function DialogTableCards() {
  const dialogView = useStudio((s) => s.dialogView);
  const marketOpen = useStudio((s) => s.market.open);
  const deck = useStudio((s) => s.deck);
  const recommend = useStudio((s) => s.recommendCard);
  const heldMat = useMemo(
    () =>
      recommend
        ? new THREE.MeshBasicMaterial({ map: cardFaceTexture(recommend), transparent: true, side: THREE.DoubleSide })
        : null,
    [recommend]
  );
  useEffect(() => {
    if (heldMat) return () => heldMat.dispose();
  }, [heldMat]);
  if (!dialogView || marketOpen) return null;
  const shown = deck.slice(0, 6);
  const n = shown.length;
  return (
    <group>
      {shown.map((card, i) => {
        const off = i - (n - 1) / 2;
        const x = off * 0.72;
        const z = -1.7 - Math.abs(off) * 0.08;
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            target={[x, 0.02 + i * 0.004, z]}
            rotZ={-off * 0.06}
            scale={0.64}
            hoverLift
            onClick={(e) => {
              e.stopPropagation();
              useStudio.getState().viewCardDetail(card);
            }}
          />
        );
      })}
      {/* NPC 手中的推荐卡：正面朝用户、手托着卡下缘，点击查看详情/加入卡组（Tripo 版卡挂手骨，由 TripoNpc 自绘） */}
      {recommend && heldMat && !USE_TRIPO_NPC && (
        <mesh
          position={[-0.66, 1.18, -3.3]}
          rotation={[-0.16, 0.1, 0.04]}
          material={heldMat}
          onClick={(e) => {
            e.stopPropagation();
            useStudio.getState().viewCardDetail(recommend);
          }}
        >
          <planeGeometry args={[CARD.w * 0.62, CARD.h * 0.62]} />
        </mesh>
      )}
    </group>
  );
}

// ── 空白桌面点击捕获：聚焦且无投影时，点卡片之外拉远回默认机位 ──
function TableCatcher() {
  const { camera, gl } = useThree();
  // 自由视角手势状态：首指必须落在空白桌面（r3f 命中本 mesh 才回调=天然的"非互动点"闸门），
  // 第二指从任意位置计入（捏合缩放）；move/up 用 window 监听避免指针滑出平面丢事件
  const g = useRef<{ pointers: Map<number, [number, number]>; lastPinch: number | null }>({
    pointers: new Map(),
    lastPinch: null,
  });
  useEffect(() => {
    const el = gl.domElement;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const onDown = (e: PointerEvent) => {
      // 自由视角下任何落在 canvas 上的按下都算拖拽起点（HTML 面板的 target 不是 canvas，
      // 自然滤掉；互动点的"点按"走 click 通道不受影响——拖拽几乎无位移时 click 照常触发）
      if (!useStudio.getState().freeCam || e.target !== el) return;
      g.current.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      g.current.lastPinch = null;
    };
    const onMove = (e: PointerEvent) => {
      const s = g.current;
      if (!s.pointers.has(e.pointerId)) return;
      if (!useStudio.getState().freeCam) {
        s.pointers.clear();
        return;
      }
      const prev = s.pointers.get(e.pointerId)!;
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      s.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (s.pointers.size === 1) {
        // 单指拖拽：沿相机右/上轴平移（地图式：画面跟随手指），视线锚点同步平移保持朝向
        const k = 0.0035 * Math.max(2, camera.position.distanceTo(RIG_LOOK)) * 0.45;
        right.setFromMatrixColumn(camera.matrix, 0);
        up.setFromMatrixColumn(camera.matrix, 1);
        camera.position.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        RIG_LOOK.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else if (s.pointers.size === 2) {
        // 双指捏合：沿视线推拉远近
        const pts = [...s.pointers.values()];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        if (s.lastPinch != null) {
          dir.subVectors(RIG_LOOK, camera.position).normalize();
          camera.position.addScaledVector(dir, (d - s.lastPinch) * 0.012);
        }
        s.lastPinch = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      g.current.pointers.delete(e.pointerId);
      g.current.lastPinch = null;
    };
    // 桌面调试便利：滚轮推拉
    const onWheel = (e: WheelEvent) => {
      if (!useStudio.getState().freeCam) return;
      e.preventDefault();
      dir.subVectors(RIG_LOOK, camera.position).normalize();
      camera.position.addScaledVector(dir, -e.deltaY * 0.004);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [camera, gl]);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.001, 0]}
      onClick={() => {
        // 自由视角下点空白桌面只用于拖拽，不触发落卡/回退
        if (useStudio.getState().freeCam) return;
        useStudio.getState().unfocus();
      }}
    >
      <planeGeometry args={[TABLE.w, TABLE.d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ── 场景组装 ─────────────────────────────────────────────────
export default function TableScene() {
  return (
    <>
      <color attach="background" args={["#05070f"]} />
      <fog attach="fog" args={["#05070f", 16, 40]} />
      {/* 昏暗神秘基调：冷环境光 + 微弱月光，暖烛光/火把在 MagicStudy 内 */}
      <ambientLight intensity={0.2} color="#aab6ff" />
      <directionalLight position={[3, 9, -6]} intensity={0.32} color="#7f9dff" />
      {/* 桌面阅读补光（偏暖微光，保证卡面与 NPC 可读） */}
      <pointLight position={[0, 4.6, 0.6]} intensity={13} color="#ffd9a8" decay={1.9} />
      <pointLight position={[0, 2.4, -1.8]} intensity={11} color="#8fb8ff" decay={1.9} />
      <MagicStudy />
      <CameraRig />
      <Table />
      <TableCatcher />
      <ComposePad />
      <Suspense fallback={<Npc />}>
        {NPC_VARIANT === "tripo" ? (
          <TripoNpc />
        ) : NPC_VARIANT === "vrm" ? (
          <VrmNpc />
        ) : NPC_VARIANT === "witch" ? (
          // 旧自产 Tripo 女巫（降级为调试变体）：模型按画质分级选档
          <TripoNpc url={npcModelUrl()} full />
        ) : (
          // 默认铸卡师 = 购入模型 Milltina（加密分发）：VRC 原生形键 + 弹簧骨物理 + 调暗描边
          <TripoNpc url="/models/protected/milltina-opt.glbx?v=m4" cfg={MILLTINA_CFG} morphNames={MILLTINA_MORPHS} />
        )}
      </Suspense>
      <PlayerHandsSwitch />
      <DeckStack />
      <DeckSpread />
      <MarketFan />
      <DialogTableCards />
      <NodeChainView />
      <Flights />
      <DragLayer />
      {import.meta.env.DEV && <CaptureHook />}
    </>
  );
}
