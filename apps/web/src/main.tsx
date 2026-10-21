import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Before App: the Gravity button layer used to precede every app stylesheet.
import "./ui/legacy-button.css";
import "./random-uuid-polyfill";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AppToaster } from "./ui/AppToaster";
import { installInputDiagnostics } from "./input-diagnostics";
import {
  installClientEventFlushTriggers,
  installGlobalErrorReporting,
} from "./error-reporting";
import { installPerformanceReporting } from "./performance-reporting";
// Токены идут первыми: и Gravity foundation, и styles.css на них ссылаются.
import "./design-system/tokens.generated.css";
import "./ui/theme-root.css";
import "./design-system/foundations.css";
import "./ui/gravity-foundation.css";
import "./styles.css";
import "./mobile-foundation.css";
import { PlayerThemeRoot } from "./design-system/player-theme-runtime";

installInputDiagnostics();
// UIX-397: register before React mounts so startup/login-screen errors are
// captured too, independent of auth/campaign state.
installGlobalErrorReporting();
installClientEventFlushTriggers();
installPerformanceReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerThemeRoot>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
      <AppToaster />
    </PlayerThemeRoot>
  </StrictMode>,
);
