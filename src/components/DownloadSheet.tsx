// 「保存到本地」面板。壳复用 components/Sheet（z-50 就够：分享面板在打开它之前已经自己
// 关掉了，两层永不叠加；InfoTip 是 z-[70]，在它之上，正确）。
//
// ★★ 这一屏一个规则都不自己判：能不能存 / 存哪几个 / 叫什么名字全在
//   `data/videoDownload.planDownload` 一处，这里只把答案画出来（铁律六）。
// ★★ **卸载不停任务**。下载循环与在途登记是 data 层的模块级单例，关掉这个面板只是组件
//   卸载 —— 原生线程照跑、胶囊接管。下一个人最容易以为"关面板 = 停止"，所以写在这里。
//   要停只有主按钮那颗「停止」。
// ★ 所有 hook 排在任何早退之前（npm run build 里的 check-hook-order.mjs 会拦，而它是
//   拿三次白屏事故换来的）。
// ★ 自带一份 err 行（"z 层盖住谁就自带一份"）。
import { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "./Sheet";
import InfoTip from "./InfoTip";
import { useDownloads } from "../hooks/useDownloads";
import {
  mb,
  planDownload,
  probeSizes,
  shareAll,
  shareOne,
  startDownload,
  stopDownload,
  sweepStaleParts,
  type DownloadRow,
} from "../data/videoDownload";
import type { VideoItem } from "../types";

export default function DownloadSheet({
  video,
  partIndex,
  branchPath,
  onClose,
}: {
  video: VideoItem;
  partIndex: number;
  /** 观众刚看过的那条走向（BranchPlayer 报上来的），分支树的「只存刚看的走向」按它取 */
  branchPath: string[];
  onClose: () => void;
}) {
  // ★ 默认档的分岔：BranchPlayer 的 path 初值是 [rootId]，也就是"还没开始播"。
  //   不做这个分岔的话最常见的一次点击（打开就点保存）会默认只存 1 段，而作品有 9 段。
  const [scope, setScope] = useState<"path" | "all">(() => (branchPath.length <= 1 ? "all" : "path"));
  const [convert, setConvert] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [sizes, setSizes] = useState<{ total: number | null; byKey: Record<string, number | null> } | null>(null);
  const dl = useDownloads();

  // ★ 两档各算一份：单选那两行上印的数字必须是**真的会存下几个文件**（缺 videoUrl 的段
  //   已经被 planDownload 滤掉了），不是树上有几个节点。印错一个数，用户点完只会觉得漏了。
  const resPath = useMemo(
    () => planDownload(video, partIndex, { scope: "path", branchPath, convert }),
    [video, partIndex, branchPath, convert],
  );
  const resAll = useMemo(
    () => planDownload(video, partIndex, { scope: "all", branchPath, convert }),
    [video, partIndex, branchPath, convert],
  );
  const res = scope === "all" ? resAll : resPath;
  const plan = res.ok ? res.plan : null;
  const targets = useMemo(() => plan?.targets ?? [], [plan]);

  // 面板打开时先把上次没下完的残渣清掉（进程被回收时下载随进程死，用户看不见）
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current) return;
    swept.current = true;
    void sweepStaleParts(video.id).then((n) => {
      if (n > 0) setNote(`上次有 ${n} 段没下完，那些半截文件已经清掉了，这次会重下。`);
    });
  }, [video.id]);

  // 问一次总量。★ 换档/换格式都要重问；用序号丢弃过期的那一发（不然会把旧数字画上去）。
  // ⚠ 切到「转成 MP4」之后这一发 HEAD 打的是 f_mp4 派生地址，会**当场触发一次 Cloudinary
  //   变换**（算配额、首次有生成延迟）。留着它是有意的：用户已经明确点了那颗键，而这一发
  //   顺带把派生产物烘热，随后真正下载就不用再等一次转码。
  const probeSeq = useRef(0);
  useEffect(() => {
    if (targets.length === 0) return;
    const my = ++probeSeq.current;
    setSizes(null);
    void probeSizes(targets).then((s) => {
      if (probeSeq.current === my) setSizes(s);
    });
  }, [targets]);

  // 这一批的行数据只在**同一条作品**上才认：另一条作品正在保存时，这里画的是它的行就全错了
  const mine = dl.videoId === video.id;
  const rows = mine ? dl.rows : [];
  const running = dl.running && mine;
  const someoneElseRunning = dl.running && !mine;

  const totalLabel = sizes?.total !== null && sizes?.total !== undefined ? `（约 ${mb(sizes.total)}）` : "";
  const doneRows = rows.filter((r) => (r.status === "done" || r.status === "exists") && r.fileUri);

  function begin() {
    setErr("");
    if (!plan) return;
    const r = startDownload(targets, { videoId: video.id, title: video.title });
    if (!r.ok) setErr(r.blocked);
  }

  return (
    <Sheet onClose={onClose}>
      <p className="text-sm font-bold text-slate-100">保存到本地</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
        先存进 App，再选去处。
        <InfoTip title="保存到本地是怎么走的">
          安卓不让 App 直接写进相册。文件先落在 App 的缓存目录里；存好后点每一行的「分享 / 另存为」，
          在系统面板里选相册或文件管理器。保存期间请留在 App 里，别把它划掉。
          缓存目录在手机空间紧张时可能被系统清掉 —— 存好之后请尽快选个去处。
        </InfoTip>
      </p>
      <p className="mt-1 truncate text-xs text-slate-500">《{video.title}》</p>

      {!plan ? (
        // 走到这一步说明调用点没先问 planDownload（正常路径下入口会被挡住），照样把话说全
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
          {res.ok ? "" : res.blocked}
        </p>
      ) : (
        <>
          {plan.kind === "branch" && (
            <div className="mt-3">
              <p className="text-xs text-slate-400">互动视频没有单条成片。</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {(
                  [
                    ["path", `只存刚看的走向（${resPath.ok ? resPath.plan.targets.length : 0} 段）`],
                    ["all", `存全部分支（${resAll.ok ? resAll.plan.targets.length : 0} 段）`],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setScope(v)}
                    disabled={running}
                    className={`rounded-xl border px-3 py-2 text-left text-xs ${
                      scope === v ? "border-brand bg-brand/10 text-slate-100" : "border-slate-700 text-slate-300"
                    } ${running ? "opacity-50" : ""}`}
                  >
                    {scope === v ? "◉" : "○"} {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {plan.kind === "linear" && (
            <p className="mt-3 text-xs text-slate-400">这条有 {targets.length} 段，会存成 {targets.length} 个文件。</p>
          )}

          <p className="mt-3 text-[11px] text-slate-500">
            文件格式：{plan.formats.map((f) => f.toUpperCase()).join(" / ")}
            {targets.length > 1 ? ` · ${targets.length} 个文件` : ""}
          </p>

          {/* ★★ webm 那条必须说在前面：线上相当一部分成片是剪辑页 MediaRecorder 导出的
              vp9 webm，安卓相册/播放器对它支持很差 —— 用户存完打不开只会以为"下载坏了"。 */}
          {plan.hasWebm && !convert && (
            <p className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
              这条是 webm 格式，部分相册应用打不开；保存时选文件管理器更稳。
            </p>
          )}
          {convert && (
            <p className="mt-1.5 rounded-lg border border-slate-600/60 bg-black/25 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-400">
              会让服务器现转一份 H.264 的 MP4 再下（画质略降、体积小很多）。原作品一个字都不动。
            </p>
          )}

          {/* 行 */}
          <div className="mt-3 space-y-1.5">
            {targets.map((t) => {
              // ★ 必须**连文件名一起比**，不能只比 key：切到「转成 MP4」之后同一个 key 指的是
              //   另一个文件（扩展名不同），只比 key 会把上一轮 webm 的「✓ 已存」画在一个
              //   根本没下过的 mp4 行上 —— 用户会以为已经存好了。
              const row = rows.find((r) => r.key === t.key && r.fileName === t.fileName) ?? null;
              const known = sizes?.byKey[t.key];
              return (
                <div key={t.key} className="rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{t.label}</span>
                    <span className="flex-none text-[11px] tabular-nums text-slate-500">
                      {rowRight(row, known ?? null)}
                    </span>
                  </div>
                  <p className="mt-0.5 break-all text-[10px] text-slate-600">{t.fileName}</p>
                  {row?.err && <p className="mt-1 text-[11px] leading-relaxed text-rose-300">{row.err}</p>}
                  {row?.raw && <p className="mt-0.5 break-all text-[10px] text-slate-500">{row.raw}</p>}
                  {row?.unverified && (
                    <p className="mt-0.5 text-[10px] text-slate-500">大小未知，没法校验这一份是不是完整的。</p>
                  )}
                  {row && (row.status === "done" || row.status === "exists") && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={() => void shareOne(row, video.title)}
                        className="flex-none rounded-full bg-slate-700 px-3 py-1 text-[11px] text-slate-100 active:scale-95"
                      >
                        分享 / 另存为
                      </button>
                      {row.share && (
                        <span className={`text-[11px] ${row.share.ok ? "text-emerald-300" : "text-amber-300"}`}>
                          {row.share.msg}
                        </span>
                      )}
                    </div>
                  )}
                  {row?.share?.raw && <p className="mt-0.5 break-all text-[10px] text-slate-500">{row.share.raw}</p>}
                </div>
              );
            })}
          </div>

          {/* 整批的结局 */}
          {mine && !running && dl.outcome && (
            <p
              className={`mt-3 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                dl.outcomeOk
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-200"
              }`}
            >
              {dl.outcome}
            </p>
          )}
          {running && (
            <p className="mt-3 text-[11px] text-slate-400">
              正在保存 {rows.filter((r) => r.status === "done" || r.status === "exists").length}/{rows.length} 段
              {dl.stopping ? " · 正在停止（当前这一段会跑完）" : ""}
            </p>
          )}

          <button
            onClick={running ? () => stopDownload() : begin}
            disabled={someoneElseRunning || (running && dl.stopping)}
            className={`mt-3 w-full rounded-xl py-2.5 text-sm font-bold active:scale-[0.99] disabled:opacity-40 ${
              running ? "border border-slate-600 text-slate-200" : "bg-gold/90 text-ink"
            }`}
          >
            {running ? "停止" : `开始保存${totalLabel}`}
          </button>
          {!running && !totalLabel && (
            <p className="mt-1 text-[11px] text-slate-500">{sizes ? "大小未知" : "正在问总大小…"}</p>
          )}

          {/* 第二个动作：转成 MP4 再存。只有原地址是 Cloudinary 且不是 mp4 时才有意义 */}
          {plan.canConvert && !running && (
            <button
              onClick={() => {
                setConvert((v) => !v);
                setErr("");
              }}
              className="mt-2 w-full rounded-xl border border-slate-700 py-2.5 text-sm text-slate-200 active:scale-[0.99]"
            >
              {convert ? "改回原始格式保存" : "转成 MP4 再存（画质略降）"}
            </button>
          )}

          {doneRows.length > 1 && !running && (
            <>
              <button
                onClick={() =>
                  void shareAll(doneRows, video.title).then((r) => {
                    if (!r.ok) setErr(r.msg);
                  })
                }
                className="mt-2 w-full rounded-xl border border-slate-700 py-2.5 text-sm text-slate-200 active:scale-[0.99]"
              >
                一次全给（{doneRows.length} 个文件）
              </button>
              {/* 依据：SharePlugin.shareFiles() 里 `filesList.size() > 1` 时 MIME 被硬改成「任意文件」 */}
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                一次给多个文件时系统按「任意文件」处理，相册可能不在候选里；想进相册就一个一个来。
              </p>
            </>
          )}
        </>
      )}

      {someoneElseRunning && (
        <p className="mt-3 text-[11px] leading-relaxed text-amber-300">
          正在保存另一条作品，等它完成或点停止再来。
        </p>
      )}
      {note && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{note}</p>}
      {err && <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</p>}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        这些文件在 App 的缓存目录里，系统可能会清掉。设置 → 存储里能看到它们占了多少，也能清空。
      </p>

      <button onClick={onClose} className="mt-3 w-full rounded-xl border border-slate-700 py-2.5 text-sm text-slate-300">
        {running ? "关掉（保存继续跑）" : "关闭"}
      </button>
    </Sheet>
  );
}

/** 行右侧那一格的四态。★ total 为 null 时写「已下 4.1 MB」而不是一条恒 0% 的进度条 */
function rowRight(row: DownloadRow | null, known: number | null): string {
  if (!row) return known === null ? "大小未知" : `约 ${mb(known)}`;
  switch (row.status) {
    case "queued":
      return "等待中";
    case "checking":
      return "检查中";
    case "downloading":
      return row.total ? `${Math.floor((row.bytes / row.total) * 100)}%` : `已下 ${mb(row.bytes)}`;
    case "done":
      return "✓ 已存";
    case "exists":
      return "✓ 已存（之前存过）";
    case "stopped":
      return "已停止";
    case "failed":
      return "没存下";
  }
}
