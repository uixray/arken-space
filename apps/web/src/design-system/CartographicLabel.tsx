import "./CartographicLabel.css";

/** Text-only decoration. The caller owns semantic heading/button, visibility,
 * positioning and persisted preferences. No map state or pointer handlers here. */
export function CartographicLabel({ text, presentation = "plain" }: {
  text: string;
  presentation?: "plain" | "ribbon";
}) {
  if (presentation === "plain") return <span>{text}</span>;
  return <span className="cartographic-label">
    {(["start", "end"] as const).map(side => <svg key={side}
      className={`cartographic-label__tail cartographic-label__tail--${side}`}
      viewBox="0 0 20 44" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M1 1H19V43H1L7 22Z" vectorEffect="non-scaling-stroke" />
    </svg>)}
    <span className="cartographic-label__text">{text}</span>
  </span>;
}
