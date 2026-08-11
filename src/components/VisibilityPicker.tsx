// 作品可见性选择器：发布页与作品编辑页共用这一份（铁律六）。
//
// ★ 文案要说清楚**别人那边发生了什么**，而不是只给个开关名。
//   "仅自己可见"四个字看不出"别人搜也搜不到"还是"给了链接就能看"——
//   实际是前者：服务端对非作者一律 404（含列表、搜索、点赞、评论，见 api-contract.md）。
//   用户拿这个当"先存着别急着让人看"用，说清楚才敢用。
import Icon from "./Icon";

export type Visibility = "public" | "private";

const OPTIONS: { value: Visibility; icon: "play" | "lock"; label: string; hint: string }[] = [
  { value: "public", icon: "play", label: "公开", hint: "出现在首页、分区和搜索里，谁都能看" },
  { value: "private", icon: "lock", label: "仅自己可见", hint: "只有你能看到；别人拿到链接也打不开" },
];

export default function VisibilityPicker({
  value,
  onChange,
  className = "",
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-sm font-semibold text-slate-300">谁能看到</div>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`rounded-xl border p-3 text-left transition ${
                on ? "border-brand bg-brand/10" : "border-slate-700 bg-panel hover:border-slate-600"
              }`}
            >
              <div className={`flex items-center gap-1.5 text-sm font-bold ${on ? "text-brand" : "text-slate-300"}`}>
                <Icon name={o.icon} size={13} filled={o.value === "public"} />
                {o.label}
              </div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{o.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
