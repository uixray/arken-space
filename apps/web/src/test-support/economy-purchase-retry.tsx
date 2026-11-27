import { createRoot } from "react-dom/client";
import { EconomyWorkspace } from "../EconomyWorkspace";
const p = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <EconomyWorkspace
    campaignId={p.get("campaign") ?? ""}
    membershipId={p.get("member") ?? ""}
    gm={false}
    characters={[{ id: p.get("character") ?? "", name: "Покупатель QA" }]}
    onClose={() => {}}
  />,
);
