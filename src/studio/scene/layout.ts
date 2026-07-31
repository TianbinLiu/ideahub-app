// 桌面世界坐标约定：桌面顶面 y=0；用户侧 z>0，NPC 侧 z<0；中线沿 x 轴。
// 竖屏优先：俯视机位，画面内只有双方的手与桌面（NPC 躯干在画外）。
export const TABLE = { w: 16, d: 7, thick: 0.35 };

export const CARD = { w: 1.1, h: 1.65, lift: 0.02 };

/** 默认俯视机位（竖屏）：从用户头顶前上方向下看 */
export const DEFAULT_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 9.8, 3.0],
  look: [0, 0, 0.25],
};

/** 聚焦某张桌面卡时的拉近机位：卡片落在画面下部 1/3（上方留给投影窗与光束） */
export function focusCam(x: number, z: number): { pos: [number, number, number]; look: [number, number, number] } {
  return { pos: [x * 0.75, 5.15, z + 2.0], look: [x, 0.45, z - 2.3] };
}

/** 悬浮卡的抬升高度 */
export const FLOAT_Y = 0.85;

/** 对话视角：日系 CG 式第一人称对坐——下 1/3 桌面（散牌背），对面角色锁骨以下、胸部+双手 */
export const NPC_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 3.05, 2.45],
  look: [0, -1.45, -4.1],
};

/** 节点链（用户侧、靠近中线的一排；竖屏可视 x≈±1.55 → 3 张窗口化） */
export const CHAIN = {
  startX: -1.5,
  dx: 1.35,
  rowZ: 0.95,
  maxVisible: 3,
};

/** 卡组位置（用户左手边） */
export const DECK_POS: [number, number, number] = [-1.5, 0, 2.75];

/** 卡组展开排（用户手前一排，卡组右侧） */
export const SPREAD = { z: 2.75, dx: 1.05, maxVisible: 3, centerX: 0.2 };

/** 市场平摊（NPC 侧，两排各 4 张，扑克式轻微重叠） */
export const MARKET = { rowsZ: [-1.0, -2.35], perRow: 4, dx: 0.95, lift: 0.02 };

/** 溢出节点的左侧收起堆（贴左缘露半张=「收起」） */
export const LEFT_STACK: [number, number, number] = [-1.85, 0, 0.95];

/** 合成按钮：中线右端（竖屏可视范围内） */
export const COMPOSE_POS: [number, number, number] = [1.5, 0.03, 0];

export function chainX(visibleIndex: number): number {
  return CHAIN.startX + visibleIndex * CHAIN.dx;
}
