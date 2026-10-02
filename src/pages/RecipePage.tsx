// 制作过程页（公开配方，2026-10-02）：/video/:id/recipe —— 作品页「查看制作过程」点进来。
//
// 画的是服务端回来的 WorkflowRecipe（data/recipe，作者公开时从画布投出来的白名单形状）：摘要 / 逐段分镜 / 随配方带走的卡与空位，
// 底下一颗「按这个流程做同款」：选角（原作的卡用不用、空位填谁）→ 铺成自己的流水线 → /flow。
//
// ★ 读回来的结局四档各说各的话（data/recipes.fetchRecipe 的 ★）：没公开 / 作品没了 / 这台服务器没有这个端点 / 没问到，
//   「没问到」永远单列一句并配重试。
// ★ 「按这个流程做同款」是第九条整表换 nodes 的入口：守卫走 useApplyTemplate（先问脏 / 成了再断草稿 / 在途不换），
//   建料走 flowStore.recipeNodesOf（纯函数），铺走 seed（canReplaceNodes 在那里把门）。白模段要的模板在这一页**先取**（服务端 id），
//   取不到的那一段由 recipeNodesOf 退成普通段并记在 notes 里，铺完当面说。
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Avatar from "../components/Avatar";
import Sheet from "../components/Sheet";
import { CloseButton } from "../components/IconTapButton";
import Icon from "../components/Icon";
import { RecipeCast, RecipeExcludedNote, RecipeStoryboard, RecipeSummaryRow } from "../components/recipe/RecipeView";
import { useApplyTemplate } from "../components/flow/useApplyTemplate";
import { useBackOr } from "../hooks/useBackOr";
import { useAccountVersion } from "../hooks/useAccount";
import { myCards } from "../data/account";
import { fetchRecipe, type RecipeFetch } from "../data/recipes";
import type { RecipeCard, WorkflowRecipe } from "../data/recipe";
import { fetchRemoteTemplateById, getTemplate } from "../data/templates";
import { showToast } from "../data/toast";
import { authorDisplayName } from "../data/videos";
import { recipeNodesOf, useFlow, type RecipePicks } from "../studio/flowStore";
import { CARD_TYPE_LABELS, type Card, type VideoTemplate } from "../types";

/** 随配方带来的卡 → 本机 Card 形状（只挂在节点上当素材，不进卡库）。★ fromOthers：这是别人的卡 —— 再发布时它只会变成空位、不会被二次分享 */
function cardOfRecipe(c: RecipeCard): Card {
  return {
    id: c.cardId,
    type: c.type,
    name: c.name,
    summary: c.summary,
    cover: c.cover,
    ...(c.tags.length ? { tags: c.tags } : {}),
    ...(c.idLine ? { idLine: c.idLine } : {}),
    ...(c.textDesc ? { textDesc: c.textDesc } : {}),
    ...(c.startFrames ? { startFrames: c.startFrames } : {}),
    ...(c.views.length ? { views: c.views } : {}),
    fromOthers: true,
  };
}

export default function RecipePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const back = useBackOr(`/video/${id}`);
  const { t } = useLingui();
  const [res, setRes] = useState<RecipeFetch | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let on = true;
    setRes(null);
    void fetchRecipe(id, { fresh: nonce > 0 }).then((r) => {
      if (on) setRes(r);
    });
    return () => {
      on = false;
    };
  }, [id, nonce]);

  // ── 做同款 ──
  const [castOpen, setCastOpen] = useState(false);
  const [useDeck, setUseDeck] = useState(true);
  const [slotPick, setSlotPick] = useState<Record<number, string>>({});
  const [building, setBuilding] = useState("");
  const [buildErr, setBuildErr] = useState("");
  const { guard, dialog } = useApplyTemplate();
  useAccountVersion();
  const mine = myCards();

  const recipe: WorkflowRecipe | null = res?.state === "ok" ? res.data.recipe : null;
  const tplIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of recipe?.nodes ?? []) if (n.kind === "blockout" && n.tpl) ids.add(n.tpl.id);
    return [...ids];
  }, [recipe]);

  async function build() {
    if (!recipe || building) return;
    setBuildErr("");
    // 白模段的模板：本机库有就用，没有就按服务端 id 现取一次（取不到 = null，那一段退成普通段，notes 里说）
    const templates: Record<string, VideoTemplate | null> = {};
    if (tplIds.length) {
      setBuilding(t`正在取段模板…`);
      for (const tid of tplIds) {
        let tpl = getTemplate(tid);
        if (!tpl && (await fetchRemoteTemplateById(tid))) tpl = getTemplate(tid);
        templates[tid] = tpl;
      }
      setBuilding("");
    }
    const slotCards: Record<number, Card> = {};
    for (const [k, cid] of Object.entries(slotPick)) {
      const c = mine.find((x) => x.id === cid);
      if (c) slotCards[Number(k)] = c;
    }
    const picks: RecipePicks = { cards: useDeck ? recipe.deck.map(cardOfRecipe) : [], slotCards, templates };
    const meta = res?.state === "ok" ? res.data.meta : null;
    guard(
      () => {
        const built = recipeNodesOf(recipe, picks);
        const ok = useFlow.getState().seed(built.nodes, {
          mode: "workflow",
          origin: "solo",
          remixOf: { videoId: id, title: meta?.title ?? "", author: meta?.author.displayName || meta?.author.username || "" },
        });
        if (!ok) {
          setBuildErr(useFlow.getState().err || t`现在铺不了（可能有一段正在生成中），稍后再试`);
          return false;
        }
        setCastOpen(false);
        // 与原作不一样的地方当面说（模板取不到 / 档位下线 / 模型换代），别悄悄铺完
        if (built.notes.length) showToast(built.notes.join("；"), 6000);
        navigate("/flow");
        return true;
      },
      {
        label: t`按这个流程做同款（丢弃上面那条流水线）`,
        noun: t({ message: "做同款", context: "丢弃确认卡里「…再回来X」的那个动作（英文用小写动词短语）" }),
      },
    );
  }

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset onBack={back} title={t`制作过程`} />
      {res === null ? (
        <EmptyState loading text={t`正在取制作过程…`} />
      ) : res.state === "unsupported" ? (
        <EmptyState emoji="🔌" text={t`这台服务器还不支持公开制作过程`} hint={t`等服务器更新后再来`} />
      ) : res.state === "failed" ? (
        <EmptyState
          error
          emoji="📡"
          text={t`没能取到制作过程（${res.why}）`}
          hint={t`换个网络再试一次`}
          cta={{ label: t`重试`, onClick: () => setNonce((n) => n + 1) }}
        />
      ) : res.state === "none" ? (
        res.code === "NOT_FOUND" ? (
          <EmptyState emoji="🫥" text={t`作品不存在或已删除`} />
        ) : res.code === "RECIPE_NOT_PUBLIC" ? (
          <EmptyState emoji="🔒" text={t`作者没有公开这条作品的制作过程`} hint={t`作品页仍然可以「做同款」：那是抄分段剧本，不含卡与段模板`} />
        ) : (
          <EmptyState emoji="📭" text={t`这条作品没有留存制作过程`} />
        )
      ) : (
        <div className="space-y-4">
          {/* 示例视频（这一页就是工作流模板的模板页：示例视频 = 那条作品本身，点进去看成片）。封面没有就不摆，别摆一块黑 */}
          {res.data.meta.cover && (
            <Link to={`/video/${id}`} className="relative block overflow-hidden rounded-xl bg-slate-900 active:opacity-60">
              <img src={res.data.meta.cover} alt="" className="aspect-video w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
                  <Icon name="play" size={22} />
                </span>
              </span>
              <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-slate-100"><Trans>示例视频 · 看成片</Trans></span>
              {res.data.meta.listed && (
                <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-ink"><Trans>模板市场 · 工作流</Trans></span>
              )}
            </Link>
          )}
          {/* 谁的作品 */}
          <Link to={`/video/${id}`} className="flex items-center gap-2.5 rounded-xl border border-slate-700/70 bg-panel p-3 active:opacity-60">
            <Avatar
              name={res.data.meta.author.username || res.data.meta.author.displayName}
              label={authorDisplayName(res.data.meta.author.displayName || res.data.meta.author.username, res.data.meta.author._id)}
              src={res.data.meta.author.avatarUrl || undefined}
              size={36}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-100">{res.data.meta.title || t`无标题`}</span>
                {/* 上了架的（工作流模板）：没有封面时徽标也要有地方落 */}
                {res.data.meta.listed && !res.data.meta.cover && (
                  <span className="flex-none rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-ink"><Trans>模板市场 · 工作流</Trans></span>
                )}
              </div>
              <div className="text-[11px] text-slate-500">
                <Trans>@{authorDisplayName(res.data.meta.author.displayName || res.data.meta.author.username, res.data.meta.author._id)} 公开的制作过程</Trans>
              </div>
            </div>
          </Link>
          {/* 作者本人不公开也读得到（服务端按 isOwner 放行）—— 这一行要按真实状态说，别对着一份已经关掉的说"你公开的" */}
          {res.data.meta.isOwner && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              {res.data.meta.public && !res.data.meta.stale ? (
                <Trans>这是你公开的制作过程；到<Link to={`/edit/${id}`} className="text-brand underline underline-offset-2">编辑页</Link>可以关闭或删除。</Trans>
              ) : (
                <Trans>这份制作过程现在没有公开，只有你看得到；到<Link to={`/edit/${id}`} className="text-brand underline underline-offset-2">编辑页</Link>可以公开。</Trans>
              )}
            </p>
          )}
          <RecipeSummaryRow recipe={res.data.recipe} />
          <section>
            <div className="mb-2 text-sm font-semibold text-slate-300"><Trans>分镜</Trans></div>
            <RecipeStoryboard recipe={res.data.recipe} onTemplate={(tid) => navigate(`/template/${tid}`)} />
          </section>
          {(res.data.recipe.deck.length > 0 || res.data.recipe.cast.length > 0) && (
            <section>
              <div className="mb-2 text-sm font-semibold text-slate-300"><Trans>卡与空位</Trans></div>
              <RecipeCast recipe={res.data.recipe} />
            </section>
          )}
          <RecipeExcludedNote />
          <button
            onClick={() => {
              setBuildErr("");
              setCastOpen(true);
            }}
            className="w-full rounded-xl bg-gold/90 py-2.5 text-sm font-bold text-ink active:scale-[0.99]"
          >
            <Trans>⚡ 按这个流程做同款</Trans>
          </button>
          <p className="text-[11px] leading-relaxed text-slate-500">
            <Trans>会把这 {res.data.recipe.nodes.length} 段铺成你自己的工作流（不带原作的画面与成片），之后一段一结账，铺开不花钱。</Trans>
          </p>
          {buildErr && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">{buildErr}</div>
          )}
        </div>
      )}
      {dialog}

      {/* 选角：原作的卡用不用、空位填谁（都可以留空，铺完在画布上照样能挂） */}
      {castOpen && recipe && (
        <Sheet onClose={() => setCastOpen(false)}>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-100"><Trans>先选角</Trans></div>
            <CloseButton chip="sm" size={13} align="end" onClick={() => setCastOpen(false)} />
          </div>
          {recipe.deck.length > 0 && (
            <button
              onClick={() => setUseDeck((v) => !v)}
              className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left ${useDeck ? "border-brand/40 bg-brand/5" : "border-slate-700 bg-panel"}`}
            >
              <span className={`mt-0.5 flex-none text-base ${useDeck ? "text-brand" : "text-slate-500"}`}>{useDeck ? "☑" : "☐"}</span>
              <span className="text-xs leading-relaxed text-slate-300">
                <Trans>用原作带来的 {recipe.deck.length} 张卡</Trans>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  {useDeck ? t`照原作的卡挂在各段上；之后在画布上随时能换成自己的。` : t`各段不挂原作的卡，之后自己挂。`}
                </span>
              </span>
            </button>
          )}
          {recipe.cast.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>空位（原作没能带走的卡）</Trans></div>
              <div className="space-y-2">
                {recipe.cast.map((s, i) => {
                  const options = mine.filter((c) => c.type === s.type);
                  return (
                    <div key={i} className="rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2">
                      <div className="text-[11px] text-slate-300">
                        {s.name ? t`空位 ${i + 1}：${s.name}（${CARD_TYPE_LABELS[s.type]}）` : t`空位 ${i + 1}：${CARD_TYPE_LABELS[s.type]}`}
                      </div>
                      <select
                        value={slotPick[i] ?? ""}
                        onChange={(e) => setSlotPick((m) => ({ ...m, [i]: e.target.value }))}
                        className="mt-1.5 w-full rounded-lg border border-slate-700 bg-ink px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-brand"
                      >
                        <option value="">{options.length ? t`先空着（之后在画布上挂）` : t`你还没有这一类的卡——先空着`}</option>
                        {options.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {recipe.deck.length === 0 && recipe.cast.length === 0 && (
            <p className="text-xs leading-relaxed text-slate-400"><Trans>这条流程没有带卡，也没有空位 —— 直接铺开，之后在画布上挂自己的卡。</Trans></p>
          )}
          {buildErr && (
            <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">{buildErr}</div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setCastOpen(false)} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700">
              <Trans>取消</Trans>
            </button>
            <button onClick={() => void build()} disabled={!!building} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">
              {building || t`铺成我的工作流`}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
