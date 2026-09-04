import { describe, expect, it } from "vitest";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUS_LABELS,
  OPERATOR_FEEDBACK_TITLE,
  transitions,
} from "./operator-feedback";
import { workspaceNavItems } from "./workspace-nav";

describe("UIX-617 — русское название обратной связи", () => {
  it("keeps the internal workspace id but shows a Russian label", () => {
    const item = workspaceNavItems({
      isGm: true,
      operatorFeedbackAllowed: true,
    }).find(({ id }) => id === "operator-feedback");
    expect(item).toEqual({
      id: "operator-feedback",
      label: "Обратная связь",
    });
    expect(OPERATOR_FEEDBACK_TITLE).not.toContain("Operator feedback");
  });

  it("has a Russian label for every visible kind and status", () => {
    expect(Object.keys(FEEDBACK_KIND_LABELS).sort()).toEqual(
      ["SUGGESTION", "BUG", "IDEA"].sort(),
    );
    expect(Object.keys(FEEDBACK_STATUS_LABELS).sort()).toEqual(
      Object.keys(transitions).sort(),
    );
    expect(Object.values(FEEDBACK_KIND_LABELS)).toEqual([
      "Предложение",
      "Ошибка",
      "Идея",
    ]);
  });
});
