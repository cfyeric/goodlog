/** 類別管理：主類別、子類別（新增、編輯、刪除、隱藏、拖曳排序） */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactElement } from "react";
import type { Category, Group, Ledger, Settings } from "../../core/types";
import { allTx, findGroup } from "../../core/ledger";
import { reorderArr } from "../../core/editor";
import { uid8 } from "../../core/ids";
import { useApp } from "../state";
import { useNav } from "../nav";
import { Ic, iconName, nodeFor, Seal, Svg, UiIcon } from "../ui/Icon";
import { ICON_GROUPS, ICON_NODES, LUCIDE_URL, SWATCHES, type IconNode } from "../ui/iconData";
import { loadScript } from "../import/ImportSheet";

type Kind = "group" | "cat";
interface Confirm {
  title: string;
  desc: string;
  kind: Kind;
  id: string;
}
interface Picker {
  kind: Kind;
  id: string | null;
  type: "expense" | "income";
  groupId: string | null;
  name: string;
  icon: string;
  node: IconNode | null;
  color: string;
  q: string;
  err: string;
}

/** 一列：名稱、編輯、刪除、隱藏、拖曳把手 */
function MRow({ item, kind, sub, s, onMain, onEdit, onDel, onHide, onGrip }: { item: Group | Category; kind: Kind; sub: string; s: Settings; onMain: () => void; onEdit: () => void; onDel: () => void; onHide: () => void; onGrip: (e: RPointerEvent<HTMLSpanElement>) => void }) {
  const off = !!item.hidden;
  return (
    <div className={"mrow" + (off ? " off" : "")} data-id={item.id}>
      <button className="mmain" onClick={onMain}>
        <Seal c={item} s={s} />
        <span className="mtxt">
          <b>{item.name}</b>
          <small>
            {sub}
            {off ? " · 已隱藏" : ""}
          </small>
        </span>
        {kind === "group" ? (
          <span className="mchev">
            <Ic name="chevron-right" />
          </span>
        ) : null}
      </button>
      <span className="macts">
        <button className="ib" aria-label={`編輯「${item.name}」`} title="編輯" onClick={onEdit}>
          <Ic name="square-pen" />
        </button>
        <button className="ib" aria-label={`刪除「${item.name}」`} title="刪除" onClick={onDel}>
          <Ic name="trash-2" />
        </button>
        <button className="ib" aria-label={`${off ? "顯示" : "隱藏"}「${item.name}」`} aria-pressed={off} title={off ? "顯示" : "隱藏"} onClick={onHide}>
          <Ic name={off ? "eye-off" : "eye"} />
        </button>
        <span className="ib grip" role="button" aria-label="拖曳排序" title="拖曳排序" onPointerDown={onGrip}>
          <Ic name="menu" />
        </span>
      </span>
    </div>
  );
}

/** 拖曳把手排序（滑鼠、觸控都可以）；放開後回傳新的 id 順序 */
function startDrag(e: RPointerEvent<HTMLSpanElement>, done: (ids: string[]) => void) {
  e.preventDefault();
  const h = e.currentTarget;
  document.body.classList.add("nosel");
  try {
    window.getSelection()?.removeAllRanges();
  } catch {
    /* 沒有選取 */
  }
  const block = (ev: Event) => ev.preventDefault();
  document.addEventListener("touchmove", block, { passive: false });
  document.addEventListener("selectstart", block);
  const row = h.closest(".mrow") as HTMLElement;
  const rows = [...row.parentElement!.querySelectorAll<HTMLElement>(".mrow")];
  const from = rows.indexOf(row), H = row.getBoundingClientRect().height, y0 = e.clientY;
  let to = from;
  row.classList.add("dragging");
  rows.forEach((r) => r !== row && r.classList.add("shift"));
  try {
    h.setPointerCapture(e.pointerId);
  } catch {
    /* 不支援 */
  }
  const move = (ev: PointerEvent) => {
    const dy = ev.clientY - y0;
    row.style.transform = `translateY(${dy}px)`;
    to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / H)));
    rows.forEach((r, i) => {
      if (r === row) return;
      let sh = 0;
      if (from < to && i > from && i <= to) sh = -H;
      else if (from > to && i >= to && i < from) sh = H;
      r.style.transform = sh ? `translateY(${sh}px)` : "";
    });
  };
  const up = () => {
    h.removeEventListener("pointermove", move);
    h.removeEventListener("pointerup", up);
    h.removeEventListener("pointercancel", up);
    document.body.classList.remove("nosel");
    document.removeEventListener("touchmove", block);
    document.removeEventListener("selectstart", block);
    rows.forEach((r) => {
      r.style.transform = "";
      r.classList.remove("shift", "dragging");
    });
    if (to !== from) {
      const ids = rows.map((r) => r.dataset.id!);
      const [m] = ids.splice(from, 1);
      ids.splice(to, 0, m);
      done(ids);
    }
  };
  h.addEventListener("pointermove", move);
  h.addEventListener("pointerup", up);
  h.addEventListener("pointercancel", up);
}

function useCatActions(ledger: Ledger) {
  const { setSettings, canWrite, toast } = useApp();
  const s = ledger.settings;
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const askDelete = (kind: Kind, id: string) => {
    const all = allTx(ledger);
    if (kind === "group") {
      const g = findGroup(s, id);
      if (!g) return;
      const cs = s.categories.filter((c) => c.groupId === id);
      const ids = new Set(cs.map((c) => c.id));
      const n = all.filter((t) => t.catId && ids.has(t.catId)).length;
      setConfirm({ title: `刪除主類別「${g.name}」？`, desc: `底下 ${cs.length} 個子類別會一起刪除。` + (n ? `有 ${n} 筆記錄用到這些類別，記錄本身會保留，但類別會顯示為「未分類」。` : "目前沒有記錄用到這些類別。") + "只想暫時不顯示的話，可以改用隱藏。", kind, id });
    } else {
      const c = s.categories.find((x) => x.id === id);
      if (!c) return;
      const n = all.filter((t) => t.catId === id).length;
      setConfirm({ title: `刪除子類別「${c.name}」？`, desc: (n ? `有 ${n} 筆記錄用到這個類別，記錄本身會保留，但類別會顯示為「未分類」。` : "目前沒有記錄用到這個類別。") + "只想暫時不顯示的話，可以改用隱藏。", kind, id });
    }
  };
  const toggleHide = (kind: Kind, id: string) => {
    if (!canWrite()) return;
    const key = kind === "group" ? "groups" : "categories";
    const it = (s[key] as (Group | Category)[]).find((x) => x.id === id);
    if (!it) return;
    const hidden = !it.hidden;
    setSettings((x) => ({
      ...x,
      [key]: (x[key] as (Group | Category)[]).map((y) => {
        if (y.id !== id) return y;
        const z = { ...y };
        if (hidden) z.hidden = true;
        else delete z.hidden;
        return z;
      }),
    }));
    toast(hidden ? `已隱藏「${it.name}」，記帳時不會出現` : `已顯示「${it.name}」`);
  };
  const reorder = (kind: Kind, ids: string[]) => {
    if (!canWrite()) return;
    setSettings((x) => (kind === "group" ? { ...x, groups: reorderArr(x.groups, ids) } : { ...x, categories: reorderArr(x.categories, ids) }));
  };
  const openPicker = (kind: Kind, id: string | null, opts?: { type?: "expense" | "income"; groupId?: string }) => {
    const it = id ? (kind === "group" ? findGroup(s, id) : s.categories.find((c) => c.id === id)) : null;
    const ty = it ? it.type : opts?.type || "expense";
    const gid = kind === "cat" ? (it ? (it as Category).groupId : opts?.groupId || null) : null;
    const g0 = gid ? findGroup(s, gid) : null;
    setPicker({
      kind, id: it ? it.id : null, type: ty, groupId: gid, name: it ? it.name : "", icon: it ? iconName(it) || "none" : "tag",
      node: (it && (it.iconNode as IconNode)) || null, color: it ? it.color || "" : g0 ? g0.color || "" : SWATCHES[(s.groups || []).length % SWATCHES.length], q: "", err: "",
    });
  };
  const dialogs = (
    <>
      {confirm ? (
        <ConfirmDlg
          c={confirm}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            const C = confirm;
            setConfirm(null);
            if (!canWrite()) return;
            if (C.kind === "group") setSettings((x) => ({ ...x, groups: x.groups.filter((g) => g.id !== C.id), categories: x.categories.filter((c) => c.groupId !== C.id) }));
            else setSettings((x) => ({ ...x, categories: x.categories.filter((c) => c.id !== C.id) }));
            toast("已刪除");
          }}
        />
      ) : null}
      {picker ? <PickerSheet P={picker} setP={setPicker} s={s} /> : null}
    </>
  );
  return { askDelete, toggleHide, reorder, openPicker, dialogs };
}

export function Cats({ ledger }: { ledger: Ledger }) {
  const s = ledger.settings;
  const { nav, go, view } = useNav();
  const A = useCatActions(ledger);
  const ty = nav.catType || "expense";
  const gs = (s.groups || []).filter((g) => g.type === ty);
  const cnt = (id: string) => (s.categories || []).filter((c) => c.groupId === id).length;
  return (
    <>
      <div className="top">
        <button className="iconbtn" aria-label="返回設定" onClick={() => view("settings")}>
          <UiIcon name="left" />
        </button>
        <h1>
          類別管理<small>點主類別進去編輯子類別</small>
        </h1>
      </div>
      <div className="seg" role="tablist" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: "100%", margin: "4px 0 12px" }}>
        {([["expense", "支出"], ["income", "收入"]] as const).map(([k, l]) => (
          <button key={k} className={ty === k ? "on" : ""} role="tab" aria-selected={ty === k} onClick={() => go({ catType: k })}>
            {l}
          </button>
        ))}
      </div>
      {gs.length ? (
        <div className="card" style={{ padding: "4px 8px 4px 12px" }}>
          <div className="mlist" data-list="group">
            {gs.map((g) => (
              <MRow
                key={g.id}
                item={g}
                kind="group"
                sub={cnt(g.id) + " 個子類別"}
                s={s}
                onMain={() => {
                  go({ catGroup: g.id });
                  view("subcats");
                }}
                onEdit={() => A.openPicker("group", g.id)}
                onDel={() => A.askDelete("group", g.id)}
                onHide={() => A.toggleHide("group", g.id)}
                onGrip={(e) => startDrag(e, (ids) => A.reorder("group", ids))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty">
          <b>還沒有{ty === "expense" ? "支出" : "收入"}主類別</b>按下方按鈕新增第一個。
        </div>
      )}
      <button className="addbtn" style={{ width: "100%", height: 40, marginTop: 12 }} onClick={() => A.openPicker("group", null, { type: ty })}>
        ＋ 新增主類別
      </button>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 2px 0" }}>拖曳右側 ≡ 調整順序；隱藏的類別記帳時不會出現，但舊記錄和報表照常顯示。</p>
      {A.dialogs}
    </>
  );
}

export function Subcats({ ledger }: { ledger: Ledger }) {
  const s = ledger.settings;
  const { nav, view } = useNav();
  const A = useCatActions(ledger);
  const g = nav.catGroup ? findGroup(s, nav.catGroup) : undefined;
  useEffect(() => {
    if (!g) view("cats");
  }, [g, view]);
  if (!g) return null;
  const cs = (s.categories || []).filter((c) => c.groupId === g.id);
  const used: Record<string, number> = {};
  allTx(ledger).forEach((t) => {
    if (t.catId) used[t.catId] = (used[t.catId] || 0) + 1;
  });
  return (
    <>
      <div className="top">
        <button className="iconbtn" aria-label="返回類別管理" onClick={() => view("cats")}>
          <UiIcon name="left" />
        </button>
        <Seal c={g} s={s} />
        <h1>
          {g.name}
          <small>
            {cs.length} 個子類別{g.hidden ? " · 主類別已隱藏" : ""}
          </small>
        </h1>
        <button className="iconbtn" aria-label="新增子類別" title="新增子類別" onClick={() => A.openPicker("cat", null, { type: g.type, groupId: g.id })}>
          <Ic name="plus" />
        </button>
      </div>
      {cs.length ? (
        <div className="card" style={{ padding: "4px 8px 4px 12px", marginTop: 8 }}>
          <div className="mlist" data-list="cat">
            {cs.map((c) => (
              <MRow
                key={c.id}
                item={c}
                kind="cat"
                sub={(used[c.id] || 0) + " 筆記錄"}
                s={s}
                onMain={() => A.openPicker("cat", c.id)}
                onEdit={() => A.openPicker("cat", c.id)}
                onDel={() => A.askDelete("cat", c.id)}
                onHide={() => A.toggleHide("cat", c.id)}
                onGrip={(e) => startDrag(e, (ids) => A.reorder("cat", ids))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty" style={{ marginTop: 8 }}>
          <b>這個主類別還沒有子類別</b>按右上角的 ＋ 新增。
        </div>
      )}
      {A.dialogs}
    </>
  );
}

function ConfirmDlg({ c, onCancel, onOk }: { c: Confirm; onCancel: () => void; onOk: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="dlg-ov" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dlg enter" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-d">
        <h3 id="cf-t">{c.title}</h3>
        <p id="cf-d">{c.desc}</p>
        <div className="acts">
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn destructive" ref={ok} onClick={onOk}>
            刪除
          </button>
        </div>
      </div>
    </div>
  );
}

type LucideState = "idle" | "loading" | "ready" | "failed";
let lucideState: LucideState = window.lucide ? "ready" : "idle";

/** 新增／編輯類別：名稱、所屬主類別、顏色、圖示 */
function PickerSheet({ P, setP, s }: { P: Picker; setP: (p: Picker | null) => void; s: Settings }) {
  const { setSettings, canWrite, toast } = useApp();
  const [lu, setLu] = useState<LucideState>(lucideState);
  const nameRef = useRef<HTMLInputElement>(null);
  const [hex, setHex] = useState(P.color);
  const upd = (p: Partial<Picker>) => setP({ ...P, ...p });
  useEffect(() => {
    document.body.style.overflow = "hidden";
    if (!P.id) setTimeout(() => nameRef.current?.focus(), 60);
    if (lucideState === "idle") {
      lucideState = "loading";
      setLu("loading");
      loadScript(LUCIDE_URL).then(
        () => setLu((lucideState = window.lucide ? "ready" : "failed")),
        () => setLu((lucideState = "failed")),
      );
    }
    const k = (e: KeyboardEvent) => e.key === "Escape" && setP(null);
    document.addEventListener("keydown", k);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", k);
    };
    // 只在打開時執行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setColor = (c: string, from: "well" | "hex") => {
    upd({ color: c });
    if (from !== "hex") setHex(c.toUpperCase());
  };
  const save = () => {
    const nm = (P.name || "").trim();
    if (!nm) return upd({ err: "請輸入名稱。" });
    const pool: (Group | Category)[] = P.kind === "group" ? s.groups.filter((g) => g.type === P.type) : s.categories.filter((c) => c.groupId === P.groupId);
    if (pool.some((x) => x.name === nm && x.id !== P.id)) return upd({ err: `「${nm}」已經存在，請換一個名稱。` });
    if (!canWrite()) return;
    setSettings((x) => {
      const groups = x.groups.slice();
      const categories = x.categories.slice();
      if (P.kind === "group") {
        const i = P.id ? groups.findIndex((g) => g.id === P.id) : -1;
        const it: Group = i >= 0 ? { ...groups[i] } : ({ id: "g" + uid8(), type: P.type } as Group);
        it.name = nm;
        it.icon = P.icon;
        it.color = P.color;
        if (P.node) it.iconNode = P.node;
        else delete it.iconNode;
        if (i >= 0) groups[i] = it;
        else groups.push(it);
        return { ...x, groups, categories: categories.map((c) => (c.groupId === it.id ? { ...c, group: nm } : c)) };
      }
      const i = P.id ? categories.findIndex((c) => c.id === P.id) : -1;
      const it: Category = i >= 0 ? { ...categories[i] } : ({ id: uid8(), type: P.type } as Category);
      it.name = nm;
      it.icon = P.icon;
      delete it.color;
      if (P.node) it.iconNode = P.node;
      else delete it.iconNode;
      it.groupId = P.groupId!;
      it.group = findGroup(x, P.groupId)?.name || "";
      if (i >= 0) categories[i] = it;
      else categories.push(it);
      return { ...x, categories };
    });
    setP(null);
    toast(P.id ? "已更新" : "已新增「" + nm + "」");
  };
  const g = P.groupId ? findGroup(s, P.groupId) : undefined;
  const prev = { name: P.name || "？", color: P.kind === "cat" ? g?.color || P.color : P.color, icon: P.icon, iconNode: P.node || undefined };
  const ttl = (P.id ? "編輯" : "新增") + (P.kind === "group" ? "主類別" : "子類別");
  const sib = (s.groups || []).filter((x) => x.type === P.type);
  const q = P.q.trim().toLowerCase();
  const btn = (n: string, zh: string, node?: IconNode) => (
    <button key={n} className={"ic" + (n === P.icon ? " on" : "")} title={zh ? zh + " · " + n : n} aria-label={zh || n} onClick={() => upd({ icon: n, node: ICON_NODES[n] ? null : node || nodeFor(n) || null })}>
      <Svg node={node || nodeFor(n)} />
    </button>
  );
  let results;
  if (!q) {
    results = (
      <>
        {ICON_GROUPS.map(([gn, items]) => (
          <div key={gn}>
            <div className="ghead">{gn}</div>
            <div className="pkgrid">{items.map(([n, z]) => btn(n, z))}</div>
          </div>
        ))}
        <p className="pkhint">
          {lu === "ready"
            ? "完整圖示庫已載入（" + Object.keys(window.lucide?.icons || {}).length.toLocaleString() + " 個），可用英文搜尋全部圖示。"
            : lu === "failed"
              ? "完整圖示庫載入失敗，目前只能從上方常用圖示挑選。"
              : "正在載入完整圖示庫，載入後可用英文搜尋全部圖示…"}
        </p>
      </>
    );
  } else {
    const seen = new Set<string>();
    const out: ReactElement[] = [];
    ICON_GROUPS.forEach(([gn, items]) =>
      items.forEach(([n, z]) => {
        if (!seen.has(n) && (z.includes(q) || n.includes(q) || gn.includes(q))) {
          seen.add(n);
          out.push(btn(n, z));
        }
      }),
    );
    if (lu === "ready" && window.lucide?.icons) {
      const qq = q.replace(/\s+/g, "-");
      for (const k of Object.keys(window.lucide.icons)) {
        if (out.length >= 150) break;
        const n = k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-zA-Z])([0-9])/g, "$1-$2").toLowerCase();
        if (seen.has(n)) continue;
        if (n.includes(qq)) {
          seen.add(n);
          out.push(btn(n, "", window.lucide.icons[k]));
        }
      }
    }
    results = out.length ? (
      <div className="pkgrid">{out}</div>
    ) : (
      <div className="empty" style={{ marginTop: 8 }}>
        <b>找不到「{P.q}」</b>
        {lu === "ready" ? "完整圖示庫只能用英文名稱搜尋，例如 coffee、car、gift。" : "試試別的關鍵字。"}
      </div>
    );
  }
  const hexOk = /^#[0-9a-f]{6}$/i.test(hex);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={ttl}>
      <div className="in">
        <div className="shead">
          <button className="iconbtn" aria-label="取消" onClick={() => setP(null)}>
            <UiIcon name="x" />
          </button>
          <h2>{ttl}</h2>
          <button className="iconbtn okbtn" aria-label="儲存" onClick={save}>
            <UiIcon name="check" />
          </button>
        </div>
        <div className="sbody">
          <div className="pkhead" id="pkprev">
            <Seal c={prev} lg />
            <div className="namefield">
              <label htmlFor="pk-name">名稱</label>
              <input id="pk-name" ref={nameRef} value={P.name} maxLength={20} placeholder={P.kind === "group" ? "例：寵物" : "例：飼料"} autoComplete="off" onChange={(e) => upd({ name: e.target.value })} />
            </div>
          </div>
          {P.kind === "cat" ? (
            <div className="namefield" style={{ margin: "-4px 0 16px" }}>
              <label htmlFor="pk-group">所屬主類別</label>
              <select id="pk-group" value={P.groupId || ""} onChange={(e) => upd({ groupId: e.target.value })}>
                {sib.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="err" id="pk-err" role="alert" style={{ margin: "-8px 0 8px" }}>
            {P.err}
          </div>
          {P.kind === "group" ? (
            <>
              <div className="lbl-s">顏色</div>
              <div className="colorrow">
                <label className="colorwell" id="pk-well" style={{ ["--pick" as string]: P.color }} aria-label="選擇顏色">
                  <input id="pk-color" type="color" value={/^#[0-9a-f]{6}$/i.test(P.color) ? P.color : "#888888"} onChange={(e) => setColor(e.target.value, "well")} />
                </label>
                <input
                  id="pk-hex"
                  className="hexin"
                  value={hex}
                  maxLength={7}
                  aria-label="色碼"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={hexOk || hex.length < 7 ? "false" : "true"}
                  onChange={(e) => {
                    let v = e.target.value.trim();
                    if (v && v[0] !== "#") v = "#" + v;
                    setHex(e.target.value);
                    if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v, "hex");
                  }}
                />
                <span className="pkhint" style={{ margin: 0 }}>
                  子類別會跟著這個顏色
                </span>
              </div>
            </>
          ) : (
            <p className="pkhint" style={{ margin: "-4px 0 16px" }}>
              顏色跟隨主類別「{g?.name || ""}」，要改請編輯主類別。
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div className="lbl-s" style={{ margin: 0 }}>
              圖示
            </div>
            <button className={"textbtn" + (P.icon === "none" ? " on" : "")} onClick={() => upd({ icon: "none", node: null })}>
              改用文字「{(P.name || "？").slice(0, 1)}」
            </button>
          </div>
          <div className="pksearch">
            <Svg node={ICON_NODES.search} />
            <input id="pk-q" type="search" placeholder="搜尋：中文（咖啡）或英文（coffee）" value={P.q} autoComplete="off" onChange={(e) => upd({ q: e.target.value })} />
          </div>
          <div id="pkres">{results}</div>
        </div>
      </div>
    </div>
  );
}
