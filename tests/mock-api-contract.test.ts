import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accountCampaignListSchema } from "../packages/contracts/src/account-auth";
import {
  DENIED_CAPABILITY_GETS,
  EMPTY_COLLECTION_GETS,
  EMPTY_OBJECT_GETS,
  UnmockedApiRequestError,
  unmockedResponse,
} from "./e2e/mock-api-contract";

const serverDir = new URL("../apps/server/src/", import.meta.url);
const serverGets = new Set(
  readdirSync(serverDir)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .flatMap((name) =>
      [
        ...readFileSync(new URL(name, serverDir), "utf8").matchAll(
          /\.get(?:<[^>]*>)?\(\s*"(\/api\/[^"]+)"/g,
        ),
      ].map((match) => match[1]!),
    ),
);

describe("e2e mock API contract (UIX-693)", () => {
  it("only lists GET routes the server actually registers", () => {
    expect(serverGets.size).toBeGreaterThan(50);
    const unknown = [
      ...EMPTY_COLLECTION_GETS,
      ...Object.keys(EMPTY_OBJECT_GETS),
      ...Object.keys(DENIED_CAPABILITY_GETS),
    ].filter((path) => !serverGets.has(path));
    expect(unknown).toEqual([]);
  });

  it("answers a known collection with an empty list", () => {
    expect(unmockedResponse("GET", "/api/stickers")).toEqual({
      status: 200,
      json: [],
    });
  });

  it("answers an object-shaped read with its empty object, not a list", () => {
    expect(unmockedResponse("GET", "/api/story/posts")).toEqual({
      status: 200,
      json: { posts: [], nextCursor: null },
    });
    expect(
      unmockedResponse("GET", "/api/characters/c-1/spell-branches"),
    ).toEqual({ status: 200, json: { branches: [], nextCursor: null } });
    expect(() =>
      accountCampaignListSchema.parse(
        EMPTY_OBJECT_GETS["/api/account/campaigns"],
      ),
    ).not.toThrow();
  });

  it("matches route templates one segment per parameter", () => {
    expect(unmockedResponse("GET", "/api/characters/c-1/media")).toEqual({
      status: 200,
      json: [],
    });
    expect(() =>
      unmockedResponse("GET", "/api/characters/c-1/media/extra"),
    ).toThrow(UnmockedApiRequestError);
    expect(() => unmockedResponse("GET", "/api/characters//media")).toThrow(
      UnmockedApiRequestError,
    );
  });

  it("answers a capability probe like the server does for a member", () => {
    expect(
      unmockedResponse("GET", "/api/operator/feedback/capability"),
    ).toEqual({ status: 403, json: { error: "OPERATOR_REQUIRED" } });
  });

  it("fails an unknown endpoint or any unmocked write by name", () => {
    expect(() => unmockedResponse("GET", "/api/made-up")).toThrow(
      UnmockedApiRequestError,
    );
    expect(() => unmockedResponse("GET", "/api/made-up")).toThrow(
      /GET \/api\/made-up/,
    );
    expect(() => unmockedResponse("POST", "/api/stickers")).toThrow(
      /POST \/api\/stickers/,
    );
  });

  it("keeps the blanket GET catch-all out of e2e specs", () => {
    const e2eDir = new URL("./e2e/", import.meta.url);
    const offenders = readdirSync(e2eDir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) =>
        /method\(\) === "GET"\)\s*return route\.fulfill\(\{ json: \[\] \}\)/.test(
          readFileSync(new URL(name, e2eDir), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
