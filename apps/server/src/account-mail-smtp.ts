import { isIP } from "node:net";
import { connect as tlsConnect, type ConnectionOptions as TlsConnectionOptions } from "node:tls";
import nodemailer from "nodemailer";
import type { MailAdapter, OutboundMail } from "./account-mail.js";
import { unconfiguredMailAdapter } from "./account-mail.js";

const EMAIL = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountMailSmtpConfig = Readonly<{
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  connectTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
  /** Test/local private CA injection; never supplied by production environment parsing. */
  tlsCa?: string;
  /** Optional test observation; not configured from environment. */
  onSocketCreated?: (socket: ReturnType<typeof tlsConnect>) => void;
}>;

export type AccountMailSmtpEnvironment = Partial<Record<
  | "ACCOUNT_MAIL_SMTP_HOST"
  | "ACCOUNT_MAIL_SMTP_PORT"
  | "ACCOUNT_MAIL_SMTP_USERNAME"
  | "ACCOUNT_MAIL_SMTP_PASSWORD"
  | "ACCOUNT_MAIL_SMTP_FROM"
  | "ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS"
  | "ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS"
  | "ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS",
  string
>>;

function boundedMs(value: string | undefined, fallback: number, maximum: number) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error("MAIL_SMTP_CONFIG_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > maximum) {
    throw new Error("MAIL_SMTP_CONFIG_INVALID");
  }
  return parsed;
}

/** Parses only injected environment values; no secret values are included in errors. */
export function parseAccountMailSmtpConfig(source: AccountMailSmtpEnvironment): AccountMailSmtpConfig | null {
  const host = source.ACCOUNT_MAIL_SMTP_HOST?.trim() ?? "";
  const username = source.ACCOUNT_MAIL_SMTP_USERNAME?.trim() ?? "";
  const password = source.ACCOUNT_MAIL_SMTP_PASSWORD ?? "";
  const from = source.ACCOUNT_MAIL_SMTP_FROM?.trim() ?? "";
  const portText = source.ACCOUNT_MAIL_SMTP_PORT?.trim() ?? "";
  // The caller may pass the full process environment. Only SMTP-owned fields
  // indicate SMTP configuration; unrelated runtime/database settings must not
  // turn an otherwise disabled adapter into a partial-config error.
  const anySet = [
    source.ACCOUNT_MAIL_SMTP_HOST,
    source.ACCOUNT_MAIL_SMTP_PORT,
    source.ACCOUNT_MAIL_SMTP_USERNAME,
    source.ACCOUNT_MAIL_SMTP_PASSWORD,
    source.ACCOUNT_MAIL_SMTP_FROM,
    source.ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS,
    source.ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS,
    source.ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS,
  ].some((value) => Boolean(value));
  if (!anySet) return null;
  const hostIsDns = host.length > 0 && host.length <= 253 && (isIP(host) !== 0
    || /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host));
  const port = portText ? Number(portText) : 465;
  if (!hostIsDns || !Number.isInteger(port) || port < 1 || port > 65535
    || !username || username.length > 512 || (/[\r\n]/.test(username) || username.includes(String.fromCharCode(0)))
    || !password || password.length > 4096 || (/[\r\n]/.test(password) || password.includes(String.fromCharCode(0)))
    || !EMAIL.test(from) || from.length > 320 || (/[\r\n]/.test(from) || from.includes(String.fromCharCode(0)))) {
    throw new Error("MAIL_SMTP_CONFIG_INVALID");
  }
  const connectTimeoutMs = boundedMs(source.ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS, 2_000, 2_500);
  const greetingTimeoutMs = boundedMs(source.ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS, 2_000, 2_500);
  const socketTimeoutMs = boundedMs(source.ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS, 2_500, 2_750);
  return Object.freeze({ host, port, username, password, from, connectTimeoutMs, greetingTimeoutMs, socketTimeoutMs });
}

export class AccountMailSmtpError extends Error {
  constructor(readonly category: "SMTP_CONFIG" | "SMTP_TIMEOUT" | "SMTP_TLS" | "SMTP_TRANSIENT" | "SMTP_PERMANENT" | "SMTP_ABORTED" | "SMTP_FAILED") {
    super(`MAIL_${category}`);
    this.name = "AccountMailSmtpError";
  }
}

function classify(error: unknown, signal?: AbortSignal): AccountMailSmtpError {
  if (signal?.aborted) return new AccountMailSmtpError("SMTP_ABORTED");
  if (error instanceof AccountMailSmtpError) return error;
  const candidate = error as { code?: unknown; responseCode?: unknown; command?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const responseCode = typeof candidate?.responseCode === "number" ? candidate.responseCode : 0;
  if (code === "MAIL_ABORTED") return new AccountMailSmtpError("SMTP_ABORTED");
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "ECONNECTIONTIMEOUT") return new AccountMailSmtpError("SMTP_TIMEOUT");
  if (code === "ECONNECTION" || code === "ECONNRESET" || code === "EPIPE" || code === "EDNS") return new AccountMailSmtpError("SMTP_TRANSIENT");
  if (code === "ETLS" || code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "ERR_TLS_CERT_ALTNAME_INVALID") return new AccountMailSmtpError("SMTP_TLS");
  if (responseCode >= 400 && responseCode < 500) return new AccountMailSmtpError("SMTP_TRANSIENT");
  if (responseCode >= 500) return new AccountMailSmtpError("SMTP_PERMANENT");
  return new AccountMailSmtpError("SMTP_FAILED");
}

function validateMessage(mail: OutboundMail, messageId: string, from: string) {
  if (!MESSAGE_ID.test(messageId) || !EMAIL.test(mail.to) || mail.to.length > 320
    || (/[\r\n]/.test(mail.to) || mail.to.includes(String.fromCharCode(0))) || (/[\r\n]/.test(mail.subject) || mail.subject.includes(String.fromCharCode(0)))
    || mail.subject.length > 200 || mail.text.length > 8_192 || !EMAIL.test(from)) {
    throw new AccountMailSmtpError("SMTP_CONFIG");
  }
}

/**
 * Creates a non-pooled, implicit-TLS SMTP adapter. Nodemailer owns the SMTP
 * protocol; the socket provider only makes TLS establishment and AbortSignal
 * cancellation observable. Certificate and hostname verification are mandatory.
 */
export function createAccountMailSmtpAdapter(config: AccountMailSmtpConfig | null): MailAdapter {
  if (!config) return unconfiguredMailAdapter;
  const ready = true;
  return {
    ready,
    async send(message, options) {
      const messageId = options?.messageId ?? "";
      validateMessage(message, messageId, config.from);
      const signal = options?.signal;
      if (signal?.aborted) throw new AccountMailSmtpError("SMTP_ABORTED");

      let socket: ReturnType<typeof tlsConnect> | undefined;
      let signalAbort: (() => void) | undefined;
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: true,
        pool: false,
        auth: { user: config.username, pass: config.password },
        logger: false,
        debug: false,
        transactionLog: false,
        connectionTimeout: config.connectTimeoutMs,
        greetingTimeout: config.greetingTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
        dnsTimeout: config.connectTimeoutMs,
        tls: { rejectUnauthorized: true },
        getSocket: (_transportOptions, callback) => {
          if (signal?.aborted) {
            callback(Object.assign(new Error("aborted"), { code: "MAIL_ABORTED" }));
            return;
          }
          const tlsOptions: TlsConnectionOptions = {
            host: config.host,
            port: config.port,
            servername: isIP(config.host) ? undefined : config.host,
            rejectUnauthorized: true,
            ...(config.tlsCa ? { ca: config.tlsCa } : {}),
          };
          socket = tlsConnect(tlsOptions);
          config.onSocketCreated?.(socket);
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            socket?.destroy();
            finishError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
          }, config.connectTimeoutMs);
          const finishError = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            callback(error);
          };
          signalAbort = () => {
            if (!settled) finishError(Object.assign(new Error("aborted"), { code: "MAIL_ABORTED" }));
            socket?.destroy();
          };
          signal?.addEventListener("abort", signalAbort, { once: true });
          socket.once("secureConnect", () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            callback(null, { connection: socket, secured: true });
          });
          socket.once("error", finishError);
        },
      });

      try {
        const info = await transporter.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          messageId: `<${messageId}@arken.invalid>`,
        });
        if (info.accepted.length !== 1 || info.rejected.length !== 0) {
          const rejection = info.rejectedErrors?.[0] as { responseCode?: number } | undefined;
          throw rejection?.responseCode && rejection.responseCode < 500
            ? new AccountMailSmtpError("SMTP_TRANSIENT")
            : new AccountMailSmtpError("SMTP_PERMANENT");
        }
      } catch (error) {
        throw classify(error, signal);
      } finally {
        if (signal && signalAbort) signal.removeEventListener("abort", signalAbort);
        // Nodemailer's one-shot SMTP transport closes its SMTPConnection after
        // each send. This explicit fallback covers a socket still handshaking.
        if (socket && !socket.destroyed) socket.destroy();
      }
    },
  };
}
