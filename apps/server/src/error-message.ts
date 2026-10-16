/** The message of a thrown value, for matching known failure codes. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}
