// 卡片工坊 3D 场景：长桌 + 中线 + NPC 铸卡师 + 卡组 + 市场平摊 + 节点链 + 拖拽层。
// 固定机位只露出双方手部/上身与桌面（NPC 不建头部模型）。
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { ThreeEvent, advance, useFrame, useLoader, useThree } from "@react-three/fiber";
import { FlowNode, useFlow } from "../flowStore";
import { chosenProposal, composable, placeholderVisible, useStudio, Flight } from "../studioStore";
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
  marketSlot,
  RIGHT_STACK,
  SPREAD,
  TABLE,
  chainX,
  focusCam,
} from "./layout";
import { npcModelUrl } from "../quality";
import {
  NPC_HEAD,
  NPC_SCREEN,
  PLAYER_SCREEN,
  deckCamArrived,
  ORBIT_LIMITS,
  ORBIT_MIN_Y,
  PLAYER_HEAD,
  PLAYER_TORSO,
  playerEye,
  addEyeLook,
  addEyeRise,
  clampRadiusByScene,
  eyeLook,
  eyeRise,
  EYE_RISE_LOOK_OFF,
  resetEyeRise,
  orbit,
  orbitToPosition,
  syncOrbitFromCamera,
} from "./cameraOrbit";

// 委托定制模型 Milltina（默认铸卡师，**自有版权**）的配置
// （模块级常量：内联对象会让 TripoNpc 的 memo 每帧重建）
// FBX 静止姿势是 T-pose；轴向实测：x−=垂臂（z 是水平前摆别用），微量 z 让手贴身
const MILLTINA_CFG = {
  scale: 3.35,
  // 脚底在模型系 z=-0.031、地板 FLOOR_Y=-2.4 → y 必须 =-2.4+0.031*3.35，否则站姿整个
  // 下半身陷进地板（旧值 -2.55 陷 0.25，被吧台挡住没露馅；俯身自由视角就穿帮）。
  // leanSlide.y 同步减去这 0.254，俯身态净高度不变
  // 无头量测复核：脚底实为 -0.034461（旧注释写 -0.031），旧值仍陷地 0.011
  y: -2.285,
  z: -4.3,
  yaw: 0,
  pose: {
    lArm: [-1.15, 0, 0.12] as [number, number, number],
    rArm: [-1.15, 0, -0.12] as [number, number, number],
  },
  // 双马尾/牛耳/缎带/前发弹簧物理（骨链名匹配，忽略大小写与符号）
  springs: ["twintail", "cowear", "ribbon", "fronthair"],
  // 垂落卷马尾的手感（捕帧 A/B 调定）：默认 14 几乎刚性；4 起身甩动明显、
  // 静止 ~1.5s 收敛到呼吸级残摆，无发散无穿模。drag 再低会晃过头
  springOpts: { stiffness: 4, drag: 0.28 },
  // 刘海单独调硬：它离脸只有 0.0187 模型单位余量（实测脸最前端距头骨 0.0759），
  // 用双马尾那套软参数（k=4）时头一点它就落在后面，脸直接从刘海里钻出来。
  // 刚度不能给太大：回弹项是"固定长度世界位移，之后才归一化到骨长"，k·Δt=30/60=0.5
  // 已是刘海骨长（世界 0.099~0.122）的 4~5 倍，而碰撞是在归一化**之前**判定的——
  // 实测一个注视窗口内 8 个刘海关节命中 Spine1 碰撞球 576 次（幽灵接触）。
  // k=8 单步已能纠正 57% 的角误差，跟随足够且零幽灵接触。
  springOverrides: { fronthair: { stiffness: 8, drag: 0.6, gravity: 0.4 } },
  // 球形碰撞体（世界量纲，站姿实测：头心 y0.873/马尾根距 0.38、胸 y0.05、髋 y-0.29）
  // 头部碰撞球半径必须卡在"脸最前端 0.254"与"刘海骨尾端最近 0.267"之间（世界，实测）：
  // 原来的 0.34 把 8 个刘海关节里的 6 个常年往外顶——静止穿透会让弹簧一直被推，
  // 推力方向又随头的转动翻转，点头时就"啵"地弹一下，脸从错位的刘海里露出来。
  springColliders: [
    { bone: "mixamorig:Head", radius: 0.26 },
    { bone: "mixamorig:Spine1", radius: 0.42, offset: [0, 0.1, 0.04] as [number, number, number] },
    { bone: "mixamorig:Hips", radius: 0.38 },
    // 胸球挂在 Breast 骨上（随胸物理动态走）：裙摆/围裙带擦过胸前时被托在布料外。
    // 前偏 0.05：球面要探到布料表面（胸尖前凸 ~0.15），0.02 时球面还埋在布里
    { bone: "Breast_L", radius: 0.155, offset: [0, 0, 0.05] as [number, number, number] },
    { bone: "Breast_R", radius: 0.155, offset: [0, 0, 0.05] as [number, number, number] },
    // 上胸中缝球（挂 Neck，随弯腰跟转）：领结 RibbonA/B 是**短飘带**（尾端世界 y0.85
    // 站姿实测），远够不到胸球（球顶 y0.67）——穿模位置在领口下方的上胸中缝，那里只有
    // Spine1 大球边缘擦过、托不住。球心=Neck 下前方（站姿 ≈0,0.80,-4.24），前缘 z-4.11
    // 恰在布料外一线，飘带全程被托着贴布下垂
    { bone: "mixamorigNeck", radius: 0.13, offset: [0, -0.167, 0.106] as [number, number, number] },
  ],
  // 衣装/头发暖灰乘暗融入烛光暗房；脸+皮肤单独亮乘色（官方宣传图=亮脸平光，
  // 全局压暗会把眼白压灰、眼周暗成"眼影"）；浅色模型描边用固定深紫黑
  look: {
    tint: 0xbfb2a4,
    outlineColor: 0x2a2230,
    faceTint: 0xeae2d8,
    hairTint: 0xb9bcc4,
    // ↓ 两笔加色，移植自 Blender 插件「Paper朱二次元渲染助手」（见 toonify 里的注释）。
    // 工坊是烛光暗房，基准画面里她整个人是**贴在背景上**的一块暗绿——三阶 toon ramp
    // 只分明暗档、不认视线夹角，做不出把人和背景分开的那一笔。
    // 阈值全部按本场景灯光实测重定过，插件原值在这里一个都不能用（原因写在 toonify）。
    rimLight: { from: 0.24, to: 0.62 },
    // 高光只给头发：铺全身实测会把裙子变成"湿乳胶"（四组参数无一例外）。
    // 二游那种漂亮高光靠的是手绘高光图/发丝各向异性，单一 Blinn 复刻不了，
    // 但发片细长带弧度，一条带正好读作发丝反光。
    specBand: { match: ["hair"], strength: 0.4 },
  },
  // 表情=模型出厂默认脸（官方宣传图即默认脸）+瞬时全闭眨眼；不加任何常驻表情。
  // 自带 nagomi 慵懒眼可用 restMorphs:{eye_nagomi_1:x, brow_nagomi:x} 随时开
  blinkBase: 0,
  smileBase: 0,
  // 俯身位移（撤步弯腰版）：back=撤步后退量；z/y=落定净位移（深弯腰的胸前伸
  // 距离大，净前移比旧直立俯身小得多；高度由弯腰角带下来，y 只微调）
  // y 0.47：桌沿落到她模型系 0.695——左前臂轴 0.711 压进沿面 ~0.01（挤压接触），
  // 右前臂叠其上 0.743、胸再压臂堆；沿顶<臂<胸三层排开且身体抬升被吧台遮挡
  leanSlide: { back: 0.42, z: 0.08, y: 0.216 },
  // 胸部软体物理：Breast 骨链弹簧 + 前臂/桌沿/对侧胸/躯干碰撞——手压、桌沿顶、
  // 左右互斥全由接触解出（此前逐帧手调旋转永远修不干净三处穿模）
  breastPhys: {
    // 软（低刚度）+ 重（大重力）：胸自然垂落到臂圈上，被前臂/桌沿顶回去=真实挤压；
    // radii 按实测标定——胸尖距臂轴 0.18，半径和须 >0.18 才谈得上接触
    // drag 0.88：接触点上"重力拉下↔碰撞推上"会自激振荡（0.62 时实测抖动 0.074/帧
    // 肉眼可见颤动），高阻尼把它压成静态接触
    // 强回弹+轻重力：胸稳定保持在 lift 给的饱满形状上，只在碰到手臂/桌沿/对侧胸时
    // 被推开（gravity/stiffness 高会塌，低于 0.1 则毫无软感）
    stiffness: 20,
    drag: 0.85,
    gravity: 1.2,
    // 半径贴合实际胸型（过大→被躯干球推到体侧摊平，实测 x 被顶到胸根的两倍）
    radii: [0.13, 0.11, 0.09],
    // 胸根跟随：0.9 抬得足；上限 0.16（世界≈锁骨下缘，再高会窜到锁骨以上）；
    // smooth 2.5 低通——瞬时值会正反馈自激成抽动
    rootLift: 0.9,
    rootLiftMax: 0.16,
    rootLiftSmooth: 2.5,
    armRadius: 0.075,
    rail: { y: 0.08, z: -3.55, radius: 0.17 },
    // 躯干球=胸壁：胸挂在它上面才饱满（关掉会塌回身体成平面；0.12 又会顶到体侧）
    torsoRadius: 0.08,
    // 中缝保留 1.05：弯腰挤压时两团横距比站姿再开 5%，门襟扣子从沟里露出来；
    // 深度（前凸/托起）不受限——保留"陷进沟里"的凹陷感，只是不再整条埋没
    medialKeep: 1.05,
  },
  // 接触托胸：上抬(x−)+外分(splay)+躯干下沉(sink，重量压胸感)。上抬角要克制——
  // 裙子 Apron_set 形态胸口自带 X 褶皱设计，抬得越猛两团越被顶进褶皱区读作"重叠"
  // 接触表五轮定稿（Q2 组，倾斜躯干系修正）：臂位锚定**胸根褶线**（Breast 根骨
  // 沿倾斜躯干轴向下 0.045+胸壁法向外 0.095——用世界 Z 判"下方"会落在乳头位把胸
  // 往里压），胸垂搭臂圈上被顶起；上旋回轻档（托举靠臂位，不靠强旋硬掰）
  // 分工定稿：**形状（饱满托起）由 lift 给 rest，物理只做接触避让+微动**——每侧仅 2 个
  // 弹簧关节撑不出体积，纯靠重力垂落会塌成平面（实测 y 0.56→0.43 胸整个贴回身体）
  breastLift: { angle: -0.3, childAngle: -0.15, splay: 0.24, sink: 0.06, swell: 0.15 },
};

import {
  cardBackTexture,
  composePlateTexture,
  composeSigilTexture,
  runeRingTexture,
  cardFaceTexture,
  labelTexture,
  placeholderTexture,
  proposalTexture,
  ringTexture,
  tickCardFades,
} from "./cardTexture";
import CardMesh from "./CardMesh";
import MagicStudy from "./MagicStudy";
import VrmNpc from "./VrmNpc";
import TripoNpc from "./TripoNpc";
import { MILLTINA_FACE } from "./faceExpr";
import PlayerArms from "./PlayerArms";

// 默认 = 全身版（站立↔对话俯身状态机，用户定稿）；?npc=tripo 早期全身试验版 / ?npc=vrm 回退 VRM
const NPC_VARIANT = new URLSearchParams(window.location.search).get("npc") ?? "full";

// ── 节点链布局：窗口化 + 焦点跟随 ─────────────────────────────
// 节点多于 maxVisible 时溢出的收到左右两侧的收起堆；窗口默认贴链尾，
// 但**聚焦中的节点必须平摊在窗口内**——聚焦窗外节点时窗口平移把它居中
// （被挤出去的后段节点收到右侧堆）。堆里的卡可点击聚焦，窗口随之跟过去。
export interface ChainLayout {
  items: Array<{ node: FlowNode; x: number | null; stack: "left" | "right" | null; stackIndex: number }>;
  placeholderX: number | null;
}

/** 机位坐标是不是能用：三元组齐全且都是有限数。
 *  NaN 一旦进了 camera.position，之后所有 lerp 都会被污染成 NaN，画面直接黑掉，
 *  而且不会报错——比缺字段更难查，所以一并挡在这里。 */
function camOk(c: unknown): c is { pos: number[]; look: number[] } {
  const v = c as { pos?: unknown; look?: unknown };
  const ok3 = (a: unknown) => Array.isArray(a) && a.length >= 3 && a.every((n) => typeof n === "number" && Number.isFinite(n));
  return ok3(v?.pos) && ok3(v?.look);
}

export function computeChain(path: FlowNode[], focusId?: string | null): ChainLayout {
  const ph = placeholderVisible(path);
  const total = path.length + (ph ? 1 : 0);
  let start = Math.max(0, total - CHAIN.maxVisible);
  if (focusId) {
    const fi = path.findIndex((n) => n.id === focusId);
    if (fi >= 0 && (fi < start || fi >= start + CHAIN.maxVisible)) {
      // 以聚焦节点为中心平移窗口（夹在链两端之间）
      start = Math.min(Math.max(0, fi - Math.floor((CHAIN.maxVisible - 1) / 2)), Math.max(0, total - CHAIN.maxVisible));
    }
  }
  const end = start + CHAIN.maxVisible;
  return {
    items: path.map((node, i) => ({
      node,
      x: i >= start && i < end ? chainX(i - start) : null,
      stack: i < start ? ("left" as const) : i >= end ? ("right" as const) : null,
      stackIndex: i,
    })),
    // 空白占位卡永远排在链尾：窗口没覆盖到链尾时它随尾段一起收进右堆（不渲染）
    placeholderX: ph && path.length >= start && path.length < end ? chainX(path.length - start) : null,
  };
}

// ── 相机：朝目标位姿缓动（transient 直读 store，避免订阅延迟一帧） ──
// RIG_LOOK 提到模块级：手势层需要读取当前视线锚点
const RIG_LOOK = new THREE.Vector3(...DEFAULT_CAM.look);

/** 解析当前轨道圆心（player/npc 每帧跟随头骨，node 用点击时记下的卡片坐标） */
export function resolveOrbitCenter(
  o: { target: "node" | "player" | "npc"; point?: [number, number, number] } | null,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  if (!o) return null;
  // 玩家用**上半身**中心而不是头骨：绕头转时身体被甩到画面外，转到侧后方只剩一颗头
  if (o.target === "player") return out.copy(PLAYER_TORSO);
  if (o.target === "npc") return out.copy(NPC_HEAD);
  return o.point ? out.set(o.point[0], o.point[1], o.point[2]) : null;
}

/** 第一人称眼位：站在玩家头部，基准朝向 NPC，再叠加环视偏航/俯仰（滑屏转头） */
function eyeCam(pos: THREE.Vector3, look: THREE.Vector3) {
  // 基准方向：头 → NPC，压平到水平面（否则俯仰会被基准的上下分量污染）
  _dirTmp.copy(NPC_HEAD).sub(PLAYER_HEAD);
  _dirTmp.y = 0;
  if (_dirTmp.lengthSq() < 1e-6) _dirTmp.set(0, 0, -1);
  _dirTmp.normalize();
  const base = Math.atan2(_dirTmp.x, _dirTmp.z);
  const yaw = base + eyeLook.yaw;
  const cp = Math.cos(eyeLook.pitch);
  // 眼点沿**水平朝向**前移（下一行先存起来），视线方向另算。
  // 曾经是沿视线方向前移，于是水平分量被乘上 cos(pitch)——低头 1.2rad 时
  // cos=0.36，0.34 的前移缩水成 0.12，相机重新退回颅骨内部，低头照样穿模。
  // 眼睛在颅内的位置不随俯仰变化，这里也不该变。
  _eyeFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _dirTmp.set(Math.sin(yaw) * cp, Math.sin(eyeLook.pitch), Math.cos(yaw) * cp);
  // 眼点 = 头骨中心 + 前移。**这个前移量必须按角色标定**：PLAYER_HEAD 取的是
  // mixamorig:Head 骨的世界坐标，而人形骨架里这根骨在颈椎顶端（下巴/耳根高度），
  // 眼睛还在它前方一截。头身比越夸张差得越远——Tsumire 实测头骨 z=4.948、
  // 脸部网格前表面 z≈4.63（差 0.32），而躯干皮肤 body002 跨 z 4.61~5.15，
  // 也就是说沿用旧的 0.12 会让相机**卡在颅骨内部**，往下看射线立刻从下巴/脖子
  // 内侧穿出去 = 用户报的"第一人称低头穿模"。前移到眼睛表面后同一机位是干净的：
  // 桌沿、地板、圆凳，画面下缘是自己的裙子和袖口。
  pos.copy(PLAYER_HEAD).addScaledVector(_eyeFwd, playerEye.forward);
  pos.y = PLAYER_HEAD.y + playerEye.up;
  look.copy(pos).addScaledVector(_dirTmp, 4.0);
}
const _dirTmp = new THREE.Vector3();
const _eyeFwd = new THREE.Vector3();
const _riseP = new THREE.Vector3();
const _riseL = new THREE.Vector3();

// EYE_RISE_LOOK_OFF 的安全性依赖**另外三个文件里的常量**：PlayerArms 的 SELF_GATE
// （藏头闸=相机离头 1.0）、下面升空目标高 8.6、以及 quintic 混合曲线。任何一个被单边
// 改动，门限就可能滑到"头已经露出来了但还允许环视"的区间——那正是当初歪脖子扎进
// 头发的成因。这条断言把这层隐含耦合摆到明处（本仓最近三次事故都是成对量单边改）。
if (import.meta.env.DEV) {
  const r = EYE_RISE_LOOK_OFF;
  const e2 = r * r * r * (r * (r * 6 - 15) + 10); // 与下面升空混合用的同一条 quintic
  const camDistAtGate = 7.6 * e2; // 眼点→头顶俯瞰点的距离尺度，实测约 7.6
  if (camDistAtGate >= 1.0)
    console.error(
      "[eyeRise] 环视门限已越过藏头闸：门限处相机离头 " +
        camDistAtGate.toFixed(2) +
        " ≥ SELF_GATE(1.0)，头会露出来而环视还开着。调小 EYE_RISE_LOOK_OFF 或重算。",
    );
}

function CameraRig() {
  const tmp = useRef(new THREE.Vector3());
  const ctr = useRef(new THREE.Vector3());
  const eyeP = useRef(new THREE.Vector3());
  const eyeL = useRef(new THREE.Vector3());
  const deckAnim = useRef<{ p: number; start: THREE.Vector3 } | null>(null);
  const prevDeck = useRef(false);
  const lastCamObj = useRef<unknown>(null);
  useFrame(({ camera, scene, clock }, dt) => {
    const st = useStudio.getState();
    // 节点卡卡面的首尾帧轮播（渐变期才真重绘，停留期内部直接返回）
    tickCardFades(clock.elapsedTime * 1000);
    // 新机位落位（点击互动点）→ 交还脚本运镜控制权
    if (lastCamObj.current !== st.camera) {
      lastCamObj.current = st.camera;
      orbit.active = false;
      // 回到第一人称就把升空量清零：eyeRise 是模块级单例、切路由不复位，
      // 而它停在 0.12~0.228 之间是哑态（环视被切断、头还藏着、画面没明显变化），
      // 用户没有任何线索却怎么拖都不动。见 resetEyeRise 的注释。
      if (st.camera.kind === "default") resetEyeRise();
    }
    const center = resolveOrbitCenter(st.orbit, ctr.current);
    // ── 用户已接管：纯球面轨道驱动，脚本运镜让位 ──
    if (orbit.active && center) {
      const lim = ORBIT_LIMITS[st.orbit!.target] ?? ORBIT_LIMITS.node;
      const safe = clampRadiusByScene(scene, center, orbit.radius, lim.min, clock.elapsedTime);
      const keep = orbit.radius;
      orbit.radius = safe;
      // 相机始终留在桌面之上：往下拖会让它沉进桌板，画面被木头糊死还看不出发生了
      // 什么。做法是**夹极角**而不是夹相机的 Y——夹 Y 会把相机从球面上拽下来：水平
      // 距离原样、垂直骤降，实测 phi=2.93/半径 2.2 时实际距离只剩 0.85，直接怼进
      // 角色胸口。极角上限按当前半径现解（拉远时同一个 phi 高得多，写死角度会近处
      // 不够、远处白丢行程），解完仍在球面上，半径不变。
      const cosMax = (ORBIT_MIN_Y - center.y) / safe;
      if (cosMax < 1) orbit.phi = Math.min(orbit.phi, Math.acos(Math.max(-1, cosMax)));
      orbitToPosition(center, tmp.current);
      orbit.radius = keep; // 只在渲染时收敛，不污染用户的缩放意图
      camera.position.copy(tmp.current);
      RIG_LOOK.copy(center);
      camera.lookAt(RIG_LOOK);
      prevDeck.current = st.deckView;
      // 用户中途接管轨道：镜头由手指控制、本来就是"稳定的"，按钮该出现。
      // **漏掉这条分支是最容易犯的错**——运镜途中拖一下镜头，按钮就永久不出现了
      deckCamArrived.v = st.deckView;
      return;
    }
    let target: { pos: readonly [number, number, number] | number[]; look: readonly [number, number, number] | number[] };
    if (st.camera.kind === "default") {
      // 升空到门限之上就把环视角衰减回正——**与环视闸门同一个门限、无条件执行**。
      // 理由见 EYE_RISE_LOOK_OFF：两个门限留缝就是"滑一下松手视角自己弹回去"。
      // dt 故意不夹：指数衰减对任意 dt 无条件稳定（本文件别处夹 dt 是别的原因，
      // 别顺手"修好"它）。
      if (eyeRise.v >= EYE_RISE_LOOK_OFF) {
        const decay = Math.exp(-dt * 6);
        eyeLook.yaw *= decay;
        eyeLook.pitch *= decay;
      }
      eyeCam(eyeP.current, eyeL.current);
      // 升空俯瞰混合：双指捏合把 eyeRise 从 0（眼位）推到 1（头顶正上方俯瞰全桌），
      // 平滑插值——捏合过程中相机沿"眼位→头顶"的弧线缓缓升起
      const r = eyeRise.v;
      if (r > 0.001) {
        const e2 = r * r * (3 - 2 * r);
        _riseP.set(PLAYER_HEAD.x * (1 - e2), 8.6, PLAYER_HEAD.z * (1 - e2) + 0.9 * e2);
        _riseL.set(0, 0, 0.35);
        eyeP.current.lerp(_riseP, e2);
        eyeL.current.lerp(_riseL, e2);
      }
      target = { pos: [eyeP.current.x, eyeP.current.y, eyeP.current.z], look: [eyeL.current.x, eyeL.current.y, eyeL.current.z] };
    } else {
      // ★ 机位来路不明就退回眼位，别信任 st.camera 的形状。
      //   下面直接取 target.pos[0..2]：只要有谁产出一个缺坐标或带 NaN 的 kind:"pos"
      //   （少传 focusNode 的 pos/look、算 x 时拿到 undefined、草稿里存进过脏值……），
      //   这里每帧抛一次错，整个 3D 页白屏且**自己好不了**——渲染循环挂了就没人再去
      //   改状态。一次 isFinite 换掉一类不可恢复的崩溃，很划算。
      target = camOk(st.camera) ? st.camera : { pos: [eyeP.current.x, eyeP.current.y, eyeP.current.z], look: [eyeL.current.x, eyeL.current.y, eyeL.current.z] };
    }
    // 第一人称把近裁剪面从 0.1 收到 0.03：眼点就在自己领口上方 6cm，0.1 的近面
    // 会把领口整片切掉——想"低头看见自己身体"就必须让它更近。实测 Tsumire 领口顶
    // 距眼 0.062，0.1 切、0.03 不切。只在眼位切换，其他视角维持 0.1 保住远景深度
    // 精度（far=80，0.03 会把比值推到 2667）。
    const wantNear = st.camera.kind === "default" && eyeRise.v < 0.5 ? 0.03 : 0.1;
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.near !== wantNear) {
      persp.near = wantNear;
      persp.updateProjectionMatrix();
    }
    // 手机竖屏（aspect<0.62）垂直 FOV 固定→水平视野变窄→卡组机位下人脸过大：自动后撤一档
    const narrowPull =
      st.deckView && (camera as THREE.PerspectiveCamera).aspect < 0.62 ? -0.3 : 0;
    if (st.deckView && !prevDeck.current) {
      deckAnim.current = { p: 0, start: camera.position.clone() };
      deckCamArrived.v = false; // 滑梯起飞：按钮先撤，落位再出
    }
    prevDeck.current = st.deckView;
    if (!st.deckView) {
      deckAnim.current = null;
      deckCamArrived.v = false; // 离开卡组视角
    }
    const anim = deckAnim.current;
    if (anim && st.deckView) {
      // 滑梯运镜：从眼位出发，绕到玩家左外侧拉远 → 一路下滑 → 收进玩家正前方、
      // 悬停在桌面高度。三次贝塞尔 + quintic 缓动；全程 lookAt 角色头部（而非固定点，
      // 这样她的头随姿势动镜头也始终盯着她）
      // dt 取自真实墙钟：一次卡顿/切回标签页就可能是几百毫秒甚至数秒，不夹住会让
      // 整段滑梯瞬移到终点（离屏捕帧下必现，真机偶发）
      anim.p = Math.min(1, anim.p + Math.min(dt, 0.05) / 3.0);
      const p = anim.p * anim.p * anim.p * (anim.p * (anim.p * 6 - 15) + 10);
      const P0 = anim.start;
      const [ex, ey, ez] = DECK_CAM.pos;
      const u = 1 - p;
      const bez = (a: number, b: number, c: number, d: number) =>
        u * u * u * a + 3 * u * u * p * b + 3 * u * p * p * c + p * p * p * d;
      camera.position.set(
        bez(P0.x, -2.6, -2.2, ex),
        bez(P0.y, Math.max(1.9, P0.y + 1.2), 0.62, ey),
        bez(P0.z, P0.z + 0.5, 3.5, ez + narrowPull),
      );
      RIG_LOOK.lerp(PLAYER_HEAD, Math.min(1, p * 2.4));
      camera.lookAt(RIG_LOOK);
      if (anim.p >= 1) {
        deckAnim.current = null;
        deckCamArrived.v = true; // 滑梯到位
      }
      syncOrbitFromCamera(camera.position, center ?? PLAYER_HEAD);
      return;
    }
    if (st.deckView) deckCamArrived.v = true;
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(tmp.current.set(target.pos[0], target.pos[1], target.pos[2] + narrowPull), k);
    RIG_LOOK.lerp(tmp.current.set(target.look[0], target.look[1], target.look[2]), k);
    camera.lookAt(RIG_LOOK);
    // 脚本运镜期间持续同步球面参数：用户随时接管都不跳变
    if (center) syncOrbitFromCamera(camera.position, center);
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
      {/* 只保留 NPC 侧长边护栏：玩家侧那根（z=+3.55）顶面高出桌毡 0.25，是玩家伏桌时
          胸部够不到桌面的物理屏障（blender-mcp 网格检测实证：胸部 356 顶点无一越过它，
          胸底正好压在护栏顶）。移除后近边只剩高 0.06 的木框，胸可真正落到桌面 */}
      {[-TABLE.d / 2 - 0.05].map((z, i) => (
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

// ── 合成法阵（中线右端）────────────────────────────────────
// 旧版是一块 #7c5c12 的土棕圆柱 + 白字"生成视频"平板。问题不在配色深浅，而在**它不属于
// 这个场景**：桌毡是金线法阵、卡是塔罗魔法框、烛台是黄铜，整间屋子都是"刻在暗处的金"，
// 只有它是一块塑料感纯色块。改成桌毡中央法阵的**子阵**——同一支金（214,178,106）、
// 同样的同心环与 24 等分射线，让它读作"桌面法阵的一个节点"而不是贴上去的按钮。
//
// 状态表达也重做了。旧版无论能不能点都写死"生成视频"，圆台暗着也不解释为什么，
// 用户只能瞎试；现在铭牌副题随状态换文案，把前置条件说出来。
function ComposePad() {
  const nodes = useFlow((s) => s.nodes);
  const enabled = composable(nodes);
  // 亮不起来时要说清缺什么：末段还没挑方案，还是挑了没炼。以前一律写"先为当前段选定一个
  // 方案"，而现在选定之后还要炼出本段视频才算就绪——照旧那句话用户会以为按钮坏了
  const tail = nodes.at(-1);
  const picked = !!(tail && chosenProposal(tail));
  const base = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);

  const sigilMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: composeSigilTexture(enabled),
        transparent: true,
        depthWrite: false,
        // 加色混合：刻纹读作"嵌在黄铜里的光"，而不是印上去的漆
        blending: enabled ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [enabled],
  );
  const runeMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: runeRingTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  );
  const plateMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: composePlateTexture(
          enabled ? "整片就绪" : "尚未就绪",
          enabled ? "点亮法阵 · 去剪辑成片" : picked ? "先炼出当前段的视频" : "先为当前段挑定一套方案",
          enabled,
        ),
        transparent: true,
        depthWrite: false,
      }),
    [enabled, picked],
  );
  useEffect(() => () => sigilMat.dispose(), [sigilMat]);
  useEffect(() => () => runeMat.dispose(), [runeMat]);
  useEffect(() => () => plateMat.dispose(), [plateMat]);

  useFrame((_, dt) => {
    const t = performance.now();
    // 台座呼吸：可合成时金光起伏，否则近乎熄灭
    // 只给极轻的呼吸。**发光的必须是刻纹不是台面**：这屋子从桌毡到卡框到烛台，
    // 全是"暗底 + 细金线"，台面一亮就成了一枚金币，把旁边桌毡那圈细刻线整个压住
    // （第一版给到 0.45 就是这个下场）。
    if (base.current) base.current.emissiveIntensity = enabled ? 0.10 + 0.05 * Math.sin(t / 380) : 0.02;
    // 符文环缓转——**只在可合成时转**。转动是这里唯一的动效，克制到底：
    // 暗房里一个持续闪烁的东西会一直抢注意力，而"缓慢旋转"读作蓄势，不吵
    if (ring.current) {
      ring.current.visible = enabled;
      if (enabled) ring.current.rotation.z += dt * 0.35;
    }
    if (beam.current) {
      beam.current.visible = enabled;
      const m = beam.current.material as THREE.MeshBasicMaterial;
      if (enabled) m.opacity = 0.1 + 0.06 * Math.sin(t / 520);
    }
  });

  return (
    <group
      position={COMPOSE_POS}
      onClick={(e) => {
        e.stopPropagation();
        // 不再一把梭合成整片：铺成工作流，去 /flow 逐段生成逐段确认
        if (enabled) useStudio.getState().requestFlow();
      }}
    >
      {/* 台座：黄铜而不是土棕。金属度拉高、粗糙度中等，才吃得到烛光的高光 */}
      <mesh>
        <cylinderGeometry args={[0.46, 0.52, 0.055, 40]} />
        <meshStandardMaterial
          ref={base}
          color={enabled ? "#241d10" : "#161c2c"}
          metalness={0.82}
          roughness={0.34}
          emissive="#d6b26a"
          emissiveIntensity={0.02}
        />
      </mesh>
      {/* 顶面法阵刻纹：贴在台座上方 1mm，避免与台面 z-fighting */}
      <mesh position={[0, 0.029, 0]} rotation={[-Math.PI / 2, 0, 0]} material={sigilMat}>
        <planeGeometry args={[0.92, 0.92]} />
      </mesh>
      {/* 缓转符文环：比台座略大一圈，浮在桌面上方一点，转起来才看得出是"环" */}
      <mesh ref={ring} position={[0, 0.033, 0]} rotation={[-Math.PI / 2, 0, 0]} material={runeMat}>
        <planeGeometry args={[1.24, 1.24]} />
      </mesh>
      {/* 竖直光柱：加色混合的淡金，暗示"阵已通" */}
      <mesh ref={beam} position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.2, 0.42, 0.82, 20, 1, true]} />
        <meshBasicMaterial
          color="#f0cf8e"
          transparent
          opacity={0.12}
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* 铭牌平贴桌面：俯视机位下平贴比立牌好读，且不会挡住后面的节点卡 */}
      <mesh position={[-0.16, 0.006, 0.86]} rotation={[-Math.PI / 2, 0, 0]} material={plateMat}>
        <planeGeometry args={[1.42, 0.44]} />
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
  const activeDeck = useStudio((s) => s.activeDeck);
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
  // 选过卡组后标签亮出组名（截断防溢出）；卡组/卡片的切换都在小窗右上角
  countMat.map = labelTexture(
    activeDeck ? `${activeDeck.name.slice(0, 6)} ${deck.length}` : `卡组 ${deck.length}`,
    "#e2e8f0",
  );
  useEffect(() => {
    const mats = [backMat, markerMat, countMat];
    return () => mats.forEach((m) => m.dispose());
  }, [backMat, markerMat, countMat]);
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        // 点卡组堆：进入"选卡组"视角（镜头拍玩家思考 + 卡组选择投影）；
        // 摊开态下再点 = 切换卡组，回到同一个选择步骤
        useStudio.getState().openDeckView();
      }}
    >
      {/* 卡组虚位标记（与节点链同一缩放档，桌面尺度统一） */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[DECK_POS[0], 0.009, DECK_POS[2]]}
        scale={CHAIN.scale}
        material={markerMat}
      >
        <planeGeometry args={[CARD.w * 1.1, CARD.h * 1.08]} />
      </mesh>
      {Array.from({ length: shown }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, ((i * 37) % 11) * 0.012 - 0.06]}
          position={[DECK_POS[0], 0.012 + i * 0.014, DECK_POS[2]]}
          scale={CHAIN.scale}
          material={backMat}
        >
          <planeGeometry args={[CARD.w, CARD.h]} />
        </mesh>
      ))}
      <mesh
        position={[DECK_POS[0], 0.12, DECK_POS[2] - 0.62 * CHAIN.scale]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={CHAIN.scale}
        material={countMat}
      >
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
  const nodes = useFlow((s) => s.nodes);
  const card = deck.find((c) => c.id === dragCardId) ?? null;
  const ghost = useRef<THREE.Group>(null);

  const phX = computeChain(nodes).placeholderX;

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
      } else if (!dragState.moved) {
        // 单击（没拖动）：编辑器开着=选入素材槽；否则打开卡片详情
        if (st.editor && !st.editor.generating) {
          st.pickDeckCard(id);
        } else {
          const c = st.deck.find((x) => x.id === id);
          if (c) st.viewCardDetail(c);
        }
      }
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
  // 只摆本页那 6 张。以前是把 searchMarket 返回的 8 张全铺出去——那 8 是
  // "一屏摆得下几张"的旧口径，既切了卡又把另外 11 张种子卡藏了起来
  const start = market.page * MARKET.perPage;
  const page = market.items.slice(start, start + MARKET.perPage);
  return (
    <group>
      {page.map((card, i) => {
        const { x, z } = marketSlot(i, page.length);
        const col = i % MARKET.perRow;
        const rowCount = Math.min(MARKET.perRow, page.length - Math.floor(i / MARKET.perRow) * MARKET.perRow);
        const cam = focusCam(x, z);
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            from={[0.9, 0.9, -3.2]}
            target={[x, MARKET.lift + i * 0.004, z]}
            rotZ={(col - (rowCount - 1) / 2) * -0.04}
            scale={MARKET.scale}
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
      scale={CHAIN.scale}
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
  const nodes = useFlow((s) => s.nodes);
  const focus = useStudio((s) => s.focus);
  const projection = useStudio((s) => s.projection);
  // 焦点跟随：聚焦节点保证平摊在窗口内（点堆中的卡时窗口平移过去）
  const layout = computeChain(nodes, focus?.nodeId ?? null);
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__chainDbg = layout;
  const visibleXs: number[] = [];

  const cards: ReactNode[] = [];
  let leftCount = 0;
  let rightCount = 0;
  layout.items.forEach(({ node, x, stack }) => {
    const chosen = chosenProposal(node);
    const tex = chosen ? proposalTexture(chosen) : placeholderTexture();
    if (x == null) {
      // 左右收起堆：可点击——窗口平移让该节点平摊到桌面中区，镜头跟随聚焦
      const isLeft = stack === "left";
      const idx = isLeft ? leftCount++ : rightCount++;
      const base = isLeft ? LEFT_STACK : RIGHT_STACK;
      cards.push(
        <CardMesh
          key={node.id}
          tex={tex}
          target={[base[0], 0.012 + idx * 0.02, base[2]]}
          rotZ={idx * 0.05 - 0.04}
          scale={CHAIN.scale * 0.94}
          onClick={(e) => {
            e.stopPropagation();
            const st = useStudio.getState();
            if (st.projection) return; // 投影开着时与平摊卡一致：不抢焦
            const nx = computeChain(useFlow.getState().nodes, node.id).items.find((it) => it.node.id === node.id)?.x;
            if (nx == null) return;
            const cam = focusCam(nx, CHAIN.rowZ);
            st.focusNode(node.id, cam.pos, cam.look);
          }}
        />
      );
      return;
    }
    visibleXs.push(x);
    // 聚焦中的卡悬浮 + 高亮描边；选定后显示选定方案卡面，未选定（生成中/未选）显示虚框卡面
    const floating = focus?.nodeId === node.id && projection != null;
    const y = floating ? FLOAT_Y : CARD.lift;
    cards.push(
      <CardMesh
        key={node.id}
        tex={tex}
        target={[x, y, CHAIN.rowZ]}
        scale={CHAIN.scale}
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
      {leftCount > 0 && visibleXs.length > 0 && <Beam x1={LEFT_STACK[0]} x2={visibleXs[0]} z={CHAIN.rowZ} />}
      {rightCount > 0 && visibleXs.length > 0 && (
        <Beam x1={visibleXs[visibleXs.length - 1]} x2={RIGHT_STACK[0]} z={CHAIN.rowZ} />
      )}
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

// ── 对话视角的桌面：用户真实卡组整齐摊开（正面朝上、可点击）──
function DialogTableCards() {
  const dialogView = useStudio((s) => s.dialogView);
  const marketOpen = useStudio((s) => s.market.open);
  const deck = useStudio((s) => s.deck);
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
    </group>
  );
}

// ── 空白桌面点击捕获：聚焦且无投影时，点卡片之外拉远回默认机位 ──
function TableCatcher() {
  const { camera, gl } = useThree();
  // 自由视角手势状态：首指必须落在空白桌面（r3f 命中本 mesh 才回调=天然的"非互动点"闸门），
  // 第二指从任意位置计入（捏合缩放）；move/up 用 window 监听避免指针滑出平面丢事件
  // moved = 本次手势的累计位移（像素）。**click 护栏必须自己记**：R3F 的 onClick 判据是
  // "按下时命中的对象里包含本对象"，与拖了多远无关（它那个 2px 阈值只用在 miss 分支），
  // 所以一次横扫全屏的滑动照样会补一发 click 打到桌面上 → unfocus() → 视角/卡组状态被清。
  const g = useRef<{ pointers: Map<number, [number, number]>; lastPinch: number | null; moved: number }>({
    pointers: new Map(),
    lastPinch: null,
    moved: 0,
  });
  useEffect(() => {
    const el = gl.domElement;
    const ctrTmp = new THREE.Vector3();
    // 轨道手势只在"投影小窗之外的画布"上起效：HTML 面板的 target 不是 canvas，天然滤掉；
    // 互动点的点按走 click 通道不受影响（几乎无位移的拖拽照常触发 click）
    // 两种拖拽语义：有轨道中心 → 绕圆心球面运动；第一人称眼位 → 转角色的头环视
    const mode = () => {
      const st = useStudio.getState();
      if (st.orbit) return "orbit" as const;
      return st.camera.kind === "default" ? ("eye" as const) : null;
    };
    const onDown = (e: PointerEvent) => {
      if (!mode() || e.target !== el) return;
      g.current.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      g.current.lastPinch = null;
      g.current.moved = 0;
    };
    const onMove = (e: PointerEvent) => {
      const s = g.current;
      if (!s.pointers.has(e.pointerId)) return;
      const m = mode();
      if (!m) {
        s.pointers.clear();
        return;
      }
      const prev = s.pointers.get(e.pointerId)!;
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      s.moved += Math.hypot(dx, dy);
      s.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (m === "eye") {
        // 眼位环视：滑屏 = 转头（画面跟手，向左滑看向左）。
        // 升空俯瞰态不再转头——头此刻可见，跟手转脖子会与头发穿插（实测），
        // 而且俯瞰下"转头"语义本身就不成立
        if (s.pointers.size === 1) {
          // 门限与回正共用同一个常量，见 EYE_RISE_LOOK_OFF 的注释：死区必须为空
          if (eyeRise.v < EYE_RISE_LOOK_OFF) addEyeLook(dx * 0.0042, -dy * 0.0036);
        } else if (s.pointers.size === 2) {
          // 双指捏合 = 升空俯瞰：指距缩小（缩小视角）→ 相机缓缓升到头顶俯瞰全桌；
          // 指距放大最多回到第一人称眼位（addEyeRise 内部 0 下限）
          const pts = [...s.pointers.values()];
          const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
          if (s.lastPinch != null) addEyeRise((s.lastPinch - d) * 0.0035);
          s.lastPinch = d;
        }
        return;
      }
      const o = useStudio.getState().orbit!;
      const lim = ORBIT_LIMITS[o.target] ?? ORBIT_LIMITS.node;
      if (s.pointers.size === 1) {
        // 单指拖拽 = 绕圆心的球面运动（相机恒定看向圆心）
        if (!orbit.active) {
          const c = resolveOrbitCenter(o, ctrTmp);
          if (c) syncOrbitFromCamera(camera.position, c);
          orbit.active = true;
        }
        orbit.theta -= dx * 0.006;
        // 极角夹在 [12°, 168°]：不允许翻过头顶/脚底导致画面翻转
        orbit.phi = Math.min(Math.PI - 0.21, Math.max(0.21, orbit.phi - dy * 0.006));
      } else if (s.pointers.size === 2) {
        // 双指捏合 = 改变球面半径（保留缩放功能）；下限由 ORBIT_LIMITS + 场景碰撞双重兜底
        const pts = [...s.pointers.values()];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        if (s.lastPinch != null) {
          if (!orbit.active) {
            const c = resolveOrbitCenter(o, ctrTmp);
            if (c) syncOrbitFromCamera(camera.position, c);
            orbit.active = true;
          }
          orbit.radius = Math.min(lim.max, Math.max(lim.min, orbit.radius - (d - s.lastPinch) * 0.012));
        }
        s.lastPinch = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      g.current.pointers.delete(e.pointerId);
      g.current.lastPinch = null;
    };
    // 桌面调试便利：滚轮 = 轨道半径推拉；第一人称下 = 升空俯瞰（与双指捏合同源）
    const onWheel = (e: WheelEvent) => {
      const st = useStudio.getState();
      const o = st.orbit;
      if (!o) {
        if (st.camera.kind === "default") {
          e.preventDefault();
          addEyeRise(e.deltaY * 0.0011);
        }
        return;
      }
      e.preventDefault();
      const lim = ORBIT_LIMITS[o.target] ?? ORBIT_LIMITS.node;
      if (!orbit.active) {
        const c = resolveOrbitCenter(o, ctrTmp);
        if (c) syncOrbitFromCamera(camera.position, c);
        orbit.active = true;
      }
      orbit.radius = Math.min(lim.max, Math.max(lim.min, orbit.radius + e.deltaY * 0.004));
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
      userData={{ noCam: true }}
      onClick={() => {
        // 轨道拖拽期间点空白桌面不触发落卡/回退（拖拽末尾的 click 误伤）
        if (orbit.active) return;
        // 第一人称走的是 eye 分支，orbit.active 恒为 false——上面那条守卫拦不住它，
        // 于是每次环视滑动都会被补一发 click 打到这里。按**本次手势累计位移**拦：
        // 8px 取自"手指点按的抖动上限"，比 R3F 自己用的 2px 宽一档（触屏抖动更大）。
        // 只拦本平面的 unfocus，卡组堆/NPC/法阵/节点卡的 onClick 一律不动——
        // "互动点仍然点得到"由此在构造上成立。
        if (g.current.moved > 8) return;
        useStudio.getState().unfocus();
      }}
    >
      <planeGeometry args={[TABLE.w, TABLE.d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ── 场景组装 ─────────────────────────────────────────────────
/** NPC 头顶 → 屏幕坐标投影（供 DOM 侧对话气泡跟随角色，见 cameraOrbit.NPC_SCREEN） */
/** 玩家头侧的屏幕锚点（供"换形象"按钮定位）。
 *
 *  横向偏移放在**屏幕空间**而不是世界空间：卡组机位实测只有 0.87m 焦距，一整张脸
 *  就铺满画面（±0.2 单位 = ±0.22 屏宽），世界系里"贴着轮廓外侧"的量换算过来直接
 *  飞出屏幕；而且用户还能绕上半身转，世界固定偏移一转到侧面就叠回脸上。投影完头骨
 *  再加一个定值屏偏移，则镜头怎么动按钮都稳定挂在头右侧。 */
const HEAD_SIDE_SCREEN = 0.3; // 屏宽比例：0.3 ≈ 头中心到右侧发梢外缘
function PlayerScreenAnchor() {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    v.copy(PLAYER_HEAD);
    v.project(camera);
    PLAYER_SCREEN.visible = v.z < 1;
    // x 上限 0.88 = 1 - 半个按钮(22/375) - 安全边距；y 上限 0.46 是硬约束：
    // 卡组小窗从 top-[54%] 一直铺到底（ui/projection.tsx），越过就被压在窗后点不到
    PLAYER_SCREEN.x = Math.min(0.88, Math.max(0.12, (v.x + 1) / 2 + HEAD_SIDE_SCREEN));
    PLAYER_SCREEN.y = Math.min(0.46, Math.max(0.14, (1 - v.y) / 2 + 0.06));
  });
  return null;
}

function NpcScreenAnchor() {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    v.copy(NPC_HEAD);
    v.y += 0.5; // 锚在头顶上方一点，气泡不压脸
    v.project(camera);
    NPC_SCREEN.visible = v.z < 1;
    // 夹进安全区：镜头切换的瞬间投影可能飞出屏幕，气泡钉在边缘比消失更可读。
    // y 下限 0.3——气泡以锚点为底向上生长约 25% 屏高，下限太低气泡顶会出屏
    NPC_SCREEN.x = Math.min(0.86, Math.max(0.14, (v.x + 1) / 2));
    NPC_SCREEN.y = Math.min(0.78, Math.max(0.3, (1 - v.y) / 2));
  });
  return null;
}

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
          // 默认铸卡师 = 委托定制的 Milltina（**自有版权，随包发布**；加密只是防直接取用，
          // 不是"不能发"——别和 protected/ 下那些第三方版权模型混为一谈，见 prune-app-assets）：
          // VRC 原生形键 + 弹簧骨物理 + 调暗描边
          <TripoNpc url="/models/protected/milltina-opt.glbx?v=m16" cfg={MILLTINA_CFG} face={MILLTINA_FACE} />
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
      <NpcScreenAnchor />
      <PlayerScreenAnchor />
      {import.meta.env.DEV && <CaptureHook />}
    </>
  );
}
