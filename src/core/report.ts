/** 報表的期間計算 */
import { pd as parseDate, ymd } from "./dates";

export type ReportMode = "week" | "month" | "year";

/** 期間的起訖日與標題（週從星期一開始） */
export function reportRange(mode: ReportMode, anchor: string): { s: string; e: string; label: string } {
  const a = parseDate(anchor);
  let s: Date, e: Date, label: string;
  if (mode === "week") {
    const off = (a.getDay() + 6) % 7;
    s = new Date(a);
    s.setDate(a.getDate() - off);
    e = new Date(s);
    e.setDate(s.getDate() + 6);
    label = `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`;
  } else if (mode === "year") {
    s = new Date(a.getFullYear(), 0, 1);
    e = new Date(a.getFullYear(), 11, 31);
    label = a.getFullYear() + " 年";
  } else {
    s = new Date(a.getFullYear(), a.getMonth(), 1);
    e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    label = `${a.getFullYear()} 年 ${a.getMonth() + 1} 月`;
  }
  return { s: ymd(s), e: ymd(e), label };
}

/** 上一期／下一期 */
export function shiftAnchor(mode: ReportMode, anchor: string, n: number): string {
  const d = parseDate(anchor);
  if (mode === "week") d.setDate(d.getDate() + 7 * n);
  else if (mode === "year") d.setFullYear(d.getFullYear() + n);
  else {
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
  }
  return ymd(d);
}
