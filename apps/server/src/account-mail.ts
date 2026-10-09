export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

export interface MailAdapter {
  readonly ready: boolean;
  send(message: OutboundMail): Promise<void>;
}

/** Explicit fail-closed adapter until a reviewed/configured SMTP provider exists. */
export const unconfiguredMailAdapter: MailAdapter = {
  ready: false,
  async send() {
    throw new Error("MAIL_ADAPTER_NOT_CONFIGURED");
  },
};

/** Test-only in-memory delivery sink; intentionally has no logger or console output. */
export function createTestMailOutbox() {
  const deliveries: OutboundMail[] = [];
  const adapter: MailAdapter = {
    ready: true,
    async send(message) {
      deliveries.push({ ...message });
    },
  };
  return {
    adapter,
    read(): readonly OutboundMail[] {
      return deliveries.map((delivery) => ({ ...delivery }));
    },
    clear(): void {
      deliveries.length = 0;
    },
  };
}
