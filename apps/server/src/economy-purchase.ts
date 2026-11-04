import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  characters,
  chatMessages,
  chatThreads,
  economyPurchases,
  economyQuotes,
  worldContentInstances,
  worldContentInstanceActions,
} from "@arken/db";
import {
  economyQuoteCommandSchema,
  type EconomyQuoteDto,
  type EconomyReceiptDto,
} from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { debitCoins } from "./economy-math.js";
import {
  loadPriceState,
  lockEconomy,
  lockEconomyAction,
  recordEconomyAction,
  type Database,
} from "./economy-state.js";

export async function quoteEconomy(
  db: Database,
  auth: AuthContext,
  command: { characterId: string; offerId: string; quantity: number },
): Promise<EconomyQuoteDto> {
  return db.transaction(async (tx) => {
    const locked = await lockEconomy(tx, auth);
    const state = await loadPriceState(tx, auth, locked, command);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 120_000);
    const view: EconomyQuoteDto = {
      id,
      ...command,
      itemName: state.instance.displayNameOverride ?? state.item.name,
      merchantName: state.merchant.name,
      totalCopper: state.totalCopper,
      expiresAt: expiresAt.toISOString(),
      date: state.date,
      affordable: state.affordable,
      rounding: "CEIL_ONCE_TO_COPPER",
    };
    await tx
      .insert(economyQuotes)
      .values({
        id,
        campaignId: auth.campaignId,
        actorMembershipId: auth.membershipId,
        characterId: command.characterId,
        offerId: command.offerId,
        inputHash: state.inputHash,
        inputs: state.inputs,
        view,
        expiresAt,
      });
    return view;
  });
}

export async function purchaseEconomy(
  db: Database,
  auth: AuthContext,
  command: { actionId: string; quoteId: string },
): Promise<EconomyReceiptDto> {
  return db.transaction(async (tx) => {
    const action = await lockEconomyAction(
      tx,
      auth,
      command.actionId,
      "economy.purchase",
      command,
    );
    const locked = await lockEconomy(tx, auth, action.duplicate);
    // Receipt replay is an actor-owned historical record, not a new charge. It
    // survives expiry, disabling shops, archiving the character and changed prices.
    if (action.duplicate) {
      const [old] = await tx
        .select()
        .from(economyPurchases)
        .where(
          and(
            eq(economyPurchases.campaignId, auth.campaignId),
            eq(economyPurchases.actionId, command.actionId),
            eq(economyPurchases.actorMembershipId, auth.membershipId),
            eq(economyPurchases.quoteId, command.quoteId),
          ),
        )
        .limit(1);
      if (!old) throw new Error("ECONOMY_RECEIPT_UNAVAILABLE");
      return old.receipt as EconomyReceiptDto;
    }
    const [quote] = await tx
      .select()
      .from(economyQuotes)
      .where(
        and(
          eq(economyQuotes.id, command.quoteId),
          eq(economyQuotes.campaignId, auth.campaignId),
          eq(economyQuotes.actorMembershipId, auth.membershipId),
        ),
      )
      .limit(1)
      .for("update");
    if (!quote) throw new Error("ECONOMY_QUOTE_UNAVAILABLE");
    const [used] = await tx
      .select()
      .from(economyPurchases)
      .where(eq(economyPurchases.quoteId, quote.id))
      .limit(1);
    if (used) throw new Error("ECONOMY_QUOTE_USED");
    if (quote.expiresAt.getTime() <= Date.now())
      throw new Error("ECONOMY_QUOTE_EXPIRED");
    const view = quote.view as EconomyQuoteDto;
    const request = economyQuoteCommandSchema.parse({
      characterId: quote.characterId,
      offerId: quote.offerId,
      quantity: view.quantity,
    });
    const state = await loadPriceState(tx, auth, locked, request);
    if (quote.inputHash !== state.inputHash)
      throw new Error("ECONOMY_QUOTE_STALE");
    if (quote.expiresAt.getTime() <= Date.now())
      throw new Error("ECONOMY_QUOTE_EXPIRED");
    const wallet = debitCoins(state.character.wallet, state.totalCopper);
    await tx
      .update(characters)
      .set({
        wallet,
        revision: state.character.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characters.id, state.character.id),
          eq(characters.campaignId, auth.campaignId),
        ),
      );
    await tx
      .update(worldContentInstances)
      .set({
        quantity: state.instance.quantity! - request.quantity,
        revision: state.instance.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(worldContentInstances.id, state.instance.id));
    // A new inventory stack carries only the sold public identity/condition.
    // No GM state, portrait, location, container or previous owner is copied.
    const [inventory] = await tx
      .insert(worldContentInstances)
      .values({
        campaignId: auth.campaignId,
        worldContentId: state.item.id,
        displayNameOverride: state.instance.displayNameOverride,
        condition: state.instance.condition,
        quantity: request.quantity,
        inventoryCharacterId: state.character.id,
        discovered: true,
      })
      .returning();
    if (!inventory) throw new Error("ECONOMY_RECEIPT_UNAVAILABLE");
    const receipt: EconomyReceiptDto = {
      actionId: command.actionId,
      quoteId: quote.id,
      characterId: state.character.id,
      itemName: view.itemName,
      merchantName: view.merchantName,
      quantity: request.quantity,
      totalCopper: state.totalCopper,
      inventoryInstanceId: inventory.id,
      purchasedAt: new Date().toISOString(),
      date: state.date,
    };
    await tx
      .insert(economyPurchases)
      .values({
        campaignId: auth.campaignId,
        actionId: command.actionId,
        actorMembershipId: auth.membershipId,
        quoteId: quote.id,
        receipt,
      });
    await tx
      .insert(worldContentInstanceActions)
      .values({
        campaignId: auth.campaignId,
        actionId: command.actionId,
        type: "economy.purchase",
        entityType: "world_content_instance",
        entityId: inventory.id,
        entityRevision: inventory.revision,
        actorMembershipId: auth.membershipId,
        payload: {
          requestHash: action.hash,
          sourceInstanceId: state.instance.id,
          sourceRevision: state.instance.revision + 1,
          quantity: request.quantity,
        },
      });
    await tx
      .insert(chatThreads)
      .values({ campaignId: auth.campaignId, stream: "TABLE", type: "STREAM" })
      .onConflictDoNothing({
        target: [chatThreads.campaignId, chatThreads.stream],
      });
    const [thread] = await tx
      .select()
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.campaignId, auth.campaignId),
          eq(chatThreads.stream, "TABLE"),
        ),
      )
      .limit(1);
    if (!thread) throw new Error("ECONOMY_RECEIPT_UNAVAILABLE");
    await tx
      .insert(chatMessages)
      .values({
        campaignId: auth.campaignId,
        membershipId: auth.membershipId,
        characterId: state.character.id,
        threadId: thread.id,
        kind: "SYSTEM",
        visibility: "GM_ONLY",
        body: `${state.character.name}: ${view.itemName} × ${request.quantity}, ${state.totalCopper} медных. Магазин: ${view.merchantName}.`,
      });
    await recordEconomyAction(
      tx,
      auth,
      command.actionId,
      "economy.purchase",
      action.hash,
      inventory.id,
      inventory.revision,
    );
    return receipt;
  });
}
