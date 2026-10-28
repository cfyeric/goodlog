/** 開啟記帳畫面、加值對話框等浮層的共用入口 */
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Tx } from "../../core/types";

export interface EditorRequest {
  /** 要編輯的記錄；null 表示新增 */
  tx: Tx | null;
  /** 確認待入帳：打開時清空金額、直接開數字鍵盤 */
  confirmPending?: boolean;
  /** 新增時預設的日期 */
  date?: string;
  /** 新增時預先填好的內容（帳單比對「補記」用） */
  prefill?: { t: Partial<Tx>; ex: Partial<{ amount: string; fee: string; discount: string }>; fromImp?: { desc: string } };
}

export interface TopupRequest {
  id?: string;
  m?: string;
  cardId: string;
  amount: string;
  date: string;
  note?: string;
}

interface OverlayCtx {
  editor: EditorRequest | null;
  openEditor: (r: EditorRequest) => void;
  closeEditor: () => void;
  topup: TopupRequest | null;
  openTopup: (r: TopupRequest | null) => void;
  /** 信用卡帳單比對畫面 */
  importOpen: boolean;
  setImportOpen: (v: boolean) => void;
  /** 從 MOZE 匯入畫面 */
  mozeOpen: boolean;
  setMozeOpen: (v: boolean) => void;
}

const Ctx = createContext<OverlayCtx | null>(null);

export function useOverlay(): OverlayCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOverlay 要在 OverlayProvider 裡使用");
  return v;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [topup, setTopup] = useState<TopupRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mozeOpen, setMozeOpen] = useState(false);
  return (
    <Ctx.Provider value={{ editor, openEditor: setEditor, closeEditor: () => setEditor(null), topup, openTopup: setTopup, importOpen, setImportOpen, mozeOpen, setMozeOpen }}>
      {children}
    </Ctx.Provider>
  );
}
