// 出片过程的步骤日志。
//
// 为什么要有它：出一段视频要跑好几步（按圈选改设定帧 → 补画起拍/结束画面 → 交给
// Seedance 排队渲染 → 回捞真实尾帧），慢的时候好几分钟。此前 UI 只有一个会被不断
// 顶替的 progress 字符串——用户看到的是一行忽然变成另一行，既不知道已经过了哪几步，
// 也不知道现在这步卡了多久，看起来就像"卡住了"。
//
// 形态对齐 Claude Code 的执行日志：一条竖线串起若干步，每步带状态点与耗时，
// 正在跑的那步高亮，跑完的置灰留在原地——过程可回溯，而不是只剩最后一行。
import { t } from "@lingui/core/macro";
import { GEN_MODE_LABEL, decodeGenEvent, describeArkProgress, type GenEvent } from "../ai/arkClient";
import { tierOf } from "../data/economy";
import { uid } from "../types";

export interface GenStep {
  id: string;
  /** 这一步在做什么（固定文案，不是 AI 自由输出） */
  title: string;
  /** 这一步的实时细节，只在 running 时展示（如"极速档 · 排队中 12s"）；keep 的步收尾后也留着 */
  detail?: string;
  /**
   * 产生这一步（或它最后一条细节）的结构化事件（2026-09-16 多语言）：码 + 参数，随草稿落盘。
   * title / detail 是写入那一刻按界面语言写成的句子；渲染层按这一格重写它们（stepText），老草稿没有这一格，照旧显示存下的句子。
   * 只有 ai 层报上来的事件行（契约 / 轮询读秒 / 转存）才有；segmentGen 的人话步骤没有。
   */
  event?: GenEvent;
  /**
   * 收尾后**保留** detail（2026-09-06）：「生成契约」那一步的正文是这一发到底发了什么（模式 / 档 / 画幅 / 时长 / 参考几张），
   * 是给人事后对账的记录，不是"此刻在干嘛"的读秒 —— 此前它随下一步开始被 closeCurrent 清掉，用户从来没看见过那行字。
   */
  keep?: boolean;
  status: "running" | "done" | "error";
  /** 完成耗时（毫秒），done/error 时才有 */
  ms?: number;
}

/**
 * 步骤日志累加器。每次变更都产出**新数组**交给调用方写进 store——
 * 原地 push 的话 zustand 比较引用不变，界面不会重绘。
 *
 * 用法：
 *   const log = createGenLog((steps) => patchNode({ steps }));
 *   log.begin("绘制起拍画面");
 *   log.detail("已用 6 秒");
 *   log.end();            // 收尾当前步
 *   log.fail("出片失败：…"); // 或者标红
 */
export function createGenLog(onChange: (steps: GenStep[]) => void, now: () => number = Date.now) {
  let steps: GenStep[] = [];
  let startedAt = 0;

  const flush = () => onChange(steps.map((s) => ({ ...s })));

  const closeCurrent = (status: "done" | "error") => {
    const cur = steps[steps.length - 1];
    if (cur && cur.status === "running") {
      cur.status = status;
      cur.ms = now() - startedAt;
      if (!cur.keep) cur.detail = undefined; // 细节是"此刻在干嘛"，收尾后留着只是噪音（keep 的除外，见字段注释）
    }
  };

  return {
    /** 开一步（自动收尾上一步） */
    begin(title: string, opts?: { keep?: boolean; event?: GenEvent }) {
      closeCurrent("done");
      startedAt = now();
      steps = [
        ...steps,
        { id: uid("gs"), title, status: "running", ...(opts?.keep ? { keep: true } : {}), ...(opts?.event ? { event: opts.event } : {}) },
      ];
      flush();
    },
    /** 更新当前步的实时细节（带事件的话一并留下，见 GenStep.event） */
    detail(text: string, event?: GenEvent) {
      const cur = steps[steps.length - 1];
      if (!cur || cur.status !== "running") return;
      if (cur.detail === text) return; // 同一句话不重复触发重绘（轮询每秒都在报）
      cur.detail = text;
      if (event) cur.event = event;
      flush();
    },
    /** 收尾当前步 */
    end() {
      closeCurrent("done");
      flush();
    },
    /** 当前步失败，并把原因写在标题上。★ 事件一并抹掉：标题已经是失败原因，留着事件的话按事件重写的读法会把它盖回「渲染视频」 */
    fail(title: string) {
      closeCurrent("error");
      const cur = steps[steps.length - 1];
      if (cur) {
        cur.title = title;
        delete cur.event;
      }
      flush();
    },
    get steps() {
      return steps;
    },
  };
}

/** splitStatus 归一出来的一步：标题 / 细节 / 是不是终点 / 收尾后留不留细节 / 结构化来源 */
export interface StepLine {
  title: string;
  detail?: string;
  terminal?: boolean;
  keep?: boolean;
  event?: GenEvent;
}

/**
 * 把 ai 层报上来的进度行归一成「标题 / 细节」两层。
 * 两种进度行：**事件行**（arkClient.encodeGenEvent：契约 / 轮询读秒 / 转存 / 完成）与 segmentGen 的人话短句
 * （"绘制起拍画面…"、"任务创建中…"）。直接一句一步会刷出几十条一模一样的行；这里把"同一件事的进展"折进同一步的 detail。
 * ★ 2026-09-16 起按**事件**折叠，不再拿正则认「排队中」「成片转存」「xx档 · 」「完成」这几个中文串 ——
 *   句子按界面语言现写，认字的折叠在英文界面下会静默失效。下面那几条正则原样留着，只为老的中文进度行兜底
 *   （今天没有谁再发它们；事件行走上面 stepOf）。
 */
export function splitStatus(status: string): StepLine {
  const ev = decodeGenEvent(status);
  if (ev) return stepOf(ev);
  // composeSegments 收尾时会报一句"完成"。它不是新的一步，是"上一步跑完了"——
  // 当成一步会在日志尾巴上挂一条 0.0s 的空条目
  if (/^(完成|全部完成)$/.test(status.trim())) return { title: "", terminal: true };
  // ★ 转存单独成一步（2026-09-06）：它带着 "xx档 · " 前缀报上来，折进「渲染视频」就看不见「转存没成」这句了 ——
  //   而它决定了后面截帧走哪条路（Cloudinary 抽帧 / 代理整条下载），真机排查时正是这一步不见了
  const xfer = status.match(/^(?:.+?档\s*·\s*)?(成片转存.*)$/);
  if (xfer) return { title: xfer[1].replace(/[…\.]+$/, "") };
  // "标准档 · 生成中 12s" / "极速档 · 排队中 6s" —— 同一步的读秒
  // 生成契约（real.describeGenSpec）：标题固定、正文是那一串参数，别让整行当标题
  const c = status.match(/^契约\s*·\s*(.+)$/);
  if (c) return { title: t`生成契约`, detail: c[1], keep: true }; // 契约正文是对账记录，收尾后保留（GenStep.keep）
  const m = status.match(/^(.+?档)\s*·\s*(.+)$/);
  if (m) return { title: t`渲染视频`, detail: `${m[1]} · ${m[2]}` };
  return { title: status.replace(/[…\.]+$/, "") };
}

/** 事件 → 步骤。句子在这里按当前界面语言写；事件本身随步骤留着（GenStep.event） */
function stepOf(ev: GenEvent): StepLine {
  // composeSegments 收尾：不是新的一步，是"上一步跑完了"——当成一步会在日志尾巴上挂一条 0.0s 的空条目
  if (ev.kind === "done") return { title: "", terminal: true };
  // 生成契约：标题固定、正文是那一串参数，收尾后保留（GenStep.keep）—— 它是给人事后对账的记录
  if (ev.kind === "contract") return { title: t`生成契约`, detail: contractLine(ev), keep: true, event: ev };
  const tierLabel = tierOf(ev.tier).label;
  // ★ 转存单独成一步（2026-09-06）：折进「渲染视频」就看不见「转存没成」这句了 ——
  //   而它决定了后面截帧走哪条路（Cloudinary 抽帧 / 代理整条下载），真机排查时正是这一步不见了
  if (ev.kind === "transfer") return { title: t`成片转存中（换成永久地址）`, event: ev };
  if (ev.kind === "transferFailed") {
    const reason = ev.reason;
    return { title: t`成片转存没成（${reason}）——先用方舟临时链接，预览帧稍后自动补上`, event: ev };
  }
  // "标准档 · 生成中 12s" / "极速档 · 排队中 6s" —— 同一步的读秒（句子与剪辑页 busy 行同一份实现）
  return { title: t`渲染视频`, detail: describeArkProgress(tierLabel, ev), event: ev };
}

/** 契约那一行的正文（模式 / 档 / 画幅 / 时长 / 参考几张 / 承接 / 字数）。只描述、不判断——判断在 real.validateGenSpec */
function contractLine(ev: Extract<GenEvent, { kind: "contract" }>): string {
  const mode = GEN_MODE_LABEL[ev.mode] ?? ev.mode;
  const tierLabel = tierOf(ev.tier).label;
  const ratio = ev.ratio;
  const images = ev.images;
  const audios = ev.audios;
  const chars = ev.chars;
  const refSec = ev.refSec;
  const durationSec = ev.durationSec;
  // 时长这一格：edit 模式输出跟随参考片（登记过源片时长就带上），其余按申报秒数
  const dur = ev.mode === "edit" ? (refSec ? t`时长跟随参考片 ${refSec}s` : t`时长跟随参考片`) : `${durationSec}s`;
  return ev.carried
    ? t`${mode} · ${tierLabel} · ${ratio} · ${dur} · 参考图 ${images} · 参考音频 ${audios} · 承接上一段尾帧 · 提示词 ${chars} 字`
    : t`${mode} · ${tierLabel} · ${ratio} · ${dur} · 参考图 ${images} · 参考音频 ${audios} · 提示词 ${chars} 字`;
}
