// @vitest-environment jsdom
import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { useCatalogActions } from "./use-catalog-actions";

vi.mock("./api", () => ({
  api: vi.fn(),
  formatApiError: (reason: Error) => reason.message,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const input = {
  kind: "ABILITY" as const,
  name: "Искра",
  description: "Без броска",
  data: {},
};
const entry = { id: "entry", ...input, revision: 0 };
it("creates a personal entry directly on the character without a shared catalog write", async () => {
  vi.mocked(api).mockResolvedValue({ ...entry, sourceCatalogEntryId: null });
  const f = fixture();
  await f.result.current.onCreateCatalogEntry(input, "my-character");
  expect(api).toHaveBeenCalledExactlyOnceWith(
    "/api/characters/my-character/catalog",
    expect.objectContaining({ method: "POST" }),
  );
  expect(f.load).toHaveBeenCalledOnce();
});
function fixture(load = vi.fn().mockResolvedValue(undefined)) {
  const setError = vi.fn();
  const run = vi.fn();
  const { result } = renderHook(() =>
    useCatalogActions({ run, load, setError }),
  );
  return { result, load, setError };
}
it("returns the committed catalog entry when only snapshot refresh fails", async () => {
  vi.mocked(api).mockResolvedValue(entry);
  const f = fixture(
    vi.fn().mockRejectedValue(new Error("refresh unavailable")),
  );
  await expect(f.result.current.onCreateCatalogEntry(input)).resolves.toEqual(
    entry,
  );
  expect(api).toHaveBeenCalledTimes(1);
  expect(f.setError).toHaveBeenLastCalledWith(
    expect.stringContaining("Запись сохранена"),
  );
  expect(f.setError).toHaveBeenLastCalledWith(
    expect.stringContaining("повторно создавать запись не нужно"),
  );
});
it("rejects a create failure without pretending it was committed or loading a snapshot", async () => {
  const failure = new Error("create rejected");
  vi.mocked(api).mockRejectedValue(failure);
  const f = fixture();
  await expect(f.result.current.onCreateCatalogEntry(input)).rejects.toBe(
    failure,
  );
  expect(f.load).not.toHaveBeenCalled();
  expect(f.setError).toHaveBeenLastCalledWith("create rejected");
});
it("refreshes normally after a successful create", async () => {
  vi.mocked(api).mockResolvedValue(entry);
  const f = fixture();
  await expect(f.result.current.onCreateCatalogEntry(input)).resolves.toEqual(
    entry,
  );
  expect(f.load).toHaveBeenCalledOnce();
  expect(f.setError).toHaveBeenCalledExactlyOnceWith("");
});
