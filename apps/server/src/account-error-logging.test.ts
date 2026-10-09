import { describe, expect, it } from "vitest";
import { accountErrorLogDetails } from "./account-error-logging.js";

describe("account error log redaction", () => {
  it("emits only stable request metadata, never the supplied raw error", () => {
    const rawError = new Error("recipient@example.invalid bearer-secret provider-secret");
    const safe = accountErrorLogDetails({ requestId: "req-1", actionId: undefined, statusCode: 503, validation: false });
    expect(JSON.stringify({ safe, rawError: undefined })).not.toContain("recipient@example.invalid");
    expect(JSON.stringify(safe)).toEqual(JSON.stringify({ requestId: "req-1", actionId: undefined, statusCode: 503, category: "ACCOUNT_REQUEST_FAILURE" }));
  });
});
