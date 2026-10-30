/**
 * 接 Supabase 資料庫（網頁放在 GitHub Pages 等一般網站時使用）。
 *
 * 資料格式跟 claude.ai 版相同：設定一份、每個月一份 { items }，只是存在 Supabase 的兩張表
 * （見 supabase/schema.sql）。每一列有版本號 rev，寫入時「版本沒變才寫入」，
 * 版本變了代表別台裝置剛寫過，就重新讀最新內容、合併後再寫（merge.ts，跟 claude.ai 版同一套）。
 *
 * 跟資料庫溝通的部分抽成 SupaAdapter，測試時可以換成記憶體版本。
 */
import type { Months, Settings, Tx } from "../core/types";
import { defaultSettings, migrateSettings } from "../core/defaults";
import type { LedgerSnapshot, LedgerStore, StoreMode } from "./store";
import { baseOf, diffMonth, mergeMonth, type MonthBase } from "./merge";

export interface Row<T> {
  value: T;
  rev: number;
}

/** 資料庫的最小操作。寫入失敗（版本不符、已經存在）回傳 null，其他錯誤直接丟出 */
export interface SupaAdapter {
  getSettings(): Promise<Row<Settings> | null>;
  settingsRev(): Promise<number | null>;
  insertSettings(data: Settings): Promise<number | null>;
  updateSettings(data: Settings, rev: number): Promise<number | null>;
  monthRevs(): Promise<Record<string, number>>;
  getMonths(yms?: string[]): Promise<Record<string, Row<Tx[]>>>;
  insertMonth(ym: string, items: Tx[]): Promise<number | null>;
  updateMonth(ym: string, items: Tx[], rev: number): Promise<number | null>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SupaStoreOptions {
  /** 背景檢查其他裝置變更的間隔（毫秒），0 表示不自動檢查 */
  pollMs?: number;
  /** 有其他裝置寫入時，最多重試幾次 */
  retries?: number;
  /** 本機副本：打開時先顯示上次的內容，雲端讀完再換成最新的 */
  cache?: {
    load(): Promise<{ settings: Settings; months: Months } | null>;
    save(v: { settings: Settings; months: Months }): void;
  };
}

export function createSupabaseStore(db: SupaAdapter, opt: SupaStoreOptions = {}): LedgerStore & { sync(): Promise<void> } {
  const pollMs = opt.pollMs ?? 30_000;
  const retries = opt.retries ?? 6;
  const BASE: Record<string, MonthBase> = {};
  const REV: Record<string, number> = {};
  const chains: Record<string, Promise<void>> = {};
  /** 還在寫入中的月份（寫完之前不要被背景同步蓋掉） */
  const busy: Record<string, number> = {};
  let settingsRev: number | null = null;
  let mode: StoreMode = "live";
  let snap: LedgerSnapshot = { settings: null, months: {}, monthsReady: false };
  let emit: (s: LedgerSnapshot) => void = () => {};
  let fail: (m: string) => void = () => {};
  let setTimer: ReturnType<typeof setTimeout> | null = null;
  let setChain: Promise<void> = Promise.resolve();
  let settingsPending = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  /** 每次 start 加 1；舊的 start 還在讀資料時被 stop 掉，讀完就不再套用 */
  let gen = 0;
  const onWake = () => {
    if (document.visibilityState === "visible") void store.sync();
  };

  /** 雲端讀完之後才存本機副本（只顯示副本時不存，避免把舊內容又存回去） */
  let fresh = false;
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  const saveCache = () => {
    if (!opt.cache || !fresh || !snap.settings) return;
    if (cacheTimer) clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      if (snap.settings) opt.cache!.save({ settings: snap.settings, months: snap.months });
    }, 1500);
  };
  const update = (p: Partial<LedgerSnapshot>) => {
    snap = { ...snap, ...p };
    if (!stopped) emit(snap);
    saveCache();
  };
  const setMonthSnap = (k: string, items: Tx[]) => update({ months: { ...snap.months, [k]: { items } } });

  /** 讀最新內容 → 算出要寫的內容 → 版本沒變才寫入；版本變了就重來 */
  async function writeLoop(key: string, make: (cur: Tx[]) => Tx[]): Promise<Tx[]> {
    for (let i = 0; i < retries; i++) {
      const cur = (await db.getMonths([key]))[key];
      const next = make(cur ? cur.value : []);
      const rev = cur ? await db.updateMonth(key, next, cur.rev) : await db.insertMonth(key, next);
      if (rev != null) {
        REV[key] = rev;
        return next;
      }
      await sleep(150 + Math.random() * 300);
    }
    throw new Error("conflict");
  }

  async function writeSettingsNow(body: Settings) {
    for (let i = 0; i < retries; i++) {
      const rev = settingsRev == null ? await db.insertSettings(body) : await db.updateSettings(body, settingsRev);
      if (rev != null) {
        settingsRev = rev;
        return;
      }
      // 別台裝置剛改過設定：以這次的內容為準（跟 claude.ai 版一樣，最後寫的蓋過）
      settingsRev = await db.settingsRev();
    }
    throw new Error("conflict");
  }

  const store = {
    get mode() {
      return mode;
    },
    async start(onChange: (s: LedgerSnapshot) => void, onError?: (m: string) => void) {
      emit = onChange;
      fail = onError || (() => {});
      stopped = false;
      const my = ++gen;
      const alive = () => my === gen && !stopped;
      fresh = false;
      // 設定和所有月份同時向雲端要，同時先拿本機副本出來顯示
      const remote = Promise.all([db.getSettings(), db.getMonths()]);
      let shownCache = false;
      if (opt.cache)
        opt.cache.load().then(
          (c) => {
            if (!c || !c.settings || fresh || !alive() || snap.settings) return;
            shownCache = true;
            const months: Months = {};
            for (const k in c.months || {}) {
              const it = Array.isArray(c.months[k]?.items) ? c.months[k].items : [];
              months[k] = { items: it };
              BASE[k] = baseOf(it);
            }
            // monthsReady 先維持 false：雲端讀完前不補產生週期記錄
            update({ settings: migrateSettings(clone(c.settings)).settings, months });
          },
          () => undefined,
        );
      try {
        const [row, ms] = await remote;
        if (!alive()) return;
        if (row) {
          settingsRev = row.rev;
          const { settings, changed } = migrateSettings(clone(row.value));
          // 顯示副本期間如果改過設定，以本機的為準（寫入時會用新的版本號）
          if (!settingsPending) update({ settings });
          if (changed && !settingsPending) store.writeSettings(settings);
        } else {
          const settings = defaultSettings();
          update({ settings });
          await writeSettingsNow(clone(settings));
        }
        const months: Months = {};
        for (const k in ms) {
          const it = Array.isArray(ms[k].value) ? clone(ms[k].value) : [];
          months[k] = { items: it };
          REV[k] = ms[k].rev;
          // 還在寫入中的月份保留畫面上的內容，寫完會再更新
          if (busy[k]) months[k] = snap.months[k] || months[k];
          else BASE[k] = baseOf(it);
        }
        for (const k in snap.months) if (!months[k] && busy[k]) months[k] = snap.months[k];
        fresh = true;
        update({ months, monthsReady: true });
      } catch {
        if (!alive()) return;
        mode = "offline";
        update({});
        fail(shownCache || snap.settings ? "連不上雲端，目前顯示的是上次的資料，變更不會儲存" : "連不上雲端資料庫，請確認網路後重新整理");
        return;
      }
      if (!alive()) return;
      if (pollMs > 0) timer = setInterval(() => document.visibilityState === "visible" && void store.sync(), pollMs);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onWake);
        window.addEventListener("focus", onWake);
      }
    },
    stop() {
      stopped = true;
      gen++;
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onWake);
        window.removeEventListener("focus", onWake);
      }
    },
    /** 檢查其他裝置有沒有改過資料，有的話讀進來 */
    async sync() {
      if (mode !== "live" || !snap.monthsReady) return;
      try {
        if (!settingsPending) {
          const r = await db.settingsRev();
          if (r != null && r !== settingsRev && !settingsPending) {
            const row = await db.getSettings();
            if (row && !settingsPending) {
              settingsRev = row.rev;
              update({ settings: migrateSettings(clone(row.value)).settings });
            }
          }
        }
        const revs = await db.monthRevs();
        const changed = Object.keys(revs).filter((k) => revs[k] !== REV[k] && !busy[k]);
        if (!changed.length) return;
        const rows = await db.getMonths(changed);
        let months = snap.months;
        for (const k of changed) {
          if (busy[k] || !rows[k]) continue;
          const it = clone(rows[k].value);
          BASE[k] = baseOf(it);
          REV[k] = rows[k].rev;
          months = { ...months, [k]: { items: it } };
        }
        update({ months });
      } catch {
        /* 背景檢查失敗就等下一次 */
      }
    },
    writeMonth(key: string, items: Tx[]) {
      if (mode !== "live") return;
      // 畫面上的改動也記在這裡的快照；之後通知畫面時才不會用舊內容把它蓋回去
      snap = { ...snap, months: { ...snap.months, [key]: { items } } };
      saveCache();
      const d = diffMonth(BASE[key] || new Map(), items);
      if (!d) return;
      BASE[key] = d.nextBase;
      busy[key] = (busy[key] || 0) + 1;
      chains[key] = (chains[key] || Promise.resolve())
        .then(async () => {
          const saved = await writeLoop(key, (cur) => mergeMonth(cur, d.up, d.del));
          // 寫完時如果沒有其他待寫的變更，把合併後的結果（含別台裝置的記錄）顯示出來
          if (busy[key] === 1) {
            BASE[key] = baseOf(saved);
            const local = snap.months[key]?.items || [];
            if (JSON.stringify(local) !== JSON.stringify(saved)) setMonthSnap(key, clone(saved));
          }
        })
        .catch(() => fail("儲存失敗，請稍後再試"))
        .finally(() => {
          busy[key]--;
        });
    },
    replaceMonth(key: string, items: Tx[]) {
      if (mode !== "live") return Promise.resolve();
      snap = { ...snap, months: { ...snap.months, [key]: { items: items.slice() } } };
      saveCache();
      BASE[key] = baseOf(items);
      busy[key] = (busy[key] || 0) + 1;
      const p = (chains[key] || Promise.resolve())
        .then(() => writeLoop(key, () => items.slice()))
        .then(() => undefined)
        .finally(() => {
          busy[key]--;
        });
      chains[key] = p.catch(() => undefined);
      return p;
    },
    writeSettings(settings: Settings) {
      if (mode !== "live") return;
      snap = { ...snap, settings };
      saveCache();
      if (setTimer) clearTimeout(setTimer);
      settingsPending = true;
      setTimer = setTimeout(() => {
        setTimer = null;
        const body = clone(settings);
        setChain = setChain
          .then(() => writeSettingsNow(body))
          .catch(() => fail("設定儲存失敗"))
          .then(() => {
            if (!setTimer) settingsPending = false;
          });
      }, 400);
    },
  };
  return store;
}
