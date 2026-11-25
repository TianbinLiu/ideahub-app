// 「收尾」那张面板（对局结束屏上三颗键里「⬇️ 保存到本地」「🚀 发布」开的就是它）。
//
// ★ 一个规则都不自己判：能不能存 / 存几段 / 叫什么名字问 `data/videoDownload.planClipDownload`，
//   段落的进度与结局读那个模块自己的状态（`useDownloads`），发布带哪一段由调用方算出
//   （`studio/game/wrapup.wrapupOf` 的 `best`）。这一屏只把答案画出来（铁律六）。
// ★★ 为什么发布这一屏要单独把「B 站等平台」写成一段字、而不是一颗键：App **没有**直连平台的
//   发布能力（没有平台授权、也没有上传接口，见 docs/workshop-game-design.md §七）。
//   摆一颗按下去没反应的键比不摆更坏 —— 所以这里说清"先存再传"，并把真正能用的
//   「先保存到本地」摆在同一屏。
// ★ 卸载不停任务（与 DownloadSheet 同一条）：下载循环是 data 层的模块级单例，关掉这个面板
//   只是组件卸载 —— 原生线程照跑，胶囊接管。
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import Sheet from "../../../components/Sheet";
import Warn from "../../../components/Warn";
import { useDownloads } from "../../../hooks/useDownloads";
import {
  downloadsPathOf,
  mb,
  planClipDownload,
  probeSizes,
  rowStatusText,
  shareOne,
  startDownload,
  stopDownload,
} from "../../../data/videoDownload";
import { bestClipOf, type WrapupClip } from "../wrapup";

export type WrapupSheetMode = "save" | "publish";

export default function WrapupSheet({
  mode: initial,
  clipId,
  createdAt,
  title,
  clips,
  best,
  busy,
  onClose,
  onPublish,
}: {
  /** 从哪一屏打开（保存 / 发布去向）；进来之后可以在两屏之间来回切 */
  mode: WrapupSheetMode;
  /** 落盘目录 key（`wrapup.clipIdOf`）；下载队列按它认"这一批是不是这一局" */
  clipId: string;
  /** 文件名里的日期那一格（这一局结束的时刻） */
  createdAt: number;
  /** 分享面板的标题（不进文件名） */
  title: string;
  /** 这一局能带走的真片（占位片已经在调用方挡掉） */
  clips: WrapupClip[];
  /** 默认带过去发布的那一段（`wrapupOf` 给的；为 null 时发布那一屏不摆主键） */
  best: WrapupClip | null;
  /** 发布页正在准备（量时长 + 写合成稿） */
  busy: boolean;
  onClose: () => void;
  /** 「发布到本站」：调用方负责写合成稿并跳 `/publish` */
  onPublish: () => void;
}) {
  const { t } = useLingui();
  const [mode, setMode] = useState<WrapupSheetMode>(initial);
  const dl = useDownloads();
  // ★ 顶到这一局才认：下载队列是全局单槽（同一时刻只跑一批），另一局的进度不能画在这上面
  const mine = dl.videoId === clipId;
  const running = dl.running && mine;
  const someoneElseRunning = dl.running && !mine;

  // 面板打开时按当前这一段算一份计划（占位片已经在 clips 里剔掉了，这里只剩真地址）
  const plan = useMemo(
    () =>
      planClipDownload({
        clipId,
        title,
        createdAt,
        clips: clips.map((clip) => ({ round: clip.round, url: clip.url, label: t`第 ${clip.round} 回合` })),
      }),
    [clipId, title, createdAt, clips, t],
  );
  const targets = plan.ok ? plan.plan.targets : [];
  const rows = mine ? dl.rows : [];
  const doneRows = rows.filter((r) => (r.status === "done" || r.status === "exists") && r.fileUri);

  // 问一次总量（与 DownloadSheet 同一套做法：HEAD 原地址，不生成派生地址）
  const [sizes, setSizes] = useState<{ total: number | null; byKey: Record<string, number | null> } | null>(null);
  const probeSeq = useRef(0);
  useEffect(() => {
    if (targets.length === 0) return;
    const my = ++probeSeq.current;
    setSizes(null);
    void probeSizes(targets).then((s) => {
      if (probeSeq.current === my) setSizes(s);
    });
  }, [targets]);

  /** 「开始保存」被拒时的那一句（重入闸 / 空批次；不许静默，铁律八） */
  const [err, setErr] = useState("");

  function begin() {
    setErr("");
    const r = startDownload(targets, { videoId: clipId, title });
    if (!r.ok) setErr(r.blocked);
  }

  const bestClip = best ?? bestClipOf(clips);
  const totalLabel = sizes?.total !== null && sizes?.total !== undefined ? t`（约 ${mb(sizes.total)}）` : "";

  return (
    <Sheet onClose={onClose} label={mode === "save" ? t`保存这一局的片子` : t`发布这一局的片子`}>
      {mode === "save" ? (
        <>
          <p className="text-sm font-bold text-slate-100">
            <Trans>把这一局的片子存到本地</Trans>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            <Trans>先存进 App，再选去处。</Trans>
          </p>

          {!plan.ok ? (
            // 走到这一屏还能被拒的只有"这台设备不支持保存"这一档（占位片在调用方就挡住了），
            // 理由原样说，不吞（铁律八）
            <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-warn-200">
              {plan.blocked}
            </p>
          ) : (
            <>
              <p className="mt-2 text-xs text-slate-400">
                <Trans>
                  这一局有 {targets.length} 段成片，会存成 {targets.length} 个文件（每回合一个）。
                </Trans>
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                <Trans>文件格式：{plan.plan.formats.map((f) => f.toUpperCase()).join(" / ")}</Trans>
              </p>

              <div className="mt-3 space-y-1.5">
                {targets.map((target) => {
                  // 连文件名一起比（同一 key 换了成片就是另一个文件，见 DownloadSheet 的同一条 ★）
                  const row = rows.find((r) => r.key === target.key && r.fileName === target.fileName) ?? null;
                  return (
                    <div key={target.key} className="rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{target.label}</span>
                        <span className="flex-none text-[11px] tabular-nums text-slate-500">
                          {rowStatusText(row, sizes?.byKey[target.key] ?? null)}
                        </span>
                      </div>
                      <p className="mt-0.5 break-all text-[10px] text-slate-400">{target.fileName}</p>
                      {row?.err && <p className="mt-1 text-[11px] leading-relaxed text-danger-300">{row.err}</p>}
                      {row?.raw && <p className="mt-0.5 break-all text-[10px] text-slate-500">{row.raw}</p>}
                      {row?.unverified && (
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          <Trans>大小未知，没法校验这一份是不是完整的。</Trans>
                        </p>
                      )}
                      {row && (row.status === "done" || row.status === "exists") && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            onClick={() => void shareOne(row, title)}
                            className="flex-none rounded-full bg-slate-700 px-3 py-1 text-[11px] text-slate-100 active:scale-95"
                          >
                            <Trans>分享 / 另存为</Trans>
                          </button>
                          {row.share && (
                            <span className={`text-[11px] ${row.share.ok ? "text-ok-300" : "text-warn-300"}`}>
                              {row.share.msg}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 整批的结局 —— 成功要说存到哪、失败要说为什么（任务点名，不许静默） */}
              {mine && !running && dl.outcome && (
                <p
                  className={`mt-3 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                    dl.outcomeOk
                      ? "border-ok-500/40 bg-ok-500/10 text-ok-200"
                      : "border-warn-500/40 bg-warn-500/10 text-warn-200"
                  }`}
                >
                  {dl.outcome}
                </p>
              )}
              {running && (
                <p className="mt-3 text-[11px] text-slate-400">
                  <Trans>正在保存 {doneRows.length}/{rows.length} 段</Trans>
                  {dl.stopping ? t` · 正在停止（当前这一段会跑完）` : ""}
                </p>
              )}

              <button
                onClick={running ? () => stopDownload() : begin}
                disabled={someoneElseRunning || (running && dl.stopping)}
                className={`mt-3 w-full rounded-xl py-2.5 text-sm font-bold active:scale-[0.99] disabled:opacity-40 ${
                  running ? "border border-slate-600 text-slate-200" : "bg-gold/90 text-ink"
                }`}
              >
                {running ? <Trans>停止</Trans> : <Trans>开始保存{totalLabel}</Trans>}
              </button>
              {someoneElseRunning && (
                <Warn className="mt-1">
                  <Trans>正在保存另一批片子，等它完成或点停止再来。</Trans>
                </Warn>
              )}
              {err && <p className="mt-1 text-[11px] leading-relaxed text-danger-300">{err}</p>}

              <p className="mt-3 break-all text-[11px] leading-relaxed text-slate-500">
                <Trans>文件落在 App 缓存目录 {downloadsPathOf(clipId)} 下。</Trans>
              </p>
            </>
          )}

          {/* 平台那一格：不摆假键，说清 App 现在做不到什么、人该怎么做（见文件头 ★★） */}
          <div className="mt-3 rounded-xl border border-slate-700/70 bg-panel/60 px-3 py-2">
            <p className="text-xs font-semibold text-slate-300">
              <Trans>想发到 B 站、抖音这些平台？</Trans>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <Trans>
                App 现在还不能直连平台发布（没有平台授权，也没有上传接口）。这里的片子存好之后，去对应的平台 App
                或浏览器里上传就行。
              </Trans>
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-bold text-slate-100">
            <Trans>把这一局最好的那一段发出去</Trans>
          </p>
          {bestClip ? (
            <p className="mt-1 text-xs text-slate-400">
              <Trans>
                第 {bestClip.round} 回合 · ❤ {bestClip.likes} · 🗳 {bestClip.votes}
              </Trans>
              {bestClip.rank !== null ? t` · 第 ${bestClip.rank} 名` : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              <Trans>这一局没有能发出去的成片。</Trans>
            </p>
          )}

          <button
            onClick={onPublish}
            disabled={busy || !bestClip}
            className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {busy ? <Trans>正在准备发布页…</Trans> : <Trans>发布到本站（IdeaHub）</Trans>}
          </button>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <Trans>标题、封面、简介会先按这一段填好，发布页上还能改。</Trans>
          </p>

          <div className="mt-3 rounded-xl border border-slate-700/70 bg-panel/60 px-3 py-2">
            <p className="text-xs font-semibold text-slate-300">
              <Trans>发到 B 站、抖音这些平台</Trans>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <Trans>
                App 现在没有直连平台的发布能力（没有平台授权，也没有上传接口），所以这一格不摆一颗发不出去的键。
                先把成片保存到本地，再去平台 App 或浏览器里上传。
              </Trans>
            </p>
            <button
              onClick={() => setMode("save")}
              className="mt-2 w-full rounded-xl border border-slate-600 py-2 text-xs text-slate-200 active:scale-[0.99]"
            >
              <Trans>⬇️ 先保存到本地</Trans>
            </button>
          </div>
        </>
      )}

      <div className="mt-3 flex gap-2">
        {mode === "save" && (
          <button
            onClick={() => setMode("publish")}
            disabled={running}
            className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm text-slate-300 disabled:opacity-40"
          >
            <Trans>🚀 发布</Trans>
          </button>
        )}
        <button onClick={onClose} className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm text-slate-300">
          {running ? <Trans>关掉（保存继续跑）</Trans> : <Trans>关掉</Trans>}
        </button>
      </div>
    </Sheet>
  );
}
