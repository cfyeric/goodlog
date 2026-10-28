/**
 * 信用卡帳單匯入與比對。
 * 流程：讀檔 → 表格列（string[][]）→ 找表頭與欄位 → 帳單明細 → 跟帳本比對。
 * 讀 Excel 檔需要 SheetJS，屬於畫面層（src/features）的工作；這裡只處理已經讀成表格的資料。
 */
import type { DateStr, Ledger, Settings, Tx } from "./types";
import { dayDiff, pad, pd } from "./dates";
import { allTx, chargeCard } from "./ledger";
import { net } from "./money";
import { findAlias } from "./alias";

/* ---------- 讀檔 ---------- */

/** 先用 UTF-8 解碼，亂碼太多再改用 Big5（台灣銀行常見） */
export function decodeText(buf: ArrayBuffer | Uint8Array): string {
  let t = new TextDecoder("utf-8").decode(buf);
  if ((t.match(/�/g) || []).length > 2) {
    try {
      t = new TextDecoder("big5").decode(buf);
    } catch {
      /* 環境不支援 Big5 就維持 UTF-8 */
    }
  }
  return t.replace(/^﻿/, "");
}

/** 解析 CSV 或 TSV（自動判斷分隔符號），去掉空白列 */
export function parseCSV(text: string): string[][] {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const delim = (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(f);
      f = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += ch;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some((c) => c));
}

/* ---------- 儲存格 ---------- */

/**
 * 解析日期儲存格：支援 2026/10/27、115/10/27（民國年）、20261027、10/27（用 ref 補年份）。
 * ref 是帳單結帳日；沒有就用 today。
 */
export function parseDateCell(v: unknown, ref: DateStr | null | undefined, today: DateStr): DateStr | null {
  if (v == null) return null;
  const s0 = String(v).trim();
  let m = s0.match(/(\d{2,4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    if (y < 1911) y += 1911;
  } else if ((m = s0.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else if ((m = s0.match(/^(\d{1,2})[/\-.](\d{1,2})$/))) {
    mo = +m[1];
    d = +m[2];
    const R = pd(ref || today);
    y = R.getFullYear();
    if (new Date(y, mo - 1, d).getTime() - R.getTime() > 31 * 864e5) y--;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return y + "-" + pad(mo) + "-" + pad(d);
}

/** 解析金額儲存格：(123)、-123、123- 都視為負數 */
export function parseAmountCell(v: unknown): number | null {
  if (v == null) return null;
  const s0 = String(v).trim();
  if (!s0) return null;
  const neg = /^\(.*\)$/.test(s0) || /^-/.test(s0) || /-$/.test(s0);
  const n = parseFloat(s0.replace(/[^\d.]/g, ""));
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

/* ---------- 表頭與欄位 ---------- */

/** 從帳單前 40 列找結帳日（或入帳期間的結束日），用來補 10/27 這種沒有年份的日期 */
export function findCloseDate(rows: string[][], today: DateStr): DateStr | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    for (let k = 0; k < r.length; k++) {
      if (!/結帳日/.test(r[k])) continue;
      const cands = [r[k].replace(/.*結帳日/, ""), r[k + 1], rows[i + 1] && rows[i + 1][k]];
      for (const c of cands) {
        if (c && /\d{4}/.test(c)) {
          const d = parseDateCell(c, null, today);
          if (d) return d;
        }
      }
    }
  }
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const t = rows[i].join(" ");
    const m = t.match(/入帳期間.*?(\d{4}\/\d{1,2}\/\d{1,2})\s*[-~～]\s*(\d{4}\/\d{1,2}\/\d{1,2})/);
    if (m) return parseDateCell(m[2], null, today);
  }
  return null;
}

/** 猜哪一列是表頭 */
export function guessHeader(rows: string[][], ref: DateStr | null, today: DateStr): number {
  let best = -1;
  let bs = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = rows[i];
    const di = r.findIndex((c) => /^(消費日|消費日期|交易日|交易日期|日期|消費日\/交易日)$/.test(c.replace(/\s/g, "")));
    if (di < 0) continue;
    let sc = 2;
    if (r.some((c) => /金額/.test(c))) sc++;
    if (r.some((c) => /說明|明細|摘要|商店|特店/.test(c))) sc++;
    let n = 0;
    for (let j = i + 1; j < Math.min(rows.length, i + 10); j++) if (rows[j] && parseDateCell(rows[j][di], ref, today)) n++;
    sc += Math.min(n, 4);
    if (sc > bs) {
      bs = sc;
      best = i;
    }
  }
  if (best >= 0) return best;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i].join("|");
    if (/日期|日/.test(r) && /金額|台幣|臺幣|NT/.test(r)) return i;
  }
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (rows[i + 1] && parseDateCell(rows[i + 1][0], null, today) && !parseDateCell(rows[i][0], null, today)) return i;
  }
  return 0;
}

export interface ColumnMap {
  date: number;
  desc: number;
  amount: number;
}

/** 依表頭文字猜日期、說明、金額各在哪一欄（-1 表示找不到） */
export function guessMap(headers: string[]): ColumnMap {
  const find = (res: RegExp[]) => {
    for (const re of res) {
      const i = headers.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    date: find([/消費日/, /交易日/, /日期/, /日/]),
    desc: find([/說明/, /摘要/, /商店/, /特店/, /明細/, /內容/, /名稱/, /項目/]),
    amount: find([/新臺幣/, /新台幣/, /臺幣/, /台幣/, /消費金額/, /金額/, /NT/i]),
  };
}

/* ---------- 帳單明細 ---------- */

export interface StatementItem {
  date: DateStr;
  desc: string;
  /** 負數表示退款 */
  amount: number;
  /** 併進這筆的國外交易手續費 */
  fee?: number;
  /** 所屬卡片區段（一份帳單有多張卡時，例如「卡號末四碼 1234」） */
  sec: string;
}

export interface BuildResult {
  items: StatementItem[];
  /** 帳單裡出現的卡片區段 */
  secs: string[];
  /** 略過的繳款列數 */
  pays: number;
}

/**
 * 把表格列轉成帳單明細：
 * - 略過繳款、轉帳這類負數列
 * - 國外交易手續費併進同一天、同一商家的消費（記帳時手續費記在同一筆）
 * - 富邦格式「國外交易服務費（簽帳 116 )」併進同一天、金額 116 的消費
 */
export function buildItems(rows: string[][], headerIdx: number, mp: ColumnMap, ref: DateStr | null, today: DateStr): BuildResult {
  const items: (StatementItem & { _drop?: boolean })[] = [];
  if (mp.date < 0 || mp.amount < 0) return { items: [], secs: [], pays: 0 };
  let pays = 0;
  let sec = "";
  rows.slice(headerIdx + 1).forEach((r) => {
    const d = parseDateCell(r[mp.date], ref, today);
    if (!d) {
      const t = r.filter(Boolean).join(" ").normalize("NFKC");
      if (/末\s*4\s*碼|末四碼|卡號末/.test(t) && t.length < 60) sec = t.replace(/\s+/g, " ").trim();
      return;
    }
    const a = parseAmountCell(String(r[mp.amount] || "").replace(/[−–—]/g, "-"));
    if (a == null || a === 0) return;
    const desc = (mp.desc >= 0 ? r[mp.desc] || "" : "").normalize("NFKC").replace(/\s+/g, " ").trim();
    if (a < 0 && /繳款|扣繳|自動轉帳|轉帳繳|上期帳單|溢繳|跨行轉帳|ATM.*轉帳/.test(desc)) {
      pays++;
      return;
    }
    items.push({ date: d, desc, amount: Math.round(a * 100) / 100, sec });
  });

  const key = (x: string) => x.toUpperCase().replace(/[^A-Z0-9一-鿿]/g, "");
  for (let i = items.length - 1; i >= 0; i--) {
    const f = items[i];
    const m = f.desc.match(/^(?:國外)?交易手續費\s*[-－]?\s*(.+)$/);
    if (!m || f.amount <= 0) continue;
    const k = key(m[1]);
    if (!k) continue;
    const host = items.find(
      (x) => x !== f && !/手續費/.test(x.desc) && Math.abs(dayDiff(x.date, f.date)) <= 1 && key(x.desc).startsWith(k),
    );
    if (host) {
      host.amount = Math.round((host.amount + f.amount) * 100) / 100;
      host.fee = (host.fee || 0) + f.amount;
      items.splice(i, 1);
    }
  }

  const taken = new Set<StatementItem>();
  for (let i = 0; i < items.length; i++) {
    const f = items[i];
    const m = f.desc.match(/(?:國外)?交易服務費\s*[(（]\s*簽帳\s*([\d,]+)\s*(-)?\s*[)）]/);
    if (!m) continue;
    const base = +m[1].replace(/,/g, "") * (m[2] ? -1 : 1);
    const host = items.find(
      (x) =>
        x !== f &&
        !taken.has(x) &&
        !/服務費|手續費/.test(x.desc) &&
        Math.abs(x.amount - base) < 0.01 &&
        Math.abs(dayDiff(x.date, f.date)) <= 1 &&
        x.sec === f.sec,
    );
    if (host) {
      taken.add(host);
      host.amount = Math.round((host.amount + f.amount) * 100) / 100;
      host.fee = (host.fee || 0) + f.amount;
      f._drop = true;
    }
  }
  const kept = items.filter((x) => !x._drop).map(({ _drop, ...x }) => x);
  return { items: kept, secs: [...new Set(kept.map((x) => x.sec).filter(Boolean))], pays };
}

/** 每個卡片區段預設對應哪張卡：先用上次記住的，否則用整份帳單選的卡 */
export function initSecMap(s: Settings, secs: string[], cardId: string, prev: Record<string, string> = {}): Record<string, string> {
  const out = { ...prev };
  const sm = s.stmtSec || {};
  secs.forEach((k) => {
    if (out[k] === undefined) out[k] = sm[k] !== undefined ? sm[k] : cardId || "";
  });
  return out;
}

/* ---------- 比對 ---------- */

export interface MatchInput {
  items: StatementItem[];
  /** 整份帳單對應的卡片；"" 表示所有信用卡 */
  cardId: string;
  /** 卡片區段 → 卡片 id */
  secMap?: Record<string, string>;
  /** 使用者標成「不是這筆」的明細索引 */
  rejected: Set<number>;
  /** 使用者確認過的明細索引 */
  accepted: Set<number>;
}

export type MatchKind = "ok" | "maybe" | "missing" | "refund";

export interface MatchRow {
  it: StatementItem;
  i: number;
  tx: Tx | null;
  kind: MatchKind;
  /** 日期差幾天 */
  diff: number | null;
  /** 帳單有手續費但帳本那筆沒算 */
  feeMissing?: number;
  /** 金額接近配對時的差額（帳單 − 帳本） */
  amtDiff?: number;
}

export interface MatchResult {
  res: MatchRow[];
  /** 帳本有、帳單沒有的刷卡記錄（帳單期間內） */
  extra: Tx[];
  lo: DateStr;
  hi: DateStr;
}

/**
 * 帳單明細跟帳本的刷卡記錄配對：
 * 1. 金額相同（容許 0.5 元，或扣掉手續費後相同），日期差 3 天內 → 符合
 * 2. 同上但日期差 4 到 7 天 → 待確認（使用者拒絕過的不再配）
 * 3. 100 元以上、日期差 3 天內、金額差 5% 內（外幣匯率差）→ 待確認
 * 已有商家對照且類別相同、或使用者確認過的，直接算符合。
 */
export function matchStatement(l: Ledger, inp: MatchInput): MatchResult | null {
  const s = l.settings;
  const items = inp.items || [];
  if (!items.length) return null;
  const dates = items.map((x) => x.date).sort();
  const lo = dates[0];
  const hi = dates[dates.length - 1];
  const cidOf = (it: StatementItem) =>
    it.sec && inp.secMap && inp.secMap[it.sec] !== undefined ? inp.secMap[it.sec] : inp.cardId;
  const cids = new Set(items.map(cidOf));
  const anyAll = cids.has("");
  const cardOk = (t: Tx, cid: string) => {
    const pc = chargeCard(s, t);
    return !cid || !pc || !pc.id || pc.id === cid;
  };
  const txs = allTx(l).filter((t) => {
    const pc = chargeCard(s, t);
    return pc && dayDiff(t.date, lo) >= -7 && dayDiff(t.date, hi) <= 7 && (anyAll || !pc.id || cids.has(pc.id));
  });
  const used = new Set<string>();
  const res: MatchRow[] = items.map((it, i) => ({ it, i, tx: null, kind: it.amount < 0 ? "refund" : "missing", diff: null }));

  for (const lim of [3, 7]) {
    for (const r of res) {
      if (r.tx || r.kind === "refund") continue;
      if (lim === 7 && inp.rejected.has(r.i)) continue;
      let best: Tx | null = null;
      let bd = 99;
      for (const t of txs) {
        if (used.has(t.id) || !cardOk(t, cidOf(r.it))) continue;
        const nt = net(t);
        if (Math.abs(nt - r.it.amount) > 0.5 && !(r.it.fee && Math.abs(nt - (r.it.amount - r.it.fee)) <= 0.5)) continue;
        const d = Math.abs(dayDiff(t.date, r.it.date));
        if (d <= lim && d < bd) {
          best = t;
          bd = d;
        }
      }
      if (best) {
        used.add(best.id);
        r.tx = best;
        r.diff = bd;
        if (r.it.fee && Math.abs(net(best) - r.it.amount) > 0.5) r.feeMissing = r.it.fee;
        const al = findAlias(s, r.it.desc);
        r.kind = bd <= 3 || inp.accepted.has(r.i) || (al && al.catId && al.catId === best.catId) ? "ok" : "maybe";
      }
    }
  }

  for (const r of res) {
    if (r.tx || r.kind === "refund" || inp.rejected.has(r.i) || r.it.amount < 100) continue;
    let best: Tx | null = null;
    let bs = 1e9;
    for (const t of txs) {
      if (used.has(t.id) || !cardOk(t, cidOf(r.it))) continue;
      const dd = Math.abs(dayDiff(t.date, r.it.date));
      const da = Math.abs(net(t) - r.it.amount);
      if (dd > 3 || da > r.it.amount * 0.05) continue;
      const sc = (da / r.it.amount) * 100 + dd;
      if (sc < bs) {
        bs = sc;
        best = t;
      }
    }
    if (best) {
      used.add(best.id);
      r.tx = best;
      r.diff = Math.abs(dayDiff(best.date, r.it.date));
      r.amtDiff = Math.round((r.it.amount - net(best)) * 100) / 100;
      r.kind = inp.accepted.has(r.i) ? "ok" : "maybe";
    }
  }
  const extra = txs.filter((t) => !used.has(t.id) && t.date >= lo && t.date <= hi);
  return { res, extra, lo, hi };
}
