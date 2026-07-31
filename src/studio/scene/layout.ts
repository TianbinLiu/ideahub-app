// 桌面世界坐标约定：桌面顶面 y=0；用户侧 z>0，NPC 侧 z<0；中线沿 x 轴。
export const TABLE = { w: 16, d: 7, thick: 0.35 };

export const CARD = { w: 1.1, h: 1.65, lift: 0.02 };

/** 固定机位：只看到双方手部/上身与桌面（整桌入画，含卡组与合成台） */
export const DEFAULT_CAM: { pos: [number, number, number]; look: [number, number, number] } = {
  pos: [0, 7.6, 10.2],
  look: [0, -1.5, -1.0],
};

/** 节点链（用户侧、靠近中线的一排） */
export const CHAIN = {
  startX: -4.9,
  dx: 1.55,
  rowZ: 0.85,
  maxVisible: 6,
};

/** 三方案的上/中/下三行（上=靠中线，下=靠用户） */
export const PROPOSAL_ROWS_Z = [0.12, 1.5, 2.88];
export const PROPOSAL_SCALE = 0.82;

/** 卡组位置（用户左手边） */
export const DECK_POS: [number, number, number] = [-6.5, 0, 2.35];

/** 卡组展开排（空白卡位下方一排） */
export const SPREAD = { z: 2.5, dx: 1.25, maxVisible: 5, centerX: -2.7 };

/** 市场平摊（NPC 侧） */
export const MARKET = { z: -1.55, dx: 1.3, lift: 0.02 };

/** 溢出节点的左侧收起堆 */
export const LEFT_STACK: [number, number, number] = [-6.6, 0, 0.85];

/** 合成按钮：中线最右端 */
export const COMPOSE_POS: [number, number, number] = [7.1, 0.03, 0];

export function chainX(visibleIndex: number): number {
  return CHAIN.startX + visibleIndex * CHAIN.dx;
}
