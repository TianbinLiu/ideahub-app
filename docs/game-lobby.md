# 工坊对局大厅（2026-11-23）：三种开局方式 + 自定义房间 + N 人对局

> 主人这一轮点名的四件事：① 进对局前先到**大厅**（4 人匹配 / 8 人匹配 / 自定义房间）；
> ② 对局人数从"固定 4"改成**参数化 2~8**（空位 AI 补）；③ 自定义房间（6 位房间码、房主踢人 / 改人数 / 开局）；
> ④ **只做 App 侧**：真实联机（服务端房间 / 同步）由另一个人做，本仓只留接口桩。
> 规则正本仍是 `src/studio/game/rules.ts`；回合循环见 `docs/g3-round-loop.md`；界面那一块见 `docs/g2-game-ui.md`。

## 文件

| 文件 | 内容 |
|---|---|
| `src/studio/game/lobby.ts` | **大厅 / 房间的纯状态机（零依赖）**：座位 id（`seatIdsFor` / `aiSeatIds`）、房间码（`roomCodeOf`，6 位、首位非 0）、开房（`createRoom`）、改人数（`setRoomSize`）、踢人（`kickSeat`）、准备（`toggleReady`）、离开（`leaveRoom`）、开局怎么坐（`roomStartPlan` / `canStartRoom`）。**一条 UI 都没有** |
| `src/studio/game/lobbyStore.ts` | 大厅界面状态（zustand）：开没开、停在哪一屏（`home` / `matching` / `room`）、房间那份状态、被拒原因、邀请卡。**纯状态**：规矩递回 `lobby.ts`，建局递出去（`ui/startFromLobby`） |
| `src/studio/game/lobbyReasons.ts` | `LobbyFailure` → 那一句人话（**唯一一处**，与 `reasons.ts` 同一条分工） |
| `src/studio/game/ui/Lobby.tsx` | 大厅外壳 + 首屏三张入口卡 + 4/8 人匹配那一屏（座位先按"我 + AI"摆出来） |
| `src/studio/game/ui/RoomScreen.tsx` | 自定义房间：房间码 / 成员表 / 房主动作（开局、踢 AI、改人数）/ 邀请卡（可复制的房间码） |
| `src/studio/game/ui/startFromLobby.ts` | 大厅 → 对局的**唯一**那一下（App 里唯一同时认识两个 store 的地方） |
| `src/api/game/rooms.ts` | **联机接口桩**：签名 + 形状，全部回 `{ ok: false, reason: "unavailable" }`。**不发一个请求** |
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

房间是本机开的（房间码本地生成、其余座位 AI 补位）；联机接通之后远端成员进同一个形状（`LobbySeat.kind = "guest"`）。

| 动作 | 谁能做 | 规矩（`lobby.ts`） |
|---|---|---|
| 改人数 2~8 | 房主 | `setRoomSize`：长大补 AI；缩小只许缩 AI / 空位，**跨过坐着的真人整句拒**（`seat-occupied`） |
| 踢人 | 房主 | `kickSeat`：踢了的位置变空位（**开局时仍由 AI 补上**）；踢自己 → `seat-host` |
| 开始对局 | 房主 | `canStartRoom`：非房主 → `not-host`；开局人数 = 房间人数，空位全补 AI |
| 准备 / 取消准备 | 非房主 | `toggleReady`：房主点 → `host-always-ready`（他点开始就是表态） |
| 离开房间 | 所有人 | `leaveRoom`：客人走那一格空出来；**房主走 = 这间房散掉**（回大厅首屏） |
| 邀请 | 所有人 | 联机没接通 → 只给**可复制的房间码**（`navigator.clipboard`，拿不到就说"长按选中复制"） |

状态机是纯函数，`scripts/check-game-lobby.mjs` 拿 100 条正反例跑它（谁被拒、拒绝原因对不对、失败时入参不动）。
为什么要单开一份纯函数：这一层的错全是"按钮点了没反应"（房主被当成客人 / 踢人踢错格 / 缩人数把真人挤掉），
在界面上看不出来。

## 四、联机桩：`src/api/game/rooms.ts`

**这个文件里一条网络请求都没有**，全部回 `{ ok: false, reason: "unavailable" }`；服务端房间由另一个人做，
在那之前 App 不自己发明协议（先写一版 fetch，服务端落地时就得兼容两份形状，而客户端这版从没跟人验过）。

```ts
roomsAvailable(): boolean                                        // 现在恒 false（界面的"摆不摆 / 说哪句"只问它）
createRoom({ size }): Promise<RoomsResult<RemoteRoom>>           // TODO POST /api/game/rooms
joinRoom(code): Promise<RoomsResult<RemoteRoom>>                 // TODO POST /api/game/rooms/:code/join
readRoom(code): Promise<RoomsResult<RemoteRoom>>                 // TODO GET  /api/game/rooms/:code
setRoomSize(code, size): Promise<RoomsResult<RemoteRoom>>        // TODO PATCH /api/game/rooms/:code
kickMember(code, playerId): Promise<RoomsResult<RemoteRoom>>     // TODO POST /api/game/rooms/:code/kick
setReady(code, ready): Promise<RoomsResult<RemoteRoom>>          // TODO POST /api/game/rooms/:code/ready
startRoom(code): Promise<RoomsResult<{ matchId: string }>>       // TODO POST /api/game/rooms/:code/start
leaveRoom(code): Promise<RoomsResult<{ closed: boolean }>>       // TODO POST /api/game/rooms/:code/leave
findMatch(size: 4 | 8): Promise<RoomsResult<MatchTicket>>        // TODO POST /api/game/match
cancelMatch(ticketId): Promise<RoomsResult<{ cancelled: boolean }>> // TODO DELETE /api/game/match/:ticketId
```

`RoomsResult<T> = { ok: true; value: T } | { ok: false; reason: "unavailable" | "not-found" | "forbidden" | "full" | "started" | "bad-request" }`。
形状（`RemoteRoom` / `RemoteRoomMember` / `MatchTicket`）先按 App 这边要的字段定，接通时以服务端为准对齐；
**函数名与入参不许在界面里另写一套**（界面今天压根不 import 这个文件 —— 它问的是 `roomsAvailable()` 那句"还没接通"）。

## 五、怎么验的（2026-11-23）

1. `node scripts/check-game-rules.mjs` → **938** 条（原 919；新增 2/5/6/8 人扣血阶梯、8 人连胜线、2 人局胜负口径、
   1 人 / 9 人开局要抛）。原「2 人开局要抛」那条随人数参数化翻成"2 人开局合法"（并补 1 人与 9 人的反例）。
2. `node scripts/check-game-bots.mjs` → **1236** 条（原 538）：新增 8 人整局（第一回合扣血 10×5 + 20/30/40、
   同 seed 逐字段一致、胜者 1~2 名）。顺带修了一条**期望写错**的断言：上一期被淘汰的人这一期不交片，
   "排片 = 上一期名次倒序"要按"这一期真有片子的人"过滤 —— 4 人局先出局的总是真人，这条从没跑到过。
3. `node scripts/check-game-lobby.mjs` → **100** 条（新脚本，已接进 `npm run build`）。
4. `npm run build` 绿（tsc + lingui extract + 全部 check + vite build；en 缺译 0）。
5. `npm run dev` 横屏（1384×797，`(orientation: landscape)`）走三条路：
   大厅首屏三卡 → 4 人匹配（我 + Rival A/B/C，"AI fill"）→ 用 AI 开局（4 个座位）；
   8 人匹配（我 + Rival A~G）→ 开局后对手条 7 个、HUD ❤100；
   自定义房间（房间码 151569 / 217024、房主 + AI 补位、踢人 → 空位、邀请卡可复制 → "Copied"、人数 4→2）→ 开始对局（2 个座位）。
6. 8 人局实跑（无头驱动 store 的公开动作，与 `check-game-bots` 同一条路）：第 1 回合结算屏
   `#1~#5 −10 · #6 −20 · #7 −30 · #8 −40`（我 100→60），与 `damageForRank(8, …)` 逐项一致。
7. 2 人局第 1 回合：`-5 / -10`，**没在第 1 回合结束**（winnerTargetOf 的修复）。
8. **横屏真机视口 800×363**（`npm run dev` 套一个 800×363 的 iframe，媒体查询看的是 iframe 自己的视口，
   所以 `useIsLandscape` 判为横屏 —— 与上一轮量 G3 面板宽度同一种做法）逐屏量 `getBoundingClientRect`：
   大厅首屏三张卡 `[114,132,184×118] / [308,…] / [502,…]`（右缘 686 < 800）、底栏 y=336+14；
   8 人匹配的座位排 4+4（第二行 y=168）、房间 8 个座位 4+4（y=105/169）、邀请卡 352×167 居中；
   8 人局结算屏 8 行 `#1… #8`（y=170…221）与「➡ 下一回合」按钮 y=325+22 —— 全在 363 之内，
   `documentElement.scrollHeight` 恒为 363、**没有任何内部滚动容器**（不溢出、不被裁）。
9. 真机 `3C15CJ00C8V00000`：`npm run apk`（debug，**另一个包名** `com.ideahub.branchvideo.debug`，
   装它不会顶掉主人手机上那份 release）→ `adb install -r` → 启动成功（versionCode 93 / 2.81-debug）。
   ⚠ **大厅没在真机上看到**：debug 包没有登录态，`/studio` 被 `RequireAuth` 挡在登录页
   （release 包才有主人的会话，而顶掉它正是 CLAUDE.md 明令不许的那件事）—— 所以这一轮的"看一眼大厅"
   是上面第 8 条按真机视口量的，**真机上的观感还没人看过**。

## 六、还没做 / 剩下的风险

- **真实联机**（服务端房间、匹配排队、状态同步、断线重连）：不在本轮，桩在 `api/game/rooms.ts`。
- **非房主那一支现在走不到**：本机开的房间里没有别人（`kind = "guest"` 的座位只有在联机接通后才有）。
  状态机与界面两条分支都写好了、也有断言，但**没有真机走过**（联机接上那天要补一次）。
- **8 人局的节奏**：最后一名一回合 -40，3 回合约出局，整局 5~6 回合。人数越多的桌面也越挤
  （对手条 7 条要横向滚动、结算屏 8 行）—— 真机 800×363 上验过不溢出，但"好不好玩"要玩几局才知道。
- **房间码只是本机的**：现在它不能用来加入（没服务端），界面照实说"这个码只能念给人听"。
- **大厅没在真机上被人看过**（见 §五-9 最后一条）：debug 包没有登录态、`/studio` 在登录墙后面。
  按真机视口 800×363 量过几何，但"真机上顺不顺手 / 字号够不够"要有人在装了 release 的那台机上看一眼。
- **对局中的「✕ 结束对局」在选风格那一屏点不到**：`StylePick` 是 z-40 全屏（G2 就有，不是这一轮引入的），
  盖住了顶栏。要回大厅得先把风格选完。这一轮没动它 —— 真要修就是给风格屏补一颗退出键。
