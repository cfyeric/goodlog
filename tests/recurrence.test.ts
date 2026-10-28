import { describe, expect, it } from "vitest";
import {
  buildPlan, createRule, expandAll, makeOcc, nOcc, normRule, occAt, recurStart, ruleMode, runRecurs, upcomingReminders, wdSet,
} from "../src/core/recurrence";
import { everyText, recurHint, schedText } from "../src/core/recurrenceText";
import type { Rule } from "../src/core/types";
import { tx } from "./helpers";

const rule = (p: Partial<Rule>): Rule => ({ id: "r1", kind: "recur", every: 1, unit: "month", start: "2026-10-01", startIdx: 1, post: "due", tpl: { type: "expense", amount: 40, catId: "c1" }, done: 0, ...p });
const dates = (r: Rule, n: number) => Array.from({ length: n }, (_, j) => occAt(r, j));

describe("第一期日期 recurStart", () => {
  it("每月 25 號，26 號才記 → 下個月 25 號", () => {
    expect(recurStart({ unit: "month", dom: 25 }, "2026-10-26")).toBe("2026-11-25");
    expect(recurStart({ unit: "month", dom: 25 }, "2026-10-25")).toBe("2026-10-25");
  });
  it("每週三，從週三開始就是當天，週四開始就是下週三", () => {
    expect(recurStart({ unit: "week", dow: 3 }, "2026-10-28")).toBe("2026-10-28");
    expect(recurStart({ unit: "week", dow: 3 }, "2026-10-29")).toBe("2026-11-04");
  });
  it("每年 2/29 遇到平年用 2/28", () => {
    expect(recurStart({ unit: "year", moy: 2, dom: 29 }, "2026-03-01")).toBe("2027-02-28");
  });
});

describe("每一期的日期 occAt", () => {
  it("每月 31 號遇到小月用月底", () => {
    expect(dates(rule({ start: "2026-01-31", dom: 31 }), 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("每 2 週", () => {
    expect(dates(rule({ unit: "week", every: 2, start: "2026-10-28" }), 3)).toEqual(["2026-10-28", "2026-11-11", "2026-11-25"]);
  });
  it("每個平日（週五開始，跳過週末）", () => {
    expect(dates(rule({ unit: "day", wdays: [1, 2, 3, 4, 5], start: "2026-10-23" }), 4)).toEqual(["2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28"]);
  });
  it("舊格式 weekdays: true 等於平日", () => {
    expect(wdSet({ weekdays: true })).toEqual([1, 2, 3, 4, 5]);
    expect(wdSet({ wdays: [0, 6, 1] })).toEqual([1, 6, 0]);
    expect(wdSet({ wdays: [0, 1, 2, 3, 4, 5, 6] })).toBeNull();
  });
  it("遇到週末延後或提前（2026-11-01 是週日）", () => {
    expect(occAt(rule({ dom: 1, start: "2026-11-01", workday: "after" }), 0)).toBe("2026-11-02");
    expect(occAt(rule({ dom: 1, start: "2026-11-01", workday: "before" }), 0)).toBe("2026-10-30");
  });
  it("分期寬限月數", () => {
    expect(occAt(rule({ kind: "inst", start: "2026-10-05", grace: 2 }), 0)).toBe("2026-12-05");
  });
});

describe("runRecurs 補上到期的記錄", () => {
  it("延後入帳：只產生日期已到的期數，重跑不會重複", () => {
    const r = rule({ dom: 1 });
    const a = runRecurs({}, [r], "2026-12-15");
    expect(a.touched.sort()).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(a.recurs[0].done).toBe(3);
    expect(a.months["2026-11"].items[0]).toMatchObject({ id: "r1-2", date: "2026-11-01", rec: { id: "r1", i: 2 }, amount: 40 });
    const b = runRecurs(a.months, a.recurs, "2026-12-15");
    expect(b.touched).toEqual([]);
    expect(b.settingsChanged).toBe(false);
  });
  it("立即入帳：先把下一期排進日曆，但 done 只算已到期的", () => {
    const a = runRecurs({}, [rule({ dom: 1, post: "now" })], "2026-11-15");
    expect(a.recurs[0].done).toBe(2);
    expect(a.months["2026-12"].items.map((t) => t.id)).toEqual(["r1-3"]);
  });
  it("提醒入帳：產生的記錄是待入帳", () => {
    const a = runRecurs({}, [rule({ post: "remind" })], "2026-10-02");
    expect(a.months["2026-10"].items[0].pending).toBe(true);
  });
  it("有限次數用完就停；單次規則完成後移除", () => {
    const a = runRecurs({}, [rule({ count: 2 }), rule({ id: "o1", kind: "once", count: 1 })], "2027-06-01");
    expect(a.recurs.map((r) => r.id)).toEqual(["r1"]);
    expect(a.recurs[0].done).toBe(2);
  });
  it("很早期的規則（沒有 kind）用 j 當 id 尾碼", () => {
    const old = normRule({ id: "x", freq: "month", start: "2026-10-01", tpl: { type: "expense", amount: 1 } });
    expect(old).toMatchObject({ kind: "recur", unit: "month", post: "due", legacy: true });
    expect(makeOcc(old, 0).id).toBe("x-0");
  });
  it("不修改傳入的資料", () => {
    const r = rule({});
    const months = { "2026-10": { items: [] } };
    runRecurs(months, [r], "2026-10-20");
    expect(r.done).toBe(0);
    expect(months["2026-10"].items).toEqual([]);
  });
});

describe("分期金額 buildPlan", () => {
  it("無利息平均分，除不盡放第一期或最後一期", () => {
    expect(buildPlan(1000, { instN: 3 }).map((x) => x.amount)).toEqual([333.34, 333.33, 333.33]);
    expect(buildPlan(1000, { instN: 3, remTo: "last" }).map((x) => x.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(buildPlan(1000, { instN: 3, rounding: "round" }).map((x) => x.amount)).toEqual([334, 333, 333]);
  });
  it("本息均攤：本金合計等於總額，第一期利息 = 本金 × 月利率", () => {
    const p = buildPlan(12000, { instN: 12, interest: "annuity", rate: 12, every: 1, unit: "month" });
    expect(p.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(12000, 2);
    expect(p[0].interest).toBe(120);
    expect(p[0].fee).toBe(120);
  });
  it("手續費加在第一期，折扣可以平均分", () => {
    const p = buildPlan(900, { instN: 3, fee: 30, discount: 90, extrasTo: "each" });
    expect(p.map((x) => x.fee)).toEqual([30, 0, 0]);
    expect(p.map((x) => x.discount)).toEqual([30, 30, 30]);
  });
});

describe("建立規則", () => {
  it("分期：每期金額來自計畫，範本不留手續費折扣", () => {
    const r = createRule({ kind: "inst", instN: 3, every: 1, unit: "month", post: "now" }, tx({ date: "2026-10-05", amount: 1000, fee: 10 }), "abc");
    expect(r.id).toBe("iabc");
    expect(nOcc(r)).toBe(3);
    const all = expandAll(r);
    expect(all.map((t) => [t.date, t.amount, t.fee])).toEqual([["2026-10-05", 333.34, 10], ["2026-11-05", 333.33, 0], ["2026-12-05", 333.33, 0]]);
    expect(all[1].inst).toEqual({ id: "iabc", i: 2, n: 3, total: 1000 });
  });
  it("延後入帳用指定的入帳日期起算", () => {
    const r = createRule({ kind: "recur", unit: "month", dom: 10, post: "due", postDate: "2026-12-01" }, tx({ date: "2026-10-05" }), "z");
    expect(r.start).toBe("2026-12-10");
  });
  it("ruleMode 從第 i 期沿用設定，剩餘次數正確", () => {
    expect(ruleMode(rule({ count: 10, dom: 5 }), 4)).toMatchObject({ kind: "recur", count: 7, dom: 5, startIdx: 1 });
  });
});

describe("即將到期的提醒", () => {
  it("只列 (today, limit] 之間的提醒入帳", () => {
    const r = rule({ post: "remind", unit: "week", start: "2026-10-01", done: 3 });
    expect(upcomingReminders([r, rule({ id: "r2" })], "2026-10-20", "2026-10-27").map((x) => x.date)).toEqual(["2026-10-22"]);
  });
});

describe("文字說明", () => {
  it("everyText / schedText / recurHint", () => {
    expect(everyText({ unit: "month", dom: 25 })).toBe("每月 25 號");
    expect(everyText({ unit: "day", wdays: [1, 2, 3, 4, 5] })).toBe("每個平日（週一到週五）");
    expect(everyText({ unit: "week", every: 2, dow: 3 })).toBe("每 2 週（週三）");
    expect(schedText({ kind: "recur", unit: "month", dom: 1, post: "remind", workday: "after" })).toBe("每月 1 號 · 無限期 · 提醒入帳 · 遇週末延後");
    expect(recurHint({ unit: "month", dom: 25, post: "due" }, "2026-10-26")).toBe("每月 25 號記一筆，從 11/25 開始；到了日期才自動入帳。");
  });
});
