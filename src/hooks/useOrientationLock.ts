// 全局竖屏锁：除工坊外，App 一律锁竖屏。
//
// 为什么只放工坊：工坊是 3D 圆台，横过来能多看半张桌子，是**有收益**的横屏；
// 其余页面（全屏视频流、卡片列表、表单）横过来只是把内容压扁，
// 视频流那种"一屏一个视频"的版式横屏后连一条视频都塞不下。
//
// ★ 与 AndroidManifest 的 android:screenOrientation="portrait" 配合，不是二选一：
//   manifest 管冷启动那一瞬（JS 还没跑，横着手机点图标不会先歪一下），
//   这里管运行时切换（进工坊解锁、出工坊锁回来）。运行时的 setRequestedOrientation
//   优先级高于 manifest，所以解锁真的能解开。
import { useEffect } from "react";
import { useLocation } from "react-router";
import { Capacitor } from "@capacitor/core";
import { ScreenOrientation } from "@capacitor/screen-orientation";

/** 允许横屏的路由前缀。用前缀而不是全等：工坊将来加子路由（/studio/xxx）不该突然被锁 */
const FREE = ["/studio"];

export function useOrientationLock(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    // 浏览器里 ScreenOrientation.lock 需要全屏权限，不满足会抛 NotSupportedError；
    // 桌面开发时每次切路由弹一个错没有意义，直接只在原生壳里生效
    if (!Capacitor.isNativePlatform()) return;

    const free = FREE.some((p) => pathname === p || pathname.startsWith(p + "/"));
    // ★ 吞掉异常而不是让它冒泡：锁屏失败顶多是能转，不该把页面切换整个搞挂。
    //   部分厂商 ROM（分屏 / 悬浮窗态）会直接拒绝 setRequestedOrientation。
    void (free ? ScreenOrientation.unlock() : ScreenOrientation.lock({ orientation: "portrait" })).catch(() => {});
  }, [pathname]);
}

export default useOrientationLock;
