import { type DiceFrameReference } from "@arken/contracts";

export function OutcomeFrame({
  frame,
  active,
}: {
  frame: DiceFrameReference | null;
  active: boolean;
}) {
  if (!frame) return null;

  if (frame.setKey === "ARKEN_CRITICAL_V1") {
    // UIX-289: Only active/newest card animates to prevent history lag.
    // prefers-reduced-motion is handled via CSS or picture tag if static poster is available.
    const src = `/assets/frames/${frame.frameKey}.png`;

    // For APNGs, since we do not currently have a static poster generation pipeline,
    // we use a CSS class to reduce its visual weight, or completely hide the img
    // and rely on a fallback border if not active.
    return (
      <span
        className={`outcome-frame outcome-frame--${frame.frameKey} ${active ? "outcome-frame--active" : "outcome-frame--inactive"}`}
        aria-hidden="true"
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </span>
    );
  }

  return null;
}
