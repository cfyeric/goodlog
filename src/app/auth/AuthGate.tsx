/** Supabase 版的登入畫面：Google 帳號，或輸入信箱 → 點信裡的登入連結（Supabase 內建寄信不能改範本，信裡只有連結） */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { LedgerStore } from "../../data/store";
import { createSupabaseStore } from "../../data/supabaseStore";
import { currentSession, onSessionChange, sendCode, signInGoogle, signOut, supabaseAdapter } from "../../data/supabaseClient";
import { deleteLedger, loadLedger, saveLedger } from "../../data/localCache";

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
  const store = useMemo(
    () =>
      uid
        ? createSupabaseStore(supabaseAdapter(uid), {
            cache: { load: () => loadLedger(uid), save: (v) => void saveLedger(uid, { ...v, at: Date.now() }) },
          })
        : null,
    [uid],
  );
  if (session === undefined)
    return (
      <div className="app">
        <div className="empty" style={{ marginTop: 24 }}>
          <b>正在確認登入狀態…</b>
        </div>
      </div>
    );
  if (!session || !store) return <Login />;
  // 登出時順便刪掉這台裝置上的帳本副本
  const out = async () => {
    await deleteLedger(session.user.id);
    await signOut();
  };
  return <AccountCtx.Provider value={{ email: session.user.email || "", signOut: out }}>{children(store)}</AccountCtx.Provider>;
}

function Login() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("goodlog-email") || "";
    } catch {
      return "";
    }
  });
  const [step, setStep] = useState<"email" | "sent">("email");
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
    setStep("sent");
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
          <>
          <button
            type="button"
            className="btn"
            disabled={busy}
            style={{ width: "100%", height: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            onClick={async () => {
              setBusy(true);
              setErr("");
              const r = await signInGoogle();
              if (r) {
                setBusy(false);
                setErr(r);
              }
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            用 Google 帳號登入
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0", color: "var(--muted-foreground)", fontSize: 12 }}>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            或用信箱登入
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
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
              我們會寄一封有登入連結的信給你，不需要密碼。
            </p>
            {err ? (
              <div className="err" role="alert" style={{ marginTop: 8 }}>
                {err}
              </div>
            ) : null}
            <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", height: 44, marginTop: 14 }}>
              {busy ? "寄送中…" : "寄登入連結"}
            </button>
          </form>
          </>
        ) : (
          <div>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600 }}>請到信箱點登入連結</p>
            <p style={{ margin: 0, fontSize: 14 }}>
              登入連結已寄到 <b>{email.trim()}</b>。打開信，點「Log In」或「Confirm email address」，就會回到好記並完成登入。
            </p>
            <p className="pkhint" style={{ margin: "10px 0 0" }}>
              請用同一支手機或同一台電腦打開信，登入才會留在這裡。沒收到請看看垃圾郵件匣；信是英文的，寄件人是 Supabase。
            </p>
            {err ? (
              <div className="err" role="alert" style={{ marginTop: 8 }}>
                {err}
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStep("email");
                  setErr("");
                }}
              >
                換一個信箱
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void send()}>
                {busy ? "寄送中…" : "重寄一次"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
