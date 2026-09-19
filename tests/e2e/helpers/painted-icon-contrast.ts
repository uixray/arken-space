import type { Locator } from "@playwright/test";

/** Computed stroke/surface contrast; rejects unmodelled images and group opacity. */
export async function paintedIconContrast(icon: Locator) {
  const contrast = await icon.evaluate((element) => {
    const parse = (color: string) => {
      const match = color.match(/^rgba?\(([^)]+)\)$/);
      // CSS color-mix surfaces can be serialized as Lab or OKLCH. Let the
      // browser convert opaque colors into sRGB; do not silently guess
      // unsupported paint or composite alpha in a non-sRGB color space.
      if (
        !match &&
        /^(?:lab|oklch)\([^/]+\)$/.test(color) &&
        CSS.supports("color", color)
      ) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { colorSpace: "srgb" });
        if (!context) throw new Error("No sRGB color conversion context");
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
        if (alpha !== 255)
          throw new Error("Color conversion requires opaque color");
        return [r, g, b, 1];
      }
      if (!match) throw new Error(`Unsupported computed color: ${color}`);
      const values = match[1].split(/[,\s/]+/).map(Number);
      return [values[0], values[1], values[2], values[3] ?? 1];
    };
    const over = (front: number[], back: number[]) =>
      front
        .slice(0, 3)
        .map((value, i) => value * front[3] + back[i] * (1 - front[3]));
    const rootColor = getComputedStyle(element).color;
    for (const paint of element.querySelectorAll(
      "path,line,polyline,polygon,rect,circle,ellipse,use",
    )) {
      const style = getComputedStyle(paint);
      if (
        style.stroke !== rootColor ||
        style.fill !== "none" ||
        Number(style.strokeOpacity) !== 1 ||
        Number(style.opacity) !== 1 ||
        style.filter !== "none" ||
        style.maskImage !== "none"
      )
        throw new Error("Unmodelled SVG descendant paint");
    }
    const backgrounds: number[][] = [];
    const backingChain: object[] = [];
    let opaque = false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      backingChain.push({
        tag: node.tagName,
        className: node.getAttribute("class"),
        background: style.backgroundColor,
        opaqueChild: opaque,
      });
      if (
        style.filter !== "none" ||
        style.backdropFilter !== "none" ||
        style.mixBlendMode !== "normal" ||
        style.maskImage !== "none"
      )
        throw new Error("Unmodelled compositing effect");
      if (!opaque) {
        for (const pseudo of ["::before", "::after"]) {
          const ps = getComputedStyle(node, pseudo);
          if (ps.content === "none" || ps.display === "none") continue;
          const painted =
            parse(ps.backgroundColor)[3] > 0 ||
            ps.backgroundImage !== "none" ||
            parseFloat(ps.borderWidth) > 0 ||
            ps.boxShadow !== "none" ||
            ps.maskImage !== "none";
          if (!painted) continue;
          const iconBox = element.getBoundingClientRect();
          const ownerBox = node.getBoundingClientRect();
          const radius = Math.max(
            ...[
              ps.borderTopLeftRadius,
              ps.borderTopRightRadius,
              ps.borderBottomLeftRadius,
              ps.borderBottomRightRadius,
            ].map(parseFloat),
          );
          // Gravity's flat button paints its inset ::before behind content in
          // the transform-created stacking context. Only its plain color and
          // central, unclipped icon region are supported; other pseudos fail.
          const flatGravitySurface =
            pseudo === "::before" &&
            node.classList.contains("g-button") &&
            ps.position === "absolute" &&
            ps.inset === "0px" &&
            ps.zIndex === "-1" &&
            style.transform === "matrix(1, 0, 0, 1, 0, 0)" &&
            ps.backgroundImage === "none" &&
            parseFloat(ps.borderWidth) === 0 &&
            ps.boxShadow === "none" &&
            ps.maskImage === "none" &&
            ps.filter === "none" &&
            Number(ps.opacity) === 1 &&
            iconBox.left >= ownerBox.left &&
            iconBox.right <= ownerBox.right &&
            iconBox.top >= ownerBox.top &&
            iconBox.bottom <= ownerBox.bottom &&
            ((iconBox.left >= ownerBox.left + radius &&
              iconBox.right <= ownerBox.right - radius) ||
              (iconBox.top >= ownerBox.top + radius &&
                iconBox.bottom <= ownerBox.bottom - radius));
          if (!flatGravitySurface)
            throw new Error(
              `Unmodelled painted pseudo-element ${node.tagName}.${node.className} ${pseudo} ${JSON.stringify({ transform: style.transform, isolation: style.isolation, z: style.zIndex, position: style.position, radius, icon: iconBox.toJSON(), owner: ownerBox.toJSON(), filter: ps.filter, opacity: ps.opacity, inset: ps.inset })}`,
            );
          backgrounds.unshift(parse(ps.backgroundColor));
        }
        const box = element.getBoundingClientRect();
        for (const media of node.querySelectorAll("canvas,img,video")) {
          const rect = media.getBoundingClientRect();
          if (
            rect.width &&
            rect.height &&
            rect.left < box.right &&
            rect.right > box.left &&
            rect.top < box.bottom &&
            rect.bottom > box.top
          )
            throw new Error(
              `Icon backing crosses a media surface: ${JSON.stringify({
                control: element
                  .closest("button,summary")
                  ?.getAttribute("aria-label"),
                media: media.tagName,
                backingChain,
              })}`,
            );
        }
      }
      // Group opacity still affects descendants; backgrounds behind an opaque
      // menu surface (including the map image) do not.
      if (
        Number(style.opacity) !== 1 ||
        (!opaque && style.backgroundImage !== "none")
      )
        throw new Error("Icon contrast needs image/opacity-aware measurement");
      if (!opaque) {
        const color = parse(style.backgroundColor);
        backgrounds.unshift(color);
        opaque = color[3] === 1;
      }
    }
    if (!opaque) throw new Error("No opaque icon backing surface");
    const background = backgrounds.reduce(
      (back, front) => over(front, back),
      [0, 0, 0],
    );
    const foreground = over(parse(getComputedStyle(element).color), background);
    const luminance = (rgb: number[]) =>
      rgb
        .map((value) => {
          const s = value / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  return contrast;
}

/** Wait for finite CSS transitions on the control/icon chain, then two paint frames. */
export async function settleIconState(control: Locator) {
  await control.evaluate(async (element) => {
    const nodes = new Set<Element>([
      element,
      ...element.querySelectorAll("svg,svg *"),
    ]);
    for (let node = element.parentElement; node; node = node.parentElement)
      nodes.add(node);
    let duration = 0;
    const seconds = (value: string) =>
      value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
    for (const node of nodes) {
      for (const style of [
        getComputedStyle(node),
        getComputedStyle(node, "::before"),
        getComputedStyle(node, "::after"),
      ]) {
        const durations = style.transitionDuration.split(",").map(seconds);
        const delays = style.transitionDelay.split(",").map(seconds);
        duration = Math.max(
          duration,
          ...durations.map((d, i) => d + delays[i % delays.length]),
        );
      }
    }
    if (duration > 1)
      throw new Error("Long transition needs explicit state acceptance");
    if (duration > 0)
      await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}
