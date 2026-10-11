export const STAMP_CATALOG = ["forest", "mountain", "cloud"] as const;
export type StampKind = (typeof STAMP_CATALOG)[number];
export type StampLayer = "DECORATION_PUBLIC" | "DECORATION_GM";

export interface TerrainStamp {
  id: string;
  stampId: StampKind;
  authorKey: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  layer: StampLayer;
  revision: number;
}

export interface TerrainStampDocument {
  schemaVersion: 1;
  stamps: TerrainStamp[];
}

export const STAMP_SIZE_LIMITS = { min: 24, max: 240 } as const;
export const STAMP_WORLD_LIMIT = 100_000;
const validLayer = (value: unknown): value is StampLayer =>
  value === "DECORATION_PUBLIC" || value === "DECORATION_GM";

export function validateStamp(value: unknown): value is TerrainStamp {
  if (!value || typeof value !== "object") return false;
  const stamp = value as Partial<TerrainStamp>;
  return (
    typeof stamp.id === "string" &&
    stamp.id.length > 0 &&
    STAMP_CATALOG.includes(stamp.stampId as StampKind) &&
    typeof stamp.authorKey === "string" &&
    stamp.authorKey.length > 0 &&
    Number.isFinite(stamp.x) &&
    Math.abs(stamp.x!) <= STAMP_WORLD_LIMIT &&
    Number.isFinite(stamp.y) &&
    Math.abs(stamp.y!) <= STAMP_WORLD_LIMIT &&
    Number.isFinite(stamp.size) &&
    stamp.size! >= STAMP_SIZE_LIMITS.min &&
    stamp.size! <= STAMP_SIZE_LIMITS.max &&
    Number.isFinite(stamp.rotation) &&
    stamp.rotation! >= 0 &&
    stamp.rotation! < 360 &&
    validLayer(stamp.layer) &&
    Number.isInteger(stamp.revision) &&
    stamp.revision! >= 0
  );
}

export function validateDocument(
  value: unknown,
): value is TerrainStampDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<TerrainStampDocument>;
  if (document.schemaVersion !== 1 || !Array.isArray(document.stamps))
    return false;
  const ids = new Set<string>();
  for (const stamp of document.stamps) {
    if (!validateStamp(stamp) || ids.has(stamp.id)) return false;
    ids.add(stamp.id);
  }
  return true;
}

export function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

export function stableStampId(): string {
  return globalThis.crypto.randomUUID();
}

/** Local connected model for interaction testing; persistence remains a JSON round-trip only. */
export class TerrainStampModel {
  private current: TerrainStamp[] = [];
  private undoStack: TerrainStamp[][] = [];
  private redoStack: TerrainStamp[][] = [];

  get stamps(): readonly TerrainStamp[] {
    return this.current;
  }

  private commit(next: TerrainStamp[]) {
    this.undoStack.push(this.current);
    this.current = next;
    this.redoStack = [];
  }

  add(input: Omit<TerrainStamp, "id" | "revision"> & { id?: string }) {
    const stamp: TerrainStamp = {
      ...input,
      id: input.id ?? stableStampId(),
      rotation: normalizeRotation(input.rotation),
      revision: 0,
    };
    if (
      !validateStamp(stamp) ||
      this.current.some((item) => item.id === stamp.id)
    )
      throw new Error("Invalid or duplicate terrain stamp");
    this.commit([...this.current, stamp]);
    return stamp;
  }

  move(id: string, x: number, y: number) {
    const stamp = this.require(id);
    const next = { ...stamp, x, y, revision: stamp.revision + 1 };
    if (!validateStamp(next))
      throw new Error("Terrain stamp transform out of bounds");
    this.commit(this.current.map((item) => (item.id === id ? next : item)));
    return next;
  }

  transform(
    id: string,
    changes: Partial<Pick<TerrainStamp, "size" | "rotation" | "layer">>,
  ) {
    const stamp = this.require(id);
    const next = {
      ...stamp,
      ...changes,
      rotation: normalizeRotation(changes.rotation ?? stamp.rotation),
      revision: stamp.revision + 1,
    };
    if (!validateStamp(next))
      throw new Error("Invalid terrain stamp transform");
    this.commit(this.current.map((item) => (item.id === id ? next : item)));
    return next;
  }

  copy(id: string, offset = 20) {
    const stamp = this.require(id);
    const { id: _id, revision: _revision, ...source } = stamp;
    return this.add({
      ...source,
      x: stamp.x + offset,
      y: stamp.y + offset,
    });
  }

  delete(id: string) {
    this.require(id);
    this.commit(this.current.filter((stamp) => stamp.id !== id));
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.current);
    this.current = previous;
    return true;
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.current);
    this.current = next;
    return true;
  }

  serialize(): string {
    const document: TerrainStampDocument = {
      schemaVersion: 1,
      stamps: [...this.current],
    };
    if (!validateDocument(document))
      throw new Error("Cannot serialize invalid terrain-stamp document");
    return JSON.stringify(document);
  }

  load(serialized: string) {
    const parsed: unknown = JSON.parse(serialized);
    if (!validateDocument(parsed))
      throw new Error("Invalid terrain-stamp document");
    this.current = parsed.stamps.map((stamp) => ({ ...stamp }));
    this.undoStack = [];
    this.redoStack = [];
  }

  private require(id: string) {
    const stamp = this.current.find((item) => item.id === id);
    if (!stamp) throw new Error(`Unknown terrain stamp: ${id}`);
    return stamp;
  }
}
