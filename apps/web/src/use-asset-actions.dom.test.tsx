// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderComponent } from "./test-support/render";
import { useAssetActions, type AssetActions } from "./use-asset-actions";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));

function Harness({
  load,
  receive,
}: {
  load: () => Promise<void>;
  receive: (actions: AssetActions) => void;
}) {
  receive(useAssetActions({ load }));
  return null;
}

const input = {
  sourceAssetId: "source-1",
  cropX: 0.25,
  cropY: 0.75,
  zoom: 2,
  frame: "NONE" as const,
  name: "Token",
};

describe("token generation replay key", () => {
  it("keeps the caller key through a refresh failure and retry", async () => {
    const asset = { id: "token-1", kind: "TOKEN" };
    apiMock.mockReset().mockResolvedValue(asset);
    const failure = new Error("Refresh failed");
    const load = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    let actions!: AssetActions;
    renderComponent(
      <Harness
        load={load}
        receive={(value) => {
          actions = value;
        }}
      />,
    );

    await expect(
      actions.generateTokenImage(input, { actionId: "command-1" }),
    ).rejects.toBe(failure);
    await expect(
      actions.generateTokenImage(input, { actionId: "command-1" }),
    ).resolves.toBe(asset);
    expect(apiMock).toHaveBeenCalledTimes(2);
    for (const call of apiMock.mock.calls) {
      expect(call).toEqual([
        "/api/assets/source-1/token",
        {
          method: "POST",
          headers: { "x-action-id": "command-1" },
          body: JSON.stringify({
            cropX: 0.25,
            cropY: 0.75,
            zoom: 2,
            frame: "NONE",
            name: "Token",
          }),
        },
      ]);
    }
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retains UUID generation for standalone calls without a caller key", async () => {
    apiMock.mockReset().mockResolvedValue({ id: "token-2" });
    const load = vi.fn().mockResolvedValue(undefined);
    let actions!: AssetActions;
    renderComponent(
      <Harness
        load={load}
        receive={(value) => {
          actions = value;
        }}
      />,
    );
    await actions.generateTokenImage(input);
    const request = apiMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("x-action-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(load).toHaveBeenCalledTimes(1);
  });
});

it("replacement commit and refresh are separate stable actions", async () => {
  const result = { asset: { id: "asset" }, version: '"new"', replayed: false };
  apiMock.mockReset().mockResolvedValue(result);
  const load = vi.fn().mockRejectedValue(new Error("Refresh failed"));
  let actions!: AssetActions;
  const view = renderComponent(
    <Harness
      load={load}
      receive={(value) => {
        actions = value;
      }}
    />,
  );
  const before = actions;
  view.rerender(
    <Harness
      load={load}
      receive={(value) => {
        actions = value;
      }}
    />,
  );
  expect(actions.replaceAsset).toBe(before.replaceAsset);
  expect(actions.refreshAssets).toBe(before.refreshAssets);
  const intent = {
    assetId: "asset",
    file: new File(["file"], "map.png"),
    version: '"old"',
    actionId: "same-intent",
  };
  await expect(actions.replaceAsset(intent)).resolves.toBe(result);
  expect(load).not.toHaveBeenCalled();
  await expect(actions.refreshAssets()).rejects.toThrow("Refresh failed");
  expect(apiMock).toHaveBeenCalledTimes(1);
  const [path, init] = apiMock.mock.calls[0]!;
  expect(path).toBe("/api/assets/asset/content");
  expect(init.method).toBe("PUT");
  expect(init.headers).toEqual({
    "if-match": intent.version,
    "x-action-id": intent.actionId,
  });
  expect(init.body.get("file")).toBe(intent.file);
});
