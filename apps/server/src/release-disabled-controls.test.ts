import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { env } from "./env.js";
import { registerCloudSyncRoutes } from "./cloud-sync-routes.js";
import { registerLocalSessionRoutes } from "./local-session-routes.js";
import { registerTelegramCampaignBridge } from "./telegram-campaign-bridge.js";

const previous = {...env};
afterEach(() => { Object.assign(env, previous); vi.restoreAllMocks(); });

it("keeps cloud intake, local control and Telegram webhook dormant in the hosted release", async () => {
  Object.assign(env, {DEPLOYMENT_MODE:"HOSTED", CLOUD_SYNC_STAGING_ENABLED:false, LOCAL_SESSION_BRIDGE_ENABLED:false, TELEGRAM_CAMPAIGN_ENABLED:"false"});
  const app = Fastify();
  const guard = vi.fn();
  const db = new Proxy({}, {get(){throw new Error("Dormant control accessed database");}});
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network access"));
  registerCloudSyncRoutes(app, db as never, guard);
  registerLocalSessionRoutes(app, db as never, async()=>{});
  const stop = registerTelegramCampaignBridge(app, db as never);
  try {
    await app.ready();
    for (const url of ["/api/account/cloud-sync/sources", "/api/local-session/start", "/api/integrations/telegram/campaign"]) {
      const result = await app.inject({method:"POST", url, payload:{}});
      expect(result.statusCode, url).toBe(404);
    }
    expect(guard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally { await stop(); await app.close(); }
});
