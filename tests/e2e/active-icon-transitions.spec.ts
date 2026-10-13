import { expect, test } from "@playwright/test";
import { settleActiveIconTransitions } from "./helpers/active-icon-transitions";

test("active settling waits delayed ancestor and pseudo paint but skips idle declaration", async ({
  page,
}) => {
  await page.setContent(
    `<style>body{margin:0}.owner{color:black;transition:color .15s linear .08s}button{width:40px;height:40px;position:relative}button::before{content:"";position:absolute;inset:0;background:black;transition:background-color .15s linear .08s}.owner.on{color:white}.owner.on button::before{background:white}</style><div class="owner"><button aria-label="sample"><svg width="16" height="16"></svg></button></div>`,
  );
  const control = page.getByRole("button");
  await settleActiveIconTransitions(control);
  await page.locator(".owner").evaluate((node) => node.classList.add("on"));
  await settleActiveIconTransitions(control);
  const paint = await control.evaluate((node) => ({
    ancestor: getComputedStyle(node.parentElement!).color,
    pseudo: getComputedStyle(node, "::before").backgroundColor,
    running: [
      ...node.getAnimations(),
      ...node.parentElement!.getAnimations(),
    ].filter((a) => a.playState === "running").length,
  }));
  expect(paint).toEqual({
    ancestor: "rgb(255, 255, 255)",
    pseudo: "rgb(255, 255, 255)",
    running: 0,
  });
  await control.evaluate((node) => {
    node.style.transition = "color 2s";
  });
  await expect(settleActiveIconTransitions(control)).rejects.toThrow(
    "Long transition",
  );
});

test("settling rescans cancelled transitions and fails closed for paused transitions", async ({
  page,
}) => {
  await page.setContent(
    `<style>button{color:black;transition:color .25s linear}button.on{color:white}</style><button>sample</button>`,
  );
  const control = page.getByRole("button");
  await control.evaluate((node) => {
    void getComputedStyle(node).color;
    node.classList.add("on");
    setTimeout(() => {
      node.classList.remove("on");
    }, 50);
  });
  await settleActiveIconTransitions(control);
  expect(await control.evaluate((node) => getComputedStyle(node).color)).toBe(
    "rgb(0, 0, 0)",
  );
  await control.evaluate(async (node) => {
    node.classList.add("on");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    for (const animation of node.getAnimations()) animation.pause();
  });
  await expect(settleActiveIconTransitions(control)).rejects.toThrow(
    "did not settle",
  );
});
