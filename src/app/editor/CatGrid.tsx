/** 記帳畫面的類別格子：主類別 → 子類別兩層，或建議的子類別；長按可以拖曳排序 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Category, Group, Settings } from "../../core/types";
import { catsOrder, reorderArr } from "../../core/editor";
import { useApp } from "../state";
import { Seal, UiIcon } from "../ui/Icon";

const cols = () => (window.innerWidth <= 360 ? 4 : 5);
const BACK = { back: true } as const;
type Item = Category | Group;

interface Props {
  s: Settings;
  mode: "grp" | "sub" | "sug";
  groups: Group[];
  cats: Category[];
  group: Group | null;
  selCat: string | null;
  selGroup: string | null;
  onGroup: (id: string) => void;
  onBack: () => void;
  onCat: (c: Category) => void;
}

interface Drag {
  kind: "grp" | "cat";
  id: string;
  ids: string[];
  x0: number;
  y0: number;
  px: number;
  py: number;
  rect: DOMRect;
  moved: boolean;
}

export function CatGrid({ s, mode, groups, cats, group, selCat, selGroup, onGroup, onBack, onCat }: Props) {
  const { setSettings, canWrite, toast } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; id: string; x: number; y: number; btn: HTMLElement | null }>({ timer: null, id: "", x: 0, y: 0, btn: null });
  const suppress = useRef(false);
  const n = cols();

  const baseList: Item[] = mode === "grp" ? groups : cats;
  const ordered: Item[] = drag ? (drag.ids.map((id) => baseList.find((x) => x.id === id)).filter(Boolean) as Item[]) : baseList;
  const withBack = mode === "sub" ? ([BACK] as (Item | typeof BACK)[]).concat(ordered) : (ordered as (Item | typeof BACK)[]);
  const slots = catsOrder(withBack, n);
  const one = withBack.length <= n;

  // 換主類別時回到第一頁；編輯舊記錄時捲到選中的那一頁
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = el.querySelector(".cat.on") as HTMLElement | null;
    el.scrollLeft = 0;
    if (on) {
      const pg = Math.floor((on.getBoundingClientRect().left - el.getBoundingClientRect().left) / (el.clientWidth + 4));
      el.scrollLeft = pg * (el.clientWidth + 4);
    }
  }, [mode, group?.id]);

  const end = (commit: boolean) => {
    const p = press.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    p.btn = null;
    const D = dragRef.current;
    if (!D) return;
    document.body.classList.remove("nosel");
    suppress.current = true;
    setTimeout(() => (suppress.current = false), 350);
    if (commit && D.moved) {
      setSettings((st) => (D.kind === "grp" ? { ...st, groups: reorderArr(st.groups, D.ids) } : { ...st, categories: reorderArr(st.categories, D.ids) }));
      toast("已調整順序");
    }
    setDrag(null);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      const D = dragRef.current;
      if (!D) {
        if (p.btn && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
          if (p.timer) clearTimeout(p.timer);
          p.timer = null;
          p.btn = null;
        }
        return;
      }
      e.preventDefault();
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".cats .cat[data-id]") as HTMLElement | null;
      let ids = D.ids;
      let moved = D.moved;
      const tid = el?.dataset.id;
      if (tid && tid !== D.id && ids.includes(tid)) {
        ids = ids.slice();
        const from = ids.indexOf(D.id);
        const to = ids.indexOf(tid);
        ids.splice(from, 1);
        ids.splice(to, 0, D.id);
        moved = true;
      }
      // 靠近左右邊緣時自動捲動
      const b = box.current;
      if (b) {
        const r = b.getBoundingClientRect();
        if (e.clientX < r.left + 36) b.scrollLeft -= 8;
        else if (e.clientX > r.right - 36) b.scrollLeft += 8;
      }
      setDrag({ ...D, px: e.clientX, py: e.clientY, ids, moved });
    };
    const up = () => end(true);
    const tm = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("touchmove", tm, { passive: false });
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("touchmove", tm);
    };
  }); // 每次重新綁定，拿到最新的 end

  const startPress = (e: React.PointerEvent<HTMLButtonElement>, it: Item) => {
    if (mode === "sug" || e.button > 0) return;
    const btn = e.currentTarget;
    const p = press.current;
    p.id = it.id;
    p.x = e.clientX;
    p.y = e.clientY;
    p.btn = btn;
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      p.timer = null;
      if (p.btn !== btn || !canWrite()) return;
      document.body.classList.add("nosel");
      try {
        window.getSelection()?.removeAllRanges();
        navigator.vibrate?.(12);
      } catch {
        /* 不支援就略過 */
      }
      setDrag({ kind: mode === "grp" ? "grp" : "cat", id: it.id, ids: baseList.map((x) => x.id), x0: p.x, y0: p.y, px: p.x, py: p.y, rect: btn.getBoundingClientRect(), moved: false });
    }, 450);
  };

  const dragItem = drag ? baseList.find((x) => x.id === drag.id) : null;
  return (
    <>
      <div ref={box} className={"cats" + (mode === "grp" ? " grpbox" : "") + (one ? " one" : "") + (mode === "sug" ? " nodrag" : "") + (drag ? " dragmode" : "")} onContextMenu={(e) => e.preventDefault()}>
        {slots.map((c, i) => {
          if (!c) return <span key={"e" + i} aria-hidden="true" />;
          if ("back" in c)
            return (
              <button key="back" className="cat catback" aria-label={`返回全部分類（目前：${group?.name || ""}）`} onClick={onBack}>
                <span className="seal" aria-hidden="true">
                  <UiIcon name="left" />
                </span>
                <span>返回</span>
              </button>
            );
          const on = mode === "grp" ? c.id === selGroup : c.id === selCat;
          return (
            <button
              key={c.id}
              data-id={c.id}
              className={"cat" + (on ? " on" : "") + (drag && drag.id === c.id ? " dragging" : "")}
              onPointerDown={(e) => startPress(e, c)}
              onClick={() => {
                if (suppress.current) return;
                if (mode === "grp") onGroup(c.id);
                else onCat(c as Category);
              }}
            >
              <Seal c={c} s={s} />
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>
      {drag && dragItem ? (
        <div
          className="cat on cdghost"
          aria-hidden="true"
          style={{ left: drag.rect.left, top: drag.rect.top, width: drag.rect.width, height: drag.rect.height, transform: `translate(${drag.px - drag.x0}px,${drag.py - drag.y0}px) scale(1.08)` } as CSSProperties}
        >
          <Seal c={dragItem} s={s} />
          <span>{dragItem.name}</span>
        </div>
      ) : null}
    </>
  );
}
