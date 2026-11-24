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
| `src/studio/game/ui/Lobby.tsx` | 大厅外壳 + 首屏三张入口卡 + 凭码加入 + 4/8 人匹配那一屏（联机等真人 / 退回后 AI 补位） |
| `src/studio/game/ui/RoomScreen.tsx` | 自定义房间：房间码 / 成员表 / 房主开局、踢人（联机时藏改人数）/ 非房主准备 / 邀请卡 |
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

## 一、大厅：三张入口卡

```
▶ 开局（工坊顶栏，原来直接建局）
   └→ 大厅（横屏；铺满舞台的实底，3D 停帧）
        ├─ 4 人匹配   → 等匹配那一屏（我 + 3 个 AI 补位）→「用 AI 开局」→ 4 人局
        ├─ 8 人匹配   → 等匹配那一屏（我 + 7 个 AI 补位）→「用 AI 开局」→ 8 人局
        └─ 自定义房间 → 房间屏（房间码 + 成员表 + 房主动作）→「开始对局」→ 房间人数的局
```

- 大厅**不摆金币 / 券 / 血量**（主人点名"别塞"）：它只回答"这一局怎么开"。那些数是**对局中**的读数，
  摆在大厅就要跟着对局状态走，两处（大厅与局内 HUD）一漂就是同一件事两个数。
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
  已经是服务端在推进（§七）。仍然**没有**的是：WebSocket 推送（还是 2 秒轮询）、回合级断线重连、
  服务端事件端点（事件仍只在本机跑）。
- **空位 AI 的口径（2026-11-24 改口）**：联机房间的空座位**不参加服务端回合**（服务端的回合只算真人成员，
  结算榜里没有 AI）。房间里只有 2 个真人时，这一局就是 2 人局。旧文档里"空位由 AI 补齐"那句
  只对**本机大厅**成立（服务端房间的空位不再补 AI）。
- **8 人匹配没有单独跑满一桌**：4 人匹配已经用 3 个 API 会话 + 1 个浏览器跑通；8 人走的是同一段代码
  （只差 mode / size 与 7 个 API 会话），本轮只验到"进队 / 超时退回"，没验到"8 个真人建房间"。
- **断线重连 / 心跳续命**：客户端侧断网会**明确说一句**然后退回单机（§七-6）；服务端那间房靠
  30 分钟寿命 / 90 秒排队心跳清掉。重连之后不会自动回房（再进大厅会重新建房 / 排队），这是下一轮的事。
- **`ALREADY_IN_ROOM` 的收尾**：如果某次退房请求真的失败（比如关大厅那一刻断网），服务端还留着
  这个人；下一次建房 / 进队会回 `ALREADY_IN_ROOM`，界面照实说"你已经在另一间房里"，但**没有"退出那间"的键**
  （要等 30 分钟房寿命或去另一台设备退）。要补的话是"拿服务端说的 roomCode 再退一次"的一条路。
- **大厅没在真机上被人看过**：本轮 release 包装上了、也能起，但那台机器上的 release 是登出状态
  （见 §五-5），`/studio` 在登录墙后面，没有主人的生产账号密码就进不去；观感与"真机上顺不顺手"
  要主人在登录着的包上补看一眼。
- **对局中的「✕ 结束对局」在选风格那一屏点不到**：`StylePick` 是 z-40 全屏（G2 就有，不是这一轮引入的），
  盖住了顶栏。要回大厅得先把风格选完。这一轮没动它 —— 真要修就是给风格屏补一颗退出键。

## 七、联机回合：房间里的这一局跟服务端走（2026-11-24）

服务端回合引擎的契约正本在 `ideahub-server` 的 `routes/gameRoom.routes.js` + `services/gameRound.service.js`
（本轮**没改服务端一行**）。App 这一侧只做"把服务端的事实接回本机状态"，榜与扣血**一个数都不重算**。

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
- `POST rounds/next` 只有房主能发；所有人从轮询里读到新回合，本机跟着 `beginRound`（收入 + 新商店）。
  **服务端没有 8 回合上限**：本机 `beginRound` 加了 `allowPastLimit` 给联机这一条路（单机仍然拦第 9 回合）。

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
- 结算里带 `winners` = 这一局结束 → 本机直接进 `over`（所有人同一拍看到胜者）；不带 = 还没结束。
  `rounds/next` 回 `GAME_OVER` 时（只有房主会收到，带顶层 `winners`）也进 `over`。
- **事件仍然只在本机跑**（服务端没有事件端点，这一版也不加）：结算后按回合数抽事件 + AI 选掉，剩真人那一屏。
  事件改的是本机金币 / 档位 / 本地 hp；**下一回合服务端结算会用服务端的 hp 盖回本地**。
  界面上写的是一句「事件只在本机生效」，不暗示它影响别人。这一条是本轮**明确的限制**（见 §7.7）。

### 7.6 定时器与失败

- **联机回合只有一个定时器**：`ui/useOnlineRounds`（2 秒一拍，递归 setTimeout，一拍没回来不叠下一拍）。
  它同时负责：读 current、到结算阶段取 settlement、对齐本机阶段 / 回合、掉线退回单机、对局结束退房。
- 大厅那一侧仍然只有 `ui/useLobbyOnline` 一个定时器；它多了一段"房间 playing 之后等回合铺好"的逻辑
  （房主建 / 其他人等，最多 30 秒），超时同样说一句再退回单机。
- 掉线退回单机时 `phases.fillLocalOpponents` 会补齐 AI 这一期的动作（交片 / 点赞 / 投票），
  所以"这一局改成单机继续"是真的能继续打完的，不是停在一屏不动。

### 7.7 已知限制

- **没有推送**：仍然是 2 秒轮询（服务端契约就是这么设计的）；换回合 / 结算最多慢 2 秒。
- **事件不跨端**：见 7.5，服务端没有事件端点；事件只在本机，hp 以服务端为准。
- **平局（同归于尽）的非房主**：服务端只在 `winners` 非空时才把它放进结算回包（空数组 = 平局或缺省），
  所以平局时只有房主从 `rounds/next` 的 `GAME_OVER` 里知道"结束了"；非房主会停在 round-end。
  正常分出胜者的情况不受影响（结算回包里就带 winners）。
- **中途离开对局**（关掉工坊 / 杀进程）不会主动退房，靠服务端 playing 2 小时寿命收掉；重进不会自动回房。
- **房主中途退出**：服务端会把房主转给下一个人，但 App 的 `isHost` 是**开局那一刻**从房间快照记下的，
  剩下的人界面里仍当自己不是房主 → "开始展映 / 下一回合"没人能推。这一版没有"换房主"的刷新
  （要退出重进）；下一版按房间快照刷新 `isHost` 即可。
- **中途有人退出**：对手条 / 成员数来自开局时的房间快照，可能比服务端慢；回合结算本身按服务端的存活成员算，不受影响。
- **本机 AI 座位在联机局里不做任何动作**（它们不参与服务端回合）；商店里买卡 / 摆卡只影响**我这个真人**这一期交的卡名与本机出片。
- **换语言之后历史交片的卡名**是交片那一刻界面语言的字符串（服务端只存字符串，没有卡目录翻译）。

### 7.8 怎么验的（2026-11-24 接回合引擎）

1. `node scripts/check-game-online.mjs` → **93 条**（正例 91 / 反例 2：阶段对齐 / 下一回合 / 第 9 回合 /
   掉线补齐 AI / 本机事件）；`check-game-rules` 938 / `check-game-bots` 1236 / `check-game-lobby` 100 不变。
2. `npm run build` 绿（tsc + lingui extract + 全部 check + vite build）；`check-i18n` → **en 缺译 0**（新增 61 条英文）。
3. 本机服务端（`ideahub-server` 最新 main = 回合引擎那一版；`MONGO_URI` 指本机 Mongo，`GAME_ROUNDS=on`，
   **没改服务端一行**）+ `npm run dev`，两个来源（`localhost:5173` / `127.0.0.1:5173`，localStorage 按源隔离）
   各登一个测试账号（lobbyr1 房主 / lobbyr2 客人）：
   - 建房 `PZ2SY6`（custom 4 座）→ lobbyr2 凭码进房 → 准备 → lobbyr1 点「开始对局」；
     服务端 `GET /rooms/PZ2SY6`：`status:playing`、2 个成员、hp 100；`GET .../rounds/current`：`round:1, phase:"creating"`。
     两边都进了本机对局（选风格 → 商店）。
   - 各交一条**占位片**（lobbyr2 的卡名 `Intern Director / Costume Stylist / Handheld Fan`，
     lobbyr1 的卡名 `街头群演 / 灯光师 / 塑料王冠`）：服务端 entries 两条都在、`allSubmitted:true`；
     两边的创作屏都写着「✅ 已交片，等其他人（x/2 已交）」。
   - 房主点「▶ 开始展映」→ `phase:"screening"`；两边展映屏都从服务端 entries 播；各自给对面点了一个赞
     （`likes:1/1, likesPending:0`）；自己那条没有点赞键（非房主屏上写「等房主开始投票」）。
   - 房主点「🗳 去投票」→ `phase:"voting"`；两边各投对面一票 → `votesPending:0` → **2 秒内自动**
     `phase:"settled"`；结算屏显示服务端返回的 `ranking`：lobbyr1 `−5 → ❤95`、lobbyr2 `−10 → ❤90`，
     HUD 的 ❤ 也变成 95 / 90（服务端值回写）；非房主那句是「等房主开下一回合」。
   - 房主点「➡ 下一回合」→ `round:2, phase:"creating"`；两边本机都进了第 2 回合商店（金币 5）。
   - **停掉本地服务端**（模拟中途掉线）：约 3 个轮询周期后两边底栏出现
     「回合服务没响应，这一局改成单机继续」；`__game.online === null`，本机第 2 回合商店照旧；
     接着买卡 → 开始创作 → 交占位片 → 展映，本机 AI 的 4 条片子都在（`entries:4`），单机循环能继续打完。
   - **胜者 / 对局结束**（另一个房间 `C7Y88Y`，把本机 Mongo 里 lobbyr2 的 `members[].hp` 改成 5 再打第 1 回合）：
     结算 `ranking` = lobbyr1(hp95,−5,未淘汰) / lobbyr2(hp0,−10,淘汰)，`winners:["lobbyr1"]`；
     两边都进 `over`，屏幕上是「🏁 本局结束 / 🥇 lobbyr1 ❤95 / 胜者由服务端判定」；
     点「返回大厅」→ 退房（房主先走 = 转移，最后一人走 = 服务端 404）。
4. 真机这一轮**没跑**（这台机器没有连着已登录的 release 包）；上面两条是 dev 两个来源上的真凭据。
   真机观感要主人在已登录的 release 上补看一眼。
