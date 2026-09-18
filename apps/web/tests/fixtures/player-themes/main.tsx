// Reuse the existing real-control story; no alternate component implementation.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "../../../src/design-system/tokens.generated.css";
import "../../../src/ui/gravity-foundation.css";
import "../../../src/styles.css";
import "../../../src/mobile-foundation.css";
import meta from "../../../src/design-system/PlayerThemes.stories";

createRoot(document.getElementById("root")!).render(
  createElement(meta.component),
);
