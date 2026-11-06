import { describe, expect, it } from "vitest";
import { budgetList } from "../src/core/budget";
import { chargeCard, countsAsExpense, expenseView, svBalance } from "../src/core/ledger";
import type { Card } from "../src/core/types";
import { ledger, tx } from "./helpers";

const cards: Card[] = [
  { id: "F", name: "富邦J卡", budget: 1000 },
  { id: "E", name: "悠遊卡", svOf: "F", svDate: "2026-10-31", svCat: "c-tr" },
];
const items = [
  tx({ id: "top", type: "topup", amount: 500, date: "2026-11-06", pay: "card", cardId: "E" }),
  tx({ id: "park", type: "expense", amount: 40, date: "2026-11-06", pay: "card", cardId: "E", catId: "c-park", projectId: "P" }),
  tx({ id: "lunch", type: "expense", amount: 100, date: "2026-11-06", pay: "card", cardId: "F", catId: "c-food" }),
];

describe("悠遊卡：加值時算支出", () => {
  it("舊算法不變：消費算支出、加值不算", () => {
    const L = ledger(items, { cards });
    expect(expenseView(L.settings, items).map((t) => t.id)).toEqual(["top", "park", "lunch"]);
    expect(countsAsExpense(L.settings, items[0])).toBe(false);
    expect(countsAsExpense(L.settings, items[1])).toBe(true);
  });

  it("新算法：加值變成刷母卡的支出（類別用 svCat），悠遊卡消費拿掉", () => {
    const L = ledger(items, { cards, svMode: "topup" });
    const v = expenseView(L.settings, items);
    expect(v.map((t) => [t.id, t.type, t.catId, t.cardId, t.amount])).toEqual([
      ["top", "expense", "c-tr", "F", 500],
      ["lunch", "expense", "c-food", "F", 100],
    ]);
    expect(v[0].orig?.type).toBe("topup");
    expect(countsAsExpense(L.settings, items[0])).toBe(true);
    expect(countsAsExpense(L.settings, items[1])).toBe(false);
  });

  it("刷卡金額、悠遊卡餘額兩種算法一樣", () => {
    for (const mode of [undefined, "topup" as const]) {
      const L = ledger(items, { cards, ...(mode ? { svMode: mode } : {}) });
      expect(items.map((t) => chargeCard(L.settings, t)?.id ?? null)).toEqual(["F", null, "F"]);
      expect(svBalance(L, cards[1], "2026-11-06")).toBe(460);
    }
  });

  it("預算：新算法下悠遊卡消費不算專案預算", () => {
    const P = { id: "P", name: "家", budget: 1000 };
    const old = budgetList(ledger(items, { cards, projects: [P] }), "2026-11");
    const nw = budgetList(ledger(items, { cards, projects: [P], svMode: "topup" }), "2026-11");
    expect(old.find((b) => b.key === "P")!.spent).toBe(40);
    expect(nw.find((b) => b.key === "P")!.spent).toBe(0);
    expect(nw.find((b) => b.key === "card:F")!.spent).toBe(600);
  });
});
