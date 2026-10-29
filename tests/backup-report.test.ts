import { describe, expect, it } from "vitest";
import { backupJSON, exportCSV, parseBackup, restoreMonths } from "../src/core/backup";
import { hash53, mozeAnalyze, mozeCommit } from "../src/core/moze";
import { reportRange, shiftAnchor } from "../src/core/report";
import { parseCSV } from "../src/core/statement";
import type { Ledger } from "../src/core/types";

const L = (): Ledger => ({
  settings: {
    groups: [{ id: "g1", name: "飲食", type: "expense", color: "#dc2626" }],
    categories: [{ id: "c1", name: "午餐", groupId: "g1", group: "飲食", type: "expense" }],
    cards: [{ id: "k1", name: "國泰Cube卡" }],
    projects: [],
  } as unknown as Ledger["settings"],
  months: {
    "2026-10": { items: [{ id: "x1", type: "expense", catId: "c1", amount: 100, date: "2026-10-02", pay: "card", cardId: "k1", name: "便當, 大" } as never] },
    "2026-11": { items: [] },
  },
});

describe("報表期間", () => {
  it("週從星期一開始", () => {
    expect(reportRange("week", "2026-10-28")).toEqual({ s: "2026-10-26", e: "2026-11-01", label: "10/26 – 11/1" });
  });
  it("月、年", () => {
    expect(reportRange("month", "2026-02-10")).toEqual({ s: "2026-02-01", e: "2026-02-28", label: "2026 年 2 月" });
    expect(reportRange("year", "2026-02-10").e).toBe("2026-12-31");
  });
  it("月底換月不會跳過月份", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("week", "2026-10-28", -1)).toBe("2026-10-21");
  });
});

describe("備份與還原", () => {
  it("備份格式代號維持 ririzhang，略過空月份", () => {
    const b = JSON.parse(backupJSON(L(), new Date("2026-10-28T00:00:00Z")));
    expect(b.app).toBe("ririzhang");
    expect(b.format).toBe(1);
    expect(Object.keys(b.months)).toEqual(["2026-10"]);
  });
  it("不是備份檔就拒絕", () => {
    expect(parseBackup("{}")).toBeNull();
    expect(parseBackup("not json")).toBeNull();
    const p = parseBackup(backupJSON(L()))!;
    expect(p.n).toBe(1);
    expect(p.m).toBe(1);
  });
  it("還原時清掉備份裡沒有的月份", () => {
    const cur = { "2026-09": { items: [{ id: "z" } as never] }, "2026-10": { items: [] } };
    const p = parseBackup(backupJSON(L()))!;
    expect(restoreMonths(cur, p.data)).toEqual({ "2026-09": [], "2026-10": p.data.months["2026-10"].items });
  });
  it("CSV 有 BOM、逗號欄位加引號", () => {
    const c = exportCSV(L());
    expect(c.startsWith("﻿日期,")).toBe(true);
    expect(c).toContain('"便當, 大"');
    expect(c).toContain(",信用卡,國泰Cube卡,");
  });
});

describe("MOZE 匯入", () => {
  it("hash53 跟舊版相同（重複匯入才認得出來）", () => {
    expect(hash53("abc")).toBe("1dtlchkfkb1");
    expect(hash53("現金\u0001TWD\u0001支出#1")).toBe("24syi7ju9n0");
  });
  const csv = "帳戶,幣種,記錄類型,主類別,子類別,金額,手續費,折扣,名稱,商家,日期,時間,專案,描述,標籤,對象\n現金,TWD,支出,飲食,午餐,-120,0,0,便當,,2026/10/3,9:05,,,#午餐,不限定對象\n寵物店卡,TWD,支出,寵物,飼料,-800,0,0,,,2026/10/8,,,,,\n銀行,TWD,轉出,信用卡繳款,,-3000,0,0,,,2026/10/6,,,,,\n國泰Cube卡,TWD,紅利回饋,,,30,0,0,,,2026/10/7,,,,,\n";
  let n = 0;
  const id = () => "n" + ++n;
  it("對應現有類別、新增缺少的、略過轉帳", () => {
    const { plan, err } = mozeAnalyze(L(), parseCSV(csv), { optReward: true, optRecv: false }, id);
    expect(err).toBe("");
    expect(plan!.items.map((t) => t.catId)[0]).toBe("c1");
    expect(plan!.items[0].time).toBe("09:05");
    expect(plan!.items[0].tags).toEqual(["午餐"]);
    expect(plan!.add.cards.map((c) => c.name)).toEqual(["寵物店卡"]);
    expect(plan!.skip).toEqual({ 信用卡繳款: 1 });
    expect(plan!.items.length).toBe(3);
    const after = mozeCommit(L(), plan!);
    const l2 = { settings: after.settings, months: { ...L().months, ...Object.fromEntries(Object.entries(after.months).map(([k, v]) => [k, { items: v }])) } };
    const again = mozeAnalyze(l2, parseCSV(csv), { optReward: true, optRecv: false }, id);
    expect(again.plan!.dup).toBe(3);
    expect(again.plan!.items.length).toBe(0);
  });
  it("不是 MOZE 檔案", () => {
    expect(mozeAnalyze(L(), [["a", "b"]], { optReward: true, optRecv: false }, id).err).toContain("不是 MOZE");
  });
});

describe("MOZE 匯入：轉到儲蓄帳戶", () => {
  const csv =
    "帳戶,幣種,記錄類型,主類別,子類別,金額,手續費,折扣,名稱,商家,日期,時間,專案,描述,標籤,對象\n" +
    "薪轉帳戶,TWD,轉出,轉帳,,-5000,0,0,每月存款,,2026/10/5,09:00,,,,\n" +
    "儲蓄帳戶,TWD,轉入,轉帳,,5000,0,0,每月存款,,2026/10/5,09:00,,,,\n" +
    "薪轉帳戶,TWD,轉出,轉帳,,-1000,0,0,,,2026/10/6,,,,,\n" +
    "錢包,TWD,轉入,轉帳,,1000,0,0,,,2026/10/6,,,,,\n" +
    "薪轉帳戶,TWD,轉出,信用卡繳款,,-3000,0,0,,,2026/10/7,,,,,\n" +
    "國泰Cube卡,TWD,轉入,信用卡繳款,,3000,0,0,,,2026/10/7,,,,,\n" +
    "現金,TWD,支出,飲食,午餐,-120,0,0,便當,,2026/10/3,12:10,,,,\n";
  let k = 0;
  const id = () => "m" + ++k;
  it("列出有轉入的帳戶（不含信用卡繳款），沒選就不匯入", () => {
    const { plan } = mozeAnalyze(L(), parseCSV(csv), { optReward: true, optRecv: false }, id);
    expect(plan!.xferAccs).toEqual({ 儲蓄帳戶: 1, 錢包: 1 });
    expect(plan!.items.filter((t) => t.type === "transfer")).toEqual([]);
  });
  it("選了儲蓄帳戶：匯入成轉帳，記下從哪個帳戶轉來；一般支出的 id 不變", () => {
    const before = mozeAnalyze(L(), parseCSV(csv), { optReward: true, optRecv: false }, id).plan!.items.find((t) => t.type === "expense")!.id;
    const { plan } = mozeAnalyze(L(), parseCSV(csv), { optReward: true, optRecv: false, saveAccs: ["儲蓄帳戶"] }, id);
    const tr = plan!.items.filter((t) => t.type === "transfer");
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ amount: 5000, date: "2026-10-05", time: "09:00", toAcc: "儲蓄帳戶", fromAcc: "薪轉帳戶", name: "每月存款", src: "moze" });
    expect(plan!.items.find((t) => t.type === "expense")!.id).toBe(before);
    expect(plan!.cnt["轉到儲蓄帳戶"]).toBe(1);
  });
});
