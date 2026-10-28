import { describe, expect, it } from "vitest";
import { buildItems, findCloseDate, guessHeader, guessMap, initSecMap, matchStatement, parseAmountCell, parseCSV, parseDateCell } from "../src/core/statement";
import { aliasKey, findAlias, learnAlias } from "../src/core/alias";
import { CARDS, ledger, settings, tx } from "./helpers";

const T = "2026-10-28";

describe("儲存格解析", () => {
  it("日期：西元、民國、無分隔、只有月日", () => {
    expect(parseDateCell("2026/10/27", null, T)).toBe("2026-10-27");
    expect(parseDateCell("115/10/27", null, T)).toBe("2026-10-27");
    expect(parseDateCell("2026年1月5日", null, T)).toBe("2026-01-05");
    expect(parseDateCell("20261027", null, T)).toBe("2026-10-27");
    expect(parseDateCell("12/30", "2027-01-10", T)).toBe("2026-12-30");
    expect(parseDateCell("01/03", "2027-01-10", T)).toBe("2027-01-03");
    expect(parseDateCell("交易日", null, T)).toBeNull();
  });
  it("金額：千分位、括號負數、尾端負號", () => {
    expect(parseAmountCell("1,234")).toBe(1234);
    expect(parseAmountCell("(500)")).toBe(-500);
    expect(parseAmountCell("500-")).toBe(-500);
    expect(parseAmountCell("")).toBeNull();
  });
  it("CSV：引號、逗號、TSV 自動判斷", () => {
    expect(parseCSV('a,"b,c","d""e"\n\n1,2,3')).toEqual([["a", "b,c", 'd"e'], ["1", "2", "3"]]);
    expect(parseCSV("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("帳單明細", () => {
  const rows = parseCSV(
    [
      "本期結帳日,2026/10/25",
      "",
      "消費日,入帳日,消費明細,新臺幣金額",
      "卡號末四碼 0489,,,",
      "10/01,10/02,ＣＡＭＡ台鐵松山店,110",
      "10/03,10/04,UBER *TRIP,350",
      "10/03,10/04,國外交易手續費-UBER,5",
      "10/05,10/05,本期繳款,-3000",
      "10/06,10/07,退款 某商店,-120",
    ].join("\n"),
  );
  const ref = findCloseDate(rows, T);
  const hi = guessHeader(rows, ref, T);
  const map = guessMap(rows[hi]);
  const b = buildItems(rows, hi, map, ref, T);
  it("找到結帳日、表頭和欄位", () => {
    expect(ref).toBe("2026-10-25");
    expect(rows[hi][0]).toBe("消費日");
    expect(map).toEqual({ date: 0, desc: 2, amount: 3 });
  });
  it("全形字轉半形、手續費併進同一筆、略過繳款、保留退款", () => {
    expect(b.items).toEqual([
      { date: "2026-10-01", desc: "CAMA台鐵松山店", amount: 110, sec: "卡號末四碼 0489" },
      { date: "2026-10-03", desc: "UBER *TRIP", amount: 355, fee: 5, sec: "卡號末四碼 0489" },
      { date: "2026-10-06", desc: "退款 某商店", amount: -120, sec: "卡號末四碼 0489" },
    ]);
    expect(b.pays).toBe(1);
    expect(b.secs).toEqual(["卡號末四碼 0489"]);
  });
  it("卡片區段預設用記住的對應", () => {
    expect(initSecMap(settings({ stmtSec: { a: "C" } }), ["a", "b"], "J")).toEqual({ a: "C", b: "J" });
  });
});

describe("帳單比對", () => {
  const l = ledger(
    [
      tx({ id: "m1", date: "2026-10-01", pay: "card", cardId: "C", amount: 110 }),
      tx({ id: "m2", date: "2026-10-08", pay: "card", cardId: "C", amount: 350 }),
      tx({ id: "m3", date: "2026-10-10", pay: "card", cardId: "C", amount: 1000 }),
      tx({ id: "m4", date: "2026-10-12", pay: "card", cardId: "C", amount: 77 }),
      tx({ id: "m5", date: "2026-10-12", pay: "card", cardId: "J", amount: 88 }),
      tx({ id: "m6", date: "2026-10-13", pay: "card", cardId: "E", amount: 40 }),
      tx({ id: "m7", date: "2026-10-14", type: "topup", pay: "card", cardId: "E", amount: 500 }),
    ],
    { cards: CARDS },
  );
  const items = [
    { date: "2026-10-01", desc: "A", amount: 110, sec: "" },
    { date: "2026-10-03", desc: "B", amount: 355, fee: 5, sec: "" },
    { date: "2026-10-11", desc: "C", amount: 1030, sec: "" },
    { date: "2026-10-15", desc: "D", amount: 999, sec: "" },
    { date: "2026-10-15", desc: "E", amount: -50, sec: "" },
  ];
  it("同卡比對：符合、扣手續費 5 天內待確認、匯率差待確認、漏記、退款", () => {
    const m = matchStatement(l, { items, cardId: "C", rejected: new Set(), accepted: new Set() })!;
    expect(m.res.map((r) => [r.kind, r.tx?.id ?? null])).toEqual([["ok", "m1"], ["maybe", "m2"], ["maybe", "m3"], ["missing", null], ["refund", null]]);
    expect(m.res[1].feeMissing).toBe(5);
    expect(m.res[2].amtDiff).toBe(30);
    expect(m.extra.map((t) => t.id)).toEqual(["m4"]);
  });
  it("拒絕過的不再用寬鬆條件配對；確認過的算符合", () => {
    const m = matchStatement(l, { items, cardId: "C", rejected: new Set([1]), accepted: new Set([2]) })!;
    expect(m.res[1].kind).toBe("missing");
    expect(m.res[2].kind).toBe("ok");
  });
  it("加值算在信用卡帳單上，悠遊卡消費不算", () => {
    const m = matchStatement(l, { items: [{ date: "2026-10-11", desc: "X", amount: 1, sec: "" }, { date: "2026-10-14", desc: "悠遊卡自動加值", amount: 500, sec: "" }], cardId: "J", rejected: new Set(), accepted: new Set() })!;
    expect(m.res[1].tx?.id).toBe("m7");
    expect(m.extra.map((t) => t.id)).toEqual(["m5"]);
  });
});

describe("商家對照", () => {
  it("key 去掉數字和標點", () => expect(aliasKey("UBER *TRIP 1234")).toBe("UBER TRIP"));
  it("學起來、找得到、沒變化回傳 null", () => {
    const s = settings();
    const a = learnAlias(s, "UBER *TRIP", { catId: "c1", name: "", merchant: "Uber" }, "x")!;
    expect(a).toHaveLength(1);
    const s2 = settings({ aliases: a });
    expect(findAlias(s2, "uber trip 99")?.catId).toBe("c1");
    expect(learnAlias(s2, "UBER *TRIP", { catId: "c1", merchant: "Uber" }, "y")).toBeNull();
  });
});
