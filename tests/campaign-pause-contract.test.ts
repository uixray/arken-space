import { describe, expect, it } from "vitest";
import {
  campaignPauseCommandSchema,
  campaignPauseStateSchema,
} from "../packages/contracts/src/index.js";

describe("контракт серверной паузы кампании", () => {
  it.each([true, false])("принимает желаемое состояние paused=%s", (paused) => {
    expect(
      campaignPauseCommandSchema.parse({
        actionId: crypto.randomUUID(),
        revision: 7,
        paused,
      }),
    ).toMatchObject({ paused, revision: 7 });
  });

  it("не принимает campaignId и произвольные поля от клиента", () => {
    expect(() =>
      campaignPauseCommandSchema.parse({
        actionId: crypto.randomUUID(),
        revision: 0,
        paused: true,
        campaignId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it("фиксирует безопасную форму ответа", () => {
    const campaignId = crypto.randomUUID();
    expect(
      campaignPauseStateSchema.parse({ campaignId, paused: true, revision: 1 }),
    ).toEqual({ campaignId, paused: true, revision: 1 });
    expect(() =>
      campaignPauseStateSchema.parse({
        campaignId,
        paused: true,
        revision: 1,
        secret: "не должно попасть в ответ",
      }),
    ).toThrow();
  });
});
