import { api } from "./api";

export type AccountCampaign = { id: string; name: string; role: "GM" | "PLAYER"; membershipId: string; selected: boolean };
export type AccountCampaignList = { campaigns: AccountCampaign[] };
export type AccountCampaignCreateResult = { campaignId: string; membershipId: string; name: string; role: "GM" };
export type AccountCampaignInvite = { inviteId: string; token: string; expiresAt: string; role: "PLAYER" };

export const listAccountCampaigns = () => api<AccountCampaignList>("/api/account/campaigns");
export const createAccountCampaign = (name: string, idempotencyKey: string, csrfToken: string) => api<AccountCampaignCreateResult>("/api/account/campaigns", {
  method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({ name, idempotencyKey }),
});
export const selectAccountCampaign = (campaignId: string, csrfToken: string) => api<{ campaignId: string; membershipId: string; role: "GM" | "PLAYER" }>("/api/account/campaigns/select", {
  method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({ campaignId }),
});
export const createAccountCampaignInvite = (campaignId: string, label: string, csrfToken: string) => api<AccountCampaignInvite>("/api/account/campaigns/invites", {
  method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({ campaignId, label, expiresInHours: 72 }),
});
export const claimAccountCampaignInvite = (token: string, csrfToken: string) => api<{ campaignId: string; membershipId: string; role: "PLAYER" }>("/api/account/campaigns/invites/claim", {
  method: "POST", headers: { "x-csrf-token": csrfToken }, body: JSON.stringify({ token }),
});
