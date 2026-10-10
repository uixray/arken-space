import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { publicCiFontFallback } from "../../font-build-profile";

const repoFile = (path: string) =>
  new URL(`../../../../${path}`, import.meta.url);

describe("local Pragmatica Next font contract", () => {
  it("keeps token source, generated CSS, and font asset aligned", async () => {
    const source = JSON.parse(
      await readFile(repoFile("tokens/typography.tokens.json"), "utf8"),
    );
    const generated = await readFile(
      repoFile("apps/web/src/design-system/tokens.generated.css"),
      "utf8",
    );
    expect(source.font.family.sans.$value[0]).toBe("Pragmatica Next");
    expect(generated).toMatch(/--font-family-sans:\s*"Pragmatica Next"/);
  });

  it("declares the licensed variable-font ranges in CSS without requiring private binary in public CI", async () => {
    const styles = await readFile(repoFile("apps/web/src/styles.css"), "utf8");
    expect(styles).toMatch(/font-weight:\s*100 900/);
    expect(styles).toMatch(/font-stretch:\s*10% 400%/);
    expect(styles).toMatch(/font-display:\s*swap/);
  });
  it("keeps production font source strict while public CI uses a local system fallback", async () => {
    const styles = await readFile(repoFile("apps/web/src/styles.css"), "utf8");
    const id = "/repo/apps/web/src/styles.css";
    expect(publicCiFontFallback(styles, id, "production")).toBeNull();
    const publicCi = publicCiFontFallback(styles, id, "public-ci");
    expect(publicCi).toContain('src: local("Arial");');
    expect(publicCi).not.toContain("/assets/pragmatica-next_vf.woff");
    expect(await readFile(repoFile("Dockerfile.web"), "utf8")).toMatch(
      /ARG WEB_BUILD_PROFILE=production[\s\S]*pnpm release:font:preflight/,
    );
    expect(await readFile(repoFile("docker-compose.e2e.yml"), "utf8")).toMatch(
      /WEB_BUILD_PROFILE: public-ci/,
    );
  });
  it("uses the local font for app and Gravity typography without Google imports", async () => {
    const [entry, styles, gravity] = await Promise.all(
      [
        "apps/web/src/main.tsx",
        "apps/web/src/styles.css",
        "apps/web/src/ui/gravity-foundation.css",
      ].map((path) => readFile(repoFile(path), "utf8")),
    );
    expect(entry).not.toContain("@gravity-ui/uikit/styles/fonts.css");
    expect(styles).toMatch(
      /src:\s*url\("\/assets\/pragmatica-next_vf\.woff"\)/,
    );
    expect(styles).toContain(".g-root {");
    expect(styles).toContain(
      "--g-text-body-font-family: var(--font-family-sans)",
    );
    expect(gravity).toContain(
      "--arken-font-sans: var(--font-family-sans, system-ui, sans-serif)",
    );
  });
});
