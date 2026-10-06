import { useEffect, useState } from "react";

const SVG_NOISE = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <filter id="f" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" stitchTiles="stitch" result="noise"/>
    <feColorMatrix type="matrix" values="
      0 0 0 0 0.15
      0 0 0 0 0.15
      0 0 0 0 0.15
      1 0 0 0 0" in="noise" />
  </filter>
  <rect width="256" height="256" fill="#050505"/>
  <rect width="256" height="256" filter="url(#f)" opacity="0.7"/>
</svg>
`;

let cachedPattern: HTMLImageElement | null = null;

export function useFogPattern() {
  const [pattern, setPattern] = useState<HTMLImageElement | null>(
    cachedPattern,
  );

  useEffect(() => {
    if (cachedPattern) return;
    const img = new Image();
    const blob = new Blob([SVG_NOISE], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      cachedPattern = img;
      setPattern(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, []);

  return pattern;
}
