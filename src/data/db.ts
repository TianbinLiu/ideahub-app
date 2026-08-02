// IndexedDB 键值仓：真实 AI 产物（首尾帧 1MB 级 base64、卡面图）远超 localStorage
// 的 ~5MB 配额——此前 publishVideo 落库即被配额兜底静默丢弃，用户视频永远进不了首页。
// IndexedDB 配额通常是磁盘可用空间的 10-60%，足够存整个本地作品库。
//
// 用法约定：调用方保持同步读（内存 cache），启动时 await ready() 装载，写操作异步落库。

const DB_NAME = "ideahub-app";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
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

/** 存储用量估算（设置页展示） */
export async function storageEstimate(): Promise<{ usedMB: number; quotaMB: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return {
    usedMB: +((est.usage ?? 0) / 1048576).toFixed(1),
    quotaMB: +((est.quota ?? 0) / 1048576).toFixed(0),
  };
}
