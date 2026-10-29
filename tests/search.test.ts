import { describe, expect, it } from "vitest";
import { searchTx } from "../src/core/search";
import type { Ledger } from "../src/core/types";
import { tx } from "./helpers";

const L = (): Ledger => ({
  settings: {
    groups: [{ id: "g", name: "飲食", type: "expense" }],
    categories: [{ id: "c", name: "午餐", groupId: "g", type: "expense" }],
    cards: [{ id: "k", name: "國泰Cube卡" }],
    projects: [{ id: "p", name: "2026東京富士山" }],
  } as unknown as Ledger["settings"],
  months: {
    "2025-12": { items: [tx({ id: "a", date: "2025-12-31", catId: "c", amount: 120, name: "便當" })] },
    "2026-10": {
      items: [
        tx({ id: "b", date: "2026-10-02", time: "08:00", amount: 65, merchant: "7-11", tags: ["早餐"] }),
        tx({ id: "c1", date: "2026-10-02", time: "12:00", catId: "c", amount: 1200, pay: "card", cardId: "k", projectId: "p", note: "拉麵 Ichiran" }),
        tx({ id: "t", type: "transfer", date: "2026-10-03", amount: 120 } as never),
      ],
    },
  },
});
const ids = (q: string) => searchTx(L(), q).map((t) => t.id);

describe("搜尋記錄", () => {
  it("找名稱、商家、標籤、備註、類別、專案、卡片，大小寫不分", () => {
    expect(ids("便當")).toEqual(["a"]);
    expect(ids("7-11")).toEqual(["b"]);
    expect(ids("#早餐")).toEqual(["b"]);
    expect(ids("ichiran")).toEqual(["c1"]);
    expect(ids("午餐")).toEqual(["c1", "a"]);
    expect(ids("飲食")).toEqual(["c1", "a"]);
    expect(ids("富士山")).toEqual(["c1"]);
    expect(ids("cube")).toEqual(["c1"]);
  });
  it("多個關鍵字要全部符合", () => {
    expect(ids("午餐 富士山")).toEqual(["c1"]);
    expect(ids("午餐 7-11")).toEqual([]);
  });
  it("數字找金額相同的記錄，不包含轉帳", () => {
    expect(ids("120")).toEqual(["a"]);
    expect(ids("1200")).toEqual(["c1"]);
  });
  it("由新到舊，空白關鍵字沒有結果", () => {
    expect(ids("")).toEqual([]);
    expect(ids("  ")).toEqual([]);
  });
});
