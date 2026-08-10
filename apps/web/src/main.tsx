import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  configure,
  ThemeProvider,
  ToasterComponent,
  ToasterProvider,
} from "@gravity-ui/uikit";
import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "./random-uuid-polyfill";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { appToaster } from "./ui/toaster";
import { installInputDiagnostics } from "./input-diagnostics";
import {
  installClientEventFlushTriggers,
  installGlobalErrorReporting,
} from "./error-reporting";
import { installPerformanceReporting } from "./performance-reporting";
import "./ui/gravity-foundation.css";
import "./styles.css";

configure({ lang: "ru" });
installInputDiagnostics();
// UIX-397: register before React mounts so startup/login-screen errors are
// captured too, independent of auth/campaign state.
installGlobalErrorReporting();
installClientEventFlushTriggers();
installPerformanceReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme="dark" lang="ru">
      <ToasterProvider toaster={appToaster}>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  </StrictMode>,
);
