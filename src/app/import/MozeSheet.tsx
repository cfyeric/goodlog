/** 從 MOZE 匯出的 CSV 匯入 */
import { useEffect, useState } from "react";
import { decodeText, parseCSV } from "../../core/statement";
import { mozeAnalyze, mozeCommit, type MozeOptions, type MozePlan } from "../../core/moze";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useOverlay } from "../editor/context";
import { SwitchRow } from "../pages/common";
import { Ic, UiIcon } from "../ui/Icon";

const n = (x: number) => Number(x).toLocaleString("zh-TW");

export function MozeHost() {
  const { mozeOpen } = useOverlay();
  return mozeOpen ? <MozeSheet /> : null;
}

function MozeSheet() {
  const { ledger, commit, canWrite, toast } = useApp();
  const { setMozeOpen } = useOverlay();
  const [opt, setOpt] = useState<MozeOptions>({ optReward: true, optRecv: false });
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [readErr, setReadErr] = useState("");
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMozeOpen(false);
    document.addEventListener("keydown", k);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", k);
    };
  }, [setMozeOpen]);
  // 選項或帳本變動時重新分析（新增的類別 id 每次重算，但只在按下匯入時才寫入）
  const [res, setRes] = useState<{ plan: MozePlan | null; err: string } | null>(null);
  useEffect(() => {
    if (!rows || !ledger) return setRes(null);
    setRes(mozeAnalyze(ledger, rows, opt, uid8));
  }, [rows, opt, ledger]);
  const P = res?.plan || null;
  const err = readErr || res?.err || "";
  const go = () => {
    if (!ledger || !P || !P.items.length || !canWrite()) return;
    commit(mozeCommit(ledger, P));
    setMozeOpen(false);
    toast(`已匯入 ${P.items.length.toLocaleString("zh-TW")} 筆記錄`);
  };
  let body = null;
  if (P && !loading) {
    const imp = P.items.length;
    const ex = P.items.filter((t) => t.type === "expense").length, inc = P.items.filter((t) => t.type === "income").length;
    const kv = (o: Record<string, number>) =>
      Object.entries(o).map(([k, v]) => (
        <div key={k} className="row">
          <span>{k}</span>
          <span className="num">{n(v)} 筆</span>
        </div>
      ));
    const names = (a: { name: string }[]) => a.map((x) => x.name).join("、");
    body = (
      <>
        <div className="card" style={{ marginTop: 4 }}>
          <div className="lbl-s">檔案內容</div>
          <div className="rows">
            <div className="row">
              <span>期間</span>
              <span className="num">{P.minD <= "9" ? P.minD + " ～ " + P.maxD : "—"}</span>
            </div>
            {kv(P.cnt)}
          </div>
        </div>
        <div className="card" style={{ marginTop: 12, padding: "6px 16px" }}>
          <div className="optrows" style={{ overflow: "visible" }}>
            <SwitchRow label="折扣、紅利回饋記成收入" hint="放在「收入 › 折扣回饋／紅利回饋」" on={opt.optReward} onToggle={() => setOpt((o) => ({ ...o, optReward: !o.optReward }))} />
            <SwitchRow label="應收款項記成支出" hint="代付、借出會記在「其他」，對象寫進備註" on={opt.optRecv} onToggle={() => setOpt((o) => ({ ...o, optRecv: !o.optRecv }))} />
          </div>
        </div>
        {Object.keys(P.skip).length ? (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="lbl-s">不會匯入</div>
            <p className="pkhint" style={{ margin: "0 0 4px" }}>
              好記不記轉帳、繳卡費和帳戶餘額。
            </p>
            <div className="rows">{kv(P.skip)}</div>
          </div>
        ) : null}
        <div className="card" style={{ marginTop: 12 }}>
          <div className="lbl-s">會自動新增</div>
          <div className="rows">
            <div className="row">
              <span>主類別</span>
              <span className="num">{P.add.groups.length} 個</span>
            </div>
            {P.add.groups.length ? <p className="mzlist">{names(P.add.groups)}</p> : null}
            <div className="row">
              <span>子類別</span>
              <span className="num">{P.add.cats.length} 個</span>
            </div>
            <div className="row">
              <span>信用卡</span>
              <span className="num">{P.add.cards.length} 張</span>
            </div>
            {P.add.cards.length ? <p className="mzlist">{names(P.add.cards)}</p> : null}
            <div className="row">
              <span>專案</span>
              <span className="num">{P.add.projects.length} 個</span>
            </div>
            {P.add.projects.length ? <p className="mzlist">{names(P.add.projects)}</p> : null}
          </div>
          <p className="pkhint" style={{ margin: "8px 0 0" }}>
            名稱相同的會直接對應到你現有的類別、卡片、專案。帳戶名稱有「卡」的記成信用卡，其他（錢包、銀行帳戶）記成現金。
          </p>
        </div>
        {P.dup ? (
          <p className="pkhint" style={{ marginTop: 10 }}>
            有 {n(P.dup)} 筆之前已經匯入過，這次會略過。
          </p>
        ) : null}
        <button className="btn primary" style={{ width: "100%", height: 44, marginTop: 14 }} disabled={!imp} onClick={go}>
          {imp ? `匯入 ${n(imp)} 筆（支出 ${n(ex)}、收入 ${n(inc)}）` : "沒有新的記錄"}
        </button>
      </>
    );
  }
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="從 MOZE 匯入">
      <div className="in">
        <div className="shead">
          <button className="iconbtn" aria-label="關閉" onClick={() => setMozeOpen(false)}>
            <UiIcon name="x" />
          </button>
          <h2>從 MOZE 匯入</h2>
          <span style={{ width: 36 }} />
        </div>
        <div className="sbody" id="mzbody">
          <label className="filebtn">
            <Ic name="plus" />
            <span>{fileName ? fileName + "（重新選擇）" : "選擇 MOZE 匯出的 CSV"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setLoading(true);
                setReadErr("");
                setRows(null);
                f.arrayBuffer().then(
                  (buf) => {
                    setRows(parseCSV(decodeText(buf)));
                    setLoading(false);
                  },
                  () => {
                    setLoading(false);
                    setReadErr("讀不到這個檔案。");
                  },
                );
              }}
            />
          </label>
          <p className="pkhint">在 MOZE 的「設定 › 匯出資料」匯出 CSV。檔案只在你的瀏覽器裡讀取。</p>
          {loading ? (
            <div className="empty">
              <b>讀取中…</b>
            </div>
          ) : null}
          {err ? (
            <div className="err" role="alert">
              {err}
            </div>
          ) : null}
          {body}
        </div>
      </div>
    </div>
  );
}
