import type { Role } from "@arken/contracts";

/** UIX-392: a single member's ephemeral cursor position on one scene. */
export interface CursorPresence {
  membershipId: string;
  displayName: string;
  role: Role;
  sceneId: string;
  x: number;
  y: number;
}
