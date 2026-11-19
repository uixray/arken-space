const SHARED_CAMPAIGN_SETUP_PATHS = [
  "tests/e2e/campaign-fixture.ts",
  "tests/e2e/chat-history-fixture.ts",
  "tests/e2e/owned-campaign-history.ts",
  "tests/owned-campaign-history.test.ts",
  "tests/chat-history-fixture.test.ts",
];
const MANUAL_REVIEW_PATHS = new Set([
  ...SHARED_CAMPAIGN_SETUP_PATHS,
  "apps/web/src/cartographic-label-placement.css",
  "apps/web/src/PositionedCartographicLabel.tsx",
  "apps/web/src/CartographicLabelFields.tsx",
]);

export const UIX694_REVIEWED_PATHS = [
  ...SHARED_CAMPAIGN_SETUP_PATHS,
  "tests/e2e/mocked-chat-app.ts",
  "tests/e2e/uix289-bundled-motion.spec.ts",
  "tests/e2e/chat-icon-states.spec.ts",
  "tests/mocked-chat-app.test.ts",
  "scripts/qa/impact-map.mjs",
  "tests/qa-impact-map.test.ts",
  "scripts/qa/impact-report.mjs",
  "tests/qa-impact-report.test.ts",
  "apps/server/src/account-campaigns.ts",
  "apps/server/src/auth.ts",
  "apps/server/src/session-routes.ts",
  "apps/web/src/AccountAuthWorkspace.tsx",
  "apps/web/src/account-campaign-client.ts",
  "packages/contracts/src/account-auth.ts",
  "apps/server/src/realtime.ts",
  "apps/server/src/preview-snapshot.ts",
  "apps/server/src/token-preview-epochs.ts",
  "apps/server/src/account-link-realtime.integration.test.ts",
  "apps/server/src/account-realtime-auth.integration.test.ts",
  "tests/realtime.test.ts",
  "apps/web/src/cartographic-label-placement.css",
  "apps/web/src/PositionedCartographicLabel.tsx",
  "apps/web/src/CartographicLabelFields.tsx",
];

const UIX289_CASES = [
  "UIX-289 historical critical frames never request while newest displayed entry is ordinary text",
  "UIX-289 fresh reduced-motion critical card remains readable without bundled request",
  "UIX-289 newest dice becomes history while refreshed skill critical owns the only active frame",
  "UIX-289 real message-list clipping detaches and then restores the eligible frame",
  "UIX-289 live reduced-motion change removes and resumes the current image without hiding critical text",
  "UIX-289 one bundled-frame 404 latches a readable fallback without retry loops",
  "UIX-289 styleFrame uses the shared bounded lifecycle and static history/reduced fallback",
];

export const UIX694_IMPACT_MAP = {
  version: 1,
  advisoryOnly: true,
  reviewedPaths: [...UIX694_REVIEWED_PATHS],
  rules: [
    {
      id: "mocked-chat-transport",
      invariant:
        "Shared bootstrap and Engine.IO/Socket.IO transport remain protocol-ordered while consumer API routes stay local.",
      paths: [
        "tests/e2e/mocked-chat-app.ts",
        "tests/e2e/uix289-bundled-motion.spec.ts",
        "tests/e2e/chat-icon-states.spec.ts",
        "tests/mocked-chat-app.test.ts",
      ],
      journeys: [
        {
          spec: "tests/e2e/uix289-bundled-motion.spec.ts",
          evidenceKind: "mocked-browser",
          fullFile: true,
          projects: ["chromium", "firefox"],
          expectedCaseCount: 7,
          caseTitles: UIX289_CASES,
          requirements: [
            "preserve all seven UIX-289 message, motion, socket, 404 and styleFrame oracles",
            "retain live game:snapshot push and its ready-after-40 gate",
          ],
        },
        {
          spec: "tests/e2e/chat-icon-states.spec.ts",
          evidenceKind: "mocked-browser",
          fullFile: true,
          projects: ["chromium", "firefox"],
          expectedCaseCount: 4,
          titleTemplate: "UIX-645 chat icon states \u0024{role} \u0024{width}",
          parameterMatrix: {
            role: ["GM", "PLAYER"],
            width: [1280, 360],
          },
          requirements: [
            "preserve all four role-width cases and their local delayed-send contract",
            "retain write observation and release the pending request in finally",
          ],
        },
        {
          spec: "tests/mocked-chat-app.test.ts",
          evidenceKind: "unit",
          fullFile: true,
          requirements: [
            "await route registration",
            "preserve exact bootstrap fallback boundaries",
            "acknowledge only the Socket.IO 40 packet",
          ],
        },
        {
          spec: "tests/mock-api-contract.test.ts",
          evidenceKind: "unit",
          fullFile: true,
          requirements: [
            "preserve strict unknown API failures and server-backed read contracts",
          ],
        },
      ],
    },
    {
      id: "impact-map-validator",
      invariant:
        "Impact selection is deterministic advisory data; unknown paths remain visible for human review and cannot bypass required gates.",
      paths: ["scripts/qa/impact-map.mjs", "tests/qa-impact-map.test.ts"],
      journeys: [
        {
          spec: "tests/qa-impact-map.test.ts",
          evidenceKind: "unit",
          fullFile: true,
          requirements: [
            "validate exact path and journey references",
            "preserve unmatched paths and reviewRequired",
            "emit no executable test or gate-suppression instructions",
          ],
        },
      ],
    },
    {
      id: "read-only-impact-report",
      invariant:
        "Deduced journeys are advisory and never started by the reporter.",
      paths: ["scripts/qa/impact-report.mjs", "tests/qa-impact-report.test.ts"],
      journeys: [
        {
          spec: "tests/qa-impact-report.test.ts",
          evidenceKind: "unit",
          fullFile: true,
          requirements: ["preserve untracked paths and exact committed base"],
        },
      ],
    },
    {
      id: "account-campaign-boundary",
      invariant:
        "Account provenance, independent campaign membership and frontend session behavior remain distinct.",
      paths: [
        "apps/server/src/account-campaigns.ts",
        "apps/server/src/auth.ts",
        "apps/server/src/session-routes.ts",
        "apps/web/src/AccountAuthWorkspace.tsx",
        "apps/web/src/account-campaign-client.ts",
        "packages/contracts/src/account-auth.ts",
      ],
      journeys: [
        {
          spec: "apps/server/src/account-campaigns.integration.test.ts",
          evidenceKind: "backend-runtime",
          fullFile: true,
          requirements: [
            "test campaign creation and scoped selection",
            "preserve invite claims and CSRF",
          ],
        },
        {
          spec: "apps/server/src/account-session-provenance.integration.test.ts",
          evidenceKind: "backend-runtime",
          fullFile: true,
          requirements: [
            "test session provenance and negative access cases",
            "preserve revocation behavior",
          ],
        },
        {
          spec: "apps/web/src/AccountAuthWorkspace.test.tsx",
          evidenceKind: "unit",
          fullFile: true,
          requirements: ["preserve campaign selection and account UI behavior"],
        },
      ],
    },
    {
      id: "realtime-campaign-boundary",
      invariant:
        "Socket delivery remains campaign-scoped, previews respect visibility and epoch, and fully initialized sessions are invalidated on revocation.",
      paths: [
        "apps/server/src/realtime.ts",
        "apps/server/src/preview-snapshot.ts",
        "apps/server/src/token-preview-epochs.ts",
        "apps/server/src/account-link-realtime.integration.test.ts",
        "apps/server/src/account-realtime-auth.integration.test.ts",
        "tests/realtime.test.ts",
      ],
      journeys: [
        {
          spec: "tests/realtime.test.ts",
          evidenceKind: "backend-runtime",
          fullFile: true,
          requirements: [
            "confirm delivery to the correct campaign room in both directions",
            "preserve visible and redacted token preview transitions and durable movement",
          ],
        },
        {
          spec: "apps/server/src/account-link-realtime.integration.test.ts",
          evidenceKind: "backend-runtime",
          fullFile: true,
          requirements: [
            "verify campaign mismatch and invalidation after links or credentials change",
          ],
        },
        {
          spec: "apps/server/src/account-realtime-auth.integration.test.ts",
          evidenceKind: "backend-runtime",
          fullFile: true,
          requirements: [
            "verify logout disconnect and independent account membership binding",
          ],
        },
      ],
    },
    {
      id: "cartographic-label-presentation",
      manualReview: true,
      invariant:
        "Labels preserve semantic text, configured offsets and opt-in; detached captions must not block neighboring pins. DOM tests alone do not prove CSS hit targets.",
      paths: [
        "apps/web/src/cartographic-label-placement.css",
        "apps/web/src/PositionedCartographicLabel.tsx",
        "apps/web/src/CartographicLabelFields.tsx",
      ],
      journeys: [
        {
          spec: "apps/web/src/PositionedCartographicLabel.test.tsx",
          evidenceKind: "unit",
          fullFile: true,
          requirements: [
            "preserve semantic name and visual clamp without changing configuration",
            "separately check neighboring pin hit targets in a built browser candidate",
            "review tests/e2e/cartographic-label-hit-target.spec.ts and both real label consumers; DOM tests are not paint or clipping acceptance",
          ],
        },
        {
          spec: "apps/web/src/CartographicLabelFields.test.tsx",
          evidenceKind: "unit",
          fullFile: true,
          requirements: [
            "preserve presentation choice and explicit title opt-in",
            "do not infer persistence, permissions or physical input from DOM coverage",
          ],
        },
      ],
    },
    {
      id: "owned-campaign-history",
      manualReview: true,
      invariant:
        "Shared campaign setup validates the local database before opening it, owns only its worker campaigns, and retains SQL GM checks. Browser consumers still require manual selection.",
      paths: [...SHARED_CAMPAIGN_SETUP_PATHS],
      journeys: [
        {
          spec: "tests/owned-campaign-history.test.ts",
          evidenceKind: "unit",
          fullFile: true,
          requirements: [
            "reject unsafe routing before opening a database",
            "preserve worker ownership, count bounds, asynchronous failures and cleanup",
            "manually review real browser consumers of campaign-fixture.ts; this is not their acceptance",
          ],
        },
        {
          spec: "tests/chat-history-fixture.test.ts",
          evidenceKind: "backend-runtime",
          fullFile: true,
          requirements: [
            "preserve real SQL GM/campaign checks and exact ordered history bodies",
            "never infer HTTP authentication or rate-limit acceptance from direct SQL preparation",
          ],
        },
      ],
    },
  ],
};

const FORBIDDEN_KEY = /(?:command|gate|bypass|suppress|skip|execute)/i;
const ROOT_KEYS = new Set([
  "version",
  "advisoryOnly",
  "reviewedPaths",
  "rules",
]);
const RULE_KEYS = new Set([
  "id",
  "invariant",
  "paths",
  "journeys",
  "manualReview",
]);
const JOURNEY_KEYS = new Set([
  "spec",
  "evidenceKind",
  "fullFile",
  "projects",
  "expectedCaseCount",
  "caseTitles",
  "titleTemplate",
  "parameterMatrix",
  "requirements",
]);
const MOCKED_BROWSER_PROJECTS = ["chromium", "firefox"];
const CHAT_ICON_ROLE_MATRIX = ["GM", "PLAYER"];
const CHAT_ICON_WIDTH_MATRIX = [1280, 360];
const ALLOWED_REFERENCED_SPECS = new Set([
  "tests/owned-campaign-history.test.ts",
  "tests/chat-history-fixture.test.ts",
  "apps/web/src/PositionedCartographicLabel.test.tsx",
  "apps/web/src/CartographicLabelFields.test.tsx",
  "apps/server/src/account-link-realtime.integration.test.ts",
  "apps/server/src/account-realtime-auth.integration.test.ts",
  "tests/realtime.test.ts",
  "tests/qa-impact-report.test.ts",
  "apps/server/src/account-campaigns.integration.test.ts",
  "apps/server/src/account-session-provenance.integration.test.ts",
  "apps/web/src/AccountAuthWorkspace.test.tsx",
  "tests/e2e/uix289-bundled-motion.spec.ts",
  "tests/e2e/chat-icon-states.spec.ts",
  "tests/mocked-chat-app.test.ts",
  "tests/mock-api-contract.test.ts",
  "tests/qa-impact-map.test.ts",
]);
const CHAT_ICON_ROLE_LOOP =
  /for\s*\(\s*const role of \["GM",\s*"PLAYER"\]\s+as const\s*\)/;
const CHAT_ICON_WIDTH_LOOP = /for\s*\(\s*const width of \[1280,\s*360\]\s*\)/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, entry]) => FORBIDDEN_KEY.test(key) || hasForbiddenKey(entry),
  );
}

/** Only canonical, forward-slash repository-relative paths are accepted. */
export function isCanonicalRepositoryPath(path) {
  const hasForbiddenControlCode =
    typeof path === "string" &&
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.includes(":") ||
    hasForbiddenControlCode ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  )
    return false;
  const segments = path.split("/");
  return segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  );
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function addNonEmptyStrings(errors, values, label, { unique = false } = {}) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    errors.push(label + " must be a non-empty array of non-empty strings");
    return false;
  }
  if (unique && new Set(values).size !== values.length) {
    errors.push(label + " must not contain duplicates");
    return false;
  }
  return true;
}

/**
 * Validates the complete advisory schema and source references using caller-owned I/O.
 * No path is passed to readText until it has passed canonical-path validation.
 * @param {unknown} map
 * @param {{ readText?: unknown }} options
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateImpactMap(map, options) {
  const errors = [];
  if (!isRecord(map))
    return { valid: false, errors: ["map must be an object"] };
  if (!hasOnlyKeys(map, ROOT_KEYS))
    errors.push("map contains unsupported root fields");
  if (map.version !== 1) errors.push("version must be 1");
  if (map.advisoryOnly !== true) errors.push("advisoryOnly must be true");
  if (hasForbiddenKey(map))
    errors.push("map contains a forbidden executable or gate-control field");

  const readText =
    isRecord(options) && typeof options.readText === "function"
      ? options.readText
      : undefined;
  if (!readText) errors.push("readText callback is required");

  const reviewedPaths = Array.isArray(map.reviewedPaths)
    ? map.reviewedPaths
    : [];
  if (
    reviewedPaths.some((path) => !isCanonicalRepositoryPath(path)) ||
    reviewedPaths.length !== UIX694_REVIEWED_PATHS.length ||
    new Set(reviewedPaths).size !== reviewedPaths.length ||
    !sameArray([...reviewedPaths].sort(), [...UIX694_REVIEWED_PATHS].sort())
  )
    errors.push(
      "reviewedPaths must equal the exact canonical owned path inventory",
    );

  const readSource = (path, missingMessage) => {
    if (!readText) return undefined;
    try {
      const source = readText(path);
      if (typeof source === "string" && source.length > 0) return source;
    } catch {
      // Reader failures are validation failures, not an unchecked selector result.
    }
    errors.push(missingMessage);
    return undefined;
  };

  if (readText) {
    for (const path of UIX694_REVIEWED_PATHS)
      readSource(path, "reviewed path does not exist: " + path);
  }

  if (!Array.isArray(map.rules) || map.rules.length === 0)
    return {
      valid: false,
      errors: [...errors, "rules must be a non-empty array"],
    };

  const ruleIds = new Set();
  const coveredPaths = new Set();
  for (const rule of map.rules) {
    if (!isRecord(rule)) {
      errors.push("each rule must be an object");
      continue;
    }
    if (!hasOnlyKeys(rule, RULE_KEYS))
      errors.push("rule contains unsupported fields");
    if (Object.hasOwn(rule, "manualReview") && rule.manualReview !== true)
      errors.push("manualReview must be true when supplied");
    if (
      Array.isArray(rule.paths) &&
      rule.paths.some((path) => MANUAL_REVIEW_PATHS.has(path)) &&
      rule.manualReview !== true
    )
      errors.push("shared setup and label presentation require manualReview");
    if (typeof rule.id !== "string" || rule.id.trim() === "")
      errors.push("rule id must be non-empty");
    else if (ruleIds.has(rule.id)) errors.push("rule ids must be unique");
    else ruleIds.add(rule.id);
    if (typeof rule.invariant !== "string" || rule.invariant.trim() === "")
      errors.push("rule invariant must be non-empty");

    if (!Array.isArray(rule.paths) || rule.paths.length === 0) {
      errors.push("rule paths must be non-empty");
    } else {
      const localPaths = new Set();
      for (const path of rule.paths) {
        if (!isCanonicalRepositoryPath(path)) {
          errors.push("rule path must be canonical");
          continue;
        }
        if (!reviewedPaths.includes(path)) {
          errors.push("rule path must be one of the exact reviewed paths");
          continue;
        }
        if (localPaths.has(path)) errors.push("rule paths must not repeat");
        localPaths.add(path);
        coveredPaths.add(path);
      }
    }

    if (!Array.isArray(rule.journeys) || rule.journeys.length === 0) {
      errors.push("rule journeys must be non-empty");
      continue;
    }
    for (const journey of rule.journeys) {
      if (!isRecord(journey)) {
        errors.push("each journey must be an object");
        continue;
      }
      if (!hasOnlyKeys(journey, JOURNEY_KEYS))
        errors.push("journey contains unsupported fields");
      const safeSpec = isCanonicalRepositoryPath(journey.spec);
      if (!safeSpec)
        errors.push(
          "journey spec must be a canonical repository-relative path",
        );
      else if (!ALLOWED_REFERENCED_SPECS.has(journey.spec))
        errors.push("journey spec is outside the reviewed reference inventory");
      if (journey.fullFile !== true)
        errors.push("each journey must explicitly cover its full file");
      if (
        !["mocked-browser", "unit", "backend-runtime"].includes(
          journey.evidenceKind,
        )
      )
        errors.push("journey evidenceKind is unsupported");
      addNonEmptyStrings(errors, journey.requirements, "journey requirements", {
        unique: true,
      });

      const source = safeSpec
        ? readSource(
            journey.spec,
            "journey spec does not exist: " + journey.spec,
          )
        : undefined;

      if (journey.evidenceKind === "mocked-browser") {
        if (!sameArray(journey.projects, MOCKED_BROWSER_PROJECTS))
          errors.push(
            "mocked browser projects must be exactly Chromium and Firefox",
          );
        if (
          !Number.isInteger(journey.expectedCaseCount) ||
          journey.expectedCaseCount <= 0
        )
          errors.push(
            "mocked browser expectedCaseCount must be a positive integer",
          );
        const hasLiteralTitles = Object.hasOwn(journey, "caseTitles");
        const hasTemplate =
          Object.hasOwn(journey, "titleTemplate") ||
          Object.hasOwn(journey, "parameterMatrix");
        if (hasLiteralTitles === hasTemplate)
          errors.push(
            "mocked browser journey must use exactly one title inventory form",
          );
        if (hasLiteralTitles) {
          if (
            addNonEmptyStrings(errors, journey.caseTitles, "caseTitles", {
              unique: true,
            })
          ) {
            if (journey.caseTitles.length !== journey.expectedCaseCount)
              errors.push("caseTitles count does not match expectedCaseCount");
            if (typeof source === "string") {
              for (const title of journey.caseTitles) {
                if (!source.includes(title))
                  errors.push(
                    "case title is not present in its source: " + journey.spec,
                  );
              }
            }
          }
        } else if (hasTemplate) {
          if (
            typeof journey.titleTemplate !== "string" ||
            journey.titleTemplate.trim() === ""
          )
            errors.push("titleTemplate must be non-empty");
          else if (
            typeof source === "string" &&
            !source.includes(journey.titleTemplate)
          )
            errors.push("journey title template is not present in its source");
          const matrix = journey.parameterMatrix;
          if (
            !isRecord(matrix) ||
            !hasOnlyKeys(matrix, new Set(["role", "width"])) ||
            !sameArray(matrix.role, CHAT_ICON_ROLE_MATRIX) ||
            !sameArray(matrix.width, CHAT_ICON_WIDTH_MATRIX) ||
            journey.expectedCaseCount !== 4
          )
            errors.push(
              "chat icon matrix must be GM/PLAYER by 1280/360 with exactly four cases",
            );
          if (
            journey.spec === "tests/e2e/chat-icon-states.spec.ts" &&
            (typeof source !== "string" ||
              !CHAT_ICON_ROLE_LOOP.test(source) ||
              !CHAT_ICON_WIDTH_LOOP.test(source))
          )
            errors.push(
              "chat icon source loops must declare GM/PLAYER and widths 1280/360",
            );
        }
      } else if (
        Object.hasOwn(journey, "caseTitles") ||
        Object.hasOwn(journey, "titleTemplate") ||
        Object.hasOwn(journey, "parameterMatrix") ||
        Object.hasOwn(journey, "expectedCaseCount")
      ) {
        errors.push(
          "non-browser journey must not declare browser case metadata",
        );
      }
    }
  }

  for (const path of UIX694_REVIEWED_PATHS) {
    if (!coveredPaths.has(path))
      errors.push("reviewed path has no rule: " + path);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Select advisory journeys only after validating the same complete map contract.
 * Invalid maps never return a no-review result; the changed inputs stay unresolved.
 * @param {unknown} map
 * @param {string[]} changedPaths
 * @param {{ readText?: unknown }} options
 */
export function selectImpact(map, changedPaths, options) {
  if (
    !Array.isArray(changedPaths) ||
    changedPaths.some((path) => typeof path !== "string")
  )
    throw new TypeError("changedPaths must be an array of strings");
  const validation = validateImpactMap(map, options);
  const uniquePaths = [...new Set(changedPaths)];
  if (!validation.valid) {
    return {
      matchedRules: [],
      journeys: [],
      unmatchedPaths: uniquePaths,
      reviewRequired: true,
      advisoryOnly: true,
      validationErrors: validation.errors,
    };
  }

  const matched = map.rules.filter((rule) =>
    rule.paths.some((path) => uniquePaths.includes(path)),
  );
  const unmatchedPaths = uniquePaths.filter(
    (path) => !matched.some((rule) => rule.paths.includes(path)),
  );
  const journeyKeys = new Set();
  const journeys = [];
  for (const rule of matched) {
    for (const journey of rule.journeys) {
      const key = journey.evidenceKind + ":" + journey.spec;
      if (!journeyKeys.has(key)) {
        journeyKeys.add(key);
        journeys.push({ ...journey, ruleId: rule.id });
      }
    }
  }
  return {
    matchedRules: matched.map(({ id, invariant, manualReview }) => ({
      id,
      invariant,
      ...(manualReview ? { manualReview: true } : {}),
    })),
    journeys,
    unmatchedPaths,
    reviewRequired:
      unmatchedPaths.length > 0 ||
      matched.some((rule) => rule.manualReview === true),
    advisoryOnly: true,
    validationErrors: [],
  };
}
