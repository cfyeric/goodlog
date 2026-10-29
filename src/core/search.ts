/** 搜尋記錄：名稱、商家、備註、標籤、發票、類別、專案、卡片、轉帳帳戶、金額 */
import type { Ledger, Tx } from "./types";
import { cardOf, findCategory, findGroup, findProject } from "./ledger";
import { net } from "./money";

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/**
 * 空白分開的每個詞都要符合（AND）。純數字的詞也比對金額：
 * 「120」找得到金額 120 的記錄，也找得到名稱裡有 120 的記錄。
 * 結果由新到舊排序。
 */
export function searchTx(l: Ledger, query: string): Tx[] {
  const words = norm(query).split(/\s+/).filter(Boolean).map((w) => w.replace(/^#/, ""));
  if (!words.length) return [];
  const s = l.settings;
  const out: Tx[] = [];
  for (const k in l.months)
    for (const t of l.months[k].items || []) {
      const c = findCategory(s, t.catId);
      const g = c ? findGroup(s, c.groupId) : undefined;
      const hay = norm(
        [t.name, t.merchant, t.note, t.invoice, (t.tags || []).join(" "), c?.name, g?.name, findProject(s, t.projectId)?.name, cardOf(s, t)?.name, t.type === "topup" ? "加值" : "", t.type === "transfer" ? "轉帳 儲蓄 存款" : "", t.toAcc, t.fromAcc]
          .filter(Boolean)
          .join("\n"),
      );
      const amounts = [String(+t.amount || 0), String(net(t))];
      const ok = words.every((w) => hay.includes(w) || (/^\d+(\.\d+)?$/.test(w) && amounts.includes(String(+w))));
      if (ok) out.push(t);
    }
  return out.sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")) || (a.id < b.id ? -1 : 1));
}
