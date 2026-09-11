// 没登录也能换语言的那颗小芯片：登录页右上角、「我的」页未登录态（多语言方案 §5.3）。
//
// ★ 为什么需要它：设置页在 RequireAuth 后面，没登录的人进不去；而首页、发现、工坊、「我的」都没有硬登录墙，
//   Google Play 审核员的第一屏是首页、不是登录页。
// ★ 只在 zh / en 之间切，并写入显式选择；想回到「跟随系统」去设置页（那里是三态）。
// ★ 芯片上写的是**点下去会变成的那种语言**，并且用它自己的文字写（EN / 中文）：
//   正是看不懂当前界面的人才需要找到它。
import { useState } from "react";
import { showToast } from "../data/toast";
import type { Lang } from "../i18n/locale";
import { setLangPref } from "../i18n/switch";
import { useLang } from "../i18n/useLang";

/* i18n-frozen: 每种语言用它自己的文字写，看不懂当前界面的人才认得出 */
const CHIP_LABEL = { en: "EN", zh: "中文" } as const;
/* i18n-frozen: 读屏名双语，理由同上 */
const CHIP_ARIA = { en: "Switch to English · 切换到英文", zh: "切换到中文 · Switch to Chinese" } as const;
/* i18n-frozen: 切换失败时目录可能根本没加载出来，只能两种语言一起说 */
const SWITCH_FAILED = "没能切换语言，请重试 · Couldn't switch the language, please try again";

export default function LangChip({ className = "" }: { className?: string }) {
  const { active } = useLang();
  const [busy, setBusy] = useState(false);
  const target: Lang = active === "zh" ? "en" : "zh";
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={CHIP_ARIA[target]}
      onClick={() => {
        setBusy(true);
        setLangPref(target)
          .catch((e) => {
            console.error("[i18n] 切换语言失败:", e);
            showToast(SWITCH_FAILED);
          })
          .finally(() => setBusy(false));
      }}
      className={`rounded-full bg-panel px-3 py-1 text-[11px] text-slate-300 active:opacity-60 disabled:opacity-40 ${className}`}
    >
      {CHIP_LABEL[target]}
    </button>
  );
}
