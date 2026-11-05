/** 動態載入外部程式（例如讀 Excel 的 SheetJS） */
export function loadScript(src: string): Promise<void> {
  return new Promise((ok, no) => {
    const sc = document.createElement("script");
    sc.src = src;
    sc.onload = () => ok();
    sc.onerror = () => no(new Error("load"));
    document.head.appendChild(sc);
  });
}
