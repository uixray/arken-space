import {
  bugCopyAttachmentError,
  reviewedBugCopySchema,
  type BugAttachmentState,
  type ReviewedBugCopy,
} from "@arken/contracts";

/** Pure transition model. Persistence must lock/CAS the row and atomically audit
 * the returned state. It does not authenticate operators or send to Linear. */
export type BugReviewRecord = {
  revision: number;
  state: "REVIEW" | "APPROVED" | "LINKED" | "DISMISSED";
  attachments: { id: string; state: BugAttachmentState }[];
  approval: {
    operatorId: string;
    at: string;
    revision: number;
    copy: ReviewedBugCopy;
  } | null;
  /** Retained across edits: a changed source updates the same issue, never duplicates it. */
  linearIssueId: string | null;
};

export type BugReviewTransition =
  | { ok: true; record: BugReviewRecord }
  | {
      ok: false;
      error:
        | "REVISION_CONFLICT"
        | "INVALID_STATE"
        | "INVALID_COPY"
        | "UNKNOWN_ATTACHMENT"
        | "ATTACHMENT_NOT_STORED"
        | "UNRESOLVED_ATTACHMENT";
    };

export function approveBugReview(
  current: BugReviewRecord,
  expectedRevision: number,
  copy: unknown,
  operatorId: string,
  at: string,
): BugReviewTransition {
  if (current.revision !== expectedRevision)
    return { ok: false, error: "REVISION_CONFLICT" };
  if (current.state !== "REVIEW") return { ok: false, error: "INVALID_STATE" };
  const parsed = reviewedBugCopySchema.safeParse(copy);
  if (!parsed.success) return { ok: false, error: "INVALID_COPY" };
  const error = bugCopyAttachmentError(parsed.data, current.attachments);
  if (error) return { ok: false, error };
  const revision = current.revision + 1;
  return {
    ok: true,
    record: {
      ...current,
      revision,
      state: "APPROVED",
      approval: { operatorId, at, revision, copy: parsed.data },
    },
  };
}

/** Source edits and attachment changes revoke approval, but preserve issue mapping.
 * Caller archives the previous source version in the SAME transaction. */
export function invalidateBugReview(
  current: BugReviewRecord,
  expectedRevision: number,
  attachments: BugReviewRecord["attachments"],
): BugReviewTransition {
  if (current.revision !== expectedRevision)
    return { ok: false, error: "REVISION_CONFLICT" };
  return {
    ok: true,
    record: {
      ...current,
      revision: current.revision + 1,
      state: "REVIEW",
      attachments: attachments.map((item) => ({ ...item })),
      approval: null,
    },
  };
}

export function dismissBugReview(
  current: BugReviewRecord,
  expectedRevision: number,
): BugReviewTransition {
  if (current.revision !== expectedRevision)
    return { ok: false, error: "REVISION_CONFLICT" };
  return {
    ok: true,
    record: {
      ...current,
      revision: current.revision + 1,
      state: "DISMISSED",
      approval: null,
    },
  };
}

/** Fail closed when reading an old/corrupt approval. Not permission to transmit.
 * Delivery later needs its own locked claim, durable receipt and retry handling. */
export function approvedBugCopy(
  current: BugReviewRecord,
): ReviewedBugCopy | null {
  if (
    current.state !== "APPROVED" ||
    !current.approval ||
    current.approval.revision !== current.revision
  )
    return null;
  const parsed = reviewedBugCopySchema.safeParse(current.approval.copy);
  if (
    !parsed.success ||
    bugCopyAttachmentError(parsed.data, current.attachments)
  )
    return null;
  return parsed.data;
}
