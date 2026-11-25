/**
 * 「退出观战」的唯一实现（2026-11-24）。
 *
 * ★★ 退出观战有**两个入口**：观战屏顶栏那颗「✕ 退出观战」与设置页底栏那颗「退出观战」
 *   （设置页在观战这一屏叫这个名字，不是「退出游戏」）。两处各写一份「出席 + 回大厅」的后果，
 *   第一次改退出行为就会有一处改不到 —— 与 ui/quitGame 同一个理由（铁律六：一处实现）。
 * ★ 顺序：先收本机这一屏（spectateStore.reset），再发 `spectate/leave`；出席失败只在控制台留一行，
 *   不把玩家卡在"正在退出"上（房间过期服务端会一并清掉，见服务端契约「数据落点与上限」）。
 * ★ 回大厅 = **公开房列表**（从哪儿来回哪儿去），并把列表刷新一次：席位 / 房间状态可能已经变了。
 *   大厅没开着（理论上走不到：列表是观战的入口）才重新开一次，别把人丢回 3D 桌面。
 */
import { useLobby } from "../lobbyStore";
import { useSpectate } from "../spectateStore";

export function quitSpectateToLobby(): void {
  void useSpectate.getState().exit();
  if (useLobby.getState().open) {
    void useLobby.getState().refreshPublicRooms();
    return;
  }
  useLobby.getState().openLobby();
  useLobby.getState().openPublicRooms();
}
