import type { Tx } from "./types";

/** 四捨五入到小數兩位 */
export function r2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * 一筆記錄實際的金額：
 * 支出 = 金額 + 手續費 − 折扣；收入 = 金額 − 手續費；其他（加值等）= 金額
 */
export function net(t: Pick<Tx, "type" | "amount" | "fee" | "discount">): number {
  const a = +t.amount || 0;
  const f = +(t.fee ?? 0) || 0;
  const d = +(t.discount ?? 0) || 0;
  return t.type === "expense" ? a + f - d : t.type === "income" ? a - f : a;
}

/** 顯示用金額（不含正負號），例如 $1,234.5 */
export function formatMoney(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return "$" + v.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

/** 帶正負號的金額，負數用 − */
export function formatSigned(n: number): string {
  return (n < 0 ? "−" : "") + formatMoney(n);
}
