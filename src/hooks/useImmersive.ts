// 沉浸 / 全屏态 —— 首页与作品详情页共用一份（2026-10-26 视频详情页 P0-1 从 FeedPage 原样搬出来）。
// 真·全屏优先（它才遮得住系统 / 浏览器界面，也是安卓返回键能退出的那一层），不支持或被拒就降级成「只收边角元素」的沉浸态；
// 横屏片进了沉浸态才请求转屏；用返回键 / Esc / 系统手势退出全屏时一起收掉沉浸态；卸载时撤掉转屏请求与全屏。
// ★ 方向只有一个主人（hooks/useOrientationLock）：这里只用 requestLandscape 表达意图，不自己去锁 —— 各自锁一次必然打架，
//   真机上就是「点了转屏没反应」。
// ★ body 上的 data-immersive 标记（index.css 据它把底栏藏起来）也归这里：卸载必须清掉，否则底栏在别的页面也跟着消失。
import { useEffect, useRef, useState, type RefObject } from "react";
import type { VideoAspect } from "../types";
import { requestLandscape } from "./useOrientationLock";

export function useImmersive(
  rootRef: RefObject<HTMLElement | null>,
  /** 现在放的这条片的画幅：横屏片进沉浸态才转屏（全屏里划到一条竖屏片，屏幕转回来） */
  aspect: VideoAspect,
): { immersive: boolean; enter: () => Promise<void>; exit: () => void } {
  const [immersive, setImmersive] = useState(false);
  /** 已经叫过 history.back()、还没等到 popstate：别再弹第二次（✕ 与 fullscreenchange 可能前后脚都来叫，弹两次就离开这一页了） */
  const popping = useRef(false);
  const dropMarker = () => {
    if (popping.current || !(window.history.state as { immersive?: boolean } | null)?.immersive) return;
    popping.current = true;
    window.history.back();
  };

  const enter = async () => {
    try {
      await rootRef.current?.requestFullscreen?.();
    } catch {
      /* WebView 版本老 / 被策略拒绝：降级成"只收边角元素"，仍比什么都不做强 */
    }
    // ★ 进沉浸态时压一格历史（同一个地址，带 immersive 记号）：安卓返回键在 Capacitor 里是 webView.goBack()，
    //   而这个 WebView 的 requestFullscreen 实际不生效（2026-10-29 真机：状态栏还在、按返回直接退出了作品详情页、落回首页）。
    //   有了这一格，返回键只弹掉它 → popstate → 收起沉浸态。保留原来的 state（react-router 的 idx / key、useBackOr 读的 idx）
    if (!(window.history.state as { immersive?: boolean } | null)?.immersive) {
      window.history.pushState({ ...(window.history.state ?? {}), immersive: true }, "");
    }
    setImmersive(true);
  };
  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setImmersive(false);
    // 点 ✕ 退出：把进来时压的那一格也弹掉，否则还要多按一次返回才离开这一页
    dropMarker();
  };

  // 返回键弹掉了那一格历史：收起沉浸态（真全屏也一起退）
  useEffect(() => {
    const onPop = () => {
      popping.current = false;
      if ((window.history.state as { immersive?: boolean } | null)?.immersive) return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setImmersive(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 转屏只对横屏片做，且必须在进入全屏之后——两个平台都只允许全屏态下锁方向
  useEffect(() => {
    requestLandscape(immersive && aspect === "landscape");
  }, [immersive, aspect]);

  // 用安卓返回键 / Esc / 系统手势退出全屏时把沉浸态一起收掉，否则页面停在"什么按钮都没有"的样子
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) return;
      setImmersive(false);
      dropMarker();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // 底栏在 TabLayout 里、不归页面渲染——用 body 上的标记让它一起隐身（见 index.css）
  useEffect(() => {
    if (immersive) document.body.dataset.immersive = "1";
    else delete document.body.dataset.immersive;
  }, [immersive]);
  useEffect(
    () => () => {
      delete document.body.dataset.immersive;
      // 横屏请求也必须撤：不撤的话离开这一页后整个 App 还锁在横屏里
      requestLandscape(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [],
  );

  return { immersive, enter, exit };
}
