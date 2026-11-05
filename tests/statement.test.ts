import { describe, expect, it } from "vitest";
import { buildItems, findCloseDate, guessHeader, guessMap, initSecMap, markNext, matchStatement, mergeGroup, parseAmountCell, parseCSV, parseDateCell, reconcile, stmtKey } from "../src/core/statement";
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

describe("帳單比對：多筆、手動對應、已對帳、下期入帳", () => {
  const C = (p: Partial<Parameters<typeof tx>[0]>) => tx({ pay: "card", cardId: "C", ...p });
  const it0 = (date: string, amount: number, desc = "X") => ({ date, desc, amount, sec: "" });
  const base = { cardId: "C", rejected: new Set<number>(), accepted: new Set<number>() };

  it("多筆群組拿整組合計比對", () => {
    const l = ledger([C({ id: "a", date: "2026-08-26", amount: 9350, grp: "g" }), C({ id: "b", date: "2026-08-26", amount: 2230, grp: "g" }), C({ id: "c", date: "2026-08-26", amount: 2040, grp: "g" })], { cards: CARDS });
    const m = matchStatement(l, { ...base, items: [it0("2026-08-27", 13620, "RAPHA")] })!;
    expect(m.res[0].kind).toBe("ok");
    expect(m.res[0].via).toBe("group");
    expect(m.res[0].txs!.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(m.extra).toEqual([]);
  });

  it("沒有群組時：找同一天幾筆加起來等於帳單金額，列為建議，仍算漏記", () => {
    const l = ledger([C({ id: "a", date: "2026-08-26", amount: 9350 }), C({ id: "b", date: "2026-08-26", amount: 2230 }), C({ id: "c", date: "2026-08-26", amount: 2040 }), C({ id: "d", date: "2026-08-26", amount: 154 })], { cards: CARDS });
    const m = matchStatement(l, { ...base, items: [it0("2026-08-27", 13620)] })!;
    expect(m.res[0].kind).toBe("missing");
    expect(m.res[0].combo!.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    const m2 = matchStatement(l, { ...base, items: [it0("2026-08-27", 13620)], noCombo: new Set([0]) })!;
    expect(m2.res[0].combo).toBeUndefined();
  });

  it("把幾筆合成群組後，下次直接對上", () => {
    const l = ledger([C({ id: "a", date: "2026-08-26", amount: 100, time: "19:57", merchant: "Rapha" }), C({ id: "b", date: "2026-08-26", amount: 50, time: "20:10" })], { cards: CARDS });
    const ch = mergeGroup(l, l.months["2026-08"].items, "g1");
    expect(ch["2026-08"].map((t) => [t.grp, t.time, t.merchant])).toEqual([
      ["g1", "19:57", "Rapha"],
      ["g1", "19:57", "Rapha"],
    ]);
    const l2 = { ...l, months: { "2026-08": { items: ch["2026-08"] } } };
    expect(matchStatement(l2, { ...base, items: [it0("2026-08-26", 150)] })!.res[0].via).toBe("group");
  });

  it("手動對應：金額、日期差很多也算對上", () => {
    const l = ledger([C({ id: "a", date: "2026-08-01", amount: 500 })], { cards: CARDS });
    const m = matchStatement(l, { ...base, items: [it0("2026-08-20", 530), it0("2026-08-25", 10)], links: { 0: ["a"] } })!;
    expect([m.res[0].kind, m.res[0].tx?.id, m.res[0].via]).toEqual(["ok", "a", "link"]);
  });

  it("完成對帳記下 rc；重新匯入同一份照樣對上，別份帳單不再拿來比", () => {
    const l = ledger([C({ id: "a", date: "2026-08-10", amount: 300 })], { cards: CARDS });
    const items = [it0("2026-08-10", 300), it0("2026-08-20", 20)];
    const key = stmtKey("C", items);
    const m = matchStatement(l, { ...base, items, key })!;
    const rc = reconcile(l, key, m.res);
    expect(rc.n).toBe(1);
    expect(rc.months["2026-08"][0].rc).toBe(key + "#0");
    const l2 = { ...l, months: { "2026-08": { items: rc.months["2026-08"] } } };
    expect(matchStatement(l2, { ...base, items, key })!.res[0].via).toBe("rc");
    const other = [it0("2026-08-10", 300), it0("2026-08-12", 5)];
    const m3 = matchStatement(l2, { ...base, items: other, key: stmtKey("C", other) })!;
    expect(m3.res[0].kind).toBe("missing");
  });

  it("下期入帳：不在這期列表；下一期不管日期多早都會拿來比", () => {
    const l = ledger([C({ id: "a", date: "2026-08-28", amount: 90 })], { cards: CARDS });
    const aug = [it0("2026-08-01", 10), it0("2026-08-29", 20)];
    expect(matchStatement(l, { ...base, items: aug, key: stmtKey("C", aug) })!.extra.map((t) => t.id)).toEqual(["a"]);
    const ch = markNext(l, l.months["2026-08"].items[0], true);
    const l2 = { ...l, months: { "2026-08": { items: ch["2026-08"] } } };
    const m = matchStatement(l2, { ...base, items: aug, key: stmtKey("C", aug) })!;
    expect(m.extra).toEqual([]);
    expect(m.carried.map((t) => t.id)).toEqual(["a"]);
    const oct = [it0("2026-10-01", 50), it0("2026-10-15", 90)];
    const m2 = matchStatement(l2, { ...base, items: oct, key: stmtKey("C", oct), links: { 1: ["a"] } })!;
    expect(m2.res[1].tx?.id).toBe("a");
  });
});
