import type { AudioClipAnalysis, AudioClipPreview } from "@arken/contracts";
import { api } from "./api.js";

export type ClipCandidateStatus = Omit<AudioClipPreview, "status"> & {
  status: "PROCESSING" | "READY" | "EXPIRED" | "CANCELLED" | "FAILED" | "SAVED";
};
export type ClipSaveBody = {
  actionId: string;
  candidateId: string;
  label: string;
  icon: string;
  category: string;
  defaultGain: number;
  audience: "ALL_MEMBERS" | "GM_ONLY";
  sourceNote: string | null;
};
export type ClipSaveResult = {
  packId: string;
  sound: {
    id: string;
    packId: string;
    assetId: string;
    label: string;
    icon: string;
    category: string;
    sortOrder: number;
    defaultGain: number;
    audience: "ALL_MEMBERS" | "GM_ONLY";
    sourceNote: string | null;
  };
  provenance: {
    sourceAssetId: string | null;
    sourceVersion: string;
    startMs: number;
    endMs: number;
    actualStartFrame: number;
    actualEndFrame: number;
    sampleRate: number;
  };
};

export function getAudioClipAnalysis(assetId: string, signal?: AbortSignal) {
  return api<AudioClipAnalysis>(
    `/api/assets/${encodeURIComponent(assetId)}/audio-analysis`,
    { signal },
  );
}

export function createAudioClipPreview(
  assetId: string,
  body: {
    actionId: string;
    sourceVersion: string;
    startMs: number;
    endMs: number;
  },
  signal?: AbortSignal,
) {
  return api<AudioClipPreview>(
    `/api/assets/${encodeURIComponent(assetId)}/audio-clip-preview`,
    { method: "POST", body: JSON.stringify(body), signal },
  );
}

export function getAudioClipCandidate(
  candidateId: string,
  signal?: AbortSignal,
) {
  return api<ClipCandidateStatus>(
    `/api/audio-clip-previews/${encodeURIComponent(candidateId)}`,
    { signal },
  );
}

export function saveAudioClip(
  packId: string,
  body: ClipSaveBody,
  signal?: AbortSignal,
) {
  return api<ClipSaveResult>(
    `/api/soundpad/packs/${encodeURIComponent(packId)}/clips`,
    { method: "POST", body: JSON.stringify(body), signal },
  );
}

export function audioClipPreviewContentUrl(
  previewUrl: string | null,
  candidateId: string,
) {
  return (
    previewUrl ??
    `/api/audio-clip-previews/${encodeURIComponent(candidateId)}/content`
  );
}
