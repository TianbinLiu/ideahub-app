// 这台服务端会不会某件事 —— 能力位探测的**唯一实现**（GET /api/ark/health，2026-10-07 从 arkClient.imageGroupsAvailable 抽出来共用）。
//
// ★★ 判能力只看健康端点报的**能力位**，不看状态码：真机上不存在的路径回 200 + index.html（Capacitor 的 SPA 回退，arkClient 文件头那条）。
// ★ 为什么要有同步的读法（serverSupports）：档位那一排是在 render 里画的，「这台服务器收不收 480p」得当场答。所以探测结果存在模块里、
//   到了广播一次（subscribeServerCaps，account 把它接进自己的版本号，订阅了账号的界面会重画）。
// ★ 三种情形：
//   · dev（vite 直连方舟）/ 离线演示包（没配 VITE_API_BASE，走 mock）：**没有服务端那一层**，能力全在（true）；
//   · 打包、探到了：照能力位答（老服务端没有这一位 = false）；
//   · 打包、还没探到 / 探测失败（断网、5xx、429、正文读到一半断了或读不成 JSON）：null = 不知道 —— 调用方一律**放行**（与套餐镜像没回来时同一个乐观口径：服务端会说清楚，
//     而且这几样都是在提交那一刻同步 400、一分钱不花）。探测失败不记结果，30 秒后再问。
import { API_BASE, API_ON, withAppVersion } from "../api/client";

/** 健康端点上我们关心的能力位（缺 = 老服务端，没有这一样） */
export interface ServerCaps {
  /** 收 480p 的纯任务（「草稿」档：2.0 mini 480p）—— 老服务端 pinPlainVideoTask 一律只收 720p */
  res480: boolean;
  /** 电影级「样片」两步（draft:true 与 draft_task 定稿） */
  draftMode: boolean;
  /** 受理之后**方舟**明说失败的出片按次退回 token（GenTaskCharge） */
  failRefund: boolean;
  /**
   * 受理之后**真人档（MiniMax）**明说失败的那一发也退（服务端开关 MINIMAX_FAIL_REFUND，缺省开；健康端点的 `minimaxFailRefund`）。
   * ★ 与方舟那一位分开（2026-10-07 评审抓到）：`failRefund` 只说方舟（无条件退），运维关掉 MiniMax 退款时，
   *   取回卡还在许诺「万一没出成会自动退回」就是空话。服务端没报这一位 = 当成开着（服务端契约的口径），但前提是它会退方舟的（failRefund）。
   */
  failRefundMinimax: boolean;
  /** 组图任务（九宫格分镜） */
  imageGroups: boolean;
  /**
   * 此刻免费版能出普通片的档（健康端点的 `freeVideo`：[{ model, resolution }]）；"legacy" = 服务端关了免费档限制（`freeVideoGate: false`，
   * 运维开关 FREE_VIDEO_GATE=off）—— 那时服务端退回改版前的口径：**只挡电影级（Seedance 2.5）**，别的档免费版都能用；
   * `freeVideo` 那张清单不看开关、照旧只列两档，所以先看这一位。
   * null = 服务端没报（老服务端 / 直连 / 还没探到）—— 那时按档位表的 freeOk 判（account.tierFreeOk）。
   * ★ 为什么要读它（2026-10-07 评审抓到）：运维总开关 FREE_VIDEO_GATE=off 只放开了服务端，新 App 只看本机的 freeOk，
   *   照样把标准 / 高清灰着写「会员档」—— 开关对新 App 不起作用。判据在服务端，App 照它画。
   */
  freeVideo: "legacy" | { model: string; resolution: string }[] | null;
  /**
   * 收客户端失败上报（`POST /api/client-events`，2026-10-15 教材人格评审 humble-delivery-4；发送只在 data/clientEvents 一处）。
   * 老服务端没有这个端点 —— 真机上不存在的路径回 200 + index.html，所以不能靠状态码试，只认这一位。
   */
  clientEvents: boolean;
  /**
   * 有 `GET /api/video/zone`（出片地区，2026-10-26）。只说有没有这条路、不带地区本身 —— 地区会在会话中途变（开关 VPN），
   * 而这份能力位记一整场会话；地区由 data/videoZone 另问、另记。老服务端没有这一位 = 地区不知道，照今天的样子摆。
   */
  videoZone: boolean;
  /** 有 POST/DELETE /api/branch/videos/:id/hide（「不感兴趣」，2026-10-30）。见不到就不摆那一行 —— 点了什么都不会变的选项不摆 */
  videoHide: boolean;
  /** 用户资料带 ipRegion（IP 属地，2026-10-30）。见不到就不画那一行 */
  ipRegion: boolean;
  /**
   * 模板作者奖励（2026-10-30，docs/template-author-reward-design.md）：发布体收 `templateIds`、有 `GET /api/branch/template-reward`。
   * 见不到就不发 `templateIds`（老服务端的 zod 会 strip，发了也无害，但没必要）、也不说那一句（那一句本来只读规则端点，老服务端上问不到）。
   */
  templateReward: boolean;
  /**
   * 这台服务端开着 MiniMax H3（V2）出片（`POST /api/minimax/v2/video`，健康端点的 `minimaxV2`，2026-10-26 出片地区 P2b）。
   * 服务端只在 MiniMax 走国际站时为真（没有单独的开关）；为假时那条路回 501 MINIMAX_V2_OFF。老服务端没有这一位 = 没有。
   * ★ H3 三档摆不摆 = 这一位为真 **且** 地区问到了、providers 里有 minimax（契约「H3 三档摆不摆」）—— 两样合起来只在 videoZone.minimaxV2Offered 一处判。
   *   与 res480 那几位「还不知道 = 放行」的口径相反（不知道 = 不摆）：V2 那条路在老服务端上根本不存在，出片前补画的帧已经各自结算过了。
   */
  minimaxV2: boolean;
  /**
   * 没付过钱的人在 H3 上**只能纯文字出片**（健康端点的 `minimaxV2FreeTextOnly`，服务端常量 MINIMAX_V2_FREE_TEXT_ONLY，今天为真）。
   * 判否定：只有明说 false 才算放开 —— 没报（老服务端 / 这一位还没下发）按「只能纯文字」，往从严的一侧退（带图的那一发服务端会 403、补画的图钱白花）。
   * 读它的只有 account.tierTextOnly（唯一判据）。
   */
  minimaxV2FreeTextOnly: boolean;
  /**
   * 工坊游戏券（G4 收尾，2026-11-23；服务端 server#155）：有 `GET /api/game/tickets`，出片路由认 `X-Game-Ticket: 1`
   * （扣一张券、token 钱包一分不动）。读不到这一位 = 老服务端 / dev 直连方舟 / 离线演示包 ⇒ data/gameTickets
   * **一个请求都不发**、界面不摆券数，出片按 token 交付（与改版前逐字节相同）。
   * ★ 这一位与「不知道 = 放行」的那几位口径相反（见 data/gameTicketRules.gameTicketModeOf）：
   *   券是"扣钱"的币种，把"不知道"当"有券"会让界面写着「用券」、服务端却扣了 token（钱上的话与事实相反）；
   *   当"没有"的代价只是少摆一格、多花一次 token（报价在屏上，用户看得见）。
   */
  gameTickets: boolean;
  /**
   * 工坊对局的房间与匹配（2026-11-23 联机接通；服务端 `routes/gameRoom.routes.js`）：
   * 有 `POST/GET /api/game/rooms*` 与 `POST/GET/DELETE /api/game/queue`。
   * ★ 读不到这一位 = 老服务端 / 离线包：大厅照旧开，但**一次房间请求都不发**，
   *   匹配与房间全走本机 AI 补位（api/game/rooms.roomsAvailable 是唯一判据）。
   *   不按 404 猜：真机上不存在的路径会回 200 + index.html（SPA 回退），状态码说不了这件事。
   */
  gameRooms: boolean;
  /**
   * 回合间事件由**服务端出题**（2026-11-23 G5 联机第三块）：有
   * `GET/POST /api/game/rooms/:code/rounds/events[/choice]`（同一房间同一回合所有人看到同一道题）。
   * ★ 读不到这一位 = 老服务端：联机局里的事件**退回本机那一套**（各抽各的，界面会写明「事件只在本机生效」）。
   *   与 gameRooms 同一条纪律：不按 404 猜（真机上不存在的路径回 200 + index.html），只认这一位。
   * ★ 这一位为真、但事件那一发**接口本身**失败（超时 / 5xx / 形状不认识）时也退回本机事件
   *   （判据在 `studio/game/onlineHost.onlineEventSourceOf`：能力位 + 那一发的结果）。
   */
  gameEvents: boolean;
  /**
   * 工坊对局的 **SSE 推送**（2026-11-24；服务端 server#159）：有 `GET /api/game/rooms/:code/stream`，
   * 建连即一帧 `snapshot`，之后 `update` / `ping` / `error` / `end`。
   * ★ 读不到这一位 = 老服务端 / 离线包：**一条流都不开**，对局完全走改版前那套 2 秒轮询
   *   （判据只在 `api/game/roomStream.roomStreamCapability`，`ui/useOnlineRounds` 不自己读能力位）。
   * ★ 与 gameRooms / gameEvents 同一条纪律：不按 404 猜（真机上不存在的路径回 200 + index.html），只认这一位。
   * ★ 这一位为真、流中途坏了（网络 / 5xx / 服务端 30 分钟寿命到）时**轮询兜底必须还在**：
   *   服务端的推送是**单实例**的（pm2 cluster 下另一个实例的写推不过来），所以那 2 秒一拍永远不拆，
   *   只是流正常时放宽到 15 秒。
   */
  gameRoomStream: boolean;
  /**
   * 对局里的 UGC 可被举报（2026-11-24，服务端 `feat/game-ugc-reports`）：`POST /api/branch/reports`
   * 收 `targetType: "user"`（targetId = 玩家的 userId）与 `"game-entry"`（targetId = 回合投稿的 entryId），
   * 健康端点的 `gameReports`。
   * ★ 读不到（老服务端 / 还没探到）**一律不摆**那两颗键：这两类靶子服务端会按 ObjectId 现查，
   *   老服务端点下去吃的要么是 zod 400、要么是 404 TARGET_NOT_FOUND —— 而这一颗键是
   *   "用户认认真真提交的一条投诉"，塞不进去就是丢掉了（铁律八）；晚摆一次只是少一个入口。
   *   与 gameRooms / gameEvents / gameRoomStream 同一条纪律：只看这一位、不按状态码猜
   *   （真机上不存在的路径回 200 + index.html）。
   */
  gameReports: boolean;
}

/** 布尔的那几位（serverSupports 只答这几样） */
export type BoolCap =
  | "res480"
  | "draftMode"
  | "failRefund"
  | "failRefundMinimax"
  | "imageGroups"
  | "clientEvents"
  | "videoZone"
  | "videoHide"
  | "ipRegion"
  | "templateReward"
  | "minimaxV2"
  | "minimaxV2FreeTextOnly"
  | "gameTickets"
  | "gameRooms"
  | "gameEvents"
  | "gameRoomStream"
  | "gameReports";

/** 健康端点的 JSON → ServerCaps（形状不对的位一律按「没有」）。**唯一解析处** */
function capsOf(j: Record<string, unknown>): ServerCaps {
  const fv = j.freeVideo;
  const list = Array.isArray(fv)
    ? fv
        .filter((x): x is { model: string; resolution: string } => !!x && typeof x === "object" && typeof (x as { model?: unknown }).model === "string" && typeof (x as { resolution?: unknown }).resolution === "string")
        .map((x) => ({ model: x.model, resolution: x.resolution }))
    : null;
  return {
    res480: j.res480 === true,
    draftMode: j.draftMode === true,
    failRefund: j.failRefund === true,
    failRefundMinimax: j.failRefund === true && j.minimaxFailRefund !== false,
    imageGroups: j.imageGroups === true,
    freeVideo: j.freeVideoGate === false ? "legacy" : list,
    clientEvents: j.clientEvents === true,
    videoZone: j.videoZone === true,
    videoHide: j.videoHide === true,
    ipRegion: j.ipRegion === true,
    templateReward: j.templateReward === true,
    minimaxV2: j.minimaxV2 === true,
    minimaxV2FreeTextOnly: j.minimaxV2FreeTextOnly !== false,
    gameTickets: j.gameTickets === true,
    gameRooms: j.gameRooms === true,
    gameEvents: j.gameEvents === true,
    gameRoomStream: j.gameRoomStream === true,
    gameReports: j.gameReports === true,
  };
}

let caps: ServerCaps | null = null;
let probe: Promise<ServerCaps | null> | null = null;
/** 上一次探测没答上来（断网 / 5xx / 429 / 正文读不出来）的时刻：之后 30 秒内不再重探 —— serverSupports 在 render 里被问，不节流就是每画一次发一发 */
let failedAt = 0;
const RETRY_MS = 30_000;
const NONE: ServerCaps = {
  res480: false,
  draftMode: false,
  failRefund: false,
  failRefundMinimax: false,
  imageGroups: false,
  freeVideo: null,
  clientEvents: false,
  videoZone: false,
  videoHide: false,
  ipRegion: false,
  templateReward: false,
  minimaxV2: false,
  minimaxV2FreeTextOnly: true,
  gameTickets: false,
  gameRooms: false,
  gameEvents: false,
  gameRoomStream: false,
  gameReports: false,
};
/**
 * 直连 / 离线：没有服务端那一层，能力全在；免费档清单按档位表（freeVideo null）。
 * ★ clientEvents 例外、是 false：那几样「全在」说的是方舟能力（dev 直连方舟、离线走 mock，本来就不经服务端），
 *   而失败上报是**发给服务端的一条请求** —— 没有服务端就没有可报的地方，dev 里的渲染错也不该往任何地方发。
 *   videoZone 同理（data/videoZone 本来也不在直连 / 离线时问）：dev 的出片不经服务端、没有地区门禁，地区当「不知道」照老样子摆。
 *   minimaxV2 同理（2026-10-26）：H3 只经服务端的 /api/minimax/v2 出片（MiniMax 的 key 在服务端），dev 直连方舟、离线走 mock 都没有它 —— 三档不摆。
 *   gameTickets 同理（G4 收尾）：dev 的 /api/ark 由 vite 代理直连方舟、不经服务端计费，也没有 /api/game/tickets —— 券没有可扣的地方。
 *   gameEvents / gameRooms / gameRoomStream 同理（联机对局）：dev 里没有 /api/game/rooms*，
 *   事件只能走本机那一套、推送一条流都不开（那条长连接在 dev 里没有任何东西可连）。
 *   gameReports 同理：举报走服务端 `POST /api/branch/reports`，dev 直连 / 离线包里没有收它的地方。
 */
const ALL: ServerCaps = {
  res480: true,
  draftMode: true,
  failRefund: true,
  failRefundMinimax: true,
  imageGroups: true,
  freeVideo: null,
  clientEvents: false,
  videoZone: false,
  videoHide: false,
  ipRegion: false,
  // 模板奖励同理：规则端点与发布体那一格都在服务端，dev 直连 / 离线包没有收它的地方
  templateReward: false,
  minimaxV2: false,
  minimaxV2FreeTextOnly: true,
  gameTickets: false,
  gameRooms: false,
  gameEvents: false,
  gameRoomStream: false,
  gameReports: false,
};
const listeners = new Set<() => void>();

/**
 * 没有服务端那一层（dev 直连方舟 / 离线演示包）—— **唯一判据**：这里能力全在；data/videoZone 也拿它决定「不问地区」（地区一直是不知道）。
 * ★ 2026-10-26 P1 审核：原来 videoZone 里另抄了一份同样的式子，同一条规则两处写。
 */
export function noServerLayer(): boolean {
  return import.meta.env.DEV || !API_ON;
}

export function subscribeServerCaps(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 探一次（整场会话记住结果：服务端不会在会话中途升级）。探测本身失败（断网）回 null 且不记，下次再问。
 * ★ 直连 / 离线时不发请求，直接回「全在」。
 * ★ `force`：跳过「dev / 没配 API_BASE 当没有服务端」这一条，照常去问。调用方是
 *   `serverGameRooms` / `serverGameEvents`（工坊对局的房间与回合间事件）：本轮联机验证的环境就是
 *   `npm run dev` + 本地 server，而 `noServerLayer()` 的「dev = 直连方舟」只在**没配** `VITE_API_BASE`
 *   时才成立 —— 配了地址的 dev 是一个真客户端，这两位不能因此永远读成「没有」。
 *   别的能力位不受影响（仍然走上面那条早退）。
 */
export function probeServerCaps(force = false): Promise<ServerCaps | null> {
  if (!API_ON) return Promise.resolve(ALL);
  if (!force && noServerLayer()) return Promise.resolve(ALL);
  if (caps) return Promise.resolve(caps);
  if (!probe && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null);
  probe ??= fetch(`${API_BASE}/api/ark/health`, { headers: withAppVersion(`${API_BASE}/api/ark/health`), signal: AbortSignal.timeout(10_000) })
    .then(async (r): Promise<ServerCaps | null> => {
      // ★ 5xx / 429（网关错误页、部署那几秒、限流）是「这一刻没答上来」，不是「这台服务端不会」：记成不知道、过一会儿再问。
      //   原来一律记成全 false 并记一整场会话 —— 一次 502 就把「草稿」档藏到 App 重启（11-24 之后那是免费用户唯一的档）
      if (r.status >= 500 || r.status === 429) return null;
      const ct = r.headers.get("content-type") ?? "";
      // 其余非 2xx（404：没有这个端点）或不是 JSON（SPA 回退的 200 + index.html）= 确实没有这几样
      if (!r.ok || !ct.includes("json")) return NONE;
      // ★ 正文读不出来（头到了、正文在半路断了 / 读到一半撞上那 10 秒超时 / 截断的 JSON）同样是「这一刻没听清」，不是「这台服务端不会」：
      //   原来 `.catch(() => ({}))` 把它当成一个空对象 → 全 false 记一整场会话，与上面 502 那一格同一个后果（2.62 发版评审抓到）。
      //   只有**读得出来的 JSON 对象**里没有某一位，才算真的没有那一样
      let j: unknown;
      try {
        j = await r.json();
      } catch {
        return null;
      }
      if (!j || typeof j !== "object" || Array.isArray(j)) return NONE;
      return capsOf(j as Record<string, unknown>);
    })
    .then((c) => {
      if (!c) {
        probe = null;
        failedAt = Date.now();
        return null;
      }
      caps = c;
      for (const fn of listeners) fn();
      return c;
    })
    .catch(() => {
      probe = null;
      failedAt = Date.now();
      return null;
    });
  return probe;
}

/**
 * 这台服务端会不会这一样：true / false / null（还不知道）。**同步**，render 里能调；第一次问的时候顺手发起探测。
 * ★ null 时调用方放行（见文件头）。别把 null 当 false：探测慢半拍就把免费用户唯一的档藏起来，比放行一次必然同步 400 的请求更坏。
 *   例外是 minimaxV2（不知道 = 不摆，理由见 ServerCaps.minimaxV2）—— 那一位的读法只在 videoZone.minimaxV2Offered。
 * ★ 没有服务端那一层时答 ALL 那一份（2026-10-26 起；原来一律答 true —— 当时问到的几位在 ALL 里本来都是 true，
 *   而 minimaxV2 在 dev / 离线包里是假的：H3 只经服务端出片）。
 */
export function serverSupports(cap: BoolCap): boolean | null {
  if (noServerLayer()) return ALL[cap];
  if (caps) return caps[cap];
  void probeServerCaps();
  return null;
}

/**
 * 此刻免费版能用哪几档出普通片（服务端说的；见 ServerCaps.freeVideo）。null = 服务端没说 / 还不知道 —— 调用方按档位表的 freeOk 判。
 * 同步、render 里能调；第一次问的时候顺手发起探测（同 serverSupports）。
 */
export function serverFreeVideo(): ServerCaps["freeVideo"] {
  if (noServerLayer()) return null;
  if (caps) return caps.freeVideo;
  void probeServerCaps();
  return null;
}

/**
 * 这台服务端有没有「工坊对局的房间服务」（`/api/game/rooms*` + `/api/game/queue`）。
 * ★ 唯一读法是 api/game/rooms.roomsAvailable()（大厅据此决定发不发房间请求、底栏说哪句）。
 * ★ 与 serverSupports 分开一个读法的理由见 probeServerCaps 的 force：本轮联机验证跑在
 *   `npm run dev` + 本地服务端上，而 noServerLayer() 在 dev 里恒真 —— 走 serverSupports
 *   会把这一位永远读成「没有」，大厅就永远退不回联机（看起来一切正常，只是永远匹配不到人）。
 * ★ 读不到 = 不知道（null）：调用方当「没有」处理 —— 大厅退回本机 AI 补位、一个房间请求都不发。
 *   这一位没有「不知道就放行」的余地：老服务端上真发出去的建房 / 进房只会吃 SPA 的 200 + HTML。
 */
export function serverGameRooms(): boolean | null {
  if (!API_ON) return ALL.gameRooms;
  if (caps) return caps.gameRooms;
  if (!probe && Date.now() - failedAt >= RETRY_MS) void probeServerCaps(true);
  return null;
}

/**
 * 这台服务端的回合间事件是不是**服务端出题**（`rounds/events*`，同一房间同一回合同一道题）。
 * ★ 唯一读法是 `studio/game/onlineHost.onlineEventSourceOf(serverGameEvents())`：
 *   能力位为假 / 读不到（老服务端）→ 退回本机事件，界面写明「事件只在本机生效」。
 * ★ 与 serverGameRooms 同一份理由单开一个读法（force 探测：dev + 本地服务端要能问到这一位）。
 * ★ 这一位没有「不知道就放行」的余地：老服务端上真发出去的 events 请求只会吃 SPA 的 200 + HTML，
 *   而更要紧的是——两端各抽各的事件，屏幕上就不再是"同一道题"了（这正是本轮要收口的那件事）。
 */
export function serverGameEvents(): boolean | null {
  if (!API_ON) return ALL.gameEvents;
  if (caps) return caps.gameEvents;
  if (!probe && Date.now() - failedAt >= RETRY_MS) void probeServerCaps(true);
  return null;
}

/**
 * 这台服务端有没有**对局推送那条长连接**（`GET /api/game/rooms/:code/stream`）。
 * ★ 唯一读法是 `api/game/roomStream.roomStreamCapability()`（`ui/useOnlineRounds` 据此决定开不开流）。
 * ★ 与 serverGameRooms / serverGameEvents 同一份理由单开一个读法（force 探测：dev + 本地服务端要能问到这一位）。
 * ★ 读不到（null）的用法**不是**一律当「没有」（2026-11-24 改口）：老服务端上真发出去的那条 GET
 *   会吃 SPA 的 200 + HTML，所以"确实没有"时一条流都不开；但"这一刻还没问到"要过几秒再问一次 ——
 *   冷启动那一发健康探测撞上网络抖动时，整局就没了推送（`ui/useOnlineRounds` 里那条 5 秒重问）。
 * ★★ "不知道"也不能当成"有"：不追问的调用方（大厅房间屏）仍把 null 与 false 一样按"这条流不开"处理，
 *   靠 2 秒轮询兜着 —— 大厅那边不是"实时"承诺的所在。与 minimaxV2 / gameTickets 同一种口径：
 *   这一位没有「不知道就放行」的余地。
 */
export function serverGameRoomStream(): boolean | null {
  if (!API_ON) return ALL.gameRoomStream;
  if (caps) return caps.gameRoomStream;
  if (!probe && Date.now() - failedAt >= RETRY_MS) void probeServerCaps(true);
  return null;
}

/**
 * 这台服务端收不收**对局里的举报**（`POST /api/branch/reports` 的 `user` / `game-entry` 两类）。
 * ★ 唯一读法是 `studio/game/ui/useGameReports` 的 `useGameReportsCap()`（三块面板据此决定摆不摆那颗键）；
 *   判据本身在零依赖的 `studio/game/reports.ts`（构建门禁直接 import 跑正反例）。
 * ★ 与 serverGameRooms / serverGameEvents / serverGameRoomStream 同一份理由单开一个读法
 *   （force 探测：本轮联机验证跑在 `npm run dev` + 本地服务端上，而 noServerLayer() 在 dev 里恒真）。
 * ★ 读不到（null）当**没有**：理由见 ServerCaps.gameReports 的 ★ —— 这一颗键点了是往审核队列里塞东西，
 *   塞不进去就是把用户的一条投诉丢掉；晚摆一次只是少一个入口。
 */
export function serverGameReports(): boolean | null {
  if (!API_ON) return ALL.gameReports;
  if (caps) return caps.gameReports;
  if (!probe && Date.now() - failedAt >= RETRY_MS) void probeServerCaps(true);
  return null;
}
