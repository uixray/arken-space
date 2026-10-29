import type { SVGProps } from "react";

/** Small, deterministic polyhedral silhouettes for the physical-dice tray. */
export function DiceShapeIcon({
  sides,
  ...props
}: SVGProps<SVGSVGElement> & { sides: number }) {
  const polygons: Record<number, string> = {
    4: "12,2 22,20 2,20",
    6: "5,4 19,4 22,12 19,20 5,20 2,12",
    8: "12,2 22,12 12,22 2,12",
    10: "12,2 20,7 18,19 6,19 4,7",
    12: "12,2 18,4 22,10 20,17 15,22 8,21 3,16 2,9 6,4",
    20: "12,2 22,8 20,19 12,22 4,19 2,8",
  };
  return (
    <svg
      className="arken-icon dice-shape-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {sides === 2 ? (
        <>
          <ellipse cx="12" cy="12" rx="8" ry="10" />
          <path d="M5 12h14M12 3v18" />
        </>
      ) : sides === 100 ? (
        <>
          <path d="M7 3 14 6 13 14 6 16 3 10zM17 8l5 3-1 8-7 2-2-7z" />
          <path d="m7 3 2 9m5-6-8 10m5-1 7-7m-5 14 2-7" />
        </>
      ) : (
        <>
          <polygon points={polygons[sides] ?? polygons[6]} />
          {sides === 4 && <path d="M12 2v10M2 20l10-8 10 8" />}
          {sides === 6 && <path d="m5 4 7 8 7-8M2 12h20M5 20l7-8 7 8" />}
          {sides === 8 && (
            <path d="M2 12h20M12 2v20M2 12l10 10 10-10M12 2 2 12" />
          )}
          {sides === 10 && <path d="M12 2v9M4 7l8 4 8-4m-2 12-6-8-6 8" />}
          {sides === 12 && (
            <path d="m12 2 3 8 7 0-6 4 2 8-6-5-6 5 2-8-6-4h7z" />
          )}
          {sides === 20 && (
            <path d="m12 2-5 9 5 11 5-11zM2 8l10 3 10-3M4 19l8-8 8 8" />
          )}
        </>
      )}
    </svg>
  );
}
