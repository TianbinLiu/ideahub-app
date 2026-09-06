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
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import ConfirmDialog from "../components/ConfirmDialog";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { useCurrentUser } from "../hooks/useAccount";
import { isRemoteMode } from "../data/account";
import { storageEstimate } from "../data/db";
import { planSweep, runSweep, type SweepPlan } from "../data/cacheSweep";

export default function SettingsStoragePage() {
  // 远端模式下作品的权威副本在服务器，本地这份只是缓存——文案不能再说「存在本机」
  const remote = isRemoteMode();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  useAutoGuide("setstorage", !!user);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, []);

  // 路由已套 RequireAuth；这里只为 TS 收窄（render 里 navigate 会被 React 丢弃，别改回来）
  if (!user) return null;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader className="mb-4" onBack={() => navigate(-1)} title={remote ? "本机缓存" : "存储"} right={<HelpButton tour="setstorage" />} />

      <div data-guide="setstorage-usage" className="rounded-xl border border-slate-700/70 bg-panel p-4">
        {storage ? (
          <>
            <div className="mb-2 flex justify-between text-xs text-slate-300">
              <span>已用 {storage.usedMB} MB</span>
              <span className="text-slate-500">可用约 {storage.quotaMB} MB</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, (storage.usedMB / Math.max(1, storage.quotaMB)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {remote
                ? "作品与卡片已同步到服务器，换设备登录同一账号即可看到；这里是它们在本机的副本，加上生成过程中的中间文件。"
                : "作品与卡片存在本机数据库里。AI 生成的画面体积较大，空间不足时请删除旧作品。"}
            </p>
            <CacheSweeper onDone={() => void storageEstimate().then(setStorage)} />
          </>
        ) : (
          <span className="text-xs text-slate-500">读取中…</span>
        )}
      </div>
    </div>
  );
}

function CacheSweeper({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<SweepPlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void planSweep().then(setPlan);
  }, []);

  if (!plan) return <p className="mt-2 text-[11px] text-slate-600">正在算可清理的空间…</p>;

  const mb = plan.bytes / 1048576;
  const mbLabel = mb < 1 ? "<1" : mb.toFixed(0);
  if (plan.keys.length === 0) {
    return <p className="mt-2 text-[11px] text-slate-600">{note || "没有可清理的中间文件"}</p>;
  }

  function run() {
    setBusy(true);
    void runSweep(plan!)
      .then((n) => {
        setNote(`已清理 ${n} 个文件`);
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
        清理缓存（可释放 {mbLabel} MB）
      </button>
      {confirming && (
        <ConfirmDialog
          title={`清理缓存（约 ${mbLabel} MB）`}
          confirmLabel="清理"
          busy={busy}
          onConfirm={run}
          onClose={() => setConfirming(false)}
        >
          只删生成过程中留下的、已经没人用的中间文件。未发布的草稿和还没传上去的作品不会动。
        </ConfirmDialog>
      )}
    </div>
  );
}
