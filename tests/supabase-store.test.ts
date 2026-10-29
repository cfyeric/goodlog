import { describe, expect, it } from "vitest";
import { createSupabaseStore, type Row, type SupaAdapter } from "../src/data/supabaseStore";
import type { LedgerSnapshot } from "../src/data/store";
import type { Settings, Tx } from "../src/core/types";
import { tx } from "./helpers";

/** 記憶體版的資料庫：行為跟 supabaseAdapter 一樣（版本號不符就回傳 null） */
function fakeDb() {
  const st: { settings: Row<Settings> | null; months: Record<string, Row<Tx[]>> } = { settings: null, months: {} };
  const c = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  let beforeWrite: (() => void) | null = null;
  const hook = () => {
    const h = beforeWrite;
    beforeWrite = null;
    h?.();
  };
  const db: SupaAdapter = {
    async getSettings() {
      return st.settings ? c(st.settings) : null;
    },
    async settingsRev() {
      return st.settings ? st.settings.rev : null;
    },
    async insertSettings(data) {
      if (st.settings) return null;
      st.settings = { value: c(data), rev: 1 };
      return 1;
    },
    async updateSettings(data, rev) {
      if (!st.settings || st.settings.rev !== rev) return null;
      st.settings = { value: c(data), rev: rev + 1 };
      return rev + 1;
    },
    async monthRevs() {
      return Object.fromEntries(Object.entries(st.months).map(([k, v]) => [k, v.rev]));
    },
    async getMonths(yms) {
      const o: Record<string, Row<Tx[]>> = {};
      for (const k in st.months) if (!yms || yms.includes(k)) o[k] = c(st.months[k]);
      return o;
    },
    async insertMonth(ym, items) {
      hook();
      if (st.months[ym]) return null;
      st.months[ym] = { value: c(items), rev: 1 };
      return 1;
    },
    async updateMonth(ym, items, rev) {
      hook();
      const cur = st.months[ym];
      if (!cur || cur.rev !== rev) return null;
      st.months[ym] = { value: c(items), rev: rev + 1 };
      return rev + 1;
    },
  };
  return { db, st, race: (f: () => void) => (beforeWrite = f) };
}

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function open(db: SupaAdapter) {
  let last: LedgerSnapshot = { settings: null, months: {}, monthsReady: false };
  const errs: string[] = [];
  const s = createSupabaseStore(db, { pollMs: 0 });
  await s.start((n) => (last = n), (m) => errs.push(m));
  return { s, get snap() {
    return last;
  }, errs };
}
const ids = (items: Tx[] | undefined) => (items || []).map((t) => t.id);

describe("Supabase 資料存取", () => {
  it("新帳號自動建立預設設定", async () => {
    const f = fakeDb();
    const a = await open(f.db);
    expect(a.snap.monthsReady).toBe(true);
    expect(f.st.settings?.value.categories.length).toBeGreaterThan(0);
  });

  it("寫入新月份、修改既有月份", async () => {
    const f = fakeDb();
    const a = await open(f.db);
    a.s.writeMonth("2026-10", [tx({ id: "a" })]);
    await wait();
    expect(ids(f.st.months["2026-10"].value)).toEqual(["a"]);
    a.s.writeMonth("2026-10", [tx({ id: "a", amount: 5 }), tx({ id: "b" })]);
    await wait();
    expect(f.st.months["2026-10"].value.map((t) => [t.id, t.amount])).toEqual([["a", 5], ["b", 0]]);
    expect(f.st.months["2026-10"].rev).toBe(2);
  });

  it("兩台裝置同時記同一個月，兩邊的記錄都保留", async () => {
    const f = fakeDb();
    f.st.months["2026-10"] = { value: [tx({ id: "old" })], rev: 1 };
    const phone = await open(f.db);
    const pc = await open(f.db);
    // 手機要寫入的瞬間，電腦先寫進一筆
    f.race(() => {
      f.st.months["2026-10"] = { value: [tx({ id: "old" }), tx({ id: "pc" })], rev: 2 };
    });
    phone.s.writeMonth("2026-10", [tx({ id: "old" }), tx({ id: "phone" })]);
    await wait(700); // 第一次寫入會因版本不符失敗，等它重試
    expect(ids(f.st.months["2026-10"].value)).toEqual(["old", "pc", "phone"]);
    // 手機畫面也看得到電腦那筆
    expect(ids(phone.snap.months["2026-10"].items)).toEqual(["old", "pc", "phone"]);
    // 電腦切回畫面時同步
    await pc.s.sync();
    expect(ids(pc.snap.months["2026-10"].items)).toEqual(["old", "pc", "phone"]);
  });

  it("刪除只刪自己刪的那筆", async () => {
    const f = fakeDb();
    f.st.months["2026-10"] = { value: [tx({ id: "a" }), tx({ id: "b" })], rev: 1 };
    const a = await open(f.db);
    f.race(() => {
      f.st.months["2026-10"] = { value: [tx({ id: "a" }), tx({ id: "b" }), tx({ id: "c" })], rev: 2 };
    });
    a.s.writeMonth("2026-10", [tx({ id: "b" })]);
    await wait(700);
    expect(ids(f.st.months["2026-10"].value)).toEqual(["b", "c"]);
  });

  it("還原備份整個月取代", async () => {
    const f = fakeDb();
    f.st.months["2026-09"] = { value: [tx({ id: "x" })], rev: 3 };
    const a = await open(f.db);
    await a.s.replaceMonth("2026-09", []);
    await a.s.replaceMonth("2026-08", [tx({ id: "y" })]);
    expect(f.st.months["2026-09"]).toEqual({ value: [], rev: 4 });
    expect(ids(f.st.months["2026-08"].value)).toEqual(["y"]);
  });

  it("設定在短時間內多次修改只寫最後一次，別台裝置改過也能寫入", async () => {
    const f = fakeDb();
    const a = await open(f.db);
    const s0 = a.snap.settings!;
    f.st.settings!.rev = 7; // 別台裝置剛寫過
    a.s.writeSettings({ ...s0, aliases: [{ id: "1", desc: "A", catId: "c" }] } as Settings);
    a.s.writeSettings({ ...s0, aliases: [{ id: "2", desc: "B", catId: "c" }] } as Settings);
    await wait(600);
    expect(f.st.settings!.value.aliases?.map((x) => x.id)).toEqual(["2"]);
    expect(f.st.settings!.rev).toBe(8);
    expect(a.errs).toEqual([]);
  });

  it("連不上資料庫時顯示錯誤，不寫入", async () => {
    const f = fakeDb();
    f.db.getSettings = async () => {
      throw new Error("network");
    };
    const a = await open(f.db);
    expect(a.s.mode).toBe("offline");
    expect(a.errs[0]).toContain("連不上");
  });

  it("同時改設定和多個月份（例如 MOZE 匯入）：寫完後畫面上的新類別不會被舊設定蓋回去", async () => {
    const f = fakeDb();
    const a = await open(f.db);
    const s0 = a.snap.settings!;
    const s1 = { ...s0, cards: [...(s0.cards || []), { id: "new", name: "新卡" }] } as Settings;
    // 別台裝置剛好也在 9 月記了一筆，寫完後要把合併結果通知畫面
    f.race(() => {
      f.st.months["2026-09"] = { value: [tx({ id: "other" })], rev: 1 };
    });
    a.s.writeSettings(s1);
    a.s.writeMonth("2026-09", [tx({ id: "x", cardId: "new" })]);
    a.s.writeMonth("2026-10", [tx({ id: "y", cardId: "new" })]);
    await wait(700);
    expect(a.snap.settings!.cards!.map((c) => c.id)).toContain("new");
    expect(ids(a.snap.months["2026-09"].items)).toEqual(["other", "x"]);
    expect(ids(a.snap.months["2026-10"].items)).toEqual(["y"]);
    expect(f.st.settings!.value.cards!.map((c) => c.id)).toContain("new");
  });
});
