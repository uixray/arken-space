/** Every workshop table is campaign-scoped. Keep immutable versions, approval
 * decisions, authors, purchase receipts and licence beneficiaries unchanged;
 * transferring a campaign must never mint a licence for its GM. */
export const creationTransferTables=[
 "creation_actions","creation_licences","creation_listing_versions","creation_listings",
 "creation_object_edges","creation_objects","creation_operation_quotes","creation_operations",
 "creation_purchases","creation_recipe_versions","creation_recipes","creation_reviews",
 "creation_rule_packs","creation_rule_versions","creation_store_policies","creation_store_quotes",
 "creation_template_origins","creation_template_versions","creation_templates",
] as const;
export type CreationTransferTable=typeof creationTransferTables[number];
export const nonReplayableQuoteTables=["creation_operation_quotes","creation_store_quotes","economy_quotes"] as const;
export type NonReplayableQuoteTable=typeof nonReplayableQuoteTables[number];
