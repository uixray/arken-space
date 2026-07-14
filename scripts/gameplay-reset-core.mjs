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
      "select id from memberships where id = $2 and campaign_id = $1 and role = 'GM' for update",
      [campaignId, gmMembershipId],
    ],
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
      "update campaigns set active_scene_id = null, updated_at = now() where id = $1",
      [campaignId],
    ],
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
  const statements = gameplayResetStatements(campaignId, gmMembershipId);
  const [gmStatement, ...mutations] = statements;
  const gm = await transaction.query(...gmStatement);
  if (!gm?.rows?.length) throw new Error("RETAINED_GM_INVALID");
  for (const [statement, params] of mutations)
    await transaction.query(statement, params);
}

export async function orchestrateGameplayReset(input, dependencies) {
  const {
    campaignId,
    gmMembershipId,
    expectedBuildRevision,
    expectedSchemaVersion,
  } = input;
  const checkoutRevision = await dependencies.readCheckoutRevision();
  if (checkoutRevision !== expectedBuildRevision)
    throw new Error("Checkout revision does not match expected build");
  const health = await dependencies.verifyBuild(expectedBuildRevision);
  if (health.schemaVersion !== expectedSchemaVersion)
    throw new Error("Production schema version does not match");
  const snapshotId = await dependencies.createBackup();
  if (!snapshotId || snapshotId === "latest")
    throw new Error("Backup did not return an exact snapshot ID");
  await dependencies.rehearse(snapshotId);
  const evidence = await dependencies.readRehearsalEvidence();
  assertVerifiedRehearsal(evidence.report, snapshotId);
  if (evidence.report.productionBefore?.buildRevision !== expectedBuildRevision)
    throw new Error("Restore rehearsal build revision does not match");
  if (evidence.report.productionBefore?.schemaVersion !== expectedSchemaVersion)
    throw new Error("Restore rehearsal schema version does not match");
  const restoredHealth = evidence.report.steps?.find(
    (step) => step.name === "restored-application-health",
  );
  if (restoredHealth?.buildRevision !== expectedBuildRevision)
    throw new Error("Restored application revision does not match");
  if (restoredHealth?.schemaVersion !== expectedSchemaVersion)
    throw new Error("Restored application schema does not match");
  const productionAfter = evidence.report.steps?.find(
    (step) => step.name === "production-health-after",
  );
  if (
    productionAfter?.buildRevision &&
    productionAfter.buildRevision !== expectedBuildRevision
  )
    throw new Error("Post-rehearsal production revision does not match");
  if (
    productionAfter?.schemaVersion !== undefined &&
    productionAfter.schemaVersion !== expectedSchemaVersion
  )
    throw new Error("Post-rehearsal production schema does not match");
  const confirmation = await dependencies.requestConfirmation({
    campaignId,
    snapshotId,
  });
  if (confirmation !== `${campaignId}:${snapshotId}`)
    throw new Error("Typed confirmation does not match campaign and snapshot");
  if (!(await dependencies.approveExecution({ campaignId, snapshotId })))
    throw new Error("Operator did not approve reset execution");

  const before = await dependencies.countState(campaignId);
  await dependencies.enterMaintenance();
  let applicationRestarted = false;
  try {
    const maintenanceHealth = await dependencies.verifyMaintenanceBuild(
      expectedBuildRevision,
      expectedSchemaVersion,
    );
    if (
      maintenanceHealth.buildRevision !== checkoutRevision ||
      maintenanceHealth.buildRevision !== expectedBuildRevision ||
      maintenanceHealth.schemaVersion !== expectedSchemaVersion
    )
      throw new Error("Maintenance build or schema changed before reset");
    await dependencies.resetTransaction(campaignId, gmMembershipId);
    await dependencies.restartApplication();
    applicationRestarted = true;
    const after = await dependencies.verifyAfter({
      campaignId,
      gmMembershipId,
      expectedBuildRevision,
      expectedSchemaVersion,
      before,
    });
    const receipt = {
      kind: "arken-gameplay-reset-receipt",
      campaignId,
      gmMembershipId,
      snapshotId,
      reportHash: evidence.hash,
      buildRevision: health.buildRevision,
      schemaVersion: health.schemaVersion,
      before,
      after,
      completedAt: dependencies.now().toISOString(),
      authorizesReset: false,
    };
    await dependencies.writeReceipt(receipt);
    return receipt;
  } finally {
    if (!applicationRestarted) await dependencies.leaveMaintenance();
  }
}
