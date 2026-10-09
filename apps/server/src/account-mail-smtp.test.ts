import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createTlsServer, type TLSSocket } from "node:tls";
import { createServer as createTcpServer, type Socket } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createAccountMailSmtpAdapter, parseAccountMailSmtpConfig, type AccountMailSmtpConfig } from "./account-mail-smtp.js";
import { createAccountMailContext } from "./account-mail-context.js";

const openssl = process.env.OPENSSL_BIN ?? (process.platform === "win32"
  ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
  : "openssl");
const dataDirectory = mkdtempSync(join(tmpdir(), "arken-smtp-fake-"));
const keyPath = join(dataDirectory, "key.pem");
const certPath = join(dataDirectory, "cert.pem");
const syntheticMessageId = "c6d0feaa-0a7d-4b6e-9677-d6cd98f44711";

type FakeSmtpOptions = { rcptCode?: 250 | 450 | 550; pauseAfterData?: boolean; dropAfterData?: boolean };
function createFakeSmtp(options: FakeSmtpOptions = {}) {
  const acceptedMessages: string[] = [];
  const liveSockets = new Set<TLSSocket>();
  let closedResolve: (() => void) | undefined;
  const onClosed = new Promise<void>((resolve) => { closedResolve = resolve; });
  let dataSeenResolve: (() => void) | undefined;
  const dataSeen = new Promise<void>((resolve) => { dataSeenResolve = resolve; });
  const server = createTlsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (socket) => {
    liveSockets.add(socket);
    socket.once("close", () => {
      liveSockets.delete(socket);
      if (liveSockets.size === 0) closedResolve?.();
    });
    let buffer = "";
    let state: "commands" | "auth-user" | "auth-pass" | "data" = "commands";
    let currentMessage = "";
    socket.write("220 fake.local ESMTP ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (state === "data") {
          if (line === ".") {
            acceptedMessages.push(currentMessage);
            currentMessage = "";
            dataSeenResolve?.();
            if (options.dropAfterData) socket.destroy();
            else if (!options.pauseAfterData) socket.write("250 accepted\r\n");
          } else currentMessage += `${line}\r\n`;
          continue;
        }
        const command = line.toUpperCase();
        if (command.startsWith("EHLO ") || command.startsWith("HELO ")) {
          socket.write("250-fake.local\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (command.startsWith("AUTH PLAIN ")) socket.write("235 authenticated\r\n");
        else if (command === "AUTH PLAIN") socket.write("334 \r\n");
        else if (command === "AUTH LOGIN") { state = "auth-user"; socket.write("334 VXNlcm5hbWU6\r\n"); }
        else if (state === "auth-user") { state = "auth-pass"; socket.write("334 UGFzc3dvcmQ6\r\n"); }
        else if (state === "auth-pass") { state = "commands"; socket.write("235 authenticated\r\n"); }
        else if (command.startsWith("MAIL FROM:")) socket.write("250 sender accepted\r\n");
        else if (command.startsWith("RCPT TO:")) {
          const code = options.rcptCode ?? 250;
          socket.write(`${code} ${code === 250 ? "recipient accepted" : "synthetic rejection"}\r\n`);
        } else if (command === "DATA") { state = "data"; socket.write("354 send data\r\n"); }
        else if (command === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
        else if (command.startsWith("RSET")) socket.write("250 reset\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  return {
    server,
    acceptedMessages,
    dataSeen,
    onClosed,
    liveSockets,
    async listen() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return (server.address() as { port: number }).port;
    },
    async close() {
      for (const socket of liveSockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

function config(port: number, ca?: string): AccountMailSmtpConfig {
  return {
    host: "localhost",
    port,
    username: "synthetic-user",
    password: "synthetic-password",
    from: "noreply@example.test",
    connectTimeoutMs: 800,
    greetingTimeoutMs: 800,
    socketTimeoutMs: 1_200,
    ...(ca ? { tlsCa: ca } : {}),
  };
}

const sampleMessage = { to: "person@example.test", subject: "Verify synthetic account", text: "Synthetic action link: https://example.test/verify#not-a-secret" };

beforeAll(() => {
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
}, 20_000);
afterAll(() => rmSync(dataDirectory, { recursive: true, force: true }));

describe("account SMTP adapter", () => {
  it("is disabled with absent config and rejects partial, malformed, or header-injecting config", () => {
    expect(createAccountMailSmtpAdapter(parseAccountMailSmtpConfig({})).ready).toBe(false);
    const fullLikeEnvironment = {
      ACCOUNT_MAIL_SMTP_HOST: "",
      ACCOUNT_MAIL_SMTP_PORT: "",
      ACCOUNT_MAIL_SMTP_USERNAME: "",
      ACCOUNT_MAIL_SMTP_PASSWORD: "",
      ACCOUNT_MAIL_SMTP_FROM: "",
      ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS: "",
      ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS: "",
      ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS: "",
      DATABASE_URL: "postgres://synthetic.invalid/db",
      ACCOUNT_MAIL_RUNTIME_ENABLED: true,
      OTHER_RUNTIME_SETTING: "enabled",
    };
    expect(parseAccountMailSmtpConfig(fullLikeEnvironment)).toBeNull();
    expect(() => parseAccountMailSmtpConfig({ ACCOUNT_MAIL_SMTP_HOST: "smtp.example.test" })).toThrow("MAIL_SMTP_CONFIG_INVALID");
    expect(() => parseAccountMailSmtpConfig({ ACCOUNT_MAIL_SMTP_HOST: "smtp.example.test\r\nX: y" })).toThrow("MAIL_SMTP_CONFIG_INVALID");
    expect(() => parseAccountMailSmtpConfig({
      ACCOUNT_MAIL_SMTP_HOST: "smtp.example.test", ACCOUNT_MAIL_SMTP_USERNAME: "user",
      ACCOUNT_MAIL_SMTP_PASSWORD: "pass", ACCOUNT_MAIL_SMTP_FROM: "sender@example.test\r\nBcc:x@example.test",
    })).toThrow("MAIL_SMTP_CONFIG_INVALID");
  });

  it("shares explicit runtime readiness and a single constructed adapter/keyring context", () => {
    const context = createAccountMailContext({
      ACCOUNT_MAIL_RUNTIME_ENABLED: false,
      ACCOUNT_MAIL_ACTIVE_KEY_ID: "",
      ACCOUNT_MAIL_KEYRING: "",
      ACCOUNT_MAIL_SMTP_HOST: "smtp.example.test",
      ACCOUNT_MAIL_SMTP_USERNAME: "synthetic-user",
      ACCOUNT_MAIL_SMTP_PASSWORD: "synthetic-password",
      ACCOUNT_MAIL_SMTP_FROM: "noreply@example.test",
    });
    expect(context.runtimeEnabled).toBe(false);
    expect(context.adapter.ready).toBe(true);
    expect(context.keyring).toBeNull();
  });

  it.each([false, true])("keeps blank SMTP unconfigured with a full environment (runtime=%s)", (runtimeEnabled) => {
    const fullLikeEnvironment = {
      ACCOUNT_MAIL_RUNTIME_ENABLED: runtimeEnabled,
      ACCOUNT_MAIL_ACTIVE_KEY_ID: "",
      ACCOUNT_MAIL_KEYRING: "",
      ACCOUNT_MAIL_SMTP_HOST: "",
      ACCOUNT_MAIL_SMTP_PORT: "",
      ACCOUNT_MAIL_SMTP_USERNAME: "",
      ACCOUNT_MAIL_SMTP_PASSWORD: "",
      ACCOUNT_MAIL_SMTP_FROM: "",
      ACCOUNT_MAIL_SMTP_CONNECT_TIMEOUT_MS: "",
      ACCOUNT_MAIL_SMTP_GREETING_TIMEOUT_MS: "",
      ACCOUNT_MAIL_SMTP_SOCKET_TIMEOUT_MS: "",
      DATABASE_URL: "postgres://synthetic.invalid/db",
      NODE_ENV: "production",
    };
    const context = createAccountMailContext(fullLikeEnvironment);
    expect(context.runtimeEnabled).toBe(runtimeEnabled);
    expect(context.adapter.ready).toBe(false);
    expect(context.keyring).toBeNull();
  });

  it("uses verified TLS, authenticates through Nodemailer, and preserves the queue Message-ID", async () => {
    const smtp = createFakeSmtp();
    const port = await smtp.listen();
    try {
      const adapter = createAccountMailSmtpAdapter(config(port, readFileSync(certPath, "utf8")));
      await adapter.send(sampleMessage, { messageId: syntheticMessageId });
      expect(smtp.acceptedMessages).toHaveLength(1);
      expect(smtp.acceptedMessages[0]).toMatch(new RegExp(`^Message-ID: <${syntheticMessageId}@arken\\.invalid>$`, "mi"));
      await Promise.race([smtp.onClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("successful TLS socket not closed")), 1_000))]);
      expect(smtp.liveSockets.size).toBe(0);
    } finally { await smtp.close(); }
  });

  it("rejects an untrusted certificate and a hostname mismatch", async () => {
    const smtp = createFakeSmtp();
    const port = await smtp.listen();
    try {
      const noTrust = createAccountMailSmtpAdapter(config(port));
      await expect(noTrust.send(sampleMessage, { messageId: syntheticMessageId })).rejects.toMatchObject({ category: "SMTP_TLS" });
      const wrongHost = createAccountMailSmtpAdapter({ ...config(port, readFileSync(certPath, "utf8")), host: "127.0.0.1" });
      await expect(wrongHost.send(sampleMessage, { messageId: syntheticMessageId })).rejects.toMatchObject({ category: "SMTP_TLS" });
    } finally { await smtp.close(); }
  });

  it("settles its own pre-TLS connect deadline and closes the stalled socket", async () => {
    let acceptedSocket: Socket | undefined;
    const server = createTcpServer((socket) => {
      acceptedSocket = socket;
      // Deliberately speak no TLS and send no SMTP greeting.
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const port = (server.address() as { port: number }).port;
      let clientSocket: TLSSocket | undefined;
      let clientClosed: Promise<unknown> | undefined;
      const adapter = createAccountMailSmtpAdapter({ ...config(port), host: "127.0.0.1", connectTimeoutMs: 200, onSocketCreated: (socket) => { clientSocket = socket; clientClosed = once(socket, "close"); } });
      await expect(adapter.send(sampleMessage, { messageId: syntheticMessageId }))
        .rejects.toMatchObject({ category: "SMTP_TIMEOUT" });
      expect(clientSocket?.destroyed).toBe(true);
      expect(acceptedSocket).toBeDefined();
      await clientClosed;
    } finally {
      acceptedSocket?.destroy();
      server.close();
      await once(server, "close");
    }
  });

  it("classifies synthetic SMTP 4xx as retryable and 5xx as permanent", async () => {
    for (const [code, category] of [[450, "SMTP_TRANSIENT"], [550, "SMTP_PERMANENT"]] as const) {
      const smtp = createFakeSmtp({ rcptCode: code });
      const port = await smtp.listen();
      try {
        const adapter = createAccountMailSmtpAdapter(config(port, readFileSync(certPath, "utf8")));
        await expect(adapter.send(sampleMessage, { messageId: syntheticMessageId })).rejects.toMatchObject({ category });
      } finally { await smtp.close(); }
    }
  });

  it("marks a disconnect after DATA as ambiguous/retryable while reusing the stable Message-ID", async () => {
    const smtp = createFakeSmtp({ dropAfterData: true });
    const port = await smtp.listen();
    try {
      const adapter = createAccountMailSmtpAdapter(config(port, readFileSync(certPath, "utf8")));
      await expect(adapter.send(sampleMessage, { messageId: syntheticMessageId })).rejects.toMatchObject({ category: "SMTP_TRANSIENT" });
      expect(smtp.acceptedMessages).toHaveLength(1);
      expect(smtp.acceptedMessages[0]).toMatch(new RegExp(`^Message-ID: <${syntheticMessageId}@arken\\.invalid>$`, "mi"));
    } finally { await smtp.close(); }
  });

  it("aborts an in-flight DATA exchange by closing the actual TLS socket", async () => {
    const smtp = createFakeSmtp({ pauseAfterData: true });
    const port = await smtp.listen();
    const controller = new AbortController();
    try {
      const adapter = createAccountMailSmtpAdapter(config(port, readFileSync(certPath, "utf8")));
      const sending = adapter.send(sampleMessage, { messageId: syntheticMessageId, signal: controller.signal });
      await Promise.race([smtp.dataSeen, new Promise((_, reject) => setTimeout(() => reject(new Error("fake SMTP DATA not reached")), 3_000))]);
      controller.abort();
      await expect(sending).rejects.toMatchObject({ category: "SMTP_ABORTED" });
      await Promise.race([smtp.onClosed, new Promise((_, reject) => setTimeout(() => reject(new Error("TLS socket not closed")), 1_000))]);
      expect(smtp.liveSockets.size).toBe(0);
    } finally { await smtp.close(); }
  });
});
