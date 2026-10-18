import type { Locator } from "@playwright/test";

/** Arm before sending: sample the painted canvas stack in-page, not a slow screenshot roundtrip. */
export async function observePingOverlay(
  viewport: Locator,
  center: { x: number; y: number },
  color: string,
) {
  const handle = await viewport.evaluateHandle(
    async (element, input) => {
      // Settle the explicit camera-fit and Konva batchDraw before the baseline.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const size = 96;
      const half = size / 2;
      const output = document.createElement("canvas");
      output.width = output.height = size;
      const ctx = output.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = input.color;
      ctx.fillRect(0, 0, 1, 1);
      const expected = ctx.getImageData(0, 0, 1, 1).data.slice(0, 3);
      const capture = () => {
        const bounds = element.getBoundingClientRect();
        if (
          input.center.x < half ||
          input.center.x + half > bounds.width ||
          input.center.y < half ||
          input.center.y + half > bounds.height
        )
          throw new Error("Ping sample must be inside the visible map");
        const canvases = Array.from(element.querySelectorAll("canvas"));
        if (!canvases.length) throw new Error("Map has no painted canvases");
        ctx.clearRect(0, 0, size, size);
        // Konva uses sibling, absolutely positioned canvases in DOM paint order.
        // Reject a different stacking contract instead of accepting hidden pixels.
        for (const canvas of canvases) {
          const style = getComputedStyle(canvas);
          if (
            canvas.parentElement !== canvases[0]!.parentElement ||
            !["auto", "0"].includes(style.zIndex) ||
            style.mixBlendMode !== "normal"
          )
            throw new Error("Unsupported map canvas stacking contract");
          let hidden = false;
          for (
            let node: Element | null = canvas;
            node;
            node = node.parentElement
          ) {
            const css = getComputedStyle(node);
            if (
              css.display === "none" ||
              css.visibility !== "visible" ||
              Number(css.opacity) === 0
            )
              hidden = true;
            if (node !== canvas && Number(css.opacity) !== 1 && !hidden)
              throw new Error("Unsupported grouped canvas opacity");
            if (node === element) break;
          }
          if (hidden) continue;
          const rect = canvas.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          ctx.globalAlpha = Number(style.opacity);
          // drawImage maps backing-store pixels to CSS pixels (including DPR).
          ctx.drawImage(
            canvas,
            rect.x - bounds.x - input.center.x + half,
            rect.y - bounds.y - input.center.y + half,
            rect.width,
            rect.height,
          );
        }
        ctx.globalAlpha = 1;
        return ctx.getImageData(0, 0, size, size).data;
      };
      const baseline = capture();
      const before = output.toDataURL("image/png");
      const samples: Array<{ offset: number; side: number }> = [];
      // The lower arc excludes the cursor core and the name label to the right.
      // Only opaque dark fog pixels qualify; an owned token above fog does not.
      for (let y = 12; y <= 36; y++) {
        for (let x = -36; x <= 36; x++) {
          const radius = Math.hypot(x, y);
          const offset = ((half + y) * size + half + x) * 4;
          if (radius < 12 || radius > 36 || Math.abs(x) < 4) continue;
          if (
            baseline[offset + 3] !== 255 ||
            Math.max(
              baseline[offset]!,
              baseline[offset + 1]!,
              baseline[offset + 2]!,
            ) > 45
          )
            continue;
          samples.push({ offset, side: x < 0 ? 0 : 1 });
        }
      }
      if (
        [0, 1].some(
          (side) =>
            samples.filter((sample) => sample.side === side).length < 100,
        )
      )
        throw new Error("Ping sample does not cover opaque fog on both sides");
      let frame = 0;
      let timer = 0;
      let settled = false;
      let maxMatchedPixels = 0;
      const start = performance.now();
      type Result = {
        matched: boolean;
        elapsedMs: number;
        maxMatchedPixels: number;
        before: string;
        after: string;
        error?: string;
      };
      let resolve!: (result: Result) => void;
      const result = new Promise<Result>((done) => {
        resolve = done;
      });
      const finish = (matched: boolean, error?: string) => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        resolve({
          matched,
          elapsedMs: performance.now() - start,
          maxMatchedPixels,
          before,
          after: matched ? output.toDataURL("image/png") : "",
          error,
        });
      };
      const sample = () => {
        // Never turn a delayed frame after the original deadline into a PASS.
        if (performance.now() - start >= 3_000) return finish(false);
        try {
          const current = capture();
          const matched = [0, 0];
          for (const { offset, side } of samples) {
            const delta = [0, 1, 2].map(
              (channel) =>
                current[offset + channel]! - baseline[offset + channel]!,
            );
            const target = [0, 1, 2].map(
              (channel) => expected[channel]! - baseline[offset + channel]!,
            );
            const norm = target.reduce((sum, value) => sum + value * value, 0);
            const alpha =
              delta.reduce(
                (sum, value, channel) => sum + value * target[channel]!,
                0,
              ) / norm;
            // A visible blend toward this sender's colour, not animated grey fog,
            // an unrelated highlight, or any changed byte elsewhere in the map.
            if (
              alpha >= 0.2 &&
              alpha <= 1.1 &&
              delta.reduce((sum, value) => sum + Math.abs(value), 0) > 60 &&
              delta.every(
                (value, channel) =>
                  Math.abs(value - alpha * target[channel]!) < 18,
              )
            )
              matched[side]!++;
          }
          maxMatchedPixels = Math.max(
            maxMatchedPixels,
            matched[0]! + matched[1]!,
          );
          if (performance.now() - start >= 3_000) return finish(false);
          if (matched[0]! >= 12 && matched[1]! >= 12) return finish(true);
          frame = requestAnimationFrame(sample);
        } catch (error) {
          finish(false, String(error));
        }
      };
      frame = requestAnimationFrame(sample);
      timer = window.setTimeout(() => finish(false), 3_000);
      return { result, cancel: () => finish(false, "Observation cancelled") };
    },
    { center, color },
  );
  return {
    async result() {
      const result = await handle.evaluate((observer) => observer.result);
      if (!result.matched)
        throw new Error(
          `Ping pixels not visible over fog within 3000ms (max=${result.maxMatchedPixels}): ${result.error ?? "no matching lower arc"}`,
        );
      return result;
    },
    async dispose() {
      await handle.evaluate((observer) => observer.cancel());
      await handle.dispose();
    },
  };
}
