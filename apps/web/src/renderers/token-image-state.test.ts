import { describe, expect, it } from "vitest";
import {
  createTokenImageState,
  resolveTokenImageState,
} from "./token-image-state";
describe("token image state", () => {
  it("handles first load", () => {
    const image = { id: "a" };
    expect(
      resolveTokenImageState(createTokenImageState("a"), {
        src: "a",
        image,
        loadStatus: "loaded",
      }),
    ).toEqual({
      requestedSrc: "a",
      displayedImage: image,
      availability: "loaded",
    });
  });
  it("retains across transient null", () => {
    const image = { id: "a" };
    const loaded = resolveTokenImageState(createTokenImageState("a"), {
      src: "a",
      image,
      loadStatus: "loaded",
    });
    expect(
      resolveTokenImageState(loaded, {
        src: "a",
        image: null,
        loadStatus: "loading",
      }),
    ).toMatchObject({ displayedImage: image, availability: "retained" });
  });
  it("retains across src change, then loads the new image", () => {
    const image = { id: "a" };
    const loaded = resolveTokenImageState(createTokenImageState("a"), {
      src: "a",
      image,
      loadStatus: "loaded",
    });
    const retained = resolveTokenImageState(loaded, {
      src: "b",
      image,
      loadStatus: "loaded",
    });
    expect(retained).toEqual({
      requestedSrc: "b",
      displayedImage: image,
      availability: "retained",
    });
    const nextImage = { id: "b" };
    expect(
      resolveTokenImageState(retained, {
        src: "b",
        image: nextImage,
        loadStatus: "loaded",
      }),
    ).toEqual({
      requestedSrc: "b",
      displayedImage: nextImage,
      availability: "loaded",
    });
  });
  it("distinguishes explicit missing asset", () => {
    const loaded = resolveTokenImageState(createTokenImageState("a"), {
      src: "a",
      image: { id: "a" },
      loadStatus: "loaded",
    });
    expect(
      resolveTokenImageState(loaded, {
        src: null,
        image: null,
        loadStatus: "loading",
        missingAsset: true,
      }),
    ).toEqual({
      requestedSrc: null,
      displayedImage: null,
      availability: "missing-asset",
    });
  });
});
