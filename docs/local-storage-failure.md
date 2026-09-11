# 本机数据库打不开时怎么办：调研与决定

2026-09-11。起因：开机装载（`App` 里那一排 `ready*`）没有 catch，任何一个 reject 页面就永远停在「正在打开作品库…」。
核查时发现更常见的故障根本不 reject：`db.idbGet` 把一切读失败吞成 `undefined`，装载拿它当"第一次用"——
IndexedDB 打不开时 App 照常开机，草稿箱是空的、离线账号被登出、作品只剩种子，下一次写入还会拿这份空表把磁盘上的真数据盖掉。

实现入口：`src/data/boot.ts`（唯一的开机闸）、`src/data/db.ts`（`idbRead` / 打开超时 / 损坏告知）。

## 结论

**本机数据只是缓存、或者只影响某一块功能 → 那一块降级，其余照常；此刻整个 App 唯一的数据源都打不开 → 才整页拦住。**

| 数据 | 正式包（远端模式） | 开机连不上服务器、退回本机库时 | 读不出来时怎么处理 |
|---|---|---|---|
| 作品库、账号库 | 来自服务端，开机不读 IndexedDB | 只在本机 | 整页「作品库没能打开」+ 原因 + 重试（`components/BootFailed`）。正式包里几乎只在"连不上服务器 + 本机库也坏"时出现 |
| 草稿箱 | 只在本机 | 只在本机 | 草稿箱整页 / 个人页草稿页签画「没读出来 + 重试」而不是「还没有草稿」；存 / 删 / 改名一律拒（`drafts.loadIssue`）；存草稿失败的提示指向重试 |
| 剪到一半的成片 | 只在本机 | 只在本机 | 个人页横幅「没读出来 + 重试」；组稿前先重读，读不出来就拒（组稿要铸卡 = 花钱）；存 / 丢都不动磁盘上那条 |
| 我的模板（本机那份） | 本机 + 服务端各一份 | 本机 | 「我的模板」提示条 + 重试；本机写冻结，读出来后把这段时间新做的并回去 |
| 互动记录、弹幕（本机那份） | 本机（服务端计数不受影响） | 本机 | 详情页互动区 / 发弹幕输入条上说一句；这次会话的改动不落盘 |
| 清理缓存 | — | — | 草稿 / 剪辑稿没读出来时整轮不删，并说明原因（它判"没人引用"读的正是它们） |

另外四件连接层的事：

- 进"没读出来"的那一屏**先自动重试一次**（`hooks/useLocalRetry`），失败了才摆出错误与「重试」。
- `indexedDB.open` 最多等 10 秒（浏览器里复现过永远不回话）；打开失败不缓存、连接被关自动忘掉，重试才真的重开。
- 连接收到 `versionchange` 就关掉自己（不关会让别处的升级一直 blocked、后面的 open 全部挂住）。
- Chromium 因损坏清空重建库时（`upgradeneeded` 上 `dataLoss === "total"`），开机弹一次「本机数据被系统清空了」（`components/DataLossNotice`）。

## 调研（每条都有原文出处）

### 库 / SDK

- **Firestore JS**：IndexedDB 持久化起不来就退回内存缓存继续跑，只在控制台警告，"instance will remain usable, however offline persistence will be disabled"。
  [firestore_client.ts](https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/core/firestore_client.ts)、[database.ts](https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/api/database.ts)
- **Dexie**：打开失败抛 `OpenFailedError`（`.inner` 是真因），所有排队操作跟着失败，不自动退内存；`versionchange` 时关闭连接；浏览器单方面关连接后下一次操作自动重开（PR #2187）。
  [OpenFailedError](https://dexie.org/docs/DexieErrors/Dexie.OpenFailedError)、[on.versionchange](https://dexie.org/docs/Dexie/Dexie.on.versionchange)、[PR #2187](https://github.com/dexie/Dexie.js/pull/2187)
- **localForage**：IndexedDB → WebSQL → localStorage 静默换驱动。[localforage.js](https://github.com/localForage/localForage/blob/master/src/localforage.js)
- **RxDB**：明说 IndexedDB 里的数据"不能指望永远在"，要能从服务端重新拉。[downsides-of-offline-first](https://rxdb.info/downsides-of-offline-first.html)
- **Expensify**（IndexedDB 当缓存）：打开重试三次、会话中途关掉重开且有上限；**明确不调 `deleteDatabase()`**。[Expensify/App#90636](https://github.com/Expensify/App/issues/90636)

### 浏览器 / WebView

- **Chromium 发现 IndexedDB 损坏会先删库重建**，再报给页面；磁盘满不走这条。
  [backing_store.cc](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/indexed_db/instance/leveldb/backing_store.cc)、[bucket_context.cc](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/indexed_db/instance/bucket_context.cc)
- Chromium 工程师当年反对静默：离线编辑场景下这是"真正的用户数据丢失，不是缓存被冲掉"。[public-webapps 2013](https://lists.w3.org/Archives/Public/public-webapps/2013JanMar/0354.html)；
  于是有了 `IDBVersionChangeEvent.dataLoss` / `dataLossMessage`（`"none" | "total"`，非标准，[Blink IDL](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/indexeddb/idb_version_change_event.idl)，2026-09-11 核过仍在）。
  Signal 桌面版因此被清空过全部消息：[Signal-Desktop#718](https://github.com/signalapp/Signal-Desktop/issues/718)。
- **MDN**：`onversionchange` 里"We must close the database"，否则另一个页面的升级要等这个页面关掉。[Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- **`navigator.storage.persist()` 在 Android WebView 里恒为 false**：WebView 的权限管理器对持久化存储回 DENIED。
  [aw_permission_manager.cc](https://source.chromium.org/chromium/chromium/src/+/main:android_webview/browser/aw_permission_manager.cc)、[storage_manager.cc](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/quota/storage_manager.cc)

### 原生 / 产品

- **Android** `DefaultDatabaseErrorHandler` 与 AndroidX `onCorruption` 默认**删掉数据库文件**。
  [DefaultDatabaseErrorHandler.java](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/database/DefaultDatabaseErrorHandler.java)
- **微信**：聊天记录只在本机、服务端不备份，所以没有接受"损坏就删"，而是做了 WCDB 修复与备份（修复成功率 dump 约 30%、备份约 72%、B-tree 解析约 78%），入口是用户手动触发的「故障修复」。
  [WCDB 团队文章](https://cloud.tencent.com/developer/article/1005513)、[官方 FAQ](https://kf.qq.com/touch/faq/160302MfYnIZ160302eEJ7rE.html)
- **Signal Desktop**：开机数据库错误整页拦，给「复制错误并退出」或「删除数据并重启」，删除要二次确认；用户在 #5892 里抗议过把删除当默认。
  [messages.json](https://github.com/signalapp/Signal-Desktop/blob/main/_locales/en/messages.json)、[#5892](https://github.com/signalapp/Signal-Desktop/issues/5892)
- **Figma**：离线编辑存在 IndexedDB，配额满 / 数据被清时会存不下，给「Save local copy」。[help](https://help.figma.com/hc/en-us/articles/360040328553)
- **Google Docs 离线 / Slack**：出问题的出路是清站点数据 / 清缓存重启 —— 因为它们的本机数据只是缓存。
  [Docs](https://support.google.com/docs/answer/6388102)、[Slack](https://slack.com/help/articles/205138367)

### 共同模式

1. 本机只是缓存的（Firestore、Docs、Slack、Expensify）：**从不拦**，退回 / 重新拉。
2. 本机是唯一副本的（Signal、微信）：**停下让用户决定、或者做修复与备份**，删除绝不默认。
3. 平台默认"损坏就删"（Chromium、Android），而受害最重的一方都在要求**告诉应用 / 告诉用户**。

## 为什么是这样定的

- 正式包里作品库、账号来自服务端，本机那份只是缓存 —— 按模式 1，本机坏了不该让人连首页都刷不了。
- 草稿、剪辑稿、本机模板是唯一副本，但各自只影响一块功能 —— 按模式 2 的精神，**在那一块停下说清楚**，而不是把整个 App 停下；
  同时**冻结写**，保证"读不出来"不会升级成"被我们自己盖掉"。
- 只有"连不上服务器 + 本机库也打不开"时，App 没有任何数据源可用，这时整页拦住才是诚实的。

## 刻意没做的

- **不自动删库重建**：平台已经在真损坏时替我们删过了；我们这边能读不出来的多半是瞬时故障（库被占着、刚腾出空间），删了就是替用户丢东西。
- **不静默退回内存继续跑**（Firestore / localForage 那样）：草稿是唯一副本，悄悄在内存里接着干活，关掉 App 就没了，还一个字都不说。
- **失败页不给「先进去再说」、不给「清理缓存」**：前者进去只会看到空首页、被登出；后者碰不到失败的原因，这时候去扫还会误删。
- **不调用 `navigator.storage.persist()`**：WebView 里恒为 false，写了只是心理安慰。

## 还没解决的

- **真损坏防不住**：Chromium 在我们代码运行之前就把库删了，冻结写只防得住瞬时故障；我们能做的只剩如实告知（`DataLossNotice`）。
  只存在本机的草稿要真正扛住这一档，得有 IndexedDB 之外的副本（服务端草稿备份 —— 类比微信的备份、Figma 的 Save local copy）。
  那是跨仓的产品决定，这次没做。
- **真机没验**：浏览器 dev 构建里验过（见 PR 描述）；Android WebView 上的 `dataLoss` 行为与存储压力下的回收没有实测。
