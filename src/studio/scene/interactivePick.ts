// 3D 互动物件的命中探针（2026-11-28）—— 3D 层与对局 UI 层之间的**唯一一条**"这一点打在哪"。
//
// 为什么要有它：对局里"点商店栏外面收起商店"（`game/ui/GameLayer` 的 window 监听）必须能区分
//   · 点在**空白桌面 / 背景**上 = 收起商店（主人点名的"点栏外"）；
//   · 点在 **NPC** 上 = 拉近到 0.8 m（`TripoNpc.onClick` → `gameCam.gameCamClickNpc`）；
//   · 点在卡 / 铭牌 / 生成键上 = 各自的动作。
// DOM 这一侧看到的永远是同一个 `<canvas>`，只有 3D 里的射线知道压在手底下的是不是可交互物件
// （判据同 TableScene.TableCatcher：对象链上有 r3f 的 eventCount，且最前面那块不是空白拾取面）。
//
// ★ 生产里这就是一次函数指针的赋值，没有 window 全局、没有 DOM 查询。
// ★ 谁注册：`TableCatcher` 挂载时注册自己的射线，卸载（切场景 / splat 回退 / 离开工坊）时清掉；
//   没注册时一律按"不是"—— 商店那一层退回旧行为（点哪儿都算栏外）。
// ★ 反过来**不做**：3D 层不 import 对局 store（scene 只读的纪律，见 GameLayer 的 ★）。
type InteractiveProbe = (clientX: number, clientY: number) => boolean;

let probe: InteractiveProbe | null = null;

/** 注册/清空（只在 TableCatcher 的 effect 里调；传 null = 卸载） */
export function setInteractiveHitProbe(fn: InteractiveProbe | null): void {
  probe = fn;
}

/** 这一下（viewport CSS px）是不是压在可交互的 3D 物件上 */
export function hitInteractiveAt(clientX: number, clientY: number): boolean {
  return probe ? probe(clientX, clientY) : false;
}
