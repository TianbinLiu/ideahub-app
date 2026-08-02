// 玩家第一人称手臂：按所选形象（男/女）加载 Tripo 绑骨模型，
// 摆"双臂前伸伏在桌沿"姿势，身体沉在镜头外、只露前臂与手。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "./TripoNpc";
import { useStudio } from "../studioStore";
import { DECK_CAM } from "./layout";
import { PlayerAvatar, playerModelUrl } from "../quality";
import { loaderFor } from "../secureAssets";
import { SpringBoneSim } from "./springBones";

const BONES = {
  spine1: "mixamorigSpine1",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  lArm: "mixamorigLeftArm",
  lFore: "mixamorigLeftForeArm",
  rArm: "mixamorigRightArm",
  rFore: "mixamorigRightForeArm",
} as const;

type PoseTable = Record<keyof typeof BONES, [number, number, number] | null>;

// FPS 姿势表按 rig 家族分：Tripo 自产模型 与 MMD 移植模型（骨骼局部轴系不同，实测定稿）
const TRIPO_POSE: PoseTable = {
  spine1: [0.6, 0, 0],
  neck: [0.35, 0, 0],
  head: [0.35, 0, 0],
  lArm: [1.55, -0.35, 0],
  lFore: [0.3, -0.1, 0],
  rArm: [0, -1.38, 0],
  rFore: [0.25, 0, 1.6],
};
// MMD 系轴向实测（rest-relative 增量）：臂 -z=前摆、±x=展/收、y=扭转；脊柱 +x=前倾。
// 姿势=弯腰伏桌（用户定稿）：腰弯 ~75°+抬头看向对面，胸部越过桌沿压在桌面上，
// 双臂内收交叉垫在胸下（腰部枢轴世界高 ≈0.25 恰在桌沿顶——弯平后胸自然落到桌毡）
const MMD_POSE: PoseTable = {
  spine1: [1.35, 0, 0],
  neck: [-0.5, 0, 0],
  head: [-0.6, 0, 0],
  lArm: [-0.85, 0, -0.55],
  lFore: [0, 0.35, -0.95],
  rArm: [0.85, 0, -0.55],
  rFore: [0, -0.35, -0.95],
};

// 每形象装配参数：MMD 系 glTF 导出后面朝 +Z（Tripo 系是 Root 修正后朝 +X）。
// deckY=卡组视角整体下沉（站姿 MMD 模型比 Tripo think 前倾姿势高得多，脸会出画；
// Tripo 系有烘焙 think 动画不需要）；springs=弹簧骨链根名（中日文骨名直接匹配）
const RIGS: Record<
  PlayerAvatar,
  {
    yaw: number;
    scale: number;
    y: number;
    z: number;
    deckY?: number;
    pose: PoseTable;
    /** 分组弹簧：不同发链用不同物理（长链垂坠/短链保形）；
     *  uprightOpts=直立态（卡组 think）参数——伏桌垂坠参数在直立特写会让长发帘住脸 */
    springGroups?: Array<{
      prefixes: string[];
      opts: { stiffness?: number; drag?: number; gravity?: number };
      uprightOpts?: { stiffness?: number; drag?: number; gravity?: number };
    }>;
    /** FPS 隐头（Tripo 系防后脑勺入画）；MMD 系弯腰伏桌姿势头在画内，隐头会露白色颈桩 */
    hideHead?: boolean;
    /** think 生效范围：Tripo=showSelf（含自由视角）；MMD=仅卡组特写（自由视角应看到伏桌常态） */
    thinkDeckOnly?: boolean;
  }
> = {
  m: { yaw: Math.PI / 2, scale: 4.3, y: -2.9, z: 4.95, pose: TRIPO_POSE, hideHead: true },
  f: { yaw: Math.PI / 2, scale: 4.3, y: -2.9, z: 4.95, pose: TRIPO_POSE, hideHead: true },
  rin: {
    yaw: Math.PI,
    // 体格/落地重定（用户平视验收）：scale 按 NPC 体格比例（4.3 是 7.2 单位巨人；场景角色 ~3.4）、
    // y=地板 -2.41 脚底精确落地（两模型脚底=原点，实测蒙皮包围盒 minY==groupY）；胸口 0.59>桌沿 0.25
    scale: 2.5,
    y: -2.41,
    // 3.85：深伏时胸要完整越过桌沿（z 3.38）落毡——身位随前倾深度贴近
    z: 3.85,
    deckY: -3.1,
    thinkDeckOnly: true,
    pose: MMD_POSE,
    // 分组弹簧：长马尾=重力主导垂坠（重力项 ×0.1 衰减，gravity/10 ≥ stiffness 才垂）；
    // 短链（后发/刘海/发饰/吊坠）=保形跟随——全员垂坠会让后发越过头顶把脸盖成毛球
    springGroups: [
      // 半垂坠：全垂+桌面 clamp 会把长卷发摊成放射状；保一半卷形、发梢下垂最自然
      {
        prefixes: ["馬尾"],
        opts: { stiffness: 2.5, drag: 0.35, gravity: 12 },
        uprightOpts: { stiffness: 5, drag: 0.3, gravity: 1.6 },
      },
      // 劉海（贴脸短刘海）不接物理：任何垂坠残态都会帘住脸，刚性保持原作造型
      { prefixes: ["後髪", "髮飾", "吊墜"], opts: { stiffness: 5, drag: 0.3, gravity: 1.6 } },
      // 长裙：弯腰后硬裙会随骨盆水平后戳成"木板"——垂坠弹簧近似布料（180 骨，实测可负担）
      { prefixes: ["裙"], opts: { stiffness: 1.5, drag: 0.35, gravity: 20 } },
    ],
  },
  gratia: {
    yaw: Math.PI,
    scale: 2.21,
    y: -2.41,
    z: 3.85,
    deckY: -3.1,
    thinkDeckOnly: true,
    pose: MMD_POSE,
    // 大马尾=垂坠组；侧发/前发/领带=保形组（スカート 260 骨出画不接）
    springGroups: [
      {
        prefixes: ["dyn_hairback"],
        opts: { stiffness: 2.5, drag: 0.35, gravity: 12 },
        uprightOpts: { stiffness: 5, drag: 0.3, gravity: 1.6 },
      },
      { prefixes: ["dyn_hairside", "tie"], opts: { stiffness: 5, drag: 0.3, gravity: 1.6 } },
      { prefixes: ["スカート", "dyn_backskirt"], opts: { stiffness: 1.5, drag: 0.35, gravity: 20 } },
    ],
  },
};

/** 悬浮法器（试穿档专属道具）：悬浮在角色旁的桌沿上空缓旋+浮动——与全息卡视觉语言
 *  一致的魔法道具。伏桌姿势后不再挂手骨（双手垫在胸下，跟手会戳进身体），改 group
 *  固定位。凛=同包宝石剑 PMX、Gratia=UE 解包细剑（UEFormat 插件转制） */
const HOVER_PROPS: Partial<
  Record<PlayerAvatar, { url: string; pos: [number, number, number]; scale: number; outline: number }>
> = {
  // 伏桌后头在前方桌沿上空——法器位外移防怼脸
  rin: { url: "/models/protected/rin-sword-opt.glbx?v=p1", pos: [1.25, 3.0, -0.45], scale: 1.9, outline: 0.002 },
  gratia: { url: "/models/protected/gratia-rapier-opt.glbx?v=p1", pos: [1.25, 3.0, -0.45], scale: 0.7, outline: 0.002 },
};

function HoverProp({ cfg }: { cfg: NonNullable<(typeof HOVER_PROPS)[PlayerAvatar]> }) {
  const propGltf = useLoader(loaderFor(cfg.url), cfg.url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  useMemo(() => toonify(propGltf.scene, cfg.outline), [propGltf, cfg]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    propGltf.scene.rotation.y = t * 0.9;
    propGltf.scene.position.set(cfg.pos[0], cfg.pos[1] + Math.sin(t * 1.6) * 0.03, cfg.pos[2]);
  });
  return <primitive object={propGltf.scene} position={cfg.pos} scale={cfg.scale} />;
}

export default function PlayerArms({ avatar }: { avatar: PlayerAvatar }) {
  // think 版 = 绑骨模型 + Blender matrix 法烘的"低头看镜头手摸下巴"1 帧动画
  // （欧拉直设导出参考系会错乱使弯腰过深头贴桌面——matrix 法烘焙；模型按画质分级选档）
  // 开发试穿档（rin/gratia）是加密 glbx，loaderFor 自动切解密加载器；无 think 动画走 FPS 姿势兜底
  const rig = RIGS[avatar];
  const modelUrl = playerModelUrl(avatar);
  const gltf = useLoader(loaderFor(modelUrl), modelUrl, (loader) => {
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
  // settle=入场过渡（站立→撤步弯腰伏桌，MMD 档专属）：位置轨只留 mmdCenter（撤步根移动），
  // 其余骨的 location 轨会压塌 rest 位置
  const settleAction = useMemo(() => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, "settle");
    if (!clip) return null;
    clip.tracks = clip.tracks.filter((tr) =>
      tr.name.endsWith(".position") ? tr.name.includes("mmdCenter") : !tr.name.endsWith(".scale"),
    );
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    return a;
  }, [gltf, mixer]);
  const settleStarted = useRef(false);

  const restQ = useRef<Record<string, THREE.Quaternion>>({});
  useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    // MMD 系骨骼 rest 局部旋转非零（Blender 骨自带朝向）——绝对欧拉写入会抹掉 rest 直接炸姿势。
    // rest 四元数只在该 gltf 首次挂载时捕获并存 userData：useLoader 按 URL 缓存场景，
    // 换形象再换回会拿到"骨骼停在上次姿势"的缓存场景——那时再 clone 就把姿势误录成 rest（X 臂事故）
    const ud = gltf.scene.userData as { __restQ?: Record<string, THREE.Quaternion> };
    const first = !ud.__restQ;
    if (first) ud.__restQ = {};
    for (const [k, name] of Object.entries(BONES)) {
      const b = gltf.scene.getObjectByName(name) ?? null;
      bones.current[k] = b;
      if (b && first) ud.__restQ![k] = b.quaternion.clone();
    }
    // 双手骨额外记录：think/settle 里手骨被 keyframe，退出后 FPS 不驱动手骨会卡姿势——须显式回 rest
    const lh = gltf.scene.getObjectByName("mixamorigLeftHand");
    bones.current.lHand = lh ?? null;
    if (lh && first) ud.__restQ!.lHand = lh.quaternion.clone();
    const rh = gltf.scene.getObjectByName("mixamorigRightHand");
    bones.current.rHand = rh ?? null;
    if (rh && first) ud.__restQ!.rHand = rh.quaternion.clone();
    restQ.current = ud.__restQ!;
    settleStarted.current = false; // 换形象重挂载：入场过渡重新走一遍
  }, [gltf, rig]);
  useMemo(() => {
    toonify(gltf.scene, 0.0012);
    // 朝向修正按 rig 家族：玩家背对镜头面向 NPC（-Z 方向）
    gltf.scene.rotation.set(0, rig.yaw, 0);
  }, [gltf, rig]);

  // DEV 可调姿势表（__playerPose）：双臂前伸伏桌，头微低（避免后脑勺入画）
  const pose = useMemo(() => {
    // 实测定稿（俯视 FPS：无头、肩臂入画、双手悬在桌沿上方作施法/操作势）
    const p = {
      ...rig.pose,
      y: rig.y,
      z: rig.z,
      deckY: rig.deckY as number | undefined,
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
  }, [gltf, mixer, thinkAction, rig]);

  const group = useRef<THREE.Group>(null);
  // 注视镜头系统：思考姿势本身凝视 DECK_CAM 位置——当实际镜头偏离（自由视角拖拽）时，
  // 间歇性地把头转向镜头（限幅+缓入缓出），给"角色突然注意到你"的存在感
  const headBase = useRef<THREE.Quaternion | null>(null);
  const glance = useRef({ nextAt: 4, start: 0, until: 0 });
  const gv = useMemo(
    () => ({
      headPos: new THREE.Vector3(),
      baseDir: new THREE.Vector3(),
      camDir: new THREE.Vector3(),
      qDelta: new THREE.Quaternion(),
      qParent: new THREE.Quaternion(),
      qTmp: new THREE.Quaternion(),
      qId: new THREE.Quaternion(),
      ePose: new THREE.Euler(),
      qPose: new THREE.Quaternion(),
    }),
    [],
  );

  // 头部注视覆盖：以"当前头骨四元数"为底，按目光窗口把头限幅转向实际镜头
  // （think 分支=mixer 采样后；MMD 分支=姿势写入后——两处共用）
  function applyGaze(head: THREE.Object3D, t: number, camera: THREE.Camera) {
    const gl2 = glance.current;
    let weight = 0;
    if (gl2.until === 0 && t >= gl2.nextAt) {
      gl2.start = t;
      gl2.until = t + 2.0 + (Math.sin(gl2.nextAt * 7.31) * 0.5 + 0.5) * 1.3;
    }
    if (gl2.until > 0) {
      if (t >= gl2.until) {
        // 伪随机排下一次注视（确定性可复现）
        const h = Math.abs(Math.sin(gl2.until * 12.9898) * 43758.5453) % 1;
        gl2.nextAt = t + 3.5 + h * 4.5;
        gl2.until = 0;
      } else {
        // 缓入缓出：窗口两端 0.5s 渐变
        const aIn = Math.min(1, (t - gl2.start) / 0.5);
        const aOut = Math.min(1, (gl2.until - t) / 0.5);
        const m = Math.min(aIn, aOut);
        weight = m * m * (3 - 2 * m);
      }
    }
    if (weight > 0.001) {
      head.updateWorldMatrix(true, false);
      gv.headPos.setFromMatrixPosition(head.matrixWorld);
      gv.baseDir.set(DECK_CAM.pos[0], DECK_CAM.pos[1], DECK_CAM.pos[2]).sub(gv.headPos).normalize();
      gv.camDir.copy(camera.position).sub(gv.headPos).normalize();
      gv.qDelta.setFromUnitVectors(gv.baseDir, gv.camDir);
      // 限幅 0.5 rad：只转头不拧脖子
      const ang = 2 * Math.acos(Math.min(1, Math.abs(gv.qDelta.w)));
      if (ang > 0.5) gv.qDelta.slerp(gv.qId, 1 - 0.5 / ang);
      gv.qDelta.slerp(gv.qId, 1 - weight);
      // 世界系增量 → 头骨局部系：local' = P⁻¹·Δ·P·local
      head.parent!.getWorldQuaternion(gv.qParent);
      gv.qTmp.copy(gv.qParent).invert().multiply(gv.qDelta).multiply(gv.qParent);
      head.quaternion.premultiply(gv.qTmp);
    }
  }

  // 弹簧骨物理（MMD 移植模型发链，分组不同手感）；垂发用桌面/地板平面碰撞承接
  const springSims = useMemo(() => {
    if (!rig.springGroups?.length) return null;
    const clampY = (p: THREE.Vector3) => (p.z < 3.42 ? 0.03 : -2.38);
    const sims = rig.springGroups
      .map((g) => ({
        sim: new SpringBoneSim(gltf.scene, g.prefixes, { ...g.opts, clampY }),
        base: g.opts,
        upright: g.uprightOpts,
      }))
      .filter((s) => s.sim.jointCount > 0);
    if (import.meta.env.DEV) console.log("[player springs] joints:", sims.map((s) => s.sim.jointCount).join("+"));
    return sims.length ? sims : null;
  }, [gltf, rig]);

  useFrame(({ clock, camera }, dt) => {
    const w = (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__playerPose) as
      | typeof pose
      | false;
    const p2 = w || pose;
    if (p2.freeze) return;
    const t = clock.elapsedTime;
    const st = useStudio.getState();
    // 卡组视角或自由视角都露脸+保持思考姿势（自由视角下用户可能拖到能看到自己的位置）
    const showSelf = st.deckView || st.freeCam;
    // MMD 档 think/下沉只属于卡组特写——自由视角应看到伏桌常态姿势（Tripo 系维持 showSelf 语义）
    const thinkActive = rig.thinkDeckOnly ? st.deckView : showSelf;
    const breathe = Math.sin(t * 1.15 + 1.7) * 0.01;
    if (thinkActive && thinkAction) {
      // 思考姿势：钉在 clip 末帧（首 key 是 rest）。paused 的 mixer 只保证首帧写入、
      // 后续可能跳采样——因此绝不在骨骼上做叠加（会累积卷塌），呼吸改由 group 整体浮动表达。
      // 坑：paused 的 action isRunning()===false 但仍占据 mixer 激活位——不先 stop() 彻底
      // 反激活，二次进入时 reset().play() 不会重新触发首帧采样，骨骼保留退出时的
      // FPS 低头姿势 → 头埋到桌面
      // 注意：isRunning() 对 timeScale=0 的钉帧播放态返回 false——漏停会让 settle
      // 每帧覆写骨骼把 think 顶回伏桌（Milltina 钉帧陷阱同款）
      if (settleAction && (settleAction.isRunning() || settleAction.paused || settleAction.timeScale === 0)) {
        settleAction.stop();
        settleAction.timeScale = 1;
      }
      if (!thinkAction.isRunning() && !thinkAction.paused) {
        thinkAction.stop();
        thinkAction.reset().play();
        thinkAction.time = thinkAction.getClip().duration;
        thinkAction.paused = true;
        headBase.current = null; // 重新采样后基准失效，下帧重取
      }
      mixer.update(0.000001);
      // ── 头部注视：mixer 采样后以基准四元数为底、按目光窗口叠加限幅转头 ──
      const head = bones.current.head;
      if (head) {
        if (!headBase.current) headBase.current = head.quaternion.clone();
        else head.quaternion.copy(headBase.current);
        applyGaze(head, t, camera);
      }
    } else if (settleAction) {
      // ── MMD 档常态=settle 动画驱动（站立→撤步弯腰伏桌），播完 timeScale=0 钉末帧持续写 ──
      if (thinkAction && (thinkAction.isRunning() || thinkAction.paused)) thinkAction.stop();
      headBase.current = null;
      const pinned = settleAction.timeScale === 0 && !settleAction.paused && settleAction.time > 0.001;
      if (!pinned) {
        if (settleAction.paused) {
          // clampWhenFinished 停帧后 mixer 不再写入——转 timeScale0 播放态钉帧（Milltina 方案）
          settleAction.paused = false;
          settleAction.timeScale = 0;
          settleAction.time = settleAction.getClip().duration;
        } else if (!settleAction.isRunning()) {
          settleAction.reset().play();
          if (settleStarted.current) {
            // 二次进入（think 退出/重挂载后）：直接钉末帧，不重演走位
            settleAction.time = settleAction.getClip().duration;
            settleAction.timeScale = 0;
          } else {
            settleStarted.current = true;
            settleAction.timeScale = 1;
          }
        }
      }
      mixer.update(dt); // 入场播放需真实步进；钉帧态（timeScale0）照常逐帧写
      // think 退出复位：手骨不在 settle 轨道里，不显式回 rest 会卡在托腮内旋态
      const lh = bones.current.lHand;
      if (lh && restQ.current.lHand) lh.quaternion.copy(restQ.current.lHand);
      // 伏桌定格后叠加注视镜头（自由视角/卡组均有生命感；过渡播放期也无害）
      const head2 = bones.current.head;
      if (head2 && settleAction.timeScale === 0) applyGaze(head2, t, camera);
    } else {
      if (thinkAction && (thinkAction.isRunning() || thinkAction.paused)) thinkAction.stop();
      headBase.current = null;
      for (const k of Object.keys(BONES) as (keyof typeof BONES)[]) {
        const n = bones.current[k];
        const v = p2[k] as [number, number, number] | null;
        if (n && v) {
          gv.ePose.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
          const rest = restQ.current[k];
          if (rest) n.quaternion.copy(rest).multiply(gv.qPose.setFromEuler(gv.ePose));
          else n.rotation.set(gv.ePose.x, gv.ePose.y, gv.ePose.z);
        }
      }
      // think 退出复位：手骨不在 FPS 姿势表里，不显式回 rest 会卡在托腮内旋态
      const lh = bones.current.lHand;
      if (lh && restQ.current.lHand) lh.quaternion.copy(restQ.current.lHand);
      const rh = bones.current.rHand;
      if (rh && restQ.current.rHand) rh.quaternion.copy(restQ.current.rHand);
      // MMD 档卡组视角（无 think 动画）：姿势写入后同样叠加注视镜头，让特写有生命感
      const head2 = bones.current.head;
      if (showSelf && head2) applyGaze(head2, t, camera);
    }
    // 头部：Tripo 系 FPS 隐头（防后脑勺入画），拍到玩家时恢复；MMD 系常显
    const head = bones.current.head;
    if (head) {
      const s = rig.hideHead && !showSelf ? 0.001 : 1;
      if (head.scale.x !== s) head.scale.set(s, s, s);
    }
    // deckY 下沉只在卡组特写（挂到 showSelf 会让自由视角浏览时角色突然沉降）
    const baseY = st.deckView && p2.deckY !== undefined ? p2.deckY : p2.y;
    if (group.current) group.current.position.set(0, baseY + (showSelf ? breathe * 0.6 : 0), p2.z);
    // 弹簧骨在姿势之后模拟（读最新世界矩阵，回写局部旋转）；直立态（think）切保形参数
    if (springSims) {
      gltf.scene.updateMatrixWorld(true);
      for (const s of springSims) {
        const o = thinkActive && s.upright ? s.upright : s.base;
        s.sim.stiffness = o.stiffness ?? 14;
        s.sim.drag = o.drag ?? 0.32;
        s.sim.gravity = o.gravity ?? 1.6;
        s.sim.update(dt);
      }
    }
  });

  return (
    <group ref={group} position={[0, pose.y, pose.z]}>
      <primitive object={gltf.scene} scale={rig.scale} />
      {HOVER_PROPS[avatar] && <HoverProp cfg={HOVER_PROPS[avatar]!} />}
      {/* 玩家侧补光：烛光都在桌北，肩臂需要一点暖光才可读 */}
      <pointLight position={[0, 4.2, -0.6]} intensity={6} distance={7} color="#ffdbb0" />
    </group>
  );
}
