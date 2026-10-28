/**
 * 多裝置同時寫入同一個月時的合併邏輯（純函式，方便測試）。
 *
 * 做法：每個月記住「上次從雲端讀到的內容」（base）。要寫入時，
 * 只找出這台裝置新增或修改的記錄（up）和刪除的記錄（del），
 * 寫入前重新讀雲端最新內容，把 up、del 套上去再存回去。
 * 這樣手機和電腦同時記同一個月，彼此的新記錄都不會被蓋掉。
 */
import type { Tx } from "../core/types";

/** 每筆記錄 id → JSON 字串 */
export type MonthBase = Map<string, string>;

export function baseOf(items: Tx[]): MonthBase {
  return new Map(items.map((t) => [t.id, JSON.stringify(t)]));
}

export interface MonthDiff {
  up: Tx[];
  del: string[];
  /** 寫入後新的 base */
  nextBase: MonthBase;
}

/** 本機內容跟 base 比，找出改了哪些；沒有變化回傳 null */
export function diffMonth(base: MonthBase, local: Tx[]): MonthDiff | null {
  const up: Tx[] = [];
  const del: string[] = [];
  const ids = new Set<string>();
  for (const t of local) {
    ids.add(t.id);
    const j = JSON.stringify(t);
    if (base.get(t.id) !== j) up.push(JSON.parse(j));
  }
  base.forEach((_, id) => {
    if (!ids.has(id)) del.push(id);
  });
  if (!up.length && !del.length) return null;
  const nextBase = new Map(base);
  up.forEach((t) => nextBase.set(t.id, JSON.stringify(t)));
  del.forEach((id) => nextBase.delete(id));
  return { up, del, nextBase };
}

/** 把本機的變更套到雲端最新內容上：保留雲端原本的順序，新記錄接在後面 */
export function mergeMonth(cur: Tx[], up: Tx[], del: string[]): Tx[] {
  const dset = new Set(del);
  const umap = new Map(up.map((t) => [t.id, t]));
  const seen = new Set<string>();
  return cur
    .filter((t) => !dset.has(t.id))
    .map((t) => {
      seen.add(t.id);
      return umap.get(t.id) ?? t;
    })
    .concat(up.filter((t) => !seen.has(t.id)));
}
