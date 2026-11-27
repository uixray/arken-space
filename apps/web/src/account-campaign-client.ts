import { api } from "./api";

export type AccountCampaign = {
  id: string;
  name: string;
  role: "GM" | "PLAYER";
  membershipId: string;
  selected: boolean;
  archive?: { archivedAt: string | null; revision: number };
};
export type AccountCampaignList = { campaigns: AccountCampaign[] };
export type LocalCampaignPlayer = {
  membershipId: string;
  displayName: string;
  accessRevokedAt: string | null;
};
export const listLocalCampaignPlayers = (campaignId: string) =>
  api<{ players: LocalCampaignPlayer[] }>(
    `/api/account/campaigns/${encodeURIComponent(campaignId)}/players`,
  );
export const revokeLocalCampaignPlayer = (
  campaignId: string,
  membershipId: string,
  csrfToken: string,
) =>
  api<{ ok: true }>("/api/account/campaigns/players/revoke", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ campaignId, membershipId }),
  });
export type AccountCampaignCreateResult = {
  campaignId: string;
  membershipId: string;
  name: string;
  role: "GM";
};
export type AccountCampaignInvite = {
  inviteId: string;
  token: string;
  expiresAt: string;
  role: "PLAYER";
};

export const listAccountCampaigns = () =>
  api<AccountCampaignList>("/api/account/campaigns");
export const createAccountCampaign = (
  name: string,
  idempotencyKey: string,
  csrfToken: string,
) =>
  api<AccountCampaignCreateResult>("/api/account/campaigns", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ name, idempotencyKey }),
  });
export const selectAccountCampaign = (campaignId: string, csrfToken: string) =>
  api<{ campaignId: string; membershipId: string; role: "GM" | "PLAYER" }>(
    "/api/account/campaigns/select",
    {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      body: JSON.stringify({ campaignId }),
    },
  );
export const createAccountCampaignInvite = (
  campaignId: string,
  label: string,
  csrfToken: string,
) =>
  api<AccountCampaignInvite>("/api/account/campaigns/invites", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
    body: JSON.stringify({ campaignId, label, expiresInHours: 72 }),
  });
export const claimAccountCampaignInvite = (token: string, csrfToken: string) =>
  api<{ campaignId: string; membershipId: string; role: "GM" | "PLAYER" }>(
    "/api/account/campaigns/invites/claim",
    {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      body: JSON.stringify({ token }),
    },
  );

export const transitionAccountCampaignArchive = (
  campaignId: string,
  archived: boolean,
  expectedRevision: number,
  actionId: string,
  csrfToken: string,
) =>
  api<{ id: string; archivedAt: string | null; revision: number }>(
    "/api/account/campaigns/archive",
    {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      body: JSON.stringify({
        campaignId,
        archived,
        expectedRevision,
        actionId,
      }),
    },
  );
