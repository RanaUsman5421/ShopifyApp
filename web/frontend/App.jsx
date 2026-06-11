import { BrowserRouter } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { NavigationMenu } from "@shopify/app-bridge-react";
import Routes from "./Routes";
import LionExSideNav from "./components/LionExSideNav";

import {
  AppBridgeProvider,
  QueryProvider,
  PolarisProvider,
  TopBar,
} from "./components";

export default function App() {
  const pages = import.meta.globEager("./pages/**/!(*.test.[jt]sx)*.([jt]sx)");

  return (
    <PolarisProvider>
      <BrowserRouter>
        <AppBridgeProvider>
          <QueryProvider>
            <AppContent pages={pages} />
          </QueryProvider>
        </AppBridgeProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}

function AppContent({ pages }) {
  const location = useLocation();
  const shelllessRoutes = ["/", "/homepage", "/orders", "/menu", "/syncstatus", "/configuration", "/privacypolicy"];
  const isShelllessRoute = shelllessRoutes.includes(location.pathname.toLowerCase());

  return (
    <>
      <NavigationMenu navigationLinks={[]} />
      {isShelllessRoute ? (
        <Routes pages={pages} />
      ) : (
        <div className="app-shell app-shell--lionex">
          <LionExSideNav />
          <div className="app-shell__content">
            <TopBar />
            <Routes pages={pages} />
          </div>
        </div>
      )}
    </>
  );
}
