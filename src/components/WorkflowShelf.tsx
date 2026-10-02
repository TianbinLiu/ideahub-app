// 模板市场的「工作流」货架（模板体系 P2，2026-10-02）：上了架的公开配方，一张卡 = 一条已发布作品 + 它的制作过程摘要。
// 点进去是制作过程页（/video/:id/recipe —— 那一页就是工作流模板的模板页：示例视频 + 摘要 + 分镜 + 「按这个流程做同款」）。
//
// ★ 四档结局各说各的（data/recipes.fetchWorkflowTemplates）：有货 / 空 / 这台服务器没有这条货架 / 没问到（配重试）。
// ★ 这一层不认识 TemplateShelf 的筛选（出片模型 / 分类）：工作流模板的档位是逐段的、分类是作品的 —— 两套筛选硬套会筛错，
//   先按上架时间倒序摆出来；要筛再议（P3）。
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import EmptyState from "./EmptyState";
import Avatar from "./Avatar";
import Icon from "./Icon";
import { fetchWorkflowTemplates, type WorkflowShelf as ShelfState } from "../data/recipes";
import { tierLabelOf } from "./recipe/RecipeView";
import { authorDisplayName, remoteOn } from "../data/videos";
import { formatDuration } from "../types";

export default function WorkflowShelf() {
  const { t } = useLingui();
  const [shelf, setShelf] = useState<ShelfState | null>(null);
  const [nonce, setNonce] = useState(0);
  const online = remoteOn();
  useEffect(() => {
    if (!online) return;
    let on = true;
    setShelf(null);
    void fetchWorkflowTemplates({ fresh: nonce > 0 }).then((s) => {
      if (on) setShelf(s);
    });
    return () => {
      on = false;
    };
  }, [online, nonce]);

  if (!online) return <EmptyState emoji="📡" text={t`工作流模板在服务端，联网后再来看`} />;
  if (shelf === null) return <EmptyState loading text={t`正在取货架…`} />;
  if (shelf.state === "unsupported") return <EmptyState emoji="🔌" text={t`这台服务器还没有工作流模板的货架`} hint={t`等服务器更新后再来`} />;
  if (shelf.state === "failed") {
    return (
      <EmptyState error emoji="📡" text={t`没能取到货架（${shelf.why}）`} hint={t`换个网络再试一次`} cta={{ label: t`重试`, onClick: () => setNonce((n) => n + 1) }} />
    );
  }
  if (shelf.items.length === 0) {
    return (
      <EmptyState
        emoji="🧭"
        text={t`还没有人把制作过程上架到这里`}
        hint={t`发布作品时勾「同时上架到模板市场」，或在作品编辑页的「制作过程」里上架，这里就有了`}
      />
    );
  }
  return (
    <div className="space-y-3">
      {shelf.items.map((it) => (
        <Link
          key={it.video}
          to={`/video/${it.video}/recipe`}
          className="flex gap-3 rounded-xl border border-slate-700/70 bg-panel p-3 active:opacity-60"
        >
          <div className="h-24 w-[4.5rem] flex-none overflow-hidden rounded-lg bg-slate-900">
            {it.cover ? (
              <img src={it.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-600">
                <Icon name="branch" size={22} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-100">{it.title || t`无标题`}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Avatar
                name={it.author.username || it.author.displayName}
                label={authorDisplayName(it.author.displayName || it.author.username, it.author._id)}
                src={it.author.avatarUrl || undefined}
                size={16}
              />
              <span className="truncate">{authorDisplayName(it.author.displayName || it.author.username, it.author._id)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{t`${it.summary.segs} 段`}</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{formatDuration(it.summary.totalSec)}</span>
              {it.summary.tiers.length > 0 && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{it.summary.tiers.map(tierLabelOf).join(" / ")}</span>
              )}
              {it.summary.templated > 0 && (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">{t`${it.summary.templated} 段用了模板`}</span>
              )}
              {it.summary.slots > 0 && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{t`${it.summary.slots} 个空位`}</span>
              )}
            </div>
            {it.remixCount > 0 && <div className="mt-1 text-[10px] text-slate-500">{t`${it.remixCount} 人按这条的流程做了同款`}</div>}
          </div>
        </Link>
      ))}
      <p className="text-[11px] leading-relaxed text-slate-500">
        <Trans>工作流模板就是一条公开了制作过程的作品：点进去看每一段怎么做的，再按它铺成自己的流水线。</Trans>
      </p>
    </div>
  );
}
