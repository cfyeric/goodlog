/** 專案頁：本月各專案花費、預算、專案設定 */
import type { Ledger, Project } from "../../core/types";
import { allTx, findProject } from "../../core/ledger";
import { formatMoney, net } from "../../core/money";
import { budgetList, type BudgetStatus } from "../../core/budget";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useNav } from "../nav";
import { UiIcon } from "../ui/Icon";
import { BudgetRow, EntRow, GearBtn, LazyInput, MonthHead, OptRow, SelList, SwitchRow } from "./common";

export function Projects({ ledger }: { ledger: Ledger }) {
  const { setSettings, canWrite, toast } = useApp();
  const { nav, go } = useNav();
  const s = ledger.settings;
  const add = () => {
    if (!canWrite()) return;
    const id = uid8();
    setSettings((st) => ({ ...st, projects: (st.projects || []).concat([{ id, name: "新的專案" }]) }));
    go({ projSel: id, projSet: id });
    window.scrollTo(0, 0);
    setTimeout(() => {
      const el = document.getElementById("ps-name") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
    toast("已新增，先幫它取個名字");
  };
  const head = <MonthHead title="專案" onAdd={add} addLabel="新增專案" />;
  if (nav.projSet)
    return (
      <>
        {head}
        <ProjSettings ledger={ledger} id={nav.projSet} />
      </>
    );
  const ym = nav.payYm;
  const exp = (ledger.months[ym]?.items || []).filter((t) => t.type === "expense" && !t.pending);
  const bl: Record<string, BudgetStatus> = {};
  budgetList(ledger, ym).forEach((x) => (bl[x.key] = x));
  const keyOf = (pid?: string) => (pid && findProject(s, pid) ? pid : "_");
  const sel = (k: string | null) => {
    go({ projSet: null, projSel: k });
    window.scrollTo(0, 0);
  };
  if (nav.projSel) {
    const k = nav.projSel;
    const p = findProject(s, k);
    return (
      <>
        {head}
        <SelList
          s={s}
          title={p ? p.name : "未指定專案"}
          list={exp.filter((t) => keyOf(t.projectId) === k)}
          onBack={() => sel(null)}
          backLabel="全部專案"
          b={bl[k]}
          extra={p ? <GearBtn label="專案設定" onClick={() => go({ projSet: k })} /> : null}
        />
      </>
    );
  }
  const agg: Record<string, { v: number; n: number }> = {};
  exp.forEach((t) => {
    const k = keyOf(t.projectId);
    agg[k] = agg[k] || { v: 0, n: 0 };
    agg[k].v += net(t);
    agg[k].n++;
  });
  const mk = (p: Project) => ({ key: p.id, name: p.name, v: agg[p.id]?.v || 0, n: agg[p.id]?.n || 0, b: p.archived ? null : bl[p.id] });
  const act = (s.projects || []).filter((p) => !p.archived).map(mk);
  const arcR = (s.projects || []).filter((p) => p.archived).map(mk).sort((a, b) => b.v - a.v);
  const used = act.filter((r) => r.n).sort((a, b) => b.v - a.v);
  const idle = act.filter((r) => !r.n);
  if (agg._) used.push({ key: "_", name: "未指定專案", v: agg._.v, n: agg._.n, b: null });
  const all = exp.reduce((a, t) => a + net(t), 0);
  const row = (r: (typeof used)[number]) => <EntRow key={r.key} name={r.name} icon="briefcase" v={r.v} n={r.n} b={r.b} onClick={() => sel(r.key)} />;
  return (
    <>
      {head}
      <div className="monthsum" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 6 }}>
        <div className="pill">
          <span>本月支出</span>
          <b style={{ color: "var(--exp)" }}>{formatMoney(all)}</b>
        </div>
        <div className="pill">
          <span>本月有花費的專案</span>
          <b>{used.filter((r) => r.key !== "_").length}</b>
        </div>
      </div>
      <div className="card elist" style={{ marginTop: 12 }}>
        {used.length ? (
          used.map(row)
        ) : (
          <div className="empty" style={{ border: 0, padding: "14px 0" }}>
            <b>這個月還沒有專案支出</b>記帳時選一個專案，就會出現在這裡。
          </div>
        )}
        {idle.length ? (
          <>
            <div className="esub">這個月沒有花費</div>
            {idle.map(row)}
          </>
        ) : null}
        {arcR.length ? (
          <>
            <div className="esub">已封存</div>
            <div className="dimrows">{arcR.map(row)}</div>
          </>
        ) : null}
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 2px" }}>
        右上角的 ＋ 可以新增專案；點進任一專案，再按右上的設定，可以改名、封存和設定預算。設了「總計」預算的專案，進度條算的是全部期間。
      </p>
    </>
  );
}

function ProjSettings({ ledger, id }: { ledger: Ledger; id: string }) {
  const { setSettings, canWrite, toast } = useApp();
  const { go, nav, arm } = useNav();
  const s = ledger.settings;
  const p = findProject(s, id);
  const back = (
    <div className="rdrill">
      <button className="chip-back" onClick={() => go({ projSet: null })}>
        <UiIcon name="left" />
        <span>返回</span>
      </button>
      <b>專案設定</b>
    </div>
  );
  if (!p)
    return (
      <div className="card rcard">
        {back}
        <p>找不到這個專案。</p>
      </div>
    );
  const upd = (fn: (x: Project) => Project) => setSettings((st) => ({ ...st, projects: (st.projects || []).map((x) => (x.id === id ? fn({ ...x }) : x)) }));
  const n = allTx(ledger).filter((t) => t.projectId === id).length;
  return (
    <div className="card rcard">
      {back}
      <div className="optrows">
        <OptRow label="名稱" forId="ps-name">
          <LazyInput id="ps-name" className="numin" style={{ width: "60%", textAlign: "right" }} value={p.name} onCommit={(v) => upd((x) => ({ ...x, name: v }))} />
        </OptRow>
        <BudgetRow
          b={p}
          name={p.name}
          onChange={(b) =>
            upd((x) => {
              const y = { ...x, ...b };
              if (!b.budget) delete y.budget;
              return y;
            })
          }
        />
        <SwitchRow
          label="封存"
          hint="封存後記帳時不會出現，舊記錄和報表照常顯示"
          on={!!p.archived}
          onToggle={() => {
            if (!canWrite()) return;
            const now = !p.archived;
            upd((x) => (now ? { ...x, archived: true } : (({ archived: _a, ...y }) => y)(x)));
            toast(now ? `已封存「${p.name}」` : `已取消封存「${p.name}」`);
          }}
        />
        <OptRow label="記錄">
          <span className="v num">{n} 筆</span>
        </OptRow>
      </div>
      <p className="pkhint">「每月」預算每個月重新計算；「總計」算全部期間，適合旅行這類一次性的專案。</p>
      <button
        className={"danger" + (nav.armed === "pdel" ? " arm" : "")}
        data-armable
        style={{ marginTop: 14 }}
        onClick={() => {
          if (!arm("pdel") || !canWrite()) return;
          setSettings((st) => ({ ...st, projects: (st.projects || []).filter((x) => x.id !== id) }));
          go({ projSet: null, projSel: null });
          toast("已刪除專案");
        }}
      >
        {nav.armed === "pdel" ? "再按一次確定刪除（記錄會保留，顯示為未指定專案）" : "刪除這個專案"}
      </button>
    </div>
  );
}
