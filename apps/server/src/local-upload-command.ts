import { LocalPeerRejection } from "./local-ability-command.js";
/** Expected file/transfer refusals only. Database and disk exceptions with unknown
 * outcomes remain uncertain and masked, never mislabeled as invalid user input. */
export async function localUploadCommand<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const conflicts = new Set([
      "UPLOAD_RESTART_REQUIRED",
      "UPLOAD_MEMORY_LIMIT",
      "UPLOAD_CONFLICT",
      "UPLOAD_OFFSET_INVALID",
      "PROCESSING_BUSY",
    ]);
    const invalid = new Set([
      "UPLOAD_REQUIRED",
      "UPLOAD_CHUNK_INVALID",
      "UPLOAD_HASH_MISMATCH",
      "IMAGE_TOO_LARGE",
      "IMAGE_DIMENSIONS_TOO_LARGE",
      "UNSUPPORTED_FILE_TYPE",
      "UNSUPPORTED_IMAGE_TYPE",
      "INVALID_IMAGE",
      "MEDIA_QUOTA_EXCEEDED",
      "LOW_DISK_SPACE",
    ]);
    if (conflicts.has(code) || invalid.has(code))
      throw new LocalPeerRejection({
        status: conflicts.has(code) ? 409 : 400,
        code,
      });
    throw error;
  }
}
