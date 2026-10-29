// 真人档（MiniMax 海螺）的出片客户端 —— 卡片系统 V2 真人分支（2026-08-24）。
// ★ 2026-10-26 起这里还有 **MiniMax H3（V2 接口）** 的一套：minimaxV2Video（出片）/ takeMinimaxV2Task（取回），走服务端 /api/minimax/v2
//   （出片地区 P2b：海外的「草稿 / 高清 / 电影级」，境内的人也能选）。两套接口别混用 —— 文件下半那一节的头上写了差在哪儿。
//   用哪一套只看档位的 api（economy.apiCase；分流点在 ai/real.composeSegments 与 takeVideoTask），不看供应商。
//
// 为什么另起一家供应商：方舟对真人参考图两套探测器全拦（名人版权、普通人隐私，
// 全任务形态实测），海螺同一批图输入输出两端都放行且成片落地（三发探针全 Success，
// docs/card-system-v2-design.md 有矩阵）。⚠ 2026-09-26 起服务端走 MiniMax **国际站**（api.minimax.io，
// server config/minimax 的区域分流）—— 真人照片是出境的，此前这里写的「境内、无人脸出境问题」已不成立。
//
// ★ 路径形状以 **server 代理**（/api/minimax/video、/video/:taskId、/file/:fileId）为准，
//   dev 由 vite 代理把同样的路径改写到上游（vite.config.ts）——两个环境同一套客户端代码。
//   密钥永远不在前端：dev 是 vite 注头，生产是 server 注头（同 /api/ark 的纪律）。
// ★ 判断"这台服务器有没有这个能力"看响应形状与 Content-Type，不信状态码
//   （Capacitor 的 SPA 回退对未命中路径回 200 + index.html，CLAUDE.md 有专条）。
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { API_BASE } from "../api/client";
import { getToken, withAppVersion } from "../api/client";
import {
  ArkBadReply,
  ArkHttpError,
  ArkNoReply,
  ArkTaskFailed,
  ArkTaskUnknown,
  billingDenialError,
  syncWalletFromHeaders,
  taskRefundOf,
  type ArkProgress,
} from "./arkClient";

/** 上游受理回执的业务码：0 = 成功。非 0 时 status_msg 是给人看的原因 */
interface BaseResp {
  status_code: number;
  status_msg: string;
}

const BASE = `${API_BASE}/api/minimax`;

/**
 * 三发请求各等多久（2026-10-15 教材人格评审：原来三发都是裸 fetch，没有任何上限）。
 * ★★ 为什么必须有上限、而且要**大于服务端自己的转发预算**：服务端是先扣钱再转发（契约「扣费」一节），
 *   建任务那一发我们先放弃 = 服务端那一发照样跑完、钱照扣，而本机既没收到任务号也就没落凭据 ——
 *   屏幕上唯一能点的是全价「♻ 重新生成」（双倍扣）。所以客户端要等到服务端自己给出结论（它对上游超时会折成 504 回给我们，
 *   那一档走「服务端明说失败 → 退款」的路）之后再放弃；而**没有上限**的另一头更坏：弱网半开连接时 fetch 永不 settle，
 *   轮询那一发挂在 await 里，而下面那条 10 分钟死线只在循环头判，永远到不了。
 * ★ 数怎么来的：server routes/minimax.routes.js 的 T_CREATE = 120s（创建体带 base64 首帧，照 ark 的实测经验给宽）、
 *   T_POLL = 30s；这里各加余量（建任务 +30s 给请求体上行 —— 720p 首帧压过仍有 2~3MB，真机 5G 上行只有 30~40KB/s；
 *   查询 +10s）。方舟那边同类请求的数：视频任务创建 120s（arkClient.generateVideo）、查进度 20s（fetchArkTask）。
 *   Cloudflare 的 125 秒读超时挡在中间：源站一直不回时它会先于 T_CREATE_MS 掐断 —— 那也是 fetch reject，
 *   同样落进下面的 ArkNoReply，这里的上限兜的是它掐不到的那一类（半开连接、WebView 自己挂住）。
 */
const T_CREATE_MS = 150_000;
const T_QUERY_MS = 40_000;

/** @param url 这一发打到哪儿 —— 只为了让 withAppVersion 判要不要带版本头（自家服务器的 /api/ 才带） */
function authHeaders(url: string): Record<string, string> {
  // 生产（server 代理）要带登录态；dev 的 vite 代理会忽略这个头，无害
  const tk = getToken();
  return withAppVersion(url, { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) });
}

/**
 * 「一个回包都没收到」（断网 / 超时 / 网关掐断）→ ArkNoReply —— 与 arkClient.arkFetch 同一条约定（见 ArkNoReply 的 ★★）：
 * 没收到回包 ≠ 没扣钱。钱上那句话不在这里说（CLAUDE.md：只走 ai/failCharge，它认的是这个**类型**），
 * 原来这里让 fetch 的裸 TypeError 一路上抛，failCharge 判成「其余 = 没扣」，屏幕上钱一个字不提。
 * 三步各一句整话（不拿动词往句子里拼，多语言要整句）。
 */
function noReply(step: MinimaxStep, e: unknown): ArkNoReply {
  const detail = e instanceof Error ? e.message : String(e);
  return new ArkNoReply(
    step === "create"
      ? t`真人档出片创建没收到回包：${detail}`
      : step === "poll"
        ? t`真人档出片查询没收到回包：${detail}`
        : t`真人档出片取件没收到回包：${detail}`,
  );
}

/** 查询类 GET（查进度 / 取下载地址）：不计费。@param step 只为了报错时说清是哪一步（查询 / 取件） */
function getJson(url: string, step: Exclude<MinimaxStep, "create">): Promise<Response> {
  return fetch(url, { headers: authHeaders(url), signal: AbortSignal.timeout(T_QUERY_MS) }).catch((e) => {
    throw noReply(step, e);
  });
}

/** 真人档一发的三步：建任务 / 查进度 / 取下载地址。报错按步整句各写一份，不拿动词往句子里拼 */
type MinimaxStep = "create" | "poll" | "file";

async function jsonOf(res: Response, step: MinimaxStep): Promise<Record<string, unknown>> {
  // 计费代理在每个响应上带权威余额头（生产 server 写；dev 的 vite 代理没有，helper 自会跳过）。
  // 扣费/退款都发生在服务端，这里不同步的话镜像要等下一次方舟调用才自愈
  syncWalletFromHeaders(res.headers);
  const ct = res.headers.get("Content-Type") ?? "";
  const status = res.status;
  if (!ct.includes("application/json")) {
    // SPA 回退 / 网关错误页都会走到这里 —— 说清是哪一步、拿到了什么
    const type = ct || t`无类型`;
    throw new Error(
      step === "create"
        ? t`真人档出片创建失败：服务器没有应答这个接口（HTTP ${status}，${type}）`
        : step === "poll"
          ? t`真人档出片查询失败：服务器没有应答这个接口（HTTP ${status}，${type}）`
          : t`真人档出片取件失败：服务器没有应答这个接口（HTTP ${status}，${type}）`,
    );
  }
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    // ★★ 计费代理的拒绝（402 余额 / 403 套餐或欠额冻结 / 429 每日上限）与 /api/ark 同一套 code，
    //   说同一句话（arkClient.billingDenialError 一处实现，2026-09-30 补）。此前这里把整段 JSON
    //   连同服务端写死的中文 message 原样甩给用户 —— 英文界面也是中文。
    const denial = billingDenialError(status, JSON.stringify(j));
    if (denial && denial.message) throw denial;
    const body = JSON.stringify(j).slice(0, 160);
    throw new Error(
      step === "create"
        ? t`真人档出片创建失败（HTTP ${status}）：${body}`
        : step === "poll"
          ? t`真人档出片查询失败（HTTP ${status}）：${body}`
          : t`真人档出片取件失败（HTTP ${status}）：${body}`,
    );
  }
  return j;
}

function baseRespOf(j: Record<string, unknown>): BaseResp | null {
  const b = j.base_resp as BaseResp | undefined;
  return b && typeof b.status_code === "number" ? b : null;
}

/**
 * 上游明说 `Fail` → ArkTaskFailed（与方舟那边同一个类型，钱上那句话由 ai/failCharge 按它说）—— **唯一构造处**（出片轮询与取回共用）。
 * ★ 退款结论读服务端在同一个回包上带的 `refund`（server 的真人档轮询路由看见 Fail 时结账；开关 MINIMAX_FAIL_REFUND）。
 *   没带 = 服务端没说（老服务端 / 开关关着 / 上线之前的任务）—— failCharge 按「没有退回」说，不替它许诺。
 */
function minimaxFailed(taskId: string, st: Record<string, unknown>): ArkTaskFailed {
  const reason = baseRespOf(st)?.status_msg || t`上游未说明原因`;
  return new ArkTaskFailed(t`真人档出片失败：${reason}`, taskId, "Fail", String(baseRespOf(st)?.status_code ?? ""), taskRefundOf(st.refund), reason, "minimax");
}

/**
 * 一条 Success 的任务状态 → 下载地址。**唯一实现**：出片主路径与「取回」共用。
 * ★ 取件那一发**没收到回包**抛 ArkTaskUnknown 而不是 ArkNoReply（2026-10-15 教材人格评审第五节「另议」拍板）：任务已经 Success、
 *   产物在上游好好地存着，只是「文件号 → 下载地址」这一跳没答上来。归 ArkNoReply 的话 failCharge 说「可能已扣」、节点打 failed、
 *   屏幕上唯一能点的是重新下一单（再花一次钱）；归 ArkTaskUnknown 凭据留着、节点 pending、取回卡再点一次就从这一跳接着取
 *   （查询与取件都不计费，见 takeMinimaxTask 头上的 ★）。只有「没收到回包」这一档改口：HTTP 非 2xx、回包里没地址仍是整句失败。
 */
async function minimaxFileUrl(taskId: string, st: Record<string, unknown>): Promise<string> {
  const fileId = String(st.file_id ?? "");
  if (!fileId) throw new Error(t`真人档出片成功却没有文件号——上游协议变了，把这句话反馈给我们`);
  let f: Record<string, unknown>;
  try {
    f = await jsonOf(await getJson(`${BASE}/file/${encodeURIComponent(fileId)}`, "file"), "file");
  } catch (e) {
    if (!(e instanceof ArkNoReply)) throw e;
    throw new ArkTaskUnknown(t`成片已经出来了，取下载地址时没收到回包——凭据还在，过一会儿再点「取回」，不花钱。`, taskId);
  }
  const file = f.file as { download_url?: string; backup_download_url?: string } | undefined;
  const url = file?.download_url || file?.backup_download_url;
  if (!url) throw new Error(t`真人档取件失败：上游没有返回下载地址`);
  return url;
}

/**
 * 把一发已经受理过、当时没接到的真人档成片取回来。
 *
 * ★★ **这条路上不许出现下定论的句子**（除非上游明说 Fail）。方舟那边有一句
 *   「已经花掉的钱无法挽回」是对的 —— 那是 404 = 产物真过期了。而这一档我们
 *   **没有量过 MiniMax 的留存**，任何"没了"的断语都可能是对着一发还活着的成片说的，
 *   而听到这句话的用户不会来报 bug，他会直接走。
 * ★ 查询与取件都**不计费**（server 的 minimax.routes 里这两条只挂 pollLimit，
 *   没走 chargedArkCall）—— 所以"取回不再花一分钱"这句话在这一档同样是真的。
 */
export async function takeMinimaxTask(
  taskId: string,
  onProgress?: (s: string) => void,
): Promise<{ url: string }> {
  onProgress?.(t`正在向上游核对这一发的状态…（查询不花钱）`);
  let st: Record<string, unknown>;
  try {
    st = await jsonOf(await getJson(`${BASE}/video/${encodeURIComponent(taskId)}`, "poll"), "poll");
  } catch (e) {
    // 查不动 ≠ 取不回。凭据必须留着，话也不能说死。
    // ★ 抛 **ArkTaskUnknown**（与方舟那条 real.takeVideoTask 查不动 / 还在跑同一个类型，2.62 发版评审）：「这一发的结局还没核对到」
    //   要靠**类型**认，不靠这句话的措辞 —— 取回卡上退了钱的那颗「知道了」据此决定说「暂时收不起来、再点一次」还是原样说别的原因
    //  （SegmentRecoverCard.take）。普通 Error 的话两家对同一件事一个认得出、一个认不出
    const why = e instanceof Error ? e.message.slice(0, 60) : t`查询失败`;
    throw new ArkTaskUnknown(t`暂时查不到这一发（${why}）——凭据还在，过一会儿再点一次，查询不花钱。`, taskId);
  }
  const status = String(st.status ?? "");
  if (status === "Success") return { url: await minimaxFileUrl(taskId, st) };
  if (status === "Fail") {
    // 上游明说失败：抛类型（ArkTaskFailed），钱退没退由调用方问 ai/failCharge 说 —— 不在这里写死「不退款」
    //（2026-10-07 起服务端会把这一发退回；老服务端不退，那时 failCharge 照实说「没有退回」）。
    // ★ 重新生成会再花一次钱这半句仍然由调用方接上：藏起来会让用户以为重试免费
    throw minimaxFailed(taskId, st);
  }
  const shown = status || t`未知`;
  // 还没有结局：同上，ArkTaskUnknown（方舟那条 queued / running 也是它）
  throw new ArkTaskUnknown(t`这一发还在上游排队或生成中（当前状态：${shown}）——过几分钟再点一次「取回」，查询不花钱、凭据也还在。`, taskId);
}

/**
 * 把一发 **MiniMax H3（V2）** 已经受理过、当时没接到的成片取回来（2026-10-26 出片地区 P2b 审核）。规矩同 takeMinimaxTask（这条路上不下定论，除非上游明说
 * failed / cancelled），接口是 V2 的：`GET /api/minimax/v2/video/:taskId`（不计费、只给任务的主人看）回 `{ ok, status, url?, error?, refund? }`，
 * 成片地址直接在回包里（没有 V1 的取件那一步）。契约见 docs/api-contract.md「MiniMax H3（V2）出片」→「查询」。
 * ★★ 为什么单独一条（审核抓到）：取回凭据原来只记 provider，H3 的任务记成 "minimax" 之后走 takeMinimaxTask —— 拿 V2 的号去问 V1 的查询，
 *   服务端认得出是 H3 的号就回 404，取回卡永远停在「暂时查不到」，App 被杀之后也补不回来。凭据上的 api（VideoJob.api）定走哪一条。
 * ★ 不是 200 的一律**不是结局**（契约：404 TASK_NOT_FOUND / 503 / 504 / 502 / 501 / 400）—— 凭据留着、过一会儿再点（ArkTaskUnknown）。
 *   V2 没有 `expired`；成功却没给地址也按「过一会儿再点」（成片地址有时效，再查一次会给新的 —— 官方说法），不说死。
 * ⚠ 拿到的是 MiniMax 的临时地址（`video-product.cdn.minimax.io`，有时效）：调用方（real.takeVideoTask）接着转存成永久地址
 *   （real.permanentVideoUrl，出片与取回共用那一份）。
 */
export async function takeMinimaxV2Task(taskId: string, onProgress?: (s: string) => void): Promise<{ url: string }> {
  onProgress?.(t`正在向上游核对这一发的状态…（查询不花钱）`);
  const url = `${BASE}/v2/video/${encodeURIComponent(taskId)}`;
  const notYet = (why: string) => new ArkTaskUnknown(t`暂时查不到这一发（${why}）——凭据还在，过一会儿再点一次，查询不花钱。`, taskId);
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(url), signal: AbortSignal.timeout(T_QUERY_MS) });
  } catch (e) {
    throw notYet(e instanceof Error ? e.message.slice(0, 60) : t`查询失败`);
  }
  // 失败那一拍服务端会退钱、带余额头（只给账的主人）—— 同步一次，不然镜像要等下一次方舟调用才自愈
  syncWalletFromHeaders(res.headers);
  const status = res.status;
  // 判「这台服务器有没有这条路」看 Content-Type（SPA 回退是 200 + HTML），不信状态码
  if (!res.ok || !(res.headers.get("Content-Type") ?? "").includes("application/json")) throw notYet(`HTTP ${status}`);
  let st: Record<string, unknown>;
  try {
    st = (await res.json()) as Record<string, unknown>;
  } catch {
    throw notYet(`HTTP ${status}`);
  }
  const state = String(st.status ?? "");
  if (state === "succeeded") {
    const video = v2VideoUrlOf(st);
    if (!video) throw new ArkTaskUnknown(t`成片已经出来了，这一次没拿到地址——凭据还在，过一会儿再点「取回」，不花钱。`, taskId);
    return { url: video };
  }
  // 上游明说失败：抛类型（带服务端在同一个回包上说的退款结论），钱上的话由调用方问 ai/failCharge
  if (V2_FAILED.has(state)) throw minimaxV2Failed(taskId, st);
  const shown = state || t`未知`;
  throw new ArkTaskUnknown(t`这一发还在上游排队或生成中（当前状态：${shown}）——过几分钟再点一次「取回」，查询不花钱、凭据也还在。`, taskId);
}

// ════ MiniMax H3（V2）出片：创建 → 轮询（2026-10-26 出片地区 P2b；契约 docs/api-contract.md「MiniMax H3（V2）出片」）════
//
// ★★ 与真人档（V1）是**两套接口**，别混用：V2 用真的 HTTP 状态码报错、状态是小写的 succeeded / failed / cancelled（没有 expired）、
//   成片地址直接在查询回包里（没有取件那一步）、按秒计价。请求体名单外的键服务端整句拒（不悄悄丢）—— 这里只拼名单里的那几样。
// ★ 拼哪几张图、各是什么角色（首帧 / 尾帧 / 参考图）在 ai/real.composeSegments 定（GenSpec → content[]），这里只照着发、照着收。

/** V2 上游明说失败的那两个状态词（没有 expired：V2 没有这个状态） */
const V2_FAILED: ReadonlySet<string> = new Set(["failed", "cancelled"]);

/** 查询回包里的成片地址（只认 https；服务端只在 succeeded 时给） */
function v2VideoUrlOf(st: Record<string, unknown>): string {
  const u = typeof st.url === "string" ? st.url : "";
  return /^https:\/\//i.test(u) ? u : "";
}

/**
 * V2 上游明说 `failed` / `cancelled` → ArkTaskFailed（与方舟、真人档同一个类型，钱上那句话由 ai/failCharge 按它说）—— **唯一构造处**（出片轮询与取回共用）。
 * ★ 退款结论读服务端在同一个回包上带的 `refund`（只给账的主人；开关 MINIMAX_FAIL_REFUND 与真人档共用，健康端点的 minimaxFailRefund）。
 *   没带 = 服务端没说 —— failCharge 按「没有退回」说，不替它许诺。
 */
function minimaxV2Failed(taskId: string, st: Record<string, unknown>): ArkTaskFailed {
  const state = String(st.status ?? "");
  const err = st.error as { code?: unknown; message?: unknown } | undefined;
  const reason = state === "cancelled" ? t`任务被取消了` : (typeof err?.message === "string" && err.message.slice(0, 80)) || t`上游未说明原因`;
  return new ArkTaskFailed(t`MiniMax 出片失败：${reason}`, taskId, state, String(err?.code ?? ""), taskRefundOf(st.refund), reason, "minimax");
}

/** 一张图在 V2 请求里的角色（服务端白名单：首帧 / 尾帧各至多一张，参考图至多 5 张，首尾帧与参考图不能混） */
export type MinimaxV2Role = "first_frame" | "last_frame" | "reference_image";

/**
 * 创建那一发被我们自己的服务端拒了（非 2xx）→ 一句能直接显示的整句（连同错误类型）。
 * ★ 一律 ArkHttpError（带 status 与 code）：V2 的拒绝**全是没扣钱**的（契约「被拒的先后」那张表：扣费之前拒，或扣了又退、回包 billed:false），
 *   钱上的判定只认类型（ai/failCharge：服务端明说失败 = 没扣），话里**不说钱**（钱只走 failCharge）。
 * ★ 认 **code** 不认状态码（契约：429 就有三种）：每人并发到顶（IN_FLIGHT_LIMIT）、上游忙（UPSTREAM_BUSY）、V2 没开（MINIMAX_V2_OFF）、
 *   免费版带了图（PLAN_REQUIRED + freeTextOnly）、上游没受理的几种（UPSTREAM_*）各说各的；
 *   余额 / 套餐 / 冻结 / 每日上限 / 出片地区与 Seedance、真人档同一套（arkClient.billingDenialError，一处实现）。
 * ★ 白名单拒（VIDEO_PARAMS_NOT_ALLOWED）：中文界面照说服务端那句（它最清楚是哪一条没过），英文界面说本端的整句（D7 a：服务端给码、App 说话）。
 */
function v2RefusalError(status: number, body: string): Error {
  let j: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") j = parsed as Record<string, unknown>;
  } catch {
    /* 读不出 JSON：落到最后那一句 */
  }
  const code = typeof j.code === "string" ? j.code : "";
  const serverMsg = typeof j.message === "string" ? j.message : "";
  if (code === "PLAN_REQUIRED" && j.freeTextOnly === true)
    return new ArkHttpError(t`免费版用 MiniMax 出片只能用文字：这一段带着画面或参考图——开通会员套餐（或充值过任意一笔）后可以带图`, status, code);
  if (code === "IN_FLIGHT_LIMIT") {
    const limit = Number(j.limit) > 0 ? Number(j.limit) : 4;
    return new ArkHttpError(t`你同时在出的 MiniMax 视频已经有 ${limit} 段了——等其中一段出来再点`, status, code);
  }
  if (code === "UPSTREAM_BUSY") return new ArkHttpError(t`MiniMax 那边这会儿太忙——过一会儿再点`, status, code);
  if (code === "MINIMAX_V2_OFF") return new ArkHttpError(t`这台服务器没有开 MiniMax H3 出片——先换一档出片`, status, code);
  if (code === "UPSTREAM_SENSITIVE") return new ArkHttpError(t`提示词或图片没过 MiniMax 的内容审核——改一改再出片`, status, code);
  if (code === "UPSTREAM_TIMEOUT") return new ArkHttpError(t`没等到 MiniMax 回话——过一会儿再点`, status, code);
  if (code === "UPSTREAM_PARAMS" || code === "UPSTREAM_ERROR") return new ArkHttpError(t`MiniMax 那边没有受理这一发——过一会儿再点；一直这样请把这句话反馈给我们`, status, code);
  if (code === "VIDEO_PARAMS_NOT_ALLOWED")
    return new ArkHttpError(
      serverMsg && i18n.locale !== "en" ? serverMsg : t`MiniMax 出片请求里有服务器不收的东西——把这句话反馈给我们`,
      status,
      code,
    );
  if (status === 413) return new ArkHttpError(t`这一段的出片请求太大了（图片要先传到图床再发）——把这句话反馈给我们`, status, code);
  // 余额不足 / 套餐门禁 / 冻结 / 每日上限 / 出片地区 / 限流：与另外两条出片路同一处实现
  const denial = billingDenialError(status, body);
  if (denial && denial.message) return denial;
  return new ArkHttpError(t`MiniMax 出片创建失败（HTTP ${status}）`, status, code);
}

/**
 * 一发 MiniMax H3 出片：创建 → 轮询，回**上游给的临时成片地址**（`video-product.cdn.minimax.io`，有时效 —— 转存由调用方接着做，ai/real.composeSegments）。
 *
 * ★ 失败归类沿用真人档那几条（与方舟侧同一套纪律）：
 *   · 创建那一发没收到回包 → ArkNoReply（服务端先扣钱再转发：钱**可能**已经扣了，onTask 还没拿到任务号）；
 *   · 服务端拒了（非 2xx）→ v2RefusalError（全是没扣钱的）；2xx 却读不出任务号 → ArkBadReply（2xx 之后才坏 = 已计费）；
 *   · 受理之后上游明说 failed / cancelled → ArkTaskFailed（带服务端的退款结论）；
 *   · 等到死线 / 连查五次查不动 → ArkTaskUnknown（不是失败：凭据留着，取回走 GET /v2/video/:taskId，不花钱）。
 * ★ onTask 在开始等待**之前**调（调用方拿它落凭据：进程被系统回收时落过盘的那一份是唯一的线索）。
 * ★ 查询不是 200 的一律**不是结局**（契约：404 / 503 / 504 / 502）—— 数进 pollFails，不下定论。
 * ★ 轮询间隔不短于 8 秒（契约：每分钟 300 次是全站的上限，查询算不算进去官方没写；与真人档同一个数）。
 */
export async function minimaxV2Video(o: {
  model: string;
  /** 上游的大写写法（档位表的 upstreamResolution：480P / 768P） */
  resolution: string;
  /** 窗口内的整数秒（economy.clampDuration 已经吸附过 —— 这里不再夹，两处各夹一遍就是第二份实现） */
  durationSec: number;
  /** 具体画幅（纯文字 / 参考图出片必须写）；带首帧 / 尾帧时**不传**（服务端补 adaptive：成片跟着图的比例走） */
  ratio?: string;
  prompt: string;
  /** 已经是我们图床上的 https 地址（ai/real 转存过） */
  images: { url: string; role: MinimaxV2Role }[];
  onProgress?: (ev: ArkProgress) => void;
  onTask?: (taskId: string) => void;
}): Promise<string> {
  const prog = (ev: ArkProgress) => o.onProgress?.(ev);
  const url = `${BASE}/v2/video`;
  const body = {
    model: o.model,
    resolution: o.resolution,
    duration: o.durationSec,
    ...(o.ratio ? { ratio: o.ratio } : {}),
    content: [
      { type: "text", text: o.prompt },
      ...o.images.map((im) => ({ type: "image_url", image_url: { url: im.url }, role: im.role })),
    ],
  };
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: authHeaders(url), body: JSON.stringify(body), signal: AbortSignal.timeout(T_CREATE_MS) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ArkNoReply(t`MiniMax 出片创建没收到回包：${detail}`);
  }
  // 扣费 / 退款都发生在服务端：回包上的余额头同步一次（不同步的话镜像要等下一次调用才自愈）
  syncWalletFromHeaders(res.headers);
  const status = res.status;
  const text = await res.text().catch(() => "");
  // 判「这台服务器有没有这条路」看 Content-Type（SPA 回退是 200 + HTML），不信状态码。老服务端上这条路不存在 —— 没扣钱
  if (!(res.headers.get("Content-Type") ?? "").includes("application/json")) {
    throw new Error(t`这台服务器还不支持 MiniMax H3 出片（HTTP ${status}）——先换一档出片`);
  }
  if (!res.ok) throw v2RefusalError(status, text);
  let created: Record<string, unknown> = {};
  try {
    created = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* 2xx 却读不出：下面那一行按「已计费」说 */
  }
  const taskId = typeof created.task_id === "string" ? created.task_id : typeof created.task_id === "number" ? String(created.task_id) : "";
  // ★ 2xx 之后才坏（受理了却没给任务号）= 钱已经扣了、又没法查询取件：ArkBadReply（failCharge：已计费），别抛裸 Error 被归进「没扣」
  if (!taskId) throw new ArkBadReply(t`MiniMax 受理了这一发却没给任务号——把这句话反馈给我们`);
  o.onTask?.(taskId); // ★ 在开始等之前落凭据（理由见上）

  // 死线按「这一发要出多少秒视频」放（与方舟那条同一个式子：短段保底 12 分钟）。到点不是失败 —— 凭据留着、取回不花钱
  const t0 = Date.now();
  const deadline = t0 + Math.max(12 * 60_000, o.durationSec * 90_000 + 3 * 60_000);
  const pollUrl = `${BASE}/v2/video/${encodeURIComponent(taskId)}`;
  let pollFails = 0;
  for (;;) {
    if (Date.now() > deadline) {
      const minutes = Math.round((Date.now() - t0) / 60_000);
      // 钱的话不在这里说（只走 ai/failCharge；取回卡按服务端的账说扣没扣）
      throw new ArkTaskUnknown(t`MiniMax 出片 ${minutes} 分钟没出结果——任务多半还在上游跑，不是失败。`, taskId);
    }
    await new Promise((r) => setTimeout(r, 8000));
    let st: Record<string, unknown> | null = null;
    let why = "";
    try {
      const r = await fetch(pollUrl, { headers: authHeaders(pollUrl), signal: AbortSignal.timeout(T_QUERY_MS) });
      // 失败那一拍服务端会退钱、带余额头（只给账的主人）
      syncWalletFromHeaders(r.headers);
      if (r.ok && (r.headers.get("Content-Type") ?? "").includes("application/json")) st = (await r.json()) as Record<string, unknown>;
      else why = `HTTP ${r.status}`;
    } catch (e) {
      why = e instanceof Error ? e.message.slice(0, 60) : t`查询失败`;
    }
    if (!st) {
      // ★ 不是 200 的都不是结局（契约）：连查五次查不动 = 我们瞎了，不是这一发废了
      if (++pollFails >= 5) throw new ArkTaskUnknown(t`盯不住这一发的进度了（${why}）——任务还在上游跑，不是失败。`, taskId);
      prog({ kind: "pollRetry", fails: pollFails, max: 5, sec: Math.round((Date.now() - t0) / 1000) });
      continue;
    }
    pollFails = 0;
    const state = String(st.status ?? "");
    // V2 的状态词本来就是 queued / running（与方舟同一套），读秒句共用 arkClient.describeArkProgress；空状态按排队报
    prog({ kind: "poll", status: state || "queued", sec: Math.round((Date.now() - t0) / 1000) });
    if (V2_FAILED.has(state)) throw minimaxV2Failed(taskId, st);
    if (state === "succeeded") {
      const video = v2VideoUrlOf(st);
      // ★ 成功却没给地址：成片地址有时效、再查一次会给新的（官方）—— 不说死，凭据留着、取回再查一次（不花钱）
      if (!video) throw new ArkTaskUnknown(t`成片已经出来了，这一次没拿到地址——凭据还在，用「取回」领回来，不花钱。`, taskId);
      return video;
    }
  }
}

/**
 * 一发海螺出片：创建 → 轮询 → 取下载地址。
 * durationSec 必须已经被 economy.clampDuration 吸附到价表档位（6/10）——
 * 这里**不再夹一次**：两处各夹一遍就是同一条规则的第二处实现。
 */
export async function minimaxVideo(o: {
  model: string;
  prompt: string;
  /** 首帧图：URL 或 dataURL（实测两种都收） */
  firstFrame: string;
  durationSec: number;
  /** 轮询进度（结构化，与方舟侧同一个 ArkProgress）；句子由拿事件的那一方按界面语言写 */
  onProgress?: (ev: ArkProgress) => void;
  /**
   * 任务**刚被上游受理**（从这一刻起这一发的钱已经花掉了）。
   * ★ 与 arkClient 的 onTask 同一条约定：调用方拿它去落凭据，而落凭据必须发生在
   *   开始等待**之前** —— 进程被系统回收时，落过盘的那一份是唯一还活着的线索。
   */
  onTask?: (taskId: string) => void;
}): Promise<string> {
  // 「任务创建中」那一步由 real.composeSegments 在调用之前就报了，这里不再重复报一遍
  //（改之前这里多报的那条在日志里显示成「真人档 · 真人档任务创建中…」）
  const prog = (ev: ArkProgress) => o.onProgress?.(ev);
  // ★ 照 arkClient.arkFetch 的写法：带上限 + reject 包成 ArkNoReply（理由见 T_CREATE_MS 与 noReply 头上的 ★★）。
  //   这一发**没收到回包**时任务多半已经受理、钱已经扣了，而 onTask 要到下面拿到 task_id 才会落凭据 ——
  //   所以这一档只能让 failCharge 说「可能已扣」，别让它退化成「没扣」
  const created = await jsonOf(
    await fetch(`${BASE}/video`, {
      method: "POST",
      headers: authHeaders(`${BASE}/video`),
      body: JSON.stringify({
        model: o.model,
        prompt: o.prompt,
        first_frame_image: o.firstFrame,
        duration: o.durationSec,
        // 分辨率钉死 768P：报价表（economy.VideoTier.flatCost）就是按它锚的，
        // 让它可变 = 报价与实扣两个数
        resolution: "768P",
      }),
      signal: AbortSignal.timeout(T_CREATE_MS),
    }).catch((e) => {
      throw noReply("create", e);
    }),
    "create",
  );
  const br = baseRespOf(created);
  if (!br || br.status_code !== 0) {
    const detail = br ? `${br.status_code} ${br.status_msg}` : JSON.stringify(created).slice(0, 160);
    throw new Error(t`真人档任务被上游拒绝：${detail}`);
  }
  const taskId = String(created.task_id ?? "");
  if (!taskId) throw new Error(t`真人档任务受理了却没给任务号——上游协议变了，把这句话反馈给我们`);
  o.onTask?.(taskId); // ★ 在开始等之前落凭据（理由见 onTask 的 ★）

  // 实测 768P/6s 约 40~90 秒出片；10 分钟死线（与方舟侧的轮询纪律同精神：不无限等）
  const t0 = Date.now();
  const deadline = t0 + 10 * 60_000;
  // ★★ 单次查询抖动**不放弃整发**（2026-08-31 补，照 arkClient 的同一条纪律）：
  //   原来这一行是裸的 `await jsonOf(fetch(...))`，`jsonOf` 对任何非 2xx / 非 JSON
  //   当场抛 —— 手机在 5G/WiFi 之间切一下、或代理吃到一次上游 504，整发就被判死。
  //   而**钱在提交那一刻就已经扣掉**（没出结局之前谈不上退），任务在 MiniMax 那边照跑照出片。
  //   连查五次才放弃，与方舟侧同一个数。
  let pollFails = 0;
  for (;;) {
    if (Date.now() > deadline) {
      // ★★ 抛 **ArkTaskUnknown**（2026-08-31）：这不是失败，是"我们没接到"。
      //   凭据留着、取回入口亮起来 —— 而在这之前唯一亮着的是「重新生成」= 再扣一次
      //   整档的钱（真人档按发计价，10 秒档 143.2k，一按就是一大笔，而那一发的成片其实还在）。
      //   ⚠ 这一行与下面那个 pollFails 分支**必须同时**是 ArkTaskUnknown：
      //   只改一个的话，另一个仍抛普通 Error → flowStore 的真失败分支
      //   `if (taskId) dropVideoJob(taskId)` 会把刚落的凭据当场删掉，比不改更坏。
      throw new ArkTaskUnknown(
        // 钱的话不在这里说（CLAUDE.md：只走 ai/failCharge；取回卡按服务端的账说扣没扣）
        t`真人档出片 10 分钟没出结果——任务多半还在上游跑，不是失败。`,
        taskId,
      );
    }
    await new Promise((r) => setTimeout(r, 8000));
    let st: Record<string, unknown>;
    try {
      // 单发查询超时 / 断网在 getJson 里已包成 ArkNoReply —— 落进下面同一个 catch 数 pollFails（原来裸 fetch 永不 settle 时
      // 这一行就挂死，死线与 pollFails 两支都到不了，2026-10-15 教材人格评审）
      st = await jsonOf(await getJson(`${BASE}/video/${encodeURIComponent(taskId)}`, "poll"), "poll");
      pollFails = 0;
    } catch (e) {
      if (++pollFails >= 5) {
        // 与上面那个死线分支同一个类型（理由见那里的 ★★）：连查五次查不动 =
        // **我们瞎了，不是这一发废了**。我们自己代理回的 429/504 也落在这儿，
        // 它们更是"可重试"，绝不能进任何一个下定论的分支。
        const why = e instanceof Error ? e.message.slice(0, 60) : t`查询失败`;
        throw new ArkTaskUnknown(t`盯不住这一发的进度了（${why}）——任务还在上游跑，不是失败。`, taskId);
      }
      prog({ kind: "pollRetry", fails: pollFails, max: 5, sec: Math.round((Date.now() - t0) / 1000) });
      continue;
    }
    const status = String(st.status ?? "");
    // 海螺的状态词换算成方舟那套（Queueing → queued，Preparing / Processing → running），认不得的原样报；
    // 空状态按排队报（改之前也是这么兜的）。读秒句因此与方舟各档同一份（arkClient.describeArkProgress）
    const shown = status === "Queueing" || !status ? "queued" : status === "Preparing" || status === "Processing" ? "running" : status;
    prog({ kind: "poll", status: shown, sec: Math.round((Date.now() - t0) / 1000) });
    if (status === "Fail") throw minimaxFailed(taskId, st);
    if (status === "Success") {
      const url = await minimaxFileUrl(taskId, st);
      return url;
    }
  }
}
