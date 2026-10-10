import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteWorldContentInstance } from "./world-content-instances-client";

afterEach(() => vi.unstubAllGlobals());

describe("deleteWorldContentInstance", () => {
  it("sends the exact revision/action envelope and accepts empty 204", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const command = {
      actionId: "abcd0000-0000-4000-8000-000000000001",
      revision: 7,
    };

    const result = await deleteWorldContentInstance("instance/one", command);

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/world-content-instances/instance%2Fone");
    expect(init).toMatchObject({
      method: "DELETE",
      body: JSON.stringify(command),
      credentials: "include",
    });
    expect(new Headers(init.headers).get("x-action-id")).toBe(command.actionId);
  });

  it("returns the idempotent replay receipt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ duplicate: true }), { status: 200 }),
      ),
    );
    await expect(
      deleteWorldContentInstance("instance-1", {
        actionId: "abcd0000-0000-4000-8000-000000000002",
        revision: 3,
      }),
    ).resolves.toEqual({ duplicate: true });
  });
});
