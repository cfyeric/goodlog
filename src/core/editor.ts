/**
 * 記帳畫面的邏輯（純函式）：算式、數字鍵盤、建議、存檔、刪除。
 * 跟舊版 legacy/ 的 openEditor、evalExpr、saveTx 等行為相同。
 */
import type { Category, DateStr, Ledger, Months, Rule, Settings, Tx } from "./types";
import { pad, pd, ymd } from "./dates";
import { allTx, cardOf, findCategory, findGroup, findProject, payOf } from "./ledger";
import { formatMoney, net, r2 } from "./money";
import { buildPlan, makeOcc, nOcc, occAt, postBase, recurStart, ruleMode, wdSet, type PlanOptions, type ScheduleMode } from "./recurrence";
import { learnAlias } from "./alias";

/* ---------- 算式與數字鍵盤 ---------- */

/** 計算鍵盤輸入的算式（+ − × ÷，先乘除後加減），結果四捨五入到小數兩位 */
export function evalExpr(src: string | null | undefined): number {
  const toks = (src || "").match(/\d+\.?\d*|\.\d+|[+\-×÷]/g) || [];
  while (toks.length && /[+\-×÷]/.test(toks[toks.length - 1])) toks.pop();
  if (!toks.length) return 0;
  const out: number[] = [];
  const ops: string[] = [];
  const pr: Record<string, number> = { "+": 1, "-": 1, "×": 2, "÷": 2 };
  const apply = () => {
    const o = ops.pop();
    const b = out.pop() as number;
    const a = out.pop() as number;
    out.push(o === "+" ? a + b : o === "-" ? a - b : o === "×" ? a * b : b === 0 ? 0 : a / b);
  };
  let expectNum = true;
  for (const t of toks) {
    if (/[+\-×÷]/.test(t)) {
      if (expectNum) {
        if (t === "-") out.push(0);
        else continue;
      }
      while (ops.length && pr[ops[ops.length - 1]] >= pr[t]) apply();
      ops.push(t);
      expectNum = true;
    } else {
      out.push(parseFloat(t));
      expectNum = false;
    }
  }
  while (ops.length && out.length > 1) apply();
  const v = out[0] || 0;
  return Math.round(v * 100) / 100;
}

export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "00" | "." | "+" | "-" | "×" | "÷" | "=" | "back" | "C" | "ok";

/** 按下鍵盤的一個鍵，回傳新的輸入字串（ok 不在這裡處理） */
export function applyKey(x: string, k: PadKey): string {
  if (k === "back") return x.slice(0, -1);
  if (k === "C") return "";
  if (k === "=") {
    const v = evalExpr(x);
    return v ? String(v) : "";
  }
  if (k === "ok") return x;
  if ("+-×÷".includes(k)) {
    if (!x && k !== "-") return x;
    if (/[+\-×÷]$/.test(x)) x = x.slice(0, -1);
    return x + k;
  }
  const seg = x.split(/[+\-×÷]/).pop() || "";
  if (k === ".") {
    if (seg.includes(".")) return x;
    return x + (seg ? "" : "0") + ".";
  }
  if (seg === "0") x = x.slice(0, -1);
  if (seg.replace(".", "").length >= 10) return x;
  return x + k;
}

/** 實體鍵盤對應到數字鍵盤 */
export const KEYMAP: Record<string, PadKey> = {
  "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  ".": ".", ",": ".", "+": "+", "-": "-", "*": "×", x: "×", X: "×", "/": "÷", "=": "=",
  Backspace: "back", Delete: "C", Enter: "ok",
};

/* ---------- 草稿 ---------- */

export interface Draft {
  /** 原本的記錄；新增時為 null */
  orig: Tx | null;
  t: Tx;
  /** 金額、手續費、折扣的算式字串 */
  ex: { amount: string; fee: string; discount: string };
  /** 新增時的排程設定（null 表示單次、立即入帳） */
  mode: ScheduleMode | null;
  /** 編輯週期記錄時的修改範圍 */
  scope: "one" | "after" | "all";
  /** 編輯週期記錄時，使用者改過週期設定 */
  schedTouched: boolean;
  confirmPending: boolean;
  /** 從帳單比對補記時，帳單上的說明（存檔時學起來） */
  fromImp?: { desc: string } | null;
}

// 跟舊版一樣直接相加（沒有時間的記錄會變成 "...undefined"，排序時算在當天最後）
const latest = (a: Tx[]) => a.sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time))[0];

/** 打開記帳畫面時的初始草稿 */
export function newDraft(L: Ledger, tx: Tx | null, opts: { date: DateStr; now: Date; id: string }): Draft {
  const s = L.settings;
  if (tx) {
    const t: Tx = JSON.parse(JSON.stringify(tx));
    if (t.type === "expense") {
      t.pay = payOf(s, t);
      const c = cardOf(s, t);
      t.cardId = c ? c.id : "";
    }
    return {
      orig: tx,
      t,
      ex: { amount: String(tx.amount || ""), fee: tx.fee ? String(tx.fee) : "", discount: tx.discount ? String(tx.discount) : "" },
      mode: null,
      scope: "one",
      schedTouched: false,
      confirmPending: false,
    };
  }
  // 付款方式、卡片、專案沿用「自己記的最後一筆」：週期／分期自動產生的、還沒入帳的、未來日期的都不算，
  // 不然每月自動扣款的信用卡記錄會讓預設一直跳到信用卡
  const today = ymd(opts.now);
  const all = allTx(L).filter((t) => t.type === "expense" && !t.rec && !t.inst && !t.pending && t.date <= today);
  const last = latest(all);
  const lc = latest(all.filter((t) => payOf(s, t) === "card"));
  const lcc = lc && cardOf(s, lc);
  const lp = last && last.projectId && !findProject(s, last.projectId)?.archived ? last.projectId : "";
  return {
    orig: null,
    t: {
      id: opts.id,
      type: "expense",
      catId: null,
      amount: 0,
      fee: 0,
      discount: 0,
      pay: last ? payOf(s, last) : "cash",
      cardId: lcc && !lcc.archived ? lcc.id : "",
      projectId: lp || (s.projects || []).find((p) => !p.archived)?.id || "",
      name: "",
      merchant: "",
      tags: [],
      note: "",
      date: opts.date,
      time: pad(opts.now.getHours()) + ":" + pad(opts.now.getMinutes()),
    },
    ex: { amount: "", fee: "", discount: "" },
    mode: null,
    scope: "one",
    schedTouched: false,
    confirmPending: false,
  };
}

/** 確認待入帳時的草稿：拿掉待入帳標記、清空金額讓使用者輸入這期的實際金額 */
export function confirmDraft(L: Ledger, tx: Tx, id: string, now: Date): Draft {
  const d = newDraft(L, tx, { date: tx.date, now, id });
  delete d.t.pending;
  d.confirmPending = true;
  d.ex = { amount: "", fee: "", discount: "" };
  return d;
}

/** 這筆記錄所屬、而且還在進行的週期規則 */
export function recRuleOf(s: Settings, t: Tx | null): Rule | null {
  if (!t || !t.rec) return null;
  const r = (s.recurs || []).find((x) => x.id === t.rec!.id);
  return r && (r.kind || "recur") === "recur" ? r : null;
}

/* ---------- 建議 ---------- */

/** 數字鍵盤上方的常用金額：同類型（有選類別就同類別）最常出現的 8 個金額 */
export function quickAmounts(L: Ledger, t: Tx): string[] {
  const cnt: Record<string, number> = {};
  allTx(L)
    .filter((x) => x.type === t.type && (!t.catId || x.catId === t.catId))
    .forEach((x) => {
      const a = +x.amount;
      if (a > 0) cnt[a] = (cnt[a] || 0) + 1;
    });
  return Object.entries(cnt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map((x) => x[0]);
}

/** 建議的子類別：依過去一年的記錄，時間越接近、同星期、越近期、越常用分數越高（記錄少於 5 筆不建議） */
export function suggestCats(L: Ledger, t: Tx, cs: Category[]): Category[] {
  const ok = new Set(cs.map((c) => c.id));
  const d0 = pd(t.date);
  const wd = d0.getDay();
  const [hh, mm] = (t.time || "12:00").split(":").map(Number);
  const m0 = hh * 60 + (mm || 0);
  const sc: Record<string, number> = {};
  let n = 0;
  for (const k in L.months)
    for (const x of L.months[k].items || []) {
      if (x.pending || x.id === t.id || !x.catId || !ok.has(x.catId) || !x.date || x.date > t.date) continue;
      const age = (d0.getTime() - pd(x.date).getTime()) / 864e5;
      if (age > 365) continue;
      const [h2, m2] = (x.time || "12:00").split(":").map(Number);
      let dm = Math.abs(h2 * 60 + (m2 || 0) - m0);
      dm = Math.min(dm, 1440 - dm);
      const wTime = x.time ? Math.exp(-(dm * dm) / (2 * 90 * 90)) : 0.3;
      const xd = pd(x.date).getDay();
      const wDay = xd === wd ? 1.4 : (xd % 6 === 0) === (wd % 6 === 0) ? 1.1 : 0.85;
      const wAge = Math.exp(-age / 90);
      sc[x.catId] = (sc[x.catId] || 0) + (0.25 + wTime) * wDay * wAge;
      n++;
    }
  if (n < 5) return [];
  return Object.entries(sc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => findCategory(L.settings, id))
    .filter((c): c is Category => !!c);
}

export interface FieldSuggestion {
  list: string[];
  /** 前幾個是「跟另一個欄位一起出現過」的值 */
  nLink: number;
  /** 另一個欄位目前的值 */
  ov: string;
}

/**
 * 名稱、商家的常用選項。
 * 另一個欄位已填時，先列出曾經一起出現過的值（商家 → 買過的品項；品項 → 買過的店家），
 * 再列出同類別常用的值（同類別不到 3 個就補上其他類別的）。
 */
export function fieldSuggest(L: Ledger, t: Tx, field: "name" | "merchant", q: string, names: { name: string; merchant: string }): FieldSuggestion {
  const cid = t.catId;
  const nm = names.name || "";
  const d0 = pd(t.date);
  const otherF = field === "name" ? "merchant" : "name";
  const ov = (field === "name" ? names.merchant : names.name).trim();
  const wOf = (x: Tx) => Math.exp(-Math.max(0, (d0.getTime() - pd(x.date).getTime()) / 864e5) / 120) + 0.15;
  const score = (useCat: boolean) => {
    const m = new Map<string, number>();
    for (const k in L.months)
      for (const x of L.months[k].items || []) {
        if (x.type !== t.type || x.id === t.id) continue;
        if (useCat && x.catId !== cid) continue;
        const v = (x[field] || "").trim();
        if (!v) continue;
        let w = wOf(x);
        if (field === "merchant" && nm && x.name === nm) w *= 3;
        m.set(v, (m.get(v) || 0) + w);
      }
    return m;
  };
  const link = new Map<string, number>();
  if (ov)
    for (const k in L.months)
      for (const x of L.months[k].items || []) {
        if (x.id === t.id || (x[otherF] || "").trim() !== ov) continue;
        const v = (x[field] || "").trim();
        if (!v) continue;
        link.set(v, (link.get(v) || 0) + wOf(x));
      }
  const m = cid ? score(true) : new Map<string, number>();
  if (m.size < 3) score(false).forEach((v, k) => {
    if (!m.has(k)) m.set(k, v * 0.3);
  });
  const ql = q.trim().toLowerCase();
  const flt = (arr: [string, number][]) => (ql ? arr.filter(([k]) => k.toLowerCase().includes(ql) && k !== q.trim()) : arr);
  const la = flt([...link.entries()]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const ra = flt([...m.entries()]).filter(([k]) => !link.has(k)).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const list = la.concat(ra).slice(0, 14);
  return { list, nLink: Math.min(la.length, list.length), ov };
}

/** 類別格子的排列：兩列、每頁 n 欄，左右滑動換頁（直式讀法：先上再下） */
export function catsOrder<T>(list: T[], cols: number): (T | null)[] {
  if (list.length <= cols) return list;
  const pages = Math.ceil(list.length / (2 * cols));
  const out: (T | null)[] = [];
  for (let p = 0; p < pages; p++) {
    const chunk = list.slice(p * 2 * cols, (p + 1) * 2 * cols);
    for (let c = 0; c < cols; c++) {
      out.push(chunk[c] ?? null);
      out.push(chunk[cols + c] ?? null);
    }
  }
  return out;
}

/** 照指定的 id 順序重新排列（不在清單裡的維持原位置） */
export function reorderArr<T extends { id: string }>(arr: T[], ids: string[]): T[] {
  const set = new Set(ids);
  const pos: number[] = [];
  arr.forEach((x, i) => {
    if (set.has(x.id)) pos.push(i);
  });
  const by = new Map(arr.map((x) => [x.id, x]));
  const out = arr.slice();
  ids.forEach((id, k) => {
    if (pos[k] !== undefined) out[pos[k]] = by.get(id)!;
  });
  return out;
}

/* ---------- 排程對話框 ---------- */

export interface SchedDraft extends ScheduleMode {
  raw: Record<string, string>;
}

export function schedDefaults(kind: ScheduleMode["kind"]): SchedDraft {
  return { kind, every: 1, unit: "month", startIdx: 1, count: 0, instN: 3, grace: 0, interest: "none", rate: 0, rounding: "default", remTo: "first", extrasTo: "first", post: "now", workday: "same", raw: {} };
}

/** 打開排程對話框時的初始值 */
export function schedOpen(s: Settings, d: Draft): SchedDraft {
  const RR0 = d.orig && recRuleOf(s, d.orig);
  const base = d.mode || (RR0 && !d.schedTouched ? ruleMode(RR0, d.orig!.rec!.i) : null);
  return { ...schedDefaults((base && base.kind) || "once"), dom: +d.t.date.slice(8, 10), moy: +d.t.date.slice(5, 7), dow: pd(d.t.date).getDay(), ...(base || {}), raw: {} };
}

export function validateSched(D: SchedDraft, amountExpr: string): string {
  const I = (v: unknown, a: number, b: number) => Number.isInteger(v) && (v as number) >= a && (v as number) <= b;
  if (D.kind === "once") return "";
  if (!I(D.every, 1, 365)) return "區間請輸入 1 到 365 的整數。";
  if (D.kind === "inst") {
    if (!I(D.instN, 2, 360)) return "分期期數請輸入 2 到 360 的整數。";
    if (!I(D.startIdx, 1, D.instN as number)) return "起始期數要在 1 到分期期數之間。";
    if (D.interest !== "none" && !((D.rate ?? 0) >= 0 && (D.rate ?? 0) <= 100)) return "年利率請輸入 0 到 100。";
    if (!(evalExpr(amountExpr) > 0)) return "請先輸入分期總金額。";
  } else {
    if ((D.raw["sc-count"] || "") !== "" && !I(D.count, 1, 600)) return "次數請輸入 1 到 600 的整數，或留空代表無限期。";
    if (!I(D.startIdx, 1, 600)) return "起始期數請輸入 1 以上的整數。";
    if (D.count && (D.startIdx || 1) > D.count) return "起始期數不能大於次數。";
  }
  if (D.kind === "recur" && (D.unit === "month" || D.unit === "year") && !I(D.dom, 1, 31)) return "指定日期請輸入 1 到 31 號。";
  if (D.kind === "recur" && D.unit === "year" && !I(D.moy, 1, 12)) return "月份請輸入 1 到 12。";
  return "";
}

/** 分期每期金額的說明（兩行：每期金額、利息合計） */
export function planSummary(D: ScheduleMode, ex: Draft["ex"]): string[] {
  const P = evalExpr(ex.amount);
  if (!(P > 0) || !((D.instN || 0) >= 2)) return ["輸入金額和期數後顯示"];
  const pl = buildPlan(P, { instN: D.instN!, rounding: D.rounding, remTo: D.remTo, interest: D.interest, rate: D.rate, every: D.every, unit: D.unit, discount: evalExpr(ex.discount), fee: evalExpr(ex.fee), extrasTo: D.extrasTo });
  const tot = pl.reduce((a, x) => a + x.amount + x.fee - x.discount, 0);
  const ti = pl.reduce((a, x) => a + x.interest, 0);
  const per = pl.map((x) => r2(x.amount + x.fee - x.discount));
  const allSame = per.every((v) => v === per[0]);
  const mid = per[Math.min(1, per.length - 1)];
  const first = allSame
    ? "每期 " + formatMoney(per[0])
    : "第 1 期 " + formatMoney(per[0]) + "，第 2 期 " + formatMoney(mid) + (per[per.length - 1] !== mid ? "，末期 " + formatMoney(per[per.length - 1]) : "");
  return ti ? [first, "利息合計 " + formatMoney(ti) + "，總付 " + formatMoney(tot)] : [first];
}

/** 排程對話框按「確定」後，套回草稿 */
export function applySched(s: Settings, d: Draft, D: SchedDraft): Draft {
  const { raw: _raw, ...m } = D;
  if (d.orig && recRuleOf(s, d.orig)) {
    return { ...d, schedTouched: true, scope: d.scope !== "all" || D.kind !== "recur" ? "after" : d.scope, mode: D.kind === "recur" ? m : { kind: "once" } };
  }
  return { ...d, mode: D.kind === "once" && D.post === "now" ? null : m };
}

/* ---------- 存檔 ---------- */

export type SaveResult =
  | { ok: false; err: string; openPad?: boolean }
  | {
      ok: true;
      /** 有變動的月份（完整的新記錄陣列） */
      months: Record<string, Tx[]>;
      /** 有變動的設定 */
      settings?: Settings;
      msg: string;
      /** 存檔後日曆要跳到的日期；null 表示不跳 */
      sel: DateStr | null;
    };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/**
 * 存檔：驗證、清理欄位，然後依情況
 * - 新增排程（週期、分期、延後或提醒的單次）
 * - 編輯週期記錄並套用到之後或全部、或改週期設定
 * - 一般新增或修改
 * newId 用來產生規則 id；today 用來產生提示訊息。
 */
export function saveDraft(L: Ledger, d: Draft, today: DateStr, newId: () => string, readonly = false): SaveResult {
  const t: Tx = clone(d.t);
  let ex = d.ex;
  if (d.confirmPending && !String(ex.amount).trim() && d.orig) {
    ex = { amount: String(d.orig.amount || ""), fee: d.orig.fee ? String(d.orig.fee) : "", discount: d.orig.discount ? String(d.orig.discount) : "" };
  }
  t.amount = evalExpr(ex.amount);
  t.fee = Math.max(0, evalExpr(ex.fee));
  t.discount = Math.max(0, evalExpr(ex.discount));
  if (!(t.amount > 0)) return { ok: false, err: "請輸入大於 0 的金額。", openPad: true };
  if (!t.catId) return { ok: false, err: "請選一個類別。" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return { ok: false, err: "請選擇日期。" };
  if (readonly) return { ok: false, err: "你沒有寫入這個帳本的權限。" };
  delete t.accountId;
  delete (t as Tx & { toAccountId?: string }).toAccountId;
  if (t.type === "expense") {
    if (t.pay !== "card") t.pay = "cash";
  } else delete t.pay;
  if (t.pay !== "card" || !t.cardId) delete t.cardId;
  if (t.type !== "expense") delete t.discount;
  delete (t as Tx & { instN?: number }).instN;
  const cleanTx: Tx = clone(t);

  let settings: Settings = L.settings;
  const months: Record<string, Tx[]> = {};
  const monthOf = (k: string) => months[k] || (L.months[k]?.items || []);
  const setSettings = (s: Settings) => (settings = s);

  if (d.fromImp) {
    const al = learnAlias(settings, d.fromImp.desc, cleanTx, newId());
    if (al) setSettings({ ...settings, aliases: al });
  }

  const M = d.mode;
  // 新增排程
  if (!d.orig && M && (M.kind !== "once" || M.post !== "now") && !(M.kind === "inst" && cleanTx.type !== "expense")) {
    const tpl: Partial<Tx> = { ...cleanTx };
    delete tpl.id;
    delete tpl.date;
    const isRecur = M.kind === "recur";
    const r: Rule = {
      id: (M.kind === "inst" ? "i" : M.kind === "once" ? "o" : "r") + newId(),
      kind: M.kind,
      every: M.kind === "once" ? 1 : M.every || 1,
      unit: M.kind === "once" ? "month" : M.unit || "month",
      start: isRecur ? recurStart(M, postBase(M, cleanTx.date)) : postBase(M, cleanTx.date),
      dom: isRecur && (M.unit === "month" || M.unit === "year") ? +(M.dom ?? 0) || null : null,
      moy: isRecur && M.unit === "year" ? +(M.moy ?? 0) : null,
      dow: isRecur && M.unit === "week" ? +(M.dow ?? 0) : null,
      startIdx: M.kind === "once" ? 1 : M.startIdx || 1,
      count: M.kind === "inst" ? M.instN : M.kind === "once" ? 1 : M.count || 0,
      post: M.post || "due",
      wdays: isRecur && M.unit === "day" ? wdSet(M) : null,
      workday: M.kind === "once" || (isRecur && M.unit === "day" && wdSet(M)) ? "same" : M.workday || "same",
      grace: M.kind === "inst" ? +(M.grace ?? 0) || 0 : 0,
      tpl,
      done: 0,
    };
    if (M.kind === "inst") {
      r.total = cleanTx.amount;
      r.plan = buildPlan(cleanTx.amount, { ...(M as PlanOptions), instN: M.instN!, discount: cleanTx.discount, fee: cleanTx.fee });
      r.tpl.fee = 0;
      r.tpl.discount = 0;
    }
    let msg: string;
    if (r.post === "now" && nOcc(r) !== Infinity) {
      for (let j = 0; j < nOcc(r); j++) {
        const o = makeOcc(r, j);
        const k = o.date.slice(0, 7);
        months[k] = monthOf(k).concat([o]);
      }
      msg = M.kind === "inst" ? `已記下分期 ${nOcc(r)} 期` : `已記下 ${nOcc(r)} 筆週期記錄`;
    } else {
      setSettings({ ...settings, recurs: (settings.recurs || []).concat([r]) });
      const nx = occAt(r, 0);
      msg =
        (M.kind === "once" ? "已排定" : M.kind === "inst" ? "已設定分期" : "已設定週期") +
        (nx > today ? `，${+nx.slice(5, 7)}/${+nx.slice(8, 10)} ${r.post === "remind" ? "提醒入帳" : "入帳"}` : r.post === "remind" ? "，已到期的列在「待入帳」" : "，已到期的已入帳");
    }
    return { ok: true, months, settings: settings !== L.settings ? settings : undefined, msg, sel: cleanTx.date };
  }

  // 編輯週期記錄
  const RR = d.orig && recRuleOf(settings, d.orig);
  let recMsg = "";
  if (RR && d.orig && (d.scope === "after" || d.scope === "all" || d.schedTouched)) {
    const i = d.orig.rec!.i;
    const gid = RR.id;
    const ALL = d.scope === "all";
    const F = ["type", "amount", "fee", "discount", "time", "catId", "name", "merchant", "pay", "cardId", "projectId", "tags", "note"] as const;
    const apply = (x: Partial<Tx>) => {
      const y = { ...x } as Record<string, unknown>;
      F.forEach((f) => {
        if (cleanTx[f] === undefined) delete y[f];
        else y[f] = clone(cleanTx[f]);
      });
      return y as Partial<Tx>;
    };
    const recurs = (settings.recurs || []).map((x) => ({ ...x }));
    const rr = recurs.find((x) => x.id === gid)!;
    if (!d.schedTouched) {
      rr.tpl = apply(rr.tpl);
      let n = 0;
      Object.keys(L.months).forEach((k) => {
        let changed = false;
        const items = monthOf(k).map((x) => {
          if (x.id !== d.orig!.id && x.rec && x.rec.id === gid && (ALL || x.rec.i > i)) {
            changed = true;
            n++;
            return apply(x) as Tx;
          }
          return x;
        });
        if (changed) months[k] = items;
      });
      recMsg = ALL ? `已更新這個週期的全部 ${n + 1} 筆` : n ? `已更新這筆和之後的 ${n} 筆，之後自動記的也會照新設定` : "已更新，之後自動記的會照新設定";
      setSettings({ ...settings, recurs });
    } else if (ALL && d.mode && d.mode.kind === "recur") {
      const Mm = d.mode;
      Object.keys(L.months).forEach((k) => {
        const its = monthOf(k);
        const keep = its.filter((x) => !(x.rec && x.rec.id === gid));
        if (keep.length !== its.length) months[k] = keep;
      });
      const tpl: Partial<Tx> = { ...cleanTx };
      delete tpl.id;
      delete tpl.date;
      delete tpl.rec;
      delete tpl.pending;
      const b0 = Mm.postDate && Mm.post !== "now" ? Mm.postDate : RR.start;
      const r: Rule = {
        id: "r" + newId(), kind: "recur", every: Mm.every || 1, unit: Mm.unit || "month", start: recurStart(Mm, b0),
        dom: Mm.unit === "month" || Mm.unit === "year" ? +(Mm.dom ?? 0) || null : null, moy: Mm.unit === "year" ? +(Mm.moy ?? 0) : null,
        dow: Mm.unit === "week" ? +(Mm.dow ?? 0) : null, startIdx: 1, count: Mm.count ? Mm.count + i - 1 : 0, post: Mm.post || "due",
        wdays: Mm.unit === "day" ? wdSet(Mm) : null, workday: Mm.unit === "day" && wdSet(Mm) ? "same" : Mm.workday || "same", grace: 0, tpl, done: 0,
      };
      setSettings({ ...settings, recurs: recurs.filter((x) => x.id !== gid).concat([r]) });
      // 舊版這種情況不會另外存這一筆，由新規則重新產生
      return { ok: true, months, settings, msg: "整個週期已改用新設定，重新排好了", sel: null };
    } else {
      rr.count = i;
      Object.keys(L.months).forEach((k) => {
        const its = monthOf(k);
        const keep = its.filter((x) => !(x.id !== d.orig!.id && x.rec && x.rec.id === gid && x.rec.i > i));
        if (keep.length !== its.length) months[k] = keep;
      });
      const Mm = d.mode;
      if (Mm && Mm.kind === "recur") {
        const tpl: Partial<Tx> = { ...cleanTx };
        delete tpl.id;
        delete tpl.date;
        delete tpl.rec;
        delete tpl.pending;
        const r: Rule = {
          id: "r" + newId(), kind: "recur", every: Mm.every || 1, unit: Mm.unit || "month", start: recurStart(Mm, postBase(Mm, cleanTx.date)),
          dom: Mm.unit === "month" || Mm.unit === "year" ? +(Mm.dom ?? 0) || null : null, moy: Mm.unit === "year" ? +(Mm.moy ?? 0) : null,
          dow: Mm.unit === "week" ? +(Mm.dow ?? 0) : null, startIdx: 1, count: Mm.count || 0, post: Mm.post || "due",
          wdays: Mm.unit === "day" ? wdSet(Mm) : null, workday: Mm.unit === "day" && wdSet(Mm) ? "same" : Mm.workday || "same", grace: 0, tpl, done: 0,
        };
        if (r.start === cleanTx.date) {
          r.done = 1;
          cleanTx.rec = { id: r.id, i: 1 };
        }
        recurs.push(r);
        recMsg = "已改用新的週期，從這筆開始";
      } else recMsg = "已更新，這個週期到這筆為止";
      setSettings({ ...settings, recurs });
    }
  }

  // 一般存檔：從原本的月份拿掉，加到新的月份
  if (d.orig) {
    const ok = d.orig.date.slice(0, 7);
    months[ok] = monthOf(ok).filter((x) => x.id !== d.orig!.id);
  }
  const nk = cleanTx.date.slice(0, 7);
  months[nk] = monthOf(nk).filter((x) => x.id !== cleanTx.id).concat([cleanTx]);
  const msg = recMsg || (d.confirmPending ? "已入帳 " + formatMoney(net(cleanTx)) : d.orig ? "已更新" : "已記下 " + formatMoney(net(cleanTx)));
  return { ok: true, months, settings: settings !== L.settings ? settings : undefined, msg, sel: cleanTx.date };
}

/* ---------- 刪除 ---------- */

/** 刪除一筆 */
export function deleteTx(L: Ledger, t: Tx): Record<string, Tx[]> {
  const k = t.date.slice(0, 7);
  return { [k]: (L.months[k]?.items || []).filter((x) => x.id !== t.id) };
}

/** 刪除整組週期或分期（含規則），回傳變動的月份、新設定、刪掉幾筆 */
export function deleteGroup(L: Ledger, gid: string): { months: Record<string, Tx[]>; settings: Settings; n: number } {
  const months: Record<string, Tx[]> = {};
  let n = 0;
  for (const k of Object.keys(L.months)) {
    const its = L.months[k].items || [];
    const keep = its.filter((x) => !((x.inst && x.inst.id === gid) || (x.rec && x.rec.id === gid)));
    if (keep.length !== its.length) {
      n += its.length - keep.length;
      months[k] = keep;
    }
  }
  return { months, settings: { ...L.settings, recurs: (L.settings.recurs || []).filter((x) => x.id !== gid) }, n };
}

/** 停止週期（已記的保留） */
export function stopRule(s: Settings, gid: string): Settings {
  return { ...s, recurs: (s.recurs || []).filter((x) => x.id !== gid) };
}

/* ---------- 顯示 ---------- */

const WD = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 日期按鈕上的文字：今天、昨天、明天或日期，加上星期 */
export function dateLabel(ds: DateStr, today: DateStr): { main: string; wd: string } {
  const d = pd(ds);
  if (isNaN(d.getTime())) return { main: ds || "", wd: "" };
  const diff = Math.round((d.getTime() - pd(today).getTime()) / 864e5);
  return { main: diff === 0 ? "今天" : diff === -1 ? "昨天" : diff === 1 ? "明天" : ds, wd: WD[d.getDay()] };
}

/** 記帳畫面上類別的完整名稱，例如「飲食 › 午餐」 */
export function catPath(s: Settings, c: Category): string {
  const g = findGroup(s, c.groupId);
  return (g?.name ? g.name + " › " : "") + c.name;
}

/** 存款固定轉到這個帳戶 */
export const SAVE_ACC = "國泰存錢帳戶";

/** 帳本裡出現過的儲蓄帳戶名稱（轉入的帳戶），用過越多次越前面 */
export function savingAccounts(months: Months): string[] {
  const n: Record<string, number> = {};
  for (const k in months) for (const t of months[k].items || []) if (t.type === "transfer" && t.toAcc) n[t.toAcc] = (n[t.toAcc] || 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a]);
}

/**
 * 儲存一筆存款（轉到儲蓄帳戶，type "transfer"）。不算支出，沒有類別、付款方式、專案、週期。
 * 編輯舊記錄時保留它原本的轉入、轉出帳戶（例如從 MOZE 匯入的名稱）。
 */
export function saveTransfer(L: Ledger, d: Draft, newId: string): SaveResult {
  const amount = r2(evalExpr(d.ex.amount));
  if (!(amount > 0)) return { ok: false, err: "請輸入金額。", openPad: true };
  const t0 = d.orig;
  const t: Tx = { id: t0 ? t0.id : "x" + newId, type: "transfer", amount, date: d.t.date, toAcc: t0?.toAcc || SAVE_ACC };
  if (t0?.fromAcc) t.fromAcc = t0.fromAcc;
  if (t0?.src) t.src = t0.src;
  if (d.t.time) t.time = d.t.time;
  if ((d.t.name || "").trim()) t.name = d.t.name!.trim();
  if ((d.t.note || "").trim()) t.note = d.t.note!.trim();
  const months: Record<string, Tx[]> = {};
  if (t0) months[t0.date.slice(0, 7)] = (L.months[t0.date.slice(0, 7)]?.items || []).filter((x) => x.id !== t0.id);
  const k = t.date.slice(0, 7);
  months[k] = (months[k] || L.months[k]?.items || []).filter((x) => x.id !== t.id).concat([t]);
  return { ok: true, months, msg: t0 ? "已更新存款" : "已記下存款", sel: t.date };
}
