import type { Budget, Card, Ledger, MonthKey, Project } from "./types";
import { cardOf, chargeCard, isSvTx, payOf } from "./ledger";
import { net, r2 } from "./money";

/** 花到預算的這個比例時開始提醒 */
export const BUDGET_WARN = 0.8;

export type BudgetKind = "acc" | "pay" | "proj";

export interface BudgetStatus {
  /** cash、cardall、card:<卡片 id>，或專案 id */
  key: string;
  /** acc：帳戶（現金、單張卡）；pay：全部信用卡；proj：專案 */
  kind: BudgetKind;
  obj: Card | Project | null;
  name: string;
  budget: number;
  per: "month" | "total";
  spent: number;
  /** spent / budget */
  pct: number;
}

/**
 * 所有有設定預算的項目，以及花了多少。
 * - 每月預算只算 ym 這個月；總計預算算全部月份
 * - 現金、單張卡、專案算消費淨額
 * - 儲值卡的消費算在儲值卡本身，不算進信用卡和「全部信用卡」
 * - 加值算進所屬信用卡和「全部信用卡」
 * - 待入帳不算
 */
export function budgetList(l: Ledger, ym: MonthKey): BudgetStatus[] {
  const s = l.settings;
  const out: Omit<BudgetStatus, "spent" | "pct">[] = [];
  const add = (key: string, kind: BudgetKind, obj: Card | Project | null, name: string, b?: Budget) => {
    if (!b || !(+(b.budget ?? 0) > 0)) return;
    out.push({ key, kind, obj, name, budget: +(b.budget as number), per: b.bper === "total" ? "total" : "month" });
  };
  add("cash", "acc", null, "現金", s.cashBudget);
  add("cardall", "pay", null, "全部信用卡", s.cardBudget);
  (s.cards || []).filter((c) => !c.archived).forEach((c) => add("card:" + c.id, "acc", c, c.name, c));
  (s.projects || []).filter((p) => !p.archived).forEach((p) => add(p.id, "proj", p, p.name, p));
  if (!out.length) return [];

  const sp: Record<string, number> = {};
  out.forEach((b) => (sp[b.key + "|" + b.per] = 0));
  for (const k in l.months) {
    const inM = k === ym;
    for (const t of l.months[k].items || []) {
      if (t.pending) continue;
      let v = 0;
      const keys: string[] = [];
      if (t.type === "expense") {
        v = net(t);
        keys.push(t.projectId || "");
        if (payOf(s, t) === "cash") keys.push("cash");
        else if (isSvTx(s, t)) keys.push("card:" + (cardOf(s, t) as Card).id);
        else keys.push("card:" + (cardOf(s, t)?.id || ""), "cardall");
      } else if (t.type === "topup") {
        v = +t.amount || 0;
        const pc = chargeCard(s, t);
        if (pc && pc.id) keys.push("card:" + pc.id);
        keys.push("cardall");
      } else continue;
      for (const key of keys) {
        if (!key) continue;
        if (sp[key + "|total"] !== undefined) sp[key + "|total"] += v;
        if (inM && sp[key + "|month"] !== undefined) sp[key + "|month"] += v;
      }
    }
  }
  return out.map((b) => {
    const spent = r2(sp[b.key + "|" + b.per]);
    return { ...b, spent, pct: spent / b.budget };
  });
}

/** 日曆下方要提醒的預算（已達 BUDGET_WARN），使用比例高的排前面 */
export function budgetAlerts(l: Ledger, ym: MonthKey): BudgetStatus[] {
  return budgetList(l, ym)
    .filter((b) => b.pct >= BUDGET_WARN)
    .sort((a, b) => b.pct - a.pct);
}
