import { readFile } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";
import { describe, expect, it } from "vitest";
import { audioUploadFormat } from "./audio-upload-format.js";

const clips = "../../web/public/soundpad-defaults";
describe("soundpad approved WAV and OGG upload formats", () => {
  it("detects the approved WAV, preserves the WAV extension/content type, and parses duration", async () => {
    const bytes = await readFile(new URL(`${clips}/surprise-oh-my.wav`, import.meta.url));
    const detected = await fileTypeFromBuffer(bytes);
    expect(detected?.mime).toBe("audio/wav");
    expect(audioUploadFormat(detected!.mime)).toEqual({ mimeType: "audio/wav", extension: ".wav" });
    const parsed = await parseBuffer(bytes, { mimeType: detected!.mime, size: bytes.length }, { duration: true, skipCovers: true });
    expect(parsed.format.duration).toBeGreaterThan(0);
    expect(parsed.format.duration).toBeLessThanOrEqual(10);
  });
  it("recognizes the approved OGG as a supported protected audio format", async () => {
    const bytes = await readFile(new URL(`${clips}/evil-laugh.ogg`, import.meta.url));
    const detected = await fileTypeFromBuffer(bytes);
    expect(detected?.mime).toBe("audio/ogg");
    expect(audioUploadFormat(detected!.mime)).toEqual({ mimeType: "audio/ogg", extension: ".ogg" });
  });
  it("rejects formats outside the existing allowlist", () => {
    expect(() => audioUploadFormat("audio/webm")).toThrow("UNSUPPORTED_AUDIO_TYPE");
  });
});
