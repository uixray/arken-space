import type {
  CreateWorldContentInstance,
  DeleteWorldContentInstance,
  UpdateWorldContentInstance,
  WorldContentInstanceDto,
} from "@arken/contracts";
import { api } from "./api";

export type WorldContentInstanceFields = Pick<
  WorldContentInstanceDto,
  | "displayNameOverride"
  | "currentState"
  | "gmNotes"
  | "quantity"
  | "condition"
  | "ownerMembershipId"
  | "portraitAssetId"
  | "currentLocationId"
>;

export const fetchWorldContentInstances = (worldContentId: string) =>
  api<WorldContentInstanceDto[]>(
    `/api/world-content-instances?worldContentId=${encodeURIComponent(worldContentId)}`,
  );

export const fetchWorldContentInstance = (id: string) =>
  api<WorldContentInstanceDto>(
    `/api/world-content-instances/${encodeURIComponent(id)}`,
  );

export const createWorldContentInstance = (input: CreateWorldContentInstance) =>
  api<WorldContentInstanceDto | { duplicate: true }>(
    "/api/world-content-instances",
    { method: "POST", body: JSON.stringify(input) },
  );

export const updateWorldContentInstance = (
  id: string,
  input: UpdateWorldContentInstance,
) =>
  api<WorldContentInstanceDto | { duplicate: true }>(
    `/api/world-content-instances/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );

export const deleteWorldContentInstance = (
  id: string,
  input: DeleteWorldContentInstance,
) =>
  api<{ duplicate: true } | null>(
    `/api/world-content-instances/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { "x-action-id": input.actionId },
      body: JSON.stringify(input),
    },
  );
