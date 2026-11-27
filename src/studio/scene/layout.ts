// 桌面世界坐标约定：桌面顶面 y=0；用户侧 z>0，NPC 侧 z<0；中线沿 x 轴。
// ★ G1 起**横屏优先**（docs/g1-scene-plan.md §2）：进工坊自动横屏，默认机位是能看全 NPC 的落点机位
//   （LAND_CAM）；竖屏窗口（浏览器 dev / ROM 拒绝转屏）退回俯视的 DEFAULT_CAM，见 defaultCamFor。
// ★ 桌面与卡位有**两套**（G1 第 3 步，docs/g1-scene-plan.md §3）：紧挨着的这组是竖屏那套
//   （竖屏窗口逐字照用，一个数都没动），`*_LAND` 那组是横屏那套。哪一套只由 `sceneLayout(land)`
//   一处决定 —— TableScene 的每块 mesh、市场分页、飞卡起点全问它，别在调用点各判一次 landscape。
export const TABLE = { w: 16, d: 7, thick: 0.35 };

/** ★ 工坊 3D 场景里挂不挂「玩家自己」那具人偶（`PlayerArms`：手臂/上身）。
 *
 *  G1 施工单第 1 步（docs/g1-scene-plan.md §1）：那具模型是占位用的粗糙人偶，先摘掉。
 *  留成开关而不是删文件，是为了**一步能单独回滚**：改回 true 时相机也要一起接回来 ——
 *  默认机位已经改成不读玩家头骨的固定机位（见 TableScene 的 FIXED_DEFAULT_CAM）。
 *
 *  ⚠ 它不只是"一个模型"：卡组视角的第三人称滑梯运镜、绕上半身转、"换形象"按钮、
 *    玩家头侧锚点都挂在这一位上，关掉之后它们一并休眠（各自有 SHOW_PLAYER_BODY 守卫）。 */
export const SHOW_PLAYER_BODY = false;

export const CARD = { w: 1.1, h: 1.65, lift: 0.02 };

/** 俯视机位：**竖屏窗口的兜底默认机位**。
 *  它是竖屏时代的默认相机（俯视整张桌子），G1 施工单第 1 步摘掉玩家人偶后曾短暂独占默认机位，
 *  第 2 步起让位给 `LAND_CAM` —— 但在竖屏窗口里它仍是唯一能一屏看全的机位（原因见 `defaultCamFor`）。 */
export const DEFAULT_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 9.8, 3.0],
  look: [0, 0, 0.25],
};

/** ★ 横屏的**落点机位**（G1 施工单 docs/g1-scene-plan.md §4 的终点机位，第 2 步先拿它当默认机位用）。
 *
 *  ★★ 2026-11-23（G4 收尾任务 B，主人点名"镜头压低、桌子占画面下 2/3、斜俯 30~40°"）：
 *    **相机整组重算过**，同时 4 个角色位与场景位往桌子里挪了一截（**为什么必须挪，见 TABLE_SLOTS_LAND**）。
 *
 *  数值（量法：fov 50 垂直、世界坐标投到屏幕百分比，y 从上往下 —— 与 docs/g1-scene-plan.md §5b 同一套）：
 *  · **俯角 30.0°**（`atan((3.9-0.2)/(7.4-1.0))`，改前 23.7°）—— 参照图要的 30~40° 里取**下沿**：
 *    俯角一加大，桌面近半段被压扁、卡位就往下掉，而底部栏的上沿是硬约束（下面是真机量到的 56.5%）；
 *  · **相机高 3.9 / 到桌心水平距 7.4（斜距 8.36）**（改前 3.4 / 7.4，斜距 8.96）；
 *  · **桌面近边回到画面里了**：z=+4.5 从 y=101.9%（改前，近边整条在画面外）降到 **96.3%**；
 *    远边从 35.4% 抬到 **27.4%**，桌面占画面 **68.8%** —— 参照图那条是 70%（13.5%→83.3%，量自
 *    550×384 的参照图），"桌子占画面下 2/3"就是照这个数的。
 *
 *  ★ **关键点全部重量过**（2026-11-23）。两个 aspect：桌面舞台 1372×785（aspect 1.748，1384×797 扣掉
 *    p-1.5）、真机 788×351（aspect 2.245）。**y 百分比与 aspect 无关**（垂直 fov 固定），所以下面写一份；
 *    x 随画幅变，差异大的地方分别注明。**下面这些数是"画布"百分比**；括号里给的"窗口"百分比是
 *    加上真机 p-1.5 那圈边之后的（`window = (6 + canvas×3.514)/3.634`），跟状态栏/底栏比时用窗口口径：
 *  · **铸卡师**（坐在桌对面，头骨 z=-4.3、头顶世界高约 1.75）：头顶 y=**11.8%（窗口 13.0%）**、
 *    下巴 20.0%、搭在桌沿的手 27.3%（改前 25.1 / 29.3 / 37.4）。→ 头顶在系统状态栏（真机 41 CSS px
 *    = 窗口 11.3%）**下面 1.7%（≈6 CSS px）**，也整颗落在对局顶部栏下面（HUD 药丸在窗口 29%~35.5%、
 *    顶栏按键 14.6%~24.5% 只在最右边、她居中）——**头顶不会被顶部栏切**；余量薄，这一点写进了风险；
 *  · **4 个角色位**（roleZ=0.45 / dx=1.45 / 卡缩 0.8，见 TABLE_SLOTS_LAND）：y=**44.0%~53.5%
 *    （窗口 44.2%~53.4%）**、x 桌面 27.7~72.3% / 真机 32.6~67.4%；→ 底沿离**底部栏上沿
 *    （真机量到窗口 56.5%）**还有 3.1%（≈11 CSS px）：**空位不被底部栏压住**（改前 69.8%，压进去 13%）；
 *  · **场景位**（-3.8, 0.15）：y=**43.1%~50.3%**、x 桌面 16.6~26.1% / 真机 24.0~31.4% —— 仍在角色排
 *    左上方（上沿比角色排高 0.9%、整条在它左边）；中线 z=0 投到 **45.8%**；
 *  · **卡组堆**（DECK_POS_LAND -1.8, z=3.0）：y=**65.2%~79.0%**、x 桌面 24.9~35.8% / 真机 30.4~39.0%；
 *  · **桌面**：远边 27.4%、近边 96.3%、中线 45.8%（改前 35.4 / 101.9 / 49.0）；
 *    两侧：真机 2.245 时左右远角 x=7.1% / 92.9%（桌子基本铺满宽画幅），桌面 1.748 时远角已出画
 *    （-5.1% / 105.1%）—— 两条都**没有露出地板**。
 *  ⚠ 其余横屏元素（节点链 / 市场 / 摊开排 / 法阵）的屏幕数重算在各自常量的注释里；它们的**世界坐标**
 *    与 G1 第 3 步一模一样，只是相机换了、而且 G4 删掉左右常驻条之后舞台变宽（1.204 → 1.748/2.245）。
 *  ⚠ 竖屏那台（DEFAULT_CAM）与竖屏卡位都不受影响：defaultCamFor 按画布 aspect 选，竖屏走另一支。 */
export const LAND_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 3.9, 7.4],
  // 视线落点：桌面上方 0.2、z=1.0 那一点（不是无限远，也不是桌心 —— 桌心会让视线压得太低）。
  // 俯角就是 pos→look 的俯角 = atan((3.9-0.2)/(7.4-1.0)) = 30.0°。
  look: [0, 0.2, 1.0],
};

/** ★ 验收机位覆盖（localStorage `gsSceneCam`，JSON：{pos:[x,y,z], look:[x,y,z]}）。
 *  给模拟器验收拍"正面 / 俯视 / 壁炉侧近景"三张用 —— App 的相机是固定机位，没有这个口子
 *  就只能拍同一个角度；而重出三次包（每次 1~2 分钟）只为换机位太慢。
 *  读法：`defaultCamFor` 每帧读一次缓存值（写 localStorage 之后**刷新一下**生效）。
 *  生产里不写这个键 = 完全不存在；形状不对（缺坐标/NaN）当没写，绝不把坏坐标送进相机。
 *  真机验收命令见 docs/gs-table-light-log.md §5。 */
const CAM_KEY = "gsSceneCam";
let camCache: { pos: [number, number, number]; look: [number, number, number] } | null = null;
let camCacheAt = -1e9;
function acceptCam(): { pos: [number, number, number]; look: [number, number, number] } | null {
  // 缓存 200 ms：CameraRig 每帧问一次，而 localStorage 是同步 IO
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (now - camCacheAt < 200) return camCache;
  camCacheAt = now;
  camCache = null;
  try {
    const raw = localStorage.getItem(CAM_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { pos?: unknown; look?: unknown };
    const ok = (a: unknown): a is [number, number, number] =>
      Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === "number" && Number.isFinite(n));
    if (!ok(j.pos) || !ok(j.look)) return null;
    camCache = { pos: j.pos, look: j.look };
  } catch {
    return null;
  }
  return camCache;
}

/** 验收机位覆盖开着没有（`gsSceneCam`）。取景右移（GS_FRAME_SHIFT）只给设计机位，
 *  验收用的那几台覆盖（俯视 / 壁炉近景）保持写死的那一版取景，别被移轴带着走。 */
export function gsAcceptCamOn(): boolean {
  return acceptCam() !== null;
}

/** 工坊的默认机位：**横屏用落点机位，竖屏退回俯视兜底**。
 *
 *  ★ 竖屏为什么不能直接用 `LAND_CAM`：竖屏（aspect 0.46）水平视野只有 ±12°，而卡组堆在水平 23.5° 处
 *    （x=-1.5 / z=2.75，相机在 z=6.2 那一带）—— 它会被甩出画面左侧。卡组堆是 `openDeckView` 的
 *    **唯一入口**（TableScene 里那颗 onClick），点不到就再也打不开卡组窗、摆不上卡。
 *    竖屏窗口什么时候会出现：浏览器 `npm run dev`（原生锁只装在手机上）、以及个别 ROM 拒绝
 *    `setRequestedOrientation` 的情况。这条退路保证那两种情况下桌面还是能用的。
 *  ★ 判据**只在这里**（TableScene 每帧、StudioPage 首帧都调它）：两处各写一遍 aspect 判断，
 *    迟早一处改成 1.0 一处改成 0.62，表现就是"转屏之后镜头对不上"。
 *  ★ 用画布宽高比而不是 `innerWidth > innerHeight`：宽高比就是相机自己那个 aspect，
 *    横屏布局两侧的常驻条把画布挤窄之后，这里跟着变窄的也还是它。 */
export function defaultCamFor(aspect: number): { pos: [number, number, number]; look: [number, number, number] } {
  // ★ GS 测地场景只有一台机位（米制那台），不看 aspect：这一档在 App 里锁横屏，
  //   浏览器窄窗口只是开发预览，按米制那台画至少桌面/人物比例是对的。
  //   验收时 localStorage 的 `gsSceneCam` 覆盖它（见 acceptCam）。
  if (gsMetric) return acceptCam() ?? GS_CAM;
  // 1.0 起算横屏：正方形（aspect=1）时卡组堆仍在框里（x 6.1~25.2%）、市场也在框里（23.7~76.3%）、
  // 节点链 8.9~91.1%，两种机位都站得住，这里取"正方形算横屏"——毕竟此时横屏那台给的构图更接近
  // 玩家真正看到的桌子。（法阵铭牌那个极端情况下右缘到 101.3%，那颗是纯装饰、画外半行字看不出来）
  return aspect >= 1 ? LAND_CAM : DEFAULT_CAM;
}

/** 聚焦某张桌面卡时的拉近机位：卡片落在画面下部 1/3（上方留给投影窗与光束） */
export function focusCam(x: number, z: number): { pos: [number, number, number]; look: [number, number, number] } {
  // 坐标算不出来时退到桌心而不是把 NaN 传下去：NaN 进了 camera.position 之后
  // 每次 lerp 都会继续污染，画面全黑却不报任何错，比直接崩还难查。
  // （消费端 TableScene 也挡了一道——这里是产出端，两头都不该放 NaN 过去）
  const fx = Number.isFinite(x) ? x : 0;
  const fz = Number.isFinite(z) ? z : 0;
  // ★ 米制档（高斯场景）：卡片只有 0.30×0.45，机位按"桌面高度 + 1 m 外俯看"给；
  //   老场景那台 y=5.15 / z+2.0 是 UI 尺度的数，在米制下会飞到房顶外。
  if (gsMetric) {
    // ★ 米制档第 2 版：相机在**玩家那一侧（+x）**，看的是桌面长边（见 GS_CAM 的注释），
    //   所以拉近机位也换到 +x：pos 比卡心高 1 m、从玩家这一侧俯看，长轴方向按 0.75 收（别贴边）
    return { pos: [fx + 1.0, 0.72, fz * 0.75], look: [fx - 0.15, 0.02, fz] };
  }
  return { pos: [fx * 0.75, 5.15, fz + 2.0], look: [fx, 0.45, fz - 2.3] };
}

/** 悬浮卡的抬升高度 */
export const FLOAT_Y = 0.85;

/** 对话视角：日系 CG 式第一人称对坐——下 1/3 桌面（散牌背），对面角色锁骨以下、胸部+双手 */
export const NPC_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 3.05, 2.45],
  look: [0, -1.45, -4.1],
};

/** 高斯米制档的对话机位：桌子顶面 y=0、NPC 站在 z=-1.5，相机在桌面上方 0.72 m、z=1.15
 *  （桌沿内侧一点）—— 与她的胸口同高偏上，一屏里是她的头肩 + 桌面下半。
 *  ★ 老场景那台（NPC_CAM）的世界坐标是 UI 尺度，米制下会落到桌子底下；两处都读 npcCam()。 */
export const GS_NPC_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 0.72, 1.05],
  look: [0, 0.35, -1.85],
};
/** 对话机位：米制档 / 老场景各一台（studioStore 进对话、TripoNpc 的注视基准都读它） */
export function npcCam(): { pos: [number, number, number]; look: [number, number, number] } {
  return gsMetric ? GS_NPC_CAM : NPC_CAM;
}

/** 卡组浏览视角：悬浮在玩家前方、与桌沿同高的摄像机（rail 顶 0.25），仰拍玩家 */
export const DECK_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 0.27, 2.9],
  look: [0, 0.46, 5.0],
};

/**
 * 商店机位（G4 施工单 docs/g4-ui-revamp-spec.md §2「点商店 → 相机移动并靠近 NPC」）。
 *
 * ★ 为什么是**相对 NPC 头**的偏移、不是世界坐标：头骨的世界坐标由 TripoNpc 每帧写进
 *   `cameraOrbit.NPC_HEAD`（换身形 / 换 rig 都会动）。对话那台（NPC_CAM）隔着一整张桌子、
 *   差 20cm 也看不出来；这台只有 3 米出头，写死的坐标在换模型后会对着她的胸口或头顶。
 * ★ 数值是按"商店栏占着屏幕上沿"配的（横屏 800×363 = 真机尺寸）：`back` 3.15 / `up` 0.17 →
 *   与头同高、正面平视；`lift` 0.32 把视线抬到头上一截 —— 轨道圆心就是视线落点，抬这一截之后
 *   她的脸落在屏幕 y≈39%~63% 那一条：商店栏（状态栏 41px + 8px 起，约 13%~35%）压不到，
 *   底部背包条（约 66% 往下）也够不着下巴。量法：把开发用的舞台临时缩成 800×363 再看
 *   （竖直 FOV 固定 50°，屏幕高度只影响换算比例，不影响她落在第几成）。
 * ★ 复用的是 NPC 对话那一套球面轨道（orbit.target = "npc" + 同一套拖拽/缩放），
 *   这里只贡献机位与 yaw 限制，**没有第二套轨道控制**。
 */
export const SHOP_CAM = {
  /** 相机在头的 +z 方向（玩家这一侧 = NPC 正面）多远 */
  back: 3.15,
  /** 相机比头高多少 */
  up: 0.17,
  /** 视线比头高多少（= 轨道圆心抬多高，见上面那段 ★） */
  lift: 0.32,
};

/** 商店绕行只能 NPC 正面 180°（施工单 §2 第 3 条）：θ 以正面为 0，左右各 90°。
 *  ★ 与 NPC 对话**共用同一条轨道**，但**不共用这条限制**：对话沿用今天的行为（不限），
 *    商店才挂 ±90°。所以它是"给调用点的一个数"（studioStore.enterShopCam 塞进 orbit.yawLimit），
 *    **不是**写进 ORBIT_LIMITS.npc 的硬限 —— 那会把对话一起锁住。见 cameraOrbit.clampOrbitYaw。 */
export const SHOP_ORBIT_YAW = Math.PI / 2;

/** 节点链（用户侧、靠近中线的一排；竖屏可视 x≈±1.55 → 3 张窗口化） */
export const CHAIN = {
  startX: -1.6,
  dx: 0.8,
  rowZ: 0.95,
  maxVisible: 5,
  /** 链上节点卡缩放：原尺寸桌面只摆得下 3 张，缩小后同段桌面平摊 5 张 */
  scale: 0.66,
};

/** 卡组位置（用户左手边） */
export const DECK_POS: [number, number, number] = [-1.5, 0, 2.75];

/**
 * G4 桌面 5 个卡位：4 个角色位一排 + 1 个场景位（角色排左上方、桌面中线玩家这一侧）。
 *
 * ★ 这两个数组**只决定"位子摆哪儿"**；位子上是谁由 rules.tableSlotsOf 从对局数据里读
 *   （TableScene 的 GameTableSlots 只画）。拖卡入位是施工单第 3 步，到那一步才需要"位子"自己的状态。
 * ★ 竖屏这一套是量出来的（375×812 的窗口）：角色排 z=1.2、dx=0.85、卡缩到 0.55，四张卡
 *   横跨屏宽 12.6~87.4%，正好避开左下的卡组堆（y 70.9~83.6%）与桌面中线那排市场卡；
 *   场景位 (-1.55, 0.5) 在角色排左上方，投影到 8.3~20.4% / y 48.8~56.4% —— 仍在中线以内
 *   （z>0 = 玩家这一侧）。**竖屏的 3D 桌面逐字不动的是别的东西：卡组堆 / 市场 / 摊开排 / 机位。**
 */
/** 对局 5 个卡位的摆法。与 MarketLayout 同一套轴语义：
 *  axis="x" = 4 个角色位**横排**（位子落在 z=roleAlong 那条线上，间距 roleDx，老场景）；
 *  axis="z" = 4 个角色位**顺长轴竖排**（位子落在 x=roleAlong 那条线上，米制档的立牌一排）。 */
export interface SlotLayout {
  axis: "x" | "z";
  /** 一排 4 个角色位的固定坐标（axis=x 时是 z，axis=z 时是 x） */
  roleAlong: number;
  /** 同排间距 */
  roleDx: number;
  roleScale: number;
  sceneX: number;
  sceneZ: number;
  sceneScale: number;
  /** 角色排沿"排列方向"的整体偏移（可选；米制档用 `GS_TABLE_SHIFT.z` 把整排跟桌子一起挪）。
   *  ★ 只挪这条线、不动 roleAlong：`npcOffsetM` 量的是桌心线，偏移必须落在这一位上。 */
  roleShift?: number;
}

export const TABLE_SLOTS: SlotLayout = {
  axis: "x",
  roleAlong: 1.2,
  roleDx: 0.85,
  roleScale: 0.55,
  sceneX: -1.55,
  sceneZ: 0.5,
  sceneScale: 0.45,
};

/** 卡组展开排（用户手前一排，卡组右侧） */
export const SPREAD: SpreadLayout = { axis: "x", at: 2.75, gap: 1.05, maxVisible: 3, center: 0.2 };

/** 市场平摊（NPC 侧，两排各 4 张，扑克式轻微重叠） */
/**
 * 市场平摊：**先量后定**。旧值 perRow:4 / dx:0.95 / 原尺寸卡在竖屏 375×812 下
 * 一排四张根本放不下——把四角投到屏幕坐标算出来：前排一张卡就占 52.4% 屏宽，
 * 四张连间距要 2.2 个屏宽，结果 8 张里有 4 张被切，最外侧那两张各只剩三成在屏内
 * （左起第一张的屏幕 x 范围是 -0.441~0.189）。
 *
 * 改成一排三张 + 卡缩到 0.55：卡宽 1.1×0.55=0.605 世界单位，前排换算 28.8% 屏宽
 * （≈108px，还点得动也看得清封面）；三张连间距横跨 2×0.66+0.605=1.93 世界单位
 * ≈92% 屏宽，两侧各留 4% 边。后排因为更远，一张约 84px。
 *
 * 每页 6 张（2 排 × 3 列），多出来的靠左右箭头翻页——市场种子就有 18 张，
 * 旧代码在 searchMarket 里 slice(0,8) 把另外 10 张直接扔了。
 */
/** 一排卡的摆法：老场景沿 x 排开（`axis: "x"`，`rows` 是各排的 z），
 *  米制档沿长轴 z 排开（`axis: "z"`，`rows` 是各排的 x）。两种都只描述"排在哪、多宽"，
 *  摆位算式仍然只有一处（marketSlot / DeckSpread），别在调用点各算一遍。 */
export interface MarketLayout {
  axis: "x" | "z";
  /** 各排的固定坐标（axis=x 时是 z，axis=z 时是 x） */
  rows: readonly number[];
  perRow: number;
  /** 同排相邻两张的间距 */
  gap: number;
  lift: number;
  scale: number;
  perPage: number;
  /** 整排沿"排开方向"的偏移（可选；米制档用 `GS_TABLE_SHIFT.z` 把市场那排跟桌子一起挪）。 */
  center?: number;
}

/** 摊开的卡组（平放）：与 MarketLayout 同一套轴语义，只是一次只摆几张 */
export interface SpreadLayout {
  axis: "x" | "z";
  /** 固定坐标（axis=x 时是 z，axis=z 时是 x） */
  at: number;
  gap: number;
  maxVisible: number;
  center: number;
}

export const MARKET: MarketLayout = {
  axis: "x",
  rows: [-1.05, -2.2],
  perRow: 3,
  gap: 0.66,
  lift: 0.02,
  scale: 0.55,
  perPage: 6,
};

/** 溢出节点的左侧收起堆（贴左缘露半张=「收起」） */
export const LEFT_STACK: [number, number, number] = [-1.85, 0, 0.95];

/** 溢出节点的右侧收起堆：聚焦早期节点时窗口左移，其后的节点收到右缘 */
export const RIGHT_STACK: [number, number, number] = [1.85, 0, 0.95];

/** 合成按钮：中线右端（竖屏可视范围内） */
export const COMPOSE_POS: [number, number, number] = [1.5, 0.03, 0];

// ─────────────────────────────────────────────────────────────
// 横屏那套（G1 施工单 docs/g1-scene-plan.md §3）。**只影响横屏**：竖屏窗口继续读上面那组，
// 一个数都不改。下面每个 `*_LAND` 都注明了"为什么是这个数"，量法见 LAND_CAM 的注释。
// ★ 2026-11-23（G4 收尾任务 B）：这批常量的**世界坐标一个没动**，动的只有相机（LAND_CAM）；
//   下面的屏幕百分比是在新机位上重量过的，舞台也换成了整窗（G4 删掉左右常驻条：aspect 1.204 →
//   1.748 / 真机 2.245）。x 百分比与舞台宽窄有关，y 百分比只跟垂直 fov 有关（改机位后全表都变了）。
// ─────────────────────────────────────────────────────────────

/** 横屏桌面：22×9（竖屏 16×7）。为什么是这两个数（**2026-11-23 重算**：G4 删掉左右常驻条之后舞台
 *  就是整窗，桌面舞台 1372×785（aspect 1.748）/ 真机 788×351（aspect 2.245））：
 *  · 近边 z=+4.5 投到 **y=96.3%** —— 整条近边**留在画面里**（改机位之前是 101.9%，近边整条在画面外）；
 *  · 远边 z=-4.5 在 **y=27.4%**，桌面占画面 **68.8%** —— "桌子占画面下 2/3"照的就是这个数（参照图 70%）；
 *  · 两侧：桌面 1.748 时左右远角已经出画（x=-5.1% / 105.1%），真机 2.245 时落在 7.1% / 92.9% ——
 *    两条都不露出地板（"两侧不留黑边"）。
 *  ⚠ 深度 9 让铸卡师站的位置（z=-4.3）正好贴着远边内侧：桌面远边（27.4%）就是"她被桌子挡住的地方"，
 *    量出来的手（27.3%）正好搭在这条边上。 */
export const TABLE_LAND = { w: 22, d: 9, thick: 0.35 };

/** 横屏节点链：一屏 7 张（竖屏 5 张）。dx 0.78 > 卡宽 1.1×0.66=0.726，7 张之间有 0.054 的缝（不叠压，
 *  与竖屏 5 张 / 0.8 间距同一种"链"的读法）。startX=-2.34 让 7 张以 x=0 为中心摊开：卡位中心 ±2.34、
 *  外缘 ±2.70。**2026-11-23 重量**（新机位）：整链 y 47.8~56.5%、x 桌面 26.0~74.0% / 真机 31.3~68.7%；
 *  两端各剩约 2% 给收起堆（±2.59 → 桌面 24.3~32.9 / 67.1~75.7，真机 30.0~36.6 / 63.3~70.0）。
 *  为什么不再摆宽一点：再宽 0.2 左右，右端就会把合成法阵（COMPOSE_POS_LAND）挤出画面。 */
export const CHAIN_LAND = { startX: -2.34, dx: 0.78, rowZ: 0.95, maxVisible: 7, scale: 0.66 };

/** 横屏卡组堆（用户左手边）：x -1.5→-1.8、z 2.75→3.0。
 *  横屏的卡组行在屏幕上更靠外（同样的 x 在 z 更近时占屏更宽），-1.5/z2.75 会压到摊开排的排头；
 *  -1.8/z3.0 **2026-11-23 重量**：y 65.2~79.0%、x 桌面 24.9~35.8% / 真机 30.4~39.0% ——
 *  仍读作"左手边那叠"，离系统手势区（屏幕底 8%）还有 13%，点得到。
 *  ⚠ 它会落在对局底部栏（真机窗口 56.5% 往下）那一条里：**这是有意的** —— 对局里的背包是 2D 那条，
 *    卡组堆属于工坊（没有底栏），对局中要开卡组窗走顶栏那条路。 */
export const DECK_POS_LAND: [number, number, number] = [-1.8, 0, 3.0];

/** 横屏摊开排：dx 1.05→1.2（卡片原尺寸 1.1 宽，留 0.1 的缝）、centerX 0.2→0.3。
 *  卡组挪到 -1.8 之后排头（-0.9，卡宽 ±0.55）正好从卡组右缘（-1.437）外一点开始摊；
 *  **2026-11-23 重量**：y 62.3~83.4%、x 桌面 32.3~75.0% / 真机 36.3~69.4% —— 全屏最近的一排。 */
export const SPREAD_LAND: SpreadLayout = { axis: "x", at: 3.0, gap: 1.2, maxVisible: 3, center: 0.3 };

/**
 * 横屏的 G4 卡位（2026-11-23 新机位下的**重量结果**，量法见 LAND_CAM 的注释）：
 *  · 角色排 **roleZ=0.45**（改前 1.7）/ dx=1.45（不动）/ 卡缩 0.8（不动）：y=44.0~53.5%、
 *    x 桌面 27.7~72.3% / 真机 32.6~67.4% —— 底沿离底部栏上沿（真机窗口 56.5%）还有 3.1%；
 *  · 场景位 **(-3.8, 0.15)**（改前 -3.6, 0.55）：y=43.1~50.3%、x 桌面 16.6~26.1% / 真机 24.0~31.4% ——
 *    上沿比角色排高 0.9%、整条在它左边，读作"角色排左上方"；中线 z=0 在 y=45.8%。
 * ★★ **为什么角色排必须从 z=1.7 挪到 0.45**（这一步不是审美，是量出来的硬约束）：
 *    真机横屏只有 363 CSS px 高，而底部那一列（状态栏 + 背包条 106px + 阶段条 22px + 间隙）从
 *    **窗口 56.5%** 就开始了（2026-11-23 用截图逐像素量，见 docs/g1-scene-plan.md §5b）——
 *    z=1.7 时四个角色位在 52.0~64.4%（窗口 52.2~64.1%），有一半压在背包条底下。
 *    而"往哪挪"只有一个方向：**相机这一族里没有解**。同一个俯角下压低相机会把铸卡师的头顶推进
 *    系统状态栏（h=3.0 时头顶到窗口 7.5%），抬高相机又把卡位继续往下推（h=4.6 时底沿 65.6%）；
 *    桌面中线到近边之间那 4.5 个世界单位在屏幕上必然占掉三十多个百分点。所以只能让卡位**自己**往
 *    桌子里挪 —— 挪到 0.45 之后，它们在桌深上的位置是（0.45+4.5)/9 = 55%（从远边数），
 *    与参照图里"自己那一排"占板面 53% 几乎一样，构图反而更像参照图。
 * ★ 为什么卡缩还是 0.8：腰高 1.65×0.8=1.32 世界单位的卡在真机上占屏 8%（≈64×96 CSS px），
 *   再小就看不清卡面、也不好拖（落点判定用的是同一份投影，见 scene/slotScreen）。
 * ★ 为什么角色排不摆得更宽：窄画布（aspect 1.2~1.3 的浏览器窗口）里四张已经撑到 80% 以上，
 *   再宽会撞画布边；真机上四张占 32.6~67.4%，两侧留给卡组堆与法阵。
 */
export const TABLE_SLOTS_LAND: SlotLayout = {
  axis: "x",
  roleAlong: 0.45,
  roleDx: 1.45,
  roleScale: 0.8,
  sceneX: -3.8,
  sceneZ: 0.15,
  sceneScale: 0.65,
};

/** 横屏市场：一页 2 排 × 4 张 = 8 张（竖屏 2×3=6），行位置不变（rowsZ 与竖屏同一组）。
 *  dx 0.66→1.25：卡宽 0.605，横屏这一排的可视宽约是竖屏的 4 倍。**2026-11-23 重量**（新机位）：
 *  前排 y 37.8~42.2%（x 桌面 34.9~65.1% / 真机 38.3~61.7%），后排 y 33.2~36.7%（36.5~63.5 / 39.5~60.5）——
 *  两排都落在桌面远边（27.4%）与中线（45.8%）之间，即"NPC 那一侧摊开的牌"。
 *  ⚠ 对局里这一块不摆（市场是工坊的事，对局买卡走 2D 商店）；工坊里没有对局 HUD，所以那两排不会被盖。
 *  为什么不是更宽：dx 1.25 已经是"四张之间留 0.645（> 一张卡宽）"的稀疏摆法，再宽就不像"摊开的一排"了。 */
export const MARKET_LAND: MarketLayout = { axis: "x", rows: [-1.05, -2.2], perRow: 4, gap: 1.25, lift: 0.02, scale: 0.55, perPage: 8 };

/** 横屏的左右收起堆：跟着节点链走 —— 链尾卡位 2.34 + 0.25 = 2.59，与竖屏 1.6→1.85 同一个
 *  "从最后一张后面露半张"的关系（收起堆的卡面因此始终压在链尾卡右下/左下角，一眼看出还有一段）。
 *  **2026-11-23 重量**：左堆 x 桌面 24.3~32.9% / 真机 30.0~36.6%，右堆 67.1~75.7 / 63.3~70.0。 */
export const LEFT_STACK_LAND: [number, number, number] = [-2.59, 0, 0.95];
export const RIGHT_STACK_LAND: [number, number, number] = [2.59, 0, 0.95];

/** 横屏合成法阵：中线右端从 1.5 挪到 3.0 —— 链尾卡在 2.34，法阵仍读作"右端那颗"。
 *  **2026-11-23 重量**（新机位）：台座（半径 0.52）y 42.6~48.9%、铭牌（1.42×0.44）y 49.7~52.8%；
 *  x 台座 桌面 67.3~77.3% / 真机 63.5~71.3%，铭牌 66.8~79.4 / 63.1~72.9 —— 离画面右缘还有 20% 余量
 *  （改机位之前是 94.2%，贴着边）。 */
export const COMPOSE_POS_LAND: [number, number, number] = [3.0, 0.03, 0];

// ─────────────────────────────────────────────────────────────
// ★★ GS 测地场景（2026-11-26，`feat/gs-table-fire`）：**1 世界单位 = 1 米**
//
// 为什么单开一套而不是把上面那两套改小：上面那两套的 22×9 桌面是"UI 画布"尺度（卡 1.1 宽、
// 人 1.7 高、桌子 22 —— 三者本来就不在一个物理尺度上），全仓几十处投影/落点都按它量过。
// 高斯这一档要做的是**把 splat 房间当真房间用**：量出来桌长 2.50 m、桌高 0.765 m、房深
// 7.96 m，NPC 1.7 m —— 这四个数只有 1:1 摆在一起才不打架。所以高斯开着时（`gsSceneMetric()`）
// 整个桌面布局换成下面这套米制常量，关着时逐字节还是上面那两套（默认体验一个字不变）。
//
// 数值怎么来的（splat 点云量测，见 docs/gs-step2-splat-log.md §2 与 docs/gs-table-light-log.md）：
//  · 桌面 2.50（沿房间纵深 d = 世界 z）× 1.17（沿 s = 世界 x），桌面顶面高 0.765；
//  · 世界原点 = 桌面顶面中心（splat 落位 TARGET），所以桌角 x=±0.585 / z=±1.25、地板 y=-0.775；
//  · 圆窗 0.90 m 直径在 z=-3.63、窗心只比桌面高 0.68；壁炉在左墙 x≈-1.91、z=-1.6。
// ⚠ 改机位/桌面尺寸时**四个数一起核**：桌长/桌高/房深/NPC 身高三者比例（docs 里那三条验收）。
// ─────────────────────────────────────────────────────────────
let gsMetric = false;
/** 高斯测地场景开没开（TableScene 随 gsPhase 写；layout 自己的函数在渲染期读它）。
 *  ★ 只在这里存一位：让它进 React 状态会让每帧的 sceneLayout 调用变成订阅，
 *    而这一位每帧都一样，没必要。写入口只有 setGsSceneMetric 一处。 */
export function setGsSceneMetric(on: boolean): void {
  gsMetric = on;
}
export function gsSceneMetric(): boolean {
  return gsMetric;
}

/** 米制桌面：w = 世界 x 方向宽（房间的 s 轴）、d = 世界 z 方向长（房间的 d 轴）。
 *  ★ 长轴是 z（不像老桌面那样沿 x）：splat 里那张长桌本来就顺着房间纵深摆，量出来 2.50 沿 d。
 *    为了让它和 splat 里烘死的那张桌子重合（不出现"两张桌子"），网格桌面必须同向同寸。
 *  ★★ 2026-11-26 第 2 版（`feat/gs-layout-fix`）：**长边从 2.50 收到 2.15**（长宽比 2.14 → 1.84）。
 *    主人的参考图（《金铲铲之战》对局）里桌面是"分界线顺着长边走、两排卡分居两侧"，
 *    2.50 的长条在 2.448 的横屏画幅里两侧只剩一条缝，两排卡摆不开；
 *    2.15 × 1.17 之后两排各 0.34 m 间距的 4 张牌仍落在桌内，且两端还留 0.42 m。
 *    ⚠ splat 里烘死的桌面仍是 2.50：两端各露出 0.175 m —— 由 WorkshopTable 的**木端板**
 *      盖住（`splatLen` 就是那一版量出来的 2.50，别删）。
 *  thick 只是桌板厚度（0.14），桌面顶面仍约定在 y=0（表体往下包，腿落到地板 y=-0.785）。 */
export const GS_TABLE = { w: 1.17, d: 2.15, thick: 0.14, height: 0.765, splatLen: 2.5 };

/**
 * ★★ 2026-11-27 第 10 版（`feat/gs-auto-gate-align`，主人第 2 件）：**整张桌面沿世界 −z 平移 0.20 m**。
 *
 * 来由：上一版（§17）为了让炉火从铸卡师身侧露出来，把她一个人往 −z 挪了 0.20 m（屏幕右 = 世界 −z）——
 *   火出来了，但她偏离桌子中线 `npcOffsetM = 0.212`（主人这一轮把上限收回 0.05）。这一版把
 *   **桌子连同卡位 / 铭牌 / 法阵 / 光毯**往同一个方向挪同样的 0.20 m：她相对桌子的关系回到
 *   上一版之前（实测 0.012 m），画面里的整体右移效果不变。
 *   ★ 不许只挪人不挪桌：那样两套中心线永远差着 0.2 m，卡位/铭牌也会和她的身体错开。
 *   ★ 唯一不跟着动的是 **splat 里烘死的那张桌子与壁炉**（点云，不能平移）。所以：
 *     · 毡面 + 光毯 + 卡位 + 铭牌 + 法阵 + 卡组/市场/摊开排 = 跟着走（世界 −z 0.20 m）；
 *     · 桌子的**木框（端板 / 木沿 / 护栏）**锚在点云那张 2.50 m 桌子的两端（它不能动）——
 *       端板与木沿按 `splatLen` 现算，+z 那一头因此多出一块 0.375 m 的木板盖住露出来的旧桌面
 *       （WorkshopTable 的端板注释；实测画面上看不出来，§18.5 有图）。桌腿跟着桌体走（在毡面底下）。
 *   换句话说：**"桌子"在玩法上就是那张 2.15×1.17 的毡面，它整体走了 0.20 m**；围边只是点云桌的皮。
 * ★ 为什么所有桌面常量都要跟着减 0.20（而不是给某个组件单独加偏移）：桌面上东西有 6 个来源
 *   （GS_SLOTS 的 5 个卡位、GS_PAD、GS_DECK_POS、GS_SPREAD、GS_MARKET、WorkshopTable 的光毯/法阵）。
 *   只挪一半的话，卡位还停在旧桌面上 —— 而 `npcOffsetM` 是按桌心量的，两套中心线当场回来。
 * ★ 光毯贴图**不用重烘**：它是 1024×512、u=桌面长轴、v=桌面短轴的**桌面局部 UV**
 *   （WorkshopTable.Lightmap），整张桌子一起平移时 UV 与光斑的相对关系不变。
 * ★ GS_CAM 一个数不动：右移量由 `GS_FRAME_SHIFT` 那一层继续给 —— 这一版按实测复算是否需要它
 *   （结论与数写在 §18.2；改之前先读那一节，别只调一个数）。
 */
export const GS_TABLE_SHIFT = { z: -0.2 } as const;

/** 米制卡牌：**0.20 × 0.30 m**（第 3 版，`feat/gs-polish2`；前两版是 0.30×0.45 / 0.28×0.42）。
 *
 *  ★★ 2026-11-26 主人第 4 条："卡片太大" —— 0.28×0.42 在 2.15×1.17 的桌面上是"每张占桌面 13%×36%"，
 *    一眼看过去桌上只剩三张牌。缩到 0.20×0.30 之后：
 *    · 一排 4 张总宽 = 4×0.20 + 3×0.04（间距）= **0.92 m**（主人给的数），占桌面长轴的 43%；
 *    · 牌在桌上转 90°（`GS_ROWS.flatRotZ`）⇒ 每张在桌宽方向占 0.30，两排（x=±0.26）之间那条
 *      中线留 **0.22 m** 净空（中线的花纹整条露得出来，牌也压不到中线）；
 *    · 两端离毡边各 0.615 m，进得去也出不了桌。
 *  ⚠ 卡是"看得清"与"不占满桌"之间取的折中：0.20 m 宽在真机 852 px 的画幅上约 44 px（一张牌），
 *    卡面纹理（512²）仍按原尺寸画，只是被缩得更小 —— 要再小就得连卡面排版一起改。 */
export const GS_CARD = { w: 0.2, h: 0.3, lift: 0.02 };

/** 米制机位：桌面顶面中心为原点，相机在**玩家这一侧**（+x，书柜墙那一头）俯看桌面。
 *  ★★ 这一版换了**看的方向**（上一版在 +z 看桌子的短边）：参考图里中线顺着长边走、两排卡
 *    一上一下分居两侧、人物站在壁炉那一侧 —— 三件事同时成立的唯一机位就是**从桌子长边看过去**
 *    （玩家在 +x，铸卡师在 −x 的壁炉墙前）。桌面长轴（z）因此横在画面里，窗在画面右侧。
 *  取景（按真机 852×348 的画幅量）：桌面占画面下半、壁炉与炉火在正后方、
 *  NPC 站在炉前偏左（z=−0.28，让炉膛的火从她右手边露出来）。
 *  相机高 1.06（略高于坐姿眼位）、离桌心 1.60 m、fov 50（App 的 Canvas 就是这个数）：
 *  再高桌面被压扁、再低桌子近边会顶到画面下缘、再远会看到桌对面的地板接缝。 */
export const GS_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [1.6, 1.06, 0.06],
  look: [-0.15, 0.02, 0.02],
};

/**
 * ★★ 2026-11-26 第 4 版（`feat/gs-framing-orbit-panel`，主人第 1 条「NPC 和桌子整体往右一点」）：
 *  正面机位的**取景右移量**（占画布宽度的比例）。
 *
 *  目标：NPC 身体中心从 **49.5%~51%** 落到 **58%~62%**（量法见 docs/gs-table-light-log.md §12）。
 *
 *  ★ 为什么不是「把 GS_CAM.look 点往右挪」（最先试的那一种，量完否掉）：
 *    纯转头是**角度**平移，画面两边按 tan 放大 —— 靠右的桌右沿走得比人物多。实测
 *    look 点 z +0.30（NPC 到 57.7%）时桌右沿已经到 **101.2%**（出画）；把 NPC 推到 60%
 *    需要 look z ≈ +0.34，右沿到 104%。主人两条要求（NPC 58~62% + 桌右沿不出画）
 *    在纯转头下**无解**，不是没调好。
 *  ★ 为什么当时没选「整体 group 平移 x」：那会让网格桌面与 splat 里烘死的那张桌子错开
 *    （两端就靠 `GS_TABLE.splatLen` 的木端板盖着），平移 NPC 又会让炉膛的火偏出她身侧。
 *    ★★ 2026-11-27（第 10 版）主人改了口径：就要"桌子跟人一起挪"，错开问题改由木端板重算
 *    （见 GS_TABLE_SHIFT 与 WorkshopTable 的端板注释）—— 这条历史结论**只对第 4 版成立**。
 *  ★ 最后用的是**投影窗口右移（等效移轴镜头 / 横向裁切）**：
 *    `camera.setViewOffset(W + 2·δ, H, 0, 0, W, H)` 只挪投影窗口，**不改相机位姿、朝向、焦距**，
 *    所以桌子在画面里的尺寸与人物高度逐像素不变，画面里所有东西一起右移 δ 像素。
 *    第 4 版量出来的数（画布 852×348、fov 50、GS_CAM、δ = round(852×0.09) = 77 px）：
 *    NPC 身体中心 **50.61% → 59.65%**、桌右沿（z=−1.25 的木端板）**89.14% → 98.18%**、
 *    桌左沿 11.8% → 20.8% —— 右沿不出画，两条要求同时成立。δ 再大（0.095）右沿 99.4%，
 *    余量只剩 0.6%，取 0.09 留 1.8%。
 *
 *  ★★ 2026-11-27 第 10 版（`feat/gs-auto-gate-align`）：**0.09 → 0.04**（这一位仍然需要）。
 *    这一版桌子（毡面 + 卡位 + 铭牌 + 法阵 + 光毯）已经跟着铸卡师沿世界 −z 挪了 0.20 m
 *    （`GS_TABLE_SHIFT`），"右移"已经有一半是**世界位移**给的；而桌子近角那一段的投影斜率很陡
 *    （0.2 m ≈ 6.5 个百分点），再叠 0.09 的移轴，桌右沿会被推出画。同几何（真机画布 788×351、
 *    fov 50、GS_CAM）复算三个候选值：
 *      · δ = **0.09**（第 9 版）：桌右沿 **108.19%**（出画）、桌左沿 ~34%、NPC **63.42%**；
 *      · δ = **0.04（这一版）**：桌右沿 **99.29%**（不出画，余 0.71%）、桌左沿 **29.15%**、
 *        NPC **58.47%** —— 正好回到 §12 定的 58~62% 那一档；
 *      · δ = 0（不要移轴）：桌右沿 95.29%、NPC 54.47% —— 整体右移效果弱了一半，§12 的目标丢掉。
 *    所以"世界位移 + 少量移轴"才是这一版的正解：`__gsAccept.tableRightPct / tableLeftPct /
 *    npcScreenPct` 三个数把这三条量在一起（§18.4 记了真机读数）。
 *  ★ 只在**设计机位**（GS_CAM）上生效：验收用的 `gsSceneCam` 覆盖、对话/聚焦/商店机位都不移，
 *    否则那几台被验收/演出依赖的取景会跟着漂（见 TableScene.CameraRig 的应用条件）。
 */
export const GS_FRAME_SHIFT = 0.04;

/** ★★ 两排卡位（`feat/gs-layout-fix` 起：中线沿长轴 z 把人分成**玩家侧 (+x) / NPC 侧 (−x)**）；
 *  第 3 版（`feat/gs-polish2`，主人"卡片太大"）把卡从 0.28×0.42 缩到 **0.20×0.30**，这一排的
 *  间距随之从 0.34 收到 **0.24**（卡宽 0.20 + 缝 0.04）：4 张占 **0.92 m**，两端离毡边各 0.615 m。
 *  ★ 两排的 x 从 ±0.28 收到 **±0.26**：卡高（转 90° 之后落在桌宽方向的那个 0.30）减了 0.12，
 *    两排之间那条缝原来只有 0.14、现在 **0.22** —— 中线（`WorkshopTable.CenterLine`，宽 6 mm）
 *    整条露得出来，牌也压不到它（"不压中线"就是这么量的）。
 *  ★ 为什么**平放**而不是立牌（试过立牌）：0.42 m 高的牌立在桌面上时，相机 1.16~1.45 m 高
 *    "中线→近排"整条桌面都落在牌背后（要眼位 1.9 m 以上中线才露得出来，而那个机位在 splat 里
 *    看进去是黑的）。参考图那两排骨牌的读感改用"两排分居中线两侧 + 中线沿长边"来表达：
 *    牌面朝上、每排的"上边"背对主人（躺着读的那一面朝主人 —— 与看书同一套）。 */
export const GS_ROWS = {
  npcX: -0.26,
  playerX: 0.26,
  zs: [-0.36, -0.12, 0.12, 0.36],
  /** 平放牌在桌面上的朝向：绕牌面法线转 +90° ⇒ 牌的"上边"指向世界 −x（玩家那一侧读着正）。
   *  deck / 市场的平放卡也走这一位，别在调用点各写一个 90°。 */
  flatRotZ: Math.PI / 2,
};

/** 米制的 5 个卡位：4 个角色位**一排**在玩家侧（axis="z"：位子落在 x=roleAlong 那条线上），
 *  场景位在 NPC 侧靠窗那一头、牌面朝着铸卡师（rotZ −90°，与玩家排相反）。
 *  ★ 第 3 版跟着新卡尺寸重排：roleAlong/sceneX 0.28→**0.26**、roleDx 0.34→**0.24**
 *    （= 一排 4 张的中心距，与 `GS_ROWS.zs` 逐位相同：−0.36/−0.12/+0.12/+0.36）。
 *    场景位在 z=+0.72 —— 比角色排长 0.36（那一头留给"卡组堆"在对面、不撞）。 */
export const GS_SLOTS: SlotLayout = {
  axis: "z",
  roleAlong: 0.26,
  roleDx: 0.24,
  roleScale: 1,
  sceneX: -0.26,
  // 场景位与角色排一起跟着桌子平移（§18.2 的 GS_TABLE_SHIFT）
  sceneZ: 0.72 + GS_TABLE_SHIFT.z,
  sceneScale: 0.8,
  // ★ 4 个角色位沿长轴 z 排开 ⇒ 整排沿 z 平移；roleAlong（x）不动
  roleShift: GS_TABLE_SHIFT.z,
};

/** 米制卡组/市场/法阵：全部落在 2.15 × 1.17 的桌面上（中线沿长轴 z 在 x=0）——
 *  NPC 侧（x<0）是市场那一排（平放、牌面朝玩家 = 买东西的那一位），
 *  玩家侧（x>0）是 4 个角色位 + 卡组堆 + 合成按钮。四样互不重叠（top 视图量过）。
 *  ★ 卡组堆的卡面缩放沿用 `chain.scale`（老场景就是同一个数）—— 这里定 0.62，
 *    卡面 0.20×0.62=0.124 宽，一叠 24 张也只在桌角占 0.13 m。 */
export const GS_CHAIN = { startX: -0.62, dx: 0.32, rowZ: 0.55, maxVisible: 7, scale: 0.62 };
/** 卡组堆（平放）：玩家侧靠窗那一头（卡缩 0.62 ⇒ 约 0.124×0.186），落在毡面内
 *  （x 0.33~0.45 / z 0.67~0.85；桌沿 x=0.585 / z=1.075 都还有余量）。
 *  ★ 2026-11-27：跟着 `GS_TABLE_SHIFT.z` 一起挪 0.20 m（桌上所有东西都用同一份偏移）。 */
export const GS_DECK_POS: [number, number, number] = [0.39, 0, 0.76 + GS_TABLE_SHIFT.z];
/** 摊开的卡（平放）：桌子正中（中线上下各一张），一次 3 张；这是"翻卡组"的临时状态，
 *  横跨中线没关系（它不是任何一边的排面）。gap 0.36→**0.30**（跟着新卡宽收）。
 *  ★ 2026-11-27：`center` 带 `GS_TABLE_SHIFT.z`，"桌子正中"跟着桌子走（at 是 x，不动）。 */
export const GS_SPREAD: SpreadLayout = { axis: "z", at: 0, gap: 0.3, maxVisible: 3, center: GS_TABLE_SHIFT.z };
/** 米制市场：NPC 侧（x<0）**一排 4 张平放**（牌面朝玩家 = 买东西的那一位），
 *  沿长轴间距 0.24（与角色排同一档）、缩放 0.88（卡面 0.176×0.264，比卡位小一档"货"感）。
 *  为什么一页 4 张（老场景 8）：平放一张在桌宽方向占 0.264，1.17 m 的桌宽放下"每边一排"正好对称。
 *  ★ 2026-11-27：`center` 带 `GS_TABLE_SHIFT.z`，这一排跟着桌子一起挪。 */
export const GS_MARKET: MarketLayout = {
  axis: "z",
  rows: [-0.26],
  perRow: 4,
  gap: 0.24,
  lift: 0.02,
  scale: 0.88,
  perPage: 4,
  center: GS_TABLE_SHIFT.z,
};
export const GS_LEFT_STACK: [number, number, number] = [-0.62, 0, 0.55];
export const GS_RIGHT_STACK: [number, number, number] = [0.62, 0, 0.55];

/**
 * ★★ 米制档的「生成」按钮（2026-11-26 第 3 版，主人第 5 条：像炉石那样摆在"分界线右侧、
 *  靠桌沿"）。**这一个常量就是按钮的位置与尺寸**，`TableScene.ComposePad` 的米制分支只读它。
 *
 *  取景依据（正面机位 `GS_CAM`，画幅 852×348）：
 *  · 屏幕右 = **世界 −z**（相机在 +x、视线的右手方向是 −z）⇒ "沿长轴的右半侧" = z 负那一半。
 *    按钮中心 z=**−0.78**，正好在两排卡（z ∈ [−0.46, +0.46]）之外，不压任何一张牌；
 *  · "靠近桌沿" = 玩家这一侧的长边（x=+0.585）。按钮底边落在 x=**0.42**，离桌沿 0.165 m；
 *  · 宽 **0.39 m** = 桌长 2.15 的 **18%**（主人给的数）；高 **0.12 m**；
 *  · 牌子**朝相机后仰 40°**：正面机位仰角 33°，40° 的牌面几乎正对镜头（文字看得清）；
 *    俯视机位仰角 ~75°，牌面还有 cos35°≈0.82 的投影面积 —— 两张验收图里都看得见（平放/直立
 *    只能占一头：平放在正面只剩一条 14 px 的边，直立在俯视只剩一条线）。
 *  · 点击热区另给一块**不可见的 0.42×0.20** 同名平面（`hitW/hitH`）：0.39×0.12 的牌子在真机
 *    上只有 ~95×29 CSS px，够宽不够高，热区要 ≥44×44 —— 0.20 m 高按 244 px/m 换算 ≈ 48 px。
 */
export const GS_PAD = {
  /** 台座中心（世界 x,z）；y 由桌面顶面 0 现算。
   *  ★ 2026-11-27：z = **−0.78 + GS_TABLE_SHIFT.z = −0.98** —— 铭牌是桌面上的东西，
   *    跟桌子一起挪 0.20 m（它离桌沿/卡排的相对位置一个数没变）。 */
  x: 0.46,
  z: -0.78 + GS_TABLE_SHIFT.z,
  /** 牌面尺寸（m）：宽 × 高 */
  w: 0.39,
  h: 0.12,
  /** 牌面绕桌面前法线的后仰角（弧度，40°） */
  tilt: (40 * Math.PI) / 180,
  /** 台座（贴在桌面上的黄铜底板） */
  baseW: 0.43,
  baseD: 0.075,
  baseH: 0.022,
  /** 不可见热区（牌面同一姿态，居中在牌面中点略上方） */
  hitW: 0.42,
  hitH: 0.2,
} as const;

/** 合成按钮（米制）：台座落在 `GS_PAD` 那一位上，y 抬到桌面之上（0.03 是老场景的台座顶）。
 *  ★ 留成数组是为了让 `SceneLayout.composePos` 的形状不变 —— 米制分支真正读的是 `GS_PAD`。 */
export const GS_COMPOSE_POS: [number, number, number] = [GS_PAD.x, 0.03, GS_PAD.z];

/** 横屏/竖屏两套卡位的**唯一分派入口**（铁律六）。`land` 由 hooks/useIsLandscape 或
 *  `camera.aspect >= 1`（defaultCamFor 的同一判据）之后传进来，别在调用点各判一次。
 *  ★ 高斯测地场景开着时**不看 land**（这一档是横屏 App 的实验档；浏览器窄窗口下也按米制那套画）。 */
export interface SceneLayout {
  table: typeof TABLE;
  chain: typeof CHAIN;
  deckPos: [number, number, number];
  spread: SpreadLayout;
  market: MarketLayout;
  leftStack: [number, number, number];
  rightStack: [number, number, number];
  composePos: [number, number, number];
  /** G4 的 5 个对局卡位（4 角色 + 1 场景） */
  slots: SlotLayout;
}

const PORTRAIT_LAYOUT: SceneLayout = {
  table: TABLE,
  chain: CHAIN,
  deckPos: DECK_POS,
  spread: SPREAD,
  market: MARKET,
  leftStack: LEFT_STACK,
  rightStack: RIGHT_STACK,
  composePos: COMPOSE_POS,
  slots: TABLE_SLOTS,
};

const LAND_LAYOUT: SceneLayout = {
  table: TABLE_LAND,
  chain: CHAIN_LAND,
  deckPos: DECK_POS_LAND,
  spread: SPREAD_LAND,
  market: MARKET_LAND,
  leftStack: LEFT_STACK_LAND,
  rightStack: RIGHT_STACK_LAND,
  composePos: COMPOSE_POS_LAND,
  slots: TABLE_SLOTS_LAND,
};

const GS_LAYOUT: SceneLayout = {
  // GS_TABLE 比 typeof TABLE 多一个 height（桌腿要落到地板）—— 多出来的字段对结构类型无害，
  // 但桌子组件要读它，所以下面另给一个 gsTableHeight() 而不是把 GS_TABLE 强转成 typeof TABLE
  table: GS_TABLE,
  chain: GS_CHAIN,
  deckPos: GS_DECK_POS,
  spread: GS_SPREAD,
  market: GS_MARKET,
  leftStack: GS_LEFT_STACK,
  rightStack: GS_RIGHT_STACK,
  composePos: GS_COMPOSE_POS,
  slots: GS_SLOTS,
};

export function sceneLayout(land: boolean): SceneLayout {
  if (gsMetric) return GS_LAYOUT;
  return land ? LAND_LAYOUT : PORTRAIT_LAYOUT;
}

/** 桌面上卡牌的当前尺寸档：高斯测地场景 0.30×0.45（米），其余照旧 1.1×1.65（UI 尺度）。
 *  ★ 所有摆卡/投影的地方都必须走这个函数（CardMesh、SlotPlate、SLOT_SCREEN 的投影框），
 *    各写一份早晚会出现"卡画的是小米制、落点算的是老尺寸"。 */
export function cardLayout(): typeof CARD {
  return gsMetric ? GS_CARD : CARD;
}

/** 高斯测地场景下桌面的"桌板厚度 + 离地高"（老桌面那两套没有 height 字段，按老数据兜底）。 */
export function tableSpec(land: boolean): { w: number; d: number; thick: number; height?: number } {
  const T = sceneLayout(land).table;
  return T === GS_TABLE ? GS_TABLE : { w: T.w, d: T.d, thick: T.thick };
}

/** 市场卡在桌上的位置。**本页内的下标**（0 ~ perPage-1），不是全局下标。
 *  抽出来是因为这段算式原本有两份：TableScene 的 MarketFan 摆卡、modals 的详情单
 *  算飞卡起点。分页之后两边一个用页内下标、一个用全局下标就会当场错位——
 *  第二页点任何一张卡，卡都从第一页那个位置飞出来。
 *  ★ 横屏一页 8 张、竖屏 6 张，所以 `land` 必须由**同一个判据**传进来（见 sceneLayout）。
 *  ★ 两套轴向（MarketLayout.axis）：老场景一排沿 x、排与排差 z；米制档反过来
 *    （一排沿长轴 z、排与排差 x）。`row` 与 `col` 两套轴向都是同一个意思，
 *    调用点要拿它算牌的朝向时直接用，别自己再 floor/mod 一遍。 */
export function marketSlot(
  land: boolean,
  i: number,
  countOnPage: number
): { x: number; z: number; row: number; col: number; rowCount: number } {
  const M = sceneLayout(land).market;
  const row = Math.floor(i / M.perRow);
  const col = i % M.perRow;
  const rowCount = Math.max(1, Math.min(M.perRow, countOnPage - row * M.perRow));
  // ★ center（可选）：整排沿"排开方向"平移。米制档拿它把市场那排跟桌子一起挪 0.20 m；
  //   老两套没写这一位 ⇒ ?? 0，逐字节不变。
  const along = (col - (rowCount - 1) / 2) * M.gap + (M.center ?? 0);
  const at = M.rows[Math.min(row, M.rows.length - 1)];
  return M.axis === "z" ? { x: at, z: along, row, col, rowCount } : { x: along, z: at, row, col, rowCount };
}

export function chainX(land: boolean, visibleIndex: number): number {
  const C = sceneLayout(land).chain;
  return C.startX + visibleIndex * C.dx;
}
