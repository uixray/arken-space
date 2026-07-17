import { beforeEach, describe, expect, it } from "vitest";
import {
  clearApiFailuresForTest,
  createFeedbackDiagnostics,
  recentApiFailures,
  rememberApiFailure,
} from "./feedback-diagnostics";

beforeEach(clearApiFailuresForTest);

describe("feedback diagnostics", () => {
  it("keeps only bounded, explicitly safe API failure fields", () => {
    for (let index = 0; index < 12; index += 1)
      rememberApiFailure({
        at: `2026-07-17T00:00:${index}Z`,
        status: 409,
        code: `CONFLICT_${index}`,
        requestId: `request-${index}`,
      });

    const diagnostics = createFeedbackDiagnostics({
      buildVersion: "1",
      connection: "ONLINE",
    });
    expect(recentApiFailures()).toHaveLength(10);
    expect(recentApiFailures()[0]?.code).toBe("CONFLICT_2");
    expect(diagnostics.lastErrorCode).toBe("CONFLICT_11");
    expect(diagnostics.requestId).toBe("request-11");
    expect(diagnostics.recentFailures).toHaveLength(10);
    expect(diagnostics.recentFailures[0]?.code).toBe("CONFLICT_2");
    expect(JSON.stringify(diagnostics)).not.toContain("cookie");
    expect(JSON.stringify(diagnostics)).not.toContain("localStorage");
  });

  it("returns copies instead of exposing the internal ring buffer", () => {
    rememberApiFailure({ at: "now", status: 500, code: "FAILED" });
    recentApiFailures()[0]!.code = "MUTATED";
    expect(recentApiFailures()[0]!.code).toBe("FAILED");
  });
});
