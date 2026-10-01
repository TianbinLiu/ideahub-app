/**
 * 启梦老师（老师人格）的请求层 —— 契约在 server `docs/api-contract.md`「老师人格（tutor）」/ tutor 仓 docs/05 §5.6；
 * 官网 `client/src/api/tutor.ts` 是它的兄弟（同一批端点、同一套形状），这里只声明 App 上课 / 建课用到的那一部分。
 *
 * ★ 走 client.ts 的 apiGet / apiPost / apiPatch：鉴权头、超时、离线整句拒（OFFLINE）、401 广播都只在那一处；
 *   SSE 走 api/stream.ts（同一份 Content-Type 判能力）。
 * ★ 「这台服务器有没有 /api/tutor」看回包**形状**不看状态码：Capacitor 对未命中路径回 200 + index.html（CLAUDE.md 坑表），
 *   client.request 会把那份 HTML 当字符串交回来 —— `shape()` 把它整句拒成 501 UNSUPPORTED，页面上说「这台服务器还没有启梦老师」。
 * ★ 教学记录是服务端真相：这里没有任何 IndexedDB 落盘（tutor 仓 docs/06 §6.1「不进 IndexedDB」）。离线模式由页面在进门时整句说「需要联网」。
 */
import { t } from "@lingui/core/macro";
import { ApiError, apiGet, apiPatch, apiPost } from "./client";
import { streamSseRequest } from "./stream";

// ── 形状（与 docs/03 格式 / docs/05 §3 对齐；服务端多回的字段一律忽略，少回的判否定）──────────────────
export type Anchor = { material: string; page: number; chunk?: string; start?: number; end?: number; quote: string };
export type WalkStep = { say: string; ask?: string; anchor?: Anchor };
export type Anchored = string | { text: string; anchor?: Anchor };
export type SelfCheck = { q: string; a: string; kind: "calc" | "concept" | "debug"; rubric?: string };
export type Stage = { stage_id: string; title: string; status: string; summary?: string };
export type DistillStage = { title?: string; method: string; walkthrough?: WalkStep[]; must_memorize: Anchored[]; self_checks: SelfCheck[]; pitfalls: Anchored[] };
export type TutorDoc = {
  id: string;
  name: string;
  subject: string;
  version: number;
  card: { who: string; catchphrases: string[]; teaching_style: string; greeting?: string };
  map: { stages: Stage[] };
  distill: Record<string, DistillStage>;
};
export type StageStatus = "pending" | "taught" | "passed";
export type StageProgress = { status: StageStatus; stepIdx: number; quiz?: { correct: number; asked: number; at: string }; passedAt?: string; nextReviewAt?: string };
export type Run = {
  id: string;
  status: "active" | "done";
  progress: Record<string, StageProgress>;
  currentStage: string | null;
  usage: { turns: number; tokens: number };
  lastTurnSeq: number;
  demo: boolean;
  dueReviews?: { stage_id: string; title: string }[];
  pendingReview?: number;
};
export type Material = { sha: string; short: string; name: string; ext: string; units: number; chars: number; present: boolean; url: string; textUrl: string };
export type Page = { idx: number; title?: string; blocks: { hash: string; text: string; bbox?: number[] }[] };
export type TurnFlags = { homeworkDetected?: boolean; policyBlocked?: boolean };
export type Turn = { seq: number; role: "user" | "assistant"; kind: string; text: string; stage_id: string; flags?: TurnFlags; feedback?: 1 | -1 | null; demo?: boolean; at: string };
export type QuizResult = { q: string; expected: string; given: string; correct: boolean; why: string };
export type QuizReply = { ok: true; results: QuizResult[]; correct: number; asked: number; passed: boolean; progress: Record<string, StageProgress>; status: Run["status"]; changed: string[]; nextStage: string | null; distillQueued?: boolean };
/**
 * 这门课的老师在启梦人格市场里的身份（M4）：`enabled` = 作者发布时勾了「同时发布为启梦人格 / 可装进看板娘」，
 * 只有这时老师才会说话（TTS + Live2D 舞台）；没勾的是纯文字。null = 这门课既没发布过、也不是从市场开出来的（自己的草稿课）。
 */
export type TutorCompanion = { personaId: string; name: string; enabled: boolean } | null;
export type RunBundle = { ok: true; run: Run; doc: TutorDoc; materials: Material[]; turns: Turn[]; companion?: TutorCompanion };
export type CourseSummary = {
  id: string;
  title: string;
  subject: string;
  code?: string;
  term?: string;
  createdAt: string;
  materials: number;
  persona: { id: string; name: string; version: number; stages: number } | null;
  run: { status: "active" | "done"; currentStage: string | null; dueReviews?: number; pendingReview?: number } | null;
  published?: { shared: boolean; version: number; companion?: { enabled: boolean } | null } | null;
  source?: { personaId: string; personaName?: string; version: number } | null;
};
export type PolicyInput = { ai: "prohibited" | "limited" | "allowed"; homework_mode: "principles_only" | "full"; allowed_uses: string[]; text: string };
export type CourseInput = { title: string; subject: string; code?: string; term?: string; policy: PolicyInput; key_dates: { label: string; at: string; kind: "exam" | "homework" | "project" | "other" }[] };
export type LicenseSource = "self" | "instructor_public" | "instructor_consent" | "unsure";
/** 下拉里的顺序（自有 → 老师公开 → 老师同意 → 不确定），与 server 的 SUPPORTED 一致 */
export const LICENSES: LicenseSource[] = ["self", "instructor_public", "instructor_consent", "unsure"];
export type MaterialEntry = Material & { license: { source: LicenseSource }; parsed: { status: "ok" | "failed" | "pending"; chars?: number; warnings?: string[] }; inDoc: boolean };
/** 教材直传票：putUrl 是 Cloudinary 的上传地址，params 要**原样逐字段**转发（多签一个没发、发了一个没签都只会得到 Invalid Signature） */
export type MaterialTicket = { ok: true; ticket: string; putUrl: string; publicId: string; params: Record<string, string | number | boolean>; maxBytes: number; chunkBytes: number };
export type Questionnaire = { name: string; style: "calc_first" | "socratic" | "failure_first"; catchphrase?: string; strictness?: "gentle" | "firm" | "strict" };
export type Quote = { lines: { kind: string; n: number; why: string; each: number; tokens: number }[]; total: number; demo: boolean; suggested: boolean };
export type Job = {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed";
  progress: { step: string; done: number; total: number; message: string; mode: "model" | "demo" };
  result?: { personaId: string; version: number; stages: number } | null;
  error?: string | null;
  failures: string[];
};
export type DistillReply = { ok: true; status: "done" | "empty" | "failed" | "nothing"; why?: string; errors?: string[]; revision: { id: string; summary: string } | null; learned: { applied: number; pending: number } | null; pendingReview: number; version: number };

// ── 请求 ─────────────────────────────────────────────────────────────────────
const unsupported = () => new ApiError(t`这台服务器还没有启梦老师（/api/tutor 不在）`, 501, "UNSUPPORTED");
/** 回包得是个对象：SPA 回退给的 HTML 会以字符串形状到这里，整句拒成「这台服务器还没有」 */
function shape<T extends object>(r: unknown): T {
  if (!r || typeof r !== "object" || Array.isArray(r)) throw unsupported();
  return r as T;
}
const enc = encodeURIComponent;
const runPath = (id: string) => `/api/tutor/runs/${enc(id)}`;

/** 这台服务器开没开老师人格（GET /api/tutor/health 不鉴权）。没挂 /api/tutor 的老服务端回 404 JSON、SPA 回退回 HTML —— 两种都算「没有」 */
export async function tutorHealth(): Promise<{ tutor: boolean; demo: boolean }> {
  try {
    const r = shape<{ tutor?: boolean; demo?: boolean }>(await apiGet("/api/tutor/health", { auth: false, timeoutMs: 8_000 }));
    return { tutor: r.tutor !== false, demo: !!r.demo };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.code === "UNSUPPORTED")) return { tutor: false, demo: false };
    throw e;
  }
}
export const getTutorConfig = async () => shape<{ ok: true; prices: Record<string, number>; demo: boolean; adultDeclared: boolean; adultDeclaredAt: string | null }>(await apiGet("/api/tutor/config"));
export const declareAdult = async () => shape<{ ok: true; adultDeclaredAt: string }>(await apiPost("/api/tutor/declare-adult", {}));
export const listCourses = async () => shape<{ ok: true; courses: CourseSummary[] }>(await apiGet("/api/tutor/courses"));
export const createCourse = async (body: CourseInput) => shape<{ ok: true; course: CourseSummary }>(await apiPost("/api/tutor/courses", body));
export const getCourse = async (id: string) => shape<{ ok: true; course: CourseSummary; materials: MaterialEntry[] }>(await apiGet(`/api/tutor/courses/${enc(id)}`));
/** 学习页 bundle：run + doc + 教材清单 + 最近 60 轮（+ M4 的 companion） */
export const getRun = async (id: string) => shape<RunBundle>(await apiGet(runPath(id), { timeoutMs: 30_000 }));
/** 块级文本（服务端给的是相对路径 /api/tutor/materials/:sha/text，client.buildUrl 会补 API_BASE） */
export const getMaterialText = async (textUrl: string) => shape<{ sha: string; pages: Page[] }>(await apiGet(textUrl, { timeoutMs: 30_000 }));
export const patchProgress = async (id: string, stage: string, stepIdx: number) => shape<{ ok: true; progress: Record<string, StageProgress>; status: Run["status"] }>(await apiPatch(`${runPath(id)}/progress`, { stage, stepIdx }));
/** 自检：判分与翻状态都在服务端（模型判卷可能要等一会） */
export const postQuiz = async (id: string, stage: string, answers: string[]) => shape<QuizReply>(await apiPost(`${runPath(id)}/quiz`, { stage, answers }, { timeoutMs: 120_000 }));
export const postSkip = async (id: string, stage: string) => shape<{ ok: true; progress: Record<string, StageProgress>; status: Run["status"]; nextStage: string | null }>(await apiPost(`${runPath(id)}/skip`, { stage }));
export const postFeedback = async (id: string, seq: number, value: 1 | -1 | null) => shape<{ ok: true }>(await apiPost(`${runPath(id)}/feedback`, { seq, value }));
/** 「整理一下」：手动蒸馏（tutor_distill 计费；服务端 170 秒内给回执） */
export const postDistill = async (id: string) => shape<DistillReply>(await apiPost(`${runPath(id)}/distill`, {}, { timeoutMs: 170_000 }));
export const materialExists = async (courseId: string, sha256: string) => shape<{ ok: true; exists: boolean; material: MaterialEntry | null }>(await apiGet(`/api/tutor/courses/${enc(courseId)}/materials`, { query: { sha256 } }));
export const signMaterial = async (body: { courseId: string; format: string; bytes: number; name: string }) => shape<MaterialTicket>(await apiPost("/api/tutor/materials/sign", body));
export const confirmMaterial = async (body: { ticket: string; courseId: string; sha256: string; name: string; mime: string; bytes: number; license: { source: LicenseSource }; pages: Page[]; warnings: string[] }) =>
  shape<{ ok: true; duplicate: boolean; material: MaterialEntry; message?: string }>(await apiPost("/api/tutor/materials/confirm", body, { timeoutMs: 60_000 }));
export const getQuote = async (courseId: string) => shape<{ ok: true; materials: number; sections: number; stages: number; quote: Quote | null; demo: boolean }>(await apiGet(`/api/tutor/courses/${enc(courseId)}/quote`));
/** 生成作业：受理即按整份报价扣（202 + 轮询 getJob） */
export const startGenerate = async (courseId: string, questionnaire: Questionnaire) => shape<{ ok: true; jobId: string; quote: Quote; nameHint: string | null }>(await apiPost("/api/tutor/personas/generate", { courseId, questionnaire }));
export const getJob = async (jobId: string) => shape<{ ok: true; job: Job }>(await apiGet(`/api/tutor/jobs/${enc(jobId)}`));
/** 引流位度量（M3）：入口带的 ?from= 记一行，只记不奖励；白名单与按天去重在服务端 */
export const postReferral = async (from: string, path: string) => shape<{ ok: true; recorded: boolean; reason?: string }>(await apiPost("/api/tutor/referral", { from, path }));

// ── 一轮 SSE（token / sentence / done / error）────────────────────────────────
export type TurnBody = { kind: "ask" | "teach"; stage: string; text?: string };
export type TurnDone = { seq: number; kind: string; text: string; flags?: TurnFlags; demo: boolean; stage: string; progress: Record<string, StageProgress>; status: Run["status"]; changed: string[]; distillQueued?: boolean };
export type TurnHandlers = { onToken?: (t: string) => void; onSentence?: (s: { index: number; text: string }) => void; onDone: (d: TurnDone) => void };

/** POST 一个 JSON、读回一条 SSE 流。传输那一半（鉴权 / Content-Type 判能力 / 分块解析 / error 事件转 throw）在 api/stream.ts 一处实现 */
export function streamTurn(id: string, body: TurnBody, handlers: TurnHandlers, signal?: AbortSignal): Promise<void> {
  return streamSseRequest(
    `${runPath(id)}/turns`,
    body,
    ({ event, data }) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event === "token") handlers.onToken?.(String(payload.t ?? ""));
      else if (event === "sentence") handlers.onSentence?.({ index: Number(payload.index ?? 0), text: String(payload.text ?? "") });
      else if (event === "done") handlers.onDone(payload as unknown as TurnDone);
    },
    { signal, unsupported: t`这台服务器还没有老师会话（回的不是事件流）` },
    ({ event, data }) => {
      if (event !== "error") return "";
      try {
        return String((JSON.parse(data) as { message?: string }).message || "tutor upstream failed");
      } catch {
        return "tutor upstream failed";
      }
    },
  );
}
