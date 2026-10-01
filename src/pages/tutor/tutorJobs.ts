/**
 * 「生成老师」的长活（M4；CLAUDE.md「长活登记进 data/jobs，胶囊只有一颗」）：受理即按整份报价扣，生成要几十秒到几分钟 ——
 * 人退出向导页也不该断。轮询跑在**模块级**（不随组件卸载停），进度 update() 到票上，成了 done({ route: 上课页 })、败了 fail()；
 * 向导页只订阅这里的状态来画进度。人还在向导页上时 done 用 silent（页面自己跳去上课）。
 * ★ 文案由调用方传进来（模块顶层不许翻译：开机语言会冻结，CLAUDE.md「界面文案走 Lingui」那条）。
 */
import { currentRoute, startJob } from "../../data/jobs";
import { getJob, startGenerate, type Job, type Questionnaire, type Quote } from "../../api/tutor";

export type GenState = { jobId: string; courseId: string; status: Job["status"]; progress: Job["progress"] | null; error: string | null; failures: string[]; quote: Quote | null };

const states = new Map<string, GenState>(); // 按课程：一门课同时只有一发
const subs = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  subs.forEach((fn) => fn());
};
export function subscribeGen(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
export const genVersion = () => version;
export const genStateOf = (courseId: string): GenState | null => states.get(courseId) ?? null;

const POLL_MS = 1000;
/** 30 分钟：服务端的生成作业本来就有上限，轮到头当失败说出来（别让票永远转圈） */
const MAX_POLLS = 1800;

export type GenTexts = {
  title: string;
  progressOf: (p: Job["progress"]) => string;
  done: string;
  failed: (why: string) => string;
  timeout: string;
};

/** 受理成功回 jobId（抛错 = 没受理、没扣钱，由页面就地说明）；之后的轮询与票都在这里 */
export async function startGenerateJob(courseId: string, questionnaire: Questionnaire, texts: GenTexts): Promise<string> {
  const r = await startGenerate(courseId, questionnaire);
  const startedOn = currentRoute();
  const route = `/tutor/run/${encodeURIComponent(courseId)}`;
  const ticket = startJob({ kind: "tutor-generate", title: texts.title, page: startedOn, route });
  const set = (patch: Partial<GenState>) => {
    const prev = states.get(courseId) ?? { jobId: r.jobId, courseId, status: "pending" as const, progress: null, error: null, failures: [], quote: r.quote };
    states.set(courseId, { ...prev, ...patch });
    emit();
  };
  set({ jobId: r.jobId, status: "pending", quote: r.quote });
  void (async () => {
    for (let n = 0; n < MAX_POLLS; n++) {
      // eslint-disable-next-line no-await-in-loop -- 就是要一拍一拍地问
      await new Promise((res) => setTimeout(res, POLL_MS));
      let job: Job;
      try {
        // eslint-disable-next-line no-await-in-loop
        job = (await getJob(r.jobId)).job;
      } catch {
        continue; // 网络抖一下：下一拍再问
      }
      set({ status: job.status, progress: job.progress, error: job.error ?? null, failures: job.failures ?? [] });
      ticket.update(texts.progressOf(job.progress));
      if (job.status === "succeeded") {
        // 人还在向导页上 → 页面自己跳去上课，不再弹一条重复的通知
        if (currentRoute() === startedOn) ticket.done({ silent: true });
        else ticket.done({ msg: texts.done, route });
        return;
      }
      if (job.status === "failed") {
        ticket.fail(texts.failed(job.error || "?"), route);
        return;
      }
    }
    set({ status: "failed", error: texts.timeout });
    ticket.fail(texts.timeout, route);
  })();
  return r.jobId;
}
