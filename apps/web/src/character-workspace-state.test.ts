import { describe, expect, it } from "vitest";
import {
  characterWorkspaceReducer,
  createCharacterWorkspaceState,
  MAX_OPEN_CHARACTER_SHEETS,
  uniqueCharacterIds,
} from "./character-workspace-state";

describe("character workspace state", () => {
  it("opens, focuses and restores a collapsed sheet", () => {
    let state = createCharacterWorkspaceState(["one", "two"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, { type: "COLLAPSE", id: "two" });
    expect(state).toMatchObject({ activeId: "one", collapsedIds: ["two"] });

    state = characterWorkspaceReducer(state, { type: "RESTORE", id: "two" });
    expect(state).toMatchObject({ activeId: "two", collapsedIds: [] });
  });

  it("opens a token-linked character exclusively without changing deliberate multi-card behavior", () => {
    let state = createCharacterWorkspaceState(["one", "two", "three"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, {
      type: "OPEN_EXCLUSIVE",
      id: "three",
    });
    expect(state).toEqual({
      openIds: ["three"],
      activeId: "three",
      collapsedIds: [],
    });
  });

  it("keeps the deck bounded and does not silently replace an open sheet", () => {
    let state = createCharacterWorkspaceState(["one"]);
    for (const id of ["two", "three", "four"]) {
      state = characterWorkspaceReducer(state, { type: "OPEN", id });
    }

    expect(state.openIds).toEqual(["one", "two", "three"]);
    expect(state.openIds).toHaveLength(MAX_OPEN_CHARACTER_SHEETS);
  });

  it("moves focus when the active sheet is collapsed or closed", () => {
    let state = createCharacterWorkspaceState(["one", "two"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, { type: "COLLAPSE", id: "two" });
    expect(state.activeId).toBe("one");

    state = characterWorkspaceReducer(state, { type: "CLOSE", id: "one" });
    expect(state).toEqual({
      openIds: ["two"],
      activeId: "two",
      collapsedIds: ["two"],
    });
  });

  it("removes sheets that are no longer supplied by the server", () => {
    let state = createCharacterWorkspaceState(["one", "two"]);
    state = characterWorkspaceReducer(state, { type: "OPEN", id: "two" });
    state = characterWorkspaceReducer(state, { type: "SYNC", ids: ["one"] });
    expect(state).toEqual({
      openIds: ["one"],
      activeId: "one",
      collapsedIds: [],
    });
  });
});

describe("character rail identity", () => {
  it("deduplicates the same character delivered by HTTP and realtime", () => {
    expect(uniqueCharacterIds(["one", "two", "one"])).toEqual(["one", "two"]);
  });
});
