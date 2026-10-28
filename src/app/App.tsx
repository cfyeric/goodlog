import { AppProvider, useApp } from "./state";
import { NavProvider, useNav } from "./nav";
import { OverlayProvider } from "./editor/context";
import { Banner, RemindBar, TabBar, Toast, useDisarmOnClick, useFollowToday } from "./shell/Shell";
import { Home } from "./pages/Home";
import { Accounts } from "./pages/Accounts";
import { Projects } from "./pages/Projects";
import { EditorHost } from "./editor/EditorSheet";
import { TopupHost } from "./editor/TopupDialog";
import { ImportHost } from "./import/ImportSheet";
import { useOverlay } from "./editor/context";

export function App() {
  return (
    <AppProvider>
      <NavProvider>
        <OverlayProvider>
          <Main />
          <TabBar />
          <ImportHost />
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
    default:
      page = (
        <div className="empty" style={{ marginTop: 16 }}>
          <b>這一頁還在改寫中</b>React 版會一頁一頁完成。
        </div>
      );
  }
  return (
    <div className="app">
      <Banner />
      <RemindBar />
      {page}
    </div>
  );
}
