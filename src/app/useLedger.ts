import { useEffect, useState } from "react";
import { openStore, type LedgerSnapshot, type LedgerStore } from "../data";

/** 連上資料來源並訂閱變動；store 為 null 表示還在連線 */
export function useLedger() {
  const [store, setStore] = useState<LedgerStore | null>(null);
  const [snap, setSnap] = useState<LedgerSnapshot>({ settings: null, months: {}, monthsReady: false });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let st: LedgerStore | null = null;
    openStore().then((s) => {
      if (!alive) return;
      st = s;
      setStore(s);
      s.start(setSnap, setError);
    });
    return () => {
      alive = false;
      st?.stop();
    };
  }, []);
  return { store, snap, error };
}
