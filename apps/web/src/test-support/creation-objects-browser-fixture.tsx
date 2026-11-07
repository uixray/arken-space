import { createRoot } from "react-dom/client";
import { CreationWorkspace } from "../CreationWorkspace";
import "../design-system/tokens.generated.css";
import "../ui/theme-root.css";
import "../design-system/foundations.css";
import "../styles.css";
import "../mobile-foundation.css";
import "../CreationWorkspace.css";
const params=new URLSearchParams(location.search);
const campaignId=params.get("campaign")??"campaign", membershipId=params.get("member")??"member";
const character={id:params.get("character")??"00000000-0000-4000-8000-000000000002",name:"Игрок",ownerMembershipId:membershipId};
function Fixture(){return <CreationWorkspace campaignId={campaignId} membershipId={membershipId} gm={params.get("gm") === "1"} characters={[character]} onClose={()=>{}}/>}
createRoot(document.getElementById("root")!).render(<Fixture/>);
