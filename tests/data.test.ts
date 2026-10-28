import { describe, expect, it } from "vitest";
import { baseOf, diffMonth, mergeMonth } from "../src/data/merge";
import { demoLedger } from "../src/data/demoStore";
import { defaultSettings, migrateSettings } from "../src/core/defaults";
import { tx } from "./helpers";

describe("多裝置合併", () => {
  const a = tx({ id: "a", amount: 1 });
  const b = tx({ id: "b", amount: 2 });
  it("只送出新增、修改、刪除的記錄", () => {
    const base = baseOf([a, b]);
    const d = diffMonth(base, [{ ...a, amount: 9 }, tx({ id: "c" })])!;
    expect(d.up.map((t) => t.id)).toEqual(["a", "c"]);
    expect(d.del).toEqual(["b"]);
    expect(diffMonth(base, [a, b])).toBeNull();
  });
  it("套到雲端最新內容上，保留別台裝置新增的記錄", () => {
    const cloud = [a, b, tx({ id: "other" })];
    expect(mergeMonth(cloud, [{ ...a, amount: 9 }, tx({ id: "c" })], ["b"]).map((t) => [t.id, t.amount])).toEqual([["a", 9], ["other", 0], ["c", 0]]);
  });
});

describe("預設與舊資料轉換", () => {
  it("預設設定有類別和兩個專案", () => {
    const s = defaultSettings();
    expect(s.projects.map((p) => p.name)).toEqual(["個人開銷", "家庭開銷"]);
    expect(s.categories.every((c) => s.groups.some((g) => g.id === c.groupId))).toBe(true);
  });
  it("沒有主類別的舊資料自動補上，從舊帳戶轉出卡片", () => {
    const { settings, changed } = migrateSettings({
      categories: [{ id: "c", name: "午餐", type: "expense", group: "飲食", groupId: "" }],
      accounts: [{ id: "a1", name: "國泰卡" }, { id: "a2", name: "信用卡" }],
    } as never);
    expect(changed).toBe(true);
    expect(settings.groups[0]).toMatchObject({ name: "飲食", type: "expense" });
    expect(settings.cards).toEqual([{ id: "a1", name: "國泰卡" }]);
    expect(settings.recurs).toEqual([]);
  });
  it("範例資料只放今天以前的記錄", () => {
    const d = demoLedger(new Date(2026, 9, 3));
    const items = Object.values(d.months)[0].items;
    expect(items.every((t) => t.date <= "2026-10-03")).toBe(true);
    expect(items.length).toBe(4);
  });
});
