import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthContext } from "./auth.js";
import {
  confirmEditorChange,
  EditorConflict,
  previewEditorChange,
  previewEditorRestore,
  type EditorTransaction,
} from "./editor-change.js";

const targetSchema = z
  .object({
    kind: z.enum(["character-stat", "skill", "material"]),
    id: z.string().uuid(),
  })
  .strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();
const draftSchema = z
  .object({
    target: targetSchema,
    revision: z.number().int().nonnegative().max(2147483646),
    values: z.record(
      z.string().min(1).max(100),
      z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();

type Actor = AuthContext;
type Target = z.infer<typeof targetSchema>;
type Values = z.infer<typeof draftSchema>["values"];

interface Options {
  approvalOrigin: string;
  // The two capabilities must use distinct credentials. Only the human
  // session may confirm, with normal session, origin and CSRF checks.
  authorize(
    request: FastifyRequest,
    capability: "prepare" | "confirm",
  ): Promise<Actor | null>;
  transaction<T>(
    actor: Actor,
    fn: (tx: EditorTransaction) => Promise<T>,
  ): Promise<T>;
  validate(target: Target, values: Values): boolean;
  history(actor: Actor, target: Target): Promise<unknown>;
  search(actor: Actor, kind: Target["kind"], query: string): Promise<unknown>;
}

export function registerEditorChangeRoutes(
  app: FastifyInstance,
  options: Options,
) {
  const withApproval = <
    T extends { id: string; target: { campaignId: string } },
  >(
    draft: T,
  ) => ({
    ...draft,
    approvalUrl: new URL(
      `/campaign/${draft.target.campaignId}?editor-pilot=${draft.id}`,
      options.approvalOrigin,
    ).href,
  });
  async function handle(
    request: FastifyRequest,
    reply: FastifyReply,
    capability: "prepare" | "confirm",
    run: (actor: Actor) => Promise<unknown>,
  ) {
    const actor = await options.authorize(request, capability);
    if (!actor) return reply.code(403).send({ error: "EDITOR_ACCESS_DENIED" });
    try {
      return await run(actor);
    } catch (error) {
      if (error instanceof EditorConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  }

  app.post("/api/editor/changes", { bodyLimit: 32_768 }, (request, reply) =>
    handle(request, reply, "prepare", async (actor) => {
      const body = draftSchema.safeParse(request.body);
      if (
        !body.success ||
        !options.validate(body.data.target, body.data.values)
      ) {
        return reply.code(400).send({ error: "EDITOR_INVALID_PATCH" });
      }
      const { target, revision, values } = body.data;
      return withApproval(
        await options.transaction(actor, (tx) =>
          previewEditorChange(
            tx,
            { ...target, campaignId: actor.campaignId },
            actor.membershipId,
            revision,
            values,
          ),
        ),
      );
    }),
  );
  app.post("/api/editor/changes/:id/confirm", (request, reply) =>
    handle(request, reply, "confirm", async (actor) => {
      const id = idSchema.safeParse(request.params);
      if (!id.success)
        return reply.code(400).send({ error: "EDITOR_INVALID_ID" });
      return options.transaction(actor, (tx) =>
        confirmEditorChange(
          tx,
          actor.campaignId,
          id.data.id,
          actor.membershipId,
        ),
      );
    }),
  );
  app.post("/api/editor/changes/:id/restore-preview", (request, reply) =>
    handle(request, reply, "prepare", async (actor) => {
      const id = idSchema.safeParse(request.params);
      if (!id.success)
        return reply.code(400).send({ error: "EDITOR_INVALID_ID" });
      return withApproval(
        await options.transaction(actor, (tx) =>
          previewEditorRestore(
            tx,
            actor.campaignId,
            id.data.id,
            actor.membershipId,
          ),
        ),
      );
    }),
  );
  app.get("/api/editor/changes/:id", (request, reply) =>
    handle(request, reply, "prepare", async (actor) => {
      const id = idSchema.safeParse(request.params);
      if (!id.success)
        return reply.code(400).send({ error: "EDITOR_INVALID_ID" });
      const draft = await options.transaction(actor, (tx) =>
        tx.lockDraft(actor.campaignId, id.data.id),
      );
      if (!draft || draft.authorId !== actor.membershipId)
        return reply.code(404).send({ error: "EDITOR_DRAFT_NOT_FOUND" });
      return draft;
    }),
  );
  app.get("/api/editor/target", (request, reply) =>
    handle(request, reply, "prepare", async (actor) => {
      const target = targetSchema.safeParse(request.query);
      if (!target.success)
        return reply.code(400).send({ error: "EDITOR_INVALID_TARGET" });
      const result = await options.transaction(actor, (tx) =>
        tx.read({ ...target.data, campaignId: actor.campaignId }),
      );
      return (
        result ?? reply.code(404).send({ error: "EDITOR_TARGET_NOT_FOUND" })
      );
    }),
  );
  app.get("/api/editor/search", (request, reply) =>
    handle(request, reply, "prepare", async (actor) => {
      const search = targetSchema
        .pick({ kind: true })
        .extend({ q: z.string().trim().min(1).max(100) })
        .safeParse(request.query);
      if (!search.success)
        return reply.code(400).send({ error: "EDITOR_INVALID_SEARCH" });
      return options.search(actor, search.data.kind, search.data.q);
    }),
  );
  app.get("/api/editor/history", (request, reply) =>
    handle(request, reply, "prepare", async (actor) => {
      const target = targetSchema.safeParse(request.query);
      if (!target.success)
        return reply.code(400).send({ error: "EDITOR_INVALID_TARGET" });
      return options.history(actor, target.data);
    }),
  );
}
