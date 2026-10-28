import { describe, expect, it } from "vitest";
import { allTx, chargeCard, isSvTx, payOf, pendingList, svBalance, txOfDay } from "../src/core/ledger";
import { CARDS, ledger, settings, tx } from "./helpers";

describe("付款方式", () => {
  it("沒有 pay 的舊資料看帳戶名稱", () => {
    const s = settings({ accounts: [{ id: "a1", name: "信用卡" }, { id: "a2", name: "錢包" }] });
    expect(payOf(s, tx({ accountId: "a1" }))).toBe("card");
    expect(payOf(s, tx({ accountId: "a2" }))).toBe("cash");
    expect(payOf(s, tx({ pay: "card", accountId: "a2" }))).toBe("card");
  });
});

describe("儲值卡", () => {
  const s = settings({ cards: CARDS });
  it("用悠遊卡付的消費是儲值卡消費，不算信用卡刷卡", () => {
    const t = tx({ pay: "card", cardId: "E", amount: 40 });
    expect(isSvTx(s, t)).toBe(true);
    expect(chargeCard(s, t)).toBeNull();
  });
  it("加值算在所屬信用卡", () => {
    expect(chargeCard(s, tx({ type: "topup", cardId: "E", amount: 500, pay: "card" }))?.id).toBe("J");
  });
  it("一般刷卡算在該卡；沒指定卡片回傳空 id；現金不算", () => {
    expect(chargeCard(s, tx({ pay: "card", cardId: "C" }))?.id).toBe("C");
    expect(chargeCard(s, tx({ pay: "card" }))).toEqual({ id: "" });
    expect(chargeCard(s, tx({ pay: "cash" }))).toBeNull();
    expect(chargeCard(s, tx({ pay: "card", cardId: "C", pending: true }))).toBeNull();
  });
  it("餘額從填寫日之後起算，今天之後不算", () => {
    const l = ledger(
      [
        tx({ date: "2026-10-01", type: "topup", cardId: "E", amount: 999 }), // 填寫當天，不算
        tx({ date: "2026-10-02", type: "topup", cardId: "E", amount: 500 }),
        tx({ date: "2026-10-03", pay: "card", cardId: "E", amount: 40 }),
        tx({ date: "2026-10-04", pay: "card", cardId: "E", amount: 40, pending: true }),
        tx({ date: "2026-10-30", pay: "card", cardId: "E", amount: 40 }), // 未來
      ],
      { cards: CARDS },
    );
    expect(svBalance(l, CARDS[1], "2026-10-20")).toBe(560);
  });
});

describe("記錄集合", () => {
  const l = ledger([
    tx({ id: "a", date: "2026-10-05", time: "12:00" }),
    tx({ id: "b", date: "2026-10-05", time: "08:00" }),
    tx({ id: "c", date: "2026-10-05", pending: true }),
    tx({ id: "d", date: "2026-10-06", type: "transfer" }),
  ]);
  it("排除待入帳和轉帳，當天依時間排序", () => {
    expect(allTx(l).map((t) => t.id)).toEqual(["a", "b"]);
    expect(txOfDay(l, "2026-10-05").map((t) => t.id)).toEqual(["b", "a"]);
    expect(pendingList(l).map((t) => t.id)).toEqual(["c"]);
  });
});
