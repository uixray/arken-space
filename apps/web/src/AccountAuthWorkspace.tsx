import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccountCapabilities, AccountSession } from "@arken/contracts";
import { Button } from "./design-system/Button";
import { FormInput } from "./ui/GravityFormControls";
import { ApiError } from "./api";
import { Brand } from "./Brand";
import {
  changeAccountPassword,
  confirmPasswordReset,
  confirmVerification,
  consumeActionToken,
  getAccountSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestPasswordReset,
  requestVerification,
} from "./account-auth-client";
import {
  claimAccountCampaignInvite,
  createAccountCampaign,
  createAccountCampaignInvite,
  listAccountCampaigns,
  selectAccountCampaign,
  type AccountCampaign,
} from "./account-campaign-client";
import "./account-auth.css";

type View =
  | "login"
  | "register"
  | "verify"
  | "reset-request"
  | "reset-confirm"
  | "account"
  | "join";
const MIN_PASSWORD = 12;
class LocalValidationError extends Error {}

function friendlyError(reason: unknown, localAccounts = false) {
  if (reason instanceof LocalValidationError) return reason.message;
  if (!(reason instanceof ApiError))
    return "Не удалось выполнить запрос. Повторите попытку.";
  switch (reason.code) {
    case "INVALID_CREDENTIALS":
      return localAccounts
        ? "Проверьте локальный логин и пароль."
        : "Проверьте логин или email и пароль. Если входите по email, убедитесь, что адрес подтверждён.";
    case "PASSWORD_POLICY_REJECTED":
      return "Пароль должен содержать от 12 до 128 символов.";
    case "ACCOUNT_DELIVERY_UNAVAILABLE":
      return "Письма сейчас недоступны. Попробуйте позже.";
    case "ACCOUNT_REGISTRATION_DISABLED":
      return "Регистрация аккаунтов временно выключена.";
    case "ACCOUNT_RATE_LIMITED":
      return "Слишком много попыток. Подождите и повторите.";
    case "INVALID_OR_EXPIRED_ACCOUNT_TOKEN":
      return "Ссылка истекла или уже использована. Запросите новую.";
    case "CURRENT_PASSWORD_INVALID":
      return "Текущий пароль не подходит.";
    case "PASSWORD_CHANGE_REQUIRED_NEW":
      return "Новый пароль должен отличаться от временного.";
    case "CAMPAIGN_CREATION_DISABLED":
      return "Создание кампаний сейчас выключено.";
    case "CAMPAIGN_CREATION_LIMIT_REACHED":
      return "Достигнут лимит кампаний для аккаунта.";
    case "CAMPAIGN_NOT_FOUND":
      return "Кампания недоступна для этого аккаунта.";
    case "INVITE_INVALID_OR_EXPIRED":
      return "Приглашение истекло или уже использовано.";
    case "ACCOUNT_ALREADY_IN_CAMPAIGN":
      return "Этот аккаунт уже состоит в кампании.";
    default:
      return "Не удалось выполнить запрос. Проверьте данные и повторите попытку.";
  }
}

export function AccountAuthWorkspace({
  onAuthenticated,
  capabilities,
}: {
  onAuthenticated: (campaignId?: string) => void;
  capabilities: AccountCapabilities;
}) {
  const path = window.location.pathname;
  // StrictMode replays effects in development. Keep the route's action-token
  // intent and one-time consumption across that setup/cleanup/setup cycle.
  const actionFlow = useRef(
    (!capabilities.localAccounts &&
      (path === "/account/verify" || path === "/account/reset-password")) ||
      path === "/account/join",
  );
  const actionTokenConsumed = useRef(false);
  const [view, setView] = useState<View>(
    !capabilities.localAccounts && path === "/account/verify"
      ? "verify"
      : !capabilities.localAccounts && path === "/account/reset-password"
        ? "reset-confirm"
        : path === "/account/join"
          ? "join"
          : "login",
  );
  const [token, setToken] = useState("");
  useEffect(() => {
    if (
      capabilities.localAccounts &&
      (path === "/account/verify" || path === "/account/reset-password")
    ) {
      // Discard public email action tokens without submitting them locally.
      consumeActionToken(window.location, (url) =>
        window.history.replaceState({}, "", url),
      );
      actionFlow.current = false;
      setToken("");
    }
    if (
      capabilities.localAccounts &&
      ["register", "verify", "reset-request", "reset-confirm"].includes(view)
    )
      setView("login");
  }, [capabilities.localAccounts, view, path]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [session, setSession] = useState<AccountSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [campaigns, setCampaigns] = useState<AccountCampaign[]>([]);
  const [campaignsState, setCampaignsState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const campaignsRequest = useRef(0);
  const [campaignName, setCampaignName] = useState("");
  const [firstRun, setFirstRun] = useState<{
    campaignId: string;
    role: "GM" | "PLAYER";
  } | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [pendingCreateSnapshot, setPendingCreateSnapshot] = useState<{
    name: string;
    key: string;
  } | null>(null);
  const [inviteAttemptsSnapshot, setInviteAttemptsSnapshot] = useState<
    Set<string>
  >(() => new Set());
  const [claimPendingSnapshot, setClaimPendingSnapshot] = useState(false);
  const [inviteTokenInput, setInviteTokenInput] = useState("");
  const pendingCreate = useRef<{ name: string; key: string } | null>(null);
  const claimPending = useRef(false);
  const inviteAttempts = useRef(new Set<string>());

  const refreshCampaigns = async () => {
    const requestId = ++campaignsRequest.current;
    setCampaignsState("loading");
    try {
      const result = await listAccountCampaigns();
      if (requestId !== campaignsRequest.current) return;
      setCampaigns(Array.isArray(result.campaigns) ? result.campaigns : []);
      setCampaignsState("ready");
    } catch (reason) {
      if (requestId !== campaignsRequest.current) return;
      setCampaignsState("error");
      throw reason;
    }
  };
  const readInviteToken = (suppliedToken = token) => {
    const raw = (suppliedToken || inviteTokenInput).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) {
      try {
        const link = new URL(raw);
        if (
          link.origin !== window.location.origin ||
          link.pathname !== "/account/join"
        )
          return "";
        return new URLSearchParams(link.hash.slice(1)).get("token") ?? "";
      } catch {
        return "";
      }
    }
    return /^[A-Za-z0-9_-]{40,64}$/.test(raw) ? raw : "";
  };
  const claimInvite = async (active: AccountSession, suppliedToken = token) => {
    if (claimPending.current) return;
    claimPending.current = true;
    setClaimPendingSnapshot(true);
    setBusy(true);
    setError("");
    try {
      const claimToken = readInviteToken(suppliedToken);
      if (!claimToken)
        throw new LocalValidationError(
          "Вставьте действительную ссылку-приглашение или откройте её из сообщения.",
        );
      const joined = await claimAccountCampaignInvite(
        claimToken,
        active.csrfToken,
      );
      // Returning members may have been promoted since the original claim;
      // do not present new-campaign/new-player onboarding on that replay.
      setFirstRun(
        joined.role === "PLAYER"
          ? { campaignId: joined.campaignId, role: "PLAYER" }
          : null,
      );
      setToken("");
      setInviteTokenInput("");
      await refreshCampaigns();
      setView("account");
      setNotice(
        "Вы присоединились к кампании. Выберите её, чтобы открыть игровой стол.",
      );
    } catch (reason) {
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      claimPending.current = false;
      setClaimPendingSnapshot(false);
      setBusy(false);
    }
  };
  const acceptJoinInvite = async () => {
    if (busy || claimPending.current) return;
    if (session) {
      await claimInvite(session);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await loginAccount(
        email,
        password,
        capabilities.localAccounts,
      );
      setSession(next);
      setPassword("");
      if (next.account.passwordChangeRequired) setView("account");
      else await claimInvite(next);
    } catch (reason) {
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (
      (capabilities.localAccounts && path !== "/account/join") ||
      (!actionFlow.current && view !== "verify" && view !== "reset-confirm") ||
      actionTokenConsumed.current
    )
      return;
    actionTokenConsumed.current = true;
    const consumed = consumeActionToken(window.location, (url) =>
      window.history.replaceState({}, "", url),
    );
    if (!consumed)
      setError(
        path === "/account/join"
          ? "Вставьте ссылку-приглашение из сообщения мастера."
          : "В ссылке нет кода подтверждения. Запросите письмо ещё раз.",
      );
    setToken(consumed ?? "");
  }, [view, capabilities.localAccounts, path]);
  useEffect(() => {
    let active = true;
    void getAccountSession()
      .then((value) => {
        if (active && value.authenticated) {
          setSession(value);
          setEmail(value.account.email ?? value.account.login ?? "");
          if (!actionFlow.current) setView("account");
        }
      })
      .catch((reason: unknown) => {
        if (active && (!(reason instanceof ApiError) || reason.status !== 404))
          setError(friendlyError(reason, capabilities.localAccounts));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!session || session.account.passwordChangeRequired) return;
    setCampaigns([]);
    void refreshCampaigns().catch((reason: unknown) =>
      setError(friendlyError(reason, capabilities.localAccounts)),
    );
    return () => {
      campaignsRequest.current += 1;
    };
  }, [session?.account.id, session?.account.passwordChangeRequired]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (view === "register") {
        if (password !== passwordAgain)
          throw new LocalValidationError("Пароли не совпадают.");
        if ([...password].length < MIN_PASSWORD || [...password].length > 128)
          throw new LocalValidationError(
            "Пароль должен содержать от 12 до 128 символов.",
          );
        await registerAccount(email, password);
        setPassword("");
        setPasswordAgain("");
        setView("login");
        setNotice(
          path === "/account/join"
            ? "Если адрес можно зарегистрировать, запрос на подтверждение принят. Подтвердите почту, затем войдите в этой вкладке или снова откройте исходное приглашение мастера."
            : "Если адрес можно зарегистрировать, запрос на подтверждение принят. Проверьте почту позже.",
        );
      } else if (view === "login") {
        const next = await loginAccount(
          email,
          password,
          capabilities.localAccounts,
        );
        setSession(next);
        setPassword("");
        if (
          !next.account.passwordChangeRequired &&
          path === "/account/join" &&
          readInviteToken()
        )
          await claimInvite(next);
        else setView("account");
      } else if (view === "join") {
        if (!session)
          throw new LocalValidationError(
            "Войдите в подтверждённый аккаунт, чтобы принять приглашение.",
          );
        await claimInvite(session);
      } else if (view === "verify") {
        if (!token)
          throw new LocalValidationError("В ссылке нет кода подтверждения.");
        await confirmVerification(token);
        setToken("");
        setView("login");
        setNotice("Email подтверждён. Теперь войдите в аккаунт.");
      } else if (view === "reset-request") {
        await requestPasswordReset(email);
        setNotice(
          "Если аккаунт существует, запрос принят. Проверьте почту позже.",
        );
      } else if (view === "reset-confirm") {
        if (!token) throw new LocalValidationError("В ссылке нет кода сброса.");
        if (password !== passwordAgain)
          throw new LocalValidationError("Пароли не совпадают.");
        if ([...password].length < MIN_PASSWORD || [...password].length > 128)
          throw new LocalValidationError(
            "Пароль должен содержать от 12 до 128 символов.",
          );
        await confirmPasswordReset(token, password);
        setToken("");
        setPassword("");
        setPasswordAgain("");
        setView("login");
        setNotice("Пароль изменён. Войдите с новым паролем.");
      } else if (
        session &&
        (view === "account" || session.account.passwordChangeRequired)
      ) {
        if (password !== passwordAgain)
          throw new LocalValidationError("Пароли не совпадают.");
        if ([...password].length < MIN_PASSWORD || [...password].length > 128)
          throw new LocalValidationError(
            "Пароль должен содержать от 12 до 128 символов.",
          );
        await changeAccountPassword(
          currentPassword,
          password,
          session.csrfToken,
        );
        setSession(null);
        setFirstRun(null);
        setInviteUrl("");
        setPassword("");
        setPasswordAgain("");
        setCurrentPassword("");
        setView("login");
        setNotice("Пароль изменён. Войдите снова.");
      }
    } catch (reason) {
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      setBusy(false);
    }
  };

  const createCampaign = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!pendingCreate.current) {
        pendingCreate.current = {
          name: campaignName.trim(),
          key: crypto.randomUUID(),
        };
        setPendingCreateSnapshot(pendingCreate.current);
      }
      const pending = pendingCreate.current;
      const result = await createAccountCampaign(
        pending.name,
        pending.key,
        session.csrfToken,
      );
      pendingCreate.current = null;
      setPendingCreateSnapshot(null);
      setCampaignName("");
      setFirstRun({ campaignId: result.campaignId, role: "GM" });
      setCampaigns((current) => [
        ...current.filter((campaign) => campaign.id !== result.campaignId),
        {
          id: result.campaignId,
          name: result.name,
          role: "GM",
          membershipId: result.membershipId,
          selected: true,
        },
      ]);
      setNotice(`Кампания «${result.name}» создана.`);
      void refreshCampaigns().catch((reason: unknown) =>
        setError(friendlyError(reason, capabilities.localAccounts)),
      );
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500
      ) {
        pendingCreate.current = null;
        setPendingCreateSnapshot(null);
      }
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      setBusy(false);
    }
  };
  const selectCampaign = async (campaignId: string) => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      await selectAccountCampaign(campaignId, session.csrfToken);
      onAuthenticated(campaignId);
    } catch (reason) {
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      setBusy(false);
    }
  };
  const makeInvite = async (campaignId: string) => {
    if (!session || busy) return;
    if (inviteAttempts.current.has(campaignId)) {
      setError(
        "Результат запроса приглашения неизвестен. Чтобы не создать дубликат, повтор не отправлен; обновите страницу перед новой попыткой.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setInviteUrl("");
    inviteAttempts.current.add(campaignId);
    setInviteAttemptsSnapshot(new Set(inviteAttempts.current));
    try {
      const invite = await createAccountCampaignInvite(
        campaignId,
        inviteLabel || "Игрок",
        session.csrfToken,
      );
      setInviteLabel("");
      setInviteUrl(
        `${window.location.origin}/account/join#token=${encodeURIComponent(invite.token)}`,
      );
      inviteAttempts.current.delete(campaignId);
      setInviteAttemptsSnapshot(new Set(inviteAttempts.current));
    } catch (reason) {
      if (
        reason instanceof ApiError &&
        reason.status >= 400 &&
        reason.status < 500
      ) {
        inviteAttempts.current.delete(campaignId);
        setInviteAttemptsSnapshot(new Set(inviteAttempts.current));
      }
      setError(
        `${friendlyError(reason)} ${reason instanceof ApiError && reason.status < 500 ? "Запрос отклонён; после исправления можно попробовать снова." : "Результат запроса неизвестен. Автоматический повтор отключён, чтобы не создавать дубликат."}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await requestVerification(email);
      setNotice(
        "Если аккаунту требуется подтверждение, запрос принят. Проверьте почту позже.",
      );
    } catch (reason) {
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await logoutAccount(session?.csrfToken);
      setSession(null);
      setFirstRun(null);
      setInviteUrl("");
      onAuthenticated();
    } catch (reason) {
      setError(friendlyError(reason, capabilities.localAccounts));
    } finally {
      setBusy(false);
    }
  };

  if (session?.account.passwordChangeRequired)
    return (
      <main className="account-auth-shell">
        <section
          className="account-auth-card"
          aria-labelledby="initial-password-title"
        >
          <h1 id="initial-password-title">Задайте свой пароль</h1>
          <p>
            Временный пароль нельзя использовать для входа в кампанию. Задайте
            новый, затем войдите снова.
          </p>
          <form onSubmit={submit} aria-busy={busy}>
            <label>
              Временный пароль
              <FormInput
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Новый пароль
              <FormInput
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={MIN_PASSWORD}
                maxLength={128}
              />
            </label>
            <label>
              Повторите новый пароль
              <FormInput
                type="password"
                autoComplete="new-password"
                value={passwordAgain}
                onChange={(event) => setPasswordAgain(event.target.value)}
                required
                minLength={MIN_PASSWORD}
                maxLength={128}
              />
            </label>
            {error && (
              <p role="alert" className="account-auth-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              Сохранить новый пароль
            </Button>
          </form>
          <Button type="button" disabled={busy} onClick={() => void logout()}>
            Выйти
          </Button>
        </section>
      </main>
    );

  if (view === "account" && session)
    return (
      <main className="account-auth-shell">
        <section
          className="account-auth-card account-home"
          aria-labelledby="account-title"
        >
          <header className="account-home-header">
            <a
              href="/"
              className="account-home-brand"
              aria-label="Аркспейс — на главную"
            >
              <Brand />
            </a>
            <div className="account-home-identity">
              <span className="account-home-identity-label">Ваш аккаунт</span>
              <span className="account-auth-email">
                {session.account.email ?? session.account.login}
              </span>
            </div>
          </header>
          <div className="account-home-intro">
            <p className="account-auth-kicker">ВАШЕ ПРОСТРАНСТВО ДЛЯ ИГРЫ</p>
            <h1 id="account-title">Добро пожаловать</h1>
            <p className="account-home-lead">
              Выберите кампанию, чтобы вернуться к игре.
            </p>
          </div>
          {/^\/campaign\/[0-9a-f-]{36}$/i.test(
            new URLSearchParams(window.location.search).get("next") ?? "",
          ) && (
            <a
              className="account-home-return"
              href={
                new URLSearchParams(window.location.search).get("next") ??
                "/account"
              }
            >
              Открыть запрошенную кампанию →
            </a>
          )}
          {capabilities.localAccounts && (
            <p className="muted">
              Сервер доступен только на этом компьютере. Подключение из
              локальной сети пока не включено.
            </p>
          )}
          {error && (
            <p role="alert" className="account-auth-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {firstRun && (
            <section aria-labelledby="first-run-title">
              <h2 id="first-run-title">
                {firstRun.role === "GM"
                  ? "Ваша первая сцена готова"
                  : "Вы в кампании"}
              </h2>
              <p>Игровая система — Аркен-Хар.</p>
              <ol>
                {firstRun.role === "GM" ? (
                  <>
                    <li>
                      Создайте ссылку-приглашение в карточке этой кампании ниже
                      и отправьте её игроку лично.
                    </li>
                    <li>
                      Откройте игровой стол: первая пустая сцена уже создана.
                    </li>
                    <li>
                      Откройте «Персонажи», чтобы подготовить участников игры.
                      Игрок может создать свой лист самостоятельно.
                    </li>
                  </>
                ) : (
                  <>
                    <li>Откройте игровой стол этой кампании.</li>
                    <li>
                      Откройте «Персонажи» и выберите «Создать персонажа», если
                      мастер ещё не выдал вам лист.
                    </li>
                    <li>
                      Заполните лист по договорённости с мастером и переходите к
                      игре.
                    </li>
                  </>
                )}
              </ol>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void selectCampaign(firstRun.campaignId)}
              >
                Открыть игровой стол
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setFirstRun(null)}
              >
                Скрыть подсказки
              </Button>
            </section>
          )}
          <section
            className="account-campaigns"
            aria-labelledby="campaigns-title"
          >
            <h2 id="campaigns-title">Мои кампании</h2>
            {campaignsState === "loading" && (
              <p role="status">Загружаем кампании…</p>
            )}
            {campaignsState === "error" && (
              <div role="alert">
                <p>
                  Не удалось загрузить кампании. Это не означает, что у вас нет
                  доступа.
                </p>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void refreshCampaigns().catch((reason: unknown) =>
                      setError(
                        friendlyError(reason, capabilities.localAccounts),
                      ),
                    );
                  }}
                >
                  Повторить загрузку
                </Button>
              </div>
            )}
            {campaignsState === "ready" && campaigns.length === 0 && (
              <p>
                {capabilities.campaignCreationEnabled
                  ? "Пока нет кампаний. Создайте свою или примите приглашение мастера."
                  : "Пока нет кампаний. Примите приглашение мастера; создание новых кампаний сейчас выключено."}
              </p>
            )}
            <ul>
              {campaigns.map((campaign) => (
                <li key={campaign.id}>
                  <div className="account-campaign-heading">
                    <span
                      className="account-campaign-symbol"
                      aria-hidden="true"
                    >
                      ✦
                    </span>
                    <div>
                      <span className="account-campaign-role">
                        {campaign.role === "GM" ? "Мастер" : "Игрок"}
                      </span>
                      <strong>{campaign.name}</strong>
                    </div>
                  </div>
                  <Button
                    type="button"
                    view="action"
                    disabled={busy}
                    onClick={() => void selectCampaign(campaign.id)}
                  >
                    {campaign.selected
                      ? "Открыть кампанию"
                      : "Войти в кампанию"}
                  </Button>
                  {campaign.role === "GM" && (
                    <details className="account-campaign-invite">
                      <summary>Пригласить игрока</summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void makeInvite(campaign.id);
                        }}
                      >
                        <label>
                          Приглашение игроку
                          <FormInput
                            value={inviteLabel}
                            onChange={(event) =>
                              setInviteLabel(event.target.value)
                            }
                            maxLength={80}
                            placeholder="Имя или метка игрока"
                          />
                        </label>
                        <Button
                          type="submit"
                          disabled={
                            busy || inviteAttemptsSnapshot.has(campaign.id)
                          }
                        >
                          Создать ссылку-приглашение
                        </Button>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            {capabilities.campaignCreationEnabled && (
              <details className="account-home-disclosure">
                <summary>Создать кампанию</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createCampaign();
                  }}
                  aria-label="Создать кампанию"
                >
                  <label>
                    Новая кампания
                    <FormInput
                      value={pendingCreateSnapshot?.name ?? campaignName}
                      onChange={(event) => setCampaignName(event.target.value)}
                      disabled={Boolean(pendingCreateSnapshot)}
                      required
                      maxLength={80}
                    />
                  </label>
                  <p className="account-auth-note">
                    Аркен-Хар. Вы станете мастером; первая пустая сцена появится
                    автоматически. Игроков можно пригласить после создания.
                  </p>
                  <Button
                    type="submit"
                    disabled={
                      busy || (!campaignName.trim() && !pendingCreateSnapshot)
                    }
                  >
                    {pendingCreateSnapshot
                      ? "Повторить создание"
                      : "Создать кампанию"}
                  </Button>
                </form>
              </details>
            )}
            {!capabilities.campaignCreationEnabled && (
              <p className="account-auth-note">
                Создание кампаний сейчас недоступно.
              </p>
            )}
            {inviteUrl && (
              <p role="status" className="account-invite-link">
                Ссылка для игрока (действует до 72 часов):{" "}
                <a href={inviteUrl}>{inviteUrl}</a>
              </p>
            )}
            <details className="account-home-disclosure">
              <summary>Присоединиться по приглашению</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void claimInvite(session);
                }}
                aria-label="Принять приглашение"
              >
                <label>
                  Ссылка-приглашение
                  <FormInput
                    value={inviteTokenInput}
                    onChange={(event) =>
                      setInviteTokenInput(event.target.value)
                    }
                    placeholder="Вставьте код или ссылку приглашения"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={busy || !inviteTokenInput.trim()}
                >
                  Присоединиться к кампании
                </Button>
              </form>
            </details>
          </section>
          <details className="account-home-disclosure">
            <summary>Изменить пароль</summary>
            <form
              onSubmit={submit}
              aria-label="Изменить пароль"
              aria-busy={busy}
            >
              <label>
                Текущий пароль
                <FormInput
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </label>
              <label>
                Новый пароль
                <FormInput
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD}
                  maxLength={128}
                />
              </label>
              <label>
                Повторите новый пароль
                <FormInput
                  type="password"
                  autoComplete="new-password"
                  value={passwordAgain}
                  onChange={(e) => setPasswordAgain(e.target.value)}
                  required
                  minLength={MIN_PASSWORD}
                  maxLength={128}
                />
              </label>
              <Button
                type="submit"
                view="action"
                disabled={busy}
                loading={busy}
              >
                Сохранить пароль
              </Button>
            </form>
          </details>
          <Button
            type="button"
            view="flat-secondary"
            disabled={busy}
            onClick={() => void logout()}
          >
            Выйти из аккаунта
          </Button>
        </section>
      </main>
    );

  if (view === "join") {
    return (
      <main className="account-auth-shell">
        <section className="account-auth-card">
          <p className="account-auth-kicker">Приглашение в кампанию</p>
          <h1>Присоединиться</h1>
          {session ? (
            <p>
              {session.account.email ?? session.account.login} ·{" "}
              {session.account.identityKind === "LOCAL"
                ? "локальный аккаунт"
                : "подтверждённый аккаунт"}
            </p>
          ) : (
            <p>Войдите в подтверждённый аккаунт, чтобы принять приглашение.</p>
          )}
          {!session && (
            <>
              <label>
                {capabilities.localAccounts
                  ? "Локальный логин"
                  : "Логин или email"}
                <FormInput
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Пароль
                <FormInput
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
            </>
          )}
          {!token && (
            <label>
              Код приглашения
              <FormInput
                value={inviteTokenInput}
                onChange={(event) => setInviteTokenInput(event.target.value)}
                required
              />
            </label>
          )}
          {error && (
            <p role="alert" className="account-auth-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <Button
            type="button"
            disabled={
              busy ||
              claimPendingSnapshot ||
              (!token && !inviteTokenInput.trim())
            }
            onClick={() => void acceptJoinInvite()}
          >
            Принять приглашение
          </Button>
          {!session && capabilities.registrationEnabled && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setPassword("");
                setView("register");
                setNotice(
                  "После регистрации подтвердите почту. Затем вернитесь в эту вкладку или снова откройте исходное приглашение мастера. Ссылка не сохраняется в браузере.",
                );
              }}
            >
              Нет аккаунта? Зарегистрироваться
            </Button>
          )}
          <a href="/">Вернуться ко входу</a>
        </section>
      </main>
    );
  }

  const title =
    view === "register"
      ? "Создать аккаунт"
      : view === "verify"
        ? "Подтвердить email"
        : view === "reset-request"
          ? "Восстановить пароль"
          : view === "reset-confirm"
            ? "Задать новый пароль"
            : "Войти в аккаунт";
  return (
    <main className="account-auth-shell">
      <section className="account-auth-card" aria-labelledby="account-title">
        <a
          className="account-auth-brand"
          href="/"
          aria-label="Аркспейс — на главную"
        >
          <Brand />
        </a>
        <p className="account-auth-kicker">Безопасный вход</p>
        <h1 id="account-title">{title}</h1>
        {capabilities.localAccounts && (
          <p className="muted">
            Локальный вход на этом компьютере, без email. Первый аккаунт мастера
            создаётся в окне «Arken Space — локальный сервер».
          </p>
        )}
        <form onSubmit={submit} aria-label={title} aria-busy={busy}>
          {view !== "verify" && (
            <label>
              {capabilities.localAccounts
                ? "Локальный логин"
                : view === "login"
                  ? "Логин или email"
                  : "Email"}
              <FormInput
                type={
                  capabilities.localAccounts || view === "login"
                    ? "text"
                    : "email"
                }
                autoComplete={
                  capabilities.localAccounts || view === "login"
                    ? "username"
                    : "email"
                }
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                readOnly={view === "reset-confirm"}
              />
            </label>
          )}
          {(view === "login" ||
            view === "register" ||
            view === "reset-confirm") && (
            <label>
              {view === "login" ? "Пароль" : "Пароль (не менее 12 символов)"}
              <FormInput
                type="password"
                autoComplete={
                  view === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={view === "login" ? undefined : MIN_PASSWORD}
                maxLength={128}
              />
            </label>
          )}
          {(view === "register" || view === "reset-confirm") && (
            <label>
              Повторите пароль
              <FormInput
                type="password"
                autoComplete="new-password"
                value={passwordAgain}
                onChange={(e) => setPasswordAgain(e.target.value)}
                required
                minLength={MIN_PASSWORD}
                maxLength={128}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="account-auth-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <Button
            type="submit"
            view="action"
            disabled={
              busy ||
              ((view === "verify" || view === "reset-confirm") && !token)
            }
            loading={busy}
          >
            {view === "register"
              ? "Зарегистрироваться"
              : view === "verify"
                ? "Подтвердить email"
                : view === "reset-request"
                  ? "Отправить инструкцию"
                  : view === "reset-confirm"
                    ? "Сохранить новый пароль"
                    : "Войти"}
          </Button>
        </form>
        <nav className="account-auth-links" aria-label="Действия аккаунта">
          {view !== "login" && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setNotice("");
                setView("login");
              }}
            >
              Войти
            </button>
          )}
          {capabilities.registrationEnabled && view !== "register" && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setNotice("");
                setView("register");
              }}
            >
              Создать аккаунт
            </button>
          )}
          {!capabilities.localAccounts &&
            view !== "reset-request" &&
            view !== "reset-confirm" && (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setView("reset-request");
                }}
              >
                Забыли пароль?
              </button>
            )}
          {view === "verify" && (
            <button type="button" disabled={busy} onClick={() => void resend()}>
              Отправить письмо повторно
            </button>
          )}
          {view === "login" && (
            <button
              type="button"
              disabled={busy || !email.trim()}
              onClick={() => void resend()}
            >
              Отправить письмо для подтверждения
            </button>
          )}
        </nav>
      </section>
    </main>
  );
}
