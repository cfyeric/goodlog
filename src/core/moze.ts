/** 從 MOZE 匯出的 CSV 匯入 */
import type { Card, Category, Group, Ledger, Project, Settings, Tx } from "./types";
import { pad } from "./dates";
import { DEFAULT_GROUP_ICON, DEFAULT_ICON } from "./defaults";

const SWATCHES = ["#dc2626", "#ea580c", "#d97706", "#ca8a04", "#65a30d", "#16a34a", "#059669", "#0d9488", "#0891b2", "#0284c7", "#2563eb", "#4f46e5", "#7c3aed", "#c026d3", "#db2777", "#57534e"];

/** 53 位元雜湊；用來從 CSV 內容產生固定的記錄 id，重複匯入時能認出來 */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface MozeOptions {
  /** 折扣、紅利回饋記成收入 */
  optReward: boolean;
  /** 應收款項記成支出 */
  optRecv: boolean;
  /** 轉進這些帳戶（例如儲蓄帳戶）的轉帳要匯入；不算支出 */
  saveAccs?: string[];
}

export interface MozePlan {
  items: Tx[];
  add: { groups: Group[]; cats: Category[]; cards: Card[]; projects: Project[] };
  /** 各記錄類型的筆數 */
  cnt: Record<string, number>;
  /** 不會匯入的類型與筆數 */
  skip: Record<string, number>;
  /** 之前已經匯入過的筆數 */
  dup: number;
  /** 有轉入記錄的帳戶與筆數（不含信用卡繳款），給使用者選哪些是儲蓄帳戶 */
  xferAccs: Record<string, number>;
  minD: string;
  maxD: string;
}

/** 分析 MOZE 的 CSV：要新增哪些類別、卡片、專案，以及要匯入的記錄。err 有值表示檔案不對 */
export function mozeAnalyze(l: Ledger, rows: string[][], o: MozeOptions, newId: () => string): { plan: MozePlan | null; err: string } {
  const s = l.settings;
  const H = (rows[0] || []).map((x) => String(x).trim());
  const col = (n: string) => H.indexOf(n);
  const ci = { acc: col("帳戶"), type: col("記錄類型"), g: col("主類別"), c: col("子類別"), amt: col("金額"), fee: col("手續費"), dis: col("折扣"), name: col("名稱"), mer: col("商家"), date: col("日期"), time: col("時間"), proj: col("專案"), desc: col("描述"), tags: col("標籤"), obj: col("對象") };
  if (ci.type < 0 || ci.amt < 0 || ci.date < 0) return { plan: null, err: "這不是 MOZE 匯出的 CSV（找不到「記錄類型」「金額」「日期」欄位）。" };
  const groups = (s.groups || []).slice();
  const cats = (s.categories || []).slice();
  const cards = (s.cards || []).slice();
  const projects = (s.projects || []).slice();
  const add: MozePlan["add"] = { groups: [], cats: [], cards: [], projects: [] };
  let sw = groups.length;
  const getGroup = (name: string, type: "expense" | "income") => {
    let g = groups.find((x) => x.name === name && x.type === type);
    if (!g) {
      g = { id: "g" + newId(), name, type, icon: DEFAULT_GROUP_ICON[name] || "tag", color: SWATCHES[(sw++ * 5) % SWATCHES.length] };
      groups.push(g);
      add.groups.push(g);
    }
    return g;
  };
  const getCat = (gname: string, cname: string, type: "expense" | "income") => {
    const g = getGroup(gname || "其他", type);
    const nm = cname || gname || "其他";
    let c = cats.find((x) => x.groupId === g.id && x.name === nm);
    if (!c) {
      c = { id: newId(), name: nm, groupId: g.id, group: g.name, icon: DEFAULT_ICON[nm] || "", type };
      cats.push(c);
      add.cats.push(c);
    }
    return c;
  };
  const getCard = (name: string) => {
    let c = cards.find((x) => x.name === name);
    if (!c) {
      c = { id: newId(), name };
      cards.push(c);
      add.cards.push(c);
    }
    return c;
  };
  const getProj = (name: string) => {
    if (!name) return null;
    let p = projects.find((x) => x.name === name);
    if (!p) {
      p = { id: newId(), name };
      projects.push(p);
      add.projects.push(p);
    }
    return p;
  };
  const existing = new Set<string>();
  for (const k in l.months) for (const t of l.months[k].items || []) existing.add(t.id);
  const cnt: Record<string, number> = {};
  const skip: Record<string, number> = {};
  const seen: Record<string, number> = {};
  const items: Tx[] = [];
  const xferAccs: Record<string, number> = {};
  const save = new Set(o.saveAccs || []);
  // 轉出記錄：日期、時間、金額 → 轉出的帳戶，用來找轉入那一筆是從哪裡轉來的
  const outs: Record<string, string[]> = {};
  for (let i = 1; i < rows.length; i++) {
    const R = rows[i];
    if (!R || ci.type < 0 || String(R[ci.type] ?? "").trim() !== "轉出") continue;
    const k = [R[ci.date], ci.time >= 0 ? R[ci.time] : "", Math.abs(parseFloat(String(R[ci.amt]).replace(/,/g, "")) || 0)].join("|");
    (outs[k] ||= []).push(ci.acc >= 0 ? String(R[ci.acc] ?? "").trim() : "");
  }
  let dup = 0;
  let minD = "9999";
  let maxD = "0000";
  for (let i = 1; i < rows.length; i++) {
    const R = rows[i];
    if (!R || R.length < 3) continue;
    const v = (k: keyof typeof ci) => (ci[k] >= 0 ? String(R[ci[k]] ?? "").trim() : "");
    const ty = v("type");
    if (!ty) continue;
    const ds = v("date").replace(/\//g, "-");
    let type: "expense" | "income" | null = null;
    let gname = v("g");
    let cname = v("c");
    if (ty === "支出") type = "expense";
    else if (ty === "收入") type = "income";
    else if (ty === "手續費") {
      type = "expense";
      gname = "其他";
      cname = "手續費";
    } else if (ty === "紅利回饋" && o.optReward) {
      type = "income";
      gname = "收入";
      cname = "紅利回饋";
    } else if (ty === "折扣" && o.optReward) {
      type = "income";
      gname = "收入";
      cname = "折扣回饋";
    } else if (ty === "應收款項" && o.optRecv) {
      type = "expense";
      gname = "其他";
      cname = cname || "代付";
    }
    const label = (ty === "轉出" || ty === "轉入") && gname === "信用卡繳款" ? "信用卡繳款" : ty === "轉出" || ty === "轉入" ? "轉帳" : ty;
    let xfer = false;
    if (ty === "轉入" && label === "轉帳") {
      const acc = v("acc");
      xferAccs[acc] = (xferAccs[acc] || 0) + 1;
      xfer = save.has(acc);
    }
    if (xfer && /^\d{4}-\d{1,2}-\d{1,2}$/.test(ds)) {
      const [yy, mm, dd] = ds.split("-");
      const date = yy + "-" + pad(+mm) + "-" + pad(+dd);
      const key = R.join("\u0001");
      seen[key] = (seen[key] || 0) + 1;
      const id = "mz" + hash53(key + "#" + seen[key]);
      cnt["轉到儲蓄帳戶"] = (cnt["轉到儲蓄帳戶"] || 0) + 1;
      if (existing.has(id)) {
        dup++;
        continue;
      }
      const amount = Math.abs(parseFloat(v("amt").replace(/,/g, "")) || 0);
      const from = (outs[[R[ci.date], ci.time >= 0 ? R[ci.time] : "", amount].join("|")] || []).shift() || "";
      const t: Tx = {
        id, type: "transfer", amount, date, time: /^\d{1,2}:\d{2}/.test(v("time")) ? v("time").slice(0, 5).padStart(5, "0") : "",
        name: v("name"), note: v("desc"), tags: v("tags").split(/[\s,，]+/).map((x) => x.replace(/^#/, "")).filter(Boolean), toAcc: v("acc"), src: "moze",
      };
      if (from) t.fromAcc = from;
      if (date < minD) minD = date;
      if (date > maxD) maxD = date;
      items.push(t);
      continue;
    }
    if (!type || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(ds)) {
      skip[label] = (skip[label] || 0) + 1;
      continue;
    }
    const [yy, mm, dd] = ds.split("-");
    const date = yy + "-" + pad(+mm) + "-" + pad(+dd);
    const key = R.join("\u0001");
    seen[key] = (seen[key] || 0) + 1;
    const id = "mz" + hash53(key + "#" + seen[key]);
    cnt[label] = (cnt[label] || 0) + 1;
    if (existing.has(id)) {
      dup++;
      continue;
    }
    const num = (k: keyof typeof ci) => Math.abs(parseFloat(v(k).replace(/,/g, "")) || 0);
    const c = getCat(gname, cname, type);
    const p = getProj(v("proj"));
    const acc = v("acc");
    const obj = v("obj");
    const note = [v("desc"), obj && obj !== "不限定對象" ? "對象：" + obj : ""].filter(Boolean).join("\n");
    const t: Tx = {
      id, type, catId: c.id, amount: num("amt"), fee: num("fee"), discount: type === "expense" ? num("dis") : 0, name: v("name"), merchant: v("mer"), note, invoice: "",
      tags: v("tags").split(/[\s,，]+/).map((x) => x.replace(/^#/, "")).filter(Boolean), date,
      time: /^\d{1,2}:\d{2}/.test(v("time")) ? v("time").slice(0, 5).padStart(5, "0") : "", projectId: (p ? p.id : null) as unknown as string, src: "moze",
    };
    if (type === "expense") {
      if (/卡/.test(acc)) {
        t.pay = "card";
        t.cardId = getCard(acc).id;
      } else t.pay = "cash";
    }
    if (type !== "expense") delete t.discount;
    if (date < minD) minD = date;
    if (date > maxD) maxD = date;
    items.push(t);
  }
  return { plan: { items, add, cnt, skip, dup, minD, maxD, xferAccs }, err: items.length || dup || Object.keys(xferAccs).length ? "" : "沒有讀到可以匯入的記錄。" };
}

/** 套用匯入：新設定與變動的月份 */
export function mozeCommit(l: Ledger, P: MozePlan): { settings: Settings; months: Record<string, Tx[]> } {
  const s = l.settings;
  const settings: Settings = {
    ...s,
    groups: s.groups.concat(P.add.groups),
    categories: s.categories.concat(P.add.cats),
    cards: (s.cards || []).concat(P.add.cards),
    projects: (s.projects || []).concat(P.add.projects),
  };
  const byM: Record<string, Tx[]> = {};
  P.items.forEach((t) => (byM[t.date.slice(0, 7)] ||= []).push(t));
  const months: Record<string, Tx[]> = {};
  for (const k in byM) {
    const cur = l.months[k]?.items || [];
    const have = new Set(cur.map((x) => x.id));
    months[k] = cur.concat(byM[k].filter((t) => !have.has(t.id)));
  }
  return { settings, months };
}
