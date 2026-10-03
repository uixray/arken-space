// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { GameSnapshot } from "@arken/contracts";
import {
  emitSceneViewIfNeeded,
  useGameSocketSubscriptions,
  type SceneViewEmission,
  type UseGameSocketSubscriptionsOptions,
} from "./use-game-socket-subscriptions";
import type { GameSocket } from "./realtime";

describe("emitSceneViewIfNeeded", () => {
  it("emits scene:view on first call", () => {
    const mockSocket = {
      id: "sock-1",
      emit: vi.fn(),
    } as unknown as GameSocket;
    const emissionRef = { current: null as SceneViewEmission | null };

    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-123");

    expect(mockSocket.emit).toHaveBeenCalledWith("scene:view", {
      sceneId: "scene-123",
    });
    expect(emissionRef.current).toEqual({
      socket: mockSocket,
      connectionId: "sock-1",
      sceneId: "scene-123",
    });
  });

  it("suppresses duplicate emissions for same socket and sceneId", () => {
    const mockSocket = {
      id: "sock-1",
      emit: vi.fn(),
    } as unknown as GameSocket;
    const emissionRef = { current: null as SceneViewEmission | null };

    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-123");
    expect(mockSocket.emit).toHaveBeenCalledTimes(1);

    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-123");
    expect(mockSocket.emit).toHaveBeenCalledTimes(1);
  });

  it("emits again if sceneId changes", () => {
    const mockSocket = {
      id: "sock-1",
      emit: vi.fn(),
    } as unknown as GameSocket;
    const emissionRef = { current: null as SceneViewEmission | null };

    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-1");
    expect(mockSocket.emit).toHaveBeenCalledWith("scene:view", {
      sceneId: "scene-1",
    });

    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-2");
    expect(mockSocket.emit).toHaveBeenCalledWith("scene:view", {
      sceneId: "scene-2",
    });
    expect(mockSocket.emit).toHaveBeenCalledTimes(2);
  });

  it("emits again if connectionId changes after reconnect", () => {
    const mockSocket = {
      id: "sock-1",
      emit: vi.fn(),
    } as unknown as GameSocket;
    const emissionRef = { current: null as SceneViewEmission | null };

    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-1");
    expect(mockSocket.emit).toHaveBeenCalledTimes(1);

    (mockSocket as { id: string }).id = "sock-2";
    emitSceneViewIfNeeded(mockSocket, emissionRef, "scene-1");
    expect(mockSocket.emit).toHaveBeenCalledTimes(2);
  });
});
