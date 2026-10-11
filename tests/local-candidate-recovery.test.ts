import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createLocalCandidateRecoveryPlan,
  runCandidateRecoveryPlan,
} from "../scripts/local-candidate-recovery.mjs";

const candidateSha = "0123456789abcdef0123456789abcdef01234567";
const oldSha = "abcdef0123456789abcdef0123456789abcdef01";
const image = (digit: string) => `sha256:${digit.repeat(64)}`;
const valid = {
  candidateSha,
  serverImageId: image("a"),
  webImageId: image("b"),
  postgresImageId: image("c"),
  projectName: "arken-candidate-test-20261009",
  syntheticOnly: true,
  repositoryRoot: process.cwd(),
  artifactRoot: path.resolve(".data/qa-prep"),
  artifactDirectory: path.resolve(".data/qa-prep/candidate-test-20261009"),
  loopbackPort: 43127,
  webLoopbackPort: 43128,
  preUpgrade: {
    sourceSha: oldSha,
    imageIds: { server: image("d"), web: image("e") },
    snapshotId: "synthetic-pre-upgrade-001",
    mediaArtifact: "synthetic-media-manifest-001",
  },
};

describe("local candidate recovery plan safety", () => {
  it("is image-ID-only, synthetic, loopback, project-scoped and dry-run by default", () => {
    const plan = createLocalCandidateRecoveryPlan(valid);
    expect(plan.composeArgs).toContain("--pull");
    expect(plan.composeArgs).toContain("never");
    expect(plan.composeArgs).toContain("--no-build");
    expect(plan.loopbackBinding).toBe("127.0.0.1:43127");
    expect(plan.databasesPublished).toBe(false);
    expect(plan.volumes).toHaveLength(2);
    const execution = runCandidateRecoveryPlan(plan);
    expect(execution).toMatchObject({ status: "planned", commandsRun: 0 });
  });

  it("rejects head aliases, mutable tags, missing synthetic scope and unsafe rollback tuple", () => {
    expect(() =>
      createLocalCandidateRecoveryPlan({ ...valid, candidateSha: "HEAD" }),
    ).toThrow(/full 40-character/);
    expect(() =>
      createLocalCandidateRecoveryPlan({
        ...valid,
        serverImageId: "arken-server:latest",
      }),
    ).toThrow(/immutable sha256/);
    expect(() =>
      createLocalCandidateRecoveryPlan({ ...valid, syntheticOnly: false }),
    ).toThrow(/syntheticOnly/);
    expect(() =>
      createLocalCandidateRecoveryPlan({
        ...valid,
        preUpgrade: { ...valid.preUpgrade, sourceSha: candidateSha },
      }),
    ).toThrow(/distinct pre-upgrade/);
    expect(() =>
      createLocalCandidateRecoveryPlan({
        ...valid,
        artifactDirectory: "relative/out",
      }),
    ).toThrow(/absolute/);
    expect(() =>
      createLocalCandidateRecoveryPlan({
        ...valid,
        artifactDirectory: path.resolve(".data/qa-prep/production/restore"),
      }),
    ).toThrow(/production/);
  });

  it("refuses execution absent a matching root-approved synthetic configuration", () => {
    const plan = createLocalCandidateRecoveryPlan(valid);
    const runner = () => {
      throw new Error("must not execute");
    };
    expect(() =>
      runCandidateRecoveryPlan(plan, {
        execute: true,
        syntheticOnly: true,
        commandRunner: runner,
      }),
    ).toThrow(/root-approved/);
    expect(() =>
      runCandidateRecoveryPlan(plan, {
        execute: true,
        syntheticOnly: true,
        approval: { approved: true, candidateSha },
        commandRunner: runner,
      }),
    ).toThrow(/not implemented/);
  });

  it("keeps candidate Compose separate from build-based production restore configuration", () => {
    const compose = readFileSync(
      path.resolve("docker-compose.restore-candidate.yml"),
      "utf8",
    );
    expect(compose).not.toMatch(/^\s+build:/m);
    expect(compose).toContain("pull_policy: never");
    expect(compose).toMatch(/127\.0\.0\.1:\$\{CANDIDATE_QA_PORT/);
    expect(compose).not.toMatch(/^\s+ports:.*postgres/m);
    expect(compose).toContain("internal: true");
    expect(compose).not.toMatch(
      /docker\.sock|\/home\/uixray\/apps\/arken-space-data/i,
    );
  });
});
