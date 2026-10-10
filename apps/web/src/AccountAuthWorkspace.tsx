import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccountCapabilities, AccountSession } from "@arken/contracts";
import { Button } from "./design-system/Button";
import { FormInput } from "./ui/GravityFormControls";
import { ApiError } from "./api";
import {
  changeAccountPassword, confirmPasswordReset, confirmVerification,
  consumeActionToken, getAccountSession, loginAccount, logoutAccount,
  registerAccount, requestPasswordReset, requestVerification,
} from "./account-auth-client";
import { claimAccountCampaignInvite, createAccountCampaign, createAccountCampaignInvite, listAccountCampaigns, selectAccountCampaign, type AccountCampaign } from "./account-campaign-client";
import "./account-auth.css";

type View = "login" | "register" | "verify" | "reset-request" | "reset-confirm" | "account" | "join";
const MIN_PASSWORD = 12;
class LocalValidationError extends Error {}

function friendlyError(reason: unknown) {
  if (reason instanceof LocalValidationError) return reason.message;
  if (!(reason instanceof ApiError)) return "Не удалось выполнить запрос. Повторите попытку.";
  switch (reason.code) {
    case "INVALID_CREDENTIALS": return "Проверьте email и пароль. Возможно, адрес ещё не подтверждён.";
    case "PASSWORD_POLICY_REJECTED": return "Пароль должен содержать от 12 до 128 символов.";
    case "ACCOUNT_DELIVERY_UNAVAILABLE": return "Письма сейчас недоступны. Попробуйте позже.";
    case "ACCOUNT_REGISTRATION_DISABLED": return "Регистрация аккаунтов временно выключена.";
    case "ACCOUNT_RATE_LIMITED": return "Слишком много попыток. Подождите и повторите.";
    case "INVALID_OR_EXPIRED_ACCOUNT_TOKEN": return "Ссылка истекла или уже использована. Запросите новую.";
    case "CURRENT_PASSWORD_INVALID": return "Текущий пароль не подходит.";
    case "CAMPAIGN_CREATION_DISABLED": return "Создание кампаний сейчас выключено.";
    case "CAMPAIGN_CREATION_LIMIT_REACHED": return "Достигнут лимит кампаний для аккаунта.";
    case "CAMPAIGN_NOT_FOUND": return "Кампания недоступна для этого аккаунта.";
    case "INVITE_INVALID_OR_EXPIRED": return "Приглашение истекло или уже использовано.";
    case "ACCOUNT_ALREADY_IN_CAMPAIGN": return "Этот аккаунт уже состоит в кампании.";
    default: return "Не удалось выполнить запрос. Проверьте данные и повторите попытку.";
  }
}

export function AccountAuthWorkspace({ onAuthenticated, capabilities }: { onAuthenticated: () => void; capabilities: AccountCapabilities }) {
  const path = window.location.pathname;
  // StrictMode replays effects in development. Keep the route's action-token
  // intent and one-time consumption across that setup/cleanup/setup cycle.
  const actionFlow = useRef(path === "/account/verify" || path === "/account/reset-password" || path === "/account/join");
  const actionTokenConsumed = useRef(false);
  const [view, setView] = useState<View>(path === "/account/verify" ? "verify" : path === "/account/reset-password" ? "reset-confirm" : path === "/account/join" ? "join" : "login");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [session, setSession] = useState<AccountSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [campaigns, setCampaigns] = useState<AccountCampaign[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteTokenInput, setInviteTokenInput] = useState("");
  const pendingCreate = useRef<{ name: string; key: string } | null>(null);
  const claimPending = useRef(false);
  const inviteAttempts = useRef(new Set<string>());

  const refreshCampaigns = async () => {
    const result = await listAccountCampaigns();
    setCampaigns(Array.isArray(result.campaigns) ? result.campaigns : []);
  };
  const readInviteToken = (suppliedToken = token) => {
    const raw = (suppliedToken || inviteTokenInput).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) {
      try {
        const link = new URL(raw);
        if (link.origin !== window.location.origin || link.pathname !== "/account/join") return "";
        return new URLSearchParams(link.hash.slice(1)).get("token") ?? "";
      } catch { return ""; }
    }
    return /^[A-Za-z0-9_-]{40,64}$/.test(raw) ? raw : "";
  };
  const claimInvite = async (active: AccountSession, suppliedToken = token) => {
    if (claimPending.current) return;
    claimPending.current = true; setBusy(true); setError("");
    try {
      const claimToken = readInviteToken(suppliedToken);
      if (!claimToken) throw new LocalValidationError("Вставьте действительную ссылку-приглашение или откройте её из сообщения.");
      await claimAccountCampaignInvite(claimToken, active.csrfToken);
      setToken(""); setInviteTokenInput("");
      await refreshCampaigns();
      setView("account"); setNotice("Вы присоединились к кампании. Выберите её, чтобы открыть игровой стол.");
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      claimPending.current = false; setBusy(false);
    }
  };
  const acceptJoinInvite = async () => {
    if (busy || claimPending.current) return;
    if (session) { await claimInvite(session); return; }
    setBusy(true); setError("");
    try {
      const next = await loginAccount(email, password);
      setSession(next);
      await claimInvite(next);
    } catch (reason) {
      setError(friendlyError(reason));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if ((!actionFlow.current && view !== "verify" && view !== "reset-confirm") || actionTokenConsumed.current) return;
    actionTokenConsumed.current = true;
    const consumed = consumeActionToken(window.location, (url) => window.history.replaceState({}, "", url));
    if (!consumed) setError("В ссылке нет кода подтверждения. Запросите письмо ещё раз.");
    setToken(consumed ?? "");
  }, [view]);
  useEffect(() => {
    let active = true;
    void getAccountSession().then((value) => {
      if (active && value.authenticated) {
        setSession(value); setEmail(value.account.email);
        if (!actionFlow.current) setView("account");
      }
    }).catch((reason: unknown) => {
      if (active && (!(reason instanceof ApiError) || reason.status !== 404)) setError(friendlyError(reason));
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session) return;
    void refreshCampaigns().catch((reason: unknown) => setError(friendlyError(reason)));
  }, [session?.account.id]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (view === "register") {
        if (password !== passwordAgain) throw new LocalValidationError("Пароли не совпадают.");
        if ([...password].length < MIN_PASSWORD || [...password].length > 128) throw new LocalValidationError("Пароль должен содержать от 12 до 128 символов.");
        await registerAccount(email, password);
        setPassword(""); setPasswordAgain(""); setView("login");
        setNotice("Если адрес можно зарегистрировать, запрос на подтверждение принят. Проверьте почту позже.");
      } else if (view === "login") {
        const next = await loginAccount(email, password); setSession(next); setPassword("");
        if (actionFlow.current && token) await claimInvite(next);
        else setView("account");
      } else if (view === "join") {
        if (!session) throw new LocalValidationError("Войдите в подтверждённый аккаунт, чтобы принять приглашение.");
        await claimInvite(session);
      } else if (view === "verify") {
        if (!token) throw new LocalValidationError("В ссылке нет кода подтверждения.");
        await confirmVerification(token); setToken(""); setView("login");
        setNotice("Email подтверждён. Теперь войдите в аккаунт.");
      } else if (view === "reset-request") {
        await requestPasswordReset(email); setNotice("Если аккаунт существует, запрос принят. Проверьте почту позже.");
      } else if (view === "reset-confirm") {
        if (!token) throw new LocalValidationError("В ссылке нет кода сброса.");
        if (password !== passwordAgain) throw new LocalValidationError("Пароли не совпадают.");
        if ([...password].length < MIN_PASSWORD || [...password].length > 128) throw new LocalValidationError("Пароль должен содержать от 12 до 128 символов.");
        await confirmPasswordReset(token, password); setToken(""); setPassword(""); setPasswordAgain(""); setView("login");
        setNotice("Пароль изменён. Войдите с новым паролем.");
      } else if (view === "account" && session) {
        if (password !== passwordAgain) throw new LocalValidationError("Пароли не совпадают.");
        if ([...password].length < MIN_PASSWORD || [...password].length > 128) throw new LocalValidationError("Пароль должен содержать от 12 до 128 символов.");
        await changeAccountPassword(currentPassword, password, session.csrfToken);
        setSession(null); setPassword(""); setPasswordAgain(""); setCurrentPassword(""); setView("login");
        setNotice("Пароль изменён. Войдите снова.");
      }
    } catch (reason) {
      setError(friendlyError(reason));
    } finally { setBusy(false); }
  };

  const createCampaign = async () => {
    if (!session || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!pendingCreate.current) pendingCreate.current = { name: campaignName.trim(), key: crypto.randomUUID() };
      const pending = pendingCreate.current;
      const result = await createAccountCampaign(pending.name, pending.key, session.csrfToken);
      pendingCreate.current = null; setCampaignName("");
      setCampaigns((current) => [
        ...current.filter((campaign) => campaign.id !== result.campaignId),
        { id: result.campaignId, name: result.name, role: "GM", membershipId: result.membershipId, selected: true },
      ]);
      setNotice(`Кампания «${result.name}» создана.`);
      void refreshCampaigns().catch((reason: unknown) => setError(friendlyError(reason)));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) pendingCreate.current = null;
      setError(friendlyError(reason));
    }
    finally { setBusy(false); }
  };
  const selectCampaign = async (campaignId: string) => {
    if (!session || busy) return;
    setBusy(true); setError("");
    try { await selectAccountCampaign(campaignId, session.csrfToken); onAuthenticated(); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  const makeInvite = async (campaignId: string) => {
    if (!session || busy) return;
    if (inviteAttempts.current.has(campaignId)) {
      setError("Результат запроса приглашения неизвестен. Чтобы не создать дубликат, повтор не отправлен; обновите страницу перед новой попыткой.");
      return;
    }
    setBusy(true); setError(""); setInviteUrl("");
    inviteAttempts.current.add(campaignId);
    try {
      const invite = await createAccountCampaignInvite(campaignId, inviteLabel || "Игрок", session.csrfToken);
      setInviteLabel("");
      setInviteUrl(`${window.location.origin}/account/join#token=${encodeURIComponent(invite.token)}`);
      inviteAttempts.current.delete(campaignId);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status >= 400 && reason.status < 500) inviteAttempts.current.delete(campaignId);
      setError(`${friendlyError(reason)} ${reason instanceof ApiError && reason.status < 500 ? "Запрос отклонён; после исправления можно попробовать снова." : "Результат запроса неизвестен. Автоматический повтор отключён, чтобы не создавать дубликат."}`);
    }
    finally { setBusy(false); }
  };

  const resend = async () => {
    if (!email || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await requestVerification(email); setNotice("Если аккаунту требуется подтверждение, запрос принят. Проверьте почту позже."); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await logoutAccount(session?.csrfToken); setSession(null); onAuthenticated(); }
    catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  };

  if (view === "account" && session) return <main className="account-auth-shell"><section className="account-auth-card" aria-labelledby="account-title">
    <p className="account-auth-kicker">Аккаунт Arken</p><h1 id="account-title">Почта подтверждена</h1><p className="account-auth-email">{session.account.email}</p>
    <p className="account-auth-note">Вход в аккаунт не назначает роль и не открывает чужую кампанию. Доступ появляется только после явного выбора или принятия приглашения.</p>
    <section className="account-campaigns" aria-labelledby="campaigns-title">
      <h2 id="campaigns-title">Мои кампании</h2>
      {campaigns.length === 0 && <p>Пока нет кампаний. Создайте свою или примите приглашение мастера.</p>}
      <ul>{campaigns.map((campaign) => <li key={campaign.id}>
        <strong>{campaign.name}</strong><span>{campaign.role === "GM" ? "Мастер" : "Игрок"}</span>
        <Button type="button" disabled={busy} onClick={() => void selectCampaign(campaign.id)}>{campaign.selected ? "Открыть кампанию" : "Выбрать"}</Button>
        {campaign.role === "GM" && <form onSubmit={(event) => { event.preventDefault(); void makeInvite(campaign.id); }}><label>Приглашение игроку<FormInput value={inviteLabel} onChange={(event) => setInviteLabel(event.target.value)} maxLength={80} placeholder="Имя или метка игрока" /></label><Button type="submit" disabled={busy || inviteAttempts.current.has(campaign.id)}>Создать ссылку-приглашение</Button></form>}
      </li>)}</ul>
      {capabilities.campaignCreationEnabled && <form onSubmit={(event) => { event.preventDefault(); void createCampaign(); }} aria-label="Создать кампанию"><label>Новая кампания<FormInput value={pendingCreate.current?.name ?? campaignName} onChange={(event) => setCampaignName(event.target.value)} disabled={Boolean(pendingCreate.current)} required maxLength={80} /></label><Button type="submit" disabled={busy || !campaignName.trim() && !pendingCreate.current}>{pendingCreate.current ? "Повторить создание" : "Создать кампанию"}</Button></form>}
      {!capabilities.campaignCreationEnabled && <p className="account-auth-note">Создание кампаний сейчас недоступно.</p>}
      {inviteUrl && <p role="status" className="account-invite-link">Ссылка для игрока (действует до 72 часов): <a href={inviteUrl}>{inviteUrl}</a></p>}
      <form onSubmit={(event) => { event.preventDefault(); void claimInvite(session); }} aria-label="Принять приглашение"><label>Ссылка-приглашение<FormInput value={inviteTokenInput} onChange={(event) => setInviteTokenInput(event.target.value)} placeholder="Вставьте код или ссылку приглашения" /></label><Button type="submit" disabled={busy || !inviteTokenInput.trim()}>Присоединиться к кампании</Button></form>
    </section>
    <form onSubmit={submit} aria-label="Изменить пароль" aria-busy={busy}><h2>Изменить пароль</h2>
      <label>Текущий пароль<FormInput type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
      <label>Новый пароль<FormInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_PASSWORD} maxLength={128} /></label>
      <label>Повторите новый пароль<FormInput type="password" autoComplete="new-password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} required minLength={MIN_PASSWORD} maxLength={128} /></label>
      {error && <p role="alert" className="account-auth-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <Button type="submit" view="action" disabled={busy} loading={busy}>Сохранить пароль</Button>
      <Button type="button" disabled={busy} onClick={() => void logout()}>Выйти из аккаунта</Button>
    </form>
  </section></main>;

  if (view === "join") {
    return <main className="account-auth-shell"><section className="account-auth-card"><p className="account-auth-kicker">Приглашение в кампанию</p><h1>Присоединиться</h1>
      {session ? <p>{session.account.email} · подтверждённый аккаунт</p> : <p>Войдите в подтверждённый аккаунт, чтобы принять приглашение.</p>}
      {!session && <><label>Email<FormInput type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Пароль<FormInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label></>}
      {!token && <label>Код приглашения<FormInput value={inviteTokenInput} onChange={(event) => setInviteTokenInput(event.target.value)} required /></label>}
      {error && <p role="alert" className="account-auth-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <Button type="button" disabled={busy || claimPending.current || (!token && !inviteTokenInput.trim())} onClick={() => void acceptJoinInvite()}>Принять приглашение</Button>
      <a href="/">Вернуться ко входу</a>
    </section></main>;
  }

  const title = view === "register" ? "Создать аккаунт" : view === "verify" ? "Подтвердить email" : view === "reset-request" ? "Восстановить пароль" : view === "reset-confirm" ? "Задать новый пароль" : "Войти в аккаунт";
  return <main className="account-auth-shell"><section className="account-auth-card" aria-labelledby="account-title">
    <a className="account-auth-brand" href="/">arken-space</a><p className="account-auth-kicker">Безопасный вход</p><h1 id="account-title">{title}</h1>
    <form onSubmit={submit} aria-label={title} aria-busy={busy}>
      {view !== "verify" && <label>Email<FormInput type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} readOnly={view === "reset-confirm"} /></label>}
      {(view === "login" || view === "register" || view === "reset-confirm") && <label>{view === "login" ? "Пароль" : "Пароль (не менее 12 символов)"}<FormInput type="password" autoComplete={view === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={view === "login" ? undefined : MIN_PASSWORD} maxLength={128} /></label>}
      {(view === "register" || view === "reset-confirm") && <label>Повторите пароль<FormInput type="password" autoComplete="new-password" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} required minLength={MIN_PASSWORD} maxLength={128} /></label>}
      {error && <p role="alert" className="account-auth-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      <Button type="submit" view="action" disabled={busy || ((view === "verify" || view === "reset-confirm") && !token)} loading={busy}>{view === "register" ? "Зарегистрироваться" : view === "verify" ? "Подтвердить email" : view === "reset-request" ? "Отправить инструкцию" : view === "reset-confirm" ? "Сохранить новый пароль" : "Войти"}</Button>
    </form>
    <nav className="account-auth-links" aria-label="Действия аккаунта">
      {view !== "login" && <button type="button" onClick={() => { setError(""); setNotice(""); setView("login"); }}>Войти</button>}
      {capabilities.registrationEnabled && view !== "register" && <button type="button" onClick={() => { setError(""); setNotice(""); setView("register"); }}>Создать аккаунт</button>}
      {view !== "reset-request" && view !== "reset-confirm" && <button type="button" onClick={() => { setError(""); setNotice(""); setView("reset-request"); }}>Забыли пароль?</button>}
      {view === "verify" && <button type="button" disabled={busy} onClick={() => void resend()}>Отправить письмо повторно</button>}
      {view === "login" && <button type="button" disabled={busy || !email.trim()} onClick={() => void resend()}>Отправить письмо для подтверждения</button>}
    </nav>
  </section></main>;
}
