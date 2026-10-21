import {
  type DiceFrameChoice,
  type DiceFrameReference,
} from "@arken/contracts";

function diceStyleFrameUrls(assetId: string) {
  const base = `/api/assets/${encodeURIComponent(assetId)}/content`;
  return { animated: base, poster: `${base}?variant=poster` };
}

export function OutcomeFrame({
  frame,
  styleFrame = null,
  active,
}: {
  frame: DiceFrameReference | null;
  /** UIX-457: рамка игрока или навыка; при крите уступает критической. */
  styleFrame?: DiceFrameChoice | null;
  active: boolean;
}) {
  if (frame?.setKey === "ARKEN_CRITICAL_V1") {
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

  if (styleFrame) {
    // Анимирован только свежий бросок; история и reduced motion получают
    // постер, чтобы лента не крутила десятки анимаций разом.
    const urls = diceStyleFrameUrls(styleFrame.assetId);
    return (
      <span
        className={`outcome-frame outcome-frame--style ${active ? "outcome-frame--style-active" : "outcome-frame--style-history"}`}
        data-frame-source={styleFrame.source}
        aria-hidden="true"
      >
        <picture>
          {active && (
            <source
              media="(prefers-reduced-motion: reduce)"
              srcSet={urls.poster}
            />
          )}
          <img
            src={active ? urls.animated : urls.poster}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </picture>
      </span>
    );
  }

  return null;
}
