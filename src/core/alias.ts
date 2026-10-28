import type { Alias, Settings, Tx } from "./types";

/** 帳單說明正規化成對照用的 key：轉大寫、去掉數字和標點 */
export function aliasKey(d: string | null | undefined): string {
  return String(d || "")
    .toUpperCase()
    .replace(/[0-9０-９]/g, "")
    .replace(/[\s\-_*#.,:;/\\()[\]【】（）　]+/g, " ")
    .trim();
}

export function findAlias(s: Settings, desc: string | null | undefined): Alias | null {
  const k = aliasKey(desc);
  if (!k) return null;
  return (s.aliases || []).find((a) => a.key === k) || null;
}

/**
 * 記住帳單說明對應的類別、名稱、商家。
 * 回傳新的 aliases 陣列；沒有變化時回傳 null（不用寫回設定）。
 */
export function learnAlias(s: Settings, desc: string, tx: Pick<Tx, "catId" | "name" | "merchant">, newId: string): Alias[] | null {
  const k = aliasKey(desc);
  if (!k || !tx || !tx.catId) return null;
  const list = (s.aliases || []).slice();
  const idx = list.findIndex((x) => x.key === k);
  const nw = {
    desc: String(desc).slice(0, 60),
    catId: tx.catId,
    name: tx.name || "",
    merchant: tx.merchant && tx.merchant !== desc ? tx.merchant : "",
  };
  if (idx >= 0) {
    const a = list[idx];
    if (a.desc === nw.desc && a.catId === nw.catId && a.name === nw.name && a.merchant === nw.merchant) return null;
    list[idx] = { ...a, ...nw };
  } else list.push({ id: newId, key: k, ...nw });
  return list;
}
