import { useEffect, useRef, useState } from "react";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import {
  getAccountCapabilities,
  getAccountSession,
} from "./account-auth-client";
import { selectAccountCampaign } from "./account-campaign-client";

const campaignPath =
  /^\/campaign\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** Resolve an account campaign before mounting the game and its realtime clients. */
export function CampaignRouter() {
  const path = window.location.pathname;
  const campaignId = campaignPath.exec(path)?.[1];
  const invalidCampaignPath =
    path === "/campaign" || (path.startsWith("/campaign/") && !campaignId);
  const isAccount = path === "/account" || path.startsWith("/account/");
  const needsResolution =
    path === "/" || Boolean(campaignId) || invalidCampaignPath;
  const [state, setState] = useState<"loading" | "game" | "error">(
    needsResolution ? "loading" : "game",
  );
  // StrictMode must not issue the session-changing selection twice.
  const task = useRef<Promise<"game" | "redirect"> | null>(null);

  useEffect(() => {
    if (!needsResolution) return;
    let active = true;
    task.current ??= (async () => {
      if (invalidCampaignPath) throw new Error("Invalid campaign URL");
      const capabilities = await getAccountCapabilities();
      if (!capabilities.accountAuthEnabled) {
        if (campaignId) throw new Error("Account campaigns are unavailable");
        return "game";
      }
      const session = await getAccountSession();
      if (campaignId) {
        if (!session.authenticated || session.account.passwordChangeRequired) {
          window.location.replace(
            `/account?next=${encodeURIComponent(`/campaign/${campaignId}`)}`,
          );
          return "redirect";
        }
        // The server checks account ownership and replaces the game session.
        await selectAccountCampaign(campaignId, session.csrfToken);
        return "game";
      }
      if (session.authenticated) {
        window.location.replace("/account");
        return "redirect";
      }
      return "game";
    })();
    void task.current.then(
      (result) => {
        if (active && result === "game") setState("game");
      },
      () => {
        if (active) setState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [campaignId, invalidCampaignPath, needsResolution]);

  if (isAccount)
    return (
      <AuthGate
        onAuthenticated={(id) =>
          window.location.assign(
            id ? `/campaign/${encodeURIComponent(id)}` : "/",
          )
        }
      />
    );
  if (state === "loading")
    return (
      <main className="account-auth-shell" aria-busy="true">
        <p role="status">Открываем кампанию…</p>
      </main>
    );
  if (state === "error")
    return (
      <main className="account-auth-shell">
        <section className="account-auth-card">
          <h1>Не удалось открыть кампанию</h1>
          <p role="alert">
            Проверьте подключение и доступ к кампании, затем попробуйте ещё раз.
          </p>
          <a href="/account">Вернуться к выбору кампании</a>
        </section>
      </main>
    );
  return <App />;
}
