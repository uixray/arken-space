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
import "./ui/gravity-foundation.css";
import "./styles.css";

configure({ lang: "ru" });
installInputDiagnostics();

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
