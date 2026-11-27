import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TokenSpriteEditor } from "../sidebar/TokenSpriteEditor";
const p = new URLSearchParams(location.search);
function Fixture() {
  const [closed, setClosed] = useState(false);
  return closed ? (
    <p role="status">Набор сохранён</p>
  ) : (
    <TokenSpriteEditor
      definition={{
        id: p.get("id") ?? "",
        name: "QA",
        ownName: "QA",
        characterId: null,
        defaultAssetId: null,
        defaultWidth: 64,
        defaultHeight: 64,
        controllerMembershipIds: [],
        revision: 0,
      }}
      refresh={async () => {}}
      onClose={() => setClosed(true)}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
