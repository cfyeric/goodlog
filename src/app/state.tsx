/**
 * 整個 App 共用的帳本狀態與寫入動作。
 * - 畫面上的改動先套用在本機狀態（馬上看到），再交給 store 寫回資料庫
 * - store 傳來新的快照時，以快照為準（跟舊版相同）
 * - 資料讀完、或今天的日期改變時，自動補上到期的週期記錄（runRecurs）
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Ledger, Months, Settings, Tx } from "../core/types";
import { ymd } from "../core/dates";
import { runRecurs } from "../core/recurrence";
import { openStore, type LedgerSnapshot, type LedgerStore, type StoreMode } from "../data";

interface AppState {
  ledger: Ledger | null;
  monthsReady: boolean;
  mode: StoreMode | "connecting";
  /** 今天（YYYY-MM-DD），跨過午夜會自動更新 */
  today: string;
  /** 修改設定：傳入目前設定，回傳新設定（不要直接修改傳入的物件） */
  setSettings: (fn: (s: Settings) => Settings) => void;
  /** 修改某個月的記錄：傳入目前的記錄，回傳新的記錄陣列 */
  setMonth: (key: string, fn: (items: Tx[]) => Tx[]) => void;
  /** 整個月直接取代（還原備份用） */
  replaceMonth: (key: string, items: Tx[]) => Promise<void>;
  /** 一次套用多個月份和設定的變更（月份給完整的新記錄陣列） */
  commit: (c: { months?: Record<string, Tx[]>; settings?: Settings }) => void;
  /** 寫入前檢查權限；沒權限會顯示提示並回傳 false */
  canWrite: () => boolean;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp 要在 AppProvider 裡使用");
  return v;
}

/** 已經讀到帳本時使用（還沒讀到會丟錯，呼叫端要先確認 ledger 存在） */
export function useLedgerData(): Ledger {
  const { ledger } = useApp();
  if (!ledger) throw new Error("帳本還沒讀到");
  return ledger;
}

export function AppProvider({ children, store: injected }: { children: ReactNode; store?: LedgerStore }) {
  const [snap, setSnap] = useState<LedgerSnapshot>({ settings: null, months: {}, monthsReady: false });
  const [mode, setMode] = useState<AppState["mode"]>("connecting");
  const [today, setToday] = useState(() => ymd(new Date()));
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const storeRef = useRef<LedgerStore | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  useEffect(() => {
    let alive = true;
    let st: LedgerStore | null = null;
    (injected ? Promise.resolve(injected) : openStore()).then((s) => {
      if (!alive) return;
      st = s;
      storeRef.current = s;
      s.start(
        (n) => {
          setSnap(n);
          setMode(s.mode);
        },
        (m) => {
          setMode(s.mode);
          toast(m);
        },
      );
      setMode(s.mode);
    });
    return () => {
      alive = false;
      st?.stop();
    };
  }, [injected, toast]);

  // 跨過午夜時更新今天（切回頁面、取得焦點、每分鐘檢查一次）
  useEffect(() => {
    const check = () => setToday((t) => (ymd(new Date()) === t ? t : ymd(new Date())));
    const timer = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  const writable = mode === "live" || mode === "demo";

  const canWrite = useCallback(() => {
    if (mode === "readonly") {
      toast("你沒有寫入這個帳本的權限");
      return false;
    }
    return true;
  }, [mode, toast]);

  const setSettings = useCallback<AppState["setSettings"]>((fn) => {
    const cur = snapRef.current;
    if (!cur.settings) return;
    const next = fn(cur.settings);
    if (next === cur.settings) return;
    const n = { ...cur, settings: next };
    snapRef.current = n;
    setSnap(n);
    storeRef.current?.writeSettings(next);
  }, []);

  const setMonth = useCallback<AppState["setMonth"]>((key, fn) => {
    const cur = snapRef.current;
    const items = fn((cur.months[key] || { items: [] }).items || []);
    const months: Months = { ...cur.months, [key]: { items } };
    const n = { ...cur, months };
    snapRef.current = n;
    setSnap(n);
    storeRef.current?.writeMonth(key, items);
  }, []);

  const replaceMonth = useCallback<AppState["replaceMonth"]>(async (key, items) => {
    const cur = snapRef.current;
    const n = { ...cur, months: { ...cur.months, [key]: { items: items.slice() } } };
    snapRef.current = n;
    setSnap(n);
    await storeRef.current?.replaceMonth(key, items);
  }, []);

  const commit = useCallback<AppState["commit"]>((c) => {
    const cur = snapRef.current;
    const months: Months = { ...cur.months };
    for (const k in c.months || {}) months[k] = { items: c.months![k] };
    const n = { ...cur, months, settings: c.settings || cur.settings };
    snapRef.current = n;
    setSnap(n);
    const st = storeRef.current;
    for (const k in c.months || {}) st?.writeMonth(k, c.months![k]);
    if (c.settings) st?.writeSettings(c.settings);
  }, []);

  // 補上到期的週期記錄
  useEffect(() => {
    if (!snap.settings || !snap.monthsReady || !writable) return;
    const res = runRecurs(snap.months, snap.settings.recurs, today);
    if (!res.touched.length && !res.settingsChanged) return;
    const st = storeRef.current;
    const n: LedgerSnapshot = { ...snap, months: res.months, settings: res.settingsChanged ? { ...snap.settings, recurs: res.recurs } : snap.settings };
    snapRef.current = n;
    setSnap(n);
    res.touched.forEach((k) => st?.writeMonth(k, res.months[k].items));
    if (res.settingsChanged && n.settings) st?.writeSettings(n.settings);
  }, [snap, today, writable]);

  const ledger = useMemo<Ledger | null>(() => (snap.settings ? { settings: snap.settings, months: snap.months } : null), [snap.settings, snap.months]);

  const value: AppState = { ledger, monthsReady: snap.monthsReady, mode, today, setSettings, setMonth, replaceMonth, commit, canWrite, toast, toastMsg };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
