// 模板市场：简约模式的入口之一。别人发布的成功配方摆在这里，挑一个就能一句话出片。
//
// 与创意工坊的卡片市场刻意做成两个页面：卡片是"素材"（要自己组装成剧情），
// 模板是"成品配方"（一句话就出片）。混在一起会让新用户分不清该点哪个。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../components/Icon";
import { useSocialVersion } from "../components/SocialPanel";
import VideoTemplateExtractor from "../components/VideoTemplateExtractor";
import {
  browseTemplates,
  myTemplates,
  remoteTemplatesCapable,
  sharedLoadIssue,
  subscribeTemplates,
  templatesVersion,
} from "../data/templates";
import { readSocial } from "../data/social";
import { useFlow } from "../studio/flowStore";
import { VideoTemplate } from "../types";

export function useTemplatesVersion(): number {
  return useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0);
}

function fmt(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
}

export function TemplateCard({ t, onPick }: { t: VideoTemplate; onPick?: () => void }) {
  // 走唯一入口 readSocial（模板的互动计数首发仍是本机的——服务端 ASSET_KINDS 还没有
  // "template"，那是 P2 快跟；到那天这里一行不用改，data/social 换个来源就行）。
  // ★ 别在这儿读 likedBy.length —— 数字从哪来只该由 data/social 说了算
  const s = readSocial("template", t.id);
  // 白模模板的参考视频就地预览（存在性判定 t.refVideo，types.ts 的 ★）。
  // 视频挂在 Link 里面：靠 e.preventDefault() 拦掉 <a> 的默认跳转——预览时点视频
  // 是在操作播放器，不是想进详情页
  const [preview, setPreview] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/70 bg-panel">
      <Link to={`/template/${t.id}`} className="block">
        <div className="relative aspect-[16/10] bg-black/40">
          {preview && t.refVideo ? (
            <div className="h-full w-full" onClick={(e) => e.preventDefault()}>
              <video
                src={t.refVideo.url}
                controls
                autoPlay
                muted
                playsInline
                className="h-full w-full bg-black object-contain"
              />
            </div>
          ) : (
            t.cover && <img src={t.cover} alt="" className="h-full w-full object-cover" />
          )}
          {t.refVideo && (
            <span className="absolute left-2 top-2 rounded bg-sky-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
              白模
            </span>
          )}
          {t.refVideo && (
            <button
              onClick={(e) => {
                e.preventDefault();
                setPreview((v) => !v);
              }}
              className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-slate-100"
            >
              {preview ? "封面" : "▶ 预览"}
            </button>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8">
            <div className="truncate text-sm font-bold text-slate-50">{t.title}</div>
            <div className="mt-0.5 flex items-center gap-2.5 text-[10px] text-slate-300">
              <span>@{t.author}</span>
              <span className="flex items-center gap-0.5">
                <Icon name="play" size={10} /> {fmt(s.views)}
              </span>
              <span className="flex items-center gap-0.5">
                <Icon name="heart" size={10} /> {fmt(s.likes)}
              </span>
              {/* 白模只有一段（整段复刻），报"模板视频几秒"比"1 段"信息量大 */}
              <span>{t.refVideo ? `${t.refVideo.durationSec}s 复刻` : `${t.recipe.beats.length} 段`}</span>
            </div>
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-2 p-2.5">
        <p className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">{t.intro}</p>
        {onPick && (
          <button onClick={onPick} className="flex-none rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink">
            用它出片
          </button>
        )}
      </div>
    </div>
  );
}

export default function TemplateMarketPage() {
  const ver = useTemplatesVersion();
  useSocialVersion();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"market" | "mine">("market");
  // 白模上传入口按能力门控渲染（探测走 remoteTemplatesCapable 唯一实现）：
  // 老服务端 / 离线时不摆一个走到上传那步才失败的按钮（CLAUDE.md「永远点不动的选项」）
  const [blockoutCap, setBlockoutCap] = useState(false);
  const [extract, setExtract] = useState(false);
  useEffect(() => {
    let alive = true;
    void remoteTemplatesCapable().then((ok) => {
      if (alive) setBlockoutCap(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  // ★ 依赖里带 ver：远端 shared 是「懒加载 + 到货 emit」，到货那一拍 version 变了
  //   列表才会重算——只依赖 tab/q 的话，远端模板到了也不上屏
  const list = useMemo(() => (tab === "market" ? browseTemplates(q) : myTemplates()), [tab, q, ver]);

  /** 套用模板。applyTemplate 返回 false = 被闸门整句拒绝（白模在 refVid 全关时），
   *  这时改跳详情页——那里印着拒绝的原因（r2vPriceIssue 整句），留在市场干瞪眼不行 */
  function pick(t: VideoTemplate) {
    if (useFlow.getState().applyTemplate(t)) nav("/flow");
    else nav(`/template/${t.id}`);
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">视频模板</h1>
        <span className="ml-auto text-[11px] text-slate-500">套上模板，一句话出片</span>
      </div>

      <div className="mb-3 flex gap-2">
        {(["market", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === t ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
          >
            {t === "market" ? "模板市场" : `我的模板 ${myTemplates().length || ""}`}
          </button>
        ))}
      </div>

      {tab === "market" && (
        <div className="mb-3 flex items-center gap-2 rounded-full border border-slate-700 bg-black/30 px-3.5 py-2">
          <Icon name="search" size={15} className="text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜模板：特摄、治愈、赛博…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
      )}

      {/* 远端市场拉挂了要明说：不说的话"远端加载失败"看起来和"市场就这么几个模板"
          一模一样（铁律八——失败要响；本机与种子照常显示，所以是"响且局部"） */}
      {tab === "market" && sharedLoadIssue() && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300/90">{sharedLoadIssue()}</p>
      )}

      {/* 「我的模板」的白模上传入口：跳提取器并直接拨到白模开关。
          只在能力探测过了才渲染（与提取器里开关的门控是同一个探测） */}
      {tab === "mine" && blockoutCap && (
        <button
          onClick={() => setExtract(true)}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-sky-500/50 py-3 text-xs text-sky-300"
        >
          <Icon name="plus" size={14} />
          上传白模预演视频，做一个能分享的白模模板
        </button>
      )}

      <div className="space-y-3">
        {list.map((t) => (
          <TemplateCard key={t.id} t={t} onPick={() => pick(t)} />
        ))}
        {list.length === 0 && (
          <div className="py-16 text-center text-sm text-slate-500">
            {tab === "mine" ? "还没提取过模板——回简约模式上传一段参考视频试试" : "没有匹配的模板"}
          </div>
        )}
      </div>

      {extract && (
        <VideoTemplateExtractor
          defaultBlockout
          onClose={() => setExtract(false)}
          onDone={(t) => pick(t)}
        />
      )}
    </div>
  );
}
