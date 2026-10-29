/** Supabase 版的登入畫面：輸入信箱 → 收信取得登入碼 → 輸入登入碼 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { LedgerStore } from "../../data/store";
import { createSupabaseStore } from "../../data/supabaseStore";
import { currentSession, onSessionChange, sendCode, signOut, supabaseAdapter, verifyCode } from "../../data/supabaseClient";

interface Account {
  email: string;
  signOut: () => Promise<void>;
}
const AccountCtx = createContext<Account | null>(null);
/** 目前登入的帳號；不是 Supabase 版時是 null */
export const useAccount = () => useContext(AccountCtx);

export function AuthGate({ children }: { children: (store: LedgerStore) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    currentSession().then(setSession, () => setSession(null));
    return onSessionChange(setSession);
  }, []);
  const uid = session?.user.id;
  // 換帳號才重建；token 更新不用重建
  const store = useMemo(() => (uid ? createSupabaseStore(supabaseAdapter(uid)) : null), [uid]);
  if (session === undefined)
    return (
      <div className="app">
        <div className="empty" style={{ marginTop: 24 }}>
          <b>正在確認登入狀態…</b>
        </div>
      </div>
    );
  if (!session || !store) return <Login />;
  return <AccountCtx.Provider value={{ email: session.user.email || "", signOut }}>{children(store)}</AccountCtx.Provider>;
}

function Login() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("goodlog-email") || "";
    } catch {
      return "";
    }
  });
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = async () => {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setErr("請輸入正確的電子郵件");
    setBusy(true);
    setErr("");
    const r = await sendCode(e);
    setBusy(false);
    if (r) return setErr(r);
    try {
      localStorage.setItem("goodlog-email", e);
    } catch {
      /* 不能存就算了 */
    }
    setStep("code");
  };
  const verify = async () => {
    const t = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(t)) return setErr("請輸入信裡的數字登入碼");
    setBusy(true);
    setErr("");
    const r = await verifyCode(email.trim(), t);
    setBusy(false);
    if (r) setErr(r);
  };
  return (
    <div className="app">
      <div className="top">
        <h1>
          好記<small>登入你的帳本</small>
        </h1>
      </div>
      <div className="card" style={{ marginTop: 8 }}>
        {step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="namefield">
              <label htmlFor="lg-email">電子郵件</label>
              <input id="lg-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <p className="pkhint" style={{ margin: "8px 0 0" }}>
              我們會寄一封有登入碼的信給你，不需要密碼。
            </p>
            {err ? (
              <div className="err" role="alert" style={{ marginTop: 8 }}>
                {err}
              </div>
            ) : null}
            <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 14 }}>
              {busy ? "寄送中…" : "寄登入碼"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <p style={{ margin: "0 0 10px", fontSize: 14 }}>
              登入碼已寄到 <b>{email.trim()}</b>，請到信箱查看。
            </p>
            <div className="namefield">
              <label htmlFor="lg-code">登入碼</label>
              <input id="lg-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="信裡的數字" autoFocus />
            </div>
            {err ? (
              <div className="err" role="alert" style={{ marginTop: 8 }}>
                {err}
              </div>
            ) : null}
            <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 14 }}>
              {busy ? "登入中…" : "登入"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setErr("");
                }}
              >
                換一個信箱
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void send()}>
                重寄一次
              </button>
            </div>
            <p className="pkhint" style={{ margin: "10px 0 0" }}>
              信裡如果是連結而不是數字，直接點連結也可以登入。沒收到請看看垃圾郵件匣。
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
