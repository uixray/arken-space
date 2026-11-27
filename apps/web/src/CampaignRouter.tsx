import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { App } from "./App";
import { AuthGate } from "./AuthGate";
import {
  getAccountCapabilities,
  getAccountSession,
} from "./account-auth-client";
import { selectAccountCampaign } from "./account-campaign-client";
import { campaignReturnPath } from "./campaign-route";

import { campaignIdFromPath } from "./campaign-route";
import { Button } from "./design-system/Button";
import { LocalPlayerWorkspace } from "./local-first/LocalPlayerWorkspace";

/** Resolve an account campaign before mounting the game and its realtime clients. */
export function CampaignRouter() {
  const path = window.location.pathname;
  const campaignId = campaignIdFromPath(path);
  const invalidCampaignPath =
    path === "/campaign" || (path.startsWith("/campaign/") && !campaignId);
  const isAccount = path === "/account" || path.startsWith("/account/");
  const needsResolution =
    path === "/" || Boolean(campaignId) || invalidCampaignPath;
  const [state, setState] = useState<"loading" | "game" | "error" | "archived">(
    needsResolution ? "loading" : "game",
  );
  // StrictMode must not issue the session-changing selection twice.
  const [attempt, setAttempt] = useState(0);
  const task = useRef<Promise<"game" | "redirect" | "archived"> | null>(null);

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
          const next =
            campaignReturnPath(
              window.location.pathname + window.location.search,
            ) ?? `/campaign/${campaignId}`;
          window.location.replace(`/account?next=${encodeURIComponent(next)}`);
          return "redirect";
        }
        // The server checks account ownership and replaces the game session.
        try {
          await selectAccountCampaign(campaignId, session.csrfToken);
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status === 409 &&
            error.code === "CAMPAIGN_ARCHIVED"
          )
            return "archived";
          throw error;
        }
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
        if (active && result !== "redirect") setState(result);
      },
      () => {
        if (active) setState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [campaignId, invalidCampaignPath, needsResolution, attempt]);

  if (path === "/local-session") return <LocalPlayerWorkspace />;
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
  if (state === "error" || state === "archived")
    return (
      <main className="account-auth-shell">
        <section className="account-auth-card">
          <h1>
            {invalidCampaignPath ? "Некорректная ссылка на кампанию" : state === "archived"
              ? "Кампания в архиве"
              : "Не удалось открыть кампанию"}
          </h1>
          <p role="alert">
            {invalidCampaignPath ? "Попросите мастера прислать ссылку или выберите кампанию в своём кабинете." : state === "archived"
              ? "Вернитесь к выбору кампании."
              : "Проверьте подключение и доступ к кампании, затем попробуйте ещё раз."}
          </p>
          {!invalidCampaignPath && (
            <Button
              type="button"
              view="action"
              onClick={() => {
                task.current = null;
                setState("loading");
                setAttempt((value) => value + 1);
              }}
            >
              Повторить открытие
            </Button>
          )}
          <a href="/account">Вернуться к выбору кампании</a>
        </section>
      </main>
    );
  return <App />;
}
