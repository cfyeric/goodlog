/**
 * 接 claude.ai 網頁的雲端資料庫（window.claude.use("db")）。
 * 只有網頁發佈在 claude.ai、並宣告 db 和 user 權限時才有作用；本機開發時 connect() 會回傳 null。
 *
 * 下面的型別是依舊版實際用到的呼叫整理的最小介面，不是官方完整定義。
 */
import type { Months, Settings, Tx } from "../core/types";
import { migrateSettings, defaultSettings } from "../core/defaults";
import type { LedgerSnapshot, LedgerStore, StoreMode } from "./store";
import { baseOf, diffMonth, mergeMonth, type MonthBase } from "./merge";
import { uid8 } from "../core/ids";

interface DocSnap<T> {
  exists: boolean;
  id: string;
  data(): T;
  metadata?: { fromCache?: boolean };
}
interface QuerySnap<T> {
  docs: DocSnap<T>[];
}
interface DocRef<T> {
  get(): Promise<DocSnap<T>>;
  set(v: T): Promise<void>;
  onSnapshot(cb: (s: DocSnap<T>) => void, err?: (e: unknown) => void): () => void;
  collection<U>(name: string): ColRef<U>;
  acquire?(o: { holder: string; ttlMs: number }): Promise<{ acquired: boolean } | null>;
}
interface ColRef<T> {
  doc(id: string): DocRef<T>;
  onSnapshot(cb: (s: QuerySnap<T>) => void, err?: (e: unknown) => void): () => void;
}
interface ClaudeDb {
  doc<T>(path: string): DocRef<T>;
}
interface ClaudeUser {
  id(): Promise<string>;
}
declare global {
  interface Window {
    claude?: { use(name: "db"): Promise<ClaudeDb>; use(name: "user"): Promise<ClaudeUser>; use(name: string): Promise<unknown> };
  }
}

type MonthDocT = { items: Tx[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 試著連上 claude.ai 的資料庫；不在 claude.ai 上就回傳 null */
export async function connectClaude(): Promise<{ db: ClaudeDb; uid: string } | null> {
  try {
    if (!window.claude?.use) return null;
    const [db, user] = (await Promise.all([window.claude.use("db"), window.claude.use("user")])) as [ClaudeDb, ClaudeUser];
    const uid = user ? await user.id() : null;
    return db && uid ? { db, uid } : null;
  } catch {
    return null;
  }
}

export function createClaudeStore(db: ClaudeDb, uid: string): LedgerStore {
  const settingsRef = db.doc<Settings>("data/users/" + uid + "/settings");
  const monthsCol = settingsRef.collection<MonthDocT>("months");
  const BASE: Record<string, MonthBase> = {};
  const chains: Record<string, Promise<void>> = {};
  const holder = "t" + uid8() + uid8();
  let mode: StoreMode = "live";
  let snap: LedgerSnapshot = { settings: null, months: {}, monthsReady: false };
  let emit: (s: LedgerSnapshot) => void = () => {};
  let fail: (m: string) => void = () => {};
  let unsubs: (() => void)[] = [];
  let setTimer: ReturnType<typeof setTimeout> | null = null;
  let setChain: Promise<void> = Promise.resolve();
  /** 本機還有設定沒寫出去時，先不要被舊的雲端快照蓋掉 */
  let settingsPending = false;
  /** 有沒有還沒觸發的設定寫入計時器 */
  let timerLive = false;
  let created = false;
  let migrated = false;

  const update = (p: Partial<LedgerSnapshot>) => {
    snap = { ...snap, ...p };
    emit(snap);
  };

  const store: LedgerStore = {
    get mode() {
      return mode;
    },
    async start(onChange, onError) {
      emit = onChange;
      fail = onError || (() => {});
      const lost = () => {
        mode = "offline";
        fail("雲端連線中斷，目前的變更不會儲存");
      };
      unsubs.push(
        settingsRef.onSnapshot((s) => {
          if (s.exists) {
            if (settingsPending && snap.settings) return;
            const { settings, changed } = migrateSettings(JSON.parse(JSON.stringify(s.data())));
            update({ settings });
            if (changed && !migrated) {
              migrated = true;
              store.writeSettings(settings);
            }
          } else if (!s.metadata?.fromCache && !created) {
            created = true;
            const settings = defaultSettings();
            update({ settings });
            settingsRef.set(JSON.parse(JSON.stringify(settings))).catch(() => {
              mode = "readonly";
              update({});
            });
          }
        }, lost),
      );
      unsubs.push(
        monthsCol.onSnapshot((qs) => {
          const m: Months = {};
          qs.docs.forEach((d) => {
            const v = d.data();
            // 雲端快照的物件是唯讀的，複製一份才能在本機修改
            const it: Tx[] = Array.isArray(v.items) ? JSON.parse(JSON.stringify(v.items)) : [];
            m[d.id] = { items: it };
            BASE[d.id] = baseOf(it);
          });
          for (const k in BASE) if (!m[k]) delete BASE[k];
          update({ months: m, monthsReady: true });
        }, lost),
      );
    },
    stop() {
      unsubs.forEach((u) => u());
      unsubs = [];
    },
    writeMonth(key, items) {
      if (mode !== "live") return;
      const d = diffMonth(BASE[key] || new Map(), items);
      if (!d) return;
      BASE[key] = d.nextBase;
      chains[key] = (chains[key] || Promise.resolve())
        .then(async () => {
          const ref = monthsCol.doc(key);
          // 寫入期間用短暫的租約，讓其他裝置排隊
          try {
            for (let i = 0; i < 12; i++) {
              const a = ref.acquire ? await ref.acquire({ holder, ttlMs: 5000 }) : null;
              if (!a || a.acquired) break;
              await sleep(200 + Math.random() * 300);
            }
          } catch {
            /* 沒有租約功能就直接寫 */
          }
          const cur = await ref.get();
          const curItems = cur.exists && Array.isArray(cur.data()?.items) ? cur.data().items : [];
          await ref.set({ items: mergeMonth(curItems, d.up, d.del) });
        })
        .catch((e: { code?: string }) => fail(e && e.code === "quota_exceeded" ? "雲端空間已滿，請刪除部分舊記錄" : "儲存失敗，請稍後再試"));
    },
    replaceMonth(key, items) {
      if (mode !== "live") return Promise.resolve();
      BASE[key] = baseOf(items);
      return (chains[key] = (chains[key] || Promise.resolve()).then(() => monthsCol.doc(key).set({ items: items.slice() })));
    },
    writeSettings(settings) {
      if (mode !== "live") return;
      if (setTimer) clearTimeout(setTimer);
      settingsPending = true;
      timerLive = true;
      setTimer = setTimeout(() => {
        timerLive = false;
        const body = JSON.parse(JSON.stringify(settings));
        setChain = setChain
          .then(() => settingsRef.set(body))
          .catch(() => fail("設定儲存失敗"))
          .then(() => {
            if (!timerLive) settingsPending = false;
          });
      }, 400);
    },
  };
  return store;
}
