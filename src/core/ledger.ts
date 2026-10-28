import type { Card, Category, DateStr, Group, Ledger, PayMethod, Project, Settings, Tx } from "./types";
import { net, r2 } from "./money";

/* ---------- 查找 ---------- */

export const findCard = (s: Settings, id?: string | null): Card | undefined =>
  id ? (s.cards || []).find((c) => c.id === id) : undefined;
export const findProject = (s: Settings, id?: string | null): Project | undefined =>
  id ? (s.projects || []).find((p) => p.id === id) : undefined;
export const findCategory = (s: Settings, id?: string | null): Category | undefined =>
  id ? (s.categories || []).find((c) => c.id === id) : undefined;
export const findGroup = (s: Settings, id?: string | null): Group | undefined =>
  id ? (s.groups || []).find((g) => g.id === id) : undefined;

/* ---------- 記錄集合 ---------- */

/** 所有「算數」的記錄：排除轉帳和還沒確認的待入帳（加值會包含在內） */
export function allTx(l: Ledger): Tx[] {
  const out: Tx[] = [];
  for (const k in l.months) for (const t of l.months[k].items || []) if (t.type !== "transfer" && !t.pending) out.push(t);
  return out;
}

/** 某一天的記錄，依時間排序 */
export function txOfDay(l: Ledger, date: DateStr): Tx[] {
  return ((l.months[date.slice(0, 7)] || { items: [] }).items || [])
    .filter((t) => t.date === date && t.type !== "transfer" && !t.pending)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

/** 所有待入帳記錄，依日期排序 */
export function pendingList(l: Ledger): Tx[] {
  const out: Tx[] = [];
  for (const k in l.months) for (const t of l.months[k].items || []) if (t.pending) out.push(t);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- 付款方式 ---------- */

/** 付款方式；舊資料沒有 pay 欄位時，看 accountId 對到的帳戶名稱有沒有「卡」 */
export function payOf(s: Settings, t: Tx): PayMethod {
  if (t.pay === "card" || t.pay === "cash") return t.pay;
  const a = t.accountId ? (s.accounts || []).find((x) => x.id === t.accountId) : undefined;
  return a && /卡|信用|card/i.test(a.name) ? "card" : "cash";
}

/** 這筆記錄用的卡片（含舊資料的 accountId） */
export function cardOf(s: Settings, t: Tx): Card | null {
  if (t.cardId) return findCard(s, t.cardId) || null;
  return t.accountId ? findCard(s, t.accountId) || null : null;
}

/* ---------- 儲值卡（悠遊卡） ----------
 * 儲值卡掛在某張信用卡底下（card.svOf = 信用卡 id）。
 * - 用儲值卡付的消費：算支出，但不算信用卡的刷卡金額
 * - 加值（type: "topup"）：算信用卡的刷卡金額，但不算支出
 */

/** 儲值卡所屬的信用卡；不是儲值卡就回傳 null */
export function svParent(s: Settings, c: Card | null | undefined): Card | null {
  return c && c.svOf ? findCard(s, c.svOf) || null : null;
}

/** 是不是用儲值卡付的消費 */
export function isSvTx(s: Settings, t: Tx): boolean {
  return t.type === "expense" && payOf(s, t) === "card" && !!svParent(s, cardOf(s, t));
}

/**
 * 這筆記錄會出現在哪張信用卡的帳單上（刷卡金額算給誰）。
 * 回傳 null 表示不算刷卡；回傳 { id: "" } 表示刷卡但沒指定卡片。
 */
export function chargeCard(s: Settings, t: Tx): Card | { id: "" } | null {
  if (t.pending) return null;
  if (t.type === "topup") {
    const c = cardOf(s, t);
    return svParent(s, c) || c || { id: "" };
  }
  if (t.type === "expense" && payOf(s, t) === "card" && !isSvTx(s, t)) return cardOf(s, t) || { id: "" };
  return null;
}

/** 刷卡金額：加值算金額本身，消費算淨額 */
export function chargeAmount(t: Tx): number {
  return t.type === "topup" ? +t.amount || 0 : net(t);
}

/**
 * 儲值卡推算餘額：從使用者填餘額的那天（svDate）之後開始，
 * 加上加值、扣掉用這張卡付的消費；今天之後的記錄不算。
 */
export function svBalance(l: Ledger, c: Card, today: DateStr): number {
  let b = +(c.svInit ?? 0) || 0;
  const d0 = c.svDate || "";
  for (const k in l.months)
    for (const t of l.months[k].items || []) {
      if (t.pending || t.cardId !== c.id || t.date <= d0 || t.date > today) continue;
      if (t.type === "topup") b += +t.amount || 0;
      else if (t.type === "expense" && payOf(l.settings, t) === "card") b -= net(t);
    }
  return r2(b);
}

/** 某張信用卡底下的儲值卡 */
export function svChildOf(s: Settings, c: Card): Card | null {
  return (s.cards || []).find((x) => x.svOf === c.id) || null;
}
