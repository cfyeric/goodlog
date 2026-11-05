import { useState } from "react";

/** 標籤輸入：打字時保留原文，離開欄位才拆成陣列 */
export function TagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [txt, setTxt] = useState(tags.join(" "));
  const parse = (v: string) => v.split(/[\s,，]+/).map((x) => x.replace(/^#/, "")).filter(Boolean);
  return (
    <input
      id="f-tags"
      type="search"
      enterKeyHint="done"
      autoComplete="off"
      placeholder="標籤（以空白分隔）"
      value={txt}
      onChange={(e) => {
        setTxt(e.target.value);
        onChange(parse(e.target.value));
      }}
    />
  );
}
