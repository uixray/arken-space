import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

async function migratedDatabase() {
  const database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

const campaignA = "81000000-0000-4000-8000-000000000001";
const campaignB = "82000000-0000-4000-8000-000000000001";
const memberA = "81000000-0000-4000-8000-000000000002";
const memberB = "81000000-0000-4000-8000-000000000003";
const foreign = "82000000-0000-4000-8000-000000000002";

describe("0018 direct chat migration", () => {
  it("enforces canonical pairs, fixed stream shapes, tenant FKs and staged attachment claims", async () => {
    const db = await migratedDatabase();
    await db.exec(
      `insert into campaigns(id,name) values ('${campaignA}','A'),('${campaignB}','B'); insert into memberships(id,campaign_id,role,display_name) values ('${memberA}','${campaignA}','PLAYER','A'),('${memberB}','${campaignA}','PLAYER','B'),('${foreign}','${campaignB}','PLAYER','F');`,
    );
    await db.exec(
      `insert into chat_threads(campaign_id,type,stream,participant_a_membership_id,participant_b_membership_id) values ('${campaignA}','DIRECT',null,'${memberA}','${memberB}')`,
    );
    await expect(
      db.exec(
        `insert into chat_threads(campaign_id,type,stream,participant_a_membership_id,participant_b_membership_id) values ('${campaignA}','DIRECT',null,'${memberA}','${memberB}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into chat_threads(campaign_id,type,stream,participant_a_membership_id,participant_b_membership_id) values ('${campaignA}','DIRECT',null,'${memberB}','${memberA}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into chat_threads(campaign_id,type,stream,participant_a_membership_id,participant_b_membership_id) values ('${campaignA}','DIRECT',null,'${memberA}','${foreign}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into chat_threads(campaign_id,type,stream) values ('${campaignA}','STREAM',null)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into chat_threads(campaign_id,type,stream,participant_a_membership_id,participant_b_membership_id) values ('${campaignA}','DIRECT','TABLE','${memberA}','${memberB}')`,
      ),
    ).rejects.toThrow();

    const thread = (
      await db.query<{ id: string }>(
        `select id from chat_threads where campaign_id='${campaignA}' and type='DIRECT'`,
      )
    ).rows[0]!.id;
    const message = "81000000-0000-4000-8000-000000000009";
    await db.exec(
      `insert into chat_messages(id,campaign_id,membership_id,thread_id,body) values ('${message}','${campaignA}','${memberA}','${thread}','secret')`,
    );
    const content = "81000000-0000-4000-8000-000000000010";
    await db.exec(
      `insert into chat_attachment_uploads(content_id,campaign_id,uploaded_by_membership_id,file_name,storage_key,mime_type,size_bytes,width,height,expires_at) values ('${content}','${campaignA}','${memberA}','secret.png','private/${message}','image/png',12,10,20,now()+interval '1 hour')`,
    );
    await db.exec(
      `insert into chat_attachments(content_id,campaign_id,thread_id,message_id) values ('${content}','${campaignA}','${thread}','${message}')`,
    );
    await db.exec(
      `update chat_attachment_uploads set status='CLAIMED' where content_id='${content}'`,
    );
    await expect(
      db.exec(
        `insert into chat_attachments(content_id,campaign_id,thread_id,message_id) values ('${content}','${campaignB}','${thread}','${message}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into chat_attachment_uploads(campaign_id,uploaded_by_membership_id,file_name,storage_key,mime_type,size_bytes,width,expires_at) values ('${campaignA}','${memberA}','empty.png','private/empty','image/png',0,-1,now()+interval '1 hour')`,
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("preserves existing fixed streams and creates exactly three STREAM rows for later campaigns", async () => {
    const db = new PGlite();
    const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
    const files = (await readdir(migrationsUrl))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files.filter((name) => name < "0018_")) {
      await db.exec(
        (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    }
    const existing = "83000000-0000-4000-8000-000000000001";
    await db.exec(
      `insert into campaigns(id,name) values ('${existing}','Existing')`,
    );
    const before = await db.query<{ id: string; stream: string }>(
      `select id,stream from chat_threads where campaign_id='${existing}' order by stream`,
    );
    await db.exec(
      (
        await readFile(new URL("0018_direct_chat.sql", migrationsUrl), "utf8")
      ).replaceAll("--> statement-breakpoint", ""),
    );
    const after = await db.query<{ id: string; stream: string; type: string }>(
      `select id,stream,type from chat_threads where campaign_id='${existing}' order by stream`,
    );
    expect(after.rows.map(({ id, stream }) => ({ id, stream }))).toEqual(
      before.rows,
    );
    expect(after.rows).toHaveLength(3);
    expect(after.rows.every((row) => row.type === "STREAM")).toBe(true);

    const later = "84000000-0000-4000-8000-000000000001";
    await db.exec(`insert into campaigns(id,name) values ('${later}','Later')`);
    const created = await db.query<{ stream: string; type: string }>(
      `select stream,type from chat_threads where campaign_id='${later}' order by stream`,
    );
    expect(created.rows).toEqual([
      { stream: "ROLLS", type: "STREAM" },
      { stream: "STORY", type: "STREAM" },
      { stream: "TABLE", type: "STREAM" },
    ]);
    await db.close();
  });
});
