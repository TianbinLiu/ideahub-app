// 沉浸 / 全屏态 —— 首页与作品详情页共用一份（2026-10-26 视频详情页 P0-1 从 FeedPage 原样搬出来）。
// 真·全屏优先（它才遮得住系统 / 浏览器界面，也是安卓返回键能退出的那一层），不支持或被拒就降级成「只收边角元素」的沉浸态；
// 横屏片进了沉浸态才请求转屏；用返回键 / Esc / 系统手势退出全屏时一起收掉沉浸态；卸载时撤掉转屏请求与全屏。
// ★ 方向只有一个主人（hooks/useOrientationLock）：这里只用 requestLandscape 表达意图，不自己去锁 —— 各自锁一次必然打架，
//   真机上就是「点了转屏没反应」。
// ★ body 上的 data-immersive 标记（index.css 据它把底栏藏起来）也归这里：卸载必须清掉，否则底栏在别的页面也跟着消失。
import { useEffect, useState, type RefObject } from "react";
import { useBackLayer } from "./useBackLayer";
import type { VideoAspect } from "../types";
import { requestLandscape } from "./useOrientationLock";

export function useImmersive(
  rootRef: RefObject<HTMLElement | null>,
  /** 现在放的这条片的画幅：横屏片进沉浸态才转屏（全屏里划到一条竖屏片，屏幕转回来） */
  aspect: VideoAspect,
): { immersive: boolean; enter: () => Promise<void>; exit: () => void } {
  const [immersive, setImmersive] = useState(false);
  // ★ 返回键先退出沉浸态（hooks/useBackLayer → utils/backButton 的层栈）：这个 WebView 的 requestFullscreen 实际不生效，
  //   安卓返回键 = history back，不压这一格的话按返回直接退出了作品详情页（2026-10-29 真机 2.71）
  const dismiss = useBackLayer(immersive, () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setImmersive(false);
  }, "immersive");

  const enter = async () => {
    try {
      await rootRef.current?.requestFullscreen?.();
    } catch {
      /* WebView 版本老 / 被策略拒绝：降级成"只收边角元素"，仍比什么都不做强 */
    }
    setImmersive(true);
  };
  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setImmersive(false);
    // 点 ✕ 退出：把进来时压的那一格也弹掉，否则还要多按一次返回才离开这一页
    dismiss();
  };

  // 转屏只对横屏片做，且必须在进入全屏之后——两个平台都只允许全屏态下锁方向
  useEffect(() => {
    requestLandscape(immersive && aspect === "landscape");
  }, [immersive, aspect]);

  // 用安卓返回键 / Esc / 系统手势退出全屏时把沉浸态一起收掉，否则页面停在"什么按钮都没有"的样子
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) return;
      setImmersive(false);
      dismiss();
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
