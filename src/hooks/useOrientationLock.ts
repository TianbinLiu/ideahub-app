// 全局竖屏锁：除工坊外，App 一律锁竖屏；首页横屏片进全屏时临时放行横屏。
//
// 为什么只放工坊：工坊是 3D 圆台，横过来能多看半张桌子，是**有收益**的横屏；
// 其余页面（卡片列表、表单）横过来只是把内容压扁。
//
// ★ 与 AndroidManifest 的 android:screenOrientation="portrait" 配合，不是二选一：
//   manifest 管冷启动那一瞬（JS 还没跑，横着手机点图标不会先歪一下），
//   这里管运行时切换（进工坊解锁、出工坊锁回来）。运行时的 setRequestedOrientation
//   优先级高于 manifest，所以解锁真的能解开。
//
// ★★ 屏幕方向**只有这一个主人**（铁律六）。首页的「转屏全屏」不自己去调
//    ScreenOrientation/screen.orientation，而是调下面的 requestLandscape() 表达意图。
//    原因是本 hook 每次切路由都会 lock(portrait)，别处再各自锁一次必然打架：
//    真机上的表现是"点了转屏没反应"——native 的 setRequestedOrientation(portrait)
//    早已把 activity 钉死，Web 那套 screen.orientation.lock 根本盖不过它。
import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";

/** 允许横屏的路由前缀。用前缀而不是全等：工坊将来加子路由（/studio/xxx）不该突然被锁 */
const FREE = ["/studio"];

/** screen.orientation.lock 不在 TS 的 DOM lib 里（提案阶段 API），类型收口一次 */
type LockableOrientation = ScreenOrientation & {
  lock?: (o: "landscape" | "portrait") => Promise<void>;
  unlock?: () => void;
};

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
      // 桌面开发每切一次路由弹一个错没有意义。
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

    const free = FREE.some((p) => pathname === p || pathname.startsWith(p + "/"));
    // ★ 吞掉异常而不是让它冒泡：锁屏失败顶多是能转，不该把页面切换整个搞挂。
    //   部分厂商 ROM（分屏 / 悬浮窗态）会直接拒绝 setRequestedOrientation。
    void (
      landscape
        ? ScreenOrientation.lock({ orientation: "landscape" })
        : free
          ? ScreenOrientation.unlock()
          : ScreenOrientation.lock({ orientation: "portrait" })
    ).catch(() => {});
  }, [pathname, landscape]);
}

export default useOrientationLock;
