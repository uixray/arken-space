import { createRoot } from "react-dom/client";
import { AccountAuthWorkspace } from "../AccountAuthWorkspace";
createRoot(document.getElementById("root")!).render(
  <AccountAuthWorkspace
    onAuthenticated={() => {}}
    capabilities={{
      accountAuthEnabled: true,
      registrationEnabled: false,
      legacyDevEnabled: false,
      campaignLinkAccessEnabled: false,
      campaignCreationEnabled: true,
    }}
  />,
);
