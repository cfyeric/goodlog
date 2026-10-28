import type { Card, Ledger, Settings, Tx } from "../src/core/types";

let n = 0;
export const tx = (p: Partial<Tx>): Tx => ({ id: "t" + n++, type: "expense", date: "2026-10-01", amount: 0, ...p });

export function settings(p: Partial<Settings> = {}): Settings {
  return { categories: [], groups: [], projects: [], cards: [], aliases: [], recurs: [], ...p };
}

export function ledger(items: Tx[], s: Partial<Settings> = {}): Ledger {
  const months: Ledger["months"] = {};
  for (const t of items) (months[t.date.slice(0, 7)] ||= { items: [] }).items.push(t);
  return { settings: settings(s), months };
}

/** 一張信用卡 J，加上掛在 J 底下的悠遊卡 E，和另一張信用卡 C */
export const CARDS: Card[] = [
  { id: "J", name: "富邦J卡" },
  { id: "E", name: "富邦J卡悠遊卡", svOf: "J", svInit: 100, svDate: "2026-10-01" },
  { id: "C", name: "國泰Cube卡" },
];
