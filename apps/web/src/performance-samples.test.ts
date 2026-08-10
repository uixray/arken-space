import { describe, expect, it } from "vitest";
import {
  createPerformanceAggregator,
  LONG_TASK_THRESHOLD_MS,
  REPORTABLE_BLOCKING_MS,
  SLOW_INTERACTION_MS,
} from "./performance-samples";

describe("performance aggregator", () => {
  it("stays silent through a window with nothing wrong", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addInteraction("pointerdown", 40);
    aggregator.addLongTask(60);
    expect(aggregator.take(60_000)).toBeNull();
  });

  it("reports once the main thread has blocked enough to notice", () => {
    const aggregator = createPerformanceAggregator(0);
    // Four tasks of 110ms: 60ms of blocking each, 240ms in total.
    for (let index = 0; index < 4; index++) aggregator.addLongTask(110);

    const summary = aggregator.take(60_000);
    expect(summary).not.toBeNull();
    expect(summary?.longTasks).toBe(4);
    expect(summary?.blockingMs).toBe(240);
    expect(summary?.longestTaskMs).toBe(110);
    expect(summary?.windowMs).toBe(60_000);
  });

  it("reports a single slow interaction even when total blocking is small", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addInteraction("pointerdown", 3_000);

    // Well under the blocking threshold, so only the interaction clause can
    // carry this window — which is the case the complaint was about.
    const summary = aggregator.take(60_000);
    expect(summary?.blockingMs).toBeLessThan(REPORTABLE_BLOCKING_MS);
    expect(summary?.slowInteractions).toBe(1);
    expect(summary?.slowestInteractionMs).toBe(3_000);
    expect(summary?.slowestInteraction).toBe("pointerdown");
  });

  it("names the slowest interaction, not the most recent one", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addInteraction("keydown", 900);
    aggregator.addInteraction("pointerdown", 250);

    expect(aggregator.take(60_000)?.slowestInteraction).toBe("keydown");
  });

  it("counts every interaction but only the slow ones as slow", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addInteraction("pointerdown", 10);
    aggregator.addInteraction("pointerdown", SLOW_INTERACTION_MS);
    aggregator.addInteraction("keydown", 20);

    const summary = aggregator.take(60_000);
    expect(summary?.interactions).toBe(3);
    expect(summary?.slowInteractions).toBe(1);
  });

  it("ignores tasks at or under the long-task threshold", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addLongTask(LONG_TASK_THRESHOLD_MS);
    aggregator.addInteraction("pointerdown", SLOW_INTERACTION_MS);

    // The interaction is what makes this window reportable; the task must not
    // have contributed anything.
    expect(aggregator.take(60_000)?.longTasks).toBe(0);
  });

  it("starts a fresh window after taking, including after a silent one", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addLongTask(500);
    expect(aggregator.take(60_000)?.longTasks).toBe(1);

    // Nothing was added since, so the next window must be empty rather than
    // repeating the previous one's numbers.
    expect(aggregator.take(120_000)).toBeNull();

    aggregator.addInteraction("pointerdown", 400);
    const third = aggregator.take(180_000);
    expect(third?.longTasks).toBe(0);
    expect(third?.slowInteractions).toBe(1);
    expect(third?.windowMs).toBe(60_000);
  });

  it("discards non-finite durations instead of poisoning the totals", () => {
    const aggregator = createPerformanceAggregator(0);
    aggregator.addLongTask(Number.NaN);
    aggregator.addLongTask(Number.POSITIVE_INFINITY);
    aggregator.addInteraction("pointerdown", Number.NaN);
    aggregator.addInteraction("pointerdown", -5);
    aggregator.addLongTask(300);

    const summary = aggregator.take(60_000);
    expect(summary?.longTasks).toBe(1);
    expect(summary?.blockingMs).toBe(250);
    expect(summary?.interactions).toBe(0);
  });
});
