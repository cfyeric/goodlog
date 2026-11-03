/** 設定 → 更新紀錄 */
import { useEffect } from "react";
import { CHANGELOG } from "../changelog";
import { useNav } from "../nav";
import { UiIcon } from "../ui/Icon";

const WD = "日一二三四五六";

export function History() {
  const { view } = useNav();
  // 從設定頁下方點進來時，從最上面開始看
  useEffect(() => window.scrollTo(0, 0), []);
  return (
    <>
      <div className="top">
        <button className="iconbtn" aria-label="返回設定" onClick={() => view("settings")}>
          <UiIcon name="left" />
        </button>
        <h1>
          更新紀錄<small>好記上 GitHub 以來的修改</small>
        </h1>
      </div>
      <div className="stack" style={{ marginTop: 6 }}>
        {CHANGELOG.map((d) => {
          const [y, m, dd] = d.date.split("-").map(Number);
          return (
            <div className="card" key={d.date}>
              <div className="lbl-s num">
                {y} 年 {m} 月 {dd} 日 週{WD[new Date(y, m - 1, dd).getDay()]}
              </div>
              <ul className="chlog">
                {d.items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
