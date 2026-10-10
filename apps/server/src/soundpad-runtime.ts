type Command = { campaignId: string; membershipId: string; soundId: string; actionId: string };
type Accepted = { status: "ACCEPTED" | "DUPLICATE" | "CONFLICT" | "COOLDOWN" | "RATE_LIMIT" };

export function soundpadEventRoom(campaignId: string, visibility: "ALL_MEMBERS" | "GM_ONLY") {
  return visibility === "GM_ONLY" ? `campaign:${campaignId}:gm` : `campaign:${campaignId}`;
}

export function soundpadGenerationIsCurrent(current: number, captured: number) {
  return current === captured;
}

/** Process-local abuse/idempotency guard for ephemeral effects (not a multi-replica guarantee). */
export function createSoundpadRuntime(now: () => number = Date.now) {
  const actions = new Map<string, { fingerprint: string; expiresAt: number }>();
  const lastMember = new Map<string, number>();
  const lastMemberSound = new Map<string, number>();
  const campaignEvents = new Map<string, number[]>();
  const stopGeneration = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();

  async function serialize<T>(campaignId: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(campaignId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    queues.set(campaignId, queued);
    await previous;
    try { return await work(); }
    finally { release(); if (queues.get(campaignId) === queued) queues.delete(campaignId); }
  }

  return {
    accept(command: Command): Promise<Accepted> {
      return serialize(command.campaignId, async () => {
        const time = now();
        for (const [key, item] of actions) if (item.expiresAt <= time) actions.delete(key);
        for (const [key, at] of lastMember) if (at <= time - 2000) lastMember.delete(key);
        for (const [key, at] of lastMemberSound) if (at <= time - 2000) lastMemberSound.delete(key);
        for (const [key, events] of campaignEvents) {
          const active = events.filter((at) => at > time - 1000);
          if (active.length) campaignEvents.set(key, active); else campaignEvents.delete(key);
        }
        const key = `${command.campaignId}:${command.membershipId}:${command.actionId}`;
        const fingerprint = command.soundId;
        const existing = actions.get(key);
        if (existing) return { status: existing.fingerprint === fingerprint ? "DUPLICATE" : "CONFLICT" };
        const campaign = campaignEvents.get(command.campaignId) ?? [];
        const recent = campaign.filter((at) => at > time - 1000);
        campaignEvents.set(command.campaignId, recent);
        const memberKey = `${command.campaignId}:${command.membershipId}`;
        const memberSoundKey = `${memberKey}:${command.soundId}`;
        if ((lastMember.get(memberKey) ?? 0) > time - 2000 || (lastMemberSound.get(memberSoundKey) ?? 0) > time - 2000)
          return { status: "COOLDOWN" };
        if (recent.length >= 4) return { status: "RATE_LIMIT" };
        if (actions.size >= 10_000) {
          const oldest = actions.keys().next().value as string | undefined;
          if (oldest) actions.delete(oldest);
        }
        actions.set(key, { fingerprint, expiresAt: time + 60_000 });
        campaign.push(time);
        campaignEvents.set(command.campaignId, campaign);
        lastMember.set(memberKey, time);
        lastMemberSound.set(memberSoundKey, time);
        return { status: "ACCEPTED" };
      });
    },
    stop(campaignId: string) {
      const next = (stopGeneration.get(campaignId) ?? 0) + 1;
      stopGeneration.set(campaignId, next);
      return next;
    },
    generation(campaignId: string) { return stopGeneration.get(campaignId) ?? 0; },
  };
}
