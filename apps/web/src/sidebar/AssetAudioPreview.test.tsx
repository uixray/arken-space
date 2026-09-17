// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { fireEvent, renderComponent, screen } from "../test-support/render";
import { AssetAudioPreview } from "./AssetAudioPreview";

afterEach(() => localStorage.clear());

it.each([
  [null, 0.25],
  ["0", 0],
  ["0.2", 0.04],
  ["invalid", 0.25],
  ["2", 0.25],
])(
  "starts paused with saved gain %s without writing preferences",
  (saved, gain) => {
    if (saved !== null) localStorage.setItem("arken.audio.volume", saved);
    localStorage.setItem("arken.audio.enabled", "false");
    renderComponent(<AssetAudioPreview url="/audio?v=1" name="Зал" />);
    const audio = screen.getByLabelText(
      "Прослушивание: Зал",
    ) as HTMLAudioElement;
    expect(audio.volume).toBeCloseTo(gain);
    expect(audio.paused).toBe(true);
    expect(audio.autoplay).toBe(false);
    expect(audio.preload).toBe("none");
    expect(audio.controls).toBe(true);
    expect(localStorage.getItem("arken.audio.volume")).toBe(saved);
    expect(localStorage.getItem("arken.audio.enabled")).toBe("false");
  },
);

it("announces a failed preview", () => {
  renderComponent(<AssetAudioPreview url="/audio" name="Зал" />);
  fireEvent.error(screen.getByLabelText("Прослушивание: Зал"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Не удалось воспроизвести файл",
  );
});
