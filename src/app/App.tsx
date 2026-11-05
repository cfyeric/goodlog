import { lazy, Suspense } from "react";
import { AppProvider, useApp } from "./state";
import { NavProvider, useNav } from "./nav";
import { OverlayProvider } from "./editor/context";
import { Banner, RemindBar, TabBar, Toast, useDisarmOnClick, useFollowToday } from "./shell/Shell";
import { Home } from "./pages/Home";
import { Accounts } from "./pages/Accounts";
import { Projects } from "./pages/Projects";
import { EditorHost } from "./editor/EditorSheet";
import { TopupHost } from "./editor/TopupDialog";
import { SearchHost } from "./search/SearchSheet";
import { Aliases, Settings } from "./pages/Settings";
import { useOverlay } from "./editor/context";
import { supabaseConfigured } from "../data/supabaseClient";
import { AuthGate } from "./auth/AuthGate";
import type { LedgerStore } from "../data/store";

// 不常用的畫面點進去才下載，打開好記時要載入的程式比較少
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));
const History = lazy(() => import("./pages/History").then((m) => ({ default: m.History })));
const Cats = lazy(() => import("./pages/Cats").then((m) => ({ default: m.Cats })));
const Subcats = lazy(() => import("./pages/Cats").then((m) => ({ default: m.Subcats })));
const CatTx = lazy(() => import("./pages/Cats").then((m) => ({ default: m.CatTx })));
const ImportSheet = lazy(() => import("./import/ImportSheet").then((m) => ({ default: m.ImportSheet })));
const MozeSheet = lazy(() => import("./import/MozeSheet").then((m) => ({ default: m.MozeSheet })));

function ImportHost() {
  const { importOpen } = useOverlay();
  const { ledger } = useApp();
  if (!importOpen || !ledger) return null;
  return (
    <Suspense fallback={null}>
      <ImportSheet ledger={ledger} />
    </Suspense>
  );
}

function MozeHost() {
  const { mozeOpen } = useOverlay();
  if (!mozeOpen) return null;
  return (
    <Suspense fallback={null}>
      <MozeSheet />
    </Suspense>
  );
}

export function App() {
  if (supabaseConfigured) return <AuthGate>{(store) => <Shell store={store} />}</AuthGate>;
  return <Shell />;
}

function Shell({ store }: { store?: LedgerStore }) {
  return (
    <AppProvider store={store}>
      <NavProvider>
        <OverlayProvider>
          <Main />
          <TabBar />
          <ImportHost />
          <MozeHost />
          <SearchHost />
          <EditorHost />
          <TopupHost />
          <Toast />
        </OverlayProvider>
      </NavProvider>
    </AppProvider>
  );
}

function Main() {
  const { ledger } = useApp();
  const { nav } = useNav();
  const { setImportOpen } = useOverlay();
  useFollowToday();
  useDisarmOnClick();
  if (!ledger)
    return (
      <div className="app">
        <div className="top">
          <h1>好記</h1>
        </div>
        <div className="empty">
          <b>正在讀取你的帳本…</b>連線雲端資料庫中
        </div>
      </div>
    );
  let page;
  switch (nav.view) {
    case "home":
      page = <Home ledger={ledger} />;
      break;
    case "acc":
      page = <Accounts ledger={ledger} onImport={() => setImportOpen(true)} />;
      break;
    case "proj":
      page = <Projects ledger={ledger} />;
      break;
    case "report":
      page = <Reports ledger={ledger} />;
      break;
    case "settings":
      page = <Settings ledger={ledger} />;
      break;
    case "cats":
      page = <Cats ledger={ledger} />;
      break;
    case "subcats":
      page = <Subcats ledger={ledger} />;
      break;
    case "cattx":
      page = <CatTx ledger={ledger} />;
      break;
    case "aliases":
      page = <Aliases ledger={ledger} />;
      break;
    case "history":
      page = <History />;
      break;
  }
  return (
    <div className="app">
      <Banner />
      <RemindBar />
      <Suspense fallback={<div className="empty">載入中…</div>}>{page}</Suspense>
    </div>
  );
}
