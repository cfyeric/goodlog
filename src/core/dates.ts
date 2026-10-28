import type { DateStr } from "./types";

/** 日期一律用本地時間的 YYYY-MM-DD 字串處理，避免時區造成差一天 */

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymd(d: Date): DateStr {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** 解析 YYYY-MM-DD 或 YYYY-MM（缺日視為 1 號） */
export function pd(s: string): Date {
  const [a, b, c] = s.split("-").map(Number);
  return new Date(a, b - 1, c || 1);
}

/** 兩個日期相差幾天（a − b） */
export function dayDiff(a: DateStr, b: DateStr): number {
  return Math.round((pd(a).getTime() - pd(b).getTime()) / 864e5);
}

export function addDays(ds: DateStr, n: number): DateStr {
  const d = pd(ds);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 加 k 個月；月底日期會夾到該月最後一天（1/31 + 1 個月 = 2/28 或 2/29） */
export function addMonths(ds: DateStr, k: number): DateStr {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(y, m - 1 + k, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return ymd(t);
}

/** 組出某年某月第 d 天，超過月底就用月底 */
export function clampDay(y: number, mo: number, d: number): DateStr {
  const last = new Date(y, mo, 0).getDate();
  return y + "-" + pad(mo) + "-" + pad(Math.min(d, last));
}

/** 該月最後一天是幾號 */
export function daysInMonth(y: number, mo: number): number {
  return new Date(y, mo, 0).getDate();
}
