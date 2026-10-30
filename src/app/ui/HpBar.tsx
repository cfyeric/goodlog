/**
 * 收支血條：一條代表收入，支出從右邊往左吃掉，儲蓄夾在收入和支出中間。
 * - 整條的基準是收入；支出加儲蓄超過收入時，基準改成兩者合計，整條被藍、紅佔滿（綠色歸零）。
 * - 下方數字：綠色顯示收入總額（不是剩下多少），藍色儲蓄，紅色支出。
 */
import { formatMoney } from "../../core/money";

export function HpBar({ inc, exp, save, showSave }: { inc: number; exp: number; save: number; showSave: boolean }) {
  const sv = showSave ? save : 0;
  const base = Math.max(inc, exp + sv);
  const pct = (v: number) => (base > 0 ? (v / base) * 100 : 0);
  const gw = Math.max(0, pct(inc - exp - sv));
  const label = `收入 ${formatMoney(inc)}${showSave ? `，儲蓄 ${formatMoney(sv)}` : ""}，支出 ${formatMoney(exp)}${exp + sv > inc ? "，已超過收入" : ""}`;
  return (
    <div className="hp">
      <div className="hpbar" role="img" aria-label={label}>
        <i className="hpi" style={{ width: gw + "%" }} />
        <span className="hpgap" />
        {sv > 0 ? <i className="hps" style={{ width: pct(sv) + "%" }} /> : null}
        {exp > 0 ? <i className="hpe" style={{ width: pct(exp) + "%" }} /> : null}
      </div>
      <div className="hpleg num">
        <span style={{ color: "var(--hp-inc-t)" }}>
          收入 <b>{formatMoney(inc)}</b>
        </span>
        {showSave ? (
          <span style={{ color: "var(--hp-save-t)" }}>
            儲蓄 <b>{formatMoney(sv)}</b>
          </span>
        ) : null}
        <span style={{ color: "var(--hp-exp-t)" }}>
          支出 <b>{formatMoney(exp)}</b>
        </span>
      </div>
    </div>
  );
}
