import { describe, expect, it } from "vitest";
import { orderCampaignScenes } from "./scene-order";

describe("shared natural scene order", () => {
  it.each([undefined, "ordinary-campaign", "eb6a82cc-bcac-464a-a0b1-d3a3b1955c3d"])("sorts every campaign without mutating its snapshot: %s", (campaign) => {
    const scenes = [{name:"Сцена 10"}, {name:"Сцена 2"}, {name:"Сцена 1"}];
    const result = orderCampaignScenes(scenes, campaign);
    expect(result.map(scene => scene.name)).toEqual(["Сцена 1", "Сцена 2", "Сцена 10"]);
    expect(scenes.map(scene => scene.name)).toEqual(["Сцена 10", "Сцена 2", "Сцена 1"]);
    expect(result).not.toBe(scenes);
    expect(result[0]).toBe(scenes[2]);
  });
});
