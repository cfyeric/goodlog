/**
 * 週期、分期、單次排程的日期與金額計算。
 * 邏輯跟舊版完全相同（包含 id 的命名方式），因為雲端裡已經有用舊版產生的記錄，
 * 新版要能認得它們、不會重複產生。改動前請先跑 tests/recurrence.test.ts。
 */
import type { DateStr, Months, PlanRow, Rule, RuleUnit, Tx } from "./types";
import { addMonths, clampDay, pd, ymd } from "./dates";
import { r2 } from "./money";

/* ---------- 規則正規化 ---------- */

/** 很早期的規則只有 freq，補上新格式的欄位（不修改傳入的物件） */
export function normRule(r: Rule): Rule {
  if (r.kind) return r;
  return { ...r, kind: "recur", every: 1, unit: r.freq || "month", startIdx: 1, post: "due", legacy: true };
}

/** 總共幾期；無限期回傳 Infinity */
export function nOcc(r: Rule): number {
  return r.count ? Math.max(0, r.count - (r.startIdx || 1) + 1) : Infinity;
}

/**
 * 每日週期限定的星期，依週一到週日排序；全選或沒選回傳 null。
 * 舊格式 weekdays: true 等於週一到週五。
 */
export function wdSet(m: Pick<Rule, "wdays" | "weekdays">): number[] | null {
  const a = Array.isArray(m.wdays) ? m.wdays : m.weekdays ? [1, 2, 3, 4, 5] : null;
  return a && a.length && a.length < 7 ? a.slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)) : null;
}

/** 延後或提醒入帳時，使用者指定的入帳日期優先於記錄日期 */
export function postBase(m: Partial<Rule> | null | undefined, d: DateStr): DateStr {
  return m && m.postDate && m.post && m.post !== "now" ? m.postDate : d;
}

/* ---------- 日期計算 ---------- */

/** 從記錄日期算出第一期的日期（例如每月 25 號，記錄日 26 號 → 下個月 25 號） */
export function recurStart(m: Partial<Rule>, rec: DateStr): DateStr {
  const u = m.unit || "month";
  const [y, mo] = rec.split("-").map(Number);
  if (u === "month" && m.dom) {
    let s = clampDay(y, mo, +m.dom);
    if (s < rec) {
      const t = new Date(y, mo, 1);
      s = clampDay(t.getFullYear(), t.getMonth() + 1, +m.dom);
    }
    return s;
  }
  if (u === "year" && m.dom && m.moy) {
    let s = clampDay(y, +m.moy, +m.dom);
    if (s < rec) s = clampDay(y + 1, +m.moy, +m.dom);
    return s;
  }
  if (u === "week" && m.dow != null && m.dow !== "") {
    const d = pd(rec);
    const diff = (+m.dow - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return ymd(d);
  }
  return rec;
}

export function addInterval(ds: DateStr, n: number, u: RuleUnit): DateStr {
  if (u === "day" || u === "week") {
    const d = pd(ds);
    d.setDate(d.getDate() + n * (u === "week" ? 7 : 1));
    return ymd(d);
  }
  return addMonths(ds, u === "year" ? 12 * n : n);
}

/** 從 ds 開始（ds 不是允許的星期就先往後找），往後數第 k 個允許的日子 */
export function addDaysIn(ds: DateStr, k: number, set: number[]): DateStr {
  const ok = new Set(set);
  const x = pd(ds);
  let g = 0;
  while (!ok.has(x.getDay()) && g++ < 7) x.setDate(x.getDate() + 1);
  x.setDate(x.getDate() + Math.floor(k / ok.size) * 7);
  let rem = k % ok.size;
  while (rem > 0) {
    x.setDate(x.getDate() + 1);
    if (ok.has(x.getDay())) rem--;
  }
  return ymd(x);
}

/** 第 j 期（從 0 開始）的日期 */
export function occAt(r: Rule, j: number): DateStr {
  const base = r.grace ? addMonths(r.start, r.grace) : r.start;
  const every = +(r.every ?? 1) || 1;
  const ws = r.unit === "day" ? wdSet(r) : null;
  if (ws) return addDaysIn(base, j * every, ws);
  let d: DateStr;
  if (r.dom && (r.unit === "month" || r.unit === "year")) {
    const [y, mo] = base.split("-").map(Number);
    const t = new Date(y, mo - 1 + j * every * (r.unit === "year" ? 12 : 1), 1);
    d = clampDay(t.getFullYear(), t.getMonth() + 1, +r.dom);
  } else d = addInterval(base, j * every, r.unit || "month");
  if (r.workday && r.workday !== "same") {
    const x = pd(d);
    const w = x.getDay();
    if (w === 6 || w === 0) {
      x.setDate(x.getDate() + (r.workday === "before" ? (w === 6 ? -1 : -2) : w === 6 ? 2 : 1));
      d = ymd(x);
    }
  }
  return d;
}

/* ---------- 分期金額 ---------- */

export type Rounding = "default" | "round" | "ceil" | "floor";
export type Interest = "none" | "annuity" | "principal" | "fixed" | "interestFirst";

export function rounder(mode?: Rounding): (x: number) => number {
  return mode === "round"
    ? Math.round
    : mode === "ceil"
      ? (x) => Math.ceil(x - 1e-9)
      : mode === "floor"
        ? (x) => Math.floor(x + 1e-9)
        : r2;
}

/** 每一期是幾分之幾年（算利率用） */
export function periodYears(every: number | undefined, unit: RuleUnit | undefined): number {
  const n = +(every ?? 1) || 1;
  return unit === "day" ? n / 365 : unit === "week" ? (7 * n) / 365 : unit === "year" ? n : n / 12;
}

/** 平均分成 n 份，除不盡的差額放在第 remIdx 期 */
export function splitEven(P: number, n: number, R: (x: number) => number, remIdx: number): number[] {
  let base = R(P / n);
  let rest = r2(P - base * (n - 1));
  if (rest < 0) {
    base = Math.floor(P / n);
    rest = r2(P - base * (n - 1));
  }
  const a = new Array(n).fill(base);
  a[remIdx] = rest;
  return a;
}

export interface PlanOptions {
  instN: number;
  rounding?: Rounding;
  /** 除不盡的差額放第一期還是最後一期 */
  remTo?: "first" | "last";
  interest?: Interest;
  /** 年利率（%） */
  rate?: number;
  every?: number;
  unit?: RuleUnit;
  discount?: number;
  fee?: number;
  /** 折扣全部算在第一期，或平均分到每期 */
  extrasTo?: "first" | "each";
}

/** 算出分期每一期的本金、手續費（含利息）、折扣 */
export function buildPlan(P: number, o: PlanOptions): PlanRow[] {
  const n = o.instN;
  const R = rounder(o.rounding);
  const remIdx = o.remTo === "last" ? n - 1 : 0;
  const rp = o.interest && o.interest !== "none" ? ((+(o.rate ?? 0) || 0) / 100) * periodYears(o.every, o.unit) : 0;
  let prin: number[] = new Array(n).fill(0);
  let int: number[] = new Array(n).fill(0);
  if (!rp || o.interest === "none") prin = splitEven(P, n, R, remIdx);
  else if (o.interest === "annuity") {
    const pay = (P * rp) / (1 - Math.pow(1 + rp, -n));
    let rem = P;
    for (let i = 0; i < n; i++) {
      int[i] = R(rem * rp);
      prin[i] = i === n - 1 ? r2(rem) : Math.min(r2(rem), R(pay - int[i]));
      rem = r2(rem - prin[i]);
    }
  } else if (o.interest === "principal") {
    prin = splitEven(P, n, R, remIdx);
    let rem = P;
    for (let i = 0; i < n; i++) {
      int[i] = R(rem * rp);
      rem = r2(rem - prin[i]);
    }
  } else if (o.interest === "fixed") {
    prin = splitEven(P, n, R, remIdx);
    int = new Array(n).fill(R(P * rp));
  } else if (o.interest === "interestFirst") {
    prin[n - 1] = P;
    int = new Array(n).fill(R(P * rp));
  }
  const dis = +(o.discount ?? 0) || 0;
  const disArr: number[] = new Array(n).fill(0);
  if (dis) {
    if (o.extrasTo === "each") splitEven(dis, n, R, remIdx).forEach((v, i) => (disArr[i] = v));
    else disArr[0] = dis;
  }
  return prin.map((p, i) => ({
    amount: r2(p),
    fee: r2(int[i] + (i === 0 ? +(o.fee ?? 0) || 0 : 0)),
    discount: r2(disArr[i]),
    interest: r2(int[i]),
  }));
}

/* ---------- 產生記錄 ---------- */

/**
 * 產生第 j 期（從 0 開始）的記錄。
 * id 格式：規則 id + "-" + 期數；很早期轉換來的規則（legacy）用 j。
 */
export function makeOcc(r: Rule, j: number): Tx {
  const p = (r.startIdx || 1) + j;
  const t = { ...r.tpl, id: r.id + "-" + (r.legacy ? j : p), date: occAt(r, j) } as Tx;
  if (r.kind === "inst") {
    const pl = (r.plan && r.plan[p - 1]) || { amount: 0, fee: 0, discount: 0 };
    t.amount = pl.amount;
    t.fee = pl.fee;
    t.discount = pl.discount;
    t.inst = { id: r.id, i: p, n: r.count || 0, total: r.total };
  } else if (r.kind === "recur") t.rec = { id: r.id, i: p };
  if (r.post === "remind") t.pending = true;
  else delete t.pending;
  return t;
}

export interface RunResult {
  /** 更新後的所有月份（沒變的月份沿用原本的物件） */
  months: Months;
  /** 更新後的規則（已正規化，done 已推進，完成的單次規則已移除） */
  recurs: Rule[];
  /** 有新增記錄的月份，要寫回資料庫 */
  touched: string[];
  /** 規則有變化，要寫回設定 */
  settingsChanged: boolean;
}

/**
 * 把到期的週期記錄補進帳本。每次打開網頁、跨過午夜、規則或資料有變動時呼叫。
 * - done 只計算「日期已到」的期數
 * - 立即入帳（now）會先把下一期排進日曆，但不推進 done，避免每次同步又往後多排一筆
 * - 延後（due）和提醒（remind）只產生日期已到的期數
 */
export function runRecurs(months: Months, recurs: Rule[] | undefined, today: DateStr): RunResult {
  const out: Months = { ...months };
  const touched = new Set<string>();
  let ch = false;
  const rules = (recurs || []).map((r0) => {
    const r = { ...normRule(r0) };
    let j = r.done || 0;
    let guard = 0;
    const N = nOcc(r);
    while (guard++ < 800 && j < N) {
      const t = makeOcc(r, j);
      const future = t.date > today;
      if (future && r.post !== "now") break;
      const mk = t.date.slice(0, 7);
      const cur = out[mk] || { items: [] };
      if (!cur.items.some((x) => x.id === t.id)) {
        out[mk] = { ...cur, items: cur.items.concat([t]) };
        touched.add(mk);
      }
      if (future) break;
      j++;
    }
    if (j !== (r.done || 0)) {
      r.done = j;
      ch = true;
    }
    return r;
  });
  const kept = rules.filter((r) => !(r.kind === "once" && (r.done || 0) >= nOcc(r)));
  if (kept.length !== rules.length) ch = true;
  return { months: out, recurs: kept, touched: [...touched], settingsChanged: ch };
}

/* ---------- 建立規則 ---------- */

/** 編輯畫面的排程設定 */
export interface ScheduleMode extends Partial<Omit<Rule, "id" | "start" | "tpl">> {
  kind: "recur" | "inst" | "once";
  instN?: number;
  rounding?: Rounding;
  remTo?: "first" | "last";
  interest?: Interest;
  rate?: number;
  extrasTo?: "first" | "each";
}

/**
 * 從編輯畫面的排程設定和要存的記錄，建立一條新規則。
 * newId 由呼叫端提供（例如 uid8()），方便測試。
 */
export function createRule(M: ScheduleMode, clean: Tx, newId: string): Rule {
  const tpl: Partial<Tx> = { ...clean };
  delete tpl.id;
  delete tpl.date;
  const isRecur = M.kind === "recur";
  const r: Rule = {
    id: (M.kind === "inst" ? "i" : M.kind === "once" ? "o" : "r") + newId,
    kind: M.kind,
    every: M.kind === "once" ? 1 : M.every || 1,
    unit: M.kind === "once" ? "month" : M.unit || "month",
    start: isRecur ? recurStart(M, postBase(M, clean.date)) : postBase(M, clean.date),
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
    r.total = clean.amount;
    r.plan = buildPlan(clean.amount, { ...(M as PlanOptions), discount: clean.discount, fee: clean.fee });
    r.tpl.fee = 0;
    r.tpl.discount = 0;
  }
  return r;
}

/** 立即入帳且期數有限的規則：存檔時一次產生全部記錄，不需要保留規則 */
export function expandAll(r: Rule): Tx[] {
  const n = nOcc(r);
  if (n === Infinity) throw new Error("無限期的規則不能一次展開");
  return Array.from({ length: n }, (_, j) => makeOcc(r, j));
}

/** 從某一期開始沿用原規則設定，給「這筆和之後」「全部」修改範圍使用 */
export function ruleMode(r: Rule, i: number): ScheduleMode {
  const m: ScheduleMode = {
    kind: "recur",
    every: r.every || 1,
    unit: r.unit || "month",
    dom: r.dom,
    moy: r.moy,
    dow: r.dow,
    wdays: wdSet(r),
    workday: r.workday || "same",
    post: r.post || "due",
    count: r.count ? Math.max(1, r.count - i + 1) : 0,
    startIdx: 1,
  };
  (Object.keys(m) as (keyof ScheduleMode)[]).forEach((k) => {
    if (m[k] == null) delete m[k];
  });
  return m;
}

/* ---------- 提醒 ---------- */

export interface UpcomingDue {
  rule: Rule;
  date: DateStr;
}

/**
 * 提醒入帳規則在 (today, limit] 之間即將到期的期數（每條規則最多往後看 5 期）。
 * 已到期的待入帳記錄另外用 pendingList 取得。
 */
export function upcomingReminders(recurs: Rule[] | undefined, today: DateStr, limit: DateStr): UpcomingDue[] {
  const out: UpcomingDue[] = [];
  (recurs || []).forEach((r0) => {
    const r = normRule(r0);
    if (r.post !== "remind") return;
    const N = nOcc(r);
    for (let j = r.done || 0; j < N && j < (r.done || 0) + 5; j++) {
      const d = occAt(r, j);
      if (d <= today) continue;
      if (d > limit) break;
      out.push({ rule: r, date: d });
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
