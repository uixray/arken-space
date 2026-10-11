import type { MailAdapter, MailKeyring } from "./account-mail.js";
import { parseMailKeyringConfig } from "./account-mail.js";
import { createAccountMailSmtpAdapter, parseAccountMailSmtpConfig, type AccountMailSmtpEnvironment } from "./account-mail-smtp.js";

export type AccountMailContext = Readonly<{
  runtimeEnabled: boolean;
  adapter: MailAdapter;
  keyring: MailKeyring | null;
}>;

export type AccountMailContextEnvironment = AccountMailSmtpEnvironment & {
  ACCOUNT_MAIL_RUNTIME_ENABLED: boolean;
  ACCOUNT_MAIL_ACTIVE_KEY_ID: string;
  ACCOUNT_MAIL_KEYRING: string;
};

/** Construct one immutable adapter/keyring/readiness context for routes and scheduler. */
export function createAccountMailContext(source: AccountMailContextEnvironment, options: { tlsCa?: string } = {}): AccountMailContext {
  const smtpConfig = parseAccountMailSmtpConfig(source);
  const keyring = parseMailKeyringConfig(source.ACCOUNT_MAIL_ACTIVE_KEY_ID, source.ACCOUNT_MAIL_KEYRING);
  return Object.freeze({
    runtimeEnabled: source.ACCOUNT_MAIL_RUNTIME_ENABLED,
    adapter: createAccountMailSmtpAdapter(smtpConfig && options.tlsCa ? { ...smtpConfig, tlsCa: options.tlsCa } : smtpConfig),
    keyring,
  });
}
