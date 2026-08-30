// 话题标签输入 —— 发布页与作品编辑页共用的**唯一一份**。
//
// ★ 为什么抽成组件：这块有四条必须一致的规则（上限 20 个、单个 40 字、去重、去掉前导 #），
//   而它要出现在两页上。抄两份的必然结果是"发布时拦得住、编辑时拦不住"，
//   而编辑那条会直接撞服务端 400（server 的 zod 与这两个数逐字相等，那边有用例钉着）。
// ★ 上限只有一处：types.VIDEO_TAGS_MAX / VIDEO_TAG_LEN，规范化只有一处：normalizeTag。
//
// ★ 分区只有 6 个固定值，长尾内容（"雨夜""赛博朋克""国风水墨"）没有落点 —— 标签就是
//   给它们准备的。所以这里的措辞是"让别人搜得到"，不是"给内容分类"。
import { useState } from "react";

export default function TagInput({
  tags,
  onChange,
  max,
  maxLen,
  split,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLen: number;
  /** 「一串字 → 若干标签」。**只准传 types.parseTags**：分隔符规则全 app 一处 */
  split: (raw: string, opts: { max: number; maxLen: number }) => string[];
}) {
  const [draft, setDraft] = useState("");
  const full = tags.length >= max;

  function add(raw: string) {
    setDraft("");
    if (full) return;
    // ★ 走共用的切分：用户经常一口气粘 "#雨夜 #赛博朋克 #国风"，
    //   一次只收一条的话后面那些会被当成一个超长标签截掉一半（零报错）
    const fresh = split(raw, { max, maxLen }).filter((t) => !tags.includes(t));
    if (fresh.length === 0) return; // 重复/空的静默忽略：用户的意图已经达成了
    onChange([...tags, ...fresh].slice(0, max));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2.5 py-1 text-[12px] text-brand"
          >
            #{t}
            <button
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-brand/70 hover:text-brand"
              aria-label={`删掉标签 ${t}`}
            >
              ✕
            </button>
          </span>
        ))}
        {!full && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 回车/逗号/空格都收一条：手机输入法上回车最顺手，而习惯打 "#科幻 #雨夜" 的
              // 人按的是空格 —— 两种都认，别逼用户学我们的规矩
              if (e.key === "Enter" || e.key === "," || e.key === "，" || e.key === " ") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && tags.length > 0) {
                onChange(tags.slice(0, -1));
              }
            }}
            // ★ 失焦也收：手机上填完直接去点「发布」的人不会先按回车，
            //   不收的话他打的那条标签会凭空消失（而且他多半不会发现）
            onBlur={() => add(draft)}
            // ★ **不设 maxLength={maxLen}**（复核抓到）：那会把整条草稿截到单个标签的长度，
            //   于是上面 add() 里"一口气粘一串"的处理**永远走不到** —— 粘 "#雨夜 #赛博朋克"
            //   会被浏览器当场截成 10 个字符，尾巴静默丢掉。长度是**每条标签**的上限，
            //   由 split()（types.parseTags）逐条切，不是草稿框的上限。
            //   这里给一个只防"粘进一整篇文章"的宽上限。
            maxLength={maxLen * max * 2}
            placeholder={tags.length === 0 ? "加个话题，让人搜得到（回车分隔）" : "再加一个"}
            className="min-w-[9rem] flex-1 rounded-xl border border-slate-700 bg-panel px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {full ? `最多 ${max} 个，已经满了` : `最多 ${max} 个，每个 ${maxLen} 字以内 · 已加 ${tags.length} 个`}
      </p>
    </div>
  );
}
