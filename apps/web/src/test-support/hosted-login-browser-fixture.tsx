import { createRoot } from "react-dom/client";
import { AccountAuthWorkspace } from "../AccountAuthWorkspace";
import "../design-system/tokens.generated.css";
import "../ui/theme-root.css";
import "../design-system/foundations.css";
import "../styles.css";
import "../mobile-foundation.css";
history.replaceState({}, "", "/account");
createRoot(document.getElementById("root")!).render(
  <AccountAuthWorkspace
    onAuthenticated={() => {}}
    capabilities={{
      accountAuthEnabled: true,
      registrationEnabled: false,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: false,
    }}
  />,
);
