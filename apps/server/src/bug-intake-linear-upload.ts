import { z } from "zod";
import type { createBugLinearHttp } from "./bug-intake-linear-http.js";
import { putBugLinearFile } from "./bug-intake-linear-put.js";

const uploadData = z.object({ fileUpload: z.object({
  success: z.literal(true),
  uploadFile: z.object({
    uploadUrl: z.string().url(), assetUrl: z.string().url(),
    headers: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
}) });

/** One private upload attempt; caller must persist the returned receipt before
 * proceeding. Never invoke automatically after an unknown upload outcome.
 * Protocol: Linear's official SDK schema, Mutation.fileUpload.
 */
export async function uploadBugFileToLinear(
  request: ReturnType<typeof createBugLinearHttp>,
  policy: Parameters<typeof putBugLinearFile>[0],
  file: { id: string; bytes: Buffer; sha256: string; sizeBytes: number },
) {
  z.string().uuid().parse(file.id);
  z.number().int().positive().max(100 * 1024 * 1024).parse(file.sizeBytes);
  if (file.bytes.length !== file.sizeBytes)
    return { ok: false as const, error: "UPLOAD_BYTES_MISMATCH" };
  const response = await request(`mutation BugFileUpload($filename: String!, $size: Int!) {
    fileUpload(contentType: "application/octet-stream", filename: $filename,
      size: $size, makePublic: false) {
      success uploadFile { uploadUrl assetUrl headers { key value } }
    }
  }`, { filename: `bug-attachment-${file.id}.bin`, size: file.sizeBytes });
  if (!response.ok || !("data" in response))
    return { ok: false as const, error: "UPLOAD_NEGOTIATION_FAILED" };
  const parsed = uploadData.safeParse(response.data);
  if (!parsed.success)
    return { ok: false as const, error: "UPLOAD_NEGOTIATION_FAILED" };
  const result = await putBugLinearFile(policy, parsed.data.fileUpload.uploadFile,
    file.bytes, { sha256: file.sha256, sizeBytes: file.sizeBytes });
  if (!result.ok) return result;
  return { ok: true as const, receipt: {
    id: file.id, sha256: file.sha256, sizeBytes: file.sizeBytes,
    assetUrl: result.assetUrl,
  } };
}
