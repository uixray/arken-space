import Konva from "konva";
import "./style.css";
import {
  STAMP_CATALOG,
  TerrainStampModel,
  type StampKind,
  type StampLayer,
  type TerrainStamp,
} from "../model";

const model = new TerrainStampModel();
const authorKey = "prototype-local-author";
const stageHost = document.querySelector<HTMLDivElement>("#stage")!;
const stage = new Konva.Stage({ container: stageHost, width: 1, height: 1 });
const worldLayer = new Konva.Layer({ listening: true });
const previewLayer = new Konva.Layer({ listening: false });
const world = new Konva.Group({ name: "world" });
stage.add(worldLayer, previewLayer);
worldLayer.add(world);

const id = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const palette = id<HTMLDivElement>("#stamp-palette");
const sizeInput = id<HTMLInputElement>("#size");
const rotationInput = id<HTMLInputElement>("#rotation");
const layerInput = id<HTMLSelectElement>("#layer");
const sizeValue = id<HTMLOutputElement>("#size-value");
const rotationValue = id<HTMLOutputElement>("#rotation-value");
const status = id<HTMLDivElement>("#status");
const drawTime = id<HTMLElement>("#draw-time");
const loadTime = id<HTMLElement>("#load-time");
const panZoomTime = id<HTMLElement>("#panzoom-time");
const payloadSize = id<HTMLElement>("#payload-size");
const objectCount = id<HTMLElement>("#object-count");
const zoomValue = id<HTMLElement>("#zoom-value");
const selectionEmpty = id<HTMLDivElement>("#empty-selection");
const stampDetails = id<HTMLDListElement>("#stamp-details");
const roundtripResult = id<HTMLParagraphElement>("#roundtrip-result");

let selectedKind: StampKind = "forest";
let mode: "place" | "select" = "place";
let selectedId: string | null = null;
let preview: Konva.Group | null = null;
let hasPointerPosition = false;
let panStart: { x: number; y: number; stageX: number; stageY: number } | null =
  null;
const panZoomSamples: number[] = [];
const localPatternImages: Partial<Record<StampKind, HTMLImageElement>> = {};

// Generated assets can be plugged in here as exact local paths. Until then the
// original hand-drawn symbol pack remains a complete local fallback.
const localPatternPaths: Partial<Record<StampKind, string>> = {
  forest: "/patterns/forest.png",
  mountain: "/patterns/mountains.png",
  cloud: "/patterns/clouds.png",
};
let loadedPatternCount = 0;
for (const [kind, path] of Object.entries(localPatternPaths) as [
  StampKind,
  string,
][]) {
  const image = new Image();
  image.onload = () => {
    localPatternImages[kind] = image;
    loadedPatternCount += 1;
    id<HTMLDivElement>("#app").dataset.patternsReady =
      String(loadedPatternCount);
    render();
  };
  image.src = path;
}
for (const button of palette.querySelectorAll<HTMLButtonElement>(
  "[data-stamp]",
)) {
  const path = localPatternPaths[button.dataset.stamp as StampKind];
  if (path)
    button.querySelector<HTMLElement>(".stamp-preview")!.style.backgroundImage =
      `url("${path}")`;
}

function showStatus(message: string) {
  status.textContent = message;
}

function updateCameraAttributes() {
  stageHost.dataset.cameraX = stage.x().toFixed(2);
  stageHost.dataset.cameraY = stage.y().toFixed(2);
  stageHost.dataset.cameraScale = stage.scaleX().toFixed(3);
}

function makeGlyph(
  stamp: Pick<TerrainStamp, "stampId" | "size" | "rotation">,
  options: { preview?: boolean; selected?: boolean } = {},
) {
  const { size } = stamp;
  const half = size / 2;
  const image = localPatternImages[stamp.stampId];
  const group = new Konva.Group({
    x: 0,
    y: 0,
    rotation: stamp.rotation,
    opacity: options.preview ? 0.64 : 1,
  });
  if (image) {
    // Render the generated local motif as the actual stamp, not merely as a
    // fill on shapes whose solid fill otherwise takes precedence.
    group.add(
      new Konva.Image({
        image,
        x: -half,
        y: -half,
        width: size,
        height: size,
        listening: false,
      }),
    );
    group.add(
      new Konva.Circle({
        x: 0,
        y: 0,
        radius: half,
        fill: "rgba(0,0,0,0.001)",
        listening: true,
      }),
    );
    if (options.selected)
      group.add(
        new Konva.Circle({
          x: 0,
          y: 0,
          radius: half + 4,
          stroke: "#ddf693",
          strokeWidth: 2,
          dash: [5, 4],
          listening: false,
        }),
      );
    return group;
  }
  const accent = options.preview ? "#d4f28a" : "#c1d592";
  const shade = options.preview ? "#5e8150" : "#45664e";
  const snow = options.preview ? "#f0edda" : "#e0e2d5";
  const cloud = options.preview ? "#f2f4e9" : "#d3ded1";
  if (stamp.stampId === "forest") {
    const trees = [
      { x: -half * 0.48, y: -half * 0.15, r: half * 0.39 },
      { x: half * 0.12, y: -half * 0.32, r: half * 0.45 },
      { x: half * 0.46, y: half * 0.12, r: half * 0.34 },
      { x: -half * 0.1, y: half * 0.36, r: half * 0.32 },
    ];
    for (const tree of trees) {
      group.add(
        new Konva.Circle({
          x: tree.x,
          y: tree.y,
          radius: tree.r,
          fill: accent,
          stroke: "#25382b",
          strokeWidth: Math.max(1, size * 0.025),
        }),
      );
      group.add(
        new Konva.Circle({
          x: tree.x - tree.r * 0.2,
          y: tree.y - tree.r * 0.23,
          radius: tree.r * 0.38,
          fill: shade,
          opacity: 0.48,
        }),
      );
    }
  } else if (stamp.stampId === "mountain") {
    group.add(
      new Konva.Line({
        points: [
          -half,
          half * 0.42,
          -half * 0.35,
          -half * 0.54,
          -half * 0.02,
          -half * 0.02,
          half * 0.28,
          -half * 0.72,
          half,
          half * 0.42,
        ],
        closed: true,
        fill: "#819187",
        stroke: "#303e36",
        strokeWidth: Math.max(1, size * 0.025),
        lineJoin: "round",
      }),
    );
    group.add(
      new Konva.Line({
        points: [
          -half * 0.35,
          -half * 0.54,
          -half * 0.02,
          -half * 0.02,
          -half * 0.23,
          -half * 0.18,
          -half * 0.36,
          -half * 0.27,
          -half * 0.48,
          -half * 0.15,
        ],
        closed: true,
        fill: snow,
        stroke: "#b8c2b8",
        strokeWidth: Math.max(0.8, size * 0.012),
        lineJoin: "round",
      }),
    );
    group.add(
      new Konva.Line({
        points: [
          half * 0.28,
          -half * 0.72,
          half * 0.61,
          half * 0.03,
          half * 0.41,
          -half * 0.15,
          half * 0.28,
          -half * 0.05,
          half * 0.17,
          -half * 0.2,
        ],
        closed: true,
        fill: snow,
        stroke: "#b8c2b8",
        strokeWidth: Math.max(0.8, size * 0.012),
        lineJoin: "round",
      }),
    );
  } else {
    group.add(
      new Konva.Ellipse({
        x: 0,
        y: half * 0.12,
        radiusX: half * 0.82,
        radiusY: half * 0.34,
        fill: cloud,
        stroke: "#879b91",
        strokeWidth: Math.max(1, size * 0.02),
      }),
    );
    group.add(
      new Konva.Circle({
        x: -half * 0.36,
        y: -half * 0.05,
        radius: half * 0.37,
        fill: cloud,
        stroke: "#879b91",
        strokeWidth: Math.max(1, size * 0.02),
      }),
    );
    group.add(
      new Konva.Circle({
        x: half * 0.08,
        y: -half * 0.22,
        radius: half * 0.48,
        fill: cloud,
        stroke: "#879b91",
        strokeWidth: Math.max(1, size * 0.02),
      }),
    );
    group.add(
      new Konva.Circle({
        x: half * 0.48,
        y: -half * 0.04,
        radius: half * 0.31,
        fill: cloud,
        stroke: "#879b91",
        strokeWidth: Math.max(1, size * 0.02),
      }),
    );
    group.add(
      new Konva.Ellipse({
        x: 0,
        y: half * 0.24,
        radiusX: half * 0.64,
        radiusY: half * 0.17,
        fill: "#aab8ad",
        opacity: 0.36,
      }),
    );
  }
  // A simple geometry hit target makes symbols selectable without asset masks.
  group.add(
    new Konva.Circle({
      x: 0,
      y: 0,
      radius: half,
      fill: "rgba(0,0,0,0.001)",
      listening: true,
    }),
  );
  if (options.selected)
    group.add(
      new Konva.Circle({
        x: 0,
        y: 0,
        radius: half + 4,
        stroke: "#ddf693",
        strokeWidth: 2,
        dash: [5, 4],
        listening: false,
      }),
    );
  return group;
}

function drawGrid(width: number, height: number) {
  const background = new Konva.Rect({
    x: -5000,
    y: -5000,
    width: 10000,
    height: 10000,
    fill: "#182019",
    name: "map-background",
  });
  world.add(background);
  const lines: number[] = [];
  for (let x = -2048; x <= 4096; x += 64) lines.push(x, -2048, x, 4096);
  for (let y = -2048; y <= 4096; y += 64) lines.push(-2048, y, 4096, y);
  world.add(
    new Konva.Shape({
      name: "prototype-grid",
      listening: false,
      sceneFunc(context, shape) {
        context.beginPath();
        for (let index = 0; index < lines.length; index += 4) {
          context.moveTo(lines[index]!, lines[index + 1]!);
          context.lineTo(lines[index + 2]!, lines[index + 3]!);
        }
        context.strokeStyle = "rgba(166, 185, 148, 0.11)";
        context.lineWidth = 1;
        context.stroke();
        context.fillStrokeShape(shape);
      },
    }),
  );
  world.add(
    new Konva.Rect({
      x: 0,
      y: 0,
      width,
      height,
      stroke: "rgba(202,220,183,.2)",
      strokeWidth: 1,
      listening: false,
    }),
  );
}

function renderDetails() {
  const selected = model.stamps.find((stamp) => stamp.id === selectedId);
  selectionEmpty.classList.toggle("hidden", Boolean(selected));
  stampDetails.classList.toggle("hidden", !selected);
  if (!selected) return;
  id<HTMLElement>("#detail-kind").textContent = selected.stampId;
  id<HTMLElement>("#detail-author").textContent = selected.authorKey;
  id<HTMLElement>("#detail-id").textContent = selected.id;
  id<HTMLElement>("#detail-position").textContent =
    `${Math.round(selected.x)}, ${Math.round(selected.y)}`;
  id<HTMLElement>("#detail-transform").textContent =
    `${selected.size} / ${selected.rotation}°`;
  id<HTMLElement>("#detail-revision").textContent =
    `${selected.layer} / r${selected.revision}`;
}

function render() {
  const started = performance.now();
  world.destroyChildren();
  const width = 4096;
  const height = 3072;
  drawGrid(width, height);
  for (const stamp of model.stamps) {
    const group = makeGlyph(stamp, { selected: stamp.id === selectedId });
    group.x(stamp.x);
    group.y(stamp.y);
    group.name(`terrain-stamp ${stamp.stampId}`);
    group.setAttr("stampId", stamp.id);
    group.setAttr("stampRevision", stamp.revision);
    group.opacity(stamp.layer === "DECORATION_GM" ? 0.66 : 1);
    group.on("click tap", (event) => {
      if (mode === "select") {
        event.cancelBubble = true;
        selectedId = stamp.id;
        render();
        showStatus(`Выбран ${stamp.stampId} · r${stamp.revision}`);
      }
    });
    group.on("dragstart", () => {
      selectedId = stamp.id;
    });
    group.on("dragend", () => {
      const moved = model.move(stamp.id, group.x(), group.y());
      selectedId = moved.id;
      render();
      showStatus(`Перемещён · ревизия ${moved.revision}`);
    });
    group.draggable(mode === "select");
    world.add(group);
  }
  stageHost.dataset.rasterStampCount = String(world.find("Image").length);
  worldLayer.draw();
  drawTime.textContent = `${(performance.now() - started).toFixed(2)} ms`;
  objectCount.textContent = String(model.stamps.length);
  const serialized = model.serialize();
  payloadSize.textContent = `${new TextEncoder().encode(serialized).byteLength.toLocaleString("ru-RU")} B`;
  renderDetails();
}

function worldPoint() {
  // Do not query Konva's pointer state until an actual native pointer event
  // has initialized it; getPointerPosition() warns when called too early.
  if (!hasPointerPosition) return null;
  return world.getRelativePointerPosition();
}

function placeAt(x: number, y: number) {
  const snap = id<HTMLInputElement>("#snap").checked;
  const point = snap
    ? { x: Math.round(x / 64) * 64, y: Math.round(y / 64) * 64 }
    : { x, y };
  const stamp = model.add({
    stampId: selectedKind,
    authorKey,
    x: point.x,
    y: point.y,
    size: Number(sizeInput.value),
    rotation: Number(rotationInput.value),
    layer: layerInput.value as StampLayer,
  });
  selectedId = stamp.id;
  render();
  showStatus(`Размещён ${stamp.stampId} · ${stamp.id.slice(0, 8)}`);
}

function updatePreview(point = worldPoint()) {
  previewLayer.destroyChildren();
  if (!point || mode !== "place") {
    preview = null;
    previewLayer.draw();
    return;
  }
  const snap = id<HTMLInputElement>("#snap").checked;
  const x = snap ? Math.round(point.x / 64) * 64 : point.x;
  const y = snap ? Math.round(point.y / 64) * 64 : point.y;
  preview = makeGlyph(
    {
      stampId: selectedKind,
      size: Number(sizeInput.value),
      rotation: Number(rotationInput.value),
    },
    { preview: true },
  );
  preview.position({ x, y });
  previewLayer.add(preview);
  previewLayer.draw();
}

function setMode(next: "place" | "select") {
  mode = next;
  id<HTMLButtonElement>("#place-mode").classList.toggle(
    "active",
    mode === "place",
  );
  id<HTMLButtonElement>("#select-mode").classList.toggle(
    "active",
    mode === "select",
  );
  id<HTMLButtonElement>("#place-mode").setAttribute(
    "aria-pressed",
    String(mode === "place"),
  );
  id<HTMLButtonElement>("#select-mode").setAttribute(
    "aria-pressed",
    String(mode === "select"),
  );
  stageHost.classList.toggle("selecting", mode === "select");
  for (const group of world.find<Konva.Group>(".terrain-stamp"))
    group.draggable(mode === "select");
  updatePreview();
  showStatus(
    mode === "place"
      ? "Размещение: клик добавляет новый штамп"
      : "Выбор: клик выбирает, перетаскивание перемещает",
  );
}

function makeSeedDocument(count: number) {
  const kinds = STAMP_CATALOG;
  const stamps: TerrainStamp[] = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % 25;
    const row = Math.floor(index / 25);
    const kind = kinds[index % kinds.length]!;
    stamps.push({
      id: `seed-${String(index + 1).padStart(4, "0")}`,
      stampId: kind,
      authorKey: authorKey,
      x: 100 + col * 116 + ((row * 17 + col * 11) % 19),
      y: 100 + row * 116 + ((col * 7 + row * 13) % 23),
      size: 48 + ((index * 29) % 145),
      rotation: (index * 47) % 360,
      layer: index % 7 === 0 ? "DECORATION_GM" : "DECORATION_PUBLIC",
      revision: index % 5,
    });
  }
  return { schemaVersion: 1 as const, stamps };
}

async function loadDensity(count: number) {
  const started = performance.now();
  model.load(JSON.stringify(makeSeedDocument(count)));
  selectedId = null;
  setMode("select");
  render();
  loadTime.textContent = `${(performance.now() - started).toFixed(2)} ms`;
  showStatus(`Загружено ${count} детерминированных объектов`);
}

function applySelectedTransform() {
  if (!selectedId) {
    updatePreview();
    return;
  }
  const stamp = model.transform(selectedId, {
    size: Number(sizeInput.value),
    rotation: Number(rotationInput.value),
    layer: layerInput.value as StampLayer,
  });
  render();
  showStatus(`Обновлён трансформ · ревизия ${stamp.revision}`);
}

function editableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

palette.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-stamp]",
  );
  if (!button) return;
  selectedKind = button.dataset.stamp as StampKind;
  for (const choice of palette.querySelectorAll<HTMLButtonElement>(
    "[data-stamp]",
  )) {
    const active = choice === button;
    choice.classList.toggle("active", active);
    choice.setAttribute("aria-pressed", String(active));
  }
  setMode("place");
});

sizeInput.addEventListener("input", () => {
  sizeValue.value = sizeInput.value;
  applySelectedTransform();
});
rotationInput.addEventListener("input", () => {
  rotationValue.value = `${rotationInput.value}°`;
  applySelectedTransform();
});
layerInput.addEventListener("change", applySelectedTransform);
id<HTMLButtonElement>("#place-mode").addEventListener("click", () =>
  setMode("place"),
);
id<HTMLButtonElement>("#select-mode").addEventListener("click", () =>
  setMode("select"),
);
id<HTMLButtonElement>("#undo").addEventListener("click", () => {
  if (model.undo()) {
    selectedId = null;
    render();
    showStatus("Действие отменено");
  }
});
id<HTMLButtonElement>("#redo").addEventListener("click", () => {
  if (model.redo()) {
    selectedId = null;
    render();
    showStatus("Действие повторено");
  }
});
id<HTMLButtonElement>("#remove").addEventListener("click", () => {
  if (selectedId) {
    model.delete(selectedId);
    selectedId = null;
    render();
    showStatus("Штамп удалён");
  }
});
id<HTMLButtonElement>("#copy").addEventListener("click", () => {
  if (selectedId) {
    const copied = model.copy(selectedId);
    selectedId = copied.id;
    render();
    showStatus("Создана независимая копия");
  }
});
id<HTMLButtonElement>("#clear").addEventListener("click", () => {
  model.load(JSON.stringify({ schemaVersion: 1, stamps: [] }));
  selectedId = null;
  render();
  showStatus("Сцена очищена");
});
id<HTMLButtonElement>("#load-100").addEventListener(
  "click",
  () => void loadDensity(100),
);
id<HTMLButtonElement>("#load-500").addEventListener(
  "click",
  () => void loadDensity(500),
);
id<HTMLButtonElement>("#roundtrip").addEventListener("click", () => {
  const serialized = model.serialize();
  const clone = new TerrainStampModel();
  clone.load(serialized);
  const passed = clone.serialize() === serialized;
  roundtripResult.textContent = `${passed ? "PASS" : "FAIL"} · ${clone.stamps.length} stamps · ${new TextEncoder().encode(serialized).byteLength} bytes · IDs/transform/layer/revision сохранены`;
  roundtripResult.classList.toggle("passed", passed);
});
id<HTMLButtonElement>("#reset-view").addEventListener("click", () => {
  stage.position({ x: 0, y: 0 });
  stage.scale({ x: 1, y: 1 });
  updateCameraAttributes();
  stage.draw();
  zoomValue.textContent = "100%";
  showStatus("Вид сброшен");
});

stage.on("pointerdown", (event) => {
  hasPointerPosition = true;
  const native = event.evt as PointerEvent;
  if (native.button === 1) {
    native.preventDefault();
    panStart = {
      x: native.clientX,
      y: native.clientY,
      stageX: stage.x(),
      stageY: stage.y(),
    };
    return;
  }
  if (native.button !== 0) return;
  if (mode === "place") {
    const point = worldPoint();
    if (point) placeAt(point.x, point.y);
  } else if (
    event.target === world.findOne(".map-background") ||
    event.target === stage
  ) {
    selectedId = null;
    render();
  }
});
stage.on("pointermove", () => {
  hasPointerPosition = true;
  updatePreview();
});
stage.on("wheel", (event) => {
  event.evt.preventDefault();
  const started = performance.now();
  const pointer = stage.getPointerPosition();
  if (!pointer) return;
  const oldScale = stage.scaleX();
  const direction = event.evt.deltaY > 0 ? -1 : 1;
  const nextScale = Math.max(
    0.3,
    Math.min(2.4, oldScale * (direction > 0 ? 1.08 : 1 / 1.08)),
  );
  const worldPoint = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  };
  stage.scale({ x: nextScale, y: nextScale });
  stage.position({
    x: pointer.x - worldPoint.x * nextScale,
    y: pointer.y - worldPoint.y * nextScale,
  });
  updateCameraAttributes();
  stage.draw();
  zoomValue.textContent = `${Math.round(nextScale * 100)}%`;
  panZoomSamples.push(performance.now() - started);
  if (panZoomSamples.length > 20) panZoomSamples.shift();
  panZoomTime.textContent = `${(panZoomSamples.reduce((sum, value) => sum + value, 0) / panZoomSamples.length).toFixed(2)} ms avg`;
});

stage.container().addEventListener("pointermove", (event) => {
  if (!panStart) return;
  const started = performance.now();
  stage.position({
    x: panStart.stageX + event.clientX - panStart.x,
    y: panStart.stageY + event.clientY - panStart.y,
  });
  updateCameraAttributes();
  stage.draw();
  panZoomSamples.push(performance.now() - started);
  if (panZoomSamples.length > 20) panZoomSamples.shift();
  panZoomTime.textContent = `${(panZoomSamples.reduce((sum, value) => sum + value, 0) / panZoomSamples.length).toFixed(2)} ms avg`;
});
window.addEventListener("pointerup", () => {
  panStart = null;
});
stage.container().addEventListener("pointerleave", () => {
  hasPointerPosition = false;
  updatePreview(null);
});

stage.container().addEventListener("pointermove", () => updatePreview());
stage.on("contextmenu", (event) => event.evt.preventDefault());
stage.container().addEventListener("pointerdown", (event) => {
  if (event.button === 1) event.preventDefault();
});
window.addEventListener("keydown", (event) => {
  if (editableTarget(event.target)) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    const changed = event.shiftKey ? model.redo() : model.undo();
    if (changed) {
      selectedId = null;
      render();
      showStatus(event.shiftKey ? "Действие повторено" : "Действие отменено");
    }
  } else if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    if (model.redo()) {
      selectedId = null;
      render();
      showStatus("Действие повторено");
    }
  } else if (modifier && event.key.toLowerCase() === "c" && selectedId) {
    event.preventDefault();
    const copy = model.copy(selectedId);
    selectedId = copy.id;
    render();
    showStatus("Создана независимая копия");
  } else if (event.key === "Delete" && selectedId) {
    event.preventDefault();
    model.delete(selectedId);
    selectedId = null;
    render();
    showStatus("Штамп удалён");
  } else if (event.key === "Escape") {
    setMode("select");
    selectedId = null;
    render();
  }
});

const resize = () => {
  const bounds = stageHost.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  stage.size({ width: bounds.width, height: bounds.height });
  worldLayer.draw();
  previewLayer.draw();
};
new ResizeObserver(resize).observe(stageHost);
resize();
updateCameraAttributes();
drawGrid(4096, 3072);
render();
updatePreview();
