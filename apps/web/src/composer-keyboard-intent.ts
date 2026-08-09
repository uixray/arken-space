/**
 * UIX-388: decides what a keydown inside the chat composer textarea should
 * do. Extracted so the Enter / Ctrl+Enter / Shift+Enter / IME-composition
 * decision is unit-testable without a DOM (this repo's vitest config runs
 * under `environment: "node"`).
 *
 * Deliberately a *direct submit* decision, not a persistent "private mode"
 * toggle: a hidden mode that outlives the keypress is exactly the kind of
 * state that can make a player send a private message publicly (or vice
 * versa) by forgetting it's on -- a real harm in a game built around GM
 * secrets. Ctrl+Enter always means "send this message GM-only", never
 * "flip a switch for future messages".
 */
export type ComposerKeydownAction =
  | "SEND_PUBLIC"
  | "SEND_GM_ONLY"
  | "NEWLINE"
  | "IGNORE";

export function decideComposerKeydown(event: {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}): ComposerKeydownAction {
  if (event.key !== "Enter") return "IGNORE";
  // An IME composition (e.g. finishing a Japanese/Chinese candidate) fires
  // Enter to confirm the candidate, not to submit the form.
  if (event.isComposing) return "IGNORE";
  if (event.shiftKey) return "NEWLINE";
  if (event.ctrlKey) return "SEND_GM_ONLY";
  return "SEND_PUBLIC";
}
