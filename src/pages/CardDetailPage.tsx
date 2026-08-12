// 卡片详情页：大卡面 + 类型/标签 + 简介 + 形象参考图（多图）+ 生成蓝图
// （具体到可复刻卡面的完整提示词）+ 3D 建模全息预览（有 modelUrl 的角色卡）。
// 创意工坊/我的/卡组详情点卡进来。
import { useRef, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import Icon from "../components/Icon";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import CardHologram, { CARD_MODELS, useHologramModel } from "../studio/ui/CardHologram";
import { isRemoteMode, myCards, myDecks, shareCard } from "../data/account";
import { addCardView, removeCardView } from "../data/cardViews";
import { formatHeat, heatOf } from "../data/social";
import {
  CARD_TYPE_COLORS,
  CARD_TYPE_LABELS,
  Card,
  CardView,
  MAX_CARD_VIEWS,
  publishableModelUrl,
  viewsOf,
} from "../types";
import { useAccountVersion } from "../hooks/useAccount";

/** 老卡/素材卡没存生成蓝图时，按派生管线同款格式现场拼一份——照着它就能复刻同风格卡面 */
function blueprintOf(card: Card): string {
  if (card.genPrompt) return card.genPrompt;
  const label: Record<Card["type"], string> = {
    character: "人物立绘卡面",
    scene: "场景概念图卡面",
    background: "氛围底色卡面",
    prop: "道具特写卡面",
    style: "画风示意卡面",
  };
  const tags = card.tags?.length ? `关键词：${card.tags.join("、")}。` : "";
  return `${label[card.type]}：${card.name}。${card.summary}${tags}二次元厚涂插画风，高细节，电影感构图，氛围光，无文字无水印。竖版 3:4 卡面。`;
}

/**
 * 分享前必须先说清楚的那句话：这张卡的 3D 建模能不能跟着走。
 *
 * ★ 不说的话就是骗人：卡片详情页把「全息实体 3D 建模」当卖点画在最上面，
 *   而工坊里现炼的建模是 `idb:model3d:*`——**这台设备**的 IndexedDB 指针，
 *   别人拿到就是个死链。判据收在 types.ts 的 publishableModelUrl 一处
 *   （服务端还有一份权威的同规则，见那边的注释）。
 * ★ 这里只剩"能分享，但建模带不走"这一档**提醒**。「第三方版权模型」那一档是
 *   **拦截**，归 shareBlockReason 管（写在这儿的话按钮还是亮的，按下去必然 400）。
 */
function shareModelNote(card: Card): string | null {
  const raw = card.modelUrl;
  if (!raw) return null;
  if (publishableModelUrl(raw)) return null;
  return "注意：这张卡的 3D 建模只存在这台设备上，分享出去的那份不会带建模。";
}

// ── 形象参考图（多图参考）─────────────────────────────────────────
//
// 这几张图是**喂给 AI 的**，不是相册：推演三套方案时它们被当作 Seedream 的参考图，
// 人物形象因此被烤进首尾帧，出片再按首尾帧拍（见 ai/real.prepareMaterialRefs）。
// 所以这一块的文案要说"AI 会怎么用"，不能只当图库摆着。

const KIND_LABEL: Record<CardView["kind"], string> = { face: "面部特写", body: "全身/主视图", detail: "细节" };

/**
 * 加图时能选哪几种，按卡种给。
 * ★ 人物卡只给「面部特写 / 全身」两种，**不给"多角度"这种引导**：方舟提示词指南原文
 *   「人物参考使用大头照 + 全身照即可，不建议使用人物多视图。多视图素材包含同一人物的
 *   不同角度，模型易将其识别为多个不同主体，反而加剧 ID 漂移问题。」
 *   道具/场景卡没有这个问题（它们不是"主体身份"），所以给「主视图 / 细节」。
 */
function kindsFor(type: Card["type"]): Array<CardView["kind"]> {
  return type === "character" ? ["face", "body"] : ["body", "detail"];
}

function hintFor(type: Card["type"]): string {
  return type === "character"
    ? "AI 画这一段的首尾帧时会照着这些图锁人物形象。放「面部特写 + 全身」各一张就够 —— 同一个人的多角度视图反而会被模型当成好几个人，越堆越不像。"
    : "AI 画这一段的首尾帧时会照着这些图还原它的造型与配色。不同角度、不同细节都可以放。";
}

function CardViewsSection({ card, owned }: { card: Card; owned: boolean }) {
  const views = viewsOf(card);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<CardView["kind"]>("body");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [zoom, setZoom] = useState<number | null>(null);

  // ★★ "要不要画成图库"的判据是**卡上有没有真的挂图**（`card.views` 非空），
  //   不是 viewsOf() 的长度。两者只在一种情况下不同，而那种情况恰好会丢东西：
  //   用户挂了 3 张、删到只剩 1 张自己传的照片时 viewsOf() 长度也是 1 ——
  //   按长度判就把那张图藏了，它既看不见也点不开、更删不掉（放大层是唯一的删除入口）。
  //   老卡兜底出来的那一张则相反：它就是上面的大卡面，重复摆一遍是个空功能。
  const hung = Array.isArray(card.views) && card.views.length > 0;

  // 兜底那一张（= 没真挂过图）时，只在"我能往里加图"的前提下画整块：
  //   ① 别人的卡：加不了图，那一张又是大卡面，整块就是个空功能；
  //   ② 离线模式：加不了图（views 只收永久 URL，本地没有服务器可转存），
  //      摆一个永远点不动的入口是本仓明令禁止的（CLAUDE.md「极致画质」那条）。
  if (!hung && (!owned || !isRemoteMode())) return null;

  const full = views.length >= MAX_CARD_VIEWS;
  const gallery = hung;

  const pick = (kind: CardView["kind"]) => {
    kindRef.current = kind;
    setErr("");
    setNote("");
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setErr("");
    setNote("");
    try {
      const res = await addCardView(card.id, file, kindRef.current);
      if (res.note) setNote(res.note);
    } catch (e) {
      // ★ 失败必须显示。这条路会走网络（转存 + 同步），catch 后不响的话用户看到的是
      //   "点了没反应"，还会以为图加上了（铁律八：全 app 没有地方监听 emitApiError）
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (i: number) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    setNote("");
    try {
      await removeCardView(card.id, i);
      setZoom(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">
          🖼 形象参考{gallery ? `（${views.length}/${MAX_CARD_VIEWS}）` : ""}
        </span>
        {/* ★ 离线模式**明说做不了**，而不是摆一排点了就报错的按钮：这些图必须先转存成
            永久地址才能给 AI 用（views 不收 dataURL），而离线模式没有服务器可转存。
            摆一个永远点不动的选项是本仓明令禁止的（CLAUDE.md「极致画质」那条）。 */}
        {owned && !isRemoteMode() && <span className="text-[10px] text-slate-500">离线模式下加不了参考图</span>}
        {owned && isRemoteMode() && !full && (
          <div className="flex gap-1.5">
            {kindsFor(card.type).map((k) => (
              <button
                key={k}
                disabled={busy}
                onClick={() => pick(k)}
                className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-50"
              >
                + {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {gallery && (
        // 横滑小图：宽内容必须自己滚，别让整页横向滚（见 CLAUDE.md 底缘那几条的同类教训）
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {views.map((v, i) => (
            <button
              key={`${v.url}#${i}`}
              onClick={() => setZoom(i)}
              className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-ink/60"
            >
              <img src={v.url} alt={KIND_LABEL[v.kind]} className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute inset-x-0 bottom-0 bg-ink/75 py-0.5 text-center text-[9px] text-slate-300">
                {KIND_LABEL[v.kind]}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{hintFor(card.type)}</p>
      {owned && full && (
        <p className="mt-1 text-[10px] text-slate-500">
          已到 {MAX_CARD_VIEWS} 张上限 —— 方舟建议不要堆满，素材太多模型反而判断不出该优先保哪些特征。
        </p>
      )}
      {note && <p className="mt-1 text-[11px] text-amber-400">{note}</p>}
      {err && <p className="mt-1 text-[11px] text-rose-400">{err}</p>}
      {busy && <p className="mt-1 text-[11px] text-slate-400">处理中…</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 同一张图连选两次也要能触发
          void onFile(f);
        }}
      />

      {/* ★ 必须 portal 到 body：这一页的祖先里有 backdrop-blur / transform 的容器，
          它们会给 position:fixed 后代造包含块，`inset-0` 于是只铺满那个盒子。
          评论抽屉与首尾帧放大层都栽过这一条（CLAUDE.md 有记）。 */}
      {zoom !== null &&
        views[zoom] &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/90 p-6"
            onClick={() => setZoom(null)}
          >
            <img src={views[zoom].url} alt="" className="max-h-[70vh] max-w-full rounded-lg object-contain" />
            <div className="text-xs text-slate-300">{KIND_LABEL[views[zoom].kind]}</div>
            {views[zoom].note && <div className="max-w-xs text-center text-[11px] text-amber-400">{views[zoom].note}</div>}
            {owned && (
              <button
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void onRemove(zoom);
                }}
                className="rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                删掉这张
              </button>
            )}
            <div className="text-[10px] text-slate-500">点任意处关闭</div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function CardDetailPage() {
  const accountV = useAccountVersion();
  useSocialVersion(); // 热度到货后重渲染（服务端计数是懒加载的）
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [copied, setCopied] = useState(false);
  useCountView("card", id);
  // 优先账号库；不在库里（比如看别人作品的卡组）用路由 state 里带来的卡
  // ★ 依赖里带上 accountV：账号库是原地改对象的单例，不把版本号写进依赖，
  //   "刚把这张卡加进库"之后这里还会拿着路由 state 里那份只读副本。
  const card = useMemo<Card | null>(() => {
    const mine = myCards().find((c) => c.id === id);
    if (mine) return mine;
    const passed = (loc.state as { card?: Card } | null)?.card;
    return passed && passed.id === id ? passed : (passed ?? null);
  }, [id, loc.state, accountV]);
  // ★ 这一页也会渲染**别人的**卡（工坊市场点进来时卡是由路由 state 带过来的），
  //   所以分享条必须按"这张卡在不在我库里"开门，不能只看有没有登录。
  const owned = useMemo(() => myCards().some((c) => c.id === id), [id, accountV]);
  const heat = heatOf("card", id ?? "");
  // ★ hook 必须在下面那个 `if (!card) return` 之前跑完，否则卡在不在库里会改变
  //   hook 数量，切换时直接崩。所以这里用 card?.，不是 card.
  const model = useHologramModel(card?.modelUrl ?? (card ? CARD_MODELS[card.name] : undefined));

  if (!card) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
        <Icon name="cards" size={40} className="text-slate-600" />
        <p className="text-sm text-slate-400">这张卡不在你的收藏里</p>
        <Link to="/workshop" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          去创意工坊
        </Link>
      </div>
    );
  }

  const color = CARD_TYPE_COLORS[card.type];
  const inDecks = myDecks().filter((d) => d.cardIds.includes(card.id));
  const blueprint = blueprintOf(card);

  return (
    <div className="safe-top min-h-full px-4 pb-8 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">卡片详情</h1>
      </div>

      {/* 大卡面 / 全息建模 双栏 */}
      <div className="mb-4 flex justify-center gap-3">
        <div className="w-44">
          <TarotCard cover={card.cover || null} title={card.name} sub={CARD_TYPE_LABELS[card.type]} type={card.type} />
        </div>
        {/* ★ 判据是 model.url（**解析得到的**地址），不是 card.modelUrl（指针）：
            自己在另一台设备上炼的卡，指针会跟着账号同步过来、blob 不会 ——
            照着指针画这个框，用户得到的是一个**永远填不满的空全息框**。
            取不到就当作"这张卡没有建模"，与从来没有建模的卡表现一致。 */}
        {model.url && (
          <div className="relative w-44 overflow-hidden rounded-2xl bg-ink/85">
            <CardHologram url={model.url} />
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[10px] tracking-wide text-cyan-300/90">
              ✦ 全息实体 3D 建模
            </span>
          </div>
        )}
      </div>

      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-100">{card.name}</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs" style={{ color, borderColor: color }}>
          {CARD_TYPE_LABELS[card.type]}
        </span>
        {/* ★ 热度以前读的是 card.hot —— 那是 mock/ai.ts 里手打的 18 个常数，
            从来没有任何东西会去加它，等于把一个假数字当社区热度展示了一年。
            现在走 social.heatOf：远端模式是服务端算的全局值，离线/老服务端
            退回本机计数，并在旁边如实标出来。 */}
        <span className="text-xs text-gold">🔥 {formatHeat(heat.heat)}</span>
        {heat.source === "local" && <span className="text-[10px] text-slate-600">本机计数</span>}
      </div>
      {card.tags && card.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span key={t} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">
              #{t}
            </span>
          ))}
        </div>
      )}
      <p className="mb-4 text-sm leading-relaxed text-slate-300">{card.summary}</p>

      {/* 形象参考图：AI 画设定帧时真的会照着它们锁形象，不是相册 */}
      <CardViewsSection card={card} owned={owned} />

      {/* 生成蓝图：铸卡时的完整提示词——照着它 AI 就能复刻出与卡面一致的画面/建模 */}
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">🧬 生成蓝图</span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(blueprint).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200"
          >
            {copied ? "已复制 ✓" : "复制"}
          </button>
        </div>
        <p className="whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-400">{blueprint}</p>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          这是铸造这张卡时使用的完整生成提示词。把它交给 AI（或在工坊中使用本卡），即可生成与卡面一致的
          {card.type === "character" ? "角色画面 / 3D 建模" : "画面"}。
        </p>
      </div>

      {inDecks.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">所属卡组</div>
          <div className="flex flex-wrap gap-2">
            {inDecks.map((d) => (
              <Link key={d.id} to={`/deck/${d.id}`} className="rounded-full bg-panel px-3 py-1.5 text-xs text-slate-200">
                🎴 {d.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 分享到创意工坊。只对**自己库里**的卡开放（这一页也渲染别人的卡） */}
      <WorkshopShareBar
        kind="card"
        className="mb-4"
        published={!!card.published}
        disabledReason={shareBlockReason({ remote: isRemoteMode(), owned, modelUrl: card.modelUrl })}
        note={shareModelNote(card)}
        onToggle={(next) => shareCard(card.id, next)}
      />

      <Link
        to="/studio"
        className="block w-full rounded-xl bg-brand/90 py-2.5 text-center text-sm font-bold text-ink"
      >
        🎬 去 3D 工坊用这张卡创作
      </Link>

      <SocialPanel kind="card" id={card.id} />
    </div>
  );
}
