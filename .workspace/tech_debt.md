# Technical debt

## 2026-07-18 — Public beta player aliases have no authentication secret

- The owner explicitly accepted public nickname-based account selection for the closed beta to reduce onboarding friction.
- Anyone who can open the service can impersonate any of the six listed players and access that player's permitted campaign data/actions.
- GM authentication remains separate and must never be exposed through this flow.
- Before opening access beyond the known beta group, replace `/play/:handle` authentication with a personal secret, PIN, or external identity provider; revoke public alias sessions during migration.

## 2026-07-15 — Wallet formatting verified only through broken chat layout

- Localized wallet audit formatting appears correct in production, but the owner could verify it only after reducing browser zoom to 50% because the chat layout is unusable at 100% with a long history.
- Treat the wallet change as provisionally verified, not as a completed chat experience.
- Replace file-sized release iterations with connected product pools: Chat first, Canvas second, remaining GM workflows third.
- Clear this debt only after the complete Chat Pool passes at 100% browser zoom with long-history GM and player fixtures.

## 2026-07-14 — Partial product acceptance after shortened rehearsal

- The production foundation is accepted based on automated GM + 6 coverage, recovery evidence, and a shortened owner walkthrough where the core flow broadly worked.
- The complete human product rehearsal is deferred until the prioritized usability and gameplay backlog is implemented.
- This leaves current canvas behavior, multiplayer usability, and the expanded character system without a complete end-to-end product acceptance pass.
- Return to this debt before declaring the backlog release ready for a full game: run the complete GM + 6 rehearsal across the supported browsers and record defects against approved acceptance criteria.

## 2026-07-19 — human release rehearsal remains provisional

- **Compromise:** the isolated candidate was reported as “more or less working”, without a recorded 30–45 minute GM+6 checklist result across the required independent Chrome, Firefox and Edge profiles.
- **Impact:** production release evidence is incomplete; no production deployment may be authorized from this result.
- **Next action:** record the runbook’s pass/fail outcome, any defects, browser/profile coverage, and explicit GO/NO-GO before re-requesting deployment.
