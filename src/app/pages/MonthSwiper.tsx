/**
 * 日曆左右滑動切換月份：手指（或滑鼠）拖曳時跟著移動，旁邊露出上、下個月；
 * 放開時滑超過寬度的 18%，或快速甩動，就換月份，否則彈回。
 * 上下捲動頁面不受影響（touch-action: pan-y）。電腦上也可以用鍵盤 ← →。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { pd, ymd } from "../../core/dates";

const GAP = 12;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const addYm = (ym: string, k: number) => {
  const d = pd(ym + "-01");
  d.setMonth(d.getMonth() + k);
  return ymd(d).slice(0, 7);
};

export function MonthSwiper({ ym, onMonth, render }: { ym: string; onMonth: (k: number) => void; render: (ym: string) => ReactNode }) {
  const vp = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [smooth, setSmooth] = useState(false);
  const drag = useRef({ id: -1, x0: 0, y0: 0, t0: 0, mode: "idle" as "idle" | "h" | "v", suppressUntil: 0, busy: false });

  const finish = (dir: number) => {
    const w = vp.current?.offsetWidth || 300;
    if (!dir) {
      setSmooth(true);
      setDx(0);
      return;
    }
    if (reduced()) {
      setSmooth(false);
      setDx(0);
      onMonth(dir);
      return;
    }
    drag.current.busy = true;
    setSmooth(true);
    setDx(-dir * (w + GAP));
    window.setTimeout(() => {
      // 動畫結束：換成新月份，位置歸零（新月份正好在中間，看不出跳動）
      setSmooth(false);
      setDx(0);
      onMonth(dir);
      drag.current.busy = false;
    }, 230);
  };

  // 鍵盤 ← → 換月份（有其他畫面蓋在上面或正在輸入時不作用）
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable]") || document.querySelector(".sheet,.dlg-ov")) return;
      if (drag.current.busy) return;
      finish(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return (
    <div
      ref={vp}
      className="mswipe"
      aria-roledescription="可左右滑動切換月份"
      onPointerDown={(e) => {
        if (drag.current.busy || (e.pointerType === "mouse" && e.button !== 0)) return;
        drag.current = { ...drag.current, id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: "idle" };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d.id !== e.pointerId || d.mode === "v") return;
        const mx = e.clientX - d.x0, my = e.clientY - d.y0;
        if (d.mode === "idle") {
          if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
            d.mode = "h";
            try {
              vp.current?.setPointerCapture(e.pointerId);
            } catch {
              /* 不支援就算了 */
            }
          } else if (Math.abs(my) > 8) d.mode = "v";
          else return;
        }
        if (d.mode === "h") {
          setSmooth(false);
          setDx(mx);
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (d.id !== e.pointerId) return;
        d.id = -1;
        if (d.mode !== "h") return;
        d.suppressUntil = performance.now() + 400;
        const mx = e.clientX - d.x0;
        const w = vp.current?.offsetWidth || 300;
        const v = Math.abs(mx) / Math.max(1, performance.now() - d.t0);
        finish(Math.abs(mx) > w * 0.18 || (v > 0.45 && Math.abs(mx) > 24) ? (mx < 0 ? 1 : -1) : 0);
      }}
      onPointerCancel={() => {
        if (drag.current.mode === "h") finish(0);
        drag.current.id = -1;
      }}
      onClickCapture={(e) => {
        // 剛拖曳完放開時，不要當成點了某一天
        if (performance.now() < drag.current.suppressUntil) {
          drag.current.suppressUntil = 0;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <div className="mtrack" style={{ transform: dx ? `translate3d(${dx}px,0,0)` : undefined, transition: smooth ? "transform .22s cubic-bezier(.2,.8,.2,1)" : "none" }}>
        <div className="mpane prev" aria-hidden="true" inert>
          {dx > 0 ? render(addYm(ym, -1)) : null}
        </div>
        <div className="mpane">{render(ym)}</div>
        <div className="mpane next" aria-hidden="true" inert>
          {dx < 0 ? render(addYm(ym, 1)) : null}
        </div>
      </div>
    </div>
  );
}
