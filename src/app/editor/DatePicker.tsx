/** 記帳畫面的日期選擇 */
import { useEffect, useRef, useState } from "react";
import { pd, ymd } from "../../core/dates";
import { UiIcon } from "../ui/Icon";

const WD = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

export function DatePicker({ value, today, onPick, onClose }: { value: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const [ym, setYm] = useState((value || today).slice(0, 7));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = root.current?.querySelector(".day.sel,.day.today") as HTMLElement | null;
    f?.focus({ preventScroll: true });
  }, []);
  const [Y, M] = ym.split("-").map(Number);
  const first = new Date(Y, M - 1, 1);
  const off = (first.getDay() + 6) % 7;
  const start = new Date(Y, M - 1, 1 - off);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = ymd(d);
    if (i === 35 && d.getMonth() !== M - 1) break;
    const cls = ["day"];
    if (d.getMonth() !== M - 1) cls.push("out");
    if (ds === today) cls.push("today");
    if (ds === value) cls.push("sel");
    cells.push(
      <button key={ds} className={cls.join(" ")} aria-label={`${d.getMonth() + 1}月${d.getDate()}日 ${WD[d.getDay()]}`} aria-current={ds === value ? "date" : undefined} onClick={() => onPick(ds)}>
        <span className="d">{d.getDate()}</span>
      </button>,
    );
  }
  const mon = (k: number) => {
    const d = pd(ym + "-01");
    d.setMonth(d.getMonth() + k);
    setYm(ymd(d).slice(0, 7));
  };
  return (
    <div className="dlg-ov" ref={root} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg dp enter" role="dialog" aria-modal="true" aria-label="選擇日期">
        <div className="dphead">
          <b className="num">
            {Y} 年 {M} 月
          </b>
          <button className="iconbtn" aria-label="上個月" onClick={() => mon(-1)}>
            <UiIcon name="left" />
          </button>
          <button className="iconbtn" aria-label="下個月" onClick={() => mon(1)}>
            <UiIcon name="right" />
          </button>
        </div>
        <div className="wk">
          {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="grid">{cells}</div>
        <div className="acts">
          <button className="btn" onClick={() => onPick(ymd(new Date()))}>
            今天
          </button>
          <button className="btn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
