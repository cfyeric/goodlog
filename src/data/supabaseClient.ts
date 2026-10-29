/**
 * Supabase 連線、登入，以及 SupaAdapter 的實作。
 * 網址和 publishable key 來自建置設定（.env.web）。這兩個值本來就會出現在網頁裡，
 * 資料靠資料庫的 Row Level Security 保護：只有登入的本人讀得到自己的帳本。
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Settings, Tx } from "../core/types";
import type { Row, SupaAdapter } from "./supabaseStore";

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

/** 這次建置有沒有設定 Supabase（沒有就照舊：claude.ai 雲端或範例資料） */
export const supabaseConfigured = !!(URL_ && KEY);

let client: SupabaseClient | null = null;
export function supa(): SupabaseClient {
  if (!client) client = createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "goodlog-auth" } });
  return client;
}

/** 目前登入的帳號（設定頁顯示用） */
export async function currentSession(): Promise<Session | null> {
  const { data } = await supa().auth.getSession();
  return data.session;
}

export function onSessionChange(cb: (s: Session | null) => void): () => void {
  const { data } = supa().auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}

/** 寄登入碼到信箱。新信箱會自動建立帳號（之後可以在 Supabase 後台關掉註冊） */
export async function sendCode(email: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  return error ? errText(error.message, error.status) : null;
}

export async function verifyCode(email: string, token: string): Promise<string | null> {
  const { error } = await supa().auth.verifyOtp({ email, token, type: "email" });
  return error ? errText(error.message, error.status) : null;
}

/** 用 Google 帳號登入：跳到 Google 選帳號，完成後回到好記 */
export async function signInGoogle(): Promise<string | null> {
  const { error } = await supa().auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  return error ? errText(error.message, error.status) : null;
}

export async function signOut(): Promise<void> {
  await supa().auth.signOut();
}

function errText(msg: string, status?: number): string {
  if (status === 429 || /rate limit/i.test(msg)) return "寄信太頻繁了，請等幾分鐘再試";
  if (/expired|invalid/i.test(msg)) return "登入碼不對或已過期，請重新寄一次";
  if (/signups not allowed|not allowed/i.test(msg)) return "這個信箱沒有帳號";
  if (/fetch|network/i.test(msg)) return "連不上伺服器，請確認網路";
  return "登入失敗：" + msg;
}

/** 唯一值衝突（別台裝置剛好先建立了同一列） */
const isConflict = (e: { code?: string } | null) => !!e && e.code === "23505";

export function supabaseAdapter(uid: string): SupaAdapter {
  const sb = supa();
  const S = () => sb.from("ledger_settings");
  const M = () => sb.from("ledger_months");
  const must = <T>(r: { data: T; error: { message: string; code?: string } | null }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async getSettings() {
      const d = must(await S().select("data,rev").eq("user_id", uid).maybeSingle());
      return d ? { value: d.data as Settings, rev: d.rev as number } : null;
    },
    async settingsRev() {
      const d = must(await S().select("rev").eq("user_id", uid).maybeSingle());
      return d ? (d.rev as number) : null;
    },
    async insertSettings(data) {
      const r = await S().insert({ user_id: uid, data }).select("rev").single();
      if (isConflict(r.error)) return null;
      return (must(r) as { rev: number }).rev;
    },
    async updateSettings(data, rev) {
      const d = must(await S().update({ data, rev: rev + 1 }).eq("user_id", uid).eq("rev", rev).select("rev"));
      return d && d.length ? (d[0].rev as number) : null;
    },
    async monthRevs() {
      const d = must(await M().select("ym,rev").eq("user_id", uid));
      const o: Record<string, number> = {};
      (d || []).forEach((r) => (o[r.ym as string] = r.rev as number));
      return o;
    },
    async getMonths(yms) {
      let q = M().select("ym,items,rev").eq("user_id", uid);
      if (yms) q = q.in("ym", yms);
      const d = must(await q);
      const o: Record<string, Row<Tx[]>> = {};
      (d || []).forEach((r) => (o[r.ym as string] = { value: r.items as Tx[], rev: r.rev as number }));
      return o;
    },
    async insertMonth(ym, items) {
      const r = await M().insert({ user_id: uid, ym, items }).select("rev").single();
      if (isConflict(r.error)) return null;
      return (must(r) as { rev: number }).rev;
    },
    async updateMonth(ym, items, rev) {
      const d = must(await M().update({ items, rev: rev + 1 }).eq("user_id", uid).eq("ym", ym).eq("rev", rev).select("rev"));
      return d && d.length ? (d[0].rev as number) : null;
    },
  };
}
