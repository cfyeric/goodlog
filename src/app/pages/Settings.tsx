/** 設定頁：商家對照、類別入口、備份與匯出、還原、從 MOZE 匯入 */
import { useState } from "react";
import type { Ledger } from "../../core/types";
import { findCategory } from "../../core/ledger";
import { backupJSON, exportCSV, parseBackup, restoreMonths, stamp, type RestorePreview } from "../../core/backup";
import { useApp } from "../state";
import { useNav } from "../nav";
import { useOverlay } from "../editor/context";
import { Ic } from "../ui/Icon";
import { useAccount } from "../auth/AuthGate";

interface Downloads {
  save(o: { filename: string; data: string }): Promise<void>;
}

let dlns: Downloads | null | undefined;
async function getDownloads(): Promise<Downloads | null> {
  if (dlns !== undefined) return dlns;
  try {
    dlns = window.claude?.use ? ((await window.claude.use("downloads")) as Downloads) : null;
  } catch {
    dlns = null;
  }
  return dlns;
}

/** 存檔：claude.ai 上用網頁的下載功能，其他地方用瀏覽器下載 */
async function saveFile(name: string, data: string, mime: string, toast: (m: string) => void) {
  const dl = await getDownloads();
  if (dl) {
    try {
      await dl.save({ filename: name, data });
      toast("已匯出 " + name);
    } catch (e) {
      const c = (e as { code?: string })?.code;
      if (c === "declined") return;
      if (c === "rate_limited") return toast("上一個下載還沒完成，請稍後再試");
      toast("這裡無法下載檔案");
    }
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("已匯出 " + name);
  } catch {
    toast("這裡無法下載檔案");
  }
}

export function Settings({ ledger }: { ledger: Ledger }) {
  const s = ledger.settings;
  const { setSettings, canWrite, toast, replaceMonth } = useApp();
  const { nav, go, view, arm } = useNav();
  const { setMozeOpen } = useOverlay();
  const [restore, setRestore] = useState<(RestorePreview & { name: string }) | null>(null);
  const account = useAccount();

  const delAlias = (id: string, nm: string) => {
    const k = "aliases:" + id;
    const on = nav.armed === k;
    return (
      <button
        className={"del ib-del" + (on ? " arm" : "")}
        data-armable
        aria-label={(on ? "再按一次確定刪除" : "刪除") + (nm ? "「" + nm + "」" : "")}
        title={on ? "再按一次確定刪除" : "刪除"}
        onClick={() => {
          if (!arm(k) || !canWrite()) return;
          setSettings((x) => ({ ...x, aliases: (x.aliases || []).filter((a) => a.id !== id) }));
          go({ armed: null });
          toast("已刪除");
        }}
      >
        <Ic name="trash-2" />
      </button>
    );
  };

  const doRestore = async () => {
    const R = restore;
    if (!R || !canWrite()) return;
    const b = R.data;
    try {
      setSettings(() => JSON.parse(JSON.stringify(b.settings)));
      const ms = restoreMonths(ledger.months, b);
      await Promise.all(Object.entries(ms).map(([k, it]) => replaceMonth(k, it)));
      setRestore(null);
      go({ armed: null });
      toast(`已還原 ${R.n.toLocaleString("zh-TW")} 筆記錄`);
    } catch {
      toast("還原時發生錯誤，請再試一次");
    }
  };

  const aliases = s.aliases || [];
  return (
    <>
      <div className="top">
        <h1>
          設定<small>類別、商家對照與資料</small>
        </h1>
      </div>
      <div className="stack" style={{ marginTop: 6 }}>
        <div className="card">
          <div className="lbl-s">商家對照</div>
          {aliases.length ? (
            <div className="rows">
              {aliases.map((a) => (
                <div key={a.id} className="setrow" style={{ justifyContent: "space-between" }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.desc}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                      → {findCategory(s, a.catId)?.name || "（類別已刪除）"}
                      {a.name ? " · " + a.name : ""}
                      {a.merchant ? " · " + a.merchant : ""}
                    </span>
                  </span>
                  {delAlias(a.id, a.desc)}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>帳單比對時按「補記」或「是同一筆」，會自動記住帳單名稱對應的類別，下次直接帶入。</p>
          )}
        </div>
        <div className="card" style={{ padding: "12px 16px 4px" }}>
          <div className="lbl-s">類別</div>
          {(["expense", "income"] as const).map((ty) => {
            const gs = (s.groups || []).filter((g) => g.type === ty);
            const n = (s.categories || []).filter((c) => c.type === ty).length;
            return (
              <button
                key={ty}
                className="navrow"
                onClick={() => {
                  go({ catType: ty });
                  view("cats");
                }}
              >
                <span>{ty === "expense" ? "支出類別" : "收入類別"}</span>
                <small>
                  {gs.length} 個主類別 · {n} 個子類別
                </small>
                <Ic name="chevron-right" />
              </button>
            );
          })}
        </div>
        <div className="card">
          <div className="lbl-s">備份與匯出</div>
          <p style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--muted)" }}>定期備份一份到手機或電腦。備份檔可以還原全部記錄和設定；CSV 可以用 Excel 開啟。</p>
          <div className="bkgrid">
            <button className="addbtn" onClick={() => saveFile("好記備份-" + stamp() + ".json", backupJSON(ledger), "application/json", toast)}>
              <Ic name="archive" />
              完整備份
            </button>
            <button className="addbtn" onClick={() => saveFile("好記記錄-" + stamp() + ".csv", exportCSV(ledger), "text/csv", toast)}>
              <Ic name="arrow-down-to-line" />
              匯出 CSV
            </button>
          </div>
          <label className="filebtn" style={{ marginTop: 8 }}>
            <Ic name="archive-restore" />
            <span>{restore ? restore.name + "（重新選擇）" : "從備份檔還原"}</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                f.text().then((txt) => {
                  const p = parseBackup(txt);
                  if (!p) return toast("這不是好記的備份檔");
                  setRestore({ ...p, name: f.name });
                  go({ armed: null });
                });
              }}
            />
          </label>
          {restore ? (
            <div className="restorebox">
              <p>
                {restore.name}：{restore.when ? restore.when + " 的備份，" : ""}
                {restore.n} 筆記錄、{restore.m} 個月份。
                <br />
                <b>還原會用備份檔取代目前所有記錄和設定</b>，目前帳本裡備份之後新增的記錄都會消失。
              </p>
              <div className="acts">
                <button
                  className="btn"
                  onClick={() => {
                    setRestore(null);
                    go({ armed: null });
                  }}
                >
                  取消
                </button>
                <button
                  className="btn destructive"
                  data-armable
                  onClick={() => {
                    if (!arm("restore")) return;
                    go({ armed: null });
                    doRestore();
                  }}
                >
                  {nav.armed === "restore" ? "再按一次確定還原" : "還原"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="card">
          <div className="lbl-s">匯入資料</div>
          <p style={{ margin: "4px 0 8px", fontSize: 13, color: "var(--muted)" }}>把 MOZE 匯出的 CSV 匯進好記，類別、卡片和專案會自動對應或新增。</p>
          <button className="addbtn" style={{ width: "100%", height: 40 }} onClick={() => setMozeOpen(true)}>
            從 MOZE 匯入（CSV）
          </button>
        </div>
        {account ? (
          <div className="card">
            <div className="lbl-s">帳號</div>
            <div className="setrow" style={{ justifyContent: "space-between" }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 14 }}>{account.email}</span>
              <button className="btn" onClick={() => void account.signOut()}>
                登出
              </button>
            </div>
          </div>
        ) : null}
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 2px" }}>資料存在你的雲端帳本，只有你看得到。</p>
      </div>
    </>
  );
}
