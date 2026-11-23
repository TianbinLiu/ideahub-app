// 屏幕方向的唯一主人：**工坊锁横屏，其余页面锁竖屏**；首页横屏片进全屏时临时放行横屏。
//
// 为什么工坊要横屏：G1 起工坊是横屏桌面的玩法（docs/g1-scene-plan.md §2 + docs/workshop-game-design.md §2.6）——
// 桌面按横屏比例重做、默认机位（scene/layout.LAND_CAM）是照横屏摆的，跟着手机方向在竖/横之间跳
// 就得给每张桌子、每个卡位都维护两套坐标。
// 为什么**不**用 CSS 旋转 90° 的伪横屏：手势、拖拽层、WebView 的触摸坐标全要跟着旋转对齐，
// 坑比真锁屏多得多（施工单 §2 B 那段，也是主人点名的取舍）。
//
// ★ 与 AndroidManifest 的 android:screenOrientation="portrait" 配合，不是二选一：
//   manifest 管冷启动那一瞬（JS 还没跑，横着手机点图标不会先歪一下），
//   这里管运行时切换（进工坊锁 landscape、出去锁回 portrait）。运行时的 setRequestedOrientation
//   优先级高于 manifest，所以真的转得过来。
//
// ★★ 屏幕方向**只有这一个主人**（铁律六）。首页的「转屏全屏」不自己去调
//    ScreenOrientation/screen.orientation，而是调下面的 requestLandscape() 表达意图。
//    原因是本 hook 每次切路由都会定一次方向，别处再各自锁一次必然打架：
//    真机上的表现是"点了转屏没反应"——native 的 setRequestedOrientation(portrait)
//    早已把 activity 钉死，Web 那套 screen.orientation.lock 根本盖不过它。
//
// ⚠ 已知：工作流画布（components/flow/FlowCanvas）的「⟳ 转横屏 / ↩ 回竖屏」键挂在本 hook 的
//    requestLandscape 上。画布在**工坊里是浮层**（同一个 /studio 路由），而工坊这一支已经钉死横屏，
//   所以在工坊里按下「回竖屏」这一半是没有效果的（/flow 那一页照旧有效）。
//    要给它真正的竖屏权，得把 requestLandscape 从"布尔"改成"三态"（自动 / 强制横 / 强制竖），
//    那是另一条工单 —— 现在这颗键在工坊里仍会把"要横屏"这个意图表达出来，不撒谎、只是无事可做。
import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";

/** 锁横屏的路由前缀。用前缀而不是全等：工坊将来加子路由（/studio/xxx）不该突然翻回竖屏 */
const LANDSCAPE_ROUTES = ["/studio"];

/** screen.orientation.lock 不在 TS 的 DOM lib 里（提案阶段 API），类型收口一次 */
type LockableOrientation = ScreenOrientation & {
  lock?: (o: "landscape" | "portrait") => Promise<void>;
};

/** 这个路由自己就要求横屏（工坊）。画布等处分窗/布局时用它判断"方向不归我管" */
export function routeIsLandscape(pathname: string): boolean {
  return LANDSCAPE_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ── 运行时的横屏请求（模块级单例：跨组件、不进 React 树） ──────────
let wantLandscape = false;
const subs = new Set<() => void>();

/**
 * 临时要一个横屏（首页横屏片进全屏时）。退出时必须传 false ——
 * 漏掉的话用户退出全屏后整个 App 都还锁在横屏里，且只有切一次路由才会被纠正。
 */
export function requestLandscape(on: boolean): void {
  if (wantLandscape === on) return;
  wantLandscape = on;
  subs.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function useOrientationLock(): void {
  const { pathname } = useLocation();
  const landscape = useSyncExternalStore(
    subscribe,
    () => wantLandscape,
    () => false, // SSR/首帧：按"不要横屏"算，与冷启动的 manifest 一致
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      // 浏览器：只在**有人明确要横屏**（= 已经进了全屏）时才动方向。
      // 平时一概不碰——没有全屏权限时 lock 会抛 NotSupportedError，
      // 桌面开发每切一次路由弹一个错没有意义。工坊在浏览器里也不锁：宽布局自己按
      // `(orientation: landscape)` 切（hooks/useIsLandscape），把窗口拖成横的就看得到。
      const so = screen.orientation as LockableOrientation | undefined;
      if (landscape) void so?.lock?.("landscape").catch(() => {});
      else
        try {
          so?.unlock?.();
        } catch {
          /* 没锁上过自然也解不了 */
        }
      return;
    }

    // 两个来源合成一个结论：显式请求（首页转屏全屏）或工坊路由 → 横屏，其余一律竖屏。
    // ★ 这里不再有 unlock()：`unlock()` 的意思是"跟着手机方向转"，那等于工坊在竖/横之间
    //   摇摆，正是 G1 要消掉的东西（桌面坐标、机位都只按横屏摆了一套）。
    const want = landscape || routeIsLandscape(pathname);
    // ★ 吞掉异常而不是让它冒泡：锁屏失败顶多是能转，不该把页面切换整个搞挂。
    //   部分厂商 ROM（分屏 / 悬浮窗态）会直接拒绝 setRequestedOrientation。
    void ScreenOrientation.lock({ orientation: want ? "landscape" : "portrait" }).catch(() => {});
  }, [pathname, landscape]);
}

export default useOrientationLock;
