import type { PointerEvent as RPointerEvent } from "react";

/** 拖曳把手排序（滑鼠、觸控都可以）；放開後回傳新的 id 順序 */
export function startDrag(e: RPointerEvent<HTMLSpanElement>, done: (ids: string[]) => void) {
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
