/**
 * 桌面 5 个卡位的**屏幕坐标**（G4 第 3 步：拖卡入位的落点判定）。
 *
 * ★ 为什么要有这一份：拖动的手势在 2D 那一层（背包条 / 右侧道具栏是 DOM，指针事件只有 clientX/Y），
 *   而卡位在 3D 桌面里。判"松手落哪一格"要么从屏幕往场景里射线反解世界坐标、要么把卡位反过来
 *   投影到屏幕 —— 这里选后者：
 *   · 与 `cameraOrbit.NPC_SCREEN` / `PLAYER_SCREEN` 是**同一套**做法（每帧 project 一次、存成
 *     0~1 的屏占比，DOM 侧乘自己的宽高），不是新写一套手势/拾取；
 *   · 屏幕坐标直接可比手指位置，横屏竖屏、相机拉近商店、进对话视角都跟着相机走
 *     （相机一动，下一帧这里就是新位置 —— 拖拽时它正好也在动）。
 * ★ 值是**屏占比**（0~1，含 r）而不是像素：DOM 那一层与 canvas 不一定同尺寸（横屏有安全区、
 *   这一层现在铺满舞台），用比例换算过去才不会被两边各自量一次宽高弄偏。
 * ★ 空数组 = 还没量出来（第一帧 / 竖屏不挂对局 UI）：调用方按"哪一格都没悬"处理，不许猜。
 */
import type { TableSlot } from "../game/types";

export interface SlotScreenRect {
  /** 对应哪个卡位 */
  slot: TableSlot;
  /** 中心点（屏占比 0~1，canvas 坐标系） */
  cx: number;
  cy: number;
  /** 半宽 / 半高（屏占比）：命中判定用一个外接矩形（平放的卡投影出来是梯形，取包围盒够用） */
  rx: number;
  ry: number;
  /** 相机在这一格前面吗（背对相机的位子不该接落点，否则会"拖到看不见的地方也亮"） */
  visible: boolean;
}

/** 场景每帧写、DOM 拖拽每帧读的同一个格子（模块作用域：两棵树不是父子，靠它互通） */
export const SLOT_SCREEN: { rects: SlotScreenRect[] } = { rects: [] };

/** 屏幕点（屏占比 0~1）落在哪一格上；都没落上回 null。 */
export function slotAtScreen(x: number, y: number): TableSlot | null {
  // 从后往前找：命中区重叠时优先"更靠前"的那个（渲染顺序里场景位在角色排之前，这里反过来扫一遍）
  for (let i = SLOT_SCREEN.rects.length - 1; i >= 0; i -= 1) {
    const rect = SLOT_SCREEN.rects[i];
    if (!rect.visible) continue;
    if (Math.abs(x - rect.cx) <= rect.rx && Math.abs(y - rect.cy) <= rect.ry) return rect.slot;
  }
  return null;
}

/** 卡位与卡位的相等判断（拖拽高亮 / 落点判定共用一处：别各处自己比字段）。 */
export function sameTableSlot(a: TableSlot | null, b: TableSlot | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "scene") return true;
  return b.kind === "role" && a.index === b.index;
}

/**
 * 验收口子（与 `__game` / `__gameCam` / `__gsAccept` 同一条约定：DEV，或 localStorage 写了
 * `gsAcceptDebug=1` 的包才挂）。模拟器验收要"把一张手牌拖到某一格上"——落点判定就是这一份
 * 屏占比，脚本按它算手指坐标，不靠肉眼量（`2026-11-28 feat/ui-game-hud-a` 的拖拽悬停截图）。
 * ★ 只读：拿到的是每帧重写的同一个数组（别在脚本里改它）。
 */
const acceptHooksOn =
  import.meta.env?.DEV === true ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptHooksOn && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gameSlots = {
    get rects() {
      return SLOT_SCREEN.rects;
    },
  };
}
