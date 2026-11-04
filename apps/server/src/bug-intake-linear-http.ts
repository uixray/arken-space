/** Lazy, internal-only GraphQL transport. Constructing it makes no requests.
 * Reference: https://linear.app/developers/graphql
 * No retries: any mutation may have succeeded despite a lost response.
 */
export function createBugLinearHttp(credential: {
  kind: "apiKey" | "oauth";
  value: string;
}) {
  if (
    !credential.value ||
    credential.value.length > 8192 ||
    /\s/.test(credential.value) ||
    [...credential.value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  )
    throw new Error("INVALID_LINEAR_CREDENTIAL");
  const authorization =
    credential.kind === "oauth"
      ? `Bearer ${credential.value}`
      : credential.value;
  return async (query: string, variables: Record<string, unknown>) => {
    // Only authored adapter operations may call this, never arbitrary client queries.
    const body = JSON.stringify({ query, variables });
    if (Buffer.byteLength(body, "utf8") > 512 * 1024)
      return { ok: false as const, error: "REQUEST_TOO_LARGE" as const };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body,
      });
      if (!response.body)
        return { ok: false as const, error: "INVALID_RESPONSE" as const };
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024 * 1024)
          return { ok: false as const, error: "RESPONSE_TOO_LARGE" as const };
        chunks.push(chunk.value);
      }
      const envelope: unknown = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      );
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
        return { ok: false as const, error: "INVALID_RESPONSE" as const };
      const value = envelope as Record<string, unknown>;
      // Keep partial data so the adapter can salvage a known created issue ID.
      // Raw GraphQL errors may echo private inputs; never return or log them.
      const errorsPresent =
        value.errors !== undefined &&
        (!Array.isArray(value.errors) || value.errors.length > 0);
      return {
        ok: response.ok && !errorsPresent,
        httpStatus: response.status,
        errorsPresent,
        data: value.data as unknown,
      };
    } catch {
      return {
        ok: false as const,
        error: controller.signal.aborted
          ? ("TIMEOUT" as const)
          : ("EXTERNAL_RESULT_UNKNOWN" as const),
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  };
}
