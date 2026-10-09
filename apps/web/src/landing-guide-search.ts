import type { GuideSection } from "./landing-guide-content";

export function guideAnchor(title: string): string {
  return `guide-${title
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")}`;
}

export function resolveGuideHash(
  hash: string,
  sections: readonly GuideSection[],
): string | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (!sections.some((section) => guideAnchor(section.title) === id))
    return null;
  return id;
}

export function searchGuide(
  sections: readonly GuideSection[],
  query: string,
): GuideSection[] {
  const words = query
    .trim()
    .toLocaleLowerCase("ru")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return sections.map((section) => ({ ...section }));
  return sections.flatMap((section) => {
    const titleMatch = words.every((word) =>
      section.title.toLocaleLowerCase("ru").includes(word),
    );
    const shortcuts = section.shortcuts.filter(
      (item) =>
        titleMatch ||
        words.every((word) =>
          `${item.keys.join(" ")} ${item.action}`
            .toLocaleLowerCase("ru")
            .includes(word),
        ),
    );
    return shortcuts.length ? [{ ...section, shortcuts }] : [];
  });
}
