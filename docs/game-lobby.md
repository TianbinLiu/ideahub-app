# 工坊对局大厅（2026-11-23；2026-11-24 接上服务端房间；同日接上服务端回合引擎）

> 主人这一轮点名的四件事：① 进对局前先到**大厅**（4 人匹配 / 8 人匹配 / 自定义房间）；
> ② 对局人数从"固定 4"改成**参数化 2~8**（空位 AI 补）；③ 自定义房间（6 位房间码、房主踢人 / 改人数 / 开局）；
> ④ **真实联机**：2026-11-23 先把 App 侧做成接口桩，2026-11-24 服务端上线（`gameRooms` 能力位为真）后
> 换成真调用；同日服务端回合引擎上线（`gameRounds` 能力位为真），**联机房间里的这一局改成跟服务端回合走**
> （交片 / 展映 / 点赞 / 投票 / 结算 / 下一回合，见 §七）；本机单机那一套原样保留，只当**离线退路**。
> 规则正本仍是 `src/studio/game/rules.ts`；回合循环见 `docs/g3-round-loop.md`；界面那一块见 `docs/g2-game-ui.md`。

## 文件

| 文件 | 内容 |
|---|---|
| `src/studio/game/lobby.ts` | **大厅 / 房间的纯状态机（零依赖）**：座位 id（`seatIdsFor` / `aiSeatIds`）、房间码（`roomCodeOf`，本机 6 位数字；`normalizeServerCode`，服务端 6 位字母数字）、开房（`createRoom`）、改人数（`setRoomSize`）、踢人（`kickSeat`）、准备（`toggleReady`）、离开（`leaveRoom`）、开局怎么坐（`roomStartPlan` / `canStartRoom`）。**一条 UI 都没有** |
| `src/studio/game/lobbyStore.ts` | 大厅界面状态（zustand）：开没开、停在哪一屏（`home` / `matching` / `room`）、房间那份状态、**联机快照 / 队列现状 / 底栏原因 / 退本机**。规矩递回 `lobby.ts`，网络递去 `api/game/rooms`，建局递出去（`ui/startFromLobby`） |
| `src/studio/game/lobbyReasons.ts` | `LobbyFailure` / 服务端错误码 / `LobbyNote` → 那一句人话（**唯一一处**，与 `reasons.ts` 同一条分工） |
| `src/studio/game/ui/Lobby.tsx` | 大厅外壳 + 顶栏货币条（🎟 券 / ⚡ token）+ 首屏三张模式卡（**点一下只选中**）+ 底部实心主键 + 凭码加入 + 4/8 人匹配那一屏（雷达 / 已排队与预计等待 / 取消；联机等真人 / 退回后 AI 补位） |
| `src/studio/game/ui/RoomScreen.tsx` | 自定义房间：房间码 / 复制 / 二维码 / 分享 / 成员表 / 房主开局、踢人（联机时藏改人数）/ 非房主准备 / 邀请卡 |
| `src/studio/game/ui/useLobbyOnline.ts` | **联机轮询的唯一一处定时器**：等匹配 2 秒一拍（60 秒上限）、房间快照 2 秒一拍、服务端开局后建本机局；换屏 / 卸载即 cleanup |
| `src/studio/game/ui/startFromLobby.ts` | 大厅 → 对局的**唯一**那一下（App 里唯一同时认识三个 store 的地方）；开局交接时**不退房**（回合引擎还要房间码），对局结束才退 |
| `src/api/game/rooms.ts` | **联机 HTTP 层**：`createRoom` / `joinRoom` / `readRoom` / `kickMember` / `setReady` / `startRoom` / `leaveRoom` / `findMatch` / `readQueue` / `cancelMatch` + `roomsAvailable()`（能力位） |
| `src/api/game/rounds.ts` | **回合引擎 HTTP 层**：`startRound` / `submitRoundEntry` / `readRound` / `setRoundPhase` / `likeRoundEntry` / `voteRoundEntry` / `settleRound` / `nextRound`；只认 code，`GAME_OVER` 的 winners 从 ApiError.payload 读 |
| `src/studio/game/roundsStore.ts` | 联机回合的界面状态（zustand）：会话 / 服务端快照 / 结算 / 胜者 / 失败原因 / 自动结算与弃权；**没有定时器** |
| `src/studio/game/roundsReasons.ts` | 回合失败原因 → 那一句人话（**唯一一处**，与 lobbyReasons 同一条分工） |
| `src/studio/game/ui/useOnlineRounds.ts` | **联机回合轮询的唯一一处定时器**（2 秒一拍）：读 current / 自动取结算 / 对齐本机阶段与下一回合 / 掉线退回单机 / 对局结束退房 |
| `src/studio/game/ui/OnlineScreeningPanel.tsx` | 展映 · 联机版：播服务端 entries、点赞写回服务端、**禁止自赞**、被淘汰只能看 |
| `src/studio/game/ui/OnlineVotingPanel.tsx` | 投票 · 联机版：投 / 弃权写回服务端，不能投自己，全员表态后自动结算 |
| `src/studio/game/ui/entryPayload.ts` | 一期作品 → 交片请求体的**唯一**翻译（卡名 / 档位 / 占位标记） |
| `src/studio/game/ui/RoomScreen.tsx` / `Lobby.tsx` | 联机房间**空位不参加回合**（2026-11-24 改口径，原来说"AI 补位"） |
| `src/data/serverCaps.ts` | 新增 `gameRooms` 能力位（健康端点）；`serverGameRooms()` 是它的读法（dev 配了 `VITE_API_BASE` 也照问） |
| `scripts/check-game-lobby.mjs` | 大厅 / 房间状态机 **100 条断言**（正例 85 / 反例 15），`npm run build` 里跑 |
| `scripts/check-game-online.mjs` | 联机回合编排 **93 条断言**（阶段对齐 / 下一回合 / 第 9 回合 / 掉线补齐 AI / 本机事件），`npm run build` 里跑 |

## 一、大厅：先选模式，再点主键（2026-11-24 视觉 P0 拆成两步）

```
创作入口「开始做完整作品」（src/pages/CreatePage，2026-11-24 起）→ `/studio?lobby=1`
▶ 开局（工坊顶栏，原来直接建局）→ lobbyStore.openLobby()
   └→ 大厅首屏（横屏；铺满舞台的实底，3D 停帧）
        ├─ 点模式卡（4 人 / 8 人 / 自定义）＝ **只选中**（高亮，不会直接开局）
        └─ 点底部实心主键（匹配 4 人局 / 匹配 8 人局 / 创建房间）＝ 真的开始
             ├─ 4/8 人匹配 → 等匹配那一屏（联机：队列人数 + 已排队 / 预计等待 + 取消；
             │                没接通：我 + AI 补位 →「用 AI 开局」）
             └─ 自定义房间 → 房间屏（房间码 + 复制 / 二维码 / 分享 + 成员表 + 房主动作）→「开始对局」
```

- **两个入口、一条落点**（2026-11-24）：创作入口那颗「开始做完整作品」不再直接落到 3D 铸卡桌面，
  而是带 `?lobby=1` 进 `/studio`，`StudioPage` 挂载时开大厅并把标记从地址里抹掉（与 `/me?wallet=1`
  同一套做法）。**不新造路由**：大厅本来就是这块舞台上的浮层，另开一条会把模型与场景挂两遍。
  不带标记进 `/studio`（我的仓库 / 回炉重做 / 发布之后回工坊）照旧落在 3D 桌面上。
  已开着一局时 `?lobby=1` 不抢（不把人从牌桌上拽走）。
- **模式卡只选中、主键才开始**（2026-11-24 视觉 P0 = 文档 `docs/game-lobby-ui-benchmark.md` #13）：
  以前点卡片直接进队 / 建房，误触一次就是一次开局。现在选中的是页内 state（默认 4 人），
  卡片 `aria-pressed` + 描边 + 轻微上浮（0.15s，`prefers-reduced-motion` 下不做位移与过渡）；
  主键文案跟着选中卡变，键盘 Tab 到它按 Enter 是原生行为；焦点不在任何可交互元素上时全局 Enter
  也触发主键（焦点在输入框 / 卡片上时归它们各自的默认动作）。
- **大厅顶栏摆货币条**（视觉 P0 = 文档 #4）：🎟 游戏券余额（`gameTickets` 能力位为真**且**读到余额才摆）
  + ⚡ token 余额（钱包快照有才摆），点进 `/me?wallet=1`（`components/UpgradeLink.UPGRADE_HREF`）。
  **局内金币 / 血量仍然不进大厅**（原来那条判断成立：那是对局中的读数）。
- **等匹配那一屏有"等多久"**（视觉 P0 = 文档 #17 / #19）：雷达（纯 CSS）+「已排队 N 秒 · 预计 x 分 xx 秒」
  —— `queue.etaSec` 是服务端的估算，null 时按客户端 `QUEUE_TIMEOUT_MS`（60 秒）说「预计最多 1 分 00 秒」，
  两个数不混成一个；「取消匹配」保留（取消是安全操作，不加确认弹窗）。
- **房间码的传播**（视觉 P0 = 文档 #22 / #23）：房间屏除了念房号，还有「复制 / 二维码 / 分享」。
  二维码编码的是**邀请文案**（房号 + 打开 App → 开工坊对局 → 加入房间）——今天没有"扫码直接进房"的
  路由，编码一条打不开的房间链接比编码一段能照做的文字更坏（将来加 `#/room/:code` 时只换这一处 payload）。
  分享走 `components/ShareSheet` 的纯文案变体（`TextShareSheet`，与视频分享同一层底壳、同一套
  `copyText` 退路）；复制成功给 1.4 秒浮字，失败说"剪贴板不可用，长按选中"。
- **离开 `/studio` 会收掉大厅**（视觉 P0 顺手修）：`lobbyStore.open` 是整场会话的持久值 ——
  以前带 `?lobby=1` 进来过、按系统返回键离开 `/studio` 之后，下次不带标记进来仍会看见大厅。
  现在 `StudioPage` 卸载时延迟一拍（避开 StrictMode 假卸载）调 `closeLobby()`，
  顺带退房 / 取消排队（`release()`）。
- **800×363 实测**（headless Chrome DeviceMetrics，舞台 788×351）：顶栏 788×42.8、模式卡 184×104、
  底部主键 256×36（y 277.8，底栏 y 333）、凭码输入 128×32、房间码 chip 88×26.5、邀请卡 352×251.6
  （二维码 88×88）；1384×797 对照：卡 192×104、主键 320×44。完整数字与验法见
  `docs/game-lobby-ui-benchmark.md` §2.5。
- 大厅**不挂 3D**：`absolute inset-0` 实底铺满舞台，同时把工坊画布的 `frameloop` 停掉
  （`StudioPage.canvasCovered` 认大厅，与画布浮层同一条理由；时钟由 `SceneClockKeeper` 接住）。
- 「结束对局」之后**回到大厅**（刚打完一局，下一个动作通常是换一张桌再来），不是回到空桌面。
- 竖屏两边都不挂（`{isLand && <Lobby />}`，与 `GameLayer` 同一条判据）—— G1 的竖屏逐字节不变。

## 二、N 人对局：人数参数化 2~8

### 2.1 一处参数、一处座位表

- `rules.MIN_PLAYERS = 2`、`MAX_PLAYERS = 8`（原来是 3 / 8）；人数超界是**程序员的错**，`createGame` 直接抛。
- 座位表只在一处生成：`lobby.seatIdsFor(n)` = `["me", "ai-1" …, "ai-(n-1)"]`；
  `game/store.startGame(seed, { playerCount })` 拿它建局，AI 名单**从 state 现算**（`aiIdsOf`）——
  原来那份写死三个 AI 的常量删掉了（人数由大厅决定，常量必然漂）。
- `labels.playerName` 补了 ai-4 … ai-7（8 人桌的对手 D~G）。
- `bots.ts` / `phases.ts` **本来就是 N 人**（它们只收 `aiIds` 列表、只遍历 entries），这一轮补的是**覆盖**：
  `scripts/check-game-bots.mjs` 多跑一整局 8 人（538 → 1236 条断言）。

### 2.2 扣血：把「人数 / 4」那条既有规则推广

公式（`rules.DAMAGE_LADDER` 头上逐字写着）：

```
base(r) = DAMAGE_LADDER[r]（r = 0 最后一名、1 倒数第二、2 倒数第三），再往后统一 DAMAGE_OTHERS = 5
damage  = max(5, floor(base(r) × 人数 / 4 / 5) × 5)
```

实测的数（`damageForRank(人数, r)`，r 从最后一名往前数）：

| 人数 | 最后一名 | 倒数第二 | 倒数第三 | 其余 | 整列 |
|---|---|---|---|---|---|
| 4 | 20 | 15 | 10 | 5 | 20 / 15 / 10 / 5 |
| 8 | 40 | 30 | 20 | 10 | 40 / 30 / 20 / 10 / 10 / 10 / 10 / 10 |
| 5 | 25 | 15 | 10 | 5 | 25 / 15 / 10 / 5 / 5 |
| 6 | 30 | 20 | 15 | 5 | 30 / 20 / 15 / 5 / 5 / 5 |
| 3 | 15 | 10 | 5 | 5 | 15 / 10 / 5 |
| 2 | 10 | 5 | — | — | 10 / 5 |

- ★ 8 人局最后一名一回合掉 40：3 回合内出局，整局大约 5~6 回合打完（实测那一局 6 回合、第 4 回合开始有人出局）。
  这是"人数越多每回合掉得越多"的必然结果（与 TFT 8 人同向），代价是 8 人局比 4 人局短。
- 连胜/连败线照人数推广：`ceil(人数 / 2)`（8 人局前 4 算胜、2 人局只有第 1 算胜）。
- 扣血按**存活人数**缩放（不是开局人数）：中途死掉一个人，下一期那一桌就按更小的人数算 —— 原有口径没动。

### 2.3 2 人局的胜负口径（这一轮必须跟着收）

设计稿 §2.5 是「剩下 ≤2 人 → 两名胜者」。在两人局里这句话**开局那一刻就成立**：
照字面判，第 1 回合结算完就是"两人都是胜者"，这一局等于没打。

所以 `rules.winnerTargetOf(座位数) = min(2, 座位数 − 1)`：4 / 8 人局 = 2（原行为一个字没变），
2 人局 = 1（只剩最后一个人赢）；`winnersOf` / `isGameOver` 都问它。
打满 8 回合还两人都在时，按血量取第一名（同 `winnersOf` 原有的"打满按血量"那一条）。

## 三、自定义房间：谁能在房间里做什么

房间有两种：**服务端房间**（联机能力位为真时；房间码由服务端发，别人能凭码进）与
**本机房间**（联机不可用 / 中途掉线时的退路；房间码本地生成、其余座位 AI 补位）。界面是同一屏，
`LobbyRoom.online` 区分两者；联机房间的成员表来自服务端快照，本机房间来自 `lobby.ts` 的纯函数。

| 动作 | 谁能做 | 规矩（`lobby.ts` / 服务端） |
|---|---|---|
| 改人数 2~8 | 房主 | **仅本机房间**：`setRoomSize`：长大补 AI；缩小只许缩 AI / 空位，**跨过坐着的真人整句拒**（`seat-occupied`）。服务端没有改人数端点，联机房间把这一组键**整组藏起来**（见 §4.1） |
| 踢人 | 房主 | `kickSeat`（本机踢 AI）/ `POST /rooms/:code/kick`（联机踢服务端成员）：踢了的位置变空位（**开局时仍由 AI 补上**）；踢自己 → `seat-host` |
| 开始对局 | 房主 | 本机：`canStartRoom`（非房主 → `not-host`；开局人数 = 房间人数，空位全补 AI）。联机：`POST /rooms/:code/start`，服务端要求人数达标 + 全员 ready；自定义房间**至少 2 个真人** |
| 准备 / 取消准备 | 非房主 | 本机：`toggleReady`（房主点 → `host-always-ready`）。联机：`POST /rooms/:code/ready`，房主不用准备 |
| 离开房间 | 所有人 | 本机：`leaveRoom`（房主走 = 这间房散掉）。联机：`POST /rooms/:code/leave`（房主走 = 房主自动转移；最后一人走 = 房间当场删） |
| 邀请 | 所有人 | 联机房间给**真的能用的 6 位房间码**（朋友在大厅「加入房间」里输入）；本机房间只能复制码，界面照实说"别人还进不来" |

状态机是纯函数，`scripts/check-game-lobby.mjs` 拿 100 条正反例跑它（谁被拒、拒绝原因对不对、失败时入参不动）。
为什么要单开一份纯函数：这一层的错全是"按钮点了没反应"（房主被当成客人 / 踢人踢错格 / 缩人数把真人挤掉），
在界面上看不出来。

## 四、联机接口：`src/api/game/rooms.ts`（2026-11-24 接真）

服务端契约的正本在 `ideahub-server` 的 `routes/gameRoom.routes.js` + `services/gameRoom.service.js` +
`docs/api-contract.md`「工坊对局：房间与匹配」（本轮**没改服务端一行**）。App 这一层只做三件事：
拼路径 / 解包形状 / 把失败折成两种（`unavailable` 与 `code`）。界面与 store 都**不直接 fetch**。

### 4.1 接口映射

| App 函数 | HTTP | 请求 | 回包（App 只取这些） |
|---|---|---|---|
| `roomsAvailable()` | `GET /api/ark/health` | — | 能力位 `gameRooms === true`（`data/serverCaps`，**不按版本号猜、不拿 404 当没有**） |
| `createRoom({ mode, size })` | `POST /api/game/rooms` | `{ mode: "custom", seats: size }` | 201 `{ room }` → `RemoteRoom` |
| `joinRoom(code)` | `POST /api/game/rooms/join` | `{ code }` | `{ room }` |
| `readRoom(code)` | `GET /api/game/rooms/:code` | — | `{ room }`（房间屏每 2 秒拉它） |
| `kickMember(code, userId)` | `POST /api/game/rooms/:code/kick` | `{ userId }` | `{ room }` |
| `setReady(code, ready)` | `POST /api/game/rooms/:code/ready` | `{ ready }` | `{ room }` |
| `startRoom(code)` | `POST /api/game/rooms/:code/start` | `{}` | `{ room }`（`room.status` 变 `playing`；**没有 matchId**） |
| `leaveRoom(code)` | `POST /api/game/rooms/:code/leave` | `{}` | `{ closed }`（房主走 = 自动转移；最后一人走 = 当场删房） |
| `findMatch(size)` | `POST /api/game/queue` | `{ mode: "match4" \| "match8" }` | `{ status, code?, room?, queued, need, etaSec, position }` |
| `readQueue()` | `GET /api/game/queue` | — | 同上（`status: "idle" \| "waiting" \| "matched"`） |
| `cancelMatch()` | `DELETE /api/game/queue` | — | `{ left }`（幂等） |

**没有「改人数」这一路**：服务端的 `seats` 只在建房时定，`custom` 的 2~8 由 `POST /rooms` 的 `seats` 给，
之后**没有** `PATCH /rooms/:code`。旧桩里那个 `setRoomSize(code, size)` 已删掉；界面在联机房间里
**把人数 −/+ 那一组整组藏起来**（`RoomScreen` 认 `room.online`；本机房间照旧能改，走 `lobby.setRoomSize`
纯函数）。不摆而不是灰着：灰着会让人以为"等一会儿就能改"。真要换人数 = 退出重建。

服务端房号是 **6 位大写字母数字**（`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`，没有 I/O/0/1），
与本机那份纯数字码不是同一条规则：加入框用 `lobby.normalizeServerCode`（去空格 + 转大写 + 6 位字母数字），
本机码仍用 `lobby.isRoomCode`（检查脚本钉着"不认字母"）。

### 4.2 错误怎么映射（**认 code 不认 message**）

`RoomsResult<T> = { ok: true; value: T } | { ok: false; reason: "unavailable" } | { ok: false; reason: "code"; code: string }`。

| 收到什么 | 折成 | 界面怎么走 |
|---|---|---|
| 断网 / 10 秒超时 / 401 / 5xx / 429 | `unavailable` | 自动退回本机 AI，底栏「没连上房间服务，先用 AI 开局」 |
| 老服务端：404 且**没有**业务码 / 200 + index.html（SPA 回退） | `unavailable` | 同上 |
| 回包 2xx 但形状不认识（`room` 缺失 / 成员没有 `userId`） | `unavailable` | 同上（读出一个空房间比说"没连上"更坏） |
| `ROOM_NOT_FOUND` / `ROOM_FULL` / `ROOM_ALREADY_STARTED` / `ALREADY_IN_ROOM` / `NOT_IN_ROOM` / `NOT_HOST` / `NOT_ENOUGH_PLAYERS` / `NOT_ALL_READY` / `CANNOT_KICK_SELF` / `MEMBER_NOT_FOUND` / `QUEUE_MODE_CONFLICT` / `GAME_ROOMS_OFF` / `BAD_*` / `SEATS_LOCKED` | `code` | 底栏按 `lobbyReasons.roomCodeText` 说人话；不退回（房间还在，接着等 / 改操作） |

- **404 有两种**：服务端说「没有这间房」是 404 + `ROOM_NOT_FOUND` → `code`（界面说"房间码不对或已过期"）；
  老服务端根本没有这条路是 404 + 没有业务码 → `unavailable`。判据是**回包里的 code**，不是状态码。
- `message` 只进日志（英文、给老 App 兜底），**一个字都不上屏**。
- `GAME_ROOMS_OFF`（503）也照实说"这台服务器把房间服务关掉了"，然后按本机 AI 开局 ——
  能力位是会话级缓存，运维中途关掉时这一条还能兜住。

### 4.3 轮询 / 超时 / 退回策略

所有定时器只有一处：`ui/useLobbyOnline.ts`（组件卸载 / 换屏 / 关卡就 cleanup；store 里没有 setTimeout）。

**等匹配**
- 点 4/8 人 → `POST /api/game/queue` 进队；之后 **2 秒一拍，POST / GET 两拍一换**：
  - POST（第 0、2、4… 拍，约每 4 秒）= 续队 + 撮合（服务端的 `tryMatch` 只在 `enqueue` 里跑）+ 90 秒心跳；
  - GET（第 1、3、5… 拍）= 只读状态。
- ★ 为什么不是"全 GET"：服务端的撮合**只在 POST 里**，只 GET 的话四个人齐了也没人建房。
  ★ 为什么不是"全 POST"：匹配成功之后本人已经是房间成员，`enqueue` 会先查"你在不在房里"，
  下一发 POST 回 **409 `ALREADY_IN_ROOM`** 而不是 matched —— 全 POST 会在拿到房号之前把自己判成失败
  （2026-11-24 dev 实测：房间建出来了、客户端却退回了本机 AI）。收到这个 409 时改发 GET 读 matched + 房号。
- **60 秒上限**：到点主动停拍、`DELETE /api/game/queue`、底栏写「没匹配到真人，先用 AI 开局」，
  这一屏换成"我 + AI 补位"，玩家点「用 AI 开局」就按现有本机流程开（**不自动把人拖进对局**：
  那句话要让人看得见；再点一下是他的选择）。
- 轮询里任何接口不可用 / 超时 → 停拍 + 退本机 + 同一句「没连上房间服务，先用 AI 开局」。

**房间里**
- `GET /api/game/rooms/:code` 每 2 秒一拍：成员进出、准备状态、房主转移、开局都靠它。
- `status === "playing"` → 停拍，两个入口（房主点开始 / 别人开的局）汇到同一条路：
  `startFromLobby(room.size)` 建本机局（座位数 = 房间座位数，空位 AI 补），`closeLobby` 顺手退掉服务端房间
  （联机房间只是"谁跟谁一桌"的凭据，本机对局一开就没用了；留着下一局会撞 `ALREADY_IN_ROOM`）。
- `ROOM_NOT_FOUND` / `NOT_IN_ROOM` / `closed` → 退回本机同人数房间（AI 补位）+ 原因。
- **被房主踢掉**：房间还在、快照也读得到，但成员表没有我 → 退回本机房间，底栏「你被房主移出房间了」。
  （不认这一条的话，被踢的人会停在一间"自己不在了"的房间里，点准备才吃一个 `NOT_IN_ROOM`。）
- 快照连续失败 / 超时 → 退回本机房间，底栏「没连上房间服务，先用 AI 开局」。

**自定义房间的"真人不够"**
- 服务端 `custom` 开局**至少 2 个真人**（不看选了几座），且全员 ready。
- 房间里只有我一个真人时，房主那颗键直接是「用 AI 补位开局」+ 一句「服务端要至少 2 个真人才开局；
  现在只有你，点一下先用 AI 补位开一局」——点了就退掉联机房间、按本机 AI 补位开局（不先撞一次 409）。
- 真人 >= 2 时房主点「开始对局」走 `POST /start`；`NOT_ALL_READY` 照实说"还有队友没点准备"，
  `NOT_ENOUGH_PLAYERS`（有人中途走了）→ 换成本机 AI 房 + 原因，再点一次就开。

**退出 / 收尾**
- 关大厅 / 回大厅 / 离开房间 / 开局：主动退房 + `DELETE /queue`（开局后那一行 matched 也要清，
  它会在服务端留 10 分钟）。退房请求失败只在控制台留一行、底栏说「这间房可能还挂在服务端」。
- 不把"退房"挂在组件卸载上：React StrictMode 的假卸载会先跑一次 cleanup，在那里退房会让 dev 里
  刚建好的房当场散掉。真崩溃 / 杀进程由服务端兜底（waiting 房 30 分钟、playing 2 小时、排队心跳 90 秒）。

### 4.4 退回本机 AI 的触发条件（一张表）

| 触发 | 退到哪 | 底栏那一句 |
|---|---|---|
| 能力位 `gameRooms` 不是 true / 还没探到 | 本机匹配 / 房间 | 没连上房间服务，先用 AI 开局 |
| 建房 / 进房 / 进队 请求不可用或超时 | 本机 | 同上 |
| 匹配 60 秒没等到真人 | 本机匹配（AI 补位） | 没匹配到真人，先用 AI 开局 |
| 房间里快照连续失败 / 超时 | 本机房间（同人数） | 没连上房间服务，先用 AI 开局 |
| 房间已关闭 / 已过期 / 我不在成员表里 | 本机房间（同人数） | 没有这间房… / 你被房主移出房间了 |
| 自定义房间只有 1 个真人 | 本机房间（同人数） | 服务端只算真人座位（至少 2 人），已切回本机 AI 补位 |
| 退房请求失败 | 界面已退回大厅 | 没连上房间服务：这间房可能还挂在服务端 |

## 五、怎么验的（2026-11-24 接真）

1. `node scripts/check-game-rules.mjs` → **938** 条；`check-game-bots.mjs` → **1236** 条；
   `check-game-lobby.mjs` → **100** 条（纯状态机，本轮只给 `LobbySeat` 加了展示用 `name?`）。
2. `node scripts/check-i18n.mjs` → **en 缺译 0**（新增 40 条英文文案，同一 PR 进 `en.po`）。
3. `npm run build` 绿（tsc + lingui extract + 全部 check + vite build）。
4. 本地服务端（`ideahub-server`，`MONGO_URI` 指本机 Mongo；`CORS_ORIGINS` 临时加上 dev 的源，
   **没改服务端一行代码**）+ `npm run dev`，两个来源（`localhost:5178` / `127.0.0.1:5178`，
   localStorage 按源隔离）各登一个测试账号：
   - **4 人匹配**：浏览器 A 点 4 人匹配 → `POST /queue` 回 `1/4`；用 B/C/D 三个账号直接调
     `POST /api/game/queue` 填到 4 人 → 最后一发返回 `matched` + 房间码；A 的下一拍（GET 或 POST→409→GET）
     进房间屏，成员表 4 个真人（lobbya 房主 + lobbyb/c/d，服务端快照逐个对过）。
   - **房主开局**：A 点「开始对局」→ `POST /start` → 房间 `playing`；A 自动建 4 人本机局（me + 3 AI）、
     大厅收掉；A 离开后服务端房主自动转移给 lobbyb（`hostId` 变了、memberCount 3）。
   - **自定义房间**：A 建 `custom` 4 座（`WLYEU2`）→ B 在第二个来源的大厅「加入房间」输入码进房
     → 屏幕上 `2/4`、lobbya 房主、我未准备、两个空位写「AI 补位」；B 点「准备」→ A 的下一次轮询看到
     `ready:true`、`canStart:true` → A 点「开始对局」→ 两边都自动建 4 人本机局（各 2 个空位 AI 补）、
     两人都离开 → 服务端房间 404（当场删掉）。
   - **踢人**：A 建房（`XALTF5`）→ B 进房 → A 点 B 那一格的「踢掉」→ 服务端成员表只剩 A；
     B 的下一拍发现自己不在成员表 → 自动退回本机 4 人 AI 房 + 底栏「你被房主移出房间了，先用 AI 开局」。
   - **60 秒上限**：A 点 8 人匹配（只有自己）→ 队列 `1/8`；60 秒后 store 变
     `online:false / note:queue-timeout / queue:null`，界面换回"我 + 7 个 AI 补位" +
     「没匹配到真人，先用 AI 开局」，`GET /queue` 服务端回 `idle`（取消排队成功）；之后再等 7 秒
     没有新的 `/api/game/queue` 请求（轮询确实停了）。
   - **断开退回**：停掉本地服务端 → 大厅能力位探不到（`serverOnline:false`）→ 点 4 人匹配
     **一个房间请求都不发**，直接是"我 + Rival A/B/C（AI fill）" + 「没连上房间服务，先用 AI 开局」；
     点「用 AI 开局」正常开 4 人局。
   - **自定义房间只有自己**：A 建房（`FJHR7X`，1/4 真人）→ 房主键是「用 AI 补位开局」→ 点了之后
     本机 4 人局开起来、服务端房间 404（先退房再开）。
5. 真机（`3C15CJ00C8V00000`）：`npm run apk:release` 出 **release** 包（`com.ideahub.branchvideo`，
   不是 debug）→ `adb install -r` 成功（versionCode 93 / 2.81，和装之前同一个版本号）→ 启动后
   首页 / 创意工坊都能开，**但这台机器上的 release 包当时是登出状态**：点「我的仓库」只到登录页
   （登录页有密码登录，我们手里没有主人的生产账号密码；没有当场注册生产账号）。所以"真机上看一眼大厅"
   **没看到**：联机大厅在 `/studio` 的 `RequireAuth` 后面，登录墙挡住了。dev 两个来源上的联机流程
   （§五-4）是这一轮的真凭据；真机只证了"release 包能装、能起、能连服务器"。
   真机观感要主人在已登录的那台 release 上补看一眼。

## 六、还没做 / 剩下的风险

- ~~**对局本身没有联机**~~：2026-11-24 接上服务端回合引擎之后，**交片 / 展映 / 点赞 / 投票 / 结算 / 下一回合**
  已经是服务端在推进（§七）。**推送**也已接上（§7.10：`GET /rooms/:code/stream` 的 SSE，2026-11-24）——
  "WebSocket"这句从此不成立，剩下的仍然没有：回合级断线重连（流断了是**退回 2 秒轮询**继续打，不是找回失去的那几秒）、
  服务端事件端点（事件仍只在本机跑）。
- **空位 AI 的口径（2026-11-24 改口）**：联机房间的空座位**不参加服务端回合**（服务端的回合只算真人成员，
  结算榜里没有 AI）。房间里只有 2 个真人时，这一局就是 2 人局。旧文档里"空位由 AI 补齐"那句
  只对**本机大厅**成立（服务端房间的空位不再补 AI）。
- **8 人匹配没有单独跑满一桌**：4 人匹配已经用 3 个 API 会话 + 1 个浏览器跑通；8 人走的是同一段代码
  （只差 mode / size 与 7 个 API 会话），本轮只验到"进队 / 超时退回"，没验到"8 个真人建房间"。
- **断线重连 / 心跳续命**：客户端侧断网会**明确说一句**然后退回单机（§七-6）；服务端那间房靠
  30 分钟寿命 / 90 秒排队心跳清掉。**App 被杀 / 刷新 / 切后台**的重连已经补上（§7.2 最后一条）：
  房间还活着且我在成员表 → 回到同一局、服务端当前回合；房间没了 → 回大厅并说「这一局的房间已经结束」。
  对局中**断网**（轮询连续失败）仍然按"改成单机继续"处理，不会自己重连回联机。
- **`ALREADY_IN_ROOM` 的收尾（2026-11-24 修掉了）**：如果某次退房请求真的失败（比如关大厅那一刻断网），
  服务端还留着这个人；下一次建房 / 进队会回 `ALREADY_IN_ROOM`。**旧行为**只照着说一句"你已经在另一间房里"、
  **没有退出键**，要等 30 分钟房寿命或去另一台设备退（真机验收就撞上了这间房：服务端已把房建出来、
  客户端却以为失败退回本机）。**现在的行为**（§7.12）：
  · 服务端在 `ALREADY_IN_ROOM` 回包**顶层**带 `roomCode`（create 与 join 两条分支都带；join 的
    "你本来就在这间房"那一支还带整份 `room` 快照），客户端据此在大厅底栏摆「你还在房间 XXXXXX，退出后重试」
    + 一颗「退出那间房」的键；点它 `POST /rooms/:code/leave`，成功之后按**原意**（建房 / 进房 / 排队）自动重试一次；
  · **契约缺口（服务端侧，App 改不了）**：没有"我当前在哪间房"的只读端点（`GET /api/game/queue` 只在
    matched 那一行带房号），也没有"按账号退掉所有房"。所以客户端只能在收到 `ALREADY_IN_ROOM` 之后才知道房号；
    老服务端 / 别的实现若不回 `roomCode`，App 会先 `GET /api/game/queue` 尽力找，再"重放一次原意"让服务端
    把房号再说一遍 —— 都不行时只能如实说"你还在别的房间里"并把键摆着（真到这一步要服务端补字段）。
- **大厅没在真机上被人看过**：本轮 release 包装上了、也能起，但那台机器上的 release 是登出状态
  （见 §五-5），`/studio` 在登录墙后面，没有主人的生产账号密码就进不去；观感与"真机上顺不顺手"
  要主人在登录着的包上补看一眼。
- **对局中的「✕ 结束对局」在选风格那一屏点不到**：`StylePick` 是 z-40 全屏（G2 就有，不是这一轮引入的），
  盖住了顶栏。要回大厅得先把风格选完。这一轮没动它 —— 真要修就是给风格屏补一颗退出键。

## 七、联机回合：房间里的这一局跟服务端走（2026-11-24；2026-11-23 接事件与结束状态）

服务端回合引擎的契约正本在 `ideahub-server` 的 `routes/gameRoom.routes.js` + `services/gameRound.service.js`
（2026-11-24 那一轮**没改服务端一行**；2026-11-23 这一轮的服务器一侧改动在 `ideahub-server` #158：
`rounds/events*` 两个端点 + 房间快照的 `state` / `winners` / `finishedAt`，App 只照契约接）。
App 这一侧只做"把服务端的事实接回本机状态"，榜与扣血**一个数都不重算**。

### 7.1 两条路的判据：什么时候联机、什么时候退回单机

| 条件 | 走哪条路 |
|---|---|
| 大厅里 `roomsAvailable()`（`health.gameRooms`）为真 **且** 这一局是从服务端房间开出来的 | **联机回合**：房主开局后先 `POST rounds/start`，双方读到回合快照才建本机局 |
| 能力位为假 / 房间是本机的 / `rounds/start` 或 `rounds/current` 不可用（超时、5xx、老服务端） | **本机单机**（`startFromLobby`）：底栏说「回合服务没响应，这一局改成单机继续」 |
| 中途轮询失败 / 房间没了 / 被移出房间 | 同上：**明确一句**，把本机 loop 接回来（补齐 AI 这一期的动作），不静默 |

- 联机开局**不退房**：`closeLobby({ keepRoom: true })` 只清大厅界面、收掉队列行；房间码交给回合引擎。
  退房只在**对局结束**（结束对局 / 返回大厅）由 `roundsStore.leaveNow` 做。
- 本机那几个 AI 座位**不参与联机回合**（服务端只认真人成员）；它们只是本机商店 / 摆卡界面的座位。
  对手条在联机局里画的是**服务端房间成员**（名字 + 服务端 hp），不是本机 AI。

### 7.2 阶段怎么对上

| 服务端 `phase` | 本机做什么 |
|---|---|
| `creating` | 本机照常走 选风格 → 商店 → 创作；创作屏交出片（服务端 `allSubmitted` 之前房主不能开演映） |
| `screening` | 本机阶段**强制**跟到 `screening`（不跑本机"全员交片"那道闸 —— 联机的全员 = 房间成员）；播服务端 entries |
| `voting` | 本机跟到 `voting`；投票 / 弃权写回服务端 |
| `settled` | 本机进 `round-end`：结算屏**只渲染服务端回包**，hp 用服务端值回写本机玩家；随后本机事件（见 7.5） |

- `POST rounds/start` 由**房主**在房间变 `playing` 之后发；其他人轮询 `GET rounds/current` 等回合出现。
  房主那一发回 `ROUND_ALREADY_STARTED`（双击 / 超时其实已建）时改读 current，不判失败。
- 房主推 `screening` / `voting` 用 `POST rounds/phase`；**非房主看到的是「等房主开始展映 / 投票 / 下一回合」**，
  不是灰按钮（任务点名）。
- **房主转移（2026-11-24 收口）**：`isHost` 不再是开局那一刻的常量 —— 对局里**每 2 秒**的那一拍
  同时读 `GET /rooms/:code` 与 `GET rounds/current`，用房间快照的 `hostId` 和 `session.myUserId` 比对，
  刷新 `session.isHost`（判据在 `studio/game/onlineHost.ts`，唯一一处）。旧房主退出后服务端把 `hostId`
  转给下一个人，**新晋房主在下一拍就拿到**「开始展映 / 去投票 / 📊 结算 / 下一回合」，
  剩下的人**不需要退出重进**。竞态（键还亮着的那一拍服务端已经换了房主）回 `NOT_HOST` / `WRONG_PHASE` /
  `ROUND_NOT_SETTLED` 时，客户端**拉一拍快照、不把"这一步只有房主能做"留在底栏**（那不是玩家做错了）。
- `POST rounds/next` 只有房主能发；所有人从轮询里读到新回合，本机跟着 `beginRound`（收入 + 新商店）。
  **服务端没有 8 回合上限**：本机 `beginRound` 加了 `allowPastLimit` 给联机这一条路（单机仍然拦第 9 回合）。
- **重连（2026-11-24 轻量版）**：开局成功时本机记一条 `{roomCode, myUserId}`（`onlineResume.ts`）；
  App 被杀 / 刷新 / 切后台回来时，App 根的 `OnlineResumeGate` 先 `GET /rooms/:code`：
  200 且我在成员表 + `rounds/current` 读得到 → 用房间快照 + 回合快照重建本机局（直接跳回服务端当前回合，
  见 `phases.resumeOnlineRound`）；房间没了 / 我不在成员表 / 已不在 playing → 清记录、回大厅并说
  「这一局的房间已经结束」。连不上时不删记录（下次冷启动再试）。
  ★ 卡组 / 金币 / 商店是本机事实（服务端不存）：重连之后**这一回合的桌面从空重开**，这是轻量重连的取舍。

### 7.3 交片（rounds/entries）

- 生成出片成功（GenSheet「用这一条交片」）或占位片（创作屏「用占位片交片」）都会先写本机这一期
  （`rules.submitRoundEntry`，单机的展映 / 结算要它），再发服务端：
  `{ prompt, cardNames（桌面卡 + 装备道具的名字）, videoUrl?, posterUrl?, placeholder, modelTier }`。
- 提示词上限取**本机规则与服务端更严的那个**：服务端 `PROMPT_MAX = 80`，本机带事件加成能到 120 ——
  联机屏按 80 显示与截断（否则写着 100 字，交片那一发被 `PROMPT_TOO_LONG` 拒）。
- 卡名最多 20 个（服务端 `CARD_NAMES_MAX`；满配 4 角色 + 道具上限加成可能到 21，截到 20 而不是整发被拒）。
- 提交成功后创作屏显式写「✅ 已交片，等其他人（x/y 已交）」，并弹一句轻提示「已交片，等其他人」——
  **不是**提交完就静默。服务端轮询到的 `entries` 里有没有我，是这句话的唯一判据。

### 7.4 展映 / 点赞 / 投票

- 展映屏（`OnlineScreeningPanel`）**照服务端 entries 的顺序播**，不自己排序；一条一条播 + 进度条与单机一样。
- 点赞 → `POST rounds/like {targetUserId}`；**联机版禁止自赞**（服务端 `CANNOT_LIKE_SELF`）：
  自己那条不摆点赞键，并写一句「联机版不能给自己的片子点赞」。
- 投票 → `POST rounds/vote {targetUserId}`（`null` = 弃权）；自己那条不列出来（不能自投）。
  服务端快照不暴露"我弃权了"，所以弃权只在本机 `roundsStore.abstainedRound` 记一笔（只影响界面）。
- 被淘汰的人不能交片 / 点赞 / 投票（服务端 `PLAYER_ELIMINATED`）：界面先把按钮挡住并说清楚。

### 7.5 结算 / 扣血 / 下一回合 / 事件

- **榜与扣血只渲染服务端 `settlement`**：`ranking[]` 的顺序就是服务端给的综合名次，`damage` / `hp` /
  `eliminated` 原样念；本机不跑 `rules.settleRoundFromVotes`，也不自己排名次。
- `hp` 用服务端值回写本机**我这个玩家**（HUD / 结算屏那个 ❤ 是服务端的数）；对手血量来自结算行 / 房间快照。
- 全员表态（`votesPending === 0`）之后**任何成员**都能触发结算（服务端契约），App 在轮询里自动调一次；
  房主那颗「📊 结算」随时可点（服务端允许房主提前结算）。
- 结算里带 `winners` = 这一局结束 → 本机直接进 `over`（所有人同一拍看到胜者）；**不带不代表没结束**
  （平局时服务端会把空数组省掉 → 靠下面那条房间快照的判定）。
  `rounds/next` 回 `GAME_OVER` 时（只有房主会收到，带顶层 `winners`）也进 `over`。
- **平局 / 结束的非房主感知（2026-11-24 收口；2026-11-23 改成读协议字段）**：`rounds/next` 只许房主发、
  且服务端**先判房主再看胜负**，非房主永远拿不到那个 `GAME_OVER`；平局时服务端连 `settlement.winners`
  都省掉（空数组被 `gameRound.settlementOf` 丢掉）。所以结束判定归到 `onlineHost.roomOverOf` 一处，
  今天**首读房间快照的 `state` / `winners`**（服务端 2026-11-23 起给了，见下面那条）。
  ★ 老服务端（没有 `state`）才走那条过渡分支：在当前回合**已结算**时按服务端 `gameOverOf` 的同一口径
  （存活人数 ≤ `winnerTargetOf(当前房间成员数)`）从 `members[].hp` 推胜者（同血按 userId，与服务端同序；
  0 人存活 = 空胜者 = **平局**）；为什么卡 settled：中途有人退房也会让存活数提前达标，但那时还没结算，
  服务端 next 也不会回 `GAME_OVER`。
- 结束时所有端（房主 / 非房主）都在同一拍进 `over` 屏，显示服务端名单；平局显示「平局（同归于尽）」。
- **结束 / 平局改读服务端字段（2026-11-23 服务端补齐，`ideahub-server` #158）**：
  `GET /rooms/:code` 现在带 `state`（`waiting | playing | over`）+ `winners`（`[]` = 平局）+ `finishedAt`，
  判结束**只看 `state`**（`onlineHost.roomOverOf` 一处）：`"over"` → 进 over（`winners` 空 = 平局）；
  `waiting` / `playing` → **没结束**（有协议字段之后就不再按 hp 猜）。落库时机是房主 `rounds/next` 遇
  `GAME_OVER` 那一发（`markRoomOver`），所以房主 / 非房主在**同一拍**从同一份快照读到它，不需要谁点下一回合。
  ★ 老服务端没有 `state` 时只剩**一条过渡分支**：按服务端 `gameOverOf` 同口径从 `members[].hp` 推、
  只在 `settled` 时认（注释写明是过渡）；服务端补字段之后它永远走不到，攒到下线老服务端就整段删。
- **回合间事件由服务端出题（2026-11-23，G5 联机第三块）**：`health.gameEvents` 为真时，结算后读
  `GET rounds/events`（同一房间同一回合同一道题，**两端的 `eventId` 一样**），面板用服务端给的 `title` /
  `options`；选择写 `POST rounds/events/choice {optionId}`（幂等，第一选作数；跳过 = `"skip"`）。
  ★★ **只落 `effects.client`**（金币 / 档位 / 道具上限 / 免费刷新 / 随机卡）：`effects.server.hp` 在服务端
  这一次原子更新里就已经落库，本机**一个数都不再应用** —— 新血量从房间快照 `members[].hp` 读回来
  （`rules.applyOnlineEventChoice` 见到 client 里带 hp 会当场抛错：那是契约变了，不是"少加一次"）。
  金币仍然由 App 扣（服务端没有金币账户），扣钱与"摆不摆得起"都问 `rules.optionAvailable` 同一个 gate。
  ★ `allChosen` **只用来念一句**「全员都选好了 / 还有人没选」，**不拦下一回合**（服务端刻意不拦：
  效果在 App 本地落，卡在事件屏对整桌没有好处）。回包只有布尔、没有人数，所以没有 `x/y` 那个数
  （要它得服务端多给两个字段；本轮不改契约）。
  ★ 能力位为假 / 这一发不可用（超时 / 5xx / 形状不认识 / `GAME_EVENTS_OFF`）→ **退回本机事件**，
  界面明写「事件只在本机生效（不会影响别人）」；能力位还没探到时先停在结算屏、下一拍再问
  （不当服务端，也不急着判成本机）。

### 7.6 定时器与失败

- **联机回合只有一个定时器**：`ui/useOnlineRounds`（递归 setTimeout，一拍没回来不叠下一拍）。
  每拍**并发两发**：`GET rounds/current`（打什么）+ `GET /rooms/:code`（谁在推进 / 谁还活着 / 这局结束没有）。
  服务端 `game-room-poll` 限流 240/分钟，这一端只花 60/分钟；房间快照这一发失败**不切单机**
  （沿用上一份房主 / 血量，下一拍再问），回合那一发失败才算断线。
  **2026-11-24 起**：推送（§7.10）正常时这一拍放宽到 **15 秒**（`ROUND_POLL_LIVE_MS`），
  流断了 / 重连中立刻回到 **2 秒**；流正常时轮询那一发**传输层**失败不再判死这一局（主通道还在推），
  但服务端**明确回了业务码**（`NOT_IN_ROOM` / `ROOM_NOT_FOUND` …）照旧收场。
  它同时负责：对齐本机阶段 / 回合、刷新房主、判结束、到结算阶段取 settlement、掉线退回单机、对局结束退房。
- 大厅那一侧仍然只有 `ui/useLobbyOnline` 一个定时器；它多了一段"房间 playing 之后等回合铺好"的逻辑
  （房主建 / 其他人等，最多 30 秒），超时同样说一句再退回单机。
- 掉线退回单机时 `phases.fillLocalOpponents` 会补齐 AI 这一期的动作（交片 / 点赞 / 投票），
  所以"这一局改成单机继续"是真的能继续打完的，不是停在一屏不动。

### 7.7 已知限制

- **推送是不是单实例，看服务端那一拍**：线上 pm2 cluster + nginx，服务端 2026-11-24 起用
  **Redis pub/sub** 把"这间房变了"跨实例转发（`services/gameRoomBus`，服务端 #160）；`/api/ark/health`
  的 `gameRoomStreamShared` 说这一刻它是不是真的共享（true = 两个实例上的订阅者都能收到）。
  **但 App 这一版不读那一位、轮询永不撤**：旧服务端 / Redis 掉线降级期间推送还是单实例的，
  最坏情况是"别人交片要等一次兜底轮询才看到"（流正常时 15 秒），不是"永远看不到"。
  实测见 §7.12：真机上 push 帧到达 → 屏幕翻牌只有 **2ms**，慢的是服务端写库与网络那 1~2 秒。
- **事件只在"服务端出题"那一档才跨端**（见 7.5）：`health.gameEvents` 为假的老服务端上仍退回本机那一套
  ——那时各人抽各人的题，界面明写「事件只在本机生效（不会影响别人）」。`GAME_EVENTS_API=off`
  急停的那一发也会落到这条路（503 → 本地事件），所以它不是"老服务端专属"的退路。
- **老服务端的结束位（过渡分支，待下线）**：没有 `state` / `winners` / `finishedAt` 的服务器上，
  `onlineHost.roomOverOf` **只在回合已结算时**按服务端 `gameOverOf` 的同一口径（存活 ≤ 胜者名额）从
  `members[].hp` 推。口径与服务端一致（同血按 userId、名额按当前成员数），但这是**镜像规则**不是协议字段：
  老服务端若改 `gameOverOf`（名额 / 排序 / 提前收局），这里必须同 PR 跟着改。新服务端给了 `state` 之后
  这条分支永远走不到（`state` 有值就照读），攒到老服务端下线可以整段删掉。
- **事件回包只有布尔 `allChosen`、没有「几个人选了」**：所以事件屏念的是「全员都选好了 / 还有人没选」，
  不是 `x/y`。要那个数得服务端在回包里多给两个字段（本轮不改契约）。
- **重连是轻量的**：只找回"同一局、同一回合、同一批对手"，**卡组 / 金币 / 商店 / 已摆的卡不恢复**
  （服务端不存本机牌桌）；`phases.resumeOnlineRound` 只补发**一回合**收入（重连那一回合要有钱买东西，
  也不能靠刷新刷金币）。记录在 `localStorage`（按账号对），超过 6 小时不再尝试（playing 房寿命 2 小时）。
- **中途离开对局**（关掉工坊 / 杀进程）不会主动退房，靠服务端 playing 2 小时寿命收掉；
  现在重进会**自动回房**（见 7.2 重连），但只在"记录还在 + 房间还活着"时。
- **中途有人退出**：对手条 / 成员数来自 `session.members`（开局快照），成员血量靠 `memberHp`
  （结算覆盖）；有人退房后成员名单本身不会跟着缩，`x/y 已交` 的分母可能偏大。结束判定读的是
  **服务端房间快照的当前成员**（不受影响）。要补的话是每拍把 `session.members` 一并刷新。
- **本机 AI 座位在联机局里不做任何动作**（它们不参与服务端回合）；商店里买卡 / 摆卡只影响**我这个真人**这一期交的卡名与本机出片。
- **换语言之后历史交片的卡名**是交片那一刻界面语言的字符串（服务端只存字符串，没有卡目录翻译）。
- **房主换手没有单独提示**：新晋房主看到的是阶段条上多出推进键（任务口径：提示条改成键）。
  如果希望"你成为房主了"那句轻提示，是下一轮的小改动（要新增文案 + 一次 `GameNotice`）。

### 7.8 怎么验的（2026-11-24 接回合引擎 + 房主转移 / 平局 / 轻量重连收口）

1. `node scripts/check-game-online.mjs` → **126 条**（正例 124 / 反例 2：阶段对齐 / 下一回合 / 第 9 回合 /
   掉线补齐 AI / 本机事件 + **房主转移**（hostId 换人后 isHost 翻转、阶段键跟着换手）+
   **平局结束**（服务端没 winners 时按 hp 推、同归于尽 = 空胜者）+
   **重连**（resumeOnlineRound 只补一次收入））；`check-game-rules` 938 / `check-game-bots` 1236 /
   `check-game-lobby` 100 不变。
2. `npm run build` 绿（tsc + lingui extract + 全部 check + vite build）；`check-i18n` → **en 缺译 0**
   （本轮新增 3 条：平局 / 房间已结束 / 重连没连上）。
3. 本机服务端（`ideahub-server` 最新 main = 回合引擎那一版；`MONGO_URI` 指本机 Mongo 的测试库，
   `GAME_ROUNDS=on`，**没改服务端一行**）+ `npm run dev`（这一轮 dev 在 **5178**，服务端 4000），
   两个来源（`localhost:5178` / `127.0.0.1:5178`，localStorage 按源隔离）各登一个测试账号
   （lobbyr1 房主 / lobbyr2 客人），另用两个 API 会话（lobbyr3 / lobbyr4）补齐 4 人桌
   （只调 `join` / `ready` / `entries` / `vote`，不经过界面）：
   - 建房 `BWSDNP`（custom 4 座）→ 4 人进房 / 准备 → lobbyr1 点「开始对局」；两边都进本机对局。
   - 第 1 回合：4 条占位片（A/B 界面、C/D API）→ 房主展映 → 投票 → 自动结算 → 房主「下一回合」
     → `round:2, phase:"creating"`，两边商店重开。
   - **房主转移（本轮重点）**：第 2 回合刚开始，lobbyr1 点「✕ 结束对局」（= 退房）。
     lobbyr2 的下一拍（≤2 秒）里 `GET /rooms/BWSDNP` 的 `hostId` 已经变成 lobbyr2、
     `__rounds.session.isHost` 翻成 `true`、房间成员只剩 3 个真人；lobbyr2 界面上出现
     「▶ 开始展映」→「🗳 去投票」→「📊 结算」→「➡ 下一回合」，并且真的把回合推到了
     `round:3, phase:"creating"` —— **没有退出重进**。旧房主退出前那边一直是「等房主…」的提示条。
   - **平局（非房主也能知道结束）**：另一个房间 `9Z8ZT4`（4 人桌），把本机 Mongo 里
     `members[].hp` 全改成 5 再让房主结算：`ranking` 四行全部 `hp:0 / eliminated:true`，
     服务端结算回包**没有 `winners`**；房主（lobbyr1）与非房主（lobbyr2，他全程没点过下一回合）
     都在同一拍进了 `over`，屏幕上是「🏁 本局结束 / **平局（同归于尽）** / 胜者由服务端判定」，
     `__rounds.winners === []`、`__game.onlineWinners === []`。
   - **轻量重连**：lobbyr2 在第 3 回合刷新整个页面 → 回来后还是 `BWSDNP / round:3 / creating`、
     `__game.online.roomCode === "BWSDNP"`、`session.isHost === true`；金币 9
     = 初始 4 + **一回合**收入 5（只补一次，不是补发 3 回合）。
   - **房间没了**：把一条指向不存在房号（`ZZZZZZ`）的恢复记录写进 localStorage 再刷新 →
     大厅打开、底栏「这一局的房间已经结束」、记录被清掉、`__game.state === null`。
   - **回归（本轮自己撞出来并修掉）**：连开第二局时第 1 回合结算不落地（投票屏卡住）——
     `ui/useOnlineRounds` 的去重键从"回合号"改成"**房间码:回合号**"；修完第二局的结算正常应用。
4. 真机这一轮**没跑**（这台机器没有连着已登录的 release 包）；上面是 dev 两个来源 + 本机服务端的真凭据。
   真机观感要主人在已登录的 release 上补看一眼。

### 7.9 怎么验的（2026-11-23 事件与结束状态接到服务端）

1. `node scripts/check-game-online.mjs` → **190 条**（正例 185 / 反例 5）。新增/改写的是三块：
   第 7 节改读 `state`（`winners: []` = 平局也进 over，判据 `overDecidedOf`；老服务端那条过渡分支单独断言）；
   第 9 节钉住"服务端事件**只落 `effects.client`**"（hp 一点不动、金币照扣、`eventPicks` 只落一次、
   client 里带 hp 当场抛错）；第 10 节钉住"服务端给全量选项、按本机档位 / 连胜筛"；
   第 11 节钉住"能力位为假 / 那一发失败 → 退回本机事件"。
2. `npm run build` 绿（tsc + lingui extract + 全部 check + vite build）；`check-i18n` → **en 缺译 0**
   （本轮新增 8 条：服务端出题那一句 / 全员选好 / 还有人没选 / 正在读服务端事件 / 服务端回血 /
   事件只在本机生效 / 服务端给的 hp / 档位不够那一句）。
3. 本机服务端（`ideahub-server` #158；`MONGO_URI` = 本机 Mongo 的测试库 `ideahub-g5events`，
   `GAME_ROOMS` / `GAME_ROUNDS` / `GAME_EVENTS_API` 全开，`/api/ark/health` 的三个能力位都是 true）
   + `npm run dev`（这一轮 dev 在 **5178**，服务端 4000）。两个来源（`localhost:5178` / `127.0.0.1:5178`，
   localStorage 按源隔离）各登一个新建测试账号（g5a 房主 / g5b 客人），custom 4 座房
   （服务端 `requiredPlayers` 只看真人 = 2），用 `window.__lobby / __game / __rounds` 驱动（与上一轮同一条
   自动化路子），**事件那一屏两次都是真的去点了卡 + 确认**：
   - 房间 `AG425B`：第 1 回合结算后 `eventState:"none"`（第 1 回合本来就不是事件回合）；
     第 2 回合结算后**两边** `__rounds.event.eventId === "model-arms-race"`、`eventState:"server"`、
     `onlineLocalEvents:false`，面板上是服务端的题面（「事件 · 模型军备」），两条升级线已按本机档位筛掉。
   - 各选一项：g5b 点「金币大使」（client `gold+4`）→ 金币 9→13、hp 80→80；g5a 点「批量采购」
     （client `next-round-cost-half`、cost 5）→ 金币 9→4、hp 90→90；两边的 `myChoice` 都写回服务端，
     而且**没等对方选完**就进了 round-end（`allChosen` 不拦下一回合）。
   - 房间 `EZ2SU3`（第 2 回合事件 = 补给站）：g5b 点「医疗补给」（`effects.server.hp = 15`、client 空）→
     金币 9→6、**hp 80→95**（只加了一次 15；两边都应用会是 110，封顶也会是 100）；
     服务端库里 `members[].hp = 95`、`eventPicks` 只有这一条；本机那个 ❤ 也是 95（从房间快照
     `members[].hp` 读回来的），g5a 那边看到对手血量同样是 95。
   - **平局**：房间 `AG425B` 第 3 回合先把库里 `members[].hp` 改成 5（"打空 hp"的等价做法，与上一轮同一条），
     双方照常交片 / 投票 / 结算 → `ranking` 两行 `hp:0 / eliminated:true`、结算回包**不带** `winners`；
     房主点「下一回合」拿 `GAME_OVER` 那一发之后房间落成 `state:"over"` + `winners: []` + `finishedAt`，
     **非房主那一端（全程没点过下一回合）在下一拍（≤2 秒）也进了 over 屏**，屏幕上是
     「🏁 本局结束 / 共 3 回合（联机）/ **平局（同归于尽）** / 胜者由服务端判定」，
     `__rounds.winners === []`、`__game.onlineWinners === []`。
4. 真机这一轮**没跑**；上面是 dev 两个来源 + 本机服务端的真凭据（`AG425B` / `EZ2SU3` 两个房）。
   「能力位为假 → 退回本机事件」只有 `check-game-online` 第 11 节的正反例，**没有**真的把
   `GAME_EVENTS_API` 关掉再打一局（下一轮要验就在起服务端时不带上这个开关）。

### 7.10 推送：一条 SSE 长连接（2026-11-24，服务端 server#159）

服务端：`GET /api/game/rooms/:code/stream`（`text/event-stream`）。App 侧的实现分布在三处，
**每一处都只有一份**：

| 在哪 | 管什么 |
|---|---|
| `api/game/roomStream.ts` | 建连 / 关连接 / 认事件名（`snapshot` / `update` / `ping` / `error` / `end`）/ 把帧里的 `{room, round}` 交给轮询那份解析器 |
| `api/sseBody.ts` | 响应体 → 帧（跨 chunk 半帧 / `\r\n` / 多行 data / 注释行）；`api/stream.ts`（AI 客服那两条流）也走它 |
| `ui/useOnlineRounds.ts` | **唯一**决定"开不开 / 什么时候重连 / 什么时候关"的地方；轮询间隔也在这里跟着切换 |

- **为什么不用 EventSource**：它带不了 `Authorization` 头（服务端留的 `?token=` 只是给 EventSource 的兜底）。
  这里走 `fetch` + `ReadableStream`，token 与全仓其它请求同一个来源、**不进 URL**。
- **帧格式**（服务端契约）：`snapshot` 建连即来（`round` 可能为 null = 还没开第一回合）；
  `update` 之后每次变化都推**整份**快照；`ping` 每 20 秒一次（**data 是空串**，不是没有 data 行）；
  `error` 发完就关；`end {reason:"lifetime"}` 是 30 分钟寿命到，客户端重连。
- **同一个应用函数**：推送帧的解包用 `rooms.remoteRoomOf` / `rounds.remoteRoundOf`（与轮询同一份），
  应用用 `roundsStore.applyRemote`（与轮询同一份）。推送**只是更快地拿到同一份东西**。
  ★ 推送帧里没有结算榜 / 事件：`settleIfDue` 会照旧 `POST rounds/settle` 取回来（与轮询同一处）。
  ★ 推送与轮询可能抢：轮询**在飞的时候**推送应用过快照，那一拍轮询结果整份丢掉（`roundsStore.pushSeq`）——
  否则 HTTP 响应晚到会把刚推来的 `allSubmitted:true` 盖回 `false`（本机实测撞到过，见那边的 ★★）。
- **能力位**：`health.gameRoomStream`（`data/serverCaps.serverGameRoomStream`）。
  读法是 `api/game/roomStream.roomStreamCapability()` 一处，返回 **true / false / null 三态**：
  · false（老服务端）= **一条流都不开**，就是改版前那套 2 秒轮询；
  · null（冷启动健康端点那一发还在飞 / 刚刚失败、`serverCaps` 要 30 秒后才允许重探）= **过 5 秒再问一次**，
    不把这一局永久关掉（2026-11-24 追延迟时发现这条缝：那个窗口里原来的写法会整局悄悄停在 2 秒轮询上，
    底栏连"实时"两个字都不摆）；探到了这一条 effect 会重跑、把流开起来。
- **降级**：流正常 → 轮询 15 秒；流断开 / 重连中 / 已放弃 → 轮询 **2 秒**，底栏一行小字
  「实时连接断了，正在用轮询」（正常时是「实时连接中」）。**轮询一拍都不停**：推送是单实例的（§7.7）。
- **重连**：`end` / 网络错 / 5xx / 半截帧 → 指数退避 **1s、2s、4s、8s、15s（上限 15 秒），最多 5 次**
  （`studio/game/streamRetry`，构建里 `check-game-stream.mjs` 实跑）；5 次都失败就停流、彻底用 2 秒轮询。
  **不重连**的那几种（重连只会把同一句话再要一遍）：`ROOM_NOT_FOUND` / `NOT_IN_ROOM` / `GAME_ROOMS_OFF` /
  `TOO_MANY_STREAMS`（429，服务端契约就写着"停止重试"）/ 401 / 404 / 200 + HTML（老服务端）。
- **心跳看门狗**：45 秒没有任何字节就当这条连接死了（心跳 20 秒一次，漏两拍才判）。手机切飞行模式 /
  Wi-Fi 掉线时 `reader.read()` 会挂在半开连接上直到内核放弃（几十秒到几分钟）—— 没有它，界面会一直写着
  「实时连接中」而对面的交片要等 15 秒那一拍轮询才看到。
- **清理点**（服务端每用户只许 **2 条**并发，泄漏一条就是下一次重连 429）：
  `ui/useOnlineRounds` 那个 effect 的 cleanup —— 离房（`roomCode` 变 null）/ 离开工坊 / 转竖屏（`GameLayer` 卸载）/
  对局结束（`winners` 非 null）；`roomStream.ts` 里 `close()` 幂等，且**任何一条收尾路径**（end / error / 断网 /
  调用方 close）都会 `AbortController.abort()` 关掉底层连接。
- **状态那一行小字**：`roundsStore.stream` 三态 `live` / `retrying` / `polling`（`off` 不摆），
  话只有 `roundsReasons.roundStreamText` 一处说（`retrying` 与 `polling` 是同一句 —— 对玩家是同一件事）。

### 7.11 怎么验的（2026-11-24 SSE）

1. `node scripts/check-game-stream.mjs` → **44 条**（正例）：服务端 `frameOf` 的**逐字格式**喂进真实的
   `api/sseBody` 读循环 —— 一 chunk 两帧 / 一个事件切三块 / CRLF / 心跳空 data / 多行 data + 注释行 /
   末尾没有空行的半帧（flush）/ UTF-8 多字节字符跨块 / 没有 `ReadableStream` 时走 `readText`；
   重连表 1s→2s→4s→8s→15s、5 次封顶、第 6 次停流；再加 15 条源码断言（Bearer 不进 URL / `withAppVersion` /
   帧切分只走 `sseBody` / 认 Content-Type / `close()` 与收尾都 abort / 能力位唯一判据 /
   `ROUND_POLL_LIVE_MS` / 推送与轮询共用 `applyRemote` / 流正常时轮询失败不切单机）。
2. `npm run build` 绿（tsc + lingui extract + 全部 check + vite build）；`check-i18n` → **en 缺译 0**
   （本轮新增 2 条：实时连接中 / 实时连接断了，正在用轮询）。
3. 本机服务端（`ideahub-server` main = SSE 那一版，本地 Mongo 测试库，`CORS_ORIGINS` 放行 dev 两个来源）
   + `npm run dev -- --port 5178`，两个来源（`localhost:5178` / `127.0.0.1:5178`，localStorage 按源隔离）
   各登一个新建测试账号（`sseA` 房主 / `sseB` 客人），custom 房 `PKXRTF`。真凭据：
   - **进入对局**：两边 `__rounds.stream === "live"`，底栏「实时连接中」；房主推进 / 交片都照常。
   - **① 对方交片**：`sseB` 用 API 交片（`POST rounds/entries`），`sseA` 的 store 在 **41ms** 后
     `snapshot.entries.length === 1`（比那一发 POST 的**回包还早 22ms** 到 —— 推送先到）；
     `sseA` 在界面上点「用占位片交片」后，`sseB` 的屏幕从「已交片，等其他人（1/2 已交）」
     翻到「全员都交片了（2/2）」用了 **36ms**（`Date.now()` 两边同机对比）。
   - **② 流断了**：把 `sseA` 的 `window.fetch` 对 `/stream` 打桩成必然失败（模拟"怎么都连不回来"），
     再重启服务端（真断了那一条）→ `live → retrying` 在 **0.5~2 秒**内，底栏立刻是
     「实时连接断了，正在用轮询」；5 次退避（1+2+4+8+15 = **30.2 秒**）后 `retrying → polling`
     （同一句话，不再重连）。整段期间**这一局没有被退回单机**（断网那几拍轮询失败被容忍，没留 fallback）。
     之后轮询实测 **2009 / 2014 / 2009 / 2016 / 2009 / 2010 ms**（2 秒一拍）；
     `sseB` 再交一版（换了提示词）→ 那一发 POST 回包之后 **1.69 秒** `sseA` 看到新提示词（≤ 一拍轮询）；
     房主 `sseA` 在轮询态下把阶段推到 `screening`，本机也进了展映屏 —— 对局能继续。
   - **③ 离房清理**：`sseB` 刚离房前，同一账号（App 那条 + 探针 1 条）再开第 3 条被服务端拒成
     **429 `TOO_MANY_STREAMS`，`details.active = 2`**（说明 App 那条确实占着服务端名额）；
     `__rounds.leaveNow()` 之后新建一间房（`CCNF9C`），探针**连开两条都拿到了 `event: snapshot`**、
     第三条才 429 `active:2` —— 旧连接已经关掉、名额释放了（泄漏的话第二条就会 429）。
   - **没验的**：能力位 `gameRoomStream` 为假的那条路（老服务端）只有 `check-game-stream` 的源码断言，
     没有真拿一台老服务端打一局；也没有真机。

### 7.12 真机验收那一轮的三件事（2026-11-24 晚：推送延迟 / ALREADY_IN_ROOM / 大厅陈旧数据）

这一轮的任务来自真机验收的三个问题。**服务端一行没改**（契约缺口只记在这里）。

#### 一、推送到底有没有生效：真机 + 线上服务端，证据

设备 `3C15CJ00C8V00000`，release 2.81 / versionCode 93 = main `c78bfc1b` 那一份
（量延迟时在同一个包上临时打开了 WebView 远程调试，**那个开关没有提交**；测完装回的是本分支的修复包，
版本号还是 93 —— 同一版本号覆盖装，登录态不丢）。线上 `https://api.ideahubs.org`
（`gameRoomStream=true`、`gameRoomStreamShared=true`）。测试账号 ssedbg1124a + 手机上的生产账号，
custom 房 `LFRRNN`（手机是房主）。

- `GET /api/game/rooms/LFRRNN/stream` → **200 + `content-type: text/event-stream; charset=utf-8`**；
  建连 **410ms** 后收到第一帧 `snapshot`（`members=2 round=1 entries=0 phase=creating`），之后 `ping`
  每 20 秒一次、每次变化一帧 `update`。底栏「实时连接中」不是摆设。
- **对方交片 → 手机翻牌**（对端那一发是在手机 WebView 里发的，同一个时钟）：
  - 请求发出 → 回包 **1263ms**；
  - 回包 → 手机收到 `update`（entries=2）**658ms**；
  - 收到 `update` → 屏幕文字翻到「（2/2 已交）」**2ms**。
- 手机 WebView 上量到的 API 延迟：`/api/ark/health`（不经库）190 / 401 / 199ms；
  `GET /game/rooms/:code` 1486 / 1110 / 1389ms；`GET /game/queue` 1030 / 1042 / 828ms；
  `rounds/current` 1256 / 1077 / 1076ms。
- **结论**：流是生效的，界面也是推送驱动的（2ms）。验收时量到的 2.18~3.08 秒是
  「服务端写库 + 跨太平洋 RTT + 推送扇出」那一段，不是轮询：同一份代码在真机上从请求发出到翻牌
  ≈ **1.9 秒**，其中手机自己那一发 POST 就 1.26 秒；真走 2 秒轮询时，流正常的那档轮询已经放宽到
  15 秒，量到的会是 0~15 秒的随机值，而不是稳定的 2~3 秒。
- 这一轮补了一条缝：能力位 `gameRoomStream` 是 **null**（冷启动健康探测那一发失败 / 还在飞）时，
  旧代码把整局永久当成"没有推送"（而且底栏连"实时"两个字都不摆）。现在 `ui/useOnlineRounds`
  在 null 时每 5 秒再问一次，探到就把流开起来。
- **渲染源**：`CreatePanel` 的「已交片 x/y」与 `PhaseBar` 的阶段条读的都是 `roundsStore.snapshot`
  （推送与轮询写同一份）；`check-game-stream` 钉住这一点，别有人改回"自己数一个本地计数"。

#### 二、`ALREADY_IN_ROOM` 死锁

- 现场（验收留下的那间）：手机账号在服务端有一间 `waiting` 房（房里就房主一个人），客户端却已经
  退回本机房间 —— 之后点建房只回「你已经在另一间房里」，要等 **30 分钟房寿命**。房号 `XXHAS5`
  （09:14Z 建、09:44Z 到期）；我们按服务端 `POST /rooms/:code/leave` 在到期前退掉、账号恢复。
- 服务端契约：`ALREADY_IN_ROOM` 回包**顶层带 `roomCode`**（create 分支：`roomCode` + `roomId`；
  join 的"你本来就在这间房"那一支还带整份 `room` 快照）。**契约缺口**（App 改不了，见 §六）：
  没有"我现在在哪间房"的只读端点，也没有"按账号退掉所有房"；客户端只能在撞上之后才知道房号。
- App 侧（这一轮）：
  - `api/game/rooms.RoomsFailure` 带上 `roomCode` / `room`（从 `ApiError.payload` 顶层读）；
  - 大厅底栏出 `in-room` 那一格：「你还在房间 XXXXXX，退出后重试」+ 一颗「退出那间房」的键
    （房号不知道时只说"别的房间"）；点它 → `POST /rooms/:code/leave` → 成功之后按**原意**
    （建房 / 进房 / 排队）自动重试一次；
  - **超时之后核对一次**：建房 / 进房这一发超时（`TIMEOUT`）时把同一发**幂等重发一次** ——
    服务端一人只能在一间房，重发要么真建成，要么回 `ALREADY_IN_ROOM`（带房号，说明第一次其实成了）；
  - `join` 撞上"我本来就在这间房"（回包带快照）时直接当进房成功，不把用户挡在自己房间外面；
  - 房间轮询连续失败 **5 拍（≈8~10 秒）**才退回本机（旧代码一拍就退：一次抖动就把还在服务端的房
    换成本机 AI 房，界面上看着还是"1/4"，房主键也变回「用 AI 补位开局」）。

#### 三、大厅数据陈旧导致误入 AI 单机局

- 判据收口在 `lobby.hostStartPlanOf` / `hostStartLabelOf`（纯函数；`check-game-lobby` 跑正反例）：
  - 刚读到的快照说真人够（≥ `requiredPlayers`）→ 走服务端开局；
  - 刚读到、真人不够 → 本机 AI 补位（服务端要至少 2 个真人，只有自己时这条路是对的）；
  - **没读到**最新快照：最近一次说够 → 走服务端；最近一次说不够但刚同步过（≤5 秒）→ AI 补位；
    最近一次说不够**且已陈旧**（或从没读到过）→ **先别开**。
  - 房主键：成员数 ≥2 →「开始对局」；真人不够且数据新鲜 →「用 AI 补位开局」；
    **数据陈旧 → 也写「开始对局」**（点了先强制刷新，不拿旧数据说"还是我一个人"）。
- 点开局：`lobbyStore.prepareStart` **先 `GET /rooms/:code` 强制刷新**，再按上面的判据决定；
  刷新失败且最近一次也不够 / 已陈旧 → 底栏「没读到最新的房间状态：先别开，等连上再试」，**不开局**。
- 大厅房间屏接上 SSE：`ui/useLobbyOnline` 用 `subscribeRoomStream` 收帧 → `lobbyStore.applyPushedRoom`；
  2 秒轮询照旧在（这条流**不做重连**，断了就靠轮询），对局开局时大厅卸载、这条流跟着关
  （服务端每用户限 2 条）。

#### 四、真机上怎么验的（2026-11-24 夜；release 2.81 / 93 + 线上服务端）

1. **推送 / 延迟**（数字见上面「一」）：手机 WebView 里以对端账号交片 → 回包 → push 帧
   627~658ms → 屏幕翻牌 **2ms**；从请求发出到翻牌 **1.88~1.92 秒**。底栏「实时连接中」，
   `/stream` 回了 200 + `text/event-stream`、建连 410ms 内一帧 `snapshot`。
2. **`ALREADY_IN_ROOM`**（真机 + 线上）：先用同一个生产账号在服务端**直接建一间房**
   （`POST /api/game/rooms`，模拟"服务端建成了、客户端不知道"）：
   - 手机上点「自定义房间」→ 409 `ALREADY_IN_ROOM`（`roomCode: UHCTWE`）→ 底栏
     「你还在房间 UHCTWE，退出后重试」+「退出那间房」（真机截图里能看到这颗键）；
   - 点键 → `POST /rooms/UHCTWE/leave` 200（`closed:true`）→ **自动重试**建房 201 → 新房 `9XV7WE`；
     另一个账号读 `UHCTWE` = **404**（真的退掉了）；
   - 第二次复现（掉线退回本机时那次退房没成功）：同一颗键解开 `9XV7WE`、新建 `DZFEFS`；
     之后 `DZFEFS` → `4Q7772` 也是同一颗键解的 —— 三次都在一颗键内解开，没有一次等房寿命。
3. **大厅刷新 / 开局语义**（真机 + 线上）：
   - 对端 join → 大厅房间屏的 SSE `update` 帧到 → 屏幕 **3~13ms** 后变成「2/4」，
     同一拍房主键是「开始对局」（不是「用 AI 补位开局」）；
   - 点「开始对局」后 **1ms** 内发出 `GET /rooms/:code`（强制刷新），1.3 秒后才发
     `POST /rooms/:code/start`（200）→ 两边进对局（本机看到的是风格卡）；
   - 把 `GET /rooms/:code` 挡住 6.5 秒（数据变旧）：房主键**从「用 AI 补位开局」变成「开始对局」**，
     状态那句变「房间状态还没同步上：点「开始对局」会先拉一次最新的，拉不到就先不开。」；
     此时点开局 → 底栏「没读到最新的房间状态：先别开，等连上再试」、**没有开出一局 AI 单机**；
     放开之后下一拍同步回来，那句临时原因自己收掉、键回到「用 AI 补位开局」（房里只有我一个人）。
4. **账号收尾**：两个测试账号（这一轮在线上注册的 `ssedbg1124a` / `ssedbg1124b`，密码不在仓库里）
   与手机上那个生产账号都退掉了所有房（各建一间 → 退房 200 / 201 验证过；`GET /game/queue` = idle），
   服务端那几间房都是 404。
5. **没验的**：能力位 `gameRoomStream` 为 null 时那 5 秒一次的重问只有源码断言 —— 真机上要造
   "冷启动时健康探测失败" 得控网络，这一轮没造。


