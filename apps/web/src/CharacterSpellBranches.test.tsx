// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterDto } from "@arken/contracts";
import { CharacterSpellBranches } from "./CharacterSpellBranches";

const mocks = vi.hoisted(() => ({
  createSchoolAssignmentEnvelope: vi.fn(),
  loadAssignableSchools: vi.fn(),
  loadCharacterSchoolBranches: vi.fn(),
  reconcileSchoolAssignment: vi.fn(),
  submitSchoolAssignment: vi.fn(),
}));

vi.mock("./character-spell-branches-client", () => mocks);

const school = {
  packId: "10000000-0000-4000-8000-000000000001",
  packVersionId: "20000000-0000-4000-8000-000000000001",
  packVersion: 4,
  packTitle: "Custom ruleset",
  schoolId: "30000000-0000-4000-8000-000000000001",
  schoolName: "Uncatalogued school",
  visibilityPolicy: "PUBLIC" as const,
};
const command = {
  actionId: "40000000-0000-4000-8000-000000000001",
  assignmentId: "50000000-0000-4000-8000-000000000001",
  assignmentVersionId: "60000000-0000-4000-8000-000000000001",
  expectedVersion: 0 as const,
  packId: school.packId,
  packVersionId: school.packVersionId,
  target: { kind: "SCHOOL" as const, schoolId: school.schoolId },
};
const character = (id: string, lifecycle: "ACTIVE" | "ARCHIVED" = "ACTIVE") =>
  ({ id, name: `Character ${id.slice(-1)}`, lifecycle }) as CharacterDto;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSchoolAssignmentEnvelope.mockReturnValue(command);
  mocks.loadAssignableSchools.mockResolvedValue([school]);
  mocks.loadCharacterSchoolBranches.mockResolvedValue([]);
  mocks.reconcileSchoolAssignment.mockResolvedValue(false);
  mocks.submitSchoolAssignment.mockResolvedValue({});
});

afterEach(() => cleanup());

describe("CharacterSpellBranches", () => {
  it("shows an explicit empty state and allows only GM to select an active custom school", async () => {
    render(<CharacterSpellBranches character={character("1")} isGm />);

    expect(await screen.findByText(/пока не выданы школы/)).toBeTruthy();
    const selector = screen.getByRole("combobox", {
      name: "Активная школа для выдачи",
    });
    fireEvent.change(selector, { target: { value: `${school.packId}:${school.packVersionId}:${school.schoolId}` } });
    fireEvent.click(screen.getByRole("button", { name: "Выдать школу" }));
    await waitFor(() => expect(mocks.submitSchoolAssignment).toHaveBeenCalledWith("1", command));
    expect(mocks.createSchoolAssignmentEnvelope).toHaveBeenCalledWith(school);
  });

  it("retries an uncertain assignment with the exact command envelope", async () => {
    mocks.submitSchoolAssignment
      .mockRejectedValueOnce(new Error("temporary transport failure"))
      .mockResolvedValueOnce({});
    mocks.loadCharacterSchoolBranches
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          packId: school.packId,
          packVersionId: school.packVersionId,
          packVersion: school.packVersion,
          schoolId: school.schoolId,
          schoolName: school.schoolName,
        },
      ]);
    render(<CharacterSpellBranches character={character("2")} isGm />);
    await screen.findByText(/пока не выданы школы/);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: `${school.packId}:${school.packVersionId}:${school.schoolId}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Выдать школу" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Повторить ту же выдачу" }));
    await screen.findByText("Uncatalogued school");
    expect(mocks.submitSchoolAssignment.mock.calls).toEqual([
      ["2", command],
      ["2", command],
    ]);
  });

  it("shows assigned schools to a player without loading the GM assignment picker", async () => {
    mocks.loadCharacterSchoolBranches.mockResolvedValue([
      {
        packId: school.packId,
        packVersionId: school.packVersionId,
        packVersion: school.packVersion,
        schoolId: school.schoolId,
        schoolName: school.schoolName,
      },
    ]);
    render(<CharacterSpellBranches character={character("3")} isGm={false} />);
    expect(await screen.findByText("Uncatalogued school")).toBeTruthy();
    expect(mocks.loadAssignableSchools).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("does not show the previous character's branches after a sheet changes", async () => {
    mocks.loadCharacterSchoolBranches.mockImplementation(async (id: string) =>
      id === "4"
        ? [
            {
              packId: school.packId,
              packVersionId: school.packVersionId,
              packVersion: school.packVersion,
              schoolId: school.schoolId,
              schoolName: "Previous character branch",
            },
          ]
        : [],
    );
    const view = render(
      <CharacterSpellBranches character={character("4")} isGm={false} />,
    );
    expect(await screen.findByText("Previous character branch")).toBeTruthy();
    view.rerender(
      <CharacterSpellBranches character={character("5")} isGm={false} />,
    );
    await screen.findByText(/пока не выданы школы/);
    expect(screen.queryByText("Previous character branch")).toBeNull();
  });

  it("does not load spell assignment data for archived sheets", () => {
    render(
      <CharacterSpellBranches
        character={character("6", "ARCHIVED")}
        isGm
      />,
    );
    expect(screen.getByText(/Архивный лист/)).toBeTruthy();
    expect(mocks.loadCharacterSchoolBranches).not.toHaveBeenCalled();
  });

  it("renders initial load errors instead of remaining in loading state", async () => {
    mocks.loadCharacterSchoolBranches.mockRejectedValueOnce(new Error("offline"));
    render(<CharacterSpellBranches character={character("7")} isGm={false} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Загрузка веток…")).toBeNull();
  });

  it("retries an initial branch-load failure and clears the error after success", async () => {
    mocks.loadCharacterSchoolBranches
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    render(<CharacterSpellBranches character={character("10")} isGm={false} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку веток" }));
    expect(await screen.findByText(/пока не выданы школы/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.loadCharacterSchoolBranches).toHaveBeenCalledTimes(2);
  });

  it("keeps retry errors visible and does not leak a rejected retry promise", async () => {
    mocks.loadCharacterSchoolBranches
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"));
    render(<CharacterSpellBranches character={character("11")} isGm={false} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку веток" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.loadCharacterSchoolBranches).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Повторить загрузку веток" })).toBeTruthy();
  });

  it("does not apply a completed assignment refresh notice after switching characters", async () => {
    let finishRefresh!: (value: never[]) => void;
    mocks.loadCharacterSchoolBranches
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }))
      .mockResolvedValueOnce([]);
    const view = render(<CharacterSpellBranches character={character("8")} isGm />);
    await screen.findByText(/пока не выданы школы/);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: `${school.packId}:${school.packVersionId}:${school.schoolId}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Выдать школу" }));
    await waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    view.rerender(<CharacterSpellBranches character={character("9")} isGm />);
    await screen.findByText(/пока не выданы школы/);
    finishRefresh([]);
    await waitFor(() => expect(screen.queryByText("Школа выдана персонажу.")).toBeNull());
  });
});
// @vitest-environment jsdom

