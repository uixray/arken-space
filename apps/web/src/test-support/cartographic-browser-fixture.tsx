import { createRoot } from "react-dom/client";
import "../design-system/tokens.generated.css";
import "../ui/theme-root.css";
import "../design-system/foundations.css";
import { PositionedCartographicLabel } from "../PositionedCartographicLabel";
import "../design-system/CartographicLabel.css";

function Fixture() {
  return (
    <main>
      {["#eee", "#171717"].map((background) => (
        <div
          key={background}
          data-cartographic-boundary
          style={{
            position: "relative",
            width: "min(600px, 90vw)",
            height: 180,
            margin: "12px",
            background,
          }}
        >
          <button
            type="button"
            className="world-map-marker--configured"
            style={{ position: "absolute", left: "88%", top: 60 }}
          >
            <span className="world-map-marker__label--configured">
              <PositionedCartographicLabel
                text="Восточный вход"
                config={{ presentation: "ribbon", offsetX: 80, offsetY: -20 }}
                layoutKey={background}
              />
            </span>
          </button>
        </div>
      ))}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
