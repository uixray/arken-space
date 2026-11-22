import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export type EditorTarget = {
  campaignId: string;
  kind: "character-stat" | "skill" | "material" | "bug-report";
  id: string;
};

type Values = Record<string, string | number | boolean | null>;
type Revision = { revision: number; values: Values; name?: string };

export type EditorDraft = {
  id: string;
  target: EditorTarget;
  authorId: string;
  expectedRevision: number;
  before: Values;
  after: Values;
  restores?: string;
  creates?: true;
  targetName?: string;
};

export type EditorChange = EditorDraft & {
  confirmedBy: string;
  committedRevision: number;
};

/**
 * All operations must use the same database transaction. The adapter must
 * scope reads by campaign and implement write as a revision compare-and-swap.
 * The draft ID must be unique in history.
 */
export interface EditorTransaction {
  read(target: EditorTarget): Promise<Revision | null>;
  lockDraft(campaignId: string, draftId: string): Promise<EditorDraft | null>;
  saveDraft(draft: EditorDraft): Promise<void>;
  create(draft: EditorDraft): Promise<number>;
  readChange(
    campaignId: string,
    changeId: string,
  ): Promise<EditorChange | null>;
  write(
    target: EditorTarget,
    revision: number,
    values: Values,
    draft: EditorDraft,
  ): Promise<number | null>;
  append(change: EditorChange): Promise<void>;
}

export class EditorConflict extends Error {}

export async function previewEditorCreation(
  tx: EditorTransaction,
  target: Omit<EditorTarget, "id">,
  authorId: string,
  after: Values,
): Promise<EditorDraft> {
  const draft: EditorDraft = {
    id: randomUUID(),
    target: { ...target, id: randomUUID() },
    authorId,
    expectedRevision: 0,
    before: {},
    after,
    creates: true,
  };
  await tx.saveDraft(draft);
  return draft;
}

function selectFields(values: Values, keys: string[]): Values {
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(values, key))
      .map((key) => [key, values[key]!]),
  );
}

/** Call with fields already validated against the target's editable schema. */
export async function previewEditorChange(
  tx: EditorTransaction,
  target: EditorTarget,
  authorId: string,
  expectedRevision: number,
  after: Values,
): Promise<EditorDraft> {
  const current = await tx.read(target);
  if (!current || current.revision !== expectedRevision) {
    throw new EditorConflict("EDITOR_REVISION_CONFLICT");
  }
  const keys = Object.keys(after);
  const before = selectFields(current.values, keys);
  if (
    Object.keys(before).length !== keys.length ||
    isDeepStrictEqual(before, after)
  ) {
    throw new EditorConflict("EDITOR_INVALID_PATCH");
  }
  const draft = {
    id: randomUUID(),
    target,
    authorId,
    expectedRevision,
    before,
    after,
    ...(current.name && { targetName: current.name }),
  };
  await tx.saveDraft(draft);
  return draft;
}

/** Actor must come from the human session after campaign and CSRF checks. */
export async function confirmEditorChange(
  tx: EditorTransaction,
  campaignId: string,
  draftId: string,
  confirmingActorId: string,
): Promise<EditorChange> {
  const draft = await tx.lockDraft(campaignId, draftId);
  if (
    !draft ||
    draft.target.campaignId !== campaignId ||
    draft.authorId !== confirmingActorId
  ) {
    throw new EditorConflict("EDITOR_DRAFT_NOT_FOUND");
  }
  const existing = await tx.readChange(campaignId, draftId);
  if (existing) return existing;

  if (
    !draft.creates &&
    (await tx.read(draft.target))?.revision !== draft.expectedRevision
  ) {
    throw new EditorConflict("EDITOR_REVISION_CONFLICT");
  }
  const revision = draft.creates
    ? await tx.create(draft)
    : await tx.write(draft.target, draft.expectedRevision, draft.after, draft);
  if (revision === null) throw new EditorConflict("EDITOR_REVISION_CONFLICT");
  const change = {
    ...draft,
    committedRevision: revision,
    confirmedBy: confirmingActorId,
  };
  await tx.append(change);
  return change;
}

export async function previewEditorRestore(
  tx: EditorTransaction,
  campaignId: string,
  changeId: string,
  authorId: string,
): Promise<EditorDraft> {
  const change = await tx.readChange(campaignId, changeId);
  if (!change || change.target.campaignId !== campaignId) {
    throw new EditorConflict("EDITOR_CHANGE_NOT_FOUND");
  }
  if (change.creates)
    throw new EditorConflict("EDITOR_CREATION_NOT_REVERSIBLE");
  const current = await tx.read(change.target);
  if (
    !current ||
    current.revision !== change.committedRevision ||
    !isDeepStrictEqual(
      selectFields(current.values, Object.keys(change.after)),
      change.after,
    )
  ) {
    throw new EditorConflict("EDITOR_RESTORE_CONFLICT");
  }
  const draft = {
    id: randomUUID(),
    target: change.target,
    authorId,
    expectedRevision: current.revision,
    before: change.after,
    after: change.before,
    restores: change.id,
    ...(current.name && { targetName: current.name }),
  };
  await tx.saveDraft(draft);
  return draft;
}
