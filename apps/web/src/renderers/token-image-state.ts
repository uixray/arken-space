export type TokenImageAvailability =
  "loading" | "loaded" | "retained" | "missing-asset";
export type TokenImageState<T> = {
  requestedSrc: string | null;
  displayedImage: T | null;
  availability: TokenImageAvailability;
};
export const createTokenImageState = <T>(
  src: string | null,
): TokenImageState<T> => ({
  requestedSrc: src,
  displayedImage: null,
  availability: src ? "loading" : "missing-asset",
});
export function resolveTokenImageState<T>(
  previous: TokenImageState<T>,
  input: {
    src: string | null;
    image: T | null;
    loadStatus: string;
    missingAsset?: boolean;
  },
): TokenImageState<T> {
  if (input.missingAsset || !input.src)
    return {
      requestedSrc: input.src,
      displayedImage: null,
      availability: "missing-asset",
    };
  // useImage can expose the previous src's result for one render.
  if (previous.requestedSrc !== input.src)
    return {
      requestedSrc: input.src,
      displayedImage: previous.displayedImage,
      availability: previous.displayedImage ? "retained" : "loading",
    };
  if (input.loadStatus === "loaded" && input.image)
    return {
      requestedSrc: input.src,
      displayedImage: input.image,
      availability: "loaded",
    };
  return {
    requestedSrc: input.src,
    displayedImage: previous.displayedImage,
    availability: previous.displayedImage ? "retained" : "loading",
  };
}
