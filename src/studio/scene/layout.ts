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
 *  数值是把这个场景的坐标按 fov 50 投影到屏幕上量出来的，不是估的。第 3 步换桌子之后**整组重算过**：
 *  量的是真实舞台 945×785（1384×797 的窗口扣掉两条 15vw 常驻条后的画布，aspect 1.204）。
 *  **重算结论：机位不用动，换的是桌子与卡位**（TABLE_LAND 22×9 / 节点链 7 张 / 市场 4 张一排 /
 *  卡组堆 -1.8,3.0 / 合成法阵 3.0）。这一台仍然把关键点全框在画面里，而且新桌子的近边（z=4.5）
 *  被推到 y=101.9% 之外 —— 桌毡这才真正铺满画面底边（16×7 时它只到 83%，底下露出一截地板）。
 *  各处量出来的数（屏幕 x 范围 / y 范围）：
 *  · **能看全铸卡师**：头顶 y=25.1%、下巴 29.3%、搭在桌沿的手 37.4%，头离上缘还有四分之一屏；
 *  · **卡组堆在画面里、点得到**：DECK_POS_LAND（-1.8, z=3.0）落 x 10.7~28.3% / y 70.5~84.2%，
 *    离画布左缘 10.7%、离底缘 16%（系统手势条只在最底 8% 那一带）；
 *  · **市场四张一排**：两排 x 27.7~72.3% / 30.1~69.9%，y 44.8~48.8% / 40.6~43.8%；
 *  · **节点链 7 张 + 左右收起堆**：卡位 x 14.5~85.5%（收起堆 11.6~88.4%），y 54.2~61.7%；
 *  · **合成法阵**：台座中心 (82.9, 51.5)%、x 77.2~88.6%，铭牌 75.1~94.2%；
 *  · **桌面**：远边 y=35.4%、近边 101.9%；两侧半宽 11 比任何深度上的可视半宽都大（最远处 ±6.7）。
 *  为什么不是施工单 §4 写的 `pos [0,4.2,6.2] / look [0,0.2,-1.2]`：那一组算下来卡组堆正好落在
 *  y 84~104%（近侧一半在画外，手机上还压在系统手势条上）；往前推（z 6.4~6.8 / y 3.8~4.2）
 *  卡组堆会顶到 y≈90% 以上，所以退这一档。第 4 步的入场动画就落在这一台上。
 *  ⚠ 竖屏那台（DEFAULT_CAM）与竖屏卡位都不受影响：defaultCamFor 按画布 aspect 选，竖屏走另一支。 */
export const LAND_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 3.4, 7.4],
  look: [0, -0.2, -0.8],
};

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
  // 1.0 起算横屏：正方形（aspect=1）时卡组堆仍在 x≈22%、市场也在框里，两种机位都站得住，
  // 这里取"正方形算横屏"——毕竟此时横屏那台给的构图更接近玩家真正看到的桌子。
  return aspect >= 1 ? LAND_CAM : DEFAULT_CAM;
}

/** 聚焦某张桌面卡时的拉近机位：卡片落在画面下部 1/3（上方留给投影窗与光束） */
export function focusCam(x: number, z: number): { pos: [number, number, number]; look: [number, number, number] } {
  // 坐标算不出来时退到桌心而不是把 NaN 传下去：NaN 进了 camera.position 之后
  // 每次 lerp 都会继续污染，画面全黑却不报任何错，比直接崩还难查。
  // （消费端 TableScene 也挡了一道——这里是产出端，两头都不该放 NaN 过去）
  const fx = Number.isFinite(x) ? x : 0;
  const fz = Number.isFinite(z) ? z : 0;
  return { pos: [fx * 0.75, 5.15, fz + 2.0], look: [fx, 0.45, fz - 2.3] };
}

/** 悬浮卡的抬升高度 */
export const FLOAT_Y = 0.85;

/** 对话视角：日系 CG 式第一人称对坐——下 1/3 桌面（散牌背），对面角色锁骨以下、胸部+双手 */
export const NPC_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 3.05, 2.45],
  look: [0, -1.45, -4.1],
};

/** 卡组浏览视角：悬浮在玩家前方、与桌沿同高的摄像机（rail 顶 0.25），仰拍玩家 */
export const DECK_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 0.27, 2.9],
  look: [0, 0.46, 5.0],
};

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
export const TABLE_SLOTS = {
  roleZ: 1.2,
  roleDx: 0.85,
  roleScale: 0.55,
  sceneX: -1.55,
  sceneZ: 0.5,
  sceneScale: 0.45,
};

/** 卡组展开排（用户手前一排，卡组右侧） */
export const SPREAD = { z: 2.75, dx: 1.05, maxVisible: 3, centerX: 0.2 };

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
export const MARKET = { rowsZ: [-1.05, -2.2], perRow: 3, dx: 0.66, lift: 0.02, scale: 0.55, perPage: 6 };

/** 溢出节点的左侧收起堆（贴左缘露半张=「收起」） */
export const LEFT_STACK: [number, number, number] = [-1.85, 0, 0.95];

/** 溢出节点的右侧收起堆：聚焦早期节点时窗口左移，其后的节点收到右缘 */
export const RIGHT_STACK: [number, number, number] = [1.85, 0, 0.95];

/** 合成按钮：中线右端（竖屏可视范围内） */
export const COMPOSE_POS: [number, number, number] = [1.5, 0.03, 0];

// ─────────────────────────────────────────────────────────────
// 横屏那套（G1 施工单 docs/g1-scene-plan.md §3）。**只影响横屏**：竖屏窗口继续读上面那组，
// 一个数都不改。下面每个 `*_LAND` 都注明了"为什么是这个数"，量法见 LAND_CAM 的注释。
// ─────────────────────────────────────────────────────────────

/** 横屏桌面：22×9（竖屏 16×7）。为什么是这两个数（945×785 的舞台 = 1384×797 的窗口扣掉两条常驻条，
 *  aspect 1.204，见 LAND_CAM 注释）：
 *  · 近边 z=+4.5 投到 y=101.9% —— 刚好落到画面下沿之外，桌毡铺满画面底边（16×7 时它只到 83%，
 *    下面露出一截地板，横屏看就是"桌面没占满"）；
 *  · 远边 z=-4.5 在 y=35.4%，两侧半宽 11 远超任何深度上的可视半宽（最远那排也只有 ±6.7）——
 *    "两侧不留黑边"就是靠这两个数。
 *  ⚠ 深度从 7 加到 9 之后铸卡师站的位置（z=-4.3）正好贴着远边内侧（原来离远边 0.8）：
 *    她被桌子挡到腰线的高度只从 38% 抬到 35.4%（视觉上"站在桌沿后面"），这是加宽的代价里最可控的一档。 */
export const TABLE_LAND = { w: 22, d: 9, thick: 0.35 };

/** 横屏节点链：一屏 7 张（竖屏 5 张）。dx 0.78 > 卡宽 1.1×0.66=0.726，7 张之间有 0.054 的缝（不叠压，
 *  与竖屏 5 张 / 0.8 间距同一种"链"的读法）。startX=-2.34 让 7 张以 x=0 为中心摊开：卡位中心 ±2.34、
 *  外缘 ±2.70 投到 x 14.5~85.5%，两端各剩 14.5% 给收起堆（±2.59 投 11.6~88.4%）。
 *  为什么不再摆宽一点：再宽 0.2 左右，右端就会把合成法阵（COMPOSE_POS_LAND）挤出画面。 */
export const CHAIN_LAND = { startX: -2.34, dx: 0.78, rowZ: 0.95, maxVisible: 7, scale: 0.66 };

/** 横屏卡组堆（用户左手边）：x -1.5→-1.8、z 2.75→3.0。
 *  横屏的卡组行在屏幕上更靠外（同样的 x 在 z 更近时占屏更宽），-1.5/z2.75 会压到摊开排的排头；
 *  -1.8/z3.0 投到 x 10.7~28.3% / y 70.5~84.2%（竖屏那颗在 20~38% / 67~80%）——仍读作"左手边那叠"，
 *  离画布左缘还有 10.7% 余量、离系统手势区（屏幕底 8%）还有 16%，点得到。 */
export const DECK_POS_LAND: [number, number, number] = [-1.8, 0, 3.0];

/** 横屏摊开排：dx 1.05→1.2（卡片原尺寸 1.1 宽，留 0.1 的缝）、centerX 0.2→0.3。
 *  卡组挪到 -1.8 之后排头（-0.9，卡宽 ±0.55）正好从卡组右缘（-1.437）外一点开始摊；
 *  排尾 1.5+0.55=2.05 投到 x 89.4% —— 再往右就撞画布右缘了（z=3.0 这一排是全屏最近的一张，
 *  每 0.1 世界单位≈2.6% 屏宽）。 */
export const SPREAD_LAND = { z: 3.0, dx: 1.2, maxVisible: 3, centerX: 0.3 };

/**
 * 横屏的 G4 卡位（量法与量出来的数见下面 ★）：
 *  · 角色排 z=1.7、dx=1.45、卡缩到 0.8：四张投到 x 23.0~77.0%、y 58.3~69.5%（945×785 的舞台），
 *    桌面中线（z=0）在屏幕 y≈49% —— 这一排在它下面，且整排落在卡组堆（y 70.5~84.2%）**上方**，
 *    两者不叠；
 *  · 场景位 (-3.6, 0.55)：投到 x 15.8~25.4% / y 51.9~58.6%，读作"角色排的左上方"，
 *    也在中线以下（y>49%、z>0 = 玩家这一侧）。
 * ★ 为什么角色排不摆得更宽：窄画布（aspect 1.2~1.3 的浏览器窗口）里四张就已经撑到 90%，
 *   再宽会撞画布边；手机上（aspect 2.2）四张占 28.7~71.3%，两侧留给卡组堆与合成法阵。
 */
export const TABLE_SLOTS_LAND = {
  roleZ: 1.7,
  roleDx: 1.45,
  roleScale: 0.8,
  sceneX: -3.6,
  sceneZ: 0.55,
  sceneScale: 0.65,
};

/** 横屏市场：一页 2 排 × 4 张 = 8 张（竖屏 2×3=6），行位置不变（rowsZ 与竖屏同一组）。
 *  dx 0.66→1.25：卡宽 0.605，横屏这一排的可视宽约是竖屏的 4 倍，四张排开只在画面中间
 *  x 27.7~72.3%（row0）/ 30.1~69.9%（row1），两侧留给卡组摊开排与合成法阵。
 *  为什么不是更宽：dx 1.25 已经是"四张之间留 0.645（> 一张卡宽）"的稀疏摆法，再宽就不像"摊开的一排"了。 */
export const MARKET_LAND = { rowsZ: [-1.05, -2.2], perRow: 4, dx: 1.25, lift: 0.02, scale: 0.55, perPage: 8 };

/** 横屏的左右收起堆：跟着节点链走 —— 链尾卡位 2.34 + 0.25 = 2.59，与竖屏 1.6→1.85 同一个
 *  "从最后一张后面露半张"的关系（收起堆的卡面因此始终压在链尾卡右下/左下角，一眼看出还有一段）。 */
export const LEFT_STACK_LAND: [number, number, number] = [-2.59, 0, 0.95];
export const RIGHT_STACK_LAND: [number, number, number] = [2.59, 0, 0.95];

/** 横屏合成法阵：中线右端从 1.5 挪到 3.0 —— 链尾卡在 2.34，法阵仍读作"右端那颗"。
 *  3.0 时台座投到 x 77.2~88.6%、铭牌 75.1~94.2%（竖屏那颗的铭牌几乎是贴着屏幕右缘的；
 *  再往右 0.35 铭牌就会压到 98%） */
export const COMPOSE_POS_LAND: [number, number, number] = [3.0, 0.03, 0];

/** 横屏/竖屏两套卡位的**唯一分派入口**（铁律六）。`land` 由 hooks/useIsLandscape 或
 *  `camera.aspect >= 1`（defaultCamFor 的同一判据）之后传进来，别在调用点各判一次。 */
export interface SceneLayout {
  table: typeof TABLE;
  chain: typeof CHAIN;
  deckPos: [number, number, number];
  spread: typeof SPREAD;
  market: typeof MARKET;
  leftStack: [number, number, number];
  rightStack: [number, number, number];
  composePos: [number, number, number];
  /** G4 的 5 个对局卡位（4 角色 + 1 场景） */
  slots: typeof TABLE_SLOTS;
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

export function sceneLayout(land: boolean): SceneLayout {
  return land ? LAND_LAYOUT : PORTRAIT_LAYOUT;
}

/** 市场卡在桌上的位置。**本页内的下标**（0 ~ perPage-1），不是全局下标。
 *  抽出来是因为这段算式原本有两份：TableScene 的 MarketFan 摆卡、modals 的详情单
 *  算飞卡起点。分页之后两边一个用页内下标、一个用全局下标就会当场错位——
 *  第二页点任何一张卡，卡都从第一页那个位置飞出来。
 *  ★ 横屏一页 8 张、竖屏 6 张，所以 `land` 必须由**同一个判据**传进来（见 sceneLayout）。 */
export function marketSlot(land: boolean, i: number, countOnPage: number): { x: number; z: number } {
  const M = sceneLayout(land).market;
  const row = Math.floor(i / M.perRow);
  const col = i % M.perRow;
  const rowCount = Math.min(M.perRow, countOnPage - row * M.perRow);
  return {
    x: (col - (rowCount - 1) / 2) * M.dx,
    z: M.rowsZ[Math.min(row, M.rowsZ.length - 1)],
  };
}

export function chainX(land: boolean, visibleIndex: number): number {
  const C = sceneLayout(land).chain;
  return C.startX + visibleIndex * C.dx;
}
