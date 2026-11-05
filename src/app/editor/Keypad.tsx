import { useEffect, useState } from "react";
import type { PadKey } from "../../core/editor";

export type PadTarget = "amount" | "fee" | "discount";

const KEYS: [PadKey, string?, string?][] = [
  ["÷", "op"], ["×", "op"], ["-", "op", "−"], ["+", "op"],
  ["7"], ["8"], ["9"], ["back", "op", "⌫"],
  ["4"], ["5"], ["6"], ["C", "op"],
  ["1"], ["2"], ["3"], ["=", "op"],
  [".", "", "."], ["0"], ["00"], ["ok", "go", "✓"],
];

export function Keypad({ shown, kind, hint, quick, onQuick, onKey }: { shown: boolean; kind: PadTarget; hint: string; quick: string[]; onQuick: (a: string) => void; onKey: (k: PadKey) => void }) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVis(shown));
    return () => cancelAnimationFrame(id);
  }, [shown]);
  return (
    <div className={"pad" + (vis && shown ? " show" : "")} role="group" aria-label="數字鍵盤">
      <div className="padlabel">
        <span>
          輸入{{ amount: "金額", fee: "手續費", discount: "折扣" }[kind]}
          {hint ? (
            <small className="num" style={{ marginLeft: 6, color: "var(--muted-foreground)" }}>
              {hint}
            </small>
          ) : null}
        </span>
      </div>
      {kind === "amount" && quick.length ? (
        <div className="quick">
          {quick.map((a) => (
            <button key={a} className="num" onClick={() => onQuick(a)}>
              {a}
            </button>
          ))}
        </div>
      ) : null}
      <div className="keys">
        {KEYS.map(([k, c, l]) => (
          <button key={k} className={c || ""} data-k={k} aria-label={({ back: "刪除", ok: "完成", C: "清除" } as Record<string, string>)[k] || l || k} onClick={() => onKey(k)}>
            {l || k}
          </button>
        ))}
      </div>
    </div>
  );
}
