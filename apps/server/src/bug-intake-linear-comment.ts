import { z } from "zod";
import type { createBugLinearHttp } from "./bug-intake-linear-http.js";

/** Owner decision: edits go into a new comment on the mapped issue, never
 * overwrite its description/title. Caller supplies reviewed text + approved
 * uploaded asset links only. Dormant until the sender adapter is wired.
 */
export async function appendBugRevisionComment(
  request: ReturnType<typeof createBugLinearHttp>,
  input: { deliveryId: string; linearIssueId: string; body: string },
) {
  const parsed = z
    .object({
      deliveryId: z.string().uuid(),
      linearIssueId: z.string().uuid(),
      body: z.string().min(1).max(100000),
    })
    .strict()
    .parse(input);
  const unknown = {
    state: "UNKNOWN" as const,
    linearIssueId: parsed.linearIssueId,
    failureCode: "EXTERNAL_RESULT_UNKNOWN" as const,
  };
  try {
    const response = await request(
      `mutation BugRevisionComment($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id } }
    }`,
      {
        input: {
          // Stable external identity aids explicit recovery; this is NOT permission
          // to retry ambiguous creation automatically or assume an upsert contract.
          id: parsed.deliveryId,
          issueId: parsed.linearIssueId,
          body: parsed.body,
        },
      },
    );
    if (!response.ok || !("data" in response)) return unknown;
    const result = z
      .object({
        commentCreate: z.object({
          success: z.literal(true),
          comment: z.object({ id: z.literal(parsed.deliveryId) }),
        }),
      })
      .safeParse(response.data);
    if (!result.success) return unknown;
    return { state: "SENT" as const, linearIssueId: parsed.linearIssueId };
  } catch {
    return unknown;
  }
}
