/**
 * 帳本的本機副本（IndexedDB）：打開好記時先顯示上次的內容，雲端讀完再換成最新的。
 * 每個帳號各存一份；登出時刪掉。讀寫失敗（私密瀏覽、空間不足）就當作沒有副本。
 */
import type { Months, Settings } from "../core/types";

export interface CachedLedger {
  settings: Settings;
  months: Months;
  /** 存下的時間（毫秒） */
  at: number;
}

const DB = "goodlog-cache";
const STORE = "ledger";

function open(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      if (typeof indexedDB === "undefined") return ok(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
      r.onblocked = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((ok) => {
        if (!db) return ok(null);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => ok(req.result ?? null);
          req.onerror = () => ok(null);
          tx.oncomplete = () => db.close();
          tx.onabort = () => {
            db.close();
            ok(null);
          };
        } catch {
          db.close();
          ok(null);
        }
      }),
  );
}

export const loadLedger = (uid: string) => run<CachedLedger>("readonly", (s) => s.get(uid));
export const saveLedger = (uid: string, v: CachedLedger) => run("readwrite", (s) => s.put(v, uid)).then(() => undefined);
export const deleteLedger = (uid: string) => run("readwrite", (s) => s.delete(uid)).then(() => undefined);
