// 玩家第一人称手臂：按所选形象（男/女）加载 Tripo 绑骨模型，
// 摆"双臂前伸伏在桌沿"姿势，身体沉在镜头外、只露前臂与手。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "./TripoNpc";
import { useStudio } from "../studioStore";

const BONES = {
  spine1: "mixamorigSpine1",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  lArm: "mixamorigLeftArm",
  lFore: "mixamorigLeftForeArm",
  rArm: "mixamorigRightArm",
  rFore: "mixamorigRightForeArm",
} as const;

export default function PlayerArms({ avatar }: { avatar: "m" | "f" }) {
  // think 版 = 绑骨模型 + Blender matrix 法烘的"低头看镜头手摸下巴"1 帧动画
  // （v2：欧拉直设导出参考系错乱使弯腰过深、头贴桌面——matrix 法重烘 + 浅弯保头在桌沿上；
  //   url 版本号：重烘后必须升版破 useLoader/HTTP 缓存）
  const gltf = useLoader(GLTFLoader, `/models/preview/player-${avatar}-think-opt.glb?v=think2`, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const bones = useRef<Record<string, THREE.Object3D | null>>({});
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf]);
  const thinkAction = useMemo(() => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, "think");
    if (!clip) return null;
    // 只保留旋转轨道：Blender 烘的 location 轨道会把骨骼 rest 位置压塌
    clip.tracks = clip.tracks.filter((tr) => !tr.name.endsWith(".position") && !tr.name.endsWith(".scale"));
    return mixer.clipAction(clip);
  }, [gltf, mixer]);

  useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    for (const [k, name] of Object.entries(BONES)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    toonify(gltf.scene, 0.0012);
    // 与 NPC 同构：Root 骨自带立正修正；玩家背对镜头面向 NPC（-Z 方向）→ yaw +90°
    gltf.scene.rotation.set(0, Math.PI / 2, 0);
  }, [gltf]);

  // DEV 可调姿势表（__playerPose）：双臂前伸伏桌，头微低（避免后脑勺入画）
  const pose = useMemo(() => {
    // 实测定稿（俯视 FPS：无头、肩臂入画、双手悬在桌沿上方作施法/操作势）
    const p = {
      spine1: [0.6, 0, 0] as [number, number, number] | null,
      neck: [0.35, 0, 0] as [number, number, number] | null,
      head: [0.35, 0, 0] as [number, number, number] | null,
      lArm: [1.55, -0.35, 0] as [number, number, number] | null,
      lFore: [0.3, -0.1, 0] as [number, number, number] | null,
      rArm: [0, -1.38, 0] as [number, number, number] | null,
      rFore: [0.25, 0, 1.6] as [number, number, number] | null,
      y: -2.9,
      z: 4.95,
      freeze: false,
    };
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__playerPose = p;
      w.__player = {
        scene: gltf.scene,
        bones: bones.current,
        mixer,
        thinkAction,
        anims: gltf.animations.map((a) => `${a.name}:${a.tracks.length}`),
      };
    }
    return p;
  }, [gltf, mixer, thinkAction]);

  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const w = (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__playerPose) as
      | typeof pose
      | false;
    const p2 = w || pose;
    if (p2.freeze) return;
    const t = clock.elapsedTime;
    const deckView = useStudio.getState().deckView;
    const breathe = Math.sin(t * 1.15 + 1.7) * 0.01;
    if (deckView && thinkAction) {
      // 思考姿势：钉在 clip 末帧（首 key 是 rest）。paused 的 mixer 只保证首帧写入、
      // 后续可能跳采样——因此绝不在骨骼上做叠加（会累积卷塌），呼吸改由 group 整体浮动表达。
      // 坑：paused 的 action isRunning()===false 但仍占据 mixer 激活位——不先 stop() 彻底
      // 反激活，二次进入时 reset().play() 不会重新触发首帧采样，骨骼保留退出时的
      // FPS 低头姿势 → 头埋到桌面
      if (!thinkAction.isRunning() && !thinkAction.paused) {
        thinkAction.stop();
        thinkAction.reset().play();
        thinkAction.time = thinkAction.getClip().duration;
        thinkAction.paused = true;
      }
      mixer.update(0.000001);
    } else {
      if (thinkAction && (thinkAction.isRunning() || thinkAction.paused)) thinkAction.stop();
      for (const k of Object.keys(BONES) as (keyof typeof BONES)[]) {
        const n = bones.current[k];
        const v = p2[k] as [number, number, number] | null;
        if (n && v) n.rotation.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
      }
    }
    // 头部：默认 FPS 隐藏；卡组浏览视角（镜头拍玩家）恢复显示
    const head = bones.current.head;
    if (head) {
      const s = deckView ? 1 : 0.001;
      if (head.scale.x !== s) head.scale.set(s, s, s);
    }
    if (group.current) group.current.position.set(0, p2.y + (deckView ? breathe * 0.6 : 0), p2.z);
  });

  return (
    <group ref={group} position={[0, pose.y, pose.z]}>
      <primitive object={gltf.scene} scale={4.3} />
      {/* 玩家侧补光：烛光都在桌北，肩臂需要一点暖光才可读 */}
      <pointLight position={[0, 4.2, -0.6]} intensity={6} distance={7} color="#ffdbb0" />
    </group>
  );
}
