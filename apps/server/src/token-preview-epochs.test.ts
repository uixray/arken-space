import { describe, expect, it } from "vitest";
import { TokenPreviewEpochs } from "./token-preview-epochs";
describe("token preview epochs", () => {
  it("rotates on removal including scene changes, not reappearance", () => {
    const epochs = new TokenPreviewEpochs();
    const first = epochs.snapshot("socket", "campaign", ["a"]);
    expect(epochs.snapshot("socket", "campaign", ["a"]).epoch).toBe(first.epoch);
    const removed = epochs.snapshot("socket", "campaign", []);
    expect(removed.changed).toBe(true);
    expect(removed.epoch).not.toBe(first.epoch);
    const returned = epochs.snapshot("socket", "campaign", ["a"]);
    expect(returned.epoch).toBe(removed.epoch);
    expect(epochs.current("campaign")).toBe(returned.epoch);
    epochs.forget("socket");
    expect(epochs.snapshot("socket", "campaign", []).changed).toBe(false);
  });
});
