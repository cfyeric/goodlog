/** 帳戶頁：現金、信用卡（含悠遊聯名卡）、帳戶設定 */
import { Fragment } from "react";
import type { Card, Ledger, Settings } from "../../core/types";
import { chargeCard, findCard, isSvTx, payOf, svBalance, svChildOf, svParent } from "../../core/ledger";
import { formatMoney, formatSigned, net } from "../../core/money";
import { budgetList, type BudgetStatus } from "../../core/budget";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useNav } from "../nav";
import { useOverlay } from "../editor/context";
import { Ic, Seal, UiIcon } from "../ui/Icon";
import { savingAccounts } from "../editor/TransferDialog";
import { BMini, BudgetRow, EntRow, GearBtn, LazyInput, MonthHead, OptRow, RecursCard, SelList, SwitchRow } from "./common";

const PAY_COLOR = { cash: "var(--foreground)", card: "var(--xfer)" };

export function Accounts({ ledger, onImport }: { ledger: Ledger; onImport: () => void }) {
  const { today, setSettings, canWrite, toast } = useApp();
  const { nav, go } = useNav();
  const { openTopup, openXfer } = useOverlay();
  const s = ledger.settings;
  const addCard = () => {
    if (!canWrite()) return;
    const id = uid8();
    setSettings((st) => ({ ...st, cards: (st.cards || []).concat([{ id, name: "新的信用卡" }]) }));
    go({ accSel: "card:" + id, accSet: id });
    window.scrollTo(0, 0);
    setTimeout(() => {
      const el = document.getElementById("as-name") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
    toast("已新增，先幫它取個名字");
  };
  const head = <MonthHead title="帳戶" onAdd={addCard} addLabel="新增信用卡" />;
  if (nav.accSet) return (
    <>
      {head}
      <AccSettings ledger={ledger} k={nav.accSet} />
    </>
  );

  const ym = nav.payYm;
  const its = (ledger.months[ym]?.items || []).filter((t) => !t.pending);
  const exp = its.filter((t) => t.type === "expense");
  const bl: Record<string, BudgetStatus> = {};
  budgetList(ledger, ym).forEach((x) => (bl[x.key] = x));
  const cards = s.cards || [];
  const svs = cards.filter((c) => svParent(s, c));
  const chg: Record<string, { v: number; n: number; top: number }> = {};
  const use: Record<string, { v: number; n: number }> = {};
  let ctV = 0;
  let ctN = 0;
  its.forEach((t) => {
    const pc = chargeCard(s, t);
    if (pc) {
      const k = pc.id || "";
      chg[k] = chg[k] || { v: 0, n: 0, top: 0 };
      const v = t.type === "topup" ? +t.amount || 0 : net(t);
      chg[k].v += v;
      chg[k].n++;
      if (t.type === "topup") chg[k].top += v;
      ctV += v;
      ctN++;
    }
    if (isSvTx(s, t)) {
      const k = t.cardId!;
      use[k] = use[k] || { v: 0, n: 0 };
      use[k].v += net(t);
      use[k].n++;
    }
  });
  const cashL = exp.filter((t) => payOf(s, t) === "cash");
  const cashV = cashL.reduce((a, t) => a + net(t), 0);
  const svUseV = Object.values(use).reduce((a, o) => a + o.v, 0);
  const svUseN = Object.values(use).reduce((a, o) => a + o.n, 0);
  const cardUseL = exp.filter((t) => payOf(s, t) === "card" && !isSvTx(s, t));
  const cardUseV = cardUseL.reduce((a, t) => a + net(t), 0);
  // 轉到儲蓄帳戶（轉帳不算支出）：依轉入的帳戶加總
  const xfers = its.filter((t) => t.type === "transfer");
  const saveAccs = savingAccounts(ledger.months);
  const saveBy: Record<string, { v: number; n: number }> = {};
  xfers.forEach((t) => {
    const k = t.toAcc || "儲蓄帳戶";
    saveBy[k] = saveBy[k] || { v: 0, n: 0 };
    saveBy[k].v += +t.amount || 0;
    saveBy[k].n++;
  });
  const saveV = xfers.reduce((a, t) => a + (+t.amount || 0), 0);
  const sel = (k: string | null) => {
    go({ accSet: null, accSel: k });
    window.scrollTo(0, 0);
  };
  const setOpen = (k: string) => {
    go({ accSet: k });
    window.scrollTo(0, 0);
  };

  if (nav.accSel) {
    const k = nav.accSel;
    const back = () => sel(null);
    if (k.startsWith("save:")) {
      const acc = k.slice(5);
      const l = xfers.filter((t) => (acc ? (t.toAcc || "儲蓄帳戶") === acc : true));
      const tot = l.reduce((a, t) => a + (+t.amount || 0), 0);
      return (
        <>
          {head}
          <SelList
            s={s}
            title={acc || "全部儲蓄"}
            list={l}
            onBack={back}
            backLabel="全部帳戶"
            sum={
              <div className="rsum">
                <div>
                  <span>存入</span>
                  <b className="num">{formatMoney(tot)}</b>
                </div>
                <div>
                  <span>筆數</span>
                  <b className="num">{l.length}</b>
                </div>
              </div>
            }
          />
        </>
      );
    }
    if (k === "cash") return (
      <>
        {head}
        <SelList s={s} title="現金" list={cashL} onBack={back} backLabel="全部帳戶" b={bl.cash} extra={<GearBtn label="帳戶設定" onClick={() => setOpen("cash")} />} />
      </>
    );
    if (k === "cardall") return (
      <>
        {head}
        <SelList s={s} title="全部信用卡" list={its.filter((t) => chargeCard(s, t))} onBack={back} backLabel="全部帳戶" b={bl.cardall} totLbl="刷卡" extra={<GearBtn label="帳戶設定" onClick={() => setOpen("cardall")} />} />
      </>
    );
    const cid = k.slice(5);
    const c = findCard(s, cid);
    if (c && svParent(s, c)) {
      const l = its.filter((t) => t.cardId === cid && (t.type === "topup" || t.type === "expense"));
      const u = l.filter((t) => t.type === "expense").reduce((a, t) => a + net(t), 0);
      const tp = l.filter((t) => t.type === "topup").reduce((a, t) => a + (+t.amount || 0), 0);
      const sum = (
        <div className="rsum">
          <div>
            <span>本月使用</span>
            <b className="num" style={{ color: "var(--exp)" }}>
              {formatMoney(u)}
            </b>
          </div>
          <div>
            <span>本月加值</span>
            <b className="num">{formatMoney(tp)}</b>
          </div>
          <div>
            <span>目前餘額約</span>
            <b className="num">{formatSigned(svBalance(ledger, c, today))}</b>
          </div>
        </div>
      );
      return (
        <>
          {head}
          <SelList s={s} title={c.name} list={l} onBack={back} backLabel="全部帳戶" b={bl[k]} sum={sum} extra={<GearBtn label="帳戶設定" onClick={() => setOpen(cid)} />} />
          <button className="addbtn" style={{ width: "100%", height: 40, marginTop: 12 }} onClick={() => openTopup({ cardId: cid, amount: "500", date: today })}>
            <Ic name="arrow-down-to-line" />
            記一筆加值
          </button>
        </>
      );
    }
    return (
      <>
        {head}
        <SelList
          s={s}
          title={c ? c.name : "未指定卡片"}
          list={its.filter((t) => {
            const pc = chargeCard(s, t);
            return pc && (pc.id || "") === cid;
          })}
          onBack={back}
          backLabel="全部帳戶"
          b={bl[k]}
          totLbl="刷卡"
          extra={c ? <GearBtn label="帳戶設定" onClick={() => setOpen(cid)} /> : null}
        />
      </>
    );
  }

  const svRow = (c: Card) => {
    const u = use[c.id] || { v: 0, n: 0 };
    return (
      <div className="svrow" key={"sv" + c.id}>
        <button className="erow" onClick={() => sel("card:" + c.id)}>
          <Seal c={{ name: c.name, icon: "wallet", color: "#8A8F8B" }} sm />
          <span className="enm">
            <span>
              {c.name}
              <small>儲值 · {u.n} 筆</small>
            </span>
            <small className="svbal num">餘額約 {formatSigned(svBalance(ledger, c, today))}</small>
            <BMini b={bl["card:" + c.id]} />
          </span>
          <b className="num">{formatMoney(u.v)}</b>
          <Ic name="chevron-right" />
        </button>
        <button className="svtop" aria-label={c.name + "記一筆加值"} title="記一筆加值" onClick={() => openTopup({ cardId: c.id, amount: "500", date: today })}>
          <Ic name="arrow-down-to-line" />
          <span>加值</span>
        </button>
      </div>
    );
  };
  const tops = cards.filter((c) => !svParent(s, c));
  const rowsC = tops
    .map((c) => {
      const o = chg[c.id] || { v: 0, n: 0, top: 0 };
      const kids = svs.filter((x) => x.svOf === c.id && (!x.archived || use[x.id]));
      return {
        key: c.id,
        sortV: o.v,
        arc: !!c.archived,
        used: !!(o.n || kids.some((x) => use[x.id])),
        node: (
          <Fragment key={c.id}>
            <EntRow name={c.name} icon="credit-card" v={o.v} n={o.n} b={bl["card:" + c.id]} extra={o.top ? "含加值 " + formatMoney(o.top) : ""} onClick={() => sel("card:" + c.id)} />
            {kids.map(svRow)}
          </Fragment>
        ),
      };
    })
    .sort((a, b) => b.sortV - a.sortV);
  if (chg[""]) rowsC.push({ key: "", sortV: 0, arc: false, used: true, node: <EntRow key="none" name="未指定卡片" icon="credit-card" v={chg[""].v} n={chg[""].n} onClick={() => sel("card:")} /> });
  const all = exp.reduce((a, t) => a + net(t), 0);
  const pc = (v: number) => (all ? Math.round((v / all) * 1000) / 10 : 0);
  const used = rowsC.filter((r) => r.used && !r.arc);
  const idle = rowsC.filter((r) => !r.used && !r.arc);
  const arcRows = rowsC.filter((r) => r.arc);
  return (
    <>
      {head}
      <div className="card" style={{ marginTop: 6 }}>
        <div className="lbl-s">本月支出 {formatMoney(all)}</div>
        <div className="paybar" role="img" aria-label={`現金 ${pc(cashV)}%，信用卡 ${pc(cardUseV + svUseV)}%`}>
          {all ? (
            <>
              <i style={{ width: pc(cashV) + "%", background: PAY_COLOR.cash }} />
              <i style={{ width: pc(cardUseV + svUseV) + "%", background: PAY_COLOR.card }} />
            </>
          ) : null}
        </div>
        <div className="monthsum" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
          <div className="pill">
            <span>現金 · {cashL.length} 筆</span>
            <b style={{ color: PAY_COLOR.cash }}>{formatMoney(cashV)}</b>
          </div>
          <div className="pill">
            <span>信用卡 · {cardUseL.length + svUseN} 筆</span>
            <b style={{ color: PAY_COLOR.card }}>{formatMoney(cardUseV + svUseV)}</b>
          </div>
        </div>
      </div>
      <div className="card elist">
        <EntRow name="現金" icon="banknote" v={cashV} n={cashL.length} b={bl.cash} onClick={() => sel("cash")} />
        {tops.length || ctN ? (
          <>
            <div className="esub">信用卡（刷卡金額）</div>
            <EntRow name="全部信用卡" icon="credit-card" v={ctV} n={ctN} b={bl.cardall} onClick={() => sel("cardall")} />
            {used.map((r) => r.node)}
            {idle.length ? (
              <>
                <div className="esub">這個月沒有刷卡</div>
                {idle.map((r) => r.node)}
              </>
            ) : null}
            {arcRows.length ? (
              <>
                <div className="esub">已封存</div>
                <div className="dimrows">{arcRows.map((r) => r.node)}</div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {saveAccs.length || xfers.length ? (
        <div className="card elist" style={{ marginTop: 12 }}>
          <div className="esub" style={{ marginTop: 0 }}>
            儲蓄（轉帳，不算支出）· 本月存入 {formatMoney(saveV)}
          </div>
          {(saveAccs.length ? saveAccs : Object.keys(saveBy)).map((a) => (
            <EntRow key={a} name={a} icon="piggy-bank" v={saveBy[a]?.v || 0} n={saveBy[a]?.n || 0} onClick={() => sel("save:" + a)} />
          ))}
          <button
            className="addbtn"
            style={{ width: "100%", height: 36, marginTop: 8 }}
            onClick={() => openXfer({ date: ym === today.slice(0, 7) ? today : ym + "-01", toAcc: saveAccs[0] || "" })}
          >
            ＋ 記一筆存款
          </button>
        </div>
      ) : null}
      <button className="addbtn" style={{ width: "100%", height: 40, marginTop: 12 }} onClick={onImport}>
        匯入信用卡帳單比對
      </button>
      <RecursCard />
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 2px" }}>
        信用卡依刷卡日期計入當月，不追蹤繳款，也不會累積到下個月。右上角的 ＋ 可以新增信用卡；點進任一帳戶，再按右上的設定，可以改名、封存、設定預算和開啟悠遊聯名卡。
      </p>
    </>
  );
}

/** 帳戶設定頁 */
function AccSettings({ ledger, k }: { ledger: Ledger; k: string }) {
  const { today, setSettings, canWrite, toast } = useApp();
  const { go, nav, arm } = useNav();
  const { openTopup } = useOverlay();
  const s = ledger.settings;
  const back = (
    <div className="rdrill">
      <button className="chip-back" onClick={() => go({ accSet: null })}>
        <UiIcon name="left" />
        <span>返回</span>
      </button>
      <b>帳戶設定</b>
    </div>
  );
  const updCard = (id: string, fn: (c: Card) => Card | null, st0?: Settings): Settings => {
    const st = st0 || s;
    return { ...st, cards: (st.cards || []).map((c) => (c.id === id ? fn({ ...c }) : c)).filter((c): c is Card => !!c) };
  };
  if (k === "cash")
    return (
      <div className="card rcard">
        {back}
        <div className="optrows">
          <OptRow label="名稱">
            <span className="v">現金</span>
          </OptRow>
          <BudgetRow b={s.cashBudget} name="現金" onChange={(b) => setSettings((st) => ({ ...st, cashBudget: b }))} />
        </div>
      </div>
    );
  if (k === "cardall")
    return (
      <div className="card rcard">
        {back}
        <div className="optrows">
          <OptRow label="名稱">
            <span className="v">全部信用卡</span>
          </OptRow>
          <BudgetRow b={s.cardBudget} name="全部信用卡" onChange={(b) => setSettings((st) => ({ ...st, cardBudget: b }))} />
        </div>
        <p className="pkhint">全部信用卡是所有卡片刷卡金額的加總，只能設定預算。</p>
      </div>
    );
  const c = findCard(s, k);
  if (!c)
    return (
      <div className="card rcard">
        {back}
        <p>找不到這個帳戶。</p>
      </div>
    );
  const setBudget = (b: { budget?: number; bper?: "month" | "total" }) =>
    setSettings((st) =>
      updCard(
        c.id,
        (x) => {
          const y = { ...x, ...b };
          if (!b.budget) delete y.budget;
          return y;
        },
        st,
      ),
    );
  const nameRow = (
    <OptRow label="名稱" forId="as-name">
      <LazyInput id="as-name" className="numin" style={{ width: "60%", textAlign: "right" }} value={c.name} onCommit={(v) => setSettings((st) => updCard(c.id, (x) => ({ ...x, name: v }), st))} />
    </OptRow>
  );
  const delBtn = (
    <button
      className={"danger" + (nav.armed === "adel" ? " arm" : "")}
      data-armable
      style={{ marginTop: 14 }}
      onClick={() => {
        if (!arm("adel") || !canWrite()) return;
        setSettings((st) => ({ ...st, cards: (st.cards || []).map((x) => (x.svOf === c.id ? (({ svOf: _o, ...y }) => y)(x) : x)).filter((x) => x.id !== c.id) }));
        go({ accSet: null, accSel: null });
        toast("已刪除帳戶");
      }}
    >
      {nav.armed === "adel" ? "再按一次確定刪除（記錄會保留，顯示為未指定卡片）" : "刪除這個帳戶"}
    </button>
  );
  const pc = svParent(s, c);
  if (pc)
    return (
      <div className="card rcard">
        {back}
        <div className="optrows">
          <OptRow label="類型">
            <span className="v">{pc.name} 的悠遊聯名卡</span>
          </OptRow>
          {nameRow}
          <OptRow label="目前卡上餘額">
            <LazyInput
              className="numin num"
              style={{ width: 110 }}
              inputMode="decimal"
              placeholder="未設定"
              allowEmpty
              value={c.svInit ? String(c.svInit) : ""}
              onCommit={(raw) =>
                setSettings((st) =>
                  updCard(
                    c.id,
                    (x) => {
                      const v = Math.round((parseFloat(raw) || 0) * 100) / 100;
                      const y = { ...x, svDate: today };
                      if (v) y.svInit = v;
                      else delete y.svInit;
                      return y;
                    },
                    st,
                  ),
                )
              }
            />
          </OptRow>
          <OptRow label="帳本推算餘額">
            <span className="v num">{formatSigned(svBalance(ledger, c, today))}</span>
          </OptRow>
          <BudgetRow b={c} name={c.name} onChange={setBudget} />
        </div>
        <p className="pkhint">填入卡上實際餘額後，會從那天之後開始用加值和消費推算；對不上時重新填一次就好。</p>
        <button className="addbtn" style={{ width: "100%", height: 40, marginTop: 6 }} onClick={() => openTopup({ cardId: c.id, amount: "500", date: today })}>
          <Ic name="arrow-down-to-line" />
          記一筆加值
        </button>
        <button className="addbtn" style={{ width: "100%", height: 40, marginTop: 8 }} onClick={() => go({ accSet: pc.id })}>
          {pc.name} 的設定
        </button>
        {delBtn}
      </div>
    );
  const kid = svChildOf(s, c);
  const cands = (s.cards || []).filter((x) => x.id !== c.id && !x.svOf && !svChildOf(s, x) && !x.archived);
  const toggleSv = () => {
    if (!canWrite()) return;
    if (kid) {
      setSettings((st) => updCard(kid.id, ({ svOf: _o, ...y }) => y as Card, st));
      toast(`已關閉悠遊聯名卡，「${kid.name}」改回一般卡片，記錄都保留`);
      return;
    }
    const cs = s.cards || [];
    const free = (x: Card) => x.id !== c.id && !x.svOf && !svChildOf(s, x) && !x.archived && /悠遊/.test(x.name);
    const m = cs.find((x) => free(x) && x.name.replace(/悠遊卡?/, "").trim() === c.name.trim()) || cs.find((x) => free(x) && x.name.includes(c.name));
    if (m) {
      setSettings((st) => updCard(m.id, (x) => ({ ...x, svOf: c.id, svDate: x.svDate || today }), st));
      toast(`已把「${m.name}」設成 ${c.name} 的悠遊聯名卡`);
    } else {
      setSettings((st) => ({ ...st, cards: (st.cards || []).concat([{ id: uid8(), name: c.name + " 悠遊卡", svOf: c.id, svDate: today }]) }));
      toast("已開啟悠遊聯名卡");
    }
  };
  return (
    <div className="card rcard">
      {back}
      <div className="optrows">
        <OptRow label="類型">
          <span className="v">信用卡</span>
        </OptRow>
        {nameRow}
        <BudgetRow b={c} name={c.name} onChange={setBudget} />
        <SwitchRow
          label="封存"
          hint="封存後記帳時不會出現，舊記錄和報表照常顯示"
          on={!!c.archived}
          onToggle={() => {
            if (!canWrite()) return;
            const now = !c.archived;
            setSettings((st) => updCard(c.id, (x) => (now ? { ...x, archived: true } : (({ archived: _a, ...y }) => y)(x)), st));
            toast(now ? `已封存「${c.name}」` : `已取消封存「${c.name}」`);
          }}
        />
        <SwitchRow label="悠遊聯名卡" hint="開啟後可以記加值；用悠遊卡付的消費不算這張卡的刷卡" on={!!kid} onToggle={toggleSv} />
        {kid ? (
          <>
            <OptRow label="悠遊卡記錄放在">
              <select
                className="numin"
                style={{ width: "auto", maxWidth: "60%" }}
                value={kid.id}
                onChange={(e) => {
                  const nw = findCard(s, e.target.value);
                  if (!nw || nw.id === kid.id) return;
                  setSettings((st) => updCard(nw.id, (x) => ({ ...x, svOf: c.id, svDate: x.svDate || today }), updCard(kid.id, ({ svOf: _o, ...y }) => y as Card, st)));
                  toast(`悠遊卡記錄改用「${nw.name}」`);
                }}
              >
                <option value={kid.id}>{kid.name}</option>
                {cands.map((x) => (
                  <option key={x.id} value={x.id}>
                    改用：{x.name}
                  </option>
                ))}
              </select>
            </OptRow>
            <OptRow label="悠遊卡餘額">
              <span className="v num">{formatSigned(svBalance(ledger, kid, today))}</span>
            </OptRow>
          </>
        ) : null}
      </div>
      {kid ? (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button className="addbtn" style={{ flex: 1, height: 40 }} onClick={() => openTopup({ cardId: kid.id, amount: "500", date: today })}>
            <Ic name="arrow-down-to-line" />
            記一筆加值
          </button>
          <button className="addbtn" style={{ flex: 1, height: 40 }} onClick={() => go({ accSet: kid.id })}>
            悠遊卡設定
          </button>
        </div>
      ) : null}
      {delBtn}
    </div>
  );
}

