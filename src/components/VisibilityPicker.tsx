// 作品可见性选择器：发布页与作品编辑页共用这一份（铁律六）。
//
// ★ 文案要说清楚**别人那边发生了什么**，而不是只给个开关名。
//   "仅自己可见"四个字看不出"别人搜也搜不到"还是"给了链接就能看"——
//   实际是前者：服务端对非作者一律 404（含列表、搜索、点赞、评论，见 api-contract.md）。
//   用户拿这个当"先存着别急着让人看"用，说清楚才敢用。
import Icon from "./Icon";
import type { Visibility } from "../types";

// ★ 类型从 types 取（那儿还有它与线上两个字段的映射，见 visibilityOf/visibilityWire 的 ★★）。
//   这里再定义一份的话，"三档"和"两个字段"的对应关系就有了第二处实现。
export type { Visibility };

const OPTIONS: { value: Visibility; icon: "play" | "lock" | "share"; label: string; hint: string }[] = [
  { value: "public", icon: "play", label: "公开", hint: "出现在首页、分区和搜索里，谁都能看" },
  // ★★ 「凭链接可见」这一档是给"先给几个人看看再决定"用的 —— 此前只有两极，
  //   而我们的 QQ/微信分享链路早就通了，等于有分享能力却没有对应的可见性。
  //   文案必须说清**两半**：不出现在哪儿、以及拿到链接的人能看 —— 少说后半句，
  //   用户会以为它和"仅自己可见"一样安全，然后把链接发出去。
  { value: "unlisted", icon: "share", label: "凭链接可见", hint: "不进首页和搜索；但拿到链接的人都能看，能被转发" },
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
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`rounded-xl border p-2.5 text-left transition ${
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
