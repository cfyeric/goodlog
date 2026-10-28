/**
 * 用舊版單檔網頁（legacy/goodlog-legacy.html）算出各種核心邏輯的結果，存成 JSON，
 * 讓 tests/legacy-diff.test.ts 拿新版的模組跑同樣的輸入、比對結果是否一模一樣。
 *
 * 用法：
 *   node scripts/legacy-snapshot.mjs                       → 用隨機產生的假資料，輸出 fixtures/legacy-synthetic.json（可提交）
 *   node scripts/legacy-snapshot.mjs <settings.json> <months 資料夾>
 *                                                          → 用真實帳本，輸出 fixtures/private/legacy-real.json（不可提交，已在 .gitignore）
 * 需要 Playwright 和 Chromium（npm i -D playwright && npx playwright install chromium）。
 * 時區固定用 Asia/Taipei 執行：TZ=Asia/Taipei node scripts/legacy-snapshot.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pw = await import(process.env.PLAYWRIGHT_PATH || "playwright");
const chromium = pw.chromium || pw.default.chromium;

/* ---------- 輸入資料 ---------- */

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function syntheticLedger() {
  const R = rng(42);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const categories = ["午餐", "晚餐", "咖啡", "停車", "交通卡", "日用品", "電費"].map((n, i) => ({ id: "c" + i, name: n, type: "expense", groupId: "g0", group: "測試" }));
  categories.push({ id: "ci", name: "薪資", type: "income", groupId: "g1", group: "收入" });
  const settings = {
    categories,
    groups: [{ id: "g0", name: "測試", type: "expense" }, { id: "g1", name: "收入", type: "income" }],
    projects: [{ id: "p0", name: "個人" }, { id: "p1", name: "家庭" }, { id: "p2", name: "旅行", archived: true }],
    cards: [{ id: "J", name: "J卡" }, { id: "E", name: "J卡悠遊卡" }, { id: "C", name: "C卡" }, { id: "X", name: "舊卡", archived: true }],
    aliases: [],
    recurs: [],
  };
  const months = {};
  let n = 0;
  for (let m = 1; m <= 12; m++)
    for (let k = 0; k < 40; k++) {
      const d = "2026-" + String(m).padStart(2, "0") + "-" + String(1 + Math.floor(R() * 28)).padStart(2, "0");
      const r = R();
      let t;
      if (r < 0.05) t = { type: "income", catId: "ci", amount: 30000 + Math.round(R() * 5000) };
      else if (r < 0.1) t = { type: "topup", pay: "card", cardId: "E", amount: 500 };
      else {
        const pay = R() < 0.45 ? "cash" : "card";
        t = { type: "expense", catId: pick(categories.slice(0, 7)).id, amount: Math.round(R() * 2000) + 10, pay };
        if (pay === "card") t.cardId = pick(["J", "E", "C", "X", ""]) || undefined;
        if (R() < 0.15) t.fee = Math.round(R() * 30);
        if (R() < 0.1) t.discount = Math.round(R() * 20);
      }
      t.projectId = pick(["p0", "p1", "p2", ""]);
      if (R() < 0.03) t.pending = true;
      t.id = "s" + n++;
      t.date = d;
      (months[d.slice(0, 7)] ||= { items: [] }).items.push(t);
    }
  return { settings, months };
}

function realLedger(settingsPath, monthsDir) {
  const unwrap = (x) => (x && typeof x.data === "object" && !Array.isArray(x.data) && x.data !== null && !x.categories ? x.data : x);
  const settings = unwrap(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
  const months = {};
  for (const f of fs.readdirSync(monthsDir)) if (f.endsWith(".json")) months[f.replace(".json", "")] = unwrap(JSON.parse(fs.readFileSync(path.join(monthsDir, f), "utf8")));
  return { settings, months };
}

/** 在帳本上加上各種預算、儲值卡、排程規則，盡量走到每一條分支 */
function decorate(L) {
  const s = L.settings;
  const cards = s.cards || [];
  // 名稱含「悠遊」的卡設成同名信用卡的儲值卡；假資料用 E → J
  const sv = cards.find((c) => c.id === "E") || cards.find((c) => /悠遊/.test(c.name) && !c.archived);
  const parent = cards.find((c) => c.id === "J") || (sv && cards.find((c) => c !== sv && !c.svOf && sv.name.includes(c.name)));
  if (sv && parent) Object.assign(sv, { svOf: parent.id, svInit: 320, svDate: "2026-03-15", budget: 800 });
  if (parent) parent.budget = 5000;
  const other = cards.find((c) => c !== sv && c !== parent && !c.archived);
  if (other) Object.assign(other, { budget: 20000, bper: "total" });
  s.cashBudget = { budget: 8000 };
  s.cardBudget = { budget: 15000 };
  (s.projects || []).forEach((p, i) => {
    if (i % 3 === 0) p.budget = 6000;
    if (i % 3 === 1) Object.assign(p, { budget: 50000, bper: "total" });
  });
  const cat = (s.categories || []).find((c) => c.type === "expense");
  const tpl = { type: "expense", amount: 1200, catId: cat && cat.id, name: "電費", pay: "cash" };
  s.recurs = [...(s.recurs || []),
    { id: "rA", kind: "recur", every: 2, unit: "month", dom: 19, start: "2026-08-19", startIdx: 1, count: 0, post: "remind", workday: "after", tpl, done: 0 },
    { id: "rB", kind: "recur", every: 1, unit: "day", wdays: [1, 2, 3, 4, 5], start: "2026-10-01", startIdx: 1, count: 0, post: "now", workday: "same", tpl: { ...tpl, amount: 40, name: "停車" }, done: 0 },
    { id: "rC", kind: "recur", every: 1, unit: "week", dow: 3, start: "2026-09-02", startIdx: 3, count: 12, post: "due", workday: "same", tpl: { ...tpl, amount: 99 }, done: 0 },
    { id: "rD", kind: "recur", every: 1, unit: "year", dom: 29, moy: 2, start: "2028-02-29", startIdx: 1, count: 0, post: "remind", workday: "before", tpl, done: 0 },
    { id: "rE", kind: "once", every: 1, unit: "month", start: "2026-10-30", startIdx: 1, count: 1, post: "remind", workday: "same", tpl, done: 0 },
    { id: "iF", kind: "inst", every: 1, unit: "month", start: "2026-07-05", startIdx: 1, count: 6, post: "due", workday: "same", grace: 1, total: 6000,
      plan: [1, 2, 3, 4, 5, 6].map((i) => ({ amount: 1000, fee: i === 1 ? 30 : 0, discount: 0, interest: 0 })), tpl: { ...tpl, amount: 0 }, done: 0 },
    { id: "lg", freq: "month", start: "2026-06-30", tpl, done: 0 },
    { id: "rG", kind: "recur", every: 3, unit: "day", wdays: [6, 0], start: "2026-10-02", startIdx: 1, count: 0, post: "due", workday: "same", tpl, done: 0 },
  ];
  return L;
}

/** 從帳本的刷卡記錄做出一份「帳單」：有完全相同、日期差幾天、金額差一點、多出來、退款 */
function statements(L) {
  const R = rng(7);
  const out = [];
  const all = Object.values(L.months).flatMap((m) => m.items || []);
  const cards = (L.settings.cards || []).filter((c) => !c.svOf);
  for (const ym of Object.keys(L.months).sort().slice(-6)) {
    for (const c of [...cards.slice(0, 3), { id: "" }]) {
      const tx = all.filter((t) => t.date.startsWith(ym) && !t.pending && (t.type === "expense" || t.type === "topup") && t.pay === "card" && (!c.id || t.cardId === c.id || (t.type === "topup")));
      if (tx.length < 2) continue;
      const items = [];
      tx.forEach((t, i) => {
        const r = R();
        const amt = (t.amount || 0) + (t.type === "expense" ? (t.fee || 0) - (t.discount || 0) : 0);
        if (r < 0.15) return; // 帳本有、帳單沒有
        const d = new Date(t.date);
        d.setDate(d.getDate() + (r < 0.6 ? 0 : r < 0.75 ? 2 : r < 0.85 ? 5 : -1));
        const ds = d.toISOString().slice(0, 10);
        let a = amt;
        if (r > 0.92 && amt >= 100) a = Math.round(amt * 1.03);
        const it = { date: ds, desc: "商店" + i, amount: a, sec: "" };
        if (r > 0.88 && r <= 0.92) it.fee = 5;
        items.push(it);
      });
      items.push({ date: ym + "-15", desc: "多出來的", amount: 4321, sec: "" });
      items.push({ date: ym + "-16", desc: "退款", amount: -200, sec: "" });
      out.push({ cardId: c.id, items, rejected: [1], accepted: [2] });
    }
  }
  return out;
}

const TODAYS = ["2026-03-14", "2026-10-02", "2026-10-21", "2026-10-28", "2026-12-31", "2028-02-25"];

/* ---------- 在舊版網頁裡計算 ---------- */

async function runLegacy(L, stmts) {
  const html = fs.readFileSync(path.join(root, "legacy/goodlog-legacy.html"), "utf8");
  const hook = `window.__L={S,setToday:v=>{today=v},budgetList,svBalance,remindList,occAt,makeOcc,normRule,runRecurs,matchStatement,buildItems,parseDateCell,parseCSV,findCloseDate,guessHeader,guessMap,recurStart,buildPlan,everyText,schedText,recurHint,chargeCard,isSvTx,pd,ymd,card};\nboot();\n})();`;
  const i = html.lastIndexOf("boot();\n})();");
  if (i < 0) throw new Error("找不到舊版網頁的 boot()");
  const tmp = path.join(root, "fixtures/private/.legacy-hooked.html");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, html.slice(0, i) + hook + html.slice(i + "boot();\n})();".length));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext({ timezoneId: "Asia/Taipei" })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("file://" + tmp);
  await page.waitForFunction(() => window.__L && window.__L.S.settings);
  const out = await page.evaluate(
    ({ L, stmts, TODAYS }) => {
      const X = window.__L;
      const S = X.S;
      const clone = (x) => JSON.parse(JSON.stringify(x));
      const load = () => {
        S.settings = clone(L.settings);
        S.months = clone(L.months);
        S.monthsReady = true;
        S.live = false;
      };
      const r = { budgets: {}, sv: {}, remind: {}, occ: {}, run: {}, match: [], misc: {} };
      load();
      const yms = Object.keys(L.months).sort();
      for (const ym of yms) r.budgets[ym] = X.budgetList(ym).map((b) => ({ key: b.key, kind: b.kind, name: b.name, budget: b.budget, per: b.per, spent: b.spent, pct: b.pct }));
      for (const td of TODAYS) {
        X.setToday(X.pd(td));
        r.sv[td] = (S.settings.cards || []).filter((c) => c.svOf).map((c) => ({ id: c.id, bal: X.svBalance(c) }));
        r.remind[td] = X.remindList().map((x) => (x.t ? { due: true, id: x.t.id, date: x.date } : { due: false, rule: x.rule.id, date: x.date, name: x.name, amt: x.amt }));
      }
      for (const rule of L.settings.recurs) {
        const nr = X.normRule(clone(rule));
        r.occ[rule.id] = Array.from({ length: 40 }, (_, j) => X.makeOcc(nr, j));
      }
      for (const td of TODAYS) {
        load();
        X.setToday(X.pd(td));
        X.runRecurs();
        const touched = {};
        for (const k in S.months) {
          const before = (L.months[k] && L.months[k].items.length) || 0;
          if (S.months[k].items.length !== before) touched[k] = S.months[k].items.slice(before);
        }
        r.run[td] = { added: touched, recurs: S.settings.recurs.map((x) => ({ id: x.id, done: x.done || 0 })) };
      }
      load();
      for (const st of stmts) {
        S.imp = { items: st.items, cardId: st.cardId, secMap: {}, rej: new Set(st.rejected), acc: new Set(st.accepted) };
        const m = X.matchStatement();
        r.match.push(m && { res: m.res.map((x) => ({ i: x.i, kind: x.kind, tx: x.tx && x.tx.id, diff: x.diff, feeMissing: x.feeMissing, amtDiff: x.amtDiff })), extra: m.extra.map((t) => t.id), lo: m.lo, hi: m.hi });
      }
      X.setToday(X.pd("2026-10-28"));
      const ds = ["2026/10/27", "115/1/5", "20261027", "10/27", "1/3", "12/30", "2026年2月30日", "abc", "99/13/1", " 2026-10-1 "];
      r.misc.dates = ds.map((d) => [X.parseDateCell(d), X.parseDateCell(d, "2027-01-10")]);
      r.misc.plans = [
        [1000, { instN: 3 }], [1000, { instN: 3, remTo: "last", rounding: "ceil" }], [99999, { instN: 24, interest: "annuity", rate: 15, every: 1, unit: "month", rounding: "round" }],
        [50000, { instN: 12, interest: "principal", rate: 6, every: 1, unit: "month" }], [30000, { instN: 6, interest: "fixed", rate: 3, every: 2, unit: "month", fee: 99 }],
        [8000, { instN: 4, interest: "interestFirst", rate: 10, every: 1, unit: "year" }], [1001, { instN: 7, discount: 100, extrasTo: "each", rounding: "floor" }],
      ].map(([P, o]) => X.buildPlan(P, o));
      r.misc.text = L.settings.recurs.map((x) => [X.everyText(x), X.schedText(x), X.recurHint(x, "2026-10-28")]);
      r.misc.starts = L.settings.recurs.map((x) => ["2026-01-31", "2026-02-28", "2026-10-28", "2026-12-31"].map((d) => X.recurStart(x, d)));
      return r;
    },
    { L, stmts, TODAYS },
  );
  await browser.close();
  fs.unlinkSync(tmp);
  if (errs.length) throw new Error("舊版網頁發生錯誤：" + errs.join("; "));
  return out;
}

const real = process.argv.length >= 4;
const L = decorate(real ? realLedger(process.argv[2], process.argv[3]) : syntheticLedger());
const stmts = statements(L);
const legacy = await runLegacy(L, stmts);
const file = real ? "fixtures/private/legacy-real.json" : "fixtures/legacy-synthetic.json";
fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
fs.writeFileSync(path.join(root, file), JSON.stringify({ todays: TODAYS, ledger: L, statements: stmts, legacy }));
console.log("寫入", file, "月份", Object.keys(L.months).length, "帳單", stmts.length);
