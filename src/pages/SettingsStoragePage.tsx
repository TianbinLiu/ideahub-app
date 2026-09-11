// 存储与清理：用量条 + 清理缓存。从设置页拆出来的单功能子页（2026-08-27）。
//
// ★ 为什么要有清理这颗按钮：光显示"已用 300MB"是一条**用户看不懂、也做不了任何事**
//   的信息——只会让人担心，却给不出下一步。要么让它可操作，要么别显示。
// ★ 清的只有"没人引用的中间文件"（判据与安全边界见 data/cacheSweep.ts）：
//   未发布的草稿、还没传上去的作品，一个都不碰。这句承诺写在**确认弹窗**里 ——
//   用户要动手那一刻才需要它，常驻在页面上就是拆页前的老样子。
// ★ 没得清的时候明说"没有可清理的"，不做成一颗点了假装忙一下的按钮。
// ★ "存的东西在本机还是服务器"那两句是**模式条件**下的事实，留在页面上
//   （藏进看一遍就不弹的引导 = 静默失败，tours.tsx 文件头 ❌ 那条）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import ConfirmDialog from "../components/ConfirmDialog";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { useCurrentUser } from "../hooks/useAccount";
import { isRemoteMode } from "../data/account";
import { storageEstimate } from "../data/db";
import { planSweep, runSweep, type SweepPlan } from "../data/cacheSweep";
import { clearDownloads, listDownloads, mb as fmtBytes, type DownloadGroup } from "../data/videoDownload";
import { sweepCameraLeftovers } from "../utils/nativeCamera";

export default function SettingsStoragePage() {
  // 远端模式下作品的权威副本在服务器，本地这份只是缓存——文案不能再说「存在本机」
  const remote = isRemoteMode();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  useAutoGuide("setstorage", !!user);
  const { t } = useLingui();

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, []);

  // 路由已套 RequireAuth；这里只为 TS 收窄（render 里 navigate 会被 React 丢弃，别改回来）
  if (!user) return null;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset onBack={() => navigate(-1)} title={remote ? t`本机缓存` : t`存储`} right={<HelpButton tour="setstorage" />} />

      <div data-guide="setstorage-usage" className="rounded-xl border border-slate-700/70 bg-panel p-3">
        {storage ? (
          <>
            <div className="mb-2 flex justify-between text-xs text-slate-300">
              <span><Trans>已用 {storage.usedMB} MB</Trans></span>
              <span className="text-slate-500"><Trans>可用约 {storage.quotaMB} MB</Trans></span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, (storage.usedMB / Math.max(1, storage.quotaMB)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {remote
                ? t`作品与卡片已同步到服务器，换设备登录同一账号即可看到；这里是它们在本机的副本，加上生成过程中的中间文件。`
                : t`作品与卡片存在本机数据库里。AI 生成的画面体积较大，空间不足时请删除旧作品。`}
            </p>
            <SavedVideos />
            <CacheSweeper onDone={() => void storageEstimate().then(setStorage)} />
          </>
        ) : (
          <span className="text-xs text-slate-500"><Trans>读取中…</Trans></span>
        )}
      </div>
    </div>
  );
}

/**
 * 「保存到本地」存下来的视频（**原生** Cache 目录 `ideahub-downloads/`）。
 *
 * ★★ 为什么这一行必须加：上面那条用量条走 `data/db.storageEstimate()` →
 *   `navigator.storage.estimate()`，它**只数 WebView 那一份配额**，数不到原生 Cache 目录。
 *   不加的话用户在这一页看到的「已用」永远解释不了系统设置里多出来的几百 MB ——
 *   正是这一页文件头写着要消灭的那种"看不懂、也做不了任何事"的数字。
 * ★ 与下面那颗「清理缓存」是**两颗键、两句话**：那颗清的是没人引用的中间文件（可以随便清），
 *   这颗删的是用户**特意存下来的成品**（删了就没了），措辞绝不能混。
 * ★ 一个文件都没有时整块不画：空的一行只会让人以为功能坏了。
 *   ⚠ **但清空之后那一拍不能不画**（2026-09-08 评审抓到）：原来清空成功就 `setGroups([])`，
 *     而这一行的守卫恰恰是"空了就 return null" —— 整块当场从页面上消失，把回执一起带走了。
 *     用户对一次**破坏性**操作看到的是"那一块没了"，而不是一句"删掉了 N 个文件"。
 *     ⇒ 只要 `note` 还在，就继续画（此时列表为空，画的就是那句回执）。
 * ★ 认不出的 videoId（作品已删/已下架）归到「已删除的作品」一行 —— 由 listDownloads 兜。
 */
function SavedVideos() {
  const { t } = useLingui();
  const [groups, setGroups] = useState<DownloadGroup[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void listDownloads().then(setGroups);
  }, []);

  if (!groups || (groups.length === 0 && !note)) return null;

  const files = groups.reduce((s, g) => s + g.files, 0);
  const bytes = groups.reduce((s, g) => s + g.bytes, 0);

  function run() {
    setBusy(true);
    void clearDownloads()
      .then((r) => {
        // ★ 正在保存时是**整句拒**，不是"清了 0 个"：那两件事在屏幕上必须长得不一样
        if (r.blocked) {
          setNote(r.blocked);
          setConfirming(false);
          return;
        }
        // ★ 删失败与"删了 0 个"在屏幕上必须长得不一样（铁律八）：失败时列表**不清**，
        //   重新数一遍摆回去 —— 文件还在，用户下一步该看到的是它们，而不是一片空白。
        if (r.failed) {
          setNote(r.failed);
          setConfirming(false);
          void listDownloads().then(setGroups);
          return;
        }
        setNote(t`已删掉 ${r.files} 个文件，${fmtBytes(r.bytes)} 空间已释放`);
        setGroups([]);
        setConfirming(false);
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="mt-3 border-t border-slate-700/60 pt-3">
      {/* ★ 清空成功之后这一段整段不画（groups 已空），只剩下面那句回执 ——
          否则会摆出「已保存的视频 0 B · 0 个文件」和一颗「清空（0 B）」的空键。 */}
      {groups.length > 0 && (
        <>
          <p className="text-xs text-slate-300">
            <Trans>已保存的视频 {fmtBytes(bytes)} · {files} 个文件</Trans>
          </p>
          <div className="mt-1 space-y-0.5">
            {groups.map((g) => (
              <p key={g.videoId} className="truncate text-[11px] text-slate-500">
                <Trans>《{g.title}》 {g.files} 个文件 · {fmtBytes(g.bytes)}</Trans>
              </p>
            ))}
          </div>
          <button
            onClick={() => setConfirming(true)}
            className="mt-2 w-full rounded-xl border border-slate-600 py-2.5 text-xs text-slate-200"
          >
            <Trans>清空已保存的视频（{fmtBytes(bytes)}）</Trans>
          </button>
        </>
      )}
      {note && <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300">{note}</p>}
      {confirming && (
        <ConfirmDialog
          title={t`清空已保存的视频（${fmtBytes(bytes)}）`}
          confirmLabel={t`清空`}
          danger
          busy={busy}
          onConfirm={run}
          onClose={() => setConfirming(false)}
        >
          <Trans>
            删的是你点「保存到本地」存进 App 的那 {files} 个视频文件。已经用「分享 / 另存为」交给相册或
            文件管理器的副本不受影响；还留在这里没交出去的，删了就没有了。
          </Trans>
        </ConfirmDialog>
      )}
    </div>
  );
}

function CacheSweeper({ onDone }: { onDone: () => void }) {
  const { t } = useLingui();
  const [plan, setPlan] = useState<SweepPlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void planSweep().then(setPlan);
  }, []);

  if (!plan) return <p className="mt-2 text-[11px] text-slate-600"><Trans>正在算可清理的空间…</Trans></p>;

  const mb = plan.bytes / 1048576;
  const mbLabel = mb < 1 ? "<1" : mb.toFixed(0);
  if (plan.keys.length === 0) {
    // ★ 「这一轮不清」与「没有可清理的」是两句话（cacheSweep.SweepPlan.blocked）：前者是草稿 / 剪辑稿没读出来、
    //   引用数不全，这时说"没有"是假话；而且指一条真出路 —— 去那边读出来再回来
    if (plan.blocked) {
      return (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300">
          <Trans>草稿箱或剪到一半的成片这会儿没读出来，先不清理 —— 不然会把它们还在用的文件当成没人要的删掉。去草稿箱点「重试」读出来之后再来。</Trans>
        </p>
      );
    }
    return <p className="mt-2 text-[11px] text-slate-600">{note || t`没有可清理的中间文件`}</p>;
  }

  function run() {
    setBusy(true);
    void runSweep(plan!)
      // ★ 顺手清拍照残留（原生 Pictures/ 下的 JPEG_*：取消拍照也会留下 0 字节的临时文件，IndexedDB 那份清单数不到它们）
      .then(async (swept) => swept + (await sweepCameraLeftovers(0)))
      .then((n) => {
        setNote(t`已清理 ${n} 个文件`);
        setPlan({ keys: [], bytes: 0 });
        setConfirming(false);
        onDone();
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setConfirming(true)}
        className="w-full rounded-xl border border-slate-600 py-2.5 text-xs text-slate-200"
      >
        <Trans>清理缓存（可释放 {mbLabel} MB）</Trans>
      </button>
      {confirming && (
        <ConfirmDialog
          title={t`清理缓存（约 ${mbLabel} MB）`}
          confirmLabel={t`清理`}
          busy={busy}
          onConfirm={run}
          onClose={() => setConfirming(false)}
        >
          <Trans>只删生成过程中留下的、已经没人用的中间文件。未发布的草稿和还没传上去的作品不会动。</Trans>
        </ConfirmDialog>
      )}
    </div>
  );
}
