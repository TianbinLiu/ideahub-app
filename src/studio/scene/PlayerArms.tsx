// 玩家第一人称手臂：按所选形象（男/女）加载 Tripo 绑骨模型，
// 摆"双臂前伸伏在桌沿"姿势，身体沉在镜头外、只露前臂与手。
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "./TripoNpc";
import { useStudio } from "../studioStore";
import { DECK_CAM } from "./layout";
import { PlayerAvatar, playerModelUrl } from "../quality";
import { loaderFor } from "../secureAssets";
import { SpringBoneSim, type SphereCollider } from "./springBones";
import { PLAYER_HEAD, eyeLook, eyeRise } from "./cameraOrbit";
import { gazeDelta, type GazeLimits } from "./gazeDelta";

/** 玩家注视限幅：只转头不拧脖子。低头给得比抬头小（低头把脸往刘海里推） */
const PLAYER_GAZE: GazeLimits = { yaw: 0.5, up: 0.20, down: 0.12 };

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
// 站姿：这个 rig 的 rest 本身就是站立 A 姿（实测 LeftArm 朝向 (-0.12,+0.22,-0.97)，
// 即手臂自然垂下），所以站姿=全零增量。TRIPO_POSE 那套 spine1 前倾 0.6rad(34°)
// 是"趴吧台"的取景姿势——第一人称下它让角色永远弓着背，用户报"没有站立动作"。
// MMD 档早就有"第一人称=站直 / 离开=伏桌"的双态，这里给 Tripo 档补齐同一语义。
const TRIPO_STAND: PoseTable = {
  spine1: [0, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  lArm: [0, 0, 0],
  lFore: [0.12, 0, 0], // 肘微屈，纯直臂像木偶
  rArm: [0, 0, 0],
  rFore: [0.12, 0, 0],
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
// Tsumire（BOOTH 购入的 VRChat 档）：rest 是**T-pose**——双臂水平外展。
// 这和 Tripo 档（rest 即 A 姿，站姿=全零）根本不同：这里站姿必须把手臂主动压下来，
// 否则角色会像稻草人一样平举双臂。数值为 rest-relative 增量，实测定稿。
// 轴向实测（从 GLB 直接解算骨骼世界基向量，不靠猜）：这套骨架**局部 Y 沿骨延伸**，
// 而左右臂的**局部 X 才是"抬手/垂手"轴**（左臂局部X→世界(0,0,-1)、右臂→(0,0,1)，
// 两侧都对应绕世界 Z 转），局部 Z 是前后摆。第一版误用 Z 让手臂朝镜头平伸出去。
// 两臂同为正值不是笔误——左右骨的局部 X 指向相反，正转都得到"垂下"。
const TSUMIRE_STAND: PoseTable = {
  spine1: [0, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  lArm: [1.35, 0, 0], // 从 T 姿水平压到贴身（77°，留一点腋下间隙不贴死）
  lFore: [0.15, 0, 0], // 肘微屈，纯直臂像木偶
  rArm: [1.35, 0, 0],
  rFore: [0.15, 0, 0],
};
// 伏桌取景姿势：腰前倾 + 手臂放下再前伸搭上桌沿
const TSUMIRE_POSE: PoseTable = {
  spine1: [0.6, 0, 0],
  neck: [0.35, 0, 0],
  head: [0.35, 0, 0],
  lArm: [1.15, 0, 0],
  lFore: [0.5, 0, 0],
  rArm: [1.15, 0, 0],
  rFore: [0.5, 0, 0],
};

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
      /** 反向排除：prefixes 之间会误伤时用（匹配是归一化子串，见 SpringBoneSim 注释） */
      exclude?: string[];
      opts: { stiffness?: number; drag?: number; gravity?: number };
      uprightOpts?: { stiffness?: number; drag?: number; gravity?: number };
    }>;
    /** 弹簧骨球形碰撞体（NPC Milltina 同款配方：防长发/裙链穿头穿身）。
     *  骨名 + 世界半径 + 骨局部偏移（世界量纲，只随骨旋转）。 */
    springColliders?: Array<{ bone: string; radius: number; offset?: [number, number, number] }>;
    /** FPS 隐头（Tripo 系防后脑勺入画）；MMD 系弯腰伏桌姿势头在画内，隐头会露白色颈桩 */
    hideHead?: boolean;
    /** think 生效范围：Tripo=showSelf（含自由视角）；MMD=仅卡组特写（自由视角应看到伏桌常态） */
    thinkDeckOnly?: boolean;
    /** 第一人称（眼位）下改用的站立姿势；不填则沿用 pose */
    standPose?: PoseTable;
    /** 踩脚凳高度（世界单位）：矮个角色垫高用。
     *  桌沿在 y=0.25，胸口要越过它才够得着牌桌——Tsumire 身高 3.88 单位时胸口只有
     *  0.02，比桌沿还低 0.23，不垫高就是"趴在桌腿边"。垫高后角色整体上移，
     *  脚下渲染一只木凳补上视觉逻辑（不然人悬空）。 */
    standOn?: number;
  }
> = {
  // 体格/落地重定（与 rin/gratia 同一标尺）：模型脚底=原点、局部身高 0.92，
  // 旧值 scale4.3+y-2.9 = 身高 3.96 单位(1.57m) 且脚陷地 0.5——第一人称眼位只比
  // 桌沿高 7cm（眼位读的是真实头骨，模型矮=视角矮）。
  // 定标：吧台 2.65 单位=1.05m → 1m≈2.52 单位；身高 1.77m=4.46 单位 → scale 4.85
  m: { yaw: Math.PI / 2, scale: 4.85, y: -2.4, z: 4.95, pose: TRIPO_POSE, standPose: TRIPO_STAND, hideHead: true },
  f: { yaw: Math.PI / 2, scale: 4.85, y: -2.4, z: 4.95, pose: TRIPO_POSE, standPose: TRIPO_STAND, hideHead: true },
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
    // 球形碰撞体（NPC Milltina 同款配方；Blender 实测本模型，世界量纲=局部×2.5）：
    // 头球 0.36 卡在"后脑网格 0.37"内侧且小于"马尾根距 0.39"——球过大会把发根
    // 常年顶出造成弹跳（NPC 调参时踩过的坑）。Spine1 与 Hips 骨同点（腰部），
    // 胸球沿骨轴上移 0.35 到胸口
    springColliders: [
      { bone: "mixamorig:Head", radius: 0.36 },
      { bone: "mixamorig:Spine1", radius: 0.4, offset: [0, 0.35, 0.03] as [number, number, number] },
      { bone: "mixamorig:Hips", radius: 0.36 },
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
    // 同名骨存在则生效（UE 转制骨架若命名不同会自动跳过，不报错）
    springColliders: [
      { bone: "mixamorig:Head", radius: 0.36 },
      { bone: "mixamorig:Spine1", radius: 0.4, offset: [0, 0.35, 0.03] as [number, number, number] },
      { bone: "mixamorig:Hips", radius: 0.36 },
    ],
  },

  // Tsumire（BOOTH 购入 VRChat 角色，FBX→GLB 后骨名已改成 mixamo 规范）。
  // 定标：局部身高 0.95、脚底=原点；按"1m≈2.52 单位"折算 1.55m ⇒ 3.9 单位 ⇒ scale 4.1
  tsumire: {
    yaw: Math.PI,
    scale: 4.1,
    y: -2.41,
    z: 4.95,
    pose: TSUMIRE_POSE,
    standPose: TSUMIRE_STAND,
    hideHead: true,
    // 垫 0.55 单位（≈22cm）：胸口 0.02 → 0.57，与 rin 的 0.59 同档，稳稳越过桌沿 0.25
    standOn: 0.55,
    // 摇摆骨分四组。这个模型自带完整物理骨链（后发 4 节 ×3 股、双马尾 3 节、
    // 裙 8 片 ×3 节、尾巴 6 节、缎带、猫耳）——名字里的 haiir 是原作者的拼写，
    // 别"修正"成 hair，改了就匹配不上。
    springGroups: [
      // 及腰长发：重力主导垂坠（重力项 ×0.1 衰减，gravity/10 ≥ stiffness 才垂得下来）
      {
        prefixes: ["haiir_back"],
        opts: { stiffness: 2.5, drag: 0.35, gravity: 12 },
        uprightOpts: { stiffness: 5, drag: 0.3, gravity: 1.6 },
      },
      // 双马尾：比后发硬一档。它们挂在耳侧、离胸口很近，全垂坠会被胸口碰撞球顶着
      // 往前甩到身前（实测踩到）——保形为主、只让发梢微垂
      {
        prefixes: ["twintail_"],
        opts: { stiffness: 4.5, drag: 0.35, gravity: 5 },
        uprightOpts: { stiffness: 6, drag: 0.3, gravity: 1.6 },
      },
      // 猫尾：保形，不能垂。原作造型是向后翘的弧线，一旦按重力垂直挂下来就会
      // 从裙子中间穿出去（实测：笔直插到膝盖下方）
      // exclude 双马尾：归一化后 "twintail_L"→"twintaill" 含子串 "tail"，不排掉的话
      // 这 6 根骨会同时被本组和双马尾组驱动，两套 sim 每帧互相覆写 = 头发抽搐
      { prefixes: ["Tail"], exclude: ["twintail"], opts: { stiffness: 6, drag: 0.3, gravity: 1.2 } },
      // 刘海/侧发/缎带/猫耳：贴脸贴头的短链，任何垂坠残态都会帘住脸，刚性保形
      { prefixes: ["Hair_Front", "Hair_Side", "ribbon", "Ear"], opts: { stiffness: 5, drag: 0.3, gravity: 1.6 } },
      // 百褶裙 8 片：垂坠弹簧近似布料
      { prefixes: ["Skirt"], opts: { stiffness: 1.5, drag: 0.35, gravity: 20 } },
    ],
    // 碰撞球半径按**本模型实测网格半径**给，不是照抄 rin——rin 那套（头 0.36/
    // 胸 0.4/胯 0.36）对这个体格偏大，会把发链常年顶在球面上，表现就是双马尾
    // 被推到身前。实测该模型各高度带的水平半径中位数：
    //   头部带(脸身) 0.297 · 胸部带(衣物) 0.262 · 胯部带(衣物) 0.288
    // 头球取颅骨半径而不是头发半径（0.418），否则发根直接被顶出去。
    springColliders: [
      { bone: "mixamorig:Head", radius: 0.3 },
      { bone: "mixamorig:Spine1", radius: 0.27, offset: [0, 0.22, 0.02] as [number, number, number] },
      { bone: "mixamorig:Hips", radius: 0.29 },
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

/** 踩脚凳：矮个角色垫高用的圆木凳（程序化，不额外加载资源）。
 *  挂在玩家 group 之下，所以跟着角色的位置与朝向走；坐标以"角色脚底"为 0 向下建。
 *  用深木色 + 高粗糙度，与书房的木地板/木柜同材质语言。 */
function FootStool({ height }: { height: number }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 0.85 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const r = height * 1.15; // 座面半径：略宽于高度，看着稳
  const legR = height * 0.09;
  const legY = -height / 2;
  const legOff = r * 0.62;
  return (
    <group position={[0, -0.02, 0]}>
      {/* 座面 */}
      <mesh position={[0, -height * 0.12, 0]} material={mat}>
        <cylinderGeometry args={[r, r * 0.94, height * 0.22, 20]} />
      </mesh>
      {/* 三条腿（三点着地不会晃） */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        return (
          <mesh key={i} position={[Math.sin(a) * legOff, legY, Math.cos(a) * legOff]} material={mat}>
            <cylinderGeometry args={[legR, legR * 1.15, height * 0.78, 10]} />
          </mesh>
        );
      })}
      {/* 横撑：三条腿之间的加固环，低模也要有结构感 */}
      <mesh position={[0, -height * 0.72, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat}>
        <torusGeometry args={[legOff, legR * 0.5, 6, 18]} />
      </mesh>
    </group>
  );
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
  /** settle 当前处于哪个状态：站姿 / 正在播走位 / 已伏桌定格 */
  const settleMode = useRef<"stand" | "playing" | "leaned" | null>(null);

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
    settleMode.current = null; // 换形象重挂载：按当前机位重新决定站/伏
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
  /** 上一帧我们写进头骨的值：与本帧读到的比对即可判断 mixer 有没有重写过。
   *  原来靠"状态切换时置空、下帧重取"，而置空期间头由动画驱动、之后又被按回旧基准，
   *  来回切就是可见的抽搐（NPC 侧同样的写法已证实是抽搐源）。 */
  const headWritten = useRef<THREE.Quaternion | null>(null);
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

  /** 取注视基准：与上一帧写入值不同=mixer 刚写过（当前值即新基准）；
   *  完全相同=mixer 已停写（clamp 定格），沿用旧基准。不需要状态机与等待帧。 */
  function syncHeadBase(head: THREE.Object3D) {
    if (!headBase.current) headBase.current = head.quaternion.clone();
    else if (!headWritten.current || !head.quaternion.equals(headWritten.current))
      headBase.current.copy(head.quaternion);
    else head.quaternion.copy(headBase.current);
  }

  // 头部注视覆盖：以"当前头骨四元数"为底，按目光窗口把头限幅转向实际镜头
  // （think 分支=mixer 采样后；MMD 分支=姿势写入后——两处共用）
  function applyGaze(head: THREE.Object3D, t: number, camera: THREE.Camera) {
    // 基准同步必须在函数内部做：曾经有两个调用点直接 premultiply 而不管基准，
    // 其中一处还是在动画被冻结（timeScale===0，mixer 停写头骨）时调用的——
    // 增量每帧往上叠，一个 2~3s 的注视窗口累积上百次，头会一路转出去再弹回来。
    // 这就是用户报的"镜头到某些位置时头部上下旋转抽搐"。
    syncHeadBase(head);
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
      // 偏航/俯仰分离限幅（见 gazeDelta.ts）：原来的 setFromUnitVectors 在
      // baseDir 与 camDir 接近反向时旋转轴会整个翻掉，镜头绕到特定位置头就来回甩
      gazeDelta(gv.baseDir, gv.camDir, PLAYER_GAZE, weight, gv.qDelta);
      // 世界系增量 → 头骨局部系：local' = P⁻¹·Δ·P·local
      head.parent!.getWorldQuaternion(gv.qParent);
      gv.qTmp.copy(gv.qParent).invert().multiply(gv.qDelta).multiply(gv.qParent);
      head.quaternion.copy(headBase.current!).premultiply(gv.qTmp);
    }
    if (!headWritten.current) headWritten.current = head.quaternion.clone();
    else headWritten.current.copy(head.quaternion);
  }

  // 弹簧骨物理（MMD 移植模型发链，分组不同手感）；垂发用桌面/地板平面碰撞承接，
  // 头/胸/髋球形碰撞体防穿模（NPC 同款配方，骨名解析容错冒号剥离）
  const springSims = useMemo(() => {
    if (!rig.springGroups?.length) return null;
    const clampY = (p: THREE.Vector3) => (p.z < 3.42 ? 0.03 : -2.38);
    const colliders: SphereCollider[] = [];
    for (const c of rig.springColliders ?? []) {
      const bone = gltf.scene.getObjectByName(c.bone) ?? gltf.scene.getObjectByName(c.bone.replace(/:/g, ""));
      if (bone)
        colliders.push({ bone, radius: c.radius, offset: c.offset ? new THREE.Vector3(...c.offset) : undefined });
    }
    const sims = rig.springGroups
      .map((g) => ({
        sim: new SpringBoneSim(gltf.scene, g.prefixes, { ...g.opts, exclude: g.exclude, clampY, colliders }),
        base: g.opts,
        upright: g.uprightOpts,
      }))
      .filter((s) => s.sim.jointCount > 0);
    if (import.meta.env.DEV) {
      console.log("[player springs] joints:", sims.map((s) => s.sim.jointCount).join("+"), "colliders:", colliders.length);
      // 自检：同一根骨被多组驱动 = 每帧互相覆写 = 抽搐。子串匹配很容易误伤，
      // 与其等肉眼发现不如开发期直接喊出来
      const own = new Map<string, string[]>();
      sims.forEach((s, gi) =>
        s.sim.boneNames().forEach((n) => own.set(n, [...(own.get(n) ?? []), rig.springGroups![gi].prefixes.join("/")])),
      );
      const dup = [...own].filter(([, gs]) => gs.length > 1);
      if (dup.length) console.error("[player springs] ⚠ 骨被多组重复驱动（会抽搐）:", dup);
      // E2E/调参挂钩：浏览器控制台可直接量测骨骼、实时改弹簧参数（setParams 每帧应用）
      (window as unknown as Record<string, unknown>).__playerGltf = gltf.scene;
      (window as unknown as Record<string, unknown>).__playerSprings = sims;
    }
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
    // 第一人称眼位：相机就在她头骨上 → 站姿 + 隐藏头部（否则相机在颅内）
    const eyeView = st.camera.kind === "default";
    // 卡组视角、或用户正绕着玩家做球面运动时露脸+保持思考姿势
    const showSelf = st.deckView || st.orbit?.target === "player";
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
        // 钉帧采样**只做这一次**。此前每帧 mixer.update：钉帧动画每帧把弹簧骨链
        // 重写回 rest 姿势，与随后的弹簧解交替出现在渲染里（实测马尾尾骨 72% 帧
        // 反转运动方向、在两个姿势间高频跳变）——就是"头发一直抽搐"。
        // 采样一次后骨骼交由弹簧/注视接管；身体骨无人再写，保持钉帧姿势不变。
        mixer.update(0.000001);
        gltf.scene.updateMatrixWorld(true);
      }
      // ── 头部注视：mixer 采样后以基准四元数为底、按目光窗口叠加限幅转头 ──
      const head = bones.current.head;
      if (head) {
        applyGaze(head, t, camera);
      }
    } else if (settleAction) {
      // ── MMD 档 settle 双态：第一人称眼位=站姿（钉首帧），离开眼位=伏桌（播走位后钉末帧）──
      if (thinkAction && (thinkAction.isRunning() || thinkAction.paused)) thinkAction.stop();
      const dur = settleAction.getClip().duration;
      const want = eyeView ? "stand" : "leaned";
      if (settleMode.current !== want) {
        if (want === "stand") {
          // 回眼位：直接站直（相机就在她头上，倒放会把镜头一路甩上去）
          settleAction.stop();
          settleAction.reset().play();
          settleAction.time = 0;
          settleAction.timeScale = 0;
          settleMode.current = "stand";
        } else if (settleMode.current === "stand") {
          // 离开眼位：完整播一遍撤步弯腰伏桌。**必须 stop+reset+play 整段重启**——
          // 站姿是用 timeScale=0 钉住的，那会让 action 在 mixer 里失活，
          // 单把 timeScale 改回 1 并不会复活（isRunning 仍为 false，随即被判定播完）
          settleAction.stop();
          settleAction.reset().play();
          settleAction.time = 0;
          settleAction.paused = false;
          settleAction.timeScale = 1;
          settleMode.current = "playing";
        } else if (settleMode.current !== "playing") {
          settleAction.stop();
          settleAction.reset().play();
          settleAction.time = dur;
          settleAction.timeScale = 0;
          settleMode.current = "leaned";
        }
      }
      if (settleMode.current === "playing") {
        // 只在真正跑起来之后才认"播完"（time>0 的前提防止启动帧被误判）
        if (
          settleAction.paused ||
          settleAction.time >= dur - 1e-3 ||
          (settleAction.time > 0 && !settleAction.isRunning())
        ) {
          settleAction.paused = false;
          if (!settleAction.isRunning()) settleAction.reset().play();
          settleAction.time = dur;
          settleAction.timeScale = 0;
          settleMode.current = "leaned";
        }
      }
      // 夹住 dt：它是真实墙钟差，一次卡顿/切回标签页就能让整段撤步弯腰走位一帧演完
      // （与 CameraRig 滑梯同源的坑）。钉帧态 timeScale=0 时 dt 大小无所谓
      mixer.update(Math.min(dt, 0.05));
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__settleDbg = {
          mode: settleMode.current,
          t: +settleAction.time.toFixed(3),
          ts: settleAction.timeScale,
          run: settleAction.isRunning(),
          paused: settleAction.paused,
          dt: +dt.toFixed(3),
        };
      }
      // think 退出复位：手骨不在 settle 轨道里，不显式回 rest 会卡在托腮内旋态
      const lh = bones.current.lHand;
      if (lh && restQ.current.lHand) lh.quaternion.copy(restQ.current.lHand);
      // 伏桌定格后叠加注视镜头（自由视角/卡组均有生命感；过渡播放期也无害）
      const head2 = bones.current.head;
      if (head2 && settleAction.timeScale === 0) applyGaze(head2, t, camera);
    } else {
      if (thinkAction && (thinkAction.isRunning() || thinkAction.paused)) thinkAction.stop();
      // 第一人称=站直，其余机位维持趴吧台取景姿势（与 MMD 档 settle 双态同语义）
      const table = eyeView && rig.standPose ? rig.standPose : p2;
      for (const k of Object.keys(BONES) as (keyof typeof BONES)[]) {
        const n = bones.current[k];
        const v = table[k] as [number, number, number] | null;
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
    // 眼位环视：把滑屏累积的偏航/俯仰施加到头骨（脖子跟着转，头发/项链随之摆），
    // 相机朝向由 CameraRig 用同一组角度求出——两边同源所以永远一致
    if (eyeView && bones.current.head && restQ.current.head) {
      // 升空俯瞰时环视角平滑衰减回正：头此刻是可见的，带着累积偏转会
      // 歪着脖子扎进头发里（实测穿模来源）；回正后头发与头姿态一致
      if (eyeRise.v > 0.02) {
        const decay = Math.exp(-dt * 6);
        eyeLook.yaw *= decay;
        eyeLook.pitch *= decay;
      }
      gv.ePose.set(-eyeLook.pitch, -eyeLook.yaw, 0, "YXZ");
      bones.current.head.quaternion
        .copy(restQ.current.head)
        .multiply(gv.qPose.setFromEuler(gv.ePose));
      gv.ePose.order = "XYZ"; // 复用的 Euler，用完还原免得污染姿势写入
    }
    // 头部：只有相机真的贴在头骨上（颅内视角）才隐藏——按**相机与头的实际距离**
    // 判定而不是按视角模式。第一人称眼位相机距头 ~0.13 → 隐藏；双指捏合升空后
    // 距离迅速拉开 → 头部随即显示，从头顶俯瞰时角色是完整的。
    // Tripo 系的 hideHead（防后脑勺入画）同样吃距离闸：镜头拉开后没有入画问题。
    const head = bones.current.head;
    if (head) {
      // 眼位锚点：头骨世界坐标（隐藏用的是 scale，世界位置依然有效）
      head.getWorldPosition(PLAYER_HEAD);
      const camDist = camera.position.distanceTo(PLAYER_HEAD);
      const wantHide = camDist < 1.0 && (eyeView || (rig.hideHead && !showSelf));
      const s = wantHide ? 0.001 : 1;
      if (head.scale.x !== s) head.scale.set(s, s, s);
    }
    // deckY 下沉只在卡组特写（挂到 showSelf 会让自由视角浏览时角色突然沉降）
    const baseY = (st.deckView && p2.deckY !== undefined ? p2.deckY : p2.y) + (rig.standOn ?? 0);
    if (group.current) group.current.position.set(0, baseY + (showSelf ? breathe * 0.6 : 0), p2.z);
    // 弹簧骨在姿势之后模拟（读最新世界矩阵，回写局部旋转）。
    // upright 参数只在 think 动画真实生效（真·直立特写）时切换——MMD 档卡组视角
    // 走的是 settle 伏桌姿势，thinkActive 虽为 true 但姿势没直立，仍该用垂坠参数
    if (springSims) {
      gltf.scene.updateMatrixWorld(true);
      const upright = thinkActive && !!thinkAction;
      for (const s of springSims) {
        s.sim.setParams(upright && s.upright ? s.upright : s.base);
        s.sim.update(dt);
      }
    }
  });

  return (
    <group ref={group} position={[0, pose.y + (rig.standOn ?? 0), pose.z]}>
      <primitive object={gltf.scene} scale={rig.scale} />
      {rig.standOn ? <FootStool height={rig.standOn} /> : null}
      {HOVER_PROPS[avatar] && <HoverProp cfg={HOVER_PROPS[avatar]!} />}
      {/* 玩家侧补光：烛光都在桌北，肩臂需要一点暖光才可读 */}
      <pointLight position={[0, 4.2, -0.6]} intensity={6} distance={7} color="#ffdbb0" />
    </group>
  );
}
