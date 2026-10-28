import { describe, expect, it } from "vitest";
import { addDays, addMonths, clampDay, dayDiff, pd, ymd } from "../src/core/dates";
import { formatMoney, formatSigned, net, r2 } from "../src/core/money";

describe("dates", () => {
  it("ymd 和 pd 互相轉換，用本地時間", () => {
    expect(ymd(pd("2026-02-28"))).toBe("2026-02-28");
    expect(ymd(pd("2026-10"))).toBe("2026-10-01");
  });
  it("addMonths 月底夾到該月最後一天", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("clampDay、addDays、dayDiff", () => {
    expect(clampDay(2026, 4, 31)).toBe("2026-04-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayDiff("2026-11-01", "2026-10-25")).toBe(7);
    expect(dayDiff("2026-10-25", "2026-11-01")).toBe(-7);
  });
});

describe("money", () => {
  it("net：支出加手續費扣折扣、收入扣手續費、加值就是金額", () => {
    expect(net({ type: "expense", amount: 100, fee: 5, discount: 10 })).toBe(95);
    expect(net({ type: "income", amount: 100, fee: 5 })).toBe(95);
    expect(net({ type: "topup", amount: 500, fee: 9 })).toBe(500);
    expect(net({ type: "expense", amount: 40 })).toBe(40);
  });
  it("r2 與金額格式", () => {
    expect(r2(0.1 + 0.2)).toBe(0.3);
    expect(r2(1.236)).toBe(1.24);
    expect(formatMoney(-1234.5)).toBe("$1,234.5");
    expect(formatSigned(-3)).toBe("−$3");
  });
});
