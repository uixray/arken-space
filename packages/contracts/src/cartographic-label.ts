import { z } from "zod";

/** Screen-space offset from the existing label anchor, not world coordinates.
 * null/absence preserves legacy plain presentation. No visibility/HTML fields. */
export const cartographicLabelSchema = z.object({
  presentation: z.enum(["plain", "ribbon"]),
  offsetX: z.number().finite().min(-2000).max(2000),
  offsetY: z.number().finite().min(-2000).max(2000),
}).strict();
export type CartographicLabelConfig = z.infer<typeof cartographicLabelSchema>;
