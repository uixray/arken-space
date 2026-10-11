import { describe, expect, it } from "vitest";
import { canvasSections, chatSection } from "./landing-guide-content";
import { guideAnchor } from "./landing-guide-search";
import { guideFaq, guideWorkflows } from "./landing-guide-workflows";

describe("procedural landing guide", () => {
  const anchors = new Set(
    [...canvasSections, chatSection].map(
      (section) => `#${guideAnchor(section.title)}`,
    ),
  );

  it("keeps a small set of actionable role-aware procedures with valid help anchors", () => {
    expect(guideWorkflows.length).toBeGreaterThanOrEqual(3);
    expect(guideWorkflows.length).toBeLessThanOrEqual(4);
    expect(new Set(guideWorkflows.map(({ id }) => id)).size).toBe(
      guideWorkflows.length,
    );
    for (const workflow of guideWorkflows) {
      expect(workflow.title.trim()).not.toBe("");
      expect(workflow.roles.length).toBeGreaterThan(0);
      expect(workflow.prerequisite.trim()).not.toBe("");
      expect(workflow.steps.length).toBeGreaterThanOrEqual(2);
      expect(workflow.steps.every((step) => step.trim())).toBe(true);
      expect(workflow.outcome.trim()).not.toBe("");
      expect(workflow.sources.length).toBeGreaterThan(0);
      expect(anchors.has(workflow.helpHref)).toBe(true);
    }
    expect(
      guideWorkflows.find(({ id }) => id === "make-player-request")?.roles,
    ).toEqual(["Игрок"]);
    expect(
      guideWorkflows.find(({ id }) => id === "review-player-requests")?.roles,
    ).toEqual(["Мастер"]);
  });

  it("keeps a concise FAQ tied to implemented surfaces and valid anchors", () => {
    expect(guideFaq.length).toBeGreaterThanOrEqual(3);
    expect(guideFaq.length).toBeLessThanOrEqual(4);
    expect(new Set(guideFaq.map(({ id }) => id)).size).toBe(guideFaq.length);
    for (const item of guideFaq) {
      expect(item.question.trim()).not.toBe("");
      expect(item.answer.trim()).not.toBe("");
      expect(item.sources.length).toBeGreaterThan(0);
      expect(anchors.has(item.helpHref)).toBe(true);
    }
  });

  it("does not market unfinished onboarding, spell editing, or provider mail", () => {
    const copy = JSON.stringify([
      ...guideWorkflows,
      ...guideFaq,
    ]).toLocaleLowerCase("ru");
    expect(copy).not.toMatch(
      /создать кампани|регистрац|школ заклин|редактор заклин|почт(а|у|ы)|обрезк(а|и) аудио/,
    );
  });
});
