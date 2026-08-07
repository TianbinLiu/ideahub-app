// 我的页：头像/昵称/简介/统计 + 我的作品·卡片·卡组·关注 四个页签 + 设置入口。
import { useMemo, useState, useRef } from "react";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import { fileToSquareImage } from "../utils/image";
import { Link } from "react-router";
import { listVideos, isMyAuthor } from "../data/videos";
import { myCards, myDecks, toggleFollow, setAvatarImage } from "../data/account";
import { useAccountVersion, useCurrentUser } from "../hooks/useAccount";
import { CARD_TYPE_COLORS, CARD_TYPE_LABELS, formatDuration, formatPlays } from "../types";

export default function ProfilePage() {
  const avatarRef = useRef<HTMLInputElement>(null);
  useAccountVersion();
  const user = useCurrentUser();
  const [tab, setTab] = useState<"videos" | "cards" | "decks" | "following">("videos");
  const videos = useMemo(() => listVideos(), []);

  if (!user) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6">
        <span className="text-5xl">👤</span>
        <p className="text-center text-sm text-slate-400">登录后可以创作视频、收藏卡片、管理卡组</p>
        <Link to="/login?next=/me" className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-ink">
          登录 / 注册
        </Link>
      </div>
    );
  }

  const mine = videos.filter((v) => isMyAuthor(v.author));
  const cards = myCards();
  const decks = myDecks();
  const totalPlays = mine.reduce((s, v) => s + v.plays, 0);
  const totalLikes = mine.reduce((s, v) => s + v.likes, 0);

  const TABS = [
    { key: "videos", label: "作品", n: mine.length },
    { key: "cards", label: "卡片", n: cards.length },
    { key: "decks", label: "卡组", n: decks.length },
    { key: "following", label: "关注", n: user.following.length },
  ] as const;

  return (
    <div className="safe-top min-h-full">
      {/* 头部 */}
      <div className="relative px-4 pt-3">
        <Link
          to="/settings"
          className="absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-panel text-lg"
        >
          <Icon name="settings" size={20} />
        </Link>
        <div className="flex items-center gap-4">
          {/* 点头像直接换：不用先钻进设置页 */}
          <button
            onClick={() => avatarRef.current?.click()}
            className="relative shrink-0 rounded-full transition active:scale-95"
            aria-label="更换头像"
          >
            <Avatar name={user.name} src={user.avatar} size={80} />
            <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-brand text-ink">
              <Icon name="plus" size={13} strokeWidth={2.5} />
            </span>
          </button>
          <input
            ref={avatarRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                await setAvatarImage(await fileToSquareImage(f, 256));
              } catch (err) {
                console.warn("[profile] 头像更换失败:", err);
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold text-slate-100">{user.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">@{user.account}</div>
          </div>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
          {user.bio || <span className="text-slate-600">还没有简介——去设置里写一句吧</span>}
        </p>
        <div className="mt-3 flex gap-5 text-sm">
          <div>
            <span className="font-bold text-slate-100">{formatPlays(totalPlays)}</span>
            <span className="ml-1 text-xs text-slate-500">播放</span>
          </div>
          <div>
            <span className="font-bold text-slate-100">{totalLikes}</span>
            <span className="ml-1 text-xs text-slate-500">获赞</span>
          </div>
          <div>
            <span className="font-bold text-slate-100">{user.following.length}</span>
            <span className="ml-1 text-xs text-slate-500">关注</span>
          </div>
        </div>
      </div>

      {/* 页签 */}
      <div className="mt-4 flex border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 pb-2.5 text-sm transition ${
              tab === t.key ? "border-b-2 border-brand font-semibold text-slate-100" : "text-slate-500"
            }`}
          >
            {t.label} {t.n > 0 && <span className="text-xs">{t.n}</span>}
          </button>
        ))}
      </div>

      <div className="px-4 pt-3">
        {tab === "videos" &&
          (mine.length ? (
            <div className="grid grid-cols-3 gap-2 pb-4">
              {mine.map((v) => (
                <Link key={v.id} to={`/video/${v.id}`} className="relative overflow-hidden rounded-lg">
                  <img src={v.cover} alt={v.title} className="aspect-[3/4] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-1.5">
                    <div className="truncate text-[10px] text-slate-200">{v.title}</div>
                    <div className="text-[9px] text-slate-400">
                      {formatPlays(v.plays)}播放 ·{" "}
                      {formatDuration(v.segments.reduce((s, x) => s + x.durationSec, 0))}
                    </div>
                  </div>
                  {v.branchTree && (
                    <span className="absolute left-1 top-1 rounded bg-brand/85 px-1 py-0.5 text-[8px] font-semibold text-ink">
                      互动
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <Empty text="还没有发布作品" cta="去创作" to="/studio" />
          ))}

        {tab === "cards" &&
          (cards.length ? (
            <div className="grid grid-cols-3 gap-2 pb-4">
              {cards.map((c) => (
                <div key={c.id} className="relative overflow-hidden rounded-lg border border-slate-700/60">
                  {c.cover ? (
                    <img src={c.cover} alt={c.name} className="aspect-[3/4] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center bg-slate-800 text-2xl">🎴</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5">
                    <div className="truncate text-[10px] text-slate-100">{c.name}</div>
                    <span className="text-[8px]" style={{ color: CARD_TYPE_COLORS[c.type] }}>
                      {CARD_TYPE_LABELS[c.type]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="还没有卡片" cta="去创意工坊" to="/workshop" />
          ))}

        {tab === "decks" &&
          (decks.length ? (
            <div className="space-y-2 pb-4">
              {decks.map((d) => (
                <Link
                  key={d.id}
                  to="/workshop"
                  className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-panel p-3"
                >
                  <span className="text-2xl">🗂️</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">{d.name}</div>
                    <div className="text-[11px] text-slate-500">{d.cardIds.length} 张卡</div>
                  </div>
                  <span className="text-slate-600">›</span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty text="还没有卡组" cta="去创意工坊" to="/workshop" />
          ))}

        {tab === "following" &&
          (user.following.length ? (
            <div className="space-y-2 pb-4">
              {user.following.map((a) => (
                <div key={a} className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-panel p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-lg">
                    🎬
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">{a}</div>
                    <div className="text-[11px] text-slate-500">
                      {videos.filter((v) => v.author === a).length} 支作品
                    </div>
                  </div>
                  <button
                    onClick={() => toggleFollow(a)}
                    className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300"
                  >
                    已关注
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="还没有关注任何创作者" cta="去首页逛逛" to="/" />
          ))}
      </div>
    </div>
  );
}

function Empty({ text, cta, to }: { text: string; cta: string; to: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <p className="text-sm text-slate-500">{text}</p>
      <Link to={to} className="rounded-full bg-panel px-4 py-2 text-xs text-slate-300">
        {cta}
      </Link>
    </div>
  );
}
