CREATE TABLE creation_store_policies (
 campaign_id uuid PRIMARY KEY CONSTRAINT "creation_store_policies_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE, revision integer NOT NULL,
 policy jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_store_policy_revision CHECK(revision>=0)
);
--> statement-breakpoint
CREATE TABLE creation_listings (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_listings_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 author_membership_id uuid NOT NULL, enabled boolean NOT NULL, blocked_by_gm boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0,
 sold_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_listing_author_fk FOREIGN KEY(campaign_id,author_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_listing_shape CHECK(revision>=0 AND sold_count BETWEEN 0 AND 1000000 AND NOT (enabled AND blocked_by_gm))
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_listings_campaign_id_unique ON creation_listings(campaign_id,id);
--> statement-breakpoint
CREATE INDEX creation_listings_author_idx ON creation_listings(campaign_id,author_membership_id,id);
--> statement-breakpoint
CREATE TABLE creation_listing_versions (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL, listing_id uuid NOT NULL, template_version_id uuid NOT NULL,
 number integer NOT NULL, source jsonb NOT NULL, source_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_listing_version_listing_fk FOREIGN KEY(campaign_id,listing_id) REFERENCES creation_listings(campaign_id,id) ON DELETE CASCADE,
 CONSTRAINT creation_listing_version_template_fk FOREIGN KEY(campaign_id,template_version_id) REFERENCES creation_template_versions(campaign_id,id),
 CONSTRAINT creation_listing_version_shape CHECK(number>0 AND source_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_listing_versions_campaign_id_unique ON creation_listing_versions(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_listing_versions_number_unique ON creation_listing_versions(campaign_id,listing_id,number);
--> statement-breakpoint
CREATE TABLE creation_store_quotes (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_store_quotes_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 actor_membership_id uuid NOT NULL, character_id uuid NOT NULL, listing_version_id uuid NOT NULL,
 request jsonb NOT NULL, input_hash text NOT NULL, inputs jsonb NOT NULL, view jsonb NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_store_quote_actor_fk FOREIGN KEY(campaign_id,actor_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_store_quote_character_fk FOREIGN KEY(campaign_id,character_id) REFERENCES characters(campaign_id,id),
 CONSTRAINT creation_store_quote_listing_fk FOREIGN KEY(campaign_id,listing_version_id) REFERENCES creation_listing_versions(campaign_id,id),
 CONSTRAINT creation_store_quote_hash_shape CHECK(input_hash ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_store_quotes_campaign_id_unique ON creation_store_quotes(campaign_id,id);
--> statement-breakpoint
CREATE TABLE creation_purchases (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL CONSTRAINT "creation_purchases_campaign_id_campaigns_id_fk" REFERENCES campaigns(id) ON DELETE CASCADE,
 action_id uuid NOT NULL, quote_id uuid NOT NULL, actor_membership_id uuid NOT NULL, character_id uuid NOT NULL,
 author_membership_id uuid NOT NULL, payout_character_id uuid, beneficiary_membership_id uuid,
 listing_version_id uuid NOT NULL, template_version_id uuid NOT NULL, mode text NOT NULL, output_object_id uuid,
 price_copper bigint NOT NULL, author_income_copper bigint NOT NULL, sink_copper bigint NOT NULL,
 receipt jsonb NOT NULL, provenance jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_purchase_quote_fk FOREIGN KEY(campaign_id,quote_id) REFERENCES creation_store_quotes(campaign_id,id),
 CONSTRAINT creation_purchase_actor_fk FOREIGN KEY(campaign_id,actor_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_purchase_character_fk FOREIGN KEY(campaign_id,character_id) REFERENCES characters(campaign_id,id),
 CONSTRAINT creation_purchase_author_fk FOREIGN KEY(campaign_id,author_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_purchase_payee_fk FOREIGN KEY(campaign_id,payout_character_id) REFERENCES characters(campaign_id,id),
 CONSTRAINT creation_purchase_beneficiary_fk FOREIGN KEY(campaign_id,beneficiary_membership_id) REFERENCES memberships(campaign_id,id),
 CONSTRAINT creation_purchase_listing_fk FOREIGN KEY(campaign_id,listing_version_id) REFERENCES creation_listing_versions(campaign_id,id),
 CONSTRAINT creation_purchase_template_fk FOREIGN KEY(campaign_id,template_version_id) REFERENCES creation_template_versions(campaign_id,id),
 CONSTRAINT creation_purchase_object_fk FOREIGN KEY(campaign_id,output_object_id) REFERENCES creation_objects(campaign_id,id),
 CONSTRAINT creation_purchase_shape CHECK(price_copper BETWEEN 0 AND 1000000000000 AND author_income_copper>=0 AND sink_copper>=0
  AND price_copper=author_income_copper+sink_copper AND (payout_character_id IS NOT NULL OR author_income_copper=0)
  AND ((mode='COPY' AND output_object_id IS NOT NULL AND beneficiary_membership_id IS NULL)
    OR (mode='TEMPLATE' AND output_object_id IS NULL AND beneficiary_membership_id IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_purchases_campaign_id_unique ON creation_purchases(campaign_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_purchases_grant_unique ON creation_purchases(campaign_id,id,beneficiary_membership_id,template_version_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_purchases_action_unique ON creation_purchases(campaign_id,action_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_purchases_quote_unique ON creation_purchases(quote_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_purchases_output_unique ON creation_purchases(output_object_id);
--> statement-breakpoint
CREATE INDEX creation_purchases_actor_idx ON creation_purchases(campaign_id,actor_membership_id,id);
--> statement-breakpoint
CREATE INDEX creation_purchases_author_idx ON creation_purchases(campaign_id,author_membership_id,id);
--> statement-breakpoint
CREATE TABLE creation_licences (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL, owner_membership_id uuid NOT NULL, version_id uuid NOT NULL,
 purchase_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creation_licence_purchase_fk FOREIGN KEY(campaign_id,purchase_id,owner_membership_id,version_id)
  REFERENCES creation_purchases(campaign_id,id,beneficiary_membership_id,template_version_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_licences_owner_version_unique ON creation_licences(campaign_id,owner_membership_id,version_id);
--> statement-breakpoint
CREATE UNIQUE INDEX creation_licences_purchase_unique ON creation_licences(purchase_id);
--> statement-breakpoint
CREATE INDEX creation_licences_owner_idx ON creation_licences(campaign_id,owner_membership_id,id);
--> statement-breakpoint
CREATE TRIGGER creation_listing_version_immutable BEFORE UPDATE ON creation_listing_versions FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_store_quote_immutable BEFORE UPDATE ON creation_store_quotes FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_purchase_immutable BEFORE UPDATE ON creation_purchases FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
CREATE TRIGGER creation_licence_immutable BEFORE UPDATE ON creation_licences FOR EACH ROW EXECUTE FUNCTION creation_immutable_snapshot();
--> statement-breakpoint
-- Editing a price/version never resets a listing's lifetime purchase count or author.
CREATE FUNCTION creation_listing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.campaign_id<>OLD.campaign_id OR NEW.author_membership_id<>OLD.author_membership_id
  OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
  OR NEW.sold_count<OLD.sold_count OR NEW.sold_count>OLD.sold_count+1 THEN
  RAISE EXCEPTION 'CREATION_LISTING_PROTECTED';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER creation_listing_guard_trigger BEFORE UPDATE ON creation_listings FOR EACH ROW EXECUTE FUNCTION creation_listing_guard();
