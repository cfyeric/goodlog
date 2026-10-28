import { describe, expect, it } from "vitest";
import { budgetAlerts, budgetList } from "../src/core/budget";
import { remindList, reminderSignature } from "../src/core/reminders";
import { CARDS, ledger, tx } from "./helpers";

describe("預算", () => {
  const cards = CARDS.map((c) => (c.id === "J" ? { ...c, budget: 1000 } : c.id === "E" ? { ...c, budget: 100 } : c));
  const l = ledger(
    [
      tx({ date: "2026-10-03", pay: "cash", amount: 300, projectId: "p1" }),
      tx({ date: "2026-10-04", pay: "card", cardId: "J", amount: 400, fee: 10, discount: 10, projectId: "p1" }),
      tx({ date: "2026-10-05", pay: "card", cardId: "E", amount: 80, projectId: "p1" }),
      tx({ date: "2026-10-06", type: "topup", pay: "card", cardId: "E", amount: 500 }),
      tx({ date: "2026-10-07", pay: "card", cardId: "C", amount: 50, pending: true }),
      tx({ date: "2026-09-30", pay: "card", cardId: "J", amount: 999, projectId: "p1" }),
      tx({ date: "2026-10-08", type: "income", amount: 5000, projectId: "p1" }),
    ],
    {
      cards,
      cashBudget: { budget: 500 },
      cardBudget: { budget: 2000 },
      projects: [{ id: "p1", name: "旅行", budget: 3000, bper: "total" }, { id: "p2", name: "封存", budget: 1, archived: true }],
    },
  );
  const by = Object.fromEntries(budgetList(l, "2026-10").map((b) => [b.key, b]));
  it("現金每月", () => expect(by.cash.spent).toBe(300));
  it("信用卡算刷卡淨額加上加值，不含儲值卡消費和待入帳", () => {
    expect(by["card:J"].spent).toBe(900);
    expect(by.cardall.spent).toBe(900);
  });
  it("儲值卡算自己的消費", () => expect(by["card:E"].spent).toBe(80));
  it("專案總計預算算全部月份，收入不算，封存的不列", () => {
    expect(by.p1).toMatchObject({ per: "total", spent: 300 + 400 + 80 + 999 });
    expect(by.p2).toBeUndefined();
  });
  it("只提醒 80% 以上，比例高的在前", () => {
    expect(budgetAlerts(l, "2026-10").map((b) => b.key)).toEqual(["card:J", "card:E"]);
  });
});

describe("繳費提醒", () => {
  const l = ledger([tx({ id: "p", date: "2026-10-19", pending: true, amount: 1200, name: "電費" })], {
    categories: [{ id: "c1", name: "水費", type: "expense", groupId: "g" }],
    recurs: [{ id: "w", kind: "recur", unit: "month", every: 1, dom: 24, start: "2026-10-24", post: "remind", done: 0, tpl: { type: "expense", amount: 400, catId: "c1" } }],
  });
  it("已到期的待入帳和 7 天內到期的都列出", () => {
    const L = remindList(l, "2026-10-21");
    expect(L.map((x) => [x.due, x.date])).toEqual([[true, "2026-10-19"], [false, "2026-10-24"]]);
    const up = L[1];
    if (up.due) throw new Error();
    expect(up).toMatchObject({ name: "水費", amt: 400 });
    expect(reminderSignature(L)).toBe("p2026-10-19|w2026-10-24");
  });
  it("超過 7 天的不列", () => expect(remindList(l, "2026-10-16").filter((x) => !x.due)).toEqual([]));
});
