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
import { GravityFoundationPreview } from "./ui/GravityFoundationPreview";
import { appToaster } from "./ui/toaster";
import "./ui/gravity-foundation.css";
import "./styles.css";

configure({ lang: "ru" });

const showFoundationPreview = new URLSearchParams(window.location.search).has(
  "ui-foundation",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme="dark" lang="ru">
      <ToasterProvider toaster={appToaster}>
        {showFoundationPreview ? <GravityFoundationPreview /> : <App />}
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  </StrictMode>,
);
