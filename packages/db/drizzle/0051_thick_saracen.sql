ALTER TABLE "sessions" ADD COLUMN "auth_source" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "gm_credential_campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "gm_credential_revision" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "player_access_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "player_access_grant_revision" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "legacy_invite_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_gm_credential_campaign_id_gm_access_credentials_campaign_id_fk" FOREIGN KEY ("gm_credential_campaign_id") REFERENCES "public"."gm_access_credentials"("campaign_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_access_grant_id_player_access_grants_id_fk" FOREIGN KEY ("player_access_grant_id") REFERENCES "public"."player_access_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_legacy_invite_id_invites_id_fk" FOREIGN KEY ("legacy_invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_player_grant_idx" ON "sessions" USING btree ("player_access_grant_id");--> statement-breakpoint
CREATE INDEX "sessions_legacy_invite_idx" ON "sessions" USING btree ("legacy_invite_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_auth_source_check" CHECK (COALESCE((
      ("sessions"."auth_source" is null and "sessions"."account_session_id" is null and "sessions"."gm_credential_campaign_id" is null and "sessions"."gm_credential_revision" is null and "sessions"."player_access_grant_id" is null and "sessions"."player_access_grant_revision" is null and "sessions"."legacy_invite_id" is null)
      or ("sessions"."auth_source" = 'ACCOUNT' and "sessions"."account_session_id" is not null and "sessions"."gm_credential_campaign_id" is null and "sessions"."gm_credential_revision" is null and "sessions"."player_access_grant_id" is null and "sessions"."player_access_grant_revision" is null and "sessions"."legacy_invite_id" is null)
      or ("sessions"."auth_source" = 'GM_LINK' and "sessions"."account_session_id" is null and "sessions"."gm_credential_campaign_id" is not null and "sessions"."gm_credential_revision" is not null and "sessions"."player_access_grant_id" is null and "sessions"."player_access_grant_revision" is null and "sessions"."legacy_invite_id" is null)
      or ("sessions"."auth_source" = 'PLAYER_GRANT' and "sessions"."account_session_id" is null and "sessions"."gm_credential_campaign_id" is null and "sessions"."gm_credential_revision" is null and "sessions"."player_access_grant_id" is not null and "sessions"."player_access_grant_revision" is not null and "sessions"."legacy_invite_id" is null)
      or ("sessions"."auth_source" = 'LEGACY_INVITE' and "sessions"."account_session_id" is null and "sessions"."gm_credential_campaign_id" is null and "sessions"."gm_credential_revision" is null and "sessions"."player_access_grant_id" is null and "sessions"."player_access_grant_revision" is null and "sessions"."legacy_invite_id" is not null)
    ), false));
