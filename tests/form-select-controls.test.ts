import { describe, expect, it } from "vitest";
import {
  buildFormSelectUtilityOptions,
  FORM_SELECT_CREATE_VALUE,
} from "../apps/web/src/ui/formSelectOptions";

describe("FormSelect utility options", () => {
  it("adds a disabled empty state and an actionable create entry", () => {
    expect(
      buildFormSelectUtilityOptions("Персонажей пока нет", "Создать персонажа"),
    ).toEqual([
      {
        value: "__arken_empty__",
        content: "Персонажей пока нет",
        disabled: true,
      },
      {
        value: FORM_SELECT_CREATE_VALUE,
        content: "Создать персонажа",
        disabled: false,
      },
    ]);
  });
  it("does not add utility entries for populated selectors", () => {
    expect(buildFormSelectUtilityOptions()).toEqual([]);
  });
});
