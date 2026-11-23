// 对局面板里的一颗小键（商店的刷新 / 锁定…）。
// ★ 单独一份的理由：HUD / 商店 / 背包几个面板的键要长得一样（G4 删掉左右常驻条之后工坊里只剩这一套；
//   是给 15vw 边栏用的，尺寸与这里不同）；各面板各写一遍圆角/按下态，两版就会漂。
import type { ReactNode } from "react";

export default function GameBtn({
  onClick,
  children,
  tone = "normal",
  title,
  disabled,
  className = "",
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: "normal" | "primary" | "gold";
  /** 手机上 title 看不见，所以**点不动的理由**一律另有一句可见的字（别只靠它） */
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  const skin =
    tone === "primary"
      ? "bg-brand/20 text-brand-100 ring-brand/40 active:bg-brand/30"
      : tone === "gold"
        ? "bg-gold/20 text-gold-100 ring-gold/40 active:bg-gold/30"
        : "bg-white/[0.06] text-slate-200 ring-white/5 active:bg-white/[0.12]";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rounded-lg px-2 py-1 text-[11px] leading-tight ring-1 transition-colors disabled:opacity-40 ${skin} ${className}`}
    >
      {children}
    </button>
  );
}
