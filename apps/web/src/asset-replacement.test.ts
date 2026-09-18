import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareAssetReplacement,
  commitAssetReplacement,
} from "./asset-replacement";
import { ApiError, resetClientEventBufferForTest } from "./api";

const version = `"${"a".repeat(64)}"`;
const file = () =>
  new File(["replacement"], "new-map.png", { type: "image/png" });
afterEach(() => {
  vi.unstubAllGlobals();
  resetClientEventBufferForTest();
});

describe("asset replacement intent", () => {
  it("captures only a strong version with a body-free authenticated fresh HEAD", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { headers: { etag: version } }));
    vi.stubGlobal("fetch", fetchMock);
    const candidate = file();
    const intent = await prepareAssetReplacement("asset/id", candidate);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/assets/asset%2Fid/content",
      {
        method: "HEAD",
        credentials: "include",
        cache: "no-store",
        signal: undefined,
      },
    );
    expect(intent).toEqual({
      assetId: "asset/id",
      file: candidate,
      version,
      actionId: expect.any(String),
    });
    expect(Object.isFrozen(intent)).toBe(true);
  });
  it.each([null, "", `W/${version}`, "*", '"unversioned"'])(
    "refuses unsafe version %s without a mutation",
    async (etag) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(null, { headers: etag === null ? {} : { etag } }),
        );
      vi.stubGlobal("fetch", fetchMock);
      await expect(prepareAssetReplacement("asset", file())).rejects.toThrow(
        "Версия файла недоступна",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 403, 404, 500])("fails closed on HEAD %i", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status, headers: { etag: version } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      prepareAssetReplacement("asset", file()),
    ).rejects.toMatchObject({ status, code: "ASSET_VERSION_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("localizes network failure and retains cancellation identity", async () => {
    const failure = new TypeError("Failed to fetch");
    const fetchMock = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      prepareAssetReplacement("asset", file()),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Не удалось проверить версию файла"),
      cause: failure,
    });
    const controller = new AbortController();
    controller.abort(failure);
    await expect(
      prepareAssetReplacement("asset", file(), controller.signal),
    ).rejects.toBe(failure);
  });
  it("keeps the exact file, version and action for an explicit retry without rereading HEAD", async () => {
    const result = {
      asset: { id: "asset" },
      version,
      replayed: true,
      oldBlobCleanupPending: true,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { headers: { etag: version } }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal("fetch", fetchMock);
    const candidate = file();
    const intent = await prepareAssetReplacement("asset", candidate);
    await expect(commitAssetReplacement(intent)).rejects.toThrow(
      "Не удалось связаться с сервером",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(commitAssetReplacement(intent)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      expect(init.method).toBe("PUT");
      expect(init.credentials).toBe("include");
      expect(init.headers.get("if-match")).toBe(version);
      expect(init.headers.get("x-action-id")).toBe(intent.actionId);
      expect(init.headers.has("content-type")).toBe(false);
      const sent = init.body.get("file") as File;
      expect(sent.name).toBe(candidate.name);
      expect(await sent.text()).toBe(await candidate.text());
    }
  });
  it("preserves stale-version refusal and does not retry or refresh it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { headers: { etag: version } }))
      .mockResolvedValueOnce(
        Response.json(
          { error: "ASSET_VERSION_CONFLICT", message: "Файл изменён" },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const intent = await prepareAssetReplacement("asset", file());
    const error = await commitAssetReplacement(intent).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "ASSET_VERSION_CONFLICT",
      actionId: intent.actionId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
