export type AudioUploadFormat = { mimeType: "audio/mpeg" | "audio/ogg" | "audio/wav"; extension: ".mp3" | ".ogg" | ".wav" };

/** Canonical formats accepted by the existing protected AUDIO asset pipeline. */
export function audioUploadFormat(detectedMime: string): AudioUploadFormat {
  switch (detectedMime) {
    case "audio/mpeg": return { mimeType: "audio/mpeg", extension: ".mp3" };
    case "audio/ogg":
    case "application/ogg": return { mimeType: "audio/ogg", extension: ".ogg" };
    case "audio/wav": return { mimeType: "audio/wav", extension: ".wav" };
    default: throw new Error("UNSUPPORTED_AUDIO_TYPE");
  }
}
