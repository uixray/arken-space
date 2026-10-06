/** Keep proportional resize requests inside the server's 16–1024px contract. */
export function proportionalTokenSize(
  token: { width: number; height: number },
  requestedWidth: number,
) {
  const minimumScale = Math.max(16 / token.width, 16 / token.height);
  const maximumScale = Math.min(1024 / token.width, 1024 / token.height);
  const scale = Math.min(
    maximumScale,
    Math.max(minimumScale, requestedWidth / token.width),
  );
  return {
    width: Math.max(16, Math.min(1024, Math.round(token.width * scale))),
    height: Math.max(16, Math.min(1024, Math.round(token.height * scale))),
  };
}
