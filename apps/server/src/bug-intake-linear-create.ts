import { z } from "zod";
import type { createBugLinearHttp } from "./bug-intake-linear-http.js";

/** Internal one-shot creation after all approved uploads have durable receipts.
 * Team/project come from trusted integration configuration, not source messages.
 * No retries, scheduling, environment reads, or network calls at import time.
 */
export async function createReviewedBugIssue(
  request: ReturnType<typeof createBugLinearHttp>,
  input: {
    teamId: string;
    projectId: string;
    title: string;
    description: string;
  },
) {
  const parsed = z
    .object({
      teamId: z.string().uuid(),
      projectId: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(100000),
    })
    .strict()
    .parse(input);
  let knownIssueId: string | undefined;
  try {
    const response = await request(
      `mutation ReviewedBugCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id } }
    }`,
      { input: parsed },
    );
    if ("data" in response) {
      // HTTP/GraphQL errors can coexist with a created issue. Salvage its ID
      // independently from the success envelope; do not discard partial evidence.
      const identity = z
        .object({
          issueCreate: z.object({
            issue: z.object({ id: z.string().uuid() }),
          }),
        })
        .safeParse(response.data);
      if (identity.success) knownIssueId = identity.data.issueCreate.issue.id;
      const complete = z
        .object({
          issueCreate: z.object({
            success: z.literal(true),
            issue: z.object({ id: z.string().uuid() }),
          }),
        })
        .safeParse(response.data);
      if (response.ok && complete.success)
        return {
          state: "SENT" as const,
          linearIssueId: complete.data.issueCreate.issue.id,
        };
    }
  } catch {
    // Credential-bearing request details and raw response errors stay private.
  }
  return {
    state: "UNKNOWN" as const,
    failureCode: "EXTERNAL_RESULT_UNKNOWN" as const,
    ...(knownIssueId ? { linearIssueId: knownIssueId } : {}),
  };
}
