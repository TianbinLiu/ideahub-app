// IndexedDB 键值仓：真实 AI 产物（首尾帧 1MB 级 base64、卡面图）远超 localStorage
// 的 ~5MB 配额——此前 publishVideo 落库即被配额兜底静默丢弃，用户视频永远进不了首页。
// IndexedDB 配额通常是磁盘可用空间的 10-60%，足够存整个本地作品库。
//
// 用法约定：调用方保持同步读（内存 cache），启动时 await ready() 装载，写操作异步落库。

const DB_NAME = "ideahub-app";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * `indexedDB.open` 最多等多久。
 * ★★ open 是会**永远不回话**的（2026-09-10 浏览器里复现）：同名库上排着一个被别的连接挡住（blocked）的
 *   请求时，后来的 open 就排在它后面，success / error 一个都不来 —— 开机装载停在「正在打开作品库…」、
 *   控制台一行字都没有。不 reject 就走不到开机闸上，所以这里给一个上限，超时按"打不开"算。
 *   手机上同一形状的是库文件被别的进程占着没放。
 * ★ 量过（2026-09-10，桌面 Chromium，同源已有一条连接时连开 10 次）：中位 0.2ms、最慢 0.3ms。
 *   手机冷启动那一下没量过，所以上限按"根本不回话"给到 10 秒，远在任何正常打开之外 —— 不是给慢机器限速。
 */
const OPEN_TIMEOUT_MS = 10_000;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error(`indexedDB.open ${OPEN_TIMEOUT_MS / 1000} 秒没有回应`));
      }, OPEN_TIMEOUT_MS);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        // 超时之后才连上的：已经按失败交代过了，这份连接没人要，关掉，别让它挂着挡住后来的请求
        if (settled) return req.result.close();
        settled = true;
        resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(req.error ?? new Error("indexedDB.open 失败"));
      };
    });
    // ★★ 打不开时**不许把这个失败的 Promise 留在缓存里**（2026-09-10）。原来打不开一次 =
    //   这次会话里每一读都是 undefined、每一写都是 false；开机闸的「重试」按下去只会原样
    //   再拿到这个失败，永远进不去。忘掉它，下一次调用才会真的重新 indexedDB.open。
    // ★ 连上之后浏览器单方面关掉连接（站点数据被清、存储被回收）也一样忘掉，下一次读写重新打开。
    p.then(
      (db) => {
        db.onclose = () => {
          if (dbPromise === p) dbPromise = null;
        };
      },
      () => {
        if (dbPromise === p) dbPromise = null;
      },
    );
    dbPromise = p;
  }
  return dbPromise;
}

/** 本地数据库读失败（打不开 / 这一读出了错）。开机闸按**类型**认它，不按报错文案猜 */
export class IdbError extends Error {
  /** 浏览器给的原始错误（多半是 DOMException：UnknownError / QuotaExceededError / InvalidStateError…） */
  readonly original: unknown;
  /** 原始错误的一行描述（name: message）。不带键名：同一次打不开，几个库报的是同一句 */
  readonly why: string;
  constructor(key: string, original: unknown) {
    const o = original as { name?: unknown; message?: unknown } | null;
    const why = o && typeof o === "object" && "message" in o ? `${String(o.name ?? "Error")}: ${String(o.message)}` : String(original);
    super(`读取 ${key} 失败（${why}）`);
    this.name = "IdbError";
    this.original = original;
    this.why = why;
  }
}

/**
 * 读一个键；**读失败会抛 `IdbError`**，只有"确实没有这个键"才是 undefined。
 *
 * ★★ 为什么要有它（2026-09-10）：`idbGet` 把「没有这个键」和「库打不开 / 这一读失败」都答成
 *   undefined，而开机装载拿 undefined 当"第一次用"：草稿箱装成空表、离线账号装成没登录、
 *   作品库只剩种子 —— App 照常开机、一个字都不说，用户读到的是「我的东西没了」；
 *   下一次写入（存草稿 / 点赞 / 发弹幕）还会拿这份空表把磁盘上那份真的**整张盖掉**。
 * ★ 装载「存着用户东西的库」一律用它（清单与分档在 data/boot）。其余读继续用 `idbGet`：
 *   那些是"有就用、没有也行"，失败了不该把整条路打断。
 */
export async function idbRead<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    throw new IdbError(key, e);
  }
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await idbRead<T>(key);
  } catch (e) {
    console.warn("[db] 读取失败:", e);
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (e) {
    console.warn("[db] 写入失败（配额或隐私模式）:", e);
    return false;
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* 忽略 */
  }
}

/** 库里现在有哪些键。清理缓存要靠它找出"没人引用的大文件"（见 data/cacheSweep.ts） */
export async function idbKeys(): Promise<string[]> {
  try {
    const db = await open();
    return await new Promise<string[]>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.warn("[db] 列键失败:", e);
    return [];
  }
}

/** 存储用量估算（设置页展示） */
export async function storageEstimate(): Promise<{ usedMB: number; quotaMB: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return {
    usedMB: +((est.usage ?? 0) / 1048576).toFixed(1),
    quotaMB: +((est.quota ?? 0) / 1048576).toFixed(0),
  };
}
