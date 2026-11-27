import { createRoot } from "react-dom/client";
import { EconomyManager } from "../EconomyManager";
const params = new URLSearchParams(location.search);
const context = {
  campaignId: params.get("campaign") ?? "",
  membershipId: params.get("member") ?? "",
};
createRoot(document.getElementById("root")!).render(
  <EconomyManager context={context} onSaved={() => {}} />,
);
