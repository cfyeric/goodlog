/** 報表頁：總覽、類別（圓餅、下鑽）、排行、帳戶、專案 */
import type { Group, Ledger, Settings, Tx } from "../../core/types";
import { allTx, cardOf, findCategory, findGroup, findProject, payOf } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { reportRange, shiftAnchor, type ReportMode } from "../../core/report";
import { useNav, type Nav, type ReportTab } from "../nav";
import { Ic, Seal, UiIcon, type SealLike } from "../ui/Icon";
import { TxRow } from "../ui/TxRow";
import { HpBar } from "../ui/HpBar";

const RTABS: [ReportTab, string][] = [
  ["overview", "總覽"],
  ["cat", "類別"],
  ["rank", "排行"],
  ["acc", "帳戶"],
  ["proj", "專案"],
];

const pct1 = (v: number, tot: number) => (Math.round((v / tot) * 1000) / 10).toFixed(1);

/** 同色系由深到淺 */
function shade(base: string, i: number) {
  return i === 0 ? base : `color-mix(in oklch,${base} ${Math.max(100 - i * 14, 24)}%,var(--background))`;
}

interface Slice {
  name: string;
  v: number;
  col: string;
}

/** 大圓餅圖：引線一律水平，左右兩側標籤互相錯開（跟舊版相同的排版） */
function Donut({ sl, total, label }: { sl: Slice[]; total: number; label: string }) {
  const W = 360, H = 290, cx = W / 2, cy = H / 2, R = 106, SW = 46, r0 = R - SW / 2, C = 2 * Math.PI * r0, GAP = 30;
  let acc = 0;
  const gap = sl.length > 1 ? 1.6 : 0;
  // 把尾端的小項目轉到左側中間（9 點鐘方向），那裡垂直空間最多，水平引線才拉得開
  let tail = 0;
  for (let i = sl.length - 1; i > 0 && sl[i].v / total < 0.1; i--) tail += sl[i].v / total;
  const base = tail > 0 ? Math.PI - (1 - tail / 2) * 2 * Math.PI : -Math.PI / 2;
  const deg = (base * 180) / Math.PI;
  const arcs = sl.map((o) => {
    const len = (o.v / total) * C;
    const off = -acc;
    const a0 = (acc / C) * 2 * Math.PI + base, a1 = ((acc + len) / C) * 2 * Math.PI + base;
    acc += len;
    return { len, off, a0, a1, mid: (a0 + a1) / 2, o };
  });
  type Lab = { o: Slice; a0: number; a1: number; mid: number; side: number; y0: number; lo: number; hi: number; y: number; px: number; ay: number; ath: number };
  const lab: Lab[] = arcs.map((x) => ({ o: x.o, a0: x.a0, a1: x.a1, mid: x.mid, side: Math.cos(x.mid) >= 0 ? 1 : -1, y0: cy + Math.sin(x.mid) * r0, lo: 0, hi: 0, y: 0, px: 0, ay: 0, ath: 0 }));
  lab.forEach((l) => {
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k <= 40; k++) {
      const th = l.a0 + ((l.a1 - l.a0) * k) / 40;
      if (sl.length > 1 && Math.cos(th) * l.side < 0.05) continue;
      const y = cy + Math.sin(th) * r0;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (lo > hi) lo = hi = l.y0;
    l.lo = Math.max(lo, 18);
    l.hi = Math.min(hi, H - 18);
  });
  // 同一側的標籤上下至少間隔 GAP：太擠時可以離開自己那一塊的高度，引線改成折線連過去
  [1, -1].forEach((sd) => {
    const L = lab.filter((l) => l.side === sd).sort((a, b) => a.y0 - b.y0);
    if (!L.length) return;
    const top = 18, bot = H - 18;
    const gap = L.length > 1 ? Math.min(GAP, (bot - top) / (L.length - 1)) : GAP;
    // 先放在理想位置（這一塊的中間高度，限制在這一塊的範圍內），由上往下推開
    let prev = -1e9;
    L.forEach((l) => {
      const ideal = Math.min(Math.max(l.y0, l.lo), Math.max(l.hi, l.lo));
      l.y = Math.max(ideal, prev + gap, top);
      prev = l.y;
    });
    // 超出底部的話由下往上推回來
    let nx = bot + gap;
    for (let i = L.length - 1; i >= 0; i--) {
      L[i].y = Math.min(L[i].y, nx - gap);
      nx = L[i].y;
    }
    L.forEach((l) => {
      l.y = Math.min(Math.max(l.y, top), bot);
    });
  });
  // 每條引線都水平：在這一塊的範圍內找與標籤同高的起點
  lab.forEach((l) => {
    const pad = Math.min(0.06, (l.a1 - l.a0) / 4);
    let best: { d?: number; th: number; py: number } | null = null;
    for (let k = 0; k <= 48; k++) {
      const th = l.a0 + pad + ((l.a1 - l.a0 - 2 * pad) * k) / 48;
      if (Math.cos(th) * l.side < 0.05 && sl.length > 1) continue;
      const py = cy + Math.sin(th) * r0, d = Math.abs(py - l.y);
      if (!best || d < best.d!) best = { d, th, py };
    }
    if (!best) best = { th: l.mid, py: cy + Math.sin(l.mid) * r0 };
    if ((best.d as number) > 1) {
      const s2 = (l.y - cy) / r0;
      if (Math.abs(s2) <= 1) {
        const th = Math.asin(s2);
        const th2 = l.side > 0 ? th : Math.PI - th;
        const norm = (a: number) => {
          while (a < l.a0) a += 2 * Math.PI;
          return a;
        };
        if (norm(th2) <= l.a1) best = { th: th2, py: l.y };
      }
    }
    l.px = cx + Math.cos(best.th) * r0;
    // 標籤跟這一塊同高就畫水平線；被推開了就從這一塊畫折線過去
    l.ay = best.py;
    l.ath = best.th;
    if (Math.abs(best.py - l.y) <= 1) l.y = best.py;
  });
  const cut = (t: string, maxW: number) => {
    const w = (ch: string) => (/[\x00-\xff]/.test(ch) ? 7 : 12);
    let tw = 0;
    for (const ch of t) tw += w(ch);
    if (tw <= maxW) return t;
    let o = "", u = 0;
    for (const ch of t) {
      if (u + w(ch) > maxW - 12) break;
      o += ch;
      u += w(ch);
    }
    return o + "…";
  };
  const aria = label + "比例：" + sl.map((o) => o.name + " " + Math.round((o.v / total) * 1000) / 10 + "%").join("，");
  return (
    <svg className="bigdonut" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
      {arcs.map((x, i) => (
        <circle key={i} cx={cx} cy={cy} r={r0} fill="none" style={{ stroke: x.o.col }} strokeWidth={SW} strokeDasharray={`${sl.length > 1 ? Math.max(x.len - gap, 0.3) : C} ${C}`} strokeDashoffset={x.off} transform={`rotate(${deg.toFixed(3)} ${cx} ${cy})`} />
      ))}
      {lab.map((l, i) => {
        const ex = cx + l.side * (R + 12), tx = cx + l.side * (R + 14);
        const anc = l.side > 0 ? "start" : "end";
        return (
          <g key={"l" + i}>
            {l.ay === l.y ? (
              <line x1={l.px.toFixed(1)} y1={l.y.toFixed(1)} x2={ex.toFixed(1)} y2={l.y.toFixed(1)} stroke="var(--foreground)" strokeOpacity=".55" strokeWidth="1" />
            ) : (
              <polyline
                points={`${l.px.toFixed(1)},${l.ay.toFixed(1)} ${(cx + Math.cos(l.ath) * (R + 4)).toFixed(1)},${(cy + Math.sin(l.ath) * (R + 4)).toFixed(1)} ${(ex - l.side * 2).toFixed(1)},${l.y.toFixed(1)} ${ex.toFixed(1)},${l.y.toFixed(1)}`}
                fill="none"
                stroke="var(--foreground)"
                strokeOpacity=".55"
                strokeWidth="1"
              />
            )}
            <circle cx={l.px.toFixed(1)} cy={l.ay.toFixed(1)} r="1.8" fill="var(--foreground)" fillOpacity=".7" />
            <text x={tx} y={(l.y - 4).toFixed(1)} textAnchor={anc} fontSize="12" fill="var(--foreground)">
              {cut(l.o.name, cx - R - 14 - 2)}
            </text>
            <text x={tx} y={(l.y + 12).toFixed(1)} textAnchor={anc} fontSize="11" fill="var(--muted-foreground)" fontFamily="Geist,sans-serif">
              {pct1(l.o.v, total)}%
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="12.5" fill="var(--muted-foreground)">
        {label}
      </text>
      <text x={cx} y={cy + 17} textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--foreground)" fontFamily="Geist,sans-serif">
        {formatMoney(total)}
      </text>
    </svg>
  );
}

/** 總覽的類別小圓環 */
function Ring({ col, p }: { col: string; p: string }) {
  const R = 34, C = 2 * Math.PI * R, len = (Math.min(+p, 100) / 100) * C;
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r={R} fill="none" stroke={col} strokeOpacity=".22" strokeWidth="7" />
      {len > 0 ? <circle cx="42" cy="42" r={R} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${len >= C - 0.01 ? C : Math.max(len, 0.01)} ${C}`} transform="rotate(-90 42 42)" /> : null}
      <text x="42" y="46.5" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)" fontFamily="Geist,sans-serif">
        {p}%
      </text>
    </svg>
  );
}

const scrollTabs = (smooth?: boolean, onlyIfAbove?: boolean) =>
  requestAnimationFrame(() => {
    const t = document.querySelector(".rtabs");
    if (t && (!onlyIfAbove || t.getBoundingClientRect().top < 0)) t.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  });

export function Reports({ ledger }: { ledger: Ledger }) {
  const { nav, go } = useNav();
  const s = ledger.settings;
  const r = reportRange(nav.rMode, nav.rAnchor);
  const all = allTx(ledger).filter((t) => t.date >= r.s && t.date <= r.e);
  return (
    <>
      <div className="top">
        <h1>
          報表<small>{all.length} 筆記錄</small>
        </h1>
        <div className="seg" role="tablist">
          {([["week", "週"], ["month", "月"], ["year", "年"]] as [ReportMode, string][]).map(([k, l]) => (
            <button key={k} className={nav.rMode === k ? "on" : ""} onClick={() => go({ rMode: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="period">
        <button className="iconbtn" aria-label="上一期" onClick={() => go((n) => ({ rAnchor: shiftAnchor(n.rMode, n.rAnchor, -1) }))}>
          <UiIcon name="left" />
        </button>
        <span className="lbl">{r.label}</span>
        <button className="iconbtn" aria-label="下一期" onClick={() => go((n) => ({ rAnchor: shiftAnchor(n.rMode, n.rAnchor, 1) }))}>
          <UiIcon name="right" />
        </button>
      </div>
      <div className="rtabs" role="tablist">
        {RTABS.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={nav.rTab === k}
            className={nav.rTab === k ? "on" : ""}
            onClick={(e) => {
              go({ rTab: k, rDrill: null, rSub: null, rKey: null, rRankAll: false });
              e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {nav.rTab === "overview" ? <Overview s={s} tx={all} saves={savesIn(ledger, r.s, r.e)} showSave={hasSaves(ledger)} /> : <ReportTabView s={s} tx={all} nav={nav} />}
    </>
  );
}

/** 期間內轉到儲蓄帳戶的轉帳（不算支出） */
function savesIn(l: Ledger, s: string, e: string): Tx[] {
  const out: Tx[] = [];
  for (const k in l.months) for (const t of l.months[k].items || []) if (t.type === "transfer" && t.date >= s && t.date <= e) out.push(t);
  return out;
}
const hasSaves = (l: Ledger) => Object.values(l.months).some((m) => (m.items || []).some((t) => t.type === "transfer"));

function Overview({ s, tx, saves, showSave }: { s: Settings; tx: Tx[]; saves: Tx[]; showSave: boolean }) {
  const { go } = useNav();
  const exp = tx.filter((t) => t.type === "expense"), inc = tx.filter((t) => t.type === "income");
  const E = exp.reduce((a, t) => a + net(t), 0), N = inc.reduce((a, t) => a + net(t), 0);
  const SV = saves.reduce((a, t) => a + (+t.amount || 0), 0);
  const groups: Record<string, { v: number; col: string; gid: string }> = {};
  exp.forEach((t) => {
    const c = findCategory(s, t.catId);
    const gg = c ? findGroup(s, c.groupId) : undefined;
    const g = gg ? gg.name : "未分類";
    const col = gg ? gg.color : c ? c.color : "#8A8F8B";
    groups[g] = groups[g] || { v: 0, col: col || "#8A8F8B", gid: gg ? gg.id : "" };
    groups[g].v += net(t);
  });
  const gl = Object.entries(groups).sort((a, b) => b[1].v - a[1].v);
  const pctOf = (v: number) => (E ? pct1(v, E) : "0.0");
  const top3 = gl.slice(0, 3);
  const top = exp.slice().sort((a, b) => net(b) - net(a)).slice(0, 3);
  return (
    <div className="stack">
      <div className="card">
        <HpBar inc={N} exp={E} save={SV} showSave={showSave} />
      </div>
      <div className="card">
        <div className="lbl-s" style={{ marginBottom: 12 }}>
          支出類別 前三名
        </div>
        {E > 0 ? (
          <div className="rings">
            {top3.map(([g, o]) => {
              const inner = (
                <>
                  <Ring col={o.col} p={pctOf(o.v)} />
                  <span className="rn">{g}</span>
                  <b className="num">{formatMoney(o.v)}</b>
                </>
              );
              const aria = `${g} ${formatMoney(o.v)}，佔支出 ${pctOf(o.v)}%${o.gid ? "，點開看子類別" : ""}`;
              return o.gid ? (
                <button
                  key={g}
                  className="ringc"
                  aria-label={aria}
                  onClick={() => {
                    go({ rTab: "cat", rType: "expense", rDrill: o.gid, rSub: null });
                    scrollTabs(true);
                  }}
                >
                  {inner}
                </button>
              ) : (
                <div key={g} className="ringc" aria-label={aria}>
                  {inner}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty" style={{ border: 0, padding: 16 }}>
            這段期間沒有支出
          </div>
        )}
      </div>
      {top.length ? (
        <div className="card" style={{ padding: "12px 12px 4px" }}>
          <div className="lbl-s">最大三筆支出</div>
          <div className="list">
            {top.map((t) => (
              <TxRow key={t.id} t={t} s={s} showDate />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface Ent {
  key: string;
  name: string;
  v: number;
  n: number;
  col?: string;
  obj?: SealLike;
  icon?: string;
}

function ReportTabView({ s, tx: inRange, nav }: { s: Settings; tx: Tx[]; nav: Nav }) {
  const { go } = useNav();
  const ty = nav.rType;
  const tx = inRange.filter((t) => t.type === ty);
  const base = ty === "expense" ? "var(--exp)" : "var(--inc)";
  const tyl = ty === "expense" ? "支出" : "收入";
  const col = base;
  const sortBtn = (
    <button
      className="sortbtn"
      aria-label={`目前${nav.rAsc ? "金額由小到大" : "金額由大到小"}，點一下改成${nav.rAsc ? "由大到小" : "由小到大"}`}
      title={nav.rAsc ? "金額由小到大" : "金額由大到小"}
      onClick={() => go((n) => ({ rAsc: !n.rAsc }))}
    >
      <Ic name={nav.rAsc ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow"} />
    </button>
  );
  const typeSeg = (extra?: React.ReactNode) => (
    <div className="rtype">
      {([["expense", "支出"], ["income", "收入"]] as const).map(([k, l]) => (
        <button key={k} className={ty === k ? "on" : ""} onClick={() => go({ rType: k, rDrill: null, rSub: null, rKey: null })}>
          <i style={{ background: k === "expense" ? "var(--exp)" : "var(--inc)" }} />
          {l}
        </button>
      ))}
      {extra}
    </div>
  );
  const srt = (l: Tx[]) => l.sort((a, b) => (nav.rAsc ? net(a) - net(b) : net(b) - net(a)) || b.date.localeCompare(a.date));
  const detail = (onBack: () => void, backLabel: string, obj: SealLike & { name: string }, list: Tx[]) => {
    const hd = (
      <div className="rdrill">
        <button className="chip-back" onClick={onBack}>
          <UiIcon name="left" />
          <span>{backLabel}</span>
        </button>
        <Seal c={obj} s={s} sm />
        <b>{obj.name}</b>
        {sortBtn}
      </div>
    );
    if (!list.length)
      return (
        <>
          {typeSeg()}
          <div className="card rcard">
            {hd}
            <div className="empty" style={{ border: 0, padding: 16 }}>
              這段期間沒有「{obj.name}」的記錄
            </div>
          </div>
        </>
      );
    srt(list);
    const st = list.reduce((a, t) => a + net(t), 0);
    return (
      <>
        {typeSeg()}
        <div className="card rcard">
          {hd}
          <div className="rsum">
            <div>
              <span>合計</span>
              <b className="num" style={{ color: col }}>
                {formatMoney(st)}
              </b>
            </div>
            <div>
              <span>筆數</span>
              <b className="num">{list.length}</b>
            </div>
            <div>
              <span>平均</span>
              <b className="num">{formatMoney(Math.round(st / list.length))}</b>
            </div>
          </div>
          <div className="list">
            {list.map((t) => (
              <TxRow key={t.id} t={t} s={s} showDate />
            ))}
          </div>
        </div>
      </>
    );
  };
  const accKey = (t: Tx) => (payOf(s, t) === "cash" ? "cash" : "card:" + (cardOf(s, t)?.id || ""));
  const accMeta = (k: string) => {
    if (k === "cash") return { name: "現金", icon: "banknote" };
    const c = (s.cards || []).find((x) => "card:" + x.id === k);
    return { name: c ? c.name : "信用卡", icon: "credit-card" };
  };
  const projKey = (t: Tx) => findProject(s, t.projectId)?.id || "_";
  const projMeta = (k: string) => {
    const p = k === "_" ? null : findProject(s, k);
    return { name: p ? p.name : "未指定專案", icon: "briefcase" };
  };
  if (nav.rKey && (nav.rTab === "acc" || nav.rTab === "proj")) {
    const A = nav.rTab === "acc";
    const meta = (A ? accMeta : projMeta)(nav.rKey);
    return detail(() => go({ rKey: null }), A ? "全部帳戶" : "全部專案", { color: base, ...meta }, tx.filter((t) => (A ? accKey : projKey)(t) === nav.rKey));
  }
  if (!tx.length)
    return (
      <>
        {typeSeg()}
        <div className="empty">
          <b>這段期間沒有{tyl}</b>換個期間或切換{ty === "expense" ? "收入" : "支出"}看看。
        </div>
      </>
    );
  if (nav.rTab === "rank") {
    const list = srt(tx.slice());
    const lim = nav.rRankAll ? list : list.slice(0, 50);
    return (
      <>
        {typeSeg(sortBtn)}
        <div className="card" style={{ padding: "4px 12px" }}>
          <div className="list">
            {lim.map((t) => (
              <TxRow key={t.id} t={t} s={s} showDate />
            ))}
          </div>
        </div>
        {list.length > lim.length ? (
          <button className="addbtn" style={{ width: "100%", height: 40, marginTop: 12 }} onClick={() => go({ rRankAll: true })}>
            顯示全部 {list.length} 筆
          </button>
        ) : null}
      </>
    );
  }
  const m = new Map<string, Ent>();
  const add = (key: string, mk: () => Partial<Ent> & { name: string }, t: Tx) => {
    if (!m.has(key)) m.set(key, { key, v: 0, n: 0, ...mk() });
    const o = m.get(key)!;
    o.v += net(t);
    o.n++;
  };
  let drillG: Group | null = null;
  if (nav.rTab === "cat") {
    const dg = nav.rDrill ? findGroup(s, nav.rDrill) : undefined;
    drillG = dg && dg.type === ty ? dg : null;
    const sc = drillG && nav.rSub ? findCategory(s, nav.rSub) : undefined;
    if (sc && drillG && sc.groupId === drillG.id) return detail(() => go({ rSub: null }), drillG.name, sc, tx.filter((t) => t.catId === sc.id));
    tx.forEach((t) => {
      const c = findCategory(s, t.catId);
      const g = c ? findGroup(s, c.groupId) : undefined;
      if (drillG) {
        if (!g || g.id !== drillG.id) return;
        add(c!.id, () => ({ name: c!.name, obj: c }), t);
      } else
        add(g ? g.id : "_", () => (g ? { name: g.name, obj: g, col: g.color || "#8A8F8B" } : { name: "未分類", obj: { name: "未分類", color: "#8A8F8B", icon: "tag" }, col: "#8A8F8B" }), t);
    });
  } else if (nav.rTab === "acc") {
    tx.forEach((t) => {
      const k = accKey(t);
      add(k, () => accMeta(k), t);
    });
  } else {
    tx.forEach((t) => {
      const k = projKey(t);
      add(k, () => projMeta(k), t);
    });
  }
  const ents = [...m.values()].sort((a, b) => b.v - a.v);
  const tot = ents.reduce((a, o) => a + o.v, 0);
  ents.forEach((o, i) => {
    if (!o.col) o.col = drillG ? shade(drillG.color || "#8A8F8B", i) : shade(base, i);
    if (!o.obj) o.obj = { name: o.name, color: o.col, icon: o.icon };
  });
  // 圓餅：小項目和第 8 名之後合併成「其他」
  const sl: Slice[] = [];
  let other = 0;
  ents.forEach((o, i) => {
    if (i < 7 && (o.v / tot >= 0.03 || i < 3)) sl.push({ name: o.name, v: o.v, col: o.col! });
    else other += o.v;
  });
  if (other > 0) sl.push({ name: "其他", v: other, col: "var(--muted-foreground)" });
  const dg = drillG;
  return (
    <>
      {typeSeg()}
      <div className="card rcard">
        {dg ? (
          <div className="rdrill">
            <button className="chip-back" onClick={() => go({ rDrill: null, rSub: null })}>
              <UiIcon name="left" />
              <span>全部類別</span>
            </button>
            <Seal c={dg} s={s} sm />
            <b>{dg.name}</b>
          </div>
        ) : null}
        <Donut sl={sl} total={tot} label={dg ? dg.name : tyl} />
        <div className="rlist">
          {ents.map((o) => {
            const clickable = nav.rTab !== "cat" || o.key !== "_";
            const inner = (
              <>
                <Seal c={o.obj} s={s} />
                <span className="nm">
                  {o.name} <span className="c">({o.n})</span>
                </span>
                <span className="pc">{pct1(o.v, tot)}%</span>
                <b className="num" style={{ color: col }}>
                  {formatMoney(o.v)}
                </b>
                {clickable ? <Ic name="chevron-right" /> : null}
              </>
            );
            if (!clickable)
              return (
                <div key={o.key} className="rrow">
                  {inner}
                </div>
              );
            const onClick = () => {
              if (nav.rTab !== "cat") go({ rKey: o.key });
              else if (dg) go({ rSub: o.key });
              else go({ rDrill: o.key, rSub: null });
              if (nav.rTab !== "cat" || dg) scrollTabs(false, true);
            };
            return (
              <button key={o.key} className="rrow" onClick={onClick}>
                {inner}
              </button>
            );
          })}
        </div>
        <div className="rtotal">
          <span>總計</span>
          <b className="num" style={{ color: col }}>
            {formatMoney(tot)}
          </b>
        </div>
      </div>
    </>
  );
}
