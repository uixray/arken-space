/** Deterministic longest-processing-time assignment; never drops discovered files. */
export function balanceFiles(files, durations, shardCount = 3) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1)
    throw new Error("Invalid shard count");
  if (new Set(files).size !== files.length)
    throw new Error("Duplicate discovered file");
  const measured = Object.values(durations)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const fallback = measured[Math.floor(measured.length / 2)] ?? 1000;
  const weight = (file) => {
    const value = durations[file];
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error(`Invalid duration: ${file}`);
    return value ?? fallback;
  };
  const bins = Array.from({ length: shardCount }, (_, index) => ({
    index,
    durationMs: 0,
    files: [],
  }));
  for (const file of [...files].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b, "en"),
  )) {
    const bin = [...bins].sort(
      (a, b) => a.durationMs - b.durationMs || a.index - b.index,
    )[0];
    bin.files.push(file);
    bin.durationMs += weight(file);
  }
  for (const bin of bins) bin.files.sort();
  return bins;
}
/** Build plans from the current Playwright discovery, never from stale timing inventory. */
export function planDiscoveredTests(
  report,
  project,
  durations,
  shardCount = 3,
) {
  const ids = new Set();
  const files = new Map();
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          if (test.projectName !== project) continue;
          if (ids.has(spec.id))
            throw new Error(`Duplicate test ID: ${spec.id}`);
          ids.add(spec.id);
          const file = spec.file.replaceAll("\\", "/");
          if (!files.has(file)) files.set(file, []);
          files.get(file).push(spec.id);
        }
      }
      walk(suite.suites);
    }
  };
  walk(report.suites);
  if (!ids.size) throw new Error(`No discovered tests: ${project}`);
  const plans = balanceFiles([...files.keys()], durations, shardCount).map(
    (bin) => ({
      ...bin,
      testIds: bin.files.flatMap((file) => files.get(file)).sort(),
    }),
  );
  const union = plans.flatMap((bin) => bin.testIds);
  if (union.length !== ids.size || new Set(union).size !== ids.size)
    throw new Error("Shard coverage mismatch");
  return plans;
}
