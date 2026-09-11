// 玩家形象选择：男/女两张 3D 渲染立卡，选定后场景第一人称手臂随之切换
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useStudio } from "../studioStore";
import type { PlayerAvatar } from "../quality";

/** 名字 / 说明：正式两档是描述符（渲染时再翻）；DEV 试穿档写死中文（不入包，也不进目录） */
const OPTIONS: Array<{ key: PlayerAvatar; name: MessageDescriptor | string; desc: MessageDescriptor | string; img: string }> = [
  { key: "f", name: msg`见习冒险家 · 她`, desc: msg`酒红斗篷 · 绿金束身裙`, img: "/avatars/player-f-preview.webp" },
  { key: "m", name: msg`青年牌手 · 他`, desc: msg`藏蓝长外套 · 金滚边`, img: "/avatars/player-m-preview.webp" },
];
// 本地开发试穿档：第三方移植模型，仅 DEV 构建可见（资产走加密 gitignore 目录 + 出包裁剪）
if (import.meta.env.DEV) {
  OPTIONS.push(
    // i18n-ignore-next-line: 仅 DEV 构建可见的本地试穿档，不入包
    { key: "rin", name: "远坂凛 · 试穿", desc: "本地开发档 · 不入包", img: "/models/protected/rin-preview.webp" },
    // i18n-ignore-next-line: 同上，DEV 试穿档
    { key: "gratia", name: "Gratia · 试穿", desc: "本地开发档 · 不入包", img: "/models/protected/gratia-preview.webp" },
    // i18n-ignore-next-line: 同上，DEV 试穿档
    { key: "tsumire", name: "Tsumire · 猫耳", desc: "本地开发档 · 不入包", img: "/models/protected/tsumire-preview.webp" },
  );
}

export default function AvatarPicker() {
  const open = useStudio((s) => s.avatarPickerOpen);
  const setOpen = useStudio((s) => s.setAvatarPickerOpen);
  const avatar = useStudio((s) => s.playerAvatar);
  const setAvatar = useStudio((s) => s.setPlayerAvatar);
  const { t } = useLingui();
  if (!open) return null;
  const label = (v: MessageDescriptor | string) => (typeof v === "string" ? v : t(v));
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={() => setOpen(false)}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-ink p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-center text-sm font-bold text-slate-100"><Trans>选择你的形象</Trans></div>
        <div className="mb-4 text-center text-xs text-slate-400"><Trans>决定牌桌上属于你的那双手</Trans></div>
        <div className="grid grid-cols-2 gap-3">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                setAvatar(o.key);
                setOpen(false);
              }}
              className={`overflow-hidden rounded-xl border-2 text-left transition ${
                avatar === o.key ? "border-brand shadow-lg shadow-brand/20" : "border-white/10 hover:border-white/30"
              }`}
            >
              <div className="aspect-square w-full bg-ink/60">
                <img src={o.img} alt={label(o.name)} className="h-full w-full object-cover" />
              </div>
              <div className="p-2.5">
                <div className="text-sm font-medium text-slate-100">{label(o.name)}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{label(o.desc)}</div>
                {avatar === o.key && <div className="mt-1 text-[11px] font-medium text-brand"><Trans>当前形象 ✓</Trans></div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
