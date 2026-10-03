// 「公开配方」（制作过程）的几块共用视图：摘要行 / 分镜列表 / 卡与空位。
//
// 三个宿主共用（2026-10-02）：发布页「别人会看到这些」的预览、编辑页给存量作品补公开前的预览、
// 作品页点进来的制作过程页（RecipePage）。三处各画一份的话，"预览里有、真公开时却没有"这种事没人看得见。
//
// ★ 这里只画 data/recipe.WorkflowRecipe 这一个形状 —— 预览画的是本机刚投影出来的那份，制作过程页画的是服务端回来的那份，
//   两者同一个类型，所以这一层不认识画布、不认识 store。
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmtTokens, tierOf } from "../../data/economy";
import { recipeSummary, recipeVideoCost, type RecipeNode, type RecipeNodeFlag, type RecipeSlotWhy, type WorkflowRecipe } from "../../data/recipe";
import { CARD_TYPE_LABELS, formatDuration, shotLineDisplay } from "../../types";
import Icon from "../Icon";

/** 档位名：下线的档位（tierOf 兜底成默认档）按 id 原样印，别把「标准」印在一个根本不是标准档的段上 */
export function tierLabelOf(tier: string): string {
  const t = tierOf(tier);
  return t.id === tier ? t.label : tier;
}

export function slotWhyText(why: RecipeSlotWhy): string {
  switch (why) {
    case "real":
      return i18n._(msg`原作用的是声明过真实人物的卡，不随配方带走`);
    case "foreign":
      return i18n._(msg`原作用的是从别人那儿装来的卡，转发件不再分享`);
    case "private":
      return i18n._(msg`这张卡没能随配方带上`);
  }
}

export function flagText(flag: RecipeNodeFlag): string {
  switch (flag) {
    case "ref-video":
      return i18n._(msg`原作这一段上传了自己的参考视频（不随配方带走）`);
    case "mid-frames":
      return i18n._(msg`原作这一段另给过自己的参考图（不随配方带走）`);
    case "stage":
      return i18n._(msg`原作这一段用导演台摆过站位与机位（不随配方带走）`);
    case "anns":
      return i18n._(msg`原作这一段圈选改过画面（不随配方带走）`);
    case "revised":
      return i18n._(msg`原作这一段返修过`);
  }
}

/** 摘要一行：段数 · 总时长 · 档位 · 卡 / 空位 · 估价 */
export function RecipeSummaryRow({ recipe }: { recipe: WorkflowRecipe }) {
  const { t } = useLingui();
  const s = recipeSummary(recipe);
  const cost = recipeVideoCost(recipe);
  const chip = "rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300";
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={chip}>{t`${s.segs} 段`}</span>
      <span className={chip}>{formatDuration(s.totalSec)}</span>
      <span className={chip}>{s.tiers.map(tierLabelOf).join(" / ")}</span>
      <span className={chip}>{s.aspect === "portrait" ? t`竖屏` : s.aspect === "landscape" ? t`横屏` : t`横竖混排`}</span>
      {s.cards > 0 && <span className={chip}>{t`${s.cards} 张卡`}</span>}
      {s.slots > 0 && <span className={chip}>{t`${s.slots} 个空位`}</span>}
      {s.templated > 0 && <span className={chip}>{t`${s.templated} 段用了模板`}</span>}
      {/* 估价只报视频那一半（data/recipe.recipeVideoCost 的 ★），所以写「约」并点明不含什么 */}
      {cost !== null && <span className={chip}>{t`照做约 ${fmtTokens(cost)} token（不含推演与画面）`}</span>}
    </div>
  );
}

/** 一段 */
function NodeCard({ recipe, node, index, onTemplate }: { recipe: WorkflowRecipe; node: RecipeNode; index: number; onTemplate?: (id: string) => void }) {
  const { t } = useLingui();
  const cards = node.cards.map((id) => recipe.deck.find((c) => c.cardId === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const slots = node.slots.map((i) => recipe.cast[i]).filter(Boolean);
  const shot = shotLineDisplay(node.shot);
  const model = node.model && tierOf(node.tier).model !== node.model ? node.model : null;
  return (
    <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand text-[10px] font-bold text-ink">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-200">{node.title || t`第 ${index + 1} 段`}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span>{tierLabelOf(node.tier)}</span>
            <span>{t`${Math.round(node.durationSec)}s`}</span>
            <span>{node.aspect === "portrait" ? t`竖屏` : t`横屏`}</span>
            {node.chain && <span>{t`承接上一段尾帧`}</span>}
            {node.kind === "blockout" && <span className="text-sky-300">{t`白模复刻段`}</span>}
            {node.kind === "custom" && <span>{t`自定义直出`}</span>}
          </div>
        </div>
      </div>
      {(node.preview?.first || node.preview?.last) && (
        <div className="mt-2 flex gap-2">
          {node.preview.first && <img src={node.preview.first} alt="" className="h-16 w-auto max-w-[48%] rounded-lg object-cover" />}
          {node.preview.last && <img src={node.preview.last} alt="" className="h-16 w-auto max-w-[48%] rounded-lg object-cover" />}
        </div>
      )}
      {shot && <div className="mt-2 text-[11px] text-slate-400">{shot}</div>}
      {node.plot ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{node.plot}</p>
      ) : node.kind === "blockout" ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          <Trans>这一段按模板视频复刻，换成谁由挂上去的卡决定（原作的挂法不随配方带走）。</Trans>
        </p>
      ) : null}
      {node.tpl && (
        <button
          type="button"
          onClick={() => onTemplate?.(node.tpl!.id)}
          disabled={!onTemplate}
          className="mt-2 flex items-center gap-1.5 text-xs text-brand underline underline-offset-2 disabled:no-underline disabled:opacity-40"
        >
          <Icon name="grid" size={14} />
          {node.tpl.part ? t`模板「${node.tpl.title}」第 ${node.tpl.part.index + 1}/${node.tpl.part.count} 段` : t`模板「${node.tpl.title}」`}
        </button>
      )}
      {(cards.length > 0 || slots.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cards.map((c) => (
            <span key={c.cardId} className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
              {c.cover ? <img src={c.cover} alt="" className="h-3.5 w-3.5 rounded-full object-cover" /> : <Icon name="card" size={10} />}
              {c.name || CARD_TYPE_LABELS[c.type]}
            </span>
          ))}
          {slots.map((s, i) => (
            <span key={`s${i}`} className="rounded-full border border-dashed border-slate-600 px-2 py-0.5 text-[10px] text-slate-400">
              {s.name ? t`空位：${s.name}` : t`空位：${CARD_TYPE_LABELS[s.type]}`}
            </span>
          ))}
        </div>
      )}
      {node.flags.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[10px] leading-relaxed text-slate-500">
          {node.flags.map((f) => (
            <li key={f}>· {flagText(f)}</li>
          ))}
        </ul>
      )}
      {model && <div className="mt-1 text-[10px] text-slate-500">{t`当时的模型：${model}`}</div>}
    </div>
  );
}

/** 分镜列表 */
export function RecipeStoryboard({ recipe, onTemplate }: { recipe: WorkflowRecipe; onTemplate?: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {recipe.nodes.map((n, i) => (
        <NodeCard key={i} recipe={recipe} node={n} index={i} onTemplate={onTemplate} />
      ))}
    </div>
  );
}

/** 随配方带走的卡 + 要使用者自己填的空位 */
export function RecipeCast({ recipe }: { recipe: WorkflowRecipe }) {
  const { t } = useLingui();
  if (recipe.deck.length === 0 && recipe.cast.length === 0) return null;
  return (
    <div className="space-y-2">
      {recipe.deck.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          {recipe.deck.map((c) => (
            <div key={c.cardId} className="overflow-hidden rounded-xl border border-slate-700/70 bg-panel">
              <div className="aspect-[3/4] w-full bg-slate-900">
                {c.cover ? (
                  <img src={c.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-600">
                    <Icon name="card" size={24} />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <div className="truncate text-xs font-semibold text-slate-200">{c.name || CARD_TYPE_LABELS[c.type]}</div>
                <div className="text-[10px] text-slate-500">{CARD_TYPE_LABELS[c.type]}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {recipe.cast.length > 0 && (
        <ul className="space-y-1">
          {recipe.cast.map((s, i) => (
            <li key={i} className="rounded-lg border border-dashed border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-400">
              <span className="text-slate-300">{s.name ? t`空位 ${i + 1}：${s.name}（${CARD_TYPE_LABELS[s.type]}）` : t`空位 ${i + 1}：${CARD_TYPE_LABELS[s.type]}`}</span>
              <span className="block text-[10px] text-slate-500">{slotWhyText(s.why)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 「不会带走的东西」—— 预览与制作过程页都要把脱敏规则说出来（data/recipe 文件头那几条） */
export function RecipeExcludedNote() {
  return (
    <p className="text-[11px] leading-relaxed text-slate-500">
      <Trans>不会公开：你的原话（每段的要求）、没选中的方案、圈选标注、导演台、上传的参考视频、出片日志、卡上的 3D 建模与生成提示词；声明过真实人物的卡与从别人那儿装来的卡只留一个空位。成片本身另按作品的可见范围走。</Trans>
    </p>
  );
}
