import type { DateStr, Ledger, Rule, Tx } from "./types";
import { addDays } from "./dates";
import { findCategory, pendingList } from "./ledger";
import { net } from "./money";
import { upcomingReminders } from "./recurrence";

/** 提醒入帳的規則，到期前幾天開始提醒 */
export const REMIND_DAYS = 7;

export type Reminder =
  /** 已到期、還沒確認的待入帳記錄 */
  | { due: true; t: Tx; date: DateStr }
  /** 即將到期的提醒入帳；amt 為 null 表示分期（每期金額不同） */
  | { due: false; rule: Rule; date: DateStr; name: string; amt: number | null };

/** 頁面最上方「入帳提醒」要列出的項目，依日期排序 */
export function remindList(l: Ledger, today: DateStr): Reminder[] {
  const out: Reminder[] = [];
  pendingList(l).forEach((t) => {
    if (t.date <= today) out.push({ due: true, t, date: t.date });
  });
  upcomingReminders(l.settings.recurs, today, addDays(today, REMIND_DAYS)).forEach(({ rule, date }) => {
    const c = findCategory(l.settings, rule.tpl.catId);
    out.push({
      due: false,
      rule,
      date,
      name: rule.tpl.name || (c ? c.name : "未分類"),
      amt: rule.kind === "inst" && rule.plan ? null : net(rule.tpl as Tx),
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 提醒內容的簽章：使用者關掉提醒後，內容有變才會再出現 */
export function reminderSignature(list: Reminder[]): string {
  return list.map((x) => (x.due ? x.t.id : x.rule.id) + x.date).join("|");
}
