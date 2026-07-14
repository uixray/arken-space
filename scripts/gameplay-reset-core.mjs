export function assertVerifiedRehearsal(report, snapshotId) {
  if (!report?.runSucceeded || report.error)
    throw new Error("Restore rehearsal did not succeed");
  if (report.snapshot?.id !== snapshotId)
    throw new Error("Restore rehearsal snapshot does not match reset snapshot");
  const required = [
    "database-dump-checksum",
    "media-checksums",
    "database-counts",
    "restored-application-health",
    "compose-cleanup",
    "resource-leak-check",
    "restored-data-cleanup",
    "production-health-after",
  ];
  const passed = new Set(
    (report.steps ?? [])
      .filter((step) => step.status === "passed")
      .map((step) => step.name),
  );
  for (const step of required)
    if (!passed.has(step))
      throw new Error("Missing verified rehearsal step: " + step);
}

export function gameplayResetStatements(campaignId, gmMembershipId) {
  return [
    [
      "update assets set uploaded_by_membership_id = $2 where campaign_id = $1 and uploaded_by_membership_id <> $2",
      [campaignId, gmMembershipId],
    ],
    [
      "delete from sessions where membership_id in (select id from memberships where campaign_id = $1 and role = 'PLAYER')",
      [campaignId],
    ],
    ["delete from player_access_grants where campaign_id = $1", [campaignId]],
    ["delete from invites where campaign_id = $1", [campaignId]],
    ["delete from chat_messages where campaign_id = $1", [campaignId]],
    ["delete from audio_states where campaign_id = $1", [campaignId]],
    [
      "delete from fog_reveals where scene_id in (select id from scenes where campaign_id = $1)",
      [campaignId],
    ],
    [
      "delete from tokens where scene_id in (select id from scenes where campaign_id = $1)",
      [campaignId],
    ],
    ["delete from characters where campaign_id = $1", [campaignId]],
    ["delete from scenes where campaign_id = $1", [campaignId]],
    ["delete from game_events where campaign_id = $1", [campaignId]],
    [
      "delete from memberships where campaign_id = $1 and role = 'PLAYER'",
      [campaignId],
    ],
  ];
}

export async function executeGameplayReset(
  transaction,
  campaignId,
  gmMembershipId,
) {
  for (const [statement, params] of gameplayResetStatements(
    campaignId,
    gmMembershipId,
  ))
    await transaction.query(statement, params);
}
