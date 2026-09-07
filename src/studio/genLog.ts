// 出片过程的步骤日志。
//
// 为什么要有它：出一段视频要跑好几步（按圈选改设定帧 → 补画起拍/结束画面 → 交给
// Seedance 排队渲染 → 回捞真实尾帧），慢的时候好几分钟。此前 UI 只有一个会被不断
// 顶替的 progress 字符串——用户看到的是一行忽然变成另一行，既不知道已经过了哪几步，
// 也不知道现在这步卡了多久，看起来就像"卡住了"。
//
// 形态对齐 Claude Code 的执行日志：一条竖线串起若干步，每步带状态点与耗时，
// 正在跑的那步高亮，跑完的置灰留在原地——过程可回溯，而不是只剩最后一行。
import { uid } from "../types";

export interface GenStep {
  id: string;
  /** 这一步在做什么（固定文案，不是 AI 自由输出） */
  title: string;
  /** 这一步的实时细节，只在 running 时展示（如"极速档 · 排队中 12s"）；keep 的步收尾后也留着 */
  detail?: string;
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
    begin(title: string, opts?: { keep?: boolean }) {
      closeCurrent("done");
      startedAt = now();
      steps = [...steps, { id: uid("gs"), title, status: "running", ...(opts?.keep ? { keep: true } : {}) }];
      flush();
    },
    /** 更新当前步的实时细节 */
    detail(text: string) {
      const cur = steps[steps.length - 1];
      if (!cur || cur.status !== "running") return;
      if (cur.detail === text) return; // 同一句话不重复触发重绘（轮询每秒都在报）
      cur.detail = text;
      flush();
    },
    /** 收尾当前步 */
    end() {
      closeCurrent("done");
      flush();
    },
    /** 当前步失败，并把原因写在标题上 */
    fail(title: string) {
      closeCurrent("error");
      const cur = steps[steps.length - 1];
      if (cur) cur.title = title;
      flush();
    },
    get steps() {
      return steps;
    },
  };
}

/**
 * 把 ai 层报上来的自由文案归一成「标题 / 细节」两层。
 * ai/real.ts 的 onProgress 是一路平铺的短句（"任务创建中…"、"标准档 · 生成中 12s"），
 * 直接一句一步会刷出几十条一模一样的行；这里把"同一件事的进展"折进同一步的 detail。
 */
export function splitStatus(status: string): { title: string; detail?: string; terminal?: boolean; keep?: boolean } {
  // composeSegments 收尾时会报一句"完成"。它不是新的一步，是"上一步跑完了"——
  // 当成一步会在日志尾巴上挂一条 0.0s 的空条目
  if (/^(完成|全部完成)$/.test(status.trim())) return { title: "", terminal: true };
  // ★ 转存单独成一步（2026-09-06）：它带着 "xx档 · " 前缀报上来，折进「渲染视频」就看不见「转存没成」这句了 ——
  //   而它决定了后面截帧走哪条路（Cloudinary 抽帧 / 代理整条下载），真机排查时正是这一步不见了
  const t = status.match(/^(?:.+?档\s*·\s*)?(成片转存.*)$/);
  if (t) return { title: t[1].replace(/[…\.]+$/, "") };
  // "标准档 · 生成中 12s" / "极速档 · 排队中 6s" —— 同一步的读秒
  // 生成契约（real.describeGenSpec）：标题固定、正文是那一串参数，别让整行当标题
  const c = status.match(/^契约\s*·\s*(.+)$/);
  if (c) return { title: "生成契约", detail: c[1], keep: true }; // 契约正文是对账记录，收尾后保留（GenStep.keep）
  const m = status.match(/^(.+?档)\s*·\s*(.+)$/);
  if (m) return { title: "渲染视频", detail: `${m[1]} · ${m[2]}` };
  return { title: status.replace(/[…\.]+$/, "") };
}
