import { expect, it, vi } from "vitest";
import type { PersonalThemeDto } from "@arken/contracts";

import { patchPersonalThemePreference } from "./personal-theme-api";

const source: PersonalThemeDto = {
  scopeKey: "campaign-a:member-a",
  selectedThemeId: null,
  defaultThemeId: "forest",
  revision: 4,
  publishedThemes: [],
};

it("sends CAS to the self route and returns the same-scope projection", async () => {
  const updated = { ...source, selectedThemeId: "light", revision: 5 };
  const request = vi.fn(async () => updated);
  const controller = new AbortController();
  await expect(
    patchPersonalThemePreference({
      source,
      selectedThemeId: "light",
      signal: controller.signal,
      request,
    }),
  ).resolves.toEqual(updated);
  expect(request).toHaveBeenCalledWith(
    "/api/me/theme",
    expect.objectContaining({
      method: "PATCH",
      signal: controller.signal,
      body: JSON.stringify({
        selectedThemeId: "light",
        expectedRevision: 4,
      }),
    }),
  );
});

it("rejects an aborted late response before the adapter can accept it", async () => {
  const controller = new AbortController();
  let resolve!: (value: PersonalThemeDto) => void;
  const request = vi.fn(
    () =>
      new Promise<PersonalThemeDto>((done) => {
        resolve = done;
      }),
  );
  const result = patchPersonalThemePreference({
    source,
    selectedThemeId: "light",
    signal: controller.signal,
    request,
  });
  controller.abort();
  resolve({ ...source, selectedThemeId: "light", revision: 5 });
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});

it("fails closed when the server returns another scope", async () => {
  const request = vi.fn(async () => ({
    ...source,
    scopeKey: "campaign-b:member-b",
    revision: 5,
  }));
  await expect(
    patchPersonalThemePreference({
      source,
      selectedThemeId: "forest",
      signal: new AbortController().signal,
      request,
    }),
  ).rejects.toThrow("другого игрока");
});
