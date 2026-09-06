// 已拉黑的人：看名单 + 解除。
//
// ★★ 为什么必须有这一页：拉黑按钮本身不难，难的是**它必须可逆**。没有解除入口的话，
//   用户在别处点下的那一下就是不可撤销的 —— 而拉黑最常见的场景恰恰是"手滑点了"
//   或者"当时生气"。BlockButton 的确认卡里明写着"随时可以解除：我的 → 设置 → 已拉黑的人"，
//   那句话必须真的指向一个存在的地方（CLAUDE.md：「提示语指向一个不存在的出口」那条坑）。
// ★ 三种空态要分开说（铁律八；本仓为「把 N 种结局压成两档」栽过好几次）：
//   ① 没问到（老服务端没这个端点 / 网络不通）→ 给一条重试的路；
//   ② 问过了、一个都没有 → 「你还没拉黑过谁」；
//   ③ 有名单 → 列出来。
//   把 ① 和 ② 合并的话，弱网下会显示"你还没拉黑过谁"，而名单其实好好地在服务器上。
import { useCallback, useEffect, useState } from "react";
import Avatar from "../components/Avatar";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import { isRemoteMode } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { listBlocked, unblockUser, type BlockedUser } from "../api/blocking";
import { refreshFeed, refreshFollowingFeed } from "../data/videos";

export default function SettingsBlockedPage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const remote = isRemoteMode();
  /** null = 还没问到（与"问过了是空的"分开，见顶注 ★） */
  const [list, setList] = useState<BlockedUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  /** 重试用的一次性号：网络恢复**不会**自己触发任何 effect，得有东西让依赖变一下 */
  const [nonce, setNonce] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setList(await listBlocked());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!remote) {
      setLoading(false);
      return;
    }
    void load();
  }, [remote, load, nonce]);

  async function undo(u: BlockedUser) {
    if (busyId) return;
    setBusyId(u.id);
    setErr("");
    const why = await unblockUser(u.id);
    setBusyId("");
    if (why) {
      setErr(why);
      return;
    }
    // ★ 只有**真的删掉了**才移走这一行（unblockUser 判服务端回的 removed）。
    //   上一版是无条件乐观移除，于是"删不掉"长得和"删掉了"一模一样 —— 退出去再进来
    //   那个人原封不动还在（零报错空操作，复核抓到的那条）。
    setList((prev) => (prev ? prev.filter((x) => x.id !== u.id) : prev));
    // 解除之后他的作品该回到首页/关注流里：那两份是会话内缓存，得重拉
    void refreshFeed();
    void refreshFollowingFeed();
  }

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader onBack={() => navigate(-1)} title="已拉黑的人" />

      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        拉黑是双向的：你们不会再看见彼此的作品、评论和弹幕，也不会收到对方的任何通知。解除之后立刻恢复。
      </p>

      {!user ? (
        <p className="text-xs text-slate-400">登录之后才能管理黑名单。</p>
      ) : !remote ? (
        // ★ 离线模式下没有"别人"，说清楚而不是显示一个永远空的名单
        <p className="text-xs leading-relaxed text-slate-400">
          当前是本地模式（没有连服务器），黑名单是账号级的功能——接上服务器之后才会有。
        </p>
      ) : loading ? (
        <EmptyState loading text="正在取名单…" />
      ) : list === null ? (
        // ① 没问到 —— 与"一个都没有"分开说，并给一条真能走的路
        <EmptyState
          error
          text="没能取到黑名单（网络不通，或这台服务器还没有这个功能）"
          hint="这不代表名单是空的"
          cta={{ label: "重试", onClick: () => setNonce((n) => n + 1) }}
        />
      ) : list.length === 0 ? (
        // ② 问过了，确实一个都没有
        <EmptyState text="你还没拉黑过谁" />
      ) : (
        <div className="space-y-2">
          {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {list.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-xl border border-slate-700/70 bg-panel px-3 py-2.5">
              <Avatar name={u.name} src={u.avatar} size={36} className="flex-none" />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{u.name}</span>
              <button
                onClick={() => void undo(u)}
                disabled={!!busyId}
                className="flex-none rounded-full border border-slate-600 px-3 py-1 text-[11px] text-slate-300 disabled:opacity-40"
              >
                {busyId === u.id ? "解除中…" : "解除"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
