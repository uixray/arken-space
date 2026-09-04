import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("App connects optimistic projection, all placements, conditions and session cleanup", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  expect(app).toContain("tokens: tokenMutations.project(snapshot.tokens)");
  expect(app).toMatch(/useTokenDefinitionActions\(\{[^}]*placeOptimistically/s);
  expect(app).toMatch(
    /onPlaceTokenDefinition=\{async[\s\S]*?placeOptimistically\(/,
  );
  expect(app).toContain("tokenMutations.setConditions(tokenId, conditions)");
  expect(app).toContain("return () => tokenMutations.reset()");
  expect(app).toContain("snapshot?.campaign.id, snapshot?.me.id");
  expect(app).not.toMatch(
    /api\(\s*`\/api\/token-definitions\/\$\{(?:definitionId|definition.id)\}\/placements`/,
  );
});
