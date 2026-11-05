import { describe, expect, it } from "vitest";
import { addToGroup, deleteTxs, groupDay, groupMembers, groupNet, groupTitle, newDraft, saveGroup, type Draft } from "../src/core/editor";
import type { Ledger } from "../src/core/types";
import { ledger, tx } from "./helpers";

const now = new Date(2026, 10, 5, 8, 30);
const CATS = [
  { id: "c1", name: "正餐", type: "expense" as const, groupId: "g" },
  { id: "c2", name: "飲料", type: "expense" as const, groupId: "g" },
];
const draft = (L: Ledger, p: Partial<Draft["t"]>, amount: string): Draft => {
  const d = newDraft(L, null, { date: "2026-11-05", now, id: "n" + Math.random() });
  return { ...d, t: { ...d.t, ...p }, ex: { amount, fee: "", discount: "" } };
};
let n = 0;
const ids = () => "x" + n++;

describe("多筆群組", () => {
  it("存兩筆：共用群組 id，日期、時間、商家用目前那筆的", () => {
    const L = ledger([], { categories: CATS });
    const a = draft(L, { id: "a", catId: "c1", name: "便當" }, "100");
    const b = { ...addToGroup(a, "b"), t: { ...addToGroup(a, "b").t, catId: "c2", date: "2026-11-01" } };
    b.ex.amount = "30";
    const shared = { ...a.t, merchant: "全家", date: "2026-11-04", time: "12:00" };
    const r = saveGroup(L, [a, b], [], shared, ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const items = r.months["2026-11"];
    expect(items.map((t) => [t.id, t.amount, t.date, t.merchant])).toEqual([
      ["a", 100, "2026-11-04", "全家"],
      ["b", 30, "2026-11-04", "全家"],
    ]);
    expect(items[0].grp).toBeTruthy();
    expect(items[0].grp).toBe(items[1].grp);
    expect(r.msg).toBe("已記下 2 筆，共 $130");
  });

  it("有一筆沒填金額：回報是第幾筆", () => {
    const L = ledger([], { categories: CATS });
    const a = draft(L, { id: "a", catId: "c1" }, "100");
    const b = draft(L, { id: "b", catId: "c2" }, "");
    const r = saveGroup(L, [a, b], [], a.t, ids);
    expect(r.ok).toBe(false);
    expect(r.idx).toBe(1);
  });

  it("編輯群組：拿掉一筆後只剩一筆，群組 id 拿掉，被拿掉的那筆刪除", () => {
    const o1 = tx({ id: "a", catId: "c1", amount: 100, grp: "g1", date: "2026-11-05" });
    const o2 = tx({ id: "b", catId: "c2", amount: 30, grp: "g1", date: "2026-11-05" });
    const L = ledger([o1, o2, tx({ id: "z", date: "2026-11-05" })], { categories: CATS });
    expect(groupMembers(L, o2).map((t) => t.id)).toEqual(["a", "b"]);
    const d = newDraft(L, o1, { date: "2026-11-05", now, id: "q" });
    const r = saveGroup(L, [d], [o1, o2], d.t, ids);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.months["2026-11"].map((t) => t.id).sort()).toEqual(["a", "z"]);
    expect(r.months["2026-11"].find((t) => t.id === "a")!.grp).toBeUndefined();
  });

  it("日期改到別的月份：從原本月份移走", () => {
    const o1 = tx({ id: "a", catId: "c1", amount: 100, grp: "g1", date: "2026-11-05" });
    const o2 = tx({ id: "b", catId: "c2", amount: 30, grp: "g1", date: "2026-11-05" });
    const L = ledger([o1, o2], { categories: CATS });
    const ds = [o1, o2].map((o) => newDraft(L, o, { date: "2026-11-05", now, id: "q" }));
    const r = saveGroup(L, ds, [o1, o2], { ...ds[0].t, date: "2026-10-31" }, ids);
    if (!r.ok) throw new Error(r.err);
    expect(r.months["2026-11"]).toEqual([]);
    expect(r.months["2026-10"].map((t) => [t.id, t.grp])).toEqual([
      ["a", "g1"],
      ["b", "g1"],
    ]);
  });

  it("當日列表合成一列，名稱、合計", () => {
    const s = ledger([], { categories: CATS }).settings;
    const list = [tx({ id: "1", grp: "g", catId: "c1", amount: 100 }), tx({ id: "2" }), tx({ id: "3", grp: "g", catId: "c2", amount: 30, merchant: "全家" }), tx({ id: "4", grp: "h" })];
    const items = groupDay(list);
    expect(items.map((x) => (x.kind === "tx" ? x.t.id : x.items.map((t) => t.id).join("+")))).toEqual(["1+3", "2", "4"]);
    const g = items[0];
    if (g.kind !== "grp") throw new Error();
    expect(groupTitle(s, g.items)).toBe("全家");
    expect(groupTitle(s, [tx({ catId: "c2" })])).toBe("飲料");
    expect(groupNet(g.items)).toBe(-130);
  });

  it("刪除整組", () => {
    const o1 = tx({ id: "a", grp: "g1", date: "2026-11-05" });
    const o2 = tx({ id: "b", grp: "g1", date: "2026-11-05" });
    const L = ledger([o1, o2, tx({ id: "z", date: "2026-11-05" })]);
    expect(deleteTxs(L, [o1, o2])["2026-11"].map((t) => t.id)).toEqual(["z"]);
  });
});
