import { BrowserRouter, useLocation } from "react-router-dom";
import Routes from "./Routes";
import LionExSideNav from "./components/LionExSideNav";

import {
  AppBridgeProvider,
  QueryProvider,
  PolarisProvider,
} from "./components";

export default function App() {
  const pages = import.meta.globEager("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");

  return (
    <BrowserRouter>
      <PolarisProvider>
        <AppBridgeProvider>
          <QueryProvider>
            <AppContent pages={pages} />
          </QueryProvider>
        </AppBridgeProvider>
      </PolarisProvider>
    </BrowserRouter>
  );
}

function AppContent({ pages }) {
  const location = useLocation();
  const shelllessRoutes = ["/", "/homepage", "/orders", "/linkStore", "/syncstatus", "/configuration"];
  const isShelllessRoute = shelllessRoutes.includes(location.pathname.toLowerCase());

  return (
    <>
      {isShelllessRoute ? (
        <Routes pages={pages} />
      ) : (
        <div className="app-shell app-shell--lionex">
          <LionExSideNav />
          <div className="app-shell__content">
            <Routes pages={pages} />
          </div>
        </div>
      )}
    </>
  );
}