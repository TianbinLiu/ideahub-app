// 模板详情页：封面 + 简介 + 生成配方（画风/分镜骨架）+ 自带素材卡 + 互动区。
//
// 配方是明着给的，不藏——用户看得见"为什么这个模板出片像"，才知道该不该用它，
// 也才能照着改出自己的版本。这与卡片详情页展示「生成蓝图」是同一个主张。
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import Icon from "../components/Icon";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import { useTemplatesVersion } from "./TemplateMarketPage";
import { deleteTemplate, getTemplate, myTemplates, updateTemplate } from "../data/templates";
import { useCurrentUser } from "../hooks/useAccount";
import { useFlow } from "../studio/flowStore";
import { CARD_TYPE_LABELS, VideoTemplate } from "../types";

/** 作者本人才能看到的发布/改名区。发布 = 进模板市场供别人使用 */
function OwnerBar({ t }: { t: VideoTemplate }) {
  const nav = useNavigate();
  const [title, setTitle] = useState(t.title);
  const [intro, setIntro] = useState(t.intro);
  const dirty = title !== t.title || intro !== t.intro;
  return (
    <div className="mt-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-2 text-xs font-semibold text-slate-300">✎ 模板信息（只有你能改）</div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="模板名"
        className="mb-2 w-full rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
      />
      <textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        rows={2}
        placeholder="一句话说明这个模板能做什么样的片子"
        className="mb-2 w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
      />
      <div className="flex gap-2">
        <button
          onClick={() => updateTemplate(t.id, { title: title.trim() || t.title, intro: intro.trim() })}
          disabled={!dirty}
          className="rounded-full bg-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-40"
        >
          保存
        </button>
        <button
          onClick={() => updateTemplate(t.id, { published: !t.published })}
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${t.published ? "bg-slate-700 text-slate-200" : "bg-brand text-ink"}`}
        >
          {t.published ? "取消发布" : "发布到模板市场"}
        </button>
        <button
          onClick={() => {
            deleteTemplate(t.id);
            nav("/templates");
          }}
          className="ml-auto rounded-full px-3 py-1.5 text-xs text-rose-400"
        >
          删除
        </button>
      </div>
      {t.published && <p className="mt-2 text-[10px] text-slate-500">已在模板市场公开，别人可以直接套用出片。</p>}
    </div>
  );
}

export default function TemplateDetailPage() {
  useTemplatesVersion();
  useSocialVersion();
  const { id } = useParams();
  const nav = useNavigate();
  const user = useCurrentUser();
  useCountView("template", id);
  const t = id ? getTemplate(id) : null;

  if (!t) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
        <Icon name="cards" size={40} className="text-slate-600" />
        <p className="text-sm text-slate-400">这个模板不存在或已被作者删除</p>
        <Link to="/templates" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          去模板市场
        </Link>
      </div>
    );
  }

  const isMine = myTemplates().some((x) => x.id === t.id) && user?.name === t.author;

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">模板详情</h1>
        {!t.published && isMine && (
          <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">未发布</span>
        )}
      </div>

      <div className="mb-3 overflow-hidden rounded-2xl bg-black/40">
        {t.cover && <img src={t.cover} alt="" className="aspect-[16/10] w-full object-cover" />}
      </div>

      <h2 className="text-lg font-bold text-slate-100">{t.title}</h2>
      <div className="mt-0.5 mb-2 text-xs text-slate-500">
        @{t.author} · {t.recipe.beats.length} 段 · 每段 {t.recipe.durationSec}s
      </div>
      <p className="mb-4 text-sm leading-relaxed text-slate-300">{t.intro}</p>

      <button
        onClick={() => {
          useFlow.getState().applyTemplate(t);
          nav("/flow");
        }}
        className="mb-4 block w-full rounded-xl bg-brand py-3 text-center text-sm font-bold text-ink"
      >
        ⚡ 用这个模板出片（只需一句话）
      </button>

      {/* 生成配方：明着给，用户才知道它为什么像，也才能照着改 */}
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-2 text-xs font-semibold text-slate-300">🧪 生成配方</div>
        <div className="mb-2">
          <div className="mb-1 text-[11px] text-slate-500">画面质感与运镜</div>
          <p className="text-xs leading-relaxed text-slate-400">{t.recipe.styleHint}</p>
        </div>
        <div className="mb-2">
          <div className="mb-1 text-[11px] text-slate-500">分镜骨架（{"{{主题}}"} 会换成你那句话）</div>
          <ol className="space-y-1">
            {t.recipe.beats.map((b, i) => (
              <li key={i} className="rounded-lg bg-black/25 px-2.5 py-1.5 text-xs leading-relaxed text-slate-300">
                <span className="mr-1.5 text-slate-500">{i + 1}.</span>
                {b}
              </li>
            ))}
          </ol>
        </div>
        {t.source && (
          <div>
            <div className="mb-1 text-[11px] text-slate-500">参考画面特征</div>
            <p className="text-xs leading-relaxed text-slate-500">{t.source}</p>
          </div>
        )}
      </div>

      {t.cards.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold text-slate-300">🎴 模板卡组 · {t.cards.length} 张</div>
          <div className="grid grid-cols-3 gap-2">
            {t.cards.map((c) => (
              <Link key={c.id} to={`/card/${c.id}`} state={{ card: c }}>
                <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {isMine && <OwnerBar t={t} />}

      <SocialPanel kind="template" id={t.id} />
    </div>
  );
}
