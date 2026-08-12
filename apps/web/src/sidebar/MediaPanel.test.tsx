// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderComponent, screen } from "../test-support/render";
import {
  gmSnapshot,
  playerSnapshot,
} from "../test-support/game-snapshot-fixtures";
import type { ImageUploadFieldProps } from "../ui/ImageUploadField";

// UIX-383: MediaPanel had no component test at all before this file --
// `allowed` (which asset kinds a member may upload) is exactly the kind of
// role-gated UI the AC asks component tests to cover honestly: GM sees five
// upload sections (including GM-only MAP and AUDIO), a PLAYER sees only two
// (TOKEN, PORTRAIT). Both renders below go through the *same* MediaPanel
// component with a real `GameSnapshot` built by `gmSnapshot()`/
// `playerSnapshot()` -- role flows through `snapshot.me.role` exactly like
// production, not a test-only shortcut. See game-snapshot-fixtures.ts.
//
// Mocking notes (typed against the real prop contracts, per the AC's
// concern about mocks that don't typecheck):
// - `@gravity-ui/uikit`'s `Button` ships CSS this repo's Vitest transform
//   can't handle (same constraint as the existing `renderToStaticMarkup`
//   tests, e.g. RollButton.test.tsx) -- swapped for a plain <button>
//   restricted to the props MediaPanel/ImageUploadField actually pass.
// - `ImageUploadField` is swapped for a minimal stub typed against its own
//   exported `ImageUploadFieldProps`, so this file stays focused on
//   MediaPanel's role gating rather than file-input/object-URL plumbing
//   (which is that component's own concern, untouched here).
vi.mock("@gravity-ui/uikit", () => ({
  Button: ({
    disabled,
    loading,
    onClick,
    children,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }) => (
    <button disabled={disabled} aria-busy={loading} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("../ui/ImageUploadField", () => ({
  ImageUploadField: ({ label, disabled }: ImageUploadFieldProps) => (
    <div>
      <span>{label}</span>
      <input type="file" aria-label={label} disabled={disabled} readOnly />
    </div>
  ),
}));

const { MediaPanel } = await import("./MediaPanel");

describe("MediaPanel upload sections by role", () => {
  it("offers all five asset kinds -- including GM-only MAP and AUDIO -- to a GM", () => {
    renderComponent(<MediaPanel snapshot={gmSnapshot()} onUpload={vi.fn()} />);

    expect(screen.getByText("Карты")).toBeInTheDocument();
    expect(screen.getByText("Изображения токенов")).toBeInTheDocument();
    expect(screen.getByText("Портреты персонажей")).toBeInTheDocument();
    expect(screen.getByText("Другие изображения")).toBeInTheDocument();
    expect(screen.getByText("Музыка и звуки")).toBeInTheDocument();
  });

  it("hides GM-only asset kinds (maps, other images, audio) from a PLAYER", () => {
    renderComponent(
      <MediaPanel snapshot={playerSnapshot()} onUpload={vi.fn()} />,
    );

    expect(screen.getByText("Изображения токенов")).toBeInTheDocument();
    expect(screen.getByText("Портреты персонажей")).toBeInTheDocument();
    expect(screen.queryByText("Карты")).not.toBeInTheDocument();
    expect(screen.queryByText("Другие изображения")).not.toBeInTheDocument();
    expect(screen.queryByText("Музыка и звуки")).not.toBeInTheDocument();
  });
});
