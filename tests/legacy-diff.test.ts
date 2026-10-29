/**
 * 新舊版比對：用 scripts/legacy-snapshot.mjs 從舊版網頁算出的結果，
 * 跟新版模組跑同樣輸入的結果逐項比較。任何差異都代表改寫時改變了行為。
 * - fixtures/legacy-synthetic.json：隨機假資料，已提交
 * - fixtures/private/legacy-real.json：真實帳本，只在本機，存在才會跑
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Ledger, Rule } from "../src/core/types";
import { budgetList } from "../src/core/budget";
import { svBalance } from "../src/core/ledger";
import { remindList } from "../src/core/reminders";
import { buildPlan, makeOcc, normRule, recurStart, runRecurs, type PlanOptions } from "../src/core/recurrence";
import { everyText, recurHint, schedText } from "../src/core/recurrenceText";
import { matchStatement, parseDateCell, type StatementItem } from "../src/core/statement";

interface Fixture {
  todays: string[];
  ledger: Ledger;
  statements: { cardId: string; items: StatementItem[]; rejected: number[]; accepted: number[] }[];
  // 舊版輸出的 JSON，結構見 scripts/legacy-snapshot.mjs
  legacy: any;
}

const files = ["fixtures/legacy-synthetic.json", "fixtures/private/legacy-real.json"]
  .map((f) => path.resolve(__dirname, "..", f))
  .filter((f) => fs.existsSync(f));

const clean = <T>(x: T): T => JSON.parse(JSON.stringify(x));

for (const file of files) {
  const F: Fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const L = F.ledger;
  const name = path.basename(file);

  describe(`跟舊版結果一致：${name}`, () => {
    it("預算（每個月）", () => {
      for (const ym of Object.keys(F.legacy.budgets)) {
        const got = budgetList(L, ym).map((b) => ({ key: b.key, kind: b.kind, name: b.name, budget: b.budget, per: b.per, spent: b.spent, pct: b.pct }));
        expect(got, ym).toEqual(F.legacy.budgets[ym]);
      }
    });

    it("儲值卡餘額與入帳提醒（不同的今天）", () => {
      for (const td of F.todays) {
        const sv = (L.settings.cards || []).filter((c) => c.svOf).map((c) => ({ id: c.id, bal: svBalance(L, c, td) }));
        expect(sv, td).toEqual(F.legacy.sv[td]);
        const rm = remindList(L, td).map((x) =>
          x.due ? { due: true, id: x.t.id, date: x.date } : { due: false, rule: x.rule.id, date: x.date, name: x.name, amt: x.amt },
        );
        expect(rm, td).toEqual(F.legacy.remind[td]);
      }
    });

    it("每條規則前 40 期的記錄", () => {
      for (const r of L.settings.recurs as Rule[]) {
        const nr = normRule(clean(r));
        expect(clean(Array.from({ length: 40 }, (_, j) => makeOcc(nr, j))), r.id).toEqual(F.legacy.occ[r.id]);
      }
    });

    it("runRecurs 補上的記錄和 done", () => {
      for (const td of F.todays) {
        const res = runRecurs(clean(L.months), clean(L.settings.recurs), td);
        const added: Record<string, unknown[]> = {};
        for (const k in res.months) {
          const before = L.months[k]?.items.length || 0;
          if (res.months[k].items.length !== before) added[k] = res.months[k].items.slice(before);
        }
        expect(clean(added), td).toEqual(F.legacy.run[td].added);
        expect(res.recurs.map((x) => ({ id: x.id, done: x.done || 0 })), td).toEqual(F.legacy.run[td].recurs);
      }
    });

    it("帳單比對", () => {
      F.statements.forEach((st, i) => {
        const m = matchStatement(L, { items: clean(st.items), cardId: st.cardId, secMap: {}, rejected: new Set(st.rejected), accepted: new Set(st.accepted) });
        const got = m && {
          res: m.res.map((x) => ({ i: x.i, kind: x.kind, tx: x.tx && x.tx.id, diff: x.diff, feeMissing: x.feeMissing, amtDiff: x.amtDiff })),
          extra: m.extra.map((t) => t.id),
          lo: m.lo,
          hi: m.hi,
        };
        expect(clean(got), "帳單 " + i).toEqual(F.legacy.match[i]);
      });
    });

    it("日期解析、分期計畫、文字說明、第一期日期", () => {
      const ds = ["2026/10/27", "115/1/5", "20261027", "10/27", "1/3", "12/30", "2026年2月30日", "abc", "99/13/1", " 2026-10-1 "];
      expect(ds.map((d) => [parseDateCell(d, null, "2026-10-28"), parseDateCell(d, "2027-01-10", "2026-10-28")])).toEqual(F.legacy.misc.dates);
      const plans: [number, PlanOptions][] = [
        [1000, { instN: 3 }], [1000, { instN: 3, remTo: "last", rounding: "ceil" }], [99999, { instN: 24, interest: "annuity", rate: 15, every: 1, unit: "month", rounding: "round" }],
        [50000, { instN: 12, interest: "principal", rate: 6, every: 1, unit: "month" }], [30000, { instN: 6, interest: "fixed", rate: 3, every: 2, unit: "month", fee: 99 }],
        [8000, { instN: 4, interest: "interestFirst", rate: 10, every: 1, unit: "year" }], [1001, { instN: 7, discount: 100, extrasTo: "each", rounding: "floor" }],
      ];
      expect(plans.map(([P, o]) => buildPlan(P, o))).toEqual(F.legacy.misc.plans);
      const rs = L.settings.recurs as Rule[];
      expect(rs.map((x) => [everyText(x), schedText(x), recurHint(x, "2026-10-28")])).toEqual(F.legacy.misc.text);
      expect(rs.map((x) => ["2026-01-31", "2026-02-28", "2026-10-28", "2026-12-31"].map((d) => recurStart(x, d)))).toEqual(F.legacy.misc.starts);
    });
  });
}
