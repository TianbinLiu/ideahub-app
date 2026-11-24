/**
 * 联机对局的 **SSE 推送**：`GET /api/game/rooms/:code/stream` 的客户端**唯一实现**（2026-11-24）。
 *
 * ★★ 为什么不用 EventSource：它带不了 `Authorization` 头，只能把 token 塞进 URL（服务端确实留了
 *   `?token=` 的兜底，见 `routes/gameRoom.routes.js` 的 ★）。而 token 进了 URL 就会进访问日志、
 *   进 Referer、进任何一层代理的记录 —— 所以这里走 `fetch` + `ReadableStream`，鉴权与全仓其它
 *   请求同一个来源（`getToken()`），token 不出现在地址里。
 *
 * ★ 帧的切分不在这里：`api/sseBody.readSseBody`（= `companion/sse` 那一份解析器，`api/stream.ts`
 *   也走它）负责"跨 chunk 的半帧 / `\r\n` / 多行 data / 注释行"，这里只认**事件名**与 data 的形状。
 *   · 心跳：服务端写的是 `event: ping\ndata: \n\n`（**data 是空串，不是没有 data 行**），解析器照样
 *     吐出一帧（`data === ""`），所以 `onPing` 数得到 —— 它是"这条流还活着"的唯一证据。
 *   · `[DONE]` 那一套是 OpenAI 风格聊天的收尾标记，这里**不适用**：对局的流是靠 `end` 帧 + 连接关闭收尾的。
 *
 * ★ 这个文件只说"收到了一帧"，不认识房间 / 回合的语义：快照的解析走 `rooms.remoteRoomOf` 与
 *   `rounds.remoteRoundOf`（铁律六：轮询与推送不能各有一份解析 —— 另写一份的症状是"轮询读得出房主、
 *   推送读不出"，屏幕上表现为房主键时有时无）。
 *
 * ★★ 断线 / 错误一律**先关掉这条流再回调**：服务端每用户最多 2 条并发（`STREAM_MAX_PER_USER`，
 *   超了在建连接之前就回 429）。留一条僵尸连接 = 下一次重连必然 429，然后整局掉回轮询。
 *
 * ★ 能力位：`roomStreamCapability()` 是"开不开流"的唯一判据（`data/serverCaps` 的 `gameRoomStream`）。
 *   **三态**（true / false / null），调用方必须区别对待：
 *   · true  → 开流；
 *   · false → 老服务端 / 离线包：**一条流都不开**（真发出去的那条 GET 会吃 SPA 的 200 + HTML，
 *     然后永远等不到一帧；而对局本来就有 2 秒轮询兜底，少开一条流没有任何损失）；
 *   · null  → 还没探到（冷启动时健康端点那一发在飞 / 刚刚失败过，serverCaps 要 30 秒后才允许重探）：
 *     **不能当成"没有"就把这一局永久关掉** —— `ui/useOnlineRounds` 会隔几秒再问一次，
 *     探到了就把流开起来。2026-11-24 真机验收追延迟时发现过这条缝：冷启动那一发探测撞上
 *     网络抖动，整局就悄悄停在 2 秒轮询上，底栏连"实时"两个字都不摆（最难发现的那种）。
 */
import { API_BASE, API_ON, getToken, withAppVersion } from "../client";
import { readSseBody } from "../sseBody";
import type { SseEvent } from "../../companion/sse";
import { serverGameRoomStream } from "../../data/serverCaps";
import { remoteRoomOf, type RemoteRoom } from "./rooms";
import { remoteRoundOf, type RemoteRound } from "./rounds";

/** 一帧 `snapshot` / `update` 的数据：`{ room, round }`（`round` 为 null = 房间还没开第一回合，是正常状态）。 */
export interface RoomStreamSnapshot {
  room: RemoteRoom;
  /** null = 还没有回合（与 `GET rounds/current` 的 404 不同：那一条在推送里是**正常**的，不该让流断掉） */
  round: RemoteRound | null;
}

/**
 * 这条流为什么断了 / 结束了（调用方据此决定"重连"还是"彻底退回轮询"）。
 * ★ 只认 `code` 不认 `message`（服务端那句是英文、给老 App 兜底 —— 与 rooms / rounds 同一条纪律）。
 */
export interface RoomStreamFailure {
  /**
   * 服务端 `error` 帧的码（`ROOM_NOT_FOUND` / `NOT_IN_ROOM` / `GAME_ROOMS_OFF` / `TOO_MANY_STREAMS` /
   * `STREAM_ERROR`），或客户端自己的传输层码：
   * `UNAUTHORIZED` / `NOT_FOUND` / `UNSUPPORTED` / `HTTP_<状态码>` / `NETWORK` / `TIMEOUT` / `BAD_FRAME` / `EOF`。
   */
  code: string;
  /**
   * 值不值得重连。
   * ★ false（重连只会把同一句话再要一遍，白白多花 5 次退避）：
   *   · 房没了 / 我不在房里 / 服务被运维关了 / 每用户名额满（服务端契约：客户端应停止重试）；
   *   · 401（登录态过期：轮询那一发走 `client.ts`，会自己广播 `auth:expired`，这里不抢着重复处理）；
   *   · 404 / 200 + HTML（老服务端根本没有这条路）。
   * ★ true：网络断 / 超时 / 5xx / 帧形状不认识 / `STREAM_ERROR` / 服务端 30 分钟寿命到（`end`）。
   */
  retryable: boolean;
}

/** 订阅方要的回调。**收到的快照一定是已经解析成 `RemoteRoom` / `RemoteRound` 的那一份**（不是裸 JSON）。 */
export interface RoomStreamHandlers {
  /** 建连后的第一帧（服务端契约：连上立刻来一帧，`round` 可能为 null） */
  onSnapshot: (snapshot: RoomStreamSnapshot) => void;
  /** 之后任何一次变化（整份快照，不是增量） */
  onUpdate: (snapshot: RoomStreamSnapshot) => void;
  /** 心跳（20 秒一次）：只用来证明这条流还活着 */
  onPing: () => void;
  /** 流断了（**这条连接已经关掉了**，不用再 close）：要不要重连看 `retryable` */
  onError: (failure: RoomStreamFailure) => void;
  /** 服务端正常收尾（`end` 帧：30 分钟寿命到）—— 不是错误，客户端应该重连 */
  onEnd: (reason: string) => void;
}

/** 订阅句柄：`close()` 幂等，各处清理都调它（离房 / 卸载 / 对局结束 / 窗口转竖屏）。 */
export interface RoomStreamSubscription {
  close: () => void;
}

/**
 * 心跳 20 秒一次 ⇒ 45 秒还没有任何字节就认定这条连接已经死了。
 * ★ 为什么不按"总时长"算（同 `api/stream.ts` 的 `SSE_STALL_MS` 口径）：这条流本来就要挂 30 分钟。
 * ★ 为什么必须自己判（不靠 TCP）：手机切飞行模式 / Wi-Fi 掉线时，`reader.read()` 会一直挂在半开连接上，
 *   一直挂到内核重传放弃（实测几十秒到几分钟不等）。没有看门狗的话，界面上会一直显示「实时连接中」，
 *   而对面的交片要等 15 秒那一拍轮询才看得到 —— 这正是这一轮要收的那件事。
 * ★ 45 秒 = 两个心跳周期 + 5 秒余量（漏一拍不误杀；真断了最多 45 秒一定认出来）。
 */
const STREAM_STALL_MS = 45_000;

/**
 * 这台服务端有没有推送那条长连接（`health.gameRoomStream`）：**true / false / null（还不知道）**。
 * ★ 唯一判据（`ui/useOnlineRounds` 不自己读能力位、也不在这里再判一次三态用途）。
 * ★ 三个值的用法见文件头那段 ★：false = 一条流都不开；null = 过几秒再问，别把这一局关死。
 */
export function roomStreamCapability(): boolean | null {
  return serverGameRoomStream();
}

/** 服务端 `error` 帧里**不值得重连**的那几个码（其余一律当可重连，最多 5 次退避就收敛）。 */
const TERMINAL_CODES = new Set(["ROOM_NOT_FOUND", "NOT_IN_ROOM", "GAME_ROOMS_OFF", "TOO_MANY_STREAMS"]);

/** 业务码 → 失败值（**唯一一处**判"要不要重连"） */
function failureOfCode(code: string): RoomStreamFailure {
  return { code, retryable: !TERMINAL_CODES.has(code) };
}

/** HTTP 状态码 → 失败值（429 是服务端说的"每用户名额满了"，按契约**别再重试**）。 */
function failureOfStatus(status: number, code: string): RoomStreamFailure {
  if (status === 401) return { code: "UNAUTHORIZED", retryable: false };
  if (status === 429) return { code: code || "TOO_MANY_STREAMS", retryable: false };
  if (status >= 500) return { code: code || `HTTP_${status}`, retryable: true };
  return { code: code || `HTTP_${status}`, retryable: false };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 一帧 `snapshot` / `update` 的 data → 快照。
 * ★ 形状不认识 → null（调用方当成"这条流不可信"，断掉走轮询）：把读不懂的一帧当作"没什么变化"
 *   会让界面停在旧画面上，比明说一声坏得多（铁律八：不静默）。
 * ★ 两半各走轮询那份解析器；`round` 为 null 是正常状态，为"有值但读不懂"才算坏帧。
 */
function snapshotOf(data: string): RoomStreamSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  const r = asRecord(raw);
  if (!r) return null;
  const room = remoteRoomOf(r.room);
  if (!room) return null;
  if (r.round === null || r.round === undefined) return { room, round: null };
  const round = remoteRoundOf(r.round);
  return round ? { room, round } : null;
}

/** `end` 帧的 data → 原因（`{"reason":"lifetime"}`；读不懂就报 unknown，调用方只拿它写日志 / 说一句话）。 */
function endReasonOf(data: string): string {
  try {
    return strOf(asRecord(JSON.parse(data) as unknown)?.reason) ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** `error` 帧的 data → 失败值（读不出 JSON 也当一个可重连的 `STREAM_ERROR`，别把整条流判成永久坏掉）。 */
function failureOfFrame(data: string): RoomStreamFailure {
  try {
    const code = strOf(asRecord(JSON.parse(data) as unknown)?.code);
    if (code) return failureOfCode(code);
  } catch {
    /* 不是 JSON：走到下面 */
  }
  return { code: "STREAM_ERROR", retryable: true };
}

/** 非 2xx 时尽量把服务端那句业务码读回来（429 带 `TOO_MANY_STREAMS`、401 由 requireAuth 回 JSON）。 */
async function codeOfResponse(res: Response): Promise<string> {
  try {
    const raw = (await res.json()) as unknown;
    return strOf(asRecord(raw)?.code) ?? "";
  } catch {
    return "";
  }
}

/**
 * 订一间房的推送。
 *
 * 调用方**必须**在离房 / 卸载 / 对局结束时 `close()`：服务端每用户最多 2 条并发连接，
 * 泄漏一条就是下一次重连的 429（而 429 按契约不再重试 ⇒ 整局掉回轮询）。
 *
 * @returns `{ close }`（幂等）。**不会**自己重连：退避节奏归 `ui/useOnlineRounds` 一处
 *   （与"轮询改回 2 秒 / 15 秒"同一处，两件事分开写就会各自重连、各自退避）。
 */
export function subscribeRoomStream(
  code: string,
  handlers: RoomStreamHandlers,
): RoomStreamSubscription {
  const ctrl = new AbortController();
  /** 调用方主动关的（与"自己断了"分开：前者不该再回调 onError，界面已经不需要这句话了） */
  let closedByCaller = false;
  /** 已经回调过一次 onError / onEnd（服务端发完 error/end 就关连接，read 那边还会再抛一次 AbortError） */
  let settled = false;
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;

  const disarm = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  };
  /** 看门狗：每一次收到字节都重新计时；自己掐断时先立 `stalled` 旗（回调是同步的，顺序反了永远读到 false）。 */
  const arm = () => {
    if (closedByCaller || settled) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, STREAM_STALL_MS);
  };

  /**
   * 收尾（只走一次）：清看门狗 → 关底层连接 → 回调。
   * ★ 顺序不能反：先 abort 再回调，调用方在回调里立刻重连时，服务端那边这条已经释放了名额。
   */
  const finish = (run: () => void) => {
    if (settled) return;
    settled = true;
    disarm();
    try {
      ctrl.abort();
    } catch {
      /* 已经断了 */
    }
    if (!closedByCaller) run();
  };
  const fail = (failure: RoomStreamFailure) => finish(() => handlers.onError(failure));
  const endWith = (reason: string) => finish(() => handlers.onEnd(reason));

  /** 一帧的语义（**只有这一处**认事件名；不认识的事件名忽略：服务端加新事件不该把这条流判成坏的）。 */
  const onFrame = (frame: SseEvent) => {
    if (closedByCaller || settled) return;
    switch (frame.event) {
      case "ping":
        handlers.onPing();
        return;
      case "end":
        endWith(endReasonOf(frame.data));
        return;
      case "error":
        fail(failureOfFrame(frame.data));
        return;
      case "snapshot":
      case "update": {
        const snapshot = snapshotOf(frame.data);
        if (!snapshot) {
          fail({ code: "BAD_FRAME", retryable: true });
          return;
        }
        if (frame.event === "snapshot") handlers.onSnapshot(snapshot);
        else handlers.onUpdate(snapshot);
        return;
      }
      default:
        return;
    }
  };

  const run = async (): Promise<void> => {
    if (!API_ON) {
      fail({ code: "OFFLINE", retryable: false });
      return;
    }
    const url = `${API_BASE}/api/game/rooms/${encodeURIComponent(code)}/stream`;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    arm();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        // `withAppVersion`：打自家 `/api/…` 的裸 fetch 都要过它（服务端只记日志，见 api/client 的 ★）
        headers: withAppVersion(url, headers),
        signal: ctrl.signal,
      });
    } catch {
      // 调用方关的 / 看门狗掐的：不算失败（前者不该回调，后者已经用 stalled 标好）
      if (closedByCaller || settled) return;
      fail({ code: stalled ? "TIMEOUT" : "NETWORK", retryable: true });
      return;
    }
    if (closedByCaller) {
      // 请求飞在路上时调用方关了这条流：把连接也关掉，别让服务端那边多挂一条
      try {
        ctrl.abort();
      } catch {
        /* 已经断了 */
      }
      return;
    }
    if (!res.ok) {
      fail(failureOfStatus(res.status, await codeOfResponse(res)));
      return;
    }
    // ★ 认 Content-Type 不认状态码：真机上不存在的路径回 200 + index.html（Capacitor / nginx 的 SPA 回退），
    //   不判的话表现为"流开着但一个字都不来"，然后 45 秒看门狗才认账。
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream")) {
      fail({ code: "UNSUPPORTED", retryable: false });
      return;
    }
    try {
      await readSseBody(res.body, () => res.text(), onFrame, { onChunk: arm });
      // 读完了但没收到 end / error 帧 = 中间层把连接掐了（30 分钟寿命那一帧没到）：按断开重连
      if (!settled && !closedByCaller) fail({ code: stalled ? "TIMEOUT" : "EOF", retryable: true });
    } catch {
      if (!settled && !closedByCaller) fail({ code: stalled ? "TIMEOUT" : "NETWORK", retryable: true });
    } finally {
      disarm();
      try {
        ctrl.abort();
      } catch {
        /* 已经断了 */
      }
    }
  };

  void run();

  return {
    close: () => {
      if (closedByCaller) return;
      closedByCaller = true;
      disarm();
      try {
        ctrl.abort();
      } catch {
        /* 已经断了 */
      }
    },
  };
}
