/**
 * 本機開發用的範例帳本：資料只存在記憶體，重新整理就回到初始狀態。
 * 跟舊版「沒有連上雲端時顯示範例資料」的內容相同。
 */
import type { Months, Settings, Tx } from "../core/types";
import { defaultSettings } from "../core/defaults";
import { uid8 } from "../core/ids";
import { ymd } from "../core/dates";
import type { LedgerSnapshot, LedgerStore } from "./store";

export function demoLedger(today: Date = new Date(), id: () => string = uid8): { settings: Settings; months: Months } {
  const s = defaultSettings(id);
  const c = (n: string) => s.categories.find((x) => x.name === n)!.id;
  const p = s.projects;
  const base = new Date(today.getFullYear(), today.getMonth(), 1);
  const items: Tx[] = [];
  const add = (day: number, cn: string, amount: number, card: boolean, pi: number, extra: Partial<Tx> = {}) => {
    const d = new Date(base);
    d.setDate(day);
    if (d > today) return;
    const t: Tx = { id: id(), type: "expense", catId: c(cn), amount, pay: card ? "card" : "cash", projectId: p[pi].id, date: ymd(d), time: "12:00", ...extra };
    if (t.type === "income") delete t.pay;
    items.push(t);
  };
  add(1, "薪資", 48000, false, 0, { type: "income", time: "09:00" });
  add(1, "咖啡", 65, false, 0, { time: "08:20" });
  add(2, "午餐", 120, false, 0);
  add(3, "電信", 599, true, 0, { merchant: "電信公司" });
  add(4, "食材", 860, true, 1, { merchant: "超市" });
  add(5, "孝親", 5000, false, 1);
  add(5, "捷運公車", 40, false, 0);
  add(6, "晚餐", 280, true, 0);
  add(7, "影音", 290, true, 0, { name: "串流訂閱" });
  add(8, "咖啡", 135, true, 0);
  add(8, "午餐", 95, false, 0);
  return { settings: s, months: { [ymd(base).slice(0, 7)]: { items } } };
}

export function createDemoStore(initial = demoLedger()): LedgerStore {
  let snap: LedgerSnapshot = { settings: initial.settings, months: initial.months, monthsReady: true };
  let emit: (s: LedgerSnapshot) => void = () => {};
  return {
    mode: "demo",
    async start(onChange) {
      emit = onChange;
      emit(snap);
    },
    stop() {},
    writeMonth(key, items) {
      snap = { ...snap, months: { ...snap.months, [key]: { items: items.slice() } } };
      emit(snap);
    },
    async replaceMonth(key, items) {
      snap = { ...snap, months: { ...snap.months, [key]: { items: items.slice() } } };
      emit(snap);
    },
    writeSettings(settings) {
      snap = { ...snap, settings };
      emit(snap);
    },
  };
}
