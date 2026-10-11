// @vitest-environment jsdom
import {
  useStatLayoutActions,
  type StatLayoutActions,
} from "./use-stat-layout-actions";
import { renderComponent, act } from "./test-support/render";
import type { StatLayout } from "@arken/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({ api: mocks.api }));

let actions: StatLayoutActions | null = null;
function Harness({
  load,
  receive,
}: {
  load: () => Promise<void>;
  receive: (value: StatLayoutActions) => void;
}) {
  receive(useStatLayoutActions({ load }));
  return null;
}

beforeEach(() => {
  actions = null;
  mocks.api.mockReset();
});

describe("per-character stat layout command", () => {
  it("retains the same action id after an uncertain request failure", async () => {
    const load = vi.fn(async () => undefined);
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000001");
    vi.stubGlobal("crypto", { randomUUID });
    mocks.api
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ characterId: "character/a", revision: 8 });
    renderComponent(
      <Harness load={load} receive={(value) => (actions = value)} />,
    );
    const layout: StatLayout = [];

    await expect(
      actions!.onUpdateCharacterStatLayout("character/a", layout, 7),
    ).rejects.toThrow("connection lost");
    await act(async () => {
      await actions!.onUpdateCharacterStatLayout("character/a", layout, 7);
    });

    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.api).toHaveBeenNthCalledWith(
      1,
      "/api/characters/character%2Fa/stat-layout",
      expect.objectContaining({ method: "PATCH" }),
    );
    const firstBody = JSON.parse(mocks.api.mock.calls[0]![1].body as string);
    const retryBody = JSON.parse(mocks.api.mock.calls[1]![1].body as string);
    expect(firstBody).toEqual({
      actionId: "00000000-0000-4000-8000-000000000001",
      revision: 7,
      layout,
    });
    expect(retryBody).toEqual(firstBody);
    expect(load).toHaveBeenCalledOnce();
    expect(randomUUID).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
