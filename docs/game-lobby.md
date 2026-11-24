# 工坊对局大厅（2026-11-23；2026-11-24 接上服务端房间）

> 主人这一轮点名的四件事：① 进对局前先到**大厅**（4 人匹配 / 8 人匹配 / 自定义房间）；
> ② 对局人数从"固定 4"改成**参数化 2~8**（空位 AI 补）；③ 自定义房间（6 位房间码、房主踢人 / 改人数 / 开局）；
> ④ **真实联机**：2026-11-23 先把 App 侧做成接口桩，2026-11-24 服务端上线（`gameRooms` 能力位为真）后
> 换成真调用 —— 房间 / 匹配在服务端，**回合循环仍在本机**（服务端 `playing` 之后不推进任何东西，
> 回合引擎是 G5 后面的事）。
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
| `src/studio/game/ui/startFromLobby.ts` | 大厅 → 对局的**唯一**那一下（App 里唯一同时认识两个 store 的地方）；`closeLobby` 顺手退掉联机房间 |
| `src/api/game/rooms.ts` | **联机 HTTP 层**：`createRoom` / `joinRoom` / `readRoom` / `kickMember` / `setReady` / `startRoom` / `leaveRoom` / `findMatch` / `readQueue` / `cancelMatch` + `roomsAvailable()`（能力位） |
| `src/data/serverCaps.ts` | 新增 `gameRooms` 能力位（健康端点）；`serverGameRooms()` 是它的读法（dev 配了 `VITE_API_BASE` 也照问） |
| `scripts/check-game-lobby.mjs` | 大厅 / 房间状态机 **100 条断言**（正例 85 / 反例 15），`npm run build` 里跑 |

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

- **对局本身没有联机**：服务端的房间只到 `status: "playing"`；回合推进（出片 / 展映 / 点赞 / 投票 / 扣血 / 淘汰）
  还没有服务端引擎，也不做状态同步。所以"4 个真人在一桌"目前只体现在**房间成员表**上：
  开局那一刻每个客户端各自建一局本机游戏（me + AI），互相看不到对方的操作。等回合引擎 + 推送接上，
  这一层才是真联机对局。
- **空位 AI 的口径**：联机房间的空座位显示「AI 补位」，但本机建局时**所有非我的座位都是 AI**
  （现有 `startFromLobby` 只认人数）；房间里的另外几个真人在这一局里不会作为对手出现。
- **8 人匹配没有单独跑满一桌**：4 人匹配已经用 3 个 API 会话 + 1 个浏览器跑通；8 人走的是同一段代码
  （只差 mode / size 与 7 个 API 会话），本轮只验到"进队 / 超时退回"，没验到"8 个真人建房间"。
- **断线重连 / 心跳续命**：客户端侧断网会退回本机；服务端那间房靠 30 分钟寿命 / 90 秒排队心跳清掉。
  重连之后不会自动回房（再进大厅会重新建房 / 排队），这是下一轮的事。
- **`ALREADY_IN_ROOM` 的收尾**：如果某次退房请求真的失败（比如关大厅那一刻断网），服务端还留着
  这个人；下一次建房 / 进队会回 `ALREADY_IN_ROOM`，界面照实说"你已经在另一间房里"，但**没有"退出那间"的键**
  （要等 30 分钟房寿命或去另一台设备退）。要补的话是"拿服务端说的 roomCode 再退一次"的一条路。
- **大厅没在真机上被人看过**：本轮 release 包装上了、也能起，但那台机器上的 release 是登出状态
  （见 §五-5），`/studio` 在登录墙后面，没有主人的生产账号密码就进不去；观感与"真机上顺不顺手"
  要主人在登录着的包上补看一眼。
- **对局中的「✕ 结束对局」在选风格那一屏点不到**：`StylePick` 是 z-40 全屏（G2 就有，不是这一轮引入的），
  盖住了顶栏。要回大厅得先把风格选完。这一轮没动它 —— 真要修就是给风格屏补一颗退出键。
