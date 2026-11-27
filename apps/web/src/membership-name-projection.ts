import type { GameSnapshot, MembershipDto } from "@arken/contracts";

/** Only describe the name and (when authorized) the roster entry's revision. */
export interface MembershipNamePatch {
  membershipId: string;
  displayName: string;
  revision?: number;
}

function mapChanged<T>(rows: T[], project: (row: T) => T): T[] {
  const next = rows.map(project);
  return next.some((row, index) => row !== rows[index]) ? next : rows;
}

/**
 * Update only already-visible projections. The event must be scoped by the
 * caller to the current campaign/session and ordered by the membership stream,
 * not by another domain's snapshotVersion.
 */
export function projectMembershipName(
  snapshot: GameSnapshot,
  patch: MembershipNamePatch,
): GameSnapshot {
  return projectName(snapshot, patch, false);
}

function projectName(
  snapshot: GameSnapshot,
  patch: MembershipNamePatch,
  nameSequenceVerified: boolean,
): GameSnapshot {
  const { membershipId, displayName, revision } = patch;
  const own = snapshot.me.id === membershipId;
  const mayReadMembership = own || snapshot.me.role === "GM";
  const rosterRevision = mayReadMembership
    ? snapshot.members.find((member) => member.id === membershipId)?.revision
    : undefined;
  const currentRevision = Math.max(
    own ? (snapshot.me.revision ?? -1) : -1,
    rosterRevision ?? -1,
  );
  // A verified name cursor orders names only. The roster revision can also
  // advance for unrelated changes and must never move backwards.
  if (
    !nameSequenceVerified &&
    mayReadMembership &&
    revision !== undefined &&
    revision < currentRevision
  )
    return snapshot;

  const nameFor = <T extends { displayName: string }>(row: T, id: string) =>
    id === membershipId && row.displayName !== displayName
      ? { ...row, displayName }
      : row;

  const memberFor = (row: MembershipDto): MembershipDto => {
    if (!mayReadMembership || row.id !== membershipId) return row;
    const named = nameFor(row, row.id);
    return revision !== undefined && revision > (named.revision ?? -1)
      ? { ...named, revision }
      : named;
  };

  const me = memberFor(snapshot.me);
  const members = mapChanged(snapshot.members, memberFor);
  const contacts = snapshot.directChatContacts;
  const directChatContacts = contacts && mapChanged(contacts, (row) => nameFor(row, row.membershipId));
  const messages = mapChanged(snapshot.messages, (row) => nameFor(row, row.membershipId));
  const chatThreads = mapChanged(snapshot.chatThreads, (thread) => {
    if (thread.type !== "DIRECT") return thread;
    const [left, right] = thread.participants;
    const nextLeft = nameFor(left, left.membershipId);
    const nextRight = nameFor(right, right.membershipId);
    return nextLeft === left && nextRight === right
      ? thread
      : { ...thread, participants: [nextLeft, nextRight] as typeof thread.participants };
  });

  return me === snapshot.me && members === snapshot.members &&
    directChatContacts === contacts && messages === snapshot.messages &&
    chatThreads === snapshot.chatThreads
    ? snapshot
    : { ...snapshot, me, members, directChatContacts, messages, chatThreads };
}

export interface OrderedMembershipNamePatch extends MembershipNamePatch {
  sequence: number;
}

/**
 * Keep the cursor separate from GameSnapshot.snapshotVersion: an unrelated
 * point event may advance that value without carrying membership names.
 * The floor belongs to this membership's name projection. A campaign-wide
 * maximum can be read independently and need not cover this member's name.
 */
export function retainMembershipNamePatch(
  pending: Map<string, OrderedMembershipNamePatch>,
  floor: number,
  patch: OrderedMembershipNamePatch,
): boolean {
  if (
    patch.sequence <= floor ||
    patch.sequence <= (pending.get(patch.membershipId)?.sequence ?? -1)
  )
    return false;
  pending.set(patch.membershipId, patch);
  return true;
}

/** Reproject still-newer names without copying obsolete visibility or data. */
export function rebaseMembershipNames(
  canonical: GameSnapshot,
  pending: ReadonlyMap<string, OrderedMembershipNamePatch>,
  canonicalNameSequences: Readonly<Record<string, number>>,
): GameSnapshot {
  let result = canonical;
  for (const patch of pending.values()) {
    if (patch.sequence > (canonicalNameSequences[patch.membershipId] ?? 0))
      result = projectName(result, patch, true);
  }
  return result;
}
