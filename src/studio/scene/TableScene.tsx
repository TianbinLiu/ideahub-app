// 卡片工坊 3D 场景：长桌 + 中线 + NPC 铸卡师 + 卡组 + 市场平摊 + 对局 5 个卡位 + 拖拽层。
// 固定机位只露出双方手部/上身与桌面（NPC 不建头部模型）。
// ★ G4（docs/g4-ui-revamp-spec.md §2）：桌面上的视频节点链撤了，换成对局的 4 个角色位 + 1 个场景位；
//   节点卡搬进工作流面板是第 3 步，这一拍先把"摆卡台"的骨架立起来。
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ThreeEvent, advance, useFrame, useThree } from "@react-three/fiber";
import { useLingui } from "@lingui/react/macro";
import { FlowNode, useFlow } from "../flowStore";
import { chosenProposal, composable, placeholderVisible, useStudio, Flight } from "../studioStore";
// G4：桌面 5 个卡位要读"位子上是谁"（规则派生在 rules.tableSlotsOf，界面读数在 game/view）。
// 场景只画，不自己数：`scene → game` 这一条依赖只往规则与视图模型去，game 那边不认识 scene。
import { useGame } from "../game/store";
import { gameViewOf } from "../game/view";
import { gameCardName } from "../game/labels";
import { TABLE_ROLE_SLOTS } from "../game/rules";
import type { GameCard, TableSlots } from "../game/types";
// G4 第 3 步：卡位的屏幕坐标（拖拽落点判定），与 cameraOrbit.NPC_SCREEN 同一套 project 做法
import { SLOT_SCREEN, sameTableSlot } from "./slotScreen";
import {
  DECK_CAM,
  SHOW_PLAYER_BODY,
  chainX,
  defaultCamFor,
  focusCam,
  GS_TABLE,
  GS_TABLE_SHIFT,
  GS_CAM,
  GS_FRAME_SHIFT,
  GS_ROWS,
  GS_PAD,
  cardLayout,
  gsAcceptCamOn,
  gsSceneMetric,
  marketSlot,
  sceneLayout,
} from "./layout";
// ★ 朝向判据只有一份（hooks/useIsLandscape）：桌子与卡位在横屏下换另一套（layout.sceneLayout），
//   与 StudioPage 的宽布局壳、defaultCamFor 的机位选择读的是同一个 `(orientation: landscape)`。
import { useIsLandscape } from "../../hooks/useIsLandscape";
// 开场运镜（G1 施工单 §4）：起点/时长/缓动/跳过/只播一次都在那个模块里，这里每帧只问一次位姿。
import { abandonIntroCam, skipIntroCam, stepIntroCam } from "./introCam";
import { npcModelUrl } from "../quality";
import {
  NPC_CENTER,
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
  clampOrbitYaw,
  clampRadiusByScene,
  eyeLook,
  eyeRise,
  EYE_RISE_LOOK_OFF,
  resetEyeRise,
  orbit,
  orbitToPosition,
  syncOrbitFromCamera,
} from "./cameraOrbit";
// 米制档的小幅环视（±6°/±3° + 松手回中）：状态与手势原子在 gsLook 一处
import { GS_LOOK, applyGsLook, gsLookDeg, gsLookDown, gsLookDrag, gsLookMoving, gsLookRelease, gsLookReset, gsLookTick } from "./gsLook";

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

// ★★ 高斯米制场景里的铸卡师（2026-11-26，`feat/gs-table-fire`；**站位/身高第 2 版** `feat/gs-layout-fix`）。
//
// 病根（验收探针量出来的，不是猜的）：MILLTINA_CFG 的 `scale: 3.35` 换算到世界是**约 3.43 m 高**
// （她模型原点→头骨 1.0236 模型单位 × 3.35），不是注释里那句"头顶世界高约 1.75"。
// 老场景看不出来是因为那张 22×9 的"UI 画布桌子"本来就是按同一套虚尺度量的（人是桌长的 1/6）。
//
// ★★ 第 2 版（2026-11-26，主人的四条修正之第 2/4 条）：**她换到壁炉那一侧（−x）、面朝玩家、只露腰以上。**
//   · 站位：x = **−0.82**（桌子远沿在 −0.61，她几乎贴着桌沿站 —— 站得越近，桌沿的遮挡线在她身上
//     落得越高，需要的下沉量就越小：x=−1.05 时要沉 0.22 m、x=−0.82 时只要 0.12 m。下沉量小，
//     侧面机位里"裙摆被地板截断"就越看不出来）、z = **−0.23**、yaw = **π/2**（模型默认面朝 +z，
//     转 90° 之后面朝 +x = 玩家）。
//     ★★ 2026-11-26 第 3 版（`feat/gs-polish2`，主人第 2 条"人物位置偏左"）：z 从 **+0.50 → −0.03**。
//       投影算过：屏幕右 = 世界 **−z**（相机在 +x）。她在 z=+0.50 时，身体中心投到画面上比桌面
//       中心偏左 **0.52 m**；把 z 收到 −0.03 之后偏差 **0.00 m**（量法：把 `hips` 骨的世界坐标
//       与桌心 (0,0,0) 各自投影，取两者在"过她身体中心、平行于画面"的那条轴上的距离；
//       运行期读数在 `window.__gsAccept.npcOffsetM`，见 `AcceptProbe`）。
//       z=−0.03 也是这条式子容许区间的中点（|偏差| ≤ 0.1 m ⇒ z ∈ [−0.13, +0.07]），
//       取它是因为**炉膛在 z≈+0.10**：再往 +z 让火从她身侧露出来就会重新偏左。
//       ⚠ 代价写在 docs 的风险表里：她站到炉口正前方之后，正面机位只剩两侧缝隙看得到火。
//     ★★ 2026-11-27 第 4 版（`feat/gs-fire-visibility`，主人三条里的第 1 条"默认机位看不到火"）：
//       **z 从 −0.03 → −0.23（侧移 0.20 m，屏幕右 = 世界 −z）**。上面那个代价真的成了事实：
//       默认机位（GS_CAM，3.55 m 外）里她整个人压在炉口正中，火一个亮像素都看不到
//       （真机默认机位截图量出来：炉口区域里"火像素"= **0**）。她往 −z 让开之后：
//        · **炉口宽度露出 ~79%**（逐行量"她挡住的横跨 / 炉口 ROI 宽"取均值 = 21.3% 被挡，
//          量法：同一机位把 NPC 挪开 2.5 m 截一张无遮挡参考，与最终站位逐像素比，见文档 §17.3~§17.4）；
//        · 火的可见像素 = 无遮挡时的 **94.5%**（改前 0%）；
//        · 与桌中线的偏差 **0.212 m**（`__gsAccept.npcOffsetM`；主人这一轮把上限放宽到 0.25 m）；
//        · 她仍然只露腰以上（遮挡线只由 x 决定，z 平移不动那条线）、仍站在壁炉那一侧。
//       为什么不选"把火/炉子在炉膛内偏 0.10~0.15 m"：炉膛是 splat 里烘死的，火锚点一偏，
//       光晕/光池/点光与柴堆（也是网格）要整体跟着偏，而柴堆已经在炉膛正中 —— 动 NPC 一个数
//       就能让开，动火是三个数加一处已知的"火与炉膛中点对不上"风险。
//       ⚠ 对话机位（GS_NPC_CAM）与验收机位不受影响：它们读的是同一份 cfg，但 z 变的是"她站哪"，
//         伏桌距离由 x 决定，米制下没变。
//     ★★ 2026-11-27 第 5 版（`feat/gs-auto-gate-align`，主人第 2 件「NPC 要回到桌子中线」）：
//       **她的站位一个数没动**（仍然 z=−0.23）—— 动的是桌子：毡面/卡位/铭牌/法阵/光毯整体
//       沿世界 −z 平移 0.20 m（layout.GS_TABLE_SHIFT）。于是她与桌心线的偏差 0.212 → **0.012 m**
//       （`__gsAccept.npcOffsetM` 已改成"相对桌心"量），火仍然从她身侧露出来（世界位置没变）。
//       画面里她回到 **58.47%**（GS_FRAME_SHIFT 0.09→0.04，复算见 layout 那一段注释）。
//   · 身高：**scale 1.654 → 1.418（1.75 m → 1.50 m）**、y **−0.728 → −0.955**（额外下沉 0.22 m）。
//     为什么必须沉/缩：相机眼位 1.06 m 时，**桌沿的遮挡线在她那处只有离地 0.74 m 高**
//     （眼睛穿桌沿高点 (−0.61, 0.053) 的那条射线，到 x=−0.82 落到 y≈−0.043）——
//     上一版她站在桌沿后 0.65 m 处、遮挡线只到 0.45 m 高，从大腿中段往上全露，
//     就是主人说的"桌面上露出太多"。把腰线压到那条遮挡线上之后，画面里只剩**腰以上**：
//     身高 1.50 m（scale 1.418）、下沉 0.12 m（y = −0.856）、腰高（世界 y）≈ −0.05（离地 0.74 m）、
//     可见高度 0.64 m ≈ 她 1.50 m 的 **42%**。三个数记在 docs/gs-table-light-log.md 的表里。
//   · 所有**世界量纲**的物理/位移参数按同一比例 1.418/3.35 = 0.423 收（弹簧碰撞球半径与偏移、
//     胸物理半径/抬升上限/臂半径/躯干球、leanSlide 的 back/z/y、breastLift 的 sink/swell）。
//   · 胸物理的桌沿碰撞体：上一版按"桌子在 −z 侧"写成 z=−1.25，这一版桌子在她 **+x** 侧 ⇒
//     用 `rail.x = −0.62`（胶囊顺着长轴 z 走，见 TripoNpc 的 rail 注释）、y 跟着下沉量落到 0.02。
// ⚠ leanSlide 只按比例收了，米制下"桌沿离她只有 0.3 m"这件事不是等比能解决的 ——
//   进对话让她伏桌时要再看一次（docs/gs-table-light-log.md 风险表）。
const GS_MILLTINA_CFG = {
  ...MILLTINA_CFG,
  scale: 1.418,
  y: -0.856,
  x: -0.82,
  z: -0.230,
  yaw: Math.PI / 2,
  leanSlide: { back: 0.178, z: 0.034, y: 0.092 },
  springColliders: [
    { bone: "mixamorig:Head", radius: 0.11 },
    { bone: "mixamorig:Spine1", radius: 0.178, offset: [0, 0.042, 0.017] as [number, number, number] },
    { bone: "mixamorig:Hips", radius: 0.161 },
    { bone: "Breast_L", radius: 0.066, offset: [0, 0, 0.021] as [number, number, number] },
    { bone: "Breast_R", radius: 0.066, offset: [0, 0, 0.021] as [number, number, number] },
    { bone: "mixamorigNeck", radius: 0.055, offset: [0, -0.071, 0.045] as [number, number, number] },
  ],
  breastPhys: {
    ...MILLTINA_CFG.breastPhys,
    radii: [0.055, 0.046, 0.038],
    rootLiftMax: 0.068,
    armRadius: 0.032,
    // 桌子在 +x 侧 ⇒ 桌沿用 x 位（沿长轴 z 走的胶囊），不再用 z
    rail: { y: 0.02, x: -0.62, radius: 0.03 },
    torsoRadius: 0.034,
  },
  breastLift: { angle: -0.3, childAngle: -0.15, splay: 0.24, sink: 0.026, swell: 0.063 },
};

import {
  cardBackTexture,
  composePlateTexture,
  composeSigilTexture,
  runeRingTexture,
  cardFaceTexture,
  labelTexture,
  ringTexture,
  tickCardFades,
} from "./cardTexture";
import CardMesh from "./CardMesh";
// ★ GS 第 0 步实验档（2026-11-25）：房间/灯组/真火都在这个模块里，开关见 ./gsStep0（默认关）
// ★ 2026-11-26（feat/gs-table-fire）：PBR 盖板删了，桌面统一走 WorkshopTable（旧场景那张长桌）；
//   米制档（高斯场景）只是把尺寸/机位/卡位换成 1 单位 = 1 米那套，见 layout 的 GS_* 常量。
import { GsStep0Environment } from "./GsStep0Environment";
import { GS_FIRE_LIGHT, GS_STEP0_TRANSFORM, gsAcceptProbeOn, useGsPhase } from "./gsStep0";
import { FIRE_FX } from "./HearthFire";
import WorkshopTable from "./WorkshopTable";
import VrmNpc from "./VrmNpc";
import TripoNpc from "./TripoNpc";
import { MILLTINA_FACE } from "./faceExpr";
import PlayerArms from "./PlayerArms";

// 默认 = 全身版（站立↔对话俯身状态机，用户定稿）；?npc=tripo 早期全身试验版 / ?npc=vrm 回退 VRM
const NPC_VARIANT = new URLSearchParams(window.location.search).get("npc") ?? "full";

// ── 节点链布局（G4 第 1 步起桌面上不再画节点卡）────────────────
// ★ 这段现在只剩一个调用方：ui/projection.tsx 的 ‹› 换段（它要一个"如果节点卡还在桌上，
//   这一段会摆在哪"的坐标来推镜头）。桌面上的 NodeChainView 已随 G4 第 1 步撤掉，
//   节点卡搬进工作流面板是第 3 步 —— 那一步要把这段一起收拾掉，别把"能算但不能画"留着当功能。
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

/** 节点链的窗口化布局。`land` 选横屏/竖屏两套卡位（layout.sceneLayout）——横屏一屏 7 张、竖屏 5 张，
 *  窗口平移、两侧收起堆、占位卡位都跟着同一套常量走；调用点必须传**同一个判据**（useIsLandscape），
 *  否则横屏上算出来的卡位会落在竖屏的 x 上（3D 里看不出来，投影窗的 ‹› 切段却会飞错位置）。 */
export function computeChain(path: FlowNode[], focusId: string | null | undefined, land: boolean): ChainLayout {
  const C = sceneLayout(land).chain;
  const ph = placeholderVisible(path);
  const total = path.length + (ph ? 1 : 0);
  let start = Math.max(0, total - C.maxVisible);
  if (focusId) {
    const fi = path.findIndex((n) => n.id === focusId);
    if (fi >= 0 && (fi < start || fi >= start + C.maxVisible)) {
      // 以聚焦节点为中心平移窗口（夹在链两端之间）
      start = Math.min(Math.max(0, fi - Math.floor((C.maxVisible - 1) / 2)), Math.max(0, total - C.maxVisible));
    }
  }
  const end = start + C.maxVisible;
  return {
    items: path.map((node, i) => ({
      node,
      x: i >= start && i < end ? chainX(land, i - start) : null,
      stack: i < start ? ("left" as const) : i >= end ? ("right" as const) : null,
      stackIndex: i,
    })),
    // 空白占位卡永远排在链尾：窗口没覆盖到链尾时它随尾段一起收进右堆（不渲染）
    placeholderX: ph && path.length >= start && path.length < end ? chainX(land, path.length - start) : null,
  };
}

// ── 相机：朝目标位姿缓动（transient 直读 store，避免订阅延迟一帧） ──
// RIG_LOOK 提到模块级：手势层需要读取当前视线锚点。
// 初值取当前场景的落点机位（米制高斯档 GS_CAM / 老场景 LAND_CAM）：它只影响**第一帧**的
// lookAt，而第一帧被 StudioLoader 盖着；竖屏窗口由 CameraRig 在头一帧就把视线带到
// defaultCamFor() 给的那台上（不到 1 秒的缓动）。
const RIG_LOOK = new THREE.Vector3(...(gsSceneMetric() ? GS_CAM.look : defaultCamFor(1.8).look));

/** 解析当前轨道圆心（npc 每帧跟随头骨，node 用点击时记下的卡片坐标）。
 *  ★ "player" 这一支自 G1 施工单第 1 步（docs/g1-scene-plan.md §1）起已经没有调用方
 *    （卡组视角那趟跟着身体休眠）；保留它是为了 SHOW_PLAYER_BODY 改回 true 时一并回滚。
 *  ★ `lift`（G4 商店，layout.SHOP_CAM.lift）：圆心比头再高一截 —— 相机看的是圆心，
 *    所以抬圆心 = 把 NPC 整体压到屏幕下半，给顶部那条商店栏让位。只影响商店那一趟，
 *    对话不传它，圆心仍然是头骨（一个字都没变）。 */
export function resolveOrbitCenter(
  o: { target: "node" | "player" | "npc"; point?: [number, number, number]; lift?: number } | null,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  if (!o) return null;
  // 玩家用**上半身**中心而不是头骨：绕头转时身体被甩到画面外，转到侧后方只剩一颗头
  if (o.target === "player") return out.copy(PLAYER_TORSO);
  if (o.target === "npc") {
    out.copy(NPC_HEAD);
    if (o.lift) out.y += o.lift;
    return out;
  }
  return o.point ? out.set(o.point[0], o.point[1], o.point[2]) : null;
}

/** 第一人称眼位：站在玩家头部，基准朝向 NPC，再叠加环视偏航/俯仰（滑屏转头）。
 *  ★ G1 施工单第 1 步（docs/g1-scene-plan.md §1）之后只在 `SHOW_PLAYER_BODY` 为真时求值；
 *    人偶摘掉时默认机位走 layout.defaultCamFor（横屏落点 / 竖屏俯视），这条函数**读的是每帧由
 *    PlayerArms 写入的 PLAYER_HEAD**，没人写它就是一个假机位 —— 别在恢复挂载之前把它接回来。 */
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

/**
 * 米制设计机位的**取景右移**（layout.GS_FRAME_SHIFT 的落地处，主人第 1 条）。
 * `setViewOffset(fullW, fullH, 0, 0, W, H)`：把投影窗口往虚拟画幅的左边裁 δ 像素 ⇒ 画面内容整体右移 δ，
 * **相机位姿 / 朝向 / 焦距一个数都不改**（桌子在画面里的尺寸、人物高度逐像素不变）。
 * ★ 只在画布尺寸变了才重设；`on=false`（对话/聚焦/验收机位）时清掉。
 * ★ 与 r3f 的 resize 共存：r3f 在尺寸变化时只改 camera.aspect + updateProjectionMatrix，
 *   `view` 对象留在相机上；下一帧这里按新尺寸重设，最多一帧的旧 fullWidth（看不出）。
 */
function syncGsFrameShift(
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  on: boolean,
  ref: { current: { w: number; h: number } | null },
): void {
  if (!on || w <= 0 || h <= 0) {
    if (ref.current) {
      // ★ three 的 setViewOffset 会把 camera.aspect 改成 fullWidth/fullHeight（本仓 three 版本的行为，
      //   见 node_modules/three/src/cameras/PerspectiveCamera.js），而 clearViewOffset **不还原**它 ——
      //   不在这里写回真实画幅比，退出去之后整屏会横向拉扁（对话/聚焦机位都中招）。
      camera.aspect = w / h;
      camera.clearViewOffset();
      ref.current = null;
    }
    return;
  }
  const W = Math.round(w);
  const H = Math.round(h);
  const prev = ref.current;
  if (prev && prev.w === W && prev.h === H) return;
  const delta = Math.round(W * GS_FRAME_SHIFT);
  camera.setViewOffset(W + 2 * delta, H, 0, 0, W, H);
  ref.current = { w: W, h: H };
}

function CameraRig() {
  const tmp = useRef(new THREE.Vector3());
  const ctr = useRef(new THREE.Vector3());
  const eyeP = useRef(new THREE.Vector3());
  const eyeL = useRef(new THREE.Vector3());
  const deckAnim = useRef<{ p: number; start: THREE.Vector3 } | null>(null);
  const prevDeck = useRef(false);
  const lastCamObj = useRef<unknown>(null);
  /** 取景右移当前生效的尺寸（null = 没生效）——只在尺寸/开关变化时重设投影 */
  const frameShift = useRef<{ w: number; h: number } | null>(null);
  /** r3f 量出来的画布 CSS 尺寸（转屏/分屏时跟着变；只用它的宽高，不订阅每帧） */
  const size = useThree((s) => s.size);
  /** 开场运镜的"可跳过"（G1 施工单 docs/g1-scene-plan.md §4）：运镜期间**点一下屏幕/触摸拖动**
   *  就立刻落到终点。
   *  ★ 监听常驻，不随"在播没在播"挂/摘：那个状态活在 introCam 的模块单例里、**不进 React**
   *    （跟着它挂/摘就要每帧重渲整页），而 skipIntroCam 没在播时本来就是空操作。
   *  ★ 捕获阶段：手指落在顶栏、卡组条、投影窗上也得算"点了一下屏幕"，不能只有画布上的点击算。
   *   滚轮一并算 —— 浏览器里它是"动了一下相机"的同义动作。 */
  useEffect(() => {
    const onSkip = () => skipIntroCam();
    window.addEventListener("pointerdown", onSkip, true);
    window.addEventListener("wheel", onSkip, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onSkip, true);
      window.removeEventListener("wheel", onSkip, { capture: true });
      // 运镜没走完就被卸了（切路由）：收成"演过了"。不收的话下次进工坊会一直停在高处
      // ——本会话"已经播过"不重播，可状态还停在 holding（见 introCam.abandonIntroCam）。
      abandonIntroCam();
    };
  }, []);
  useFrame(({ camera, scene, clock }, dt) => {
    const st = useStudio.getState();
    // ── 米制档的小幅环视（主人第 2 条）：每帧推一次回中 ──
    // 面板盖着时渲染循环停（StudioPage 的 frameloop），回中也跟着停 —— 关掉面板会从停下的角度接着回，
    // 不会卡住（见 gsLook.ts 头注释）。
    gsLookTick();
    // 离开米制档（splat 失败回退老书房 / 关实验档）时把角度归零：老场景那台相机不接受这一层。
    if (!gsSceneMetric() && gsLookMoving()) gsLookReset();
    /** 摘掉玩家模型后的默认机位（`SHOW_PLAYER_BODY=false` 时求值）。
     *
     *  ★ G1 施工单第 1 步（docs/g1-scene-plan.md §1）：人偶摘掉，第一人称眼位就没有骨骼可跟了
     *    —— eyeCam 读的 PLAYER_HEAD 只会停在"模型没加载完"的占位值上（低、近、还朝着一个不存在的头），
     *    画面不对却零报错。所以这一支整段不再碰任何玩家骨骼/眼位，只读 layout 的固定常量。
     *  ★ G1 第 2 步（2026-11-22）：常量从俯视的 DEFAULT_CAM 换成 §4 的**落点机位** LAND_CAM ——
     *    俯视那台把铸卡师的头顶压到画面 y=1.4%（顶栏一盖就"只露胸以下"），落点机位头顶在 26%、
     *    卡组堆仍在 y 67~80% 且没有甩到镜头背后。取景依据与量出来的数都在 layout.LAND_CAM 的注释里
     *    （**改机位先改那一处**）。
     *  ★ G4 收尾（2026-11-23，任务 B）：LAND_CAM 换成"俯角 30.7°、近边 93.2%"那一台（参照图口径），
     *    这一行**不用改**——它只读 defaultCamFor 给的常量；新的投影数（头顶 14.8% / 卡位底沿 62.2% /
     *    近边 93.2%）同样在 layout.LAND_CAM 的注释里。
     *  ★ 按**画布宽高比**选（layout.defaultCamFor）：竖屏水平视野只有 ±12°，落点机位在竖屏下会把卡组堆
     *    甩出画外，而它是 openDeckView 的唯一入口。判据只在 layout 一处，这里只调用 —— 转屏时这一行
     *    就跟着换成另一台，CameraRig 的缓动负责把它平滑带过去，不需要额外的 resize 监听。
     *  ★ 别把机位接回任何骨骼 / PLAYER_HEAD —— 那就等于把要摘掉的那根依赖又装回去了。 */
    const defCam = defaultCamFor((camera as THREE.PerspectiveCamera).aspect);
    // ── 取景右移（layout.GS_FRAME_SHIFT，主人第 1 条）：只给米制档的**设计机位** ──
    // 对话/聚焦/商店（kind!=="default" 或 st.orbit 在）与验收机位覆盖（gsSceneCam）都不移 ——
    // 那几台被演出/验收依赖的取景别跟着漂（见 layout.GS_FRAME_SHIFT 的注释）。
    syncGsFrameShift(
      camera as THREE.PerspectiveCamera,
      size.width,
      size.height,
      gsSceneMetric() && !gsAcceptCamOn() && st.camera.kind === "default" && !st.orbit && !orbit.active,
      frameShift,
    );
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
    // 水平绕行范围（G4 商店，施工单 §2 第 3 条）：0 = 不限（NPC 对话就是这一档），
    // 商店那趟由 studioStore.enterShopCam 把 orbit.yawLimit 设成 layout.SHOP_ORBIT_YAW。
    // 每帧对一次 store —— 它是判据的唯一出处，这里不缓存"现在是不是商店"。
    orbit.yawLimit = st.orbit?.yawLimit ?? 0;
    // ── 开场运镜（G1 施工单 docs/g1-scene-plan.md §4）：这一段**压过**下面所有运镜 ──
    // ★ 施工单要求的"与 cameraOrbit 互斥"就是这一个早退：运镜期间直接 return，
    //   轨道分支（orbit.active && center）、卡组滑梯、默认机位缓动全轮不到执行，
    //   也就没有"拖拽/陀螺仪把镜头抢回去"这回事；syncOrbitFromCamera 一次都不调
    //   （只在 ended 那一帧调一次，把手感交回去 —— 见下面）。
    // ★ 位姿每帧现算（终点按当前 aspect 取 defaultCamFor），播放途中转屏也落在对的机位。
    const intro = stepIntroCam(dt, (camera as THREE.PerspectiveCamera).aspect);
    if (intro) {
      camera.position.set(intro.pose.pos[0], intro.pose.pos[1], intro.pose.pos[2]);
      // RIG_LOOK 必须跟着走：收工后的第一帧走的是下面那条 lerp（k≈7%），它若还停在旧值，
      // 镜头会先看歪一帧再慢慢掰回来（"落定那一下愣一下"）。
      RIG_LOOK.set(intro.pose.look[0], intro.pose.look[1], intro.pose.look[2]);
      camera.lookAt(RIG_LOOK);
      if (intro.ended && center) syncOrbitFromCamera(camera.position, center);
      return;
    }
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
      // 商店只能绕正面 180°（施工单 §2 第 3 条）：yawLimit=0 时它是空操作，对话那一趟照旧。
      // 放在**每帧**而不是只在拖拽里夹：接管轨道的第一帧（syncOrbitFromCamera 从当前机位
      // 反解出来的 θ）也可能落在范围外 —— 那时若只靠拖拽那条路，画面会先歪一下再被拉回。
      clampOrbitYaw();
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
      if (!SHOW_PLAYER_BODY) {
        // ★ G1 §1 + §2 第 2 步：这一支不再碰任何玩家骨骼/眼位，只读上面算出来的默认机位
        //   （横屏落点 / 竖屏俯视，见 defCam 的注释）。
        target = defCam;
      } else {
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
      }
    } else {
      // ★ 机位来路不明就退回兜底机位，别信任 st.camera 的形状。
      //   下面直接取 target.pos[0..2]：只要有谁产出一个缺坐标或带 NaN 的 kind:"pos"
      //   （少传 focusNode 的 pos/look、算 x 时拿到 undefined、草稿里存进过脏值……），
      //   这里每帧抛一次错，整个 3D 页白屏且**自己好不了**——渲染循环挂了就没人再去
      //   改状态。一次 isFinite 换掉一类不可恢复的崩溃，很划算。
      //   ★ 兜底分两种：有玩家身体时退回眼位；摘掉之后（G1 §1）eyeCam 不再求值、
      //     eyeP 一直是 (0,0,0)（原点在桌板里，等于黑屏），所以退回上面那台默认机位。
      target = camOk(st.camera)
        ? st.camera
        : SHOW_PLAYER_BODY
          ? { pos: [eyeP.current.x, eyeP.current.y, eyeP.current.z], look: [eyeL.current.x, eyeL.current.y, eyeL.current.z] }
          : defCam;
    }
    // 第一人称把近裁剪面从 0.1 收到 0.03：眼点就在自己领口上方 6cm，0.1 的近面
    // 会把领口整片切掉——想"低头看见自己身体"就必须让它更近。实测 Tsumire 领口顶
    // 距眼 0.062，0.1 切、0.03 不切。只在眼位切换，其他视角维持 0.1 保住远景深度
    // 精度（far=80，0.03 会把比值推到 2667）。
    // ★ G1 §1：人偶摘掉后没有"自己的身体"要防切，固定机位一律 0.1（0.03 只会白丢远景精度）。
    const wantNear = SHOW_PLAYER_BODY && st.camera.kind === "default" && eyeRise.v < 0.5 ? 0.03 : 0.1;
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.near !== wantNear) {
      persp.near = wantNear;
      persp.updateProjectionMatrix();
    }
    // ★ G1 §1：卡组视角是"绕玩家上半身"的第三人称特写，人偶摘掉后没有可拍的角色；
    //   openDeckView 也不再设 DECK_CAM / orbit:"player"，所以整段滑梯与绕身运镜跟着
    //   身体一起休眠（下面用到 PLAYER_HEAD 的两处 lerp 也在这段里）。deckView 仍在，
    //   只负责开投影窗，镜头留在默认固定机位。
    const deckCamOn = SHOW_PLAYER_BODY && st.deckView;
    // 手机竖屏（aspect<0.62）垂直 FOV 固定→水平视野变窄→卡组机位下人脸过大：自动后撤一档
    const narrowPull =
      deckCamOn && (camera as THREE.PerspectiveCamera).aspect < 0.62 ? -0.3 : 0;
    if (deckCamOn && !prevDeck.current) {
      deckAnim.current = { p: 0, start: camera.position.clone() };
      deckCamArrived.v = false; // 滑梯起飞：按钮先撤，落位再出
    }
    prevDeck.current = st.deckView;
    if (!st.deckView) {
      deckAnim.current = null;
      deckCamArrived.v = false; // 离开卡组视角
    }
    const anim = deckAnim.current;
    if (anim && deckCamOn) {
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
    if (deckCamOn) deckCamArrived.v = true;
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(tmp.current.set(target.pos[0], target.pos[1], target.pos[2] + narrowPull), k);
    RIG_LOOK.lerp(tmp.current.set(target.look[0], target.look[1], target.look[2]), k);
    camera.lookAt(RIG_LOOK);
    // ── 小幅环视（layout.GS_LOOK 那一套）：**只转朝向、不动位置**，叠在 lookAt 之后 ──
    // 只在设计机位上生效（与人偶第一人称 eyeLook 是两套，见 gsLook.ts 头注释）。
    if (gsSceneMetric() && st.camera.kind === "default") applyGsLook(camera);
    // 脚本运镜期间持续同步球面参数：用户随时接管都不跳变
    if (center) syncOrbitFromCamera(camera.position, center);
  });
  return null;
}

// ── 桌面（旧场景那张长桌；尺寸/朝向由 layout 决定） ─────────────
function Table() {
  // ★ 桌面尺寸/朝向只有一处：layout.sceneLayout（横屏 22×9 / 竖屏 16×7 / 高斯米制 2.50×1.17）。
  //   米制档（高斯场景）桌面顶面仍是 y=0、桌子离地 0.765，并叠光毯；老场景观感逐字节不变。
  const T = sceneLayout(useIsLandscape()).table;
  const metric = gsSceneMetric();
  // 米制档把 splat 那张 2.50 的长桌长度一起传下去：毡面收短到 2.15 之后，两端由木端板盖住
  // ★ 2026-11-27：整张网格桌面跟 NPC 一起沿世界 −z 平移 0.20 m（layout.GS_TABLE_SHIFT，§18.2）
  return (
    <WorkshopTable
      T={T}
      height={metric ? GS_TABLE.height : undefined}
      metric={metric}
      splatLen={metric ? GS_TABLE.splatLen : undefined}
      offsetZ={metric ? GS_TABLE_SHIFT.z : 0}
    />
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
//
// ★★ 2026-11-26 第 3 版（`feat/gs-polish2`，主人第 5 条「按钮位置/大小，像炉石传说那样」）：
//   米制档**换一套摆法**（`layout.GS_PAD`），老场景那套一个像素不动（`metric` 分支只加不改）：
//    · 位置：中线**右侧**（屏幕右 = 世界 −z）、靠玩家这一侧的长桌沿 —— 中心 (0.46, −0.78)；
//    · 尺寸：牌面 **0.39 × 0.12 m**（0.39 / 2.15 = 桌面长轴的 18%）；
//    · 姿态：朝相机**后仰 40°**（正面机位仰角 33°，牌面几乎正对镜头；俯视机位也还看得见）；
//    · 热区：另给一块**不可见**的 0.42 × 0.20 平面（正面机位投影出 117×56 CSS px ≥ 44×44）。
//   文案一个字没改（还是那两句：就绪 / 尚未就绪 + 副题）。
function ComposePad() {
  const { t } = useLingui();
  // 法阵摆在中线右端：横屏链尾卡在 2.34，法阵跟着挪到 3.0（layout.COMPOSE_POS_LAND 的注释）
  const composePos = sceneLayout(useIsLandscape()).composePos;
  const metric = gsSceneMetric();
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
          enabled ? t`整片就绪` : t`尚未就绪`,
          enabled ? t`点亮法阵 · 去剪辑成片` : picked ? t`先生成当前段的视频` : t`先为当前段挑定一套方案`,
          enabled,
          // 米制档的牌子只有 0.39 m 宽：字号放大 1.55 倍才在真机上读得出来（见 composePlateTexture）
          metric ? 1.55 : 1,
        ),
        transparent: true,
        depthWrite: false,
      }),
    // t 进依赖：切界面语言要重画铭牌（纹理按文字缓存，换一句就是另一张）
    [enabled, picked, t, metric],
  );
  useEffect(() => () => sigilMat.dispose(), [sigilMat]);
  useEffect(() => () => runeMat.dispose(), [runeMat]);
  useEffect(() => () => plateMat.dispose(), [plateMat]);

  /** ★ `padDbg`（localStorage `gsPadDebug=1`）：**验收钩子**。法阵只有在"流水线每段都出过片"
   *    时才亮（`composable`），而模拟器上没有任何段（要么联网要么真炼一段），所以"点得开生成流程"
   *    这条验收在没有段的机器上永远点不亮。这个钩子只做一件事：把暗着的键当亮的用 + 打一行日志。
   *    生产里没人写这个键 = 完全不存在；验收完把数抄进文档，别把它当功能。 */
  const padDbg = useMemo(() => {
    try {
      return localStorage.getItem("gsPadDebug") === "1";
    } catch {
      return false;
    }
  }, []);
  const live = enabled || padDbg;

  useFrame((_, dt) => {
    const now = performance.now();
    // 台座呼吸：可合成时金光起伏，否则近乎熄灭
    // 只给极轻的呼吸。**发光的必须是刻纹不是台面**：这屋子从桌毡到卡框到烛台，
    // 全是"暗底 + 细金线"，台面一亮就成了一枚金币，把旁边桌毡那圈细刻线整个压住
    // （第一版给到 0.45 就是这个下场）。
    if (base.current) base.current.emissiveIntensity = live ? 0.10 + 0.05 * Math.sin(now / 380) : 0.02;
    // 符文环缓转——**只在可合成时转**。转动是这里唯一的动效，克制到底：
    // 暗房里一个持续闪烁的东西会一直抢注意力，而"缓慢旋转"读作蓄势，不吵
    if (ring.current) {
      ring.current.visible = enabled;
      if (enabled) ring.current.rotation.z += dt * 0.35;
    }
    if (beam.current) {
      beam.current.visible = enabled;
      const m = beam.current.material as THREE.MeshBasicMaterial;
      if (enabled) m.opacity = 0.1 + 0.06 * Math.sin(now / 520);
    }
  });

  /** 点下去 = 去工作流（两侧共用同一份；`enabled` 为假时是"能看见但按不动"） */
  const go = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (padDbg) console.log(`[gs] pad hit（enabled=${enabled}）`);
    // 不再一把梭合成整片：铺成工作流，去 /flow 逐段生成逐段确认
    // ★ 小窗的"波浪扩散"要从**点击位置**长出来：生成键是 3D 网格，把这一下的屏幕坐标交给 store
    //   （ui/WorkflowWindow 读它算 clip-path 圆心）。老路径 / 空流水线不用这个数。
    if (live) useStudio.getState().requestFlow([e.nativeEvent.clientX, e.nativeEvent.clientY]);
  };

  // ── 米制档：炉石那样的牌子（位置/尺寸/姿态全在 layout.GS_PAD）────────────────
  if (metric) {
    const P = GS_PAD;
    // 牌面姿态（推导写在 GS_PAD 的注释里）：
    //   朝向组绕 y 转 90° ⇒ 组内 local +z（平面法线）指向世界 +x、local +x 指向世界 −z；
    //   牌面网格再绕 local x 转 −tilt ⇒ 法线抬高 tilt（正对相机来的那个方向），上沿朝 +x 后仰。
    //   组内位置的映射：local (x,y,z) → world (z, y, −x)，所以"往 +x 挪 dx"要写成 local z = dx。
    const plateDx = (P.h / 2) * Math.sin(P.tilt);
    const plateY = P.baseH + (P.h / 2) * Math.cos(P.tilt);
    const hitDx = 0.03 + (P.hitH / 2) * Math.sin(P.tilt);
    const hitY = P.baseH + 0.03 + (P.hitH / 2) * Math.cos(P.tilt);
    return (
      <group position={[P.x, 0, P.z]} onClick={go}>
        {/* 台座：一块薄黄铜底板压在桌上 */}
        <mesh position={[0, P.baseH / 2 + 0.002, 0]}>
          <boxGeometry args={[P.baseD, P.baseH, P.baseW]} />
          <meshStandardMaterial
            ref={base}
            color={live ? "#2b2314" : "#161c2c"}
            metalness={0.85}
            roughness={0.3}
            emissive="#d6b26a"
            emissiveIntensity={0.02}
          />
        </mesh>
        {/* 台座里那一格法阵刻纹（平放）：读作"桌面法阵的右端节点"，不是贴上去的塑料键 */}
        <mesh position={[-0.075, P.baseH + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} material={sigilMat}>
          <planeGeometry args={[0.16, 0.34]} />
        </mesh>
        {/* 缓转符文环（只在可合成时转，与老场景同一份动效） */}
        <mesh ref={ring} position={[-0.075, P.baseH + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} material={runeMat}>
          <planeGeometry args={[0.23, 0.46]} />
        </mesh>
        <group rotation={[0, Math.PI / 2, 0]}>
          {/* 牌面：0.39 × 0.12（= 桌长的 18%），朝相机后仰 40° */}
          <mesh position={[0, plateY, plateDx]} rotation={[-P.tilt, 0, 0]} material={plateMat}>
            <planeGeometry args={[P.w, P.h]} />
          </mesh>
          {/* 热区：**不可见**的 0.42×0.20 平面（与牌面同姿态）。
              ★ 0.39×0.12 的牌子在真机上只有 ~101×33 CSS px —— 够宽不够高，热区要 ≥44×44，
                所以补一块更高的隐形平面接点击（它不遮挡任何东西：那一片只有牌子和桌子近角）。 */}
          <mesh position={[0, hitY, hitDx]} rotation={[-P.tilt, 0, 0]}>
            <planeGeometry args={[P.hitW, P.hitH]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </group>
    );
  }

  return (
    <group
      position={composePos}
      onClick={go}
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
  const { t } = useLingui();
  const deck = useStudio((s) => s.deck);
  const activeDeck = useStudio((s) => s.activeDeck);
  // 横屏卡组堆往左让、离镜头更近（layout.DECK_POS_LAND 的注释）；卡面缩放跟节点链同一档
  const L = sceneLayout(useIsLandscape());
  const deckPos = L.deckPos;
  const chainScale = L.chain.scale;
  // ★ 米制档（高斯场景）：一叠 24 张按老步长 0.014 会摞成 0.35 m 高（真牌叠只有 4~5 cm），
  //   步长按 1/5 收；卡名标签的尺寸也跟着桌子收（见下面 countMat 那张平面）。
  const metric = gsSceneMetric();
  const pileStep = metric ? 0.003 : 0.014;
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
    activeDeck ? `${activeDeck.name.slice(0, 6)} ${deck.length}` : t`卡组 ${deck.length}`,
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
        rotation={[-Math.PI / 2, 0, metric ? GS_ROWS.flatRotZ : 0]}
        position={[deckPos[0], 0.009, deckPos[2]]}
        scale={chainScale}
        material={markerMat}
      >
        <planeGeometry args={[cardLayout().w * 1.1, cardLayout().h * 1.08]} />
      </mesh>
      {Array.from({ length: shown }, (_, i) => (
        <mesh
          key={i}
          rotation={[
            -Math.PI / 2,
            0,
            (metric ? GS_ROWS.flatRotZ : 0) + ((i * 37) % 11) * 0.012 - 0.06,
          ]}
          position={[deckPos[0], 0.012 + i * pileStep, deckPos[2]]}
          scale={chainScale}
          material={backMat}
        >
          <planeGeometry args={[cardLayout().w, cardLayout().h]} />
        </mesh>
      ))}
      <mesh
        position={[deckPos[0], metric ? 0.02 : 0.12, deckPos[2] - (metric ? 0.28 : 0.62) * chainScale]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={chainScale}
        material={countMat}
      >
        <planeGeometry args={metric ? [0.42, 0.115] : [1.1, 0.3]} />
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
  const L = sceneLayout(useIsLandscape());
  const S = L.spread;
  if (!open || deck.length === 0) return null;
  const start = Math.min(Math.max(0, center - 2), Math.max(0, deck.length - S.maxVisible));
  const visible = deck.slice(start, start + S.maxVisible);
  return (
    <group>
      {visible.map((card, i) => {
        const idx = start + i;
        const isCenter = idx === center;
        // ★ 沿轴排（SpreadLayout.axis）：老场景沿 x、米制档沿长轴 z（NPC 侧那半张桌）
        const along = S.center + (i - (visible.length - 1) / 2) * S.gap;
        const [x, z] = S.axis === "z" ? [S.at, along + (isCenter ? 0.06 : 0)] : [along, S.at + (isCenter ? 0.1 : 0)];
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            from={L.deckPos}
            target={[x, isCenter ? 0.16 : 0.04 + i * 0.012, z]}
            // 米制档：摊开的牌也按玩家那一侧读（牌的上边朝 −x）
            rotZ={gsSceneMetric() ? GS_ROWS.flatRotZ : 0}
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

// ── 拖拽层：卡片跟随指针；单击 = 看详情（G4 第 1 步还没有落点）─────────────
function DragLayer() {
  const dragCardId = useStudio((s) => s.dragCardId);
  const deck = useStudio((s) => s.deck);
  const card = deck.find((c) => c.id === dragCardId) ?? null;
  const ghost = useRef<THREE.Group>(null);
  // 捕获指针的隐形平面跟桌子走（横屏 22×9 / 竖屏 16×7）
  const L = sceneLayout(useIsLandscape());

  useEffect(() => {
    if (!dragCardId) return;
    const onUp = () => {
      const st = useStudio.getState();
      const id = st.dragCardId;
      if (!id) return;
      if (!dragState.moved) {
        // 单击（没拖动）：编辑器开着=选入素材槽；否则打开卡片详情
        if (st.editor && !st.editor.generating) {
          st.pickDeckCard(id);
        } else {
          const c = st.deck.find((x) => x.id === id);
          if (c) st.viewCardDetail(c);
        }
      }
      // ★ 拖到桌上松手这一步**没有落点**：桌面上的 5 个卡位是 G4 第 3 步才接拖拽的
      //   （拖卡入位 + 每角色最多 3 件道具）。原来"松手落在虚线卡位 → 开铸段窗"那一路随
      //   节点链一起撤了；这里不静默打开一个已经不在桌面上的编辑器。
      st.setDrag(null);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [dragCardId]);

  useFrame(() => {
    if (ghost.current) {
      // 米制档拖拽中的卡悬在桌面上方 0.12 m（老场景 0.45 —— 那是"UI 单位"）。
      ghost.current.position.set(dragState.x, gsSceneMetric() ? 0.12 : 0.45, dragState.z);
      ghost.current.rotation.z = (dragState.x - dragState.startX) * -0.06;
    }
  });

  if (!card) return null;
  return (
    <group>
      {/* 捕获指针移动的隐形平面 */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        // ★ 2026-11-27：米制档平面跟着桌子平移（拖到桌沿附近时才不会提前"出桌"）
        position={[0, 0.3, gsSceneMetric() ? GS_TABLE_SHIFT.z : 0]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          dragState.x = e.point.x;
          dragState.z = e.point.z;
          if (Math.hypot(e.point.x - dragState.startX, e.point.z - dragState.startZ) > (gsSceneMetric() ? 0.06 : 0.25)) dragState.moved = true;
        }}
      >
        <planeGeometry args={[L.table.w + 6, L.table.d + 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={ghost}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[cardLayout().w, cardLayout().h]} />
          <meshBasicMaterial map={cardFaceTexture(card)} transparent opacity={0.92} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

// ── 市场平摊（NPC 侧那一排，沿长轴顺放） ──────────────
function MarketFan() {
  const market = useStudio((s) => s.market);
  const detail = useStudio((s) => s.marketDetail);
  // 横屏一页 8 张（2 排 × 4），竖屏 6 张（2 × 3）—— 摆位与分页必须是同一套常量
  const land = useIsLandscape();
  const M = sceneLayout(land).market;
  // ★ 米制档：NPC 侧那一排是**平放**的牌，跟玩家那排同一套朝向（牌的上边朝 −x，玩家从 +x 读着正）
  const metric = gsSceneMetric();
  if (!market.open) return null;
  // 只摆本页那几张。以前是把 searchMarket 返回的 8 张全铺出去——那 8 是
  // "一屏摆得下几张"的旧口径，既切了卡又把另外 11 张种子卡藏了起来
  const start = market.page * M.perPage;
  const page = market.items.slice(start, start + M.perPage);
  return (
    <group>
      {page.map((card, i) => {
        const { x, z, col, rowCount } = marketSlot(land, i, page.length);
        const cam = focusCam(x, z);
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            from={metric ? [0.25, 0.35, -0.9] : [0.9, 0.9, -3.2]}
            target={[x, M.lift + i * 0.004, z]}
            rotZ={metric ? GS_ROWS.flatRotZ : (col - (rowCount - 1) / 2) * -0.04}
            scale={M.scale}
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

// ── G4 桌面 5 个卡位：4 角色位一排 + 1 场景位（左上方、桌面中线玩家这一侧）─────
//
// ★ 位子上是谁来自 rules.tableSlotsOf（G4 第 3 步起是**真的状态**：拖上桌的卡从背包拿出来放进
//   player.table），view.gameViewOf 把它挂到 view.table 上。这一层只把"空 / 已放 / 正拖到它上面"画出来。
// ★ 拖拽：起点在 2D 那一层（背包条 / 右侧道具栏是 DOM），落点判定靠**把卡位投影回屏幕**
//   （scene/slotScreen：与 NPC_SCREEN / PLAYER_SCREEN 同一套 project 做法），3D 这一侧只做两件事 ——
//   ① 每帧把五格的屏占比重算一遍（相机一动就跟着动；商店拉近、进对话视角都对得上）；
//   ② 按对局 store 的 `drag.hover` 高亮"现在悬在哪一格"（拖拽高亮只有这一个读数，别再各算一次）。
// ★ 从桌面上把卡拖回背包：在卡位上按下去就开一个 kind="return" 的拖拽（R3F 的 pointerdown），
//   之后的移动 / 松手交给 2D 那层（GameDragLayer）—— 两处手势是同一个 store 状态，不是两套实现。
const EMPTY_TABLE: TableSlots = { roles: [null, null, null, null], scene: null };

function SlotPlate({
  x,
  z,
  scale,
  kind,
  index,
  card,
  hot,
  rotZ = 0,
}: {
  x: number;
  z: number;
  scale: number;
  kind: "role" | "scene";
  /** 角色位下标（场景位不传）：拖拽状态认位子认的是它 */
  index?: number;
  card: GameCard | null;
  /** 现在正拖着一张卡悬在这一格上 */
  hot: boolean;
  /** 牌面在桌上的朝向（绕牌面法线转的角度）：米制档玩家那排 +90°（牌的"上边"朝 −x，
   *  玩家从 +x 那一侧读着正）、场景位 −90°（朝铸卡师那一侧） */
  rotZ?: number;
}) {
  const w = cardLayout().w * scale;
  const h = cardLayout().h * scale;
  // 角色位青、场景位金；空位是同一档的暗色（空 ≠ 没有这一格，只是还没放）；正悬在上面时更亮一档
  const ink = hot ? (kind === "role" ? "#a5f3fc" : "#f3d69a") : card ? (kind === "role" ? "#67e8f9" : "#d6b26a") : "#31465c";
  const frame = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: ringTexture(ink),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [ink]
  );
  useEffect(() => () => frame.dispose(), [frame]);
  // 卡名用现有的文字纹理（512×128），铺一条扁横条压在牌框下部；空位写「+」（比牌框亮一档才看得见）
  const name = card ? gameCardName(card) : "+";
  const labelInk = card ? ink : "#5e8199";
  const label = useMemo(() => labelTexture(name, labelInk), [name, labelInk]);
  return (
    <group position={[x, cardLayout().lift, z]}>
      <mesh rotation={[-Math.PI / 2, 0, rotZ]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#0b1a2c" transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, rotZ]} position={[0, 0.004, 0]} material={frame}>
        <planeGeometry args={[w * 1.12, h * 1.09]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, rotZ]} position={[0, 0.008, card ? 0.3 * h : 0]}>
        {/* 空位那个「+」比卡名放大一档（4:1 的文字纹理压进 2:1 的扁条）：不加大的话在横屏
            真机（800×363）上只有 4~5 px，等于没画。 */}
        <planeGeometry args={[card ? w * 0.92 : w * 1.05, card ? w * 0.23 : w * 0.5]} />
        <meshBasicMaterial map={label} transparent depthWrite={false} />
      </mesh>
      {/* 按下来 = 把这张卡从桌上拖走（落点由 2D 那层判；空位不接受 pointerdown —— 空位没有东西可拖） */}
      {card && (
        <mesh
          rotation={[-Math.PI / 2, 0, rotZ]}
          position={[0, 0.01, 0]}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            useGame.getState().beginDrag({
              kind: "return",
              cardId: card.id,
              hover: kind === "scene" ? { kind: "scene" } : { kind: "role", index: index ?? 0 },
            });
          }}
        >
          <planeGeometry args={[w * 1.12, h * 1.09]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function GameTableSlots() {
  const land = useIsLandscape();
  const S = sceneLayout(land).slots;
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const hover = useGame((s) => s.drag?.hover ?? null);
  const camera = useThree((s) => s.camera);
  const metric = gsSceneMetric();
  const table = (state ? gameViewOf(state, meId)?.table : null) ?? EMPTY_TABLE;

  /** 五格的世界坐标（角色 4 + 场景 1），投影与绘制读同一份：位子挪了不会只挪一半。
   *  一排 4 个角色位沿哪条轴由 SlotLayout.axis 定（老场景沿 x 横排、米制档顺长轴竖排）；
   *  米制档的牌在桌上转 90°（牌的上边朝 −x = 背对玩家，躺着读正），场景位的牌朝铸卡师那一侧。 */
  const plates = useMemo(() => {
    const roleRot = metric ? GS_ROWS.flatRotZ : 0;
    // ★ 米制档整排跟着桌子平移 0.20 m（§18.2）：S.roleShift 是唯一的偏移位
    const roleShift = S.roleShift ?? 0;
    const roles = Array.from({ length: TABLE_ROLE_SLOTS }, (_, i) => {
      const along = (i - (TABLE_ROLE_SLOTS - 1) / 2) * S.roleDx;
      const [x, z] = S.axis === "z" ? [S.roleAlong, along + roleShift] : [along, S.roleAlong + roleShift];
      return { slot: { kind: "role" as const, index: i }, x, z, scale: S.roleScale, rotZ: roleRot };
    });
    return [
      ...roles,
      {
        slot: { kind: "scene" as const },
        x: S.sceneX,
        z: S.sceneZ,
        scale: S.sceneScale,
        rotZ: metric ? -GS_ROWS.flatRotZ : 0,
      },
    ];
  }, [S, metric]);

  // 每帧把五格的屏占比重算进 SLOT_SCREEN（2D 那一层按它判落点、亮高亮）。
  // ★ 相机这一刻就可能是商店机位 / 对话视角：不做缓存，宁可每帧算 5×4 次投影（这点量看不见）。
  // ★ 米制档的牌在桌上转了 90°（牌的"上边"朝 −x）：屏占比要按**四角**算 —— 平铺那套
  //   "中心 ± halfW/halfH"默认宽在 x、高在 z，转 90° 之后正好反过来，不改会算成横躺的框。
  const probe = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const rects = plates.map((plate) => {
      const w = cardLayout().w * plate.scale;
      const h = cardLayout().h * plate.scale;
      const c = Math.abs(Math.cos(plate.rotZ));
      const s = Math.abs(Math.sin(plate.rotZ));
      const halfX = (c * w + s * h) / 2;
      const halfZ = (s * w + c * h) / 2;
      let minX = 2;
      let maxX = -2;
      let minY = 2;
      let maxY = -2;
      let visible = false;
      for (const dx of [-halfX, halfX]) {
        for (const dz of [-halfZ, halfZ]) {
          probe.set(plate.x + dx, cardLayout().lift, plate.z + dz).project(camera);
          const sx = (probe.x + 1) / 2;
          const sy = (1 - probe.y) / 2;
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
          if (probe.z < 1) visible = true;
        }
      }
      return {
        slot: plate.slot,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        rx: Math.max((maxX - minX) / 2, 0.012),
        ry: Math.max((maxY - minY) / 2, 0.012),
        visible,
      };
    });
    SLOT_SCREEN.rects = rects;
  });

  return (
    <group>
      {plates.map((plate) => (
        <SlotPlate
          key={plate.slot.kind === "scene" ? "scene" : `role-${plate.slot.index}`}
          x={plate.x}
          z={plate.z}
          scale={plate.scale}
          rotZ={plate.rotZ}
          kind={plate.slot.kind}
          index={plate.slot.kind === "role" ? plate.slot.index : undefined}
          card={plate.slot.kind === "scene" ? table.scene : (table.roles[plate.slot.index] ?? null)}
          hot={!!hover && sameTableSlot(hover, plate.slot)}
        />
      ))}
    </group>
  );
}

// ── 生成的卡飞入卡组 ─────────────────────────────────────────
function FlightCard({ f }: { f: Flight }) {
  const group = useRef<THREE.Group>(null);
  const landed = useRef(false);
  const start = useRef<number | null>(null);
  const fromV = useMemo(() => new THREE.Vector3(...f.from), [f]);
  const deckPos = sceneLayout(useIsLandscape()).deckPos;
  // 米制档：卡从上方 0.4 m 飘落（老场景 1.5 是世界单位；1 单位=1 米之后 1.5 m 会飞出画面）
  const metric = gsSceneMetric();
  const toV = useMemo(() => {
    const len = useStudio.getState().deck.length;
    return new THREE.Vector3(deckPos[0], (metric ? 0.015 : 0.06) + len * (metric ? 0.003 : 0.014), deckPos[2]);
  }, [deckPos, metric]);
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
    group.current.position.y += Math.sin(Math.min(t, 1) * Math.PI) * (metric ? 0.4 : 1.5);
    group.current.rotation.y = e * Math.PI * 2;
    if (t >= 1) {
      landed.current = true;
      useStudio.getState().landFlight(f.id);
    }
  });
  return (
    <group ref={group} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cardLayout().w * 0.92, cardLayout().h * 0.92]} />
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
  // 米制档：6 张卡按 0.2 m 间距、0.6 缩放（真卡大小）摊在桌面远端；老场景逐字保留。
  const metric = gsSceneMetric();
  return (
    <group>
      {shown.map((card, i) => {
        const off = i - (n - 1) / 2;
        const x = off * (metric ? 0.19 : 0.72);
        // ★ 2026-11-27：米制档这排对话卡也在桌面上，跟着桌子一起平移 0.20 m（§18.2）
        const z = metric ? -0.45 - Math.abs(off) * 0.02 + GS_TABLE_SHIFT.z : -1.7 - Math.abs(off) * 0.08;
        return (
          <CardMesh
            key={card.id}
            tex={cardFaceTexture(card)}
            target={[x, 0.02 + i * 0.004, z]}
            rotZ={-off * 0.06}
            scale={metric ? 0.6 : 0.64}
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
  const { camera, gl, scene } = useThree();
  // 空白桌面的点击平面跟桌子大小走：横屏 22×9，竖屏 16×7（点击捕获范围别比桌面小）
  const T = sceneLayout(useIsLandscape()).table;
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
    // 两种拖拽语义：有轨道中心 → 绕圆心球面运动；第一人称眼位 → 转角色的头环视；
    // ★ 2026-11-26 第 4 版（主人第 2 条）：米制高斯档（没有玩家身体、也没有轨道）多一档 **小幅环视** ——
    //   单指在**空白桌面 / 背景**上拖 → 视线转 ±6°/±3°，松手 0.75s 回中（状态在 gsLook.ts）。
    // ★ G1 §1：玩家模型摘掉后默认机位是**固定**的，没有"转头"这件事可做 —— 手势直接不接，
    //   否则拖动会攒 eyeLook 却什么都不动（看着像坏了）。轨道拖拽/缩放照 ORBIT_LIMITS 走。
    const mode = () => {
      const st = useStudio.getState();
      if (st.orbit) return "orbit" as const;
      // 米制档的默认机位：只有它接小幅环视（老场景的落点机位不接，逐字节不变）
      if (gsSceneMetric() && st.camera.kind === "default") return "gsLook" as const;
      return SHOW_PLAYER_BODY && st.camera.kind === "default" ? ("eye" as const) : null;
    };
    /** 按下的那一点是不是压在**可交互的 3D 物件**上（卡牌 / 铭牌 / NPC / 卡组 / 场景位…）。
     *  主人第 2 条："在卡牌/铭牌上按下不进入环视，只在空白桌面/背景拖动才环视"。
     *  ★ 判据用 R3F 记在对象上的 `__r3f.eventCount`（有 onClick/onPointer* 才算）——R3F 自己的
     *    命中筛选就是它，另造一套标记（给每张卡挂 userData）迟早漏一处。这是内部字段，
     *    与本仓别处依赖 r3f frameloop 行为一样，升级 r3f 时要知道这一行。
     *  ★ `userData.noCam` 是本文件那块**空白桌面拾取面**（TableCatcher 自己）的标记：
     *    射线先打到它 = 落在空桌上，跳过它继续看下一层（下面就是桌子网格，也不交互 ⇒ 可以环视）。
     *  ★ 只取**最前面那块**真正挡视线的东西：压在卡上的点不会被卡后面的桌子"放行"。 */
    const rc = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitInteractive = (e: PointerEvent): boolean => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      rc.setFromCamera(ndc, camera);
      const hits = rc.intersectObjects(scene.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        let blank = false;
        let interactive = false;
        while (o) {
          if (o.userData?.noCam) {
            blank = true;
            break;
          }
          const inst = (o as unknown as { __r3f?: { eventCount?: number } }).__r3f;
          if (inst?.eventCount) {
            interactive = true;
            break;
          }
          o = o.parent;
        }
        if (blank) continue; // 空白桌面的拾取面：看下一层
        return interactive; // 第一块真正压在手底下的东西说了算
      }
      return false;
    };
    const onDown = (e: PointerEvent) => {
      const m = mode();
      if (!m || e.target !== el) return;
      // 卡牌/铭牌/NPC 上按下不进入环视（卡自己的拖拽/点击照旧）
      if (m === "gsLook") {
        if (hitInteractive(e)) return;
        gsLookDown();
      }
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
        gsLookRelease(); // 拖到一半轨道中心/机位被换掉：别把"按着"的状态留在 module 单例里
        return;
      }
      const prev = s.pointers.get(e.pointerId)!;
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      s.moved += Math.hypot(dx, dy);
      s.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (m === "gsLook") {
        if (s.pointers.size === 1) gsLookDrag(dx, dy);
        return;
      }
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
        // 商店那趟只能绕正面 180°：夹在**每一帧拖拽之后**（yawLimit=0 时是空操作）。
        // 拖到边上再继续滑，θ 就不再增长 —— 手感是"撞到侧面停住"，而不是先转过去再弹回来。
        clampOrbitYaw();
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
      const had = g.current.pointers.delete(e.pointerId);
      g.current.lastPinch = null;
      // 最后一根手指抬起 = 松手 → 开始回中（gsLook 自己判"是不是真的在拖"）
      if (had && g.current.pointers.size === 0) gsLookRelease();
    };
    // 桌面调试便利：滚轮 = 轨道半径推拉；第一人称下 = 升空俯瞰（与双指捏合同源）
    const onWheel = (e: WheelEvent) => {
      const st = useStudio.getState();
      const o = st.orbit;
      if (!o) {
        // ★ G1 §1：固定机位没有"升空俯瞰"（那是从眼位抬头顶的同一件事），滚轮不再改机位
        if (SHOW_PLAYER_BODY && st.camera.kind === "default") {
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
      // 拖到一半就卸载（切路由 / splat 回退）：状态在 module 单例里，不归零会带进下一次
      gsLookReset();
    };
  }, [camera, gl, scene]);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      // ★ 2026-11-27：米制档的网格桌面整体沿世界 −z 平移了 0.20 m（layout.GS_TABLE_SHIFT），
      //   点空白桌面/拉远回默认机位的那块捕获平面必须跟它重合，否则右侧 0.2 m 点不到、左侧多一条假桌面。
      position={[0, 0.001, gsSceneMetric() ? GS_TABLE_SHIFT.z : 0]}
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
      <planeGeometry args={[T.w, T.d]} />
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

// ── 验收读数（2026-11-26，`feat/gs-table-fire`）：localStorage `gsAcceptDebug=1` 时把相机/视线/
//    铸卡师头骨/落位参数挂到 window.__gsAccept 上。模拟器验收要靠它量"桌长/桌高/房深/NPC"四个比例
//    （截图能量像素，但相机到底是哪台、NPC 站哪儿只有运行期读得到）。不写这个键 = 不存在。
//
// ★ 第 3 版（`feat/gs-polish2`）加了四项**这一版要报的数**，都能在真机上直接读：
//   · `npcOffsetM`   —— 铸卡师**身体中心**（hips 骨）投影到屏幕后，与桌面中心投影之间那一段
//                       在"过她身体中心、平行于画面"的轴上折回世界坐标的距离（米）。主人第 2 条
//                       的 "≤ 0.1 m" 量的就是它；
//   · `card`         —— 卡基尺寸、一排总宽、两排的屏幕框（主人第 4 条）；
//   · `pad`          —— 生成按钮的牌面/热区在世界里的盒子 + **热区投影出来的 CSS 像素**（第 5 条）；
//   · `fire`         —— 火焰的整体包围盒（三层 + 火星都算进去）与火星颗数（第 1 条）。
// ★ 只在写了 `gsAcceptDebug=1` 时算：每帧算一遍这些投影对 60fps 是白烧，而验收只要一次读数。
function AcceptProbe() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const on = useMemo(() => {
    try {
      return localStorage.getItem("gsAcceptDebug") === "1";
    } catch {
      return false;
    }
  }, []);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  /** 渲染帧计数：面板盖着时 frameloop=never，这个数会停住 —— 验收用它回答"还在空跑吗" */
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (!on) return;
    // ── 身体中心 vs 桌心（两条投影的横向差，折回世界米数）──────────────────────
    const cam = camera;
    const right = tmp.a.set(1, 0, 0).applyQuaternion(cam.quaternion);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    // 两个点各自"沿相机右手方向"的世界坐标分量之差 = 画面上左右方向的偏差（米）。
    // ★ 这个数恰好也等于"在过她身体中心、平行于画面的平面上折回来的米数"（推导：NDC 是分量
    //   除以 x 一个与深度成比例的尺度，两边乘回来正好约掉）。
    // ★★ 2026-11-27（feat/gs-auto-gate-align）：桌心**不再是世界原点** —— 桌子（含卡位/铭牌/
    //   法阵/光毯）沿世界 −z 平移了 `GS_TABLE_SHIFT.z`。`npcOffsetM` 量的是"她 vs 桌心线"，
    //   所以要把桌心在那条轴上的分量减掉：桌心 (0,0,shiftZ)·right = shiftZ·right.z。
    //   （right.z ≈ −1：世界 −z 是画面右；shiftZ=−0.2 ⇒ 减 0.2 ⇒ 0.212 回到 ≈0.012。）
    const tableCenterDot = GS_TABLE_SHIFT.z * right.z;
    const npcOffsetM = +(NPC_CENTER.dot(right) - tableCenterDot).toFixed(3);
    // ── 卡：尺寸 / 一排总宽 / 两排是不是真不重叠 ─────────────────────────────
    const C = cardLayout();
    const rowW = GS_ROWS.zs[GS_ROWS.zs.length - 1] - GS_ROWS.zs[0] + C.w;
    // ── 生成按钮：热区的屏幕投影（CSS px）──────────────────────────────────
    const P = GS_PAD;
    let minU = 1;
    let maxU = 0;
    let minV = 1;
    let maxV = 0;
    // 热区中心（与 ComposePad 米制分支里那块隐形平面同一处，别各算一份）
    const hcx = P.x + 0.03 + (P.hitH / 2) * Math.sin(P.tilt);
    const hcy = P.baseH + 0.03 + (P.hitH / 2) * Math.cos(P.tilt);
    for (const dz of [-P.hitW / 2, P.hitW / 2]) {
      for (const dy of [-P.hitH / 2, P.hitH / 2]) {
        // 热区与牌面同姿态：法线 (cos tilt, sin tilt, 0)，宽度沿 z、高度沿 (−sin tilt, cos tilt, 0)
        tmp.b.set(hcx - dy * Math.sin(P.tilt), hcy + dy * Math.cos(P.tilt), P.z + dz).project(cam);
        minU = Math.min(minU, (tmp.b.x + 1) / 2);
        maxU = Math.max(maxU, (tmp.b.x + 1) / 2);
        minV = Math.min(minV, (1 - tmp.b.y) / 2);
        maxV = Math.max(maxV, (1 - tmp.b.y) / 2);
      }
    }
    // 画布 CSS 尺寸（投影是 NDC 0~1，乘画布宽高就是 CSS px —— 与主人要的 44×44 同口径）
    const el = document.querySelector("canvas");
    const cw = el ? el.clientWidth : 1;
    const ch = el ? el.clientHeight : 1;
    // 火焰的整体包围盒（世界坐标）：以锚点为准，x 取柴木厚度，y 取"柴底 → 火舌顶"，z 取外焰半宽。
    // ★ 火焰片是绕 y 面向相机的单片，所以 x/z 那一头随相机变；这里给的是**正面机位**那一刻的值
    //   （也就是主人要看的那张壁炉近景同口径的盒子）。
    const [fx, fy, fz] = GS_FIRE_LIGHT.position;
    const fireBox = {
      x: [+(fx - 0.05).toFixed(3), +(fx + 0.05).toFixed(3)],
      y: [+(fy - 0.13).toFixed(3), +(fy + 0.42).toFixed(3)],
      z: [+(fz - 0.15).toFixed(3), +(fz + 0.15).toFixed(3)],
    };
    // ★ 火焰在**这一帧画布上的**包围盒（CSS px）：验收要比"同一机位隔 200 ms 两帧"的像素差，
    //   必须知道该裁哪一块 —— 让探针现算，脚本里别手抄坐标（换机位/换分辨率就错了）。
    //   8 个角点全部投影取 min/max；盒子比火焰略大（±0.05 / +0.42），裁出来带一点背景也正常。
    let fMinU = 1;
    let fMaxU = 0;
    let fMinV = 1;
    let fMaxV = 0;
    for (const dx of [fireBox.x[0], fireBox.x[1]]) {
      for (const dy of [fireBox.y[0], fireBox.y[1]]) {
        for (const dz of [fireBox.z[0], fireBox.z[1]]) {
          tmp.b.set(dx, dy, dz).project(cam);
          fMinU = Math.min(fMinU, (tmp.b.x + 1) / 2);
          fMaxU = Math.max(fMaxU, (tmp.b.x + 1) / 2);
          fMinV = Math.min(fMinV, (1 - tmp.b.y) / 2);
          fMaxV = Math.max(fMaxV, (1 - tmp.b.y) / 2);
        }
      }
    }
    const canvasEl = document.querySelector("canvas");
    const cRect = canvasEl ? canvasEl.getBoundingClientRect() : null;
    (window as unknown as Record<string, unknown>).__gsAccept = {
      pos: cam.position.toArray().map((n) => +n.toFixed(3)),
      look: RIG_LOOK.toArray().map((n) => +n.toFixed(3)),
      fov: cam.fov,
      aspect: +cam.aspect.toFixed(3),
      canvasCss: [Math.round(cw), Math.round(ch)],
      npcHead: NPC_HEAD.toArray().map((n) => +n.toFixed(3)),
      npcCenter: NPC_CENTER.toArray().map((n) => +n.toFixed(3)),
      npcOffsetM,
      card: { w: C.w, h: C.h, rowW: +rowW.toFixed(3), rowX: [GS_ROWS.npcX, GS_ROWS.playerX], gap: +(GS_ROWS.zs[1] - GS_ROWS.zs[0]).toFixed(3) },
      pad: {
        plate: { w: P.w, h: P.h, x: P.x, z: P.z, tiltDeg: +((P.tilt * 180) / Math.PI).toFixed(1) },
        hitCss: [Math.round((maxU - minU) * cw), Math.round((maxV - minV) * ch)],
        // 热区中心在画布上的 CSS px：验收脚本用它落触摸点（不用手算投影）
        hitCenterCss: [Math.round(((minU + maxU) / 2) * cw), Math.round(((minV + maxV) / 2) * ch)],
      },
      fire: {
        ...FIRE_FX,
        box: fireBox,
        // 画布 CSS px（含画布在窗口里的偏移）：截图裁火焰区域用（画布外的系统栏不算）
        screenBox: [
          Math.round(fMinU * cw),
          Math.round(fMinV * ch),
          Math.round(fMaxU * cw),
          Math.round(fMaxV * ch),
        ],
      },
      // 画布在窗口里的位置/尺寸（CSS px）：脚本把 CSS → 截图物理像素 那一层换算要用
      canvasRect: cRect
        ? { left: +cRect.left.toFixed(1), top: +cRect.top.toFixed(1), width: +cRect.width.toFixed(1), height: +cRect.height.toFixed(1) }
        : null,
      table: { w: GS_TABLE.w, d: GS_TABLE.d, shiftZ: GS_TABLE_SHIFT.z },
      transform: GS_STEP0_TRANSFORM,
      // ── 第 4 版（`feat/gs-framing-orbit-panel`）新加的三组读数 ──
      // 主人第 1 条：NPC 身体中心 / 桌右沿（木端板与长边护栏的外沿）在画布上的 x%。
      // 移轴之后投影矩阵里已经带着 viewOffset，所以这里读到的就是**成图上的数**。
      // ★ 2026-11-27：整桌平移之后，可见桌面的左右沿是**套在 splat 桌面两端**的木框：
      //   右侧是长边木沿外沿（x = w/2 + 0.03 + 0.015 = 0.63；玩家那一侧的皮革护栏按设计没有），
      //   左侧到 NPC 侧皮革护栏外沿（x = −(w/2 + 0.025 + 0.035) = −0.645）；两端都让出 3 cm。
      //   木框锚在**不能动的点云桌子**上（world z = ±1.28），不跟 GS_TABLE_SHIFT 走 ——
      //   跟它走的是毡面/卡位/铭牌/光毯。"桌子不出画"以这个世界坐标为准。
      npcScreenPct: +((((tmp.a.copy(NPC_CENTER).project(cam).x + 1) / 2) * 100).toFixed(2)),
      tableRightPct: +(
        (((tmp.a.set(GS_TABLE.w / 2 + 0.045, 0.02, -(GS_TABLE.splatLen / 2 + 0.03)).project(cam).x + 1) / 2) * 100).toFixed(2)
      ),
      tableLeftPct: +(
        (((tmp.a.set(-(GS_TABLE.w / 2 + 0.06), 0.02, GS_TABLE.splatLen / 2 + 0.03).project(cam).x + 1) / 2) * 100).toFixed(2)
      ),
      frame: { shift: GS_FRAME_SHIFT, viewOffsetOn: cam.view?.enabled === true, size: [Math.round(size.width), Math.round(size.height)] },
      // 主人第 2 条：环视当前角度（拖到底看这个数）、硬停与回中时长。
      // ★ 字段名 gsLook（不叫 look）：上面那个 `look` 是相机朝向锚点，两个不能撞。
      gsLook: { ...gsLookDeg(), maxYawDeg: GS_LOOK.yawMaxDeg, maxPitchDeg: GS_LOOK.pitchMaxDeg, returnMs: GS_LOOK.returnMs },
      frames: frames.current,
    };
  });
  return null;
}

export default function TableScene() {
  // ★ GS 第 0 步实验档（2026-11-25）：`gsPhase` 在开关关着时恒为 "off"，下面那棵树与今天逐字节相同。
  //   开着且没失败时，**整个桌面布局换成米制那套**（1 世界单位 = 1 米：layout.GS_*），房间与灯组
  //   整块交给 GsStep0Environment（splat 房间 + 月光 + 壁炉真火）。失败/超时它会自己翻回 "failed"
  //   ⇒ 今天那套。开关与落位参数在 ./gsStep0，台账 docs/gs-step2-splat-log.md 与 docs/gs-table-light-log.md。
  //   ★ 这里订阅 gsPhase 是必须的：米制布局的标志位由 gsStep0 在阶段变化时写，TableScene 要在
  //     翻到 failed 的那一拍重渲染，桌位/机位/NPC 才会跟着退回老场景（见 layout.setGsSceneMetric）。
  const gsPhase = useGsPhase();
  const metric = gsPhase === "loading" || gsPhase === "ready";
  return (
    <>
      {/* 房间 + 灯组：默认走今天的书房；GS 实验档开着时换成 splat 房间（见 GsStep0Environment） */}
      <GsStep0Environment />
      <CameraRig />
      {/* ★ 桌面统一这一处：旧场景那张长桌（WorkshopTable）。尺寸/朝向由 layout.sceneLayout 决定
          （高斯米制档 2.50×1.17 + 光毯；其余两套逐字节不变）。原来这里的 PBR 盖板已删除。 */}
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
          // ★ 高斯米制档换一份站位配置（GS_MILLTINA_CFG：脚踩 -0.775 的地板、站在桌子远端 z=-1.5）
          <TripoNpc
            url="/models/protected/milltina-opt.glbx?v=m16"
            cfg={metric ? GS_MILLTINA_CFG : MILLTINA_CFG}
            face={MILLTINA_FACE}
          />
        )}
      </Suspense>
      {/* ★ G1 施工单第 1 步（docs/g1-scene-plan.md §1）：「玩家自己」那具粗糙人偶摘掉。
          开关在 layout.SHOW_PLAYER_BODY；组件与相机兜底一起留着，改回 true 即可整条回滚。
          相机侧见 CameraRig 的 defCam（layout.defaultCamFor）—— 默认机位已经不再读玩家头骨。 */}
      {SHOW_PLAYER_BODY && <PlayerHandsSwitch />}
      <DeckStack />
      <DeckSpread />
      <MarketFan />
      <DialogTableCards />
      {/* G4：桌面上摆的是**对局的 5 个卡位**（4 角色 + 1 场景），原来的视频节点链已撤
          （节点卡搬进工作流面板是施工单第 3 步；这一拍只把位子与占位状态摆出来）。 */}
      <GameTableSlots />
      <Flights />
      <DragLayer />
      <NpcScreenAnchor />
      {/* ★ G1 §1：这个锚点只给「换形象」按钮定位（PLAYER_SCREEN）；人偶摘掉后
          没有"头侧"可标，按钮本身也一起休眠（AvatarSwapButton 里有同一道守卫）。 */}
      {SHOW_PLAYER_BODY && <PlayerScreenAnchor />}
      {import.meta.env.DEV && <CaptureHook />}
      {/* ★ 2026-11-26：验收探针只在写了 `gsAcceptDebug=1` 时挂（生产里连 useFrame 回调都不存在）。
          写成条件渲染而不是组件内早退，是因为验收脚本本来就是"写键 → reload"（见 gsStep0.gsAcceptProbeOn）。 */}
      {gsAcceptProbeOn() && <AcceptProbe />}
    </>
  );
}
