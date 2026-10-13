import { expect, test } from "./campaign-fixture";
test("owned chat preparation rejects unknown token and invalid count before writing", async ({
  gmToken,
  seedChatHistory,
}) => {
  await expect(seedChatHistory("not-owned-ci-token", 40)).rejects.toThrow(
    "owned campaigns",
  );
  await expect(seedChatHistory(gmToken, 101)).rejects.toThrow(
    "Invalid history count",
  );
  await seedChatHistory(gmToken, 40);
});
