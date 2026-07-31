// 卡片工坊 3D 场景：长桌 + 中线 + NPC 铸卡师 + 卡组 + 市场平摊 + 节点链 + 拖拽层。
// 固定机位只露出双方手部/上身与桌面（NPC 不建头部模型）。
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { ThreeEvent, advance, useFrame, useThree } from "@react-three/fiber";
import { NodeSlot } from "../../types";
import { activePath, chosenProposal, composable, placeholderVisible, useStudio, Flight } from "../studioStore";
import {
  CARD,
  CHAIN,
  COMPOSE_POS,
  DECK_POS,
  DEFAULT_CAM,
  LEFT_STACK,
  MARKET,
  PROPOSAL_ROWS_Z,
  PROPOSAL_SCALE,
  SPREAD,
  TABLE,
  chainX,
} from "./layout";
import {
  cardBackTexture,
  cardFaceTexture,
  labelTexture,
  placeholderTexture,
  proposalTexture,
  ringTexture,
} from "./cardTexture";
import CardMesh from "./CardMesh";

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
function CameraRig() {
  const look = useRef(new THREE.Vector3(...DEFAULT_CAM.look));
  const tmp = useRef(new THREE.Vector3());
  useFrame(({ camera }, dt) => {
    const cam = useStudio.getState().camera;
    const target = cam.kind === "default" ? DEFAULT_CAM : cam;
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(tmp.current.set(...target.pos), k);
    look.current.lerp(tmp.current.set(...target.look), k);
    camera.lookAt(look.current);
  });
  return null;
}

// ── 桌子与环境 ───────────────────────────────────────────────
function Table() {
  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.4, 0]}>
        <circleGeometry args={[26, 48]} />
        <meshStandardMaterial color="#060a15" />
      </mesh>
      {/* 桌面（绒面） */}
      <mesh position={[0, -TABLE.thick / 2, 0]}>
        <boxGeometry args={[TABLE.w, TABLE.thick, TABLE.d]} />
        <meshStandardMaterial color="#152641" roughness={0.92} />
      </mesh>
      {/* 桌沿 */}
      {[
        [0, -TABLE.d / 2 - 0.14],
        [0, TABLE.d / 2 + 0.14],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, -0.04, z]}>
          <boxGeometry args={[TABLE.w + 0.6, 0.26, 0.3]} />
          <meshStandardMaterial color="#2c3c66" roughness={0.6} />
        </mesh>
      ))}
      {[-TABLE.w / 2 - 0.14, TABLE.w / 2 + 0.14].map((x, i) => (
        <mesh key={i} position={[x, -0.04, 0]}>
          <boxGeometry args={[0.3, 0.26, TABLE.d + 0.6]} />
          <meshStandardMaterial color="#2c3c66" roughness={0.6} />
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
          <meshStandardMaterial color="#1b2440" />
        </mesh>
      ))}
      <CenterLine />
    </group>
  );
}

function CenterLine() {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (mat.current) mat.current.opacity = 0.5 + 0.25 * Math.sin(performance.now() / 700);
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
    () => new THREE.MeshBasicMaterial({ map: labelTexture("合成完整视频"), transparent: true, depthWrite: false }),
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
        <cylinderGeometry args={[0.52, 0.6, 0.1, 28]} />
        <meshStandardMaterial ref={mat} color={enabled ? "#7c5c12" : "#2a3350"} emissive="#fbbf24" emissiveIntensity={0.1} />
      </mesh>
      <mesh position={[0, 0.5, 0.35]} rotation={[-0.55, 0, 0]} material={labelMat}>
        <planeGeometry args={[2.3, 0.58]} />
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
  const cur = useRef({
    lH: new THREE.Vector3(-0.95, 0.2, -3.05),
    rH: new THREE.Vector3(0.95, 0.2, -3.05),
  });
  const tmp = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3(), e: new THREE.Vector3(), d: new THREE.Vector3() });

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const { market, dialog } = useStudio.getState();
    const wob = dialog.busy ? Math.sin(t * 7) * 0.12 : 0;
    let lT: [number, number, number];
    let rT: [number, number, number];
    if (dialog.busy) {
      lT = [-0.55, 1.45 + wob, -3.35];
      rT = [0.55, 1.45 - wob, -3.35];
    } else if (market.open) {
      lT = [-1.7, 0.5, -2.0];
      rT = [1.7, 0.5, -2.0];
    } else {
      lT = [-0.95, 0.2 + Math.sin(t * 1.3) * 0.03, -3.05];
      rT = [0.95, 0.2 + Math.cos(t * 1.15) * 0.03, -3.05];
    }
    const k = 1 - Math.exp(-dt * 5);
    const { a, b, e, d } = tmp.current;
    cur.current.lH.lerp(a.set(...lT), k);
    cur.current.rH.lerp(a.set(...rT), k);
    if (torso.current) torso.current.position.y = Math.sin(t * 1.2) * 0.03;

    // 左臂（placeBone 只读取 a/b，不需要 clone）
    a.set(-0.85, 1.62, -4.35);
    e.copy(a).add(cur.current.lH).multiplyScalar(0.5);
    e.x -= 0.45;
    e.y += 0.12;
    if (lUpper.current) placeBone(lUpper.current, a, e, d);
    b.copy(cur.current.lH);
    if (lFore.current) placeBone(lFore.current, e, b, d);
    if (lHand.current) lHand.current.position.copy(b);
    // 右臂
    a.set(0.85, 1.62, -4.35);
    e.copy(a).add(cur.current.rH).multiplyScalar(0.5);
    e.x += 0.45;
    e.y += 0.12;
    if (rUpper.current) placeBone(rUpper.current, a, e, d);
    b.copy(cur.current.rH);
    if (rFore.current) placeBone(rFore.current, e, b, d);
    if (rHand.current) rHand.current.position.copy(b);
  });

  const sleeve = "#1f2a47";
  const glove = "#3b4a77";
  return (
    <group>
      <group ref={torso}>
        {/* 躯干（无头） */}
        <mesh position={[0, 0.95, -4.6]} scale={[1.2, 1, 0.75]}>
          <capsuleGeometry args={[0.62, 0.95, 4, 14]} />
          <meshStandardMaterial color="#1c2745" roughness={0.7} />
        </mesh>
        {/* 双肩 */}
        <mesh position={[-0.85, 1.62, -4.35]}>
          <sphereGeometry args={[0.24, 14, 14]} />
          <meshStandardMaterial color={sleeve} />
        </mesh>
        <mesh position={[0.85, 1.62, -4.35]}>
          <sphereGeometry args={[0.24, 14, 14]} />
          <meshStandardMaterial color={sleeve} />
        </mesh>
        {/* 胸前徽记 */}
        <mesh position={[0, 1.28, -3.97]}>
          <circleGeometry args={[0.16, 24]} />
          <meshStandardMaterial color="#0b1020" emissive="#67e8f9" emissiveIntensity={1.4} />
        </mesh>
      </group>
      <mesh ref={lUpper}>
        <cylinderGeometry args={[0.15, 0.17, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={lFore}>
        <cylinderGeometry args={[0.12, 0.15, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={rUpper}>
        <cylinderGeometry args={[0.15, 0.17, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={rFore}>
        <cylinderGeometry args={[0.12, 0.15, 1, 10]} />
        <meshStandardMaterial color={sleeve} />
      </mesh>
      <mesh ref={lHand}>
        <sphereGeometry args={[0.17, 14, 14]} />
        <meshStandardMaterial color={glove} />
      </mesh>
      <mesh ref={rHand}>
        <sphereGeometry args={[0.17, 14, 14]} />
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

function UserHands() {
  return (
    <group>
      <StaticBone a={[-1.85, -0.75, 5.5]} b={[-1.25, 0.05, 3.8]} r={0.26} color="#26334f" />
      <StaticBone a={[1.85, -0.75, 5.5]} b={[1.25, 0.05, 3.8]} r={0.26} color="#26334f" />
      <mesh position={[-1.25, 0.1, 3.68]}>
        <sphereGeometry args={[0.27, 16, 16]} />
        <meshStandardMaterial color="#d4a97c" roughness={0.6} />
      </mesh>
      <mesh position={[1.25, 0.1, 3.68]}>
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
        useStudio.getState().toggleSpread();
      }}
    >
      {/* 卡组虚位标记 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[DECK_POS[0], 0.004, DECK_POS[2]]} material={markerMat}>
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
      <mesh position={[DECK_POS[0], 0.36 + shown * 0.014, DECK_POS[2] + 0.95]} rotation={[-0.6, 0, 0]} material={countMat}>
        <planeGeometry args={[1.5, 0.38]} />
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
      if (dragState.moved && nearPlaceholder) st.dropOnPlaceholder(id);
      else if (!dragState.moved) st.pickDeckCard(id);
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
  const n = market.items.length;
  return (
    <group>
      {market.items.map((card, i) => {
        const off = i - (n - 1) / 2;
        const x = off * MARKET.dx;
        const z = MARKET.z + Math.abs(off) * 0.07;
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            from={[0.9, 0.9, -3.2]}
            target={[x, MARKET.lift + i * 0.004, z]}
            rotZ={-off * 0.05}
            hoverLift
            ring={detail?.id === card.id ? "#fbbf24" : null}
            onClick={(e) => {
              e.stopPropagation();
              useStudio.getState().viewMarketCard(card, [x * 0.65, 2.1, z + 2.6], [x, 0, z]);
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
  useFrame(() => {
    mat.opacity = 0.6 + 0.3 * Math.sin(performance.now() / 520);
  });
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[x, CARD.lift, CHAIN.rowZ]}
      material={mat}
      onClick={(e) => {
        e.stopPropagation();
        useStudio.getState().clickPlaceholder();
      }}
    >
      <planeGeometry args={[CARD.w, CARD.h]} />
    </mesh>
  );
}

function NodeChainView() {
  const root = useStudio((s) => s.root);
  const expandedNodeId = useStudio((s) => s.expandedNodeId);
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
    const expanded = node.chosenId == null || expandedNodeId === node.id;
    node.proposals.forEach((p, j) => {
      const isChosen = node.chosenId === p.id;
      const rowZ = PROPOSAL_ROWS_Z[j];
      const target: [number, number, number] = expanded
        ? [x, CARD.lift + j * 0.004, rowZ]
        : [x, CARD.lift, CHAIN.rowZ];
      const opacity = expanded ? 1 : isChosen ? 1 : 0;
      cards.push(
        <CardMesh
          key={p.id}
          tex={proposalTexture(p)}
          target={target}
          scale={expanded ? PROPOSAL_SCALE : 1}
          opacity={opacity}
          hoverLift
          ring={isChosen ? "#fbbf24" : null}
          onClick={(e) => {
            e.stopPropagation();
            const st = useStudio.getState();
            if (expanded) st.openProposal(node.id, p.id, [x * 0.7, 2.4, rowZ + 2.7], [x, 0, rowZ]);
            else st.toggleExpand(node.id);
          }}
        />
      );
    });
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

// ── 场景组装 ─────────────────────────────────────────────────
export default function TableScene() {
  return (
    <>
      <color attach="background" args={["#0b1020"]} />
      <fog attach="fog" args={["#0b1020", 26, 52]} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[4, 10, 7]} intensity={1.35} />
      <pointLight position={[0, 4.5, -2.5]} intensity={50} color="#67e8f9" />
      {/* NPC 正面补光 + 背景幕墙（让铸卡师不悬在纯黑里） */}
      <pointLight position={[0, 2.6, -2.2]} intensity={26} color="#8fb8ff" />
      <mesh position={[0, 3.4, -10.5]}>
        <planeGeometry args={[46, 15]} />
        <meshStandardMaterial color="#0e1730" />
      </mesh>
      <CameraRig />
      <Table />
      <ComposePad />
      <Npc />
      <UserHands />
      <DeckStack />
      <DeckSpread />
      <MarketFan />
      <NodeChainView />
      <Flights />
      <DragLayer />
      {import.meta.env.DEV && <CaptureHook />}
    </>
  );
}
