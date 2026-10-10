const PRIVATE_FONT_SOURCE =
  'src: url("/assets/pragmatica-next_vf.woff") format("woff");';

export function publicCiFontFallback(
  source: string,
  id: string,
  mode: string,
): string | null {
  if (
    mode !== "public-ci" ||
    !id.replaceAll("\\", "/").endsWith("/src/styles.css")
  ) {
    return null;
  }
  if (!source.includes(PRIVATE_FONT_SOURCE)) {
    throw new Error("Public CI font source was not found in styles.css");
  }
  return source.replace(PRIVATE_FONT_SOURCE, 'src: local("Arial");');
}
