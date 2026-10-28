/** 備份、還原、匯出 CSV */
import type { Ledger, Months, Settings } from "./types";
import { cardOf, findCategory, findGroup, findProject, payOf } from "./ledger";
import { net } from "./money";
import { pad, ymd } from "./dates";

/** 備份檔格式辨識用的代號（舊名稱，不要改，否則舊備份還原不了） */
export const BACKUP_APP = "ririzhang";

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  exportedAt: string;
  settings: Settings;
  months: Months;
}

/** 檔名用的時間戳記：20261028-2235 */
export function stamp(now: Date = new Date()): string {
  return ymd(now).replace(/-/g, "") + "-" + pad(now.getHours()) + pad(now.getMinutes());
}

/** 完整備份（略過沒有記錄的月份） */
export function backupJSON(l: Ledger, now: Date = new Date()): string {
  const months: Months = {};
  Object.keys(l.months)
    .sort()
    .forEach((k) => {
      const it = l.months[k].items || [];
      if (it.length) months[k] = { items: it };
    });
  return JSON.stringify({ app: BACKUP_APP, format: 1, exportedAt: now.toISOString(), settings: l.settings, months });
}

export interface RestorePreview {
  data: BackupFile;
  /** 記錄筆數 */
  n: number;
  /** 月份數 */
  m: number;
  /** 備份日期 */
  when: string;
}

/** 讀備份檔；不是好記的備份檔回傳 null */
export function parseBackup(txt: string): RestorePreview | null {
  let b: BackupFile;
  try {
    b = JSON.parse(txt);
  } catch {
    return null;
  }
  if (!b || b.app !== BACKUP_APP || !b.settings || typeof b.months !== "object") return null;
  let n = 0;
  for (const k in b.months) n += (b.months[k]?.items || []).length;
  return { data: b, n, m: Object.keys(b.months).length, when: b.exportedAt ? ymd(new Date(b.exportedAt)) : "" };
}

/** 還原時要寫入的月份：備份裡的月份，加上目前有記錄但備份沒有的月份（清空） */
export function restoreMonths(cur: Months, b: BackupFile): Record<string, import("./types").Tx[]> {
  const out: Record<string, import("./types").Tx[]> = {};
  const keys = new Set(Object.keys(cur).concat(Object.keys(b.months || {})));
  keys.forEach((k) => {
    const it = b.months?.[k]?.items || [];
    if (!it.length && !(cur[k] && cur[k].items.length)) return;
    out[k] = it;
  });
  return out;
}

/** 匯出 CSV（Excel 可以直接開，含 BOM） */
export function exportCSV(l: Ledger): string {
  const s = l.settings;
  const q = (v: unknown) => {
    const x = v == null ? "" : String(v);
    return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  const head = ["日期", "時間", "類型", "主類別", "子類別", "金額", "手續費", "折扣", "實際金額", "付款方式", "卡片", "專案", "名稱", "商家", "發票號碼", "標籤", "備註", "狀態"];
  const rows: unknown[][] = [head];
  const all = [];
  for (const k in l.months) for (const t of l.months[k].items || []) if (t.type !== "transfer") all.push(t);
  all.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  all.forEach((t) => {
    const c = findCategory(s, t.catId);
    const g = c ? findGroup(s, c.groupId) : null;
    const p = findProject(s, t.projectId);
    const cd = cardOf(s, t);
    rows.push([
      t.date, t.time || "", t.type === "income" ? "收入" : t.type === "topup" ? "加值" : "支出", g ? g.name : "", c ? c.name : "未分類",
      +t.amount || 0, +(t.fee ?? 0) || 0, +(t.discount ?? 0) || 0, net(t), t.type === "expense" ? (payOf(s, t) === "card" ? "信用卡" : "現金") : "",
      cd ? cd.name : "", p ? p.name : "", t.name || "", t.merchant || "", t.invoice || "", (t.tags || []).join(" "), t.note || "", t.pending ? "待入帳" : "",
    ]);
  });
  return "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n");
}
