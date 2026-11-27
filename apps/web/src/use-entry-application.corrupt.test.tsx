// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderComponent, screen, waitFor } from "./test-support/render";
import { gmSnapshot } from "./test-support/game-snapshot-fixtures";
import { useEntryApplication } from "./use-entry-application";
const snapshot = gmSnapshot();
const key = `arken.entry.pending.v1.${snapshot.campaign.id}.${snapshot.me.id}`;
function Harness() {
  const result = useEntryApplication(snapshot, async () => {});
  return <p role="alert">{result.error}</p>;
}
afterEach(() => {
  localStorage.removeItem(key);
  vi.restoreAllMocks();
});
it.each(["", "{", "null"])(
  "retains corrupt pending entry and shows safe recovery guidance: %s",
  async (raw) => {
    localStorage.setItem(key, raw);
    const fetch = vi.spyOn(window, "fetch");
    renderComponent(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Сохранённое применение повреждено. Не создавайте замену до сверки с мастером.",
      ),
    );
    expect(localStorage.getItem(key)).toBe(raw);
    expect(fetch).not.toHaveBeenCalled();
  },
);
