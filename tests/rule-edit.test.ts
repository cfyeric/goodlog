import { describe, expect, it } from "vitest";
import { ruleDraft, saveRule } from "../src/core/editor";
import { runRecurs } from "../src/core/recurrence";
import type { Rule } from "../src/core/types";
import { ledger, tx } from "./helpers";

const CATS = [
  { id: "c1", name: "訂閱", type: "expense" as const, groupId: "g" },
  { id: "c2", name: "電信", type: "expense" as const, groupId: "g" },
];
const rule = (p: Partial<Rule>): Rule =>
  ({ id: "r1", kind: "recur", every: 1, unit: "month", dom: 20, start: "2026-10-20", startIdx: 1, count: 0, post: "now", workday: "same", grace: 0, tpl: { type: "expense", amount: 692, catId: "c1", name: "claude", pay: "card", cardId: "C", time: "09:00" }, done: 1, ...p }) as Rule;
let n = 0;
const nid = () => "n" + n++;

describe("編輯排程", () => {
  it("草稿用下一期的內容", () => {
    const d = ruleDraft(rule({}), "x");
    expect([d.t.date, d.t.name, d.ex.amount, d.mode?.kind, d.mode?.dom]).toEqual(["2026-11-20", "claude", "692", "recur", 20]);
  });

  it("改金額和名稱：只改範本，已記的不動，之後照新金額", () => {
    const old = tx({ id: "r1-1", date: "2026-10-20", amount: 692, rec: { id: "r1", i: 1 } });
    const L = ledger([old], { categories: CATS, recurs: [rule({})] });
    const d = ruleDraft(rule({}), "x");
    const r = saveRule(L, "r1", { ...d, t: { ...d.t, name: "Claude Pro", catId: "c2" }, ex: { ...d.ex, amount: "700" } }, nid);
    if (!r.ok) throw new Error(r.err);
    expect(r.months).toEqual({});
    const nr = r.settings!.recurs![0];
    expect([nr.id, nr.tpl.amount, nr.tpl.name, nr.tpl.catId, nr.done, nr.start]).toEqual(["r1", 700, "Claude Pro", "c2", 1, "2026-10-20"]);
    const run = runRecurs({ "2026-10": { items: [old] } }, r.settings!.recurs!, "2026-11-25");
    const nov = run.months["2026-11"].items;
    expect(nov.map((t) => [t.id, t.amount, t.name])).toEqual([["r1-2", 700, "Claude Pro"]]);
  });

  it("記過的排程改週期：舊的停在已記那期，從下一期起用新規則", () => {
    const L = ledger([], { categories: CATS, recurs: [rule({})] });
    const d = ruleDraft(rule({}), "x");
    const r = saveRule(L, "r1", { ...d, schedTouched: true, mode: { ...d.mode!, dom: 5 } }, nid);
    if (!r.ok) throw new Error(r.err);
    const [a, b] = r.settings!.recurs!;
    expect([a.id, a.count]).toEqual(["r1", 1]);
    expect([b.dom, b.start, b.done, b.tpl.amount]).toEqual([5, "2026-11-05", 0, 692]);
  });

  it("還沒記過的排程改週期：直接改原本那條", () => {
    const r0 = rule({ id: "r2", done: 0, start: "2027-07-10", unit: "year", dom: 10, moy: 7, post: "remind" });
    const L = ledger([], { categories: CATS, recurs: [r0] });
    const d = ruleDraft(r0, "x");
    const r = saveRule(L, "r2", { ...d, schedTouched: true, mode: { ...d.mode!, moy: 8 } }, nid);
    if (!r.ok) throw new Error(r.err);
    expect(r.settings!.recurs!.map((x) => [x.id, x.moy, x.start])).toEqual([["r2", 8, "2027-08-10"]]);
  });

  it("改成不再重複：停在已記的那期", () => {
    const L = ledger([], { categories: CATS, recurs: [rule({ done: 3 })] });
    const d = ruleDraft(rule({ done: 3 }), "x");
    const r = saveRule(L, "r1", { ...d, schedTouched: true, mode: { kind: "once" } }, nid);
    if (!r.ok) throw new Error(r.err);
    expect(r.settings!.recurs![0].count).toBe(3);
  });

  it("單次排程可以改日期", () => {
    const r0 = rule({ id: "o1", kind: "once", start: "2026-12-01", done: 0, count: 1, post: "remind" });
    const L = ledger([], { categories: CATS, recurs: [r0] });
    const d = ruleDraft(r0, "x");
    const r = saveRule(L, "o1", { ...d, t: { ...d.t, date: "2026-12-15" } }, nid);
    if (!r.ok) throw new Error(r.err);
    expect(r.settings!.recurs![0].start).toBe("2026-12-15");
  });

  it("分期不改金額", () => {
    const r0 = rule({ id: "i1", kind: "inst", count: 3, total: 300, plan: [{ amount: 100, fee: 0, discount: 0, interest: 0 }, { amount: 100, fee: 0, discount: 0, interest: 0 }, { amount: 100, fee: 0, discount: 0, interest: 0 }], done: 1 });
    const L = ledger([], { categories: CATS, recurs: [r0] });
    const d = ruleDraft(r0, "x");
    const r = saveRule(L, "i1", { ...d, t: { ...d.t, name: "手機" }, ex: { ...d.ex, amount: "999" } }, nid);
    if (!r.ok) throw new Error(r.err);
    const nr = r.settings!.recurs![0];
    expect([nr.tpl.name, nr.tpl.amount, nr.plan![1].amount]).toEqual(["手機", 692, 100]);
  });
});
