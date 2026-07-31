// 平放在桌面上的卡片：位置/透明度朝目标值缓动，支持悬停抬升与选中光环
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ThreeEvent, useFrame } from "@react-three/fiber";
import { CARD } from "./layout";
import { ringTexture } from "./cardTexture";

export interface CardMeshProps {
  tex: THREE.Texture;
  target: [number, number, number];
  rotZ?: number;
  scale?: number;
  opacity?: number;
  hoverLift?: boolean;
  ring?: string | null;
  /** 初始位置（飞入动画起点），缺省为 target */
  from?: [number, number, number];
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}

export default function CardMesh({
  tex,
  target,
  rotZ = 0,
  scale = 1,
  opacity = 1,
  hoverLift = false,
  ring = null,
  from,
  onClick,
  onPointerDown,
}: CardMeshProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const state = useRef({
    pos: new THREE.Vector3(...(from ?? target)),
    opacity: from ? 0 : opacity,
    scale,
  });
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    [tex]
  );
  const ringMat = useMemo(
    () =>
      ring
        ? new THREE.MeshBasicMaterial({
            map: ringTexture(ring),
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        : null,
    [ring]
  );

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 9);
    const st = state.current;
    const lift = hoverLift && hovered ? 0.22 : 0;
    st.pos.lerp(new THREE.Vector3(target[0], target[1] + lift, target[2]), k);
    st.opacity += (opacity - st.opacity) * k;
    st.scale += (scale - st.scale) * k;
    g.position.copy(st.pos);
    g.scale.setScalar(st.scale);
    mat.opacity = st.opacity;
    if (ringMat) ringMat.opacity = st.opacity * (0.7 + 0.3 * Math.sin(performance.now() / 280));
    g.visible = st.opacity > 0.04;
  });

  const interactive = opacity > 0.5 && (onClick || onPointerDown);

  return (
    <group ref={group}>
      <mesh
        rotation={[-Math.PI / 2, 0, rotZ]}
        material={mat}
        onClick={interactive ? onClick : undefined}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerOver={interactive ? (e) => (e.stopPropagation(), setHovered(true)) : undefined}
        onPointerOut={interactive ? () => setHovered(false) : undefined}
      >
        <planeGeometry args={[CARD.w, CARD.h]} />
      </mesh>
      {ringMat && (
        <mesh rotation={[-Math.PI / 2, 0, rotZ]} position={[0, -0.002, 0]} material={ringMat}>
          <planeGeometry args={[CARD.w * 1.12, CARD.h * 1.09]} />
        </mesh>
      )}
    </group>
  );
}
