import { describe, expect, it } from "vitest";
import { newDraft } from "../src/core/editor";
import { CARDS, ledger, tx } from "./helpers";

const open = (items: Parameters<typeof ledger>[0]) =>
  newDraft(ledger(items, { cards: CARDS }), null, { date: "2026-10-31", now: new Date(2026, 9, 31, 17, 0), id: "new" }).t;

describe("記一筆的預設付款方式", () => {
  it("沿用自己記的最後一筆", () => {
    expect(open([tx({ date: "2026-10-30", time: "09:00", pay: "card", cardId: "C" }), tx({ date: "2026-10-31", time: "08:00", pay: "cash" })]).pay).toBe("cash");
  });

  it("週期、分期自動產生的、還沒入帳的、未來日期的信用卡記錄不影響預設", () => {
    const t = open([
      tx({ date: "2026-10-30", time: "09:00", pay: "cash" }),
      tx({ date: "2026-10-31", time: "10:00", pay: "card", cardId: "J", rec: { id: "r", i: 3 } }),
      tx({ date: "2026-10-31", time: "11:00", pay: "card", cardId: "J", inst: { id: "i", i: 2, n: 6 } }),
      tx({ date: "2026-10-31", time: "12:00", pay: "card", cardId: "J", pending: true }),
      tx({ date: "2026-11-05", time: "10:00", pay: "card", cardId: "J" }),
    ]);
    expect(t.pay).toBe("cash");
  });

  it("切到信用卡時預設最後自己刷的那張卡", () => {
    const t = open([tx({ date: "2026-10-20", pay: "card", cardId: "C" }), tx({ date: "2026-10-31", pay: "card", cardId: "J", rec: { id: "r", i: 1 } })]);
    expect(t.cardId).toBe("C");
  });
});
