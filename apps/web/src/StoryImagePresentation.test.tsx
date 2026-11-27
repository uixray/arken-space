// @vitest-environment jsdom
import React from "react";
import type { StoryChangedEvent } from "@arken/contracts";
import type { GameSocket } from "./realtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  StoryImagePresentation,
  openStoryImage,
} from "./StoryImagePresentation";
const campaignId = "eb6a55c4-a821-4739-8d4a-a1028e9d9092";
const presentation = {
  key: "post:1",
  title: "Зал",
  media: [{ contentId: "art", altText: "Зал", caption: "Настоящий бал" }],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
it("opens only publication payload, closes and reopens from the feed", () => {
  let receive: (event: StoryChangedEvent) => void;
  const socket = {
    on: vi.fn(
      (_: string, cb: (event: StoryChangedEvent) => void) => (receive = cb),
    ),
    off: vi.fn(),
  };
  render(
    <StoryImagePresentation
      socket={socket as unknown as GameSocket}
      campaignId={campaignId}
      enabled
    />,
  );
  act(() => receive({ campaignId, postId: "draft" }));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  act(() => receive({ campaignId, postId: "post", presentation }));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Закрыть изображение" }));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  act(() => receive({ campaignId, postId: "post", presentation }));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  act(() => openStoryImage(presentation));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
});
it("subscribes in ordinary campaigns, ignores foreign events and disables preview", () => {
  let receive!: (event: StoryChangedEvent) => void;
  const socket = { on: vi.fn((_:string, cb:(event:StoryChangedEvent)=>void)=>{receive=cb;}), off: vi.fn() };
  const v = render(<StoryImagePresentation socket={socket as unknown as GameSocket} campaignId="ordinary" enabled />);
  expect(socket.on).toHaveBeenCalledOnce();
  act(()=>receive({campaignId,postId:"foreign",presentation}));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  act(()=>receive({campaignId:"ordinary",postId:"post",presentation}));
  expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  v.rerender(<StoryImagePresentation socket={socket as unknown as GameSocket} campaignId="ordinary" enabled={false}/>);
  expect(socket.off).toHaveBeenCalledOnce();
  expect(document.querySelector("dialog")).toBeNull();
});
