import type { TokenDto } from "@arken/contracts";
import { expect, it } from "vitest";
import { mergeTokenPlacementUpdate } from "./token-projection";

it("retains projected controllers and conditions after a raw token resize", () => {
  const previous = {
    id: "token",
    width: 60,
    height: 60,
    revision: 2,
    controllerMembershipIds: ["player"],
    conditions: ["BLINDED"],
  } as unknown as TokenDto;
  const resizedRow = { id: "token", width: 90, height: 90, revision: 3 };
  expect(mergeTokenPlacementUpdate(previous, resizedRow)).toMatchObject({
    width: 90,
    height: 90,
    revision: 3,
    controllerMembershipIds: ["player"],
    conditions: ["BLINDED"],
  });
});
