// 桌面世界坐标约定：桌面顶面 y=0；用户侧 z>0，NPC 侧 z<0；中线沿 x 轴。
// 竖屏优先：俯视机位，画面内只有双方的手与桌面（NPC 躯干在画外）。
export const TABLE = { w: 16, d: 7, thick: 0.35 };

export const CARD = { w: 1.1, h: 1.65, lift: 0.02 };

/** 旧的俯视机位。**默认机位已改为第一人称眼位**（CameraRig 里按玩家头骨动态求值，
 *  见 eyeCam）；这里只留作 RIG_LOOK 的初值与模型未加载完时的兜底 */
export const DEFAULT_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 9.8, 3.0],
  look: [0, 0, 0.25],
};

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

/** 市场卡在桌上的位置。**本页内的下标**（0 ~ perPage-1），不是全局下标。
 *  抽出来是因为这段算式原本有两份：TableScene 的 MarketFan 摆卡、modals 的详情单
 *  算飞卡起点。分页之后两边一个用页内下标、一个用全局下标就会当场错位——
 *  第二页点任何一张卡，卡都从第一页那个位置飞出来。 */
export function marketSlot(i: number, countOnPage: number): { x: number; z: number } {
  const row = Math.floor(i / MARKET.perRow);
  const col = i % MARKET.perRow;
  const rowCount = Math.min(MARKET.perRow, countOnPage - row * MARKET.perRow);
  return {
    x: (col - (rowCount - 1) / 2) * MARKET.dx,
    z: MARKET.rowsZ[Math.min(row, MARKET.rowsZ.length - 1)],
  };
}

/** 溢出节点的左侧收起堆（贴左缘露半张=「收起」） */
export const LEFT_STACK: [number, number, number] = [-1.85, 0, 0.95];

/** 溢出节点的右侧收起堆：聚焦早期节点时窗口左移，其后的节点收到右缘 */
export const RIGHT_STACK: [number, number, number] = [1.85, 0, 0.95];

/** 合成按钮：中线右端（竖屏可视范围内） */
export const COMPOSE_POS: [number, number, number] = [1.5, 0.03, 0];

export function chainX(visibleIndex: number): number {
  return CHAIN.startX + visibleIndex * CHAIN.dx;
}
