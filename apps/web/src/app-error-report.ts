import { reportClientEvent } from "./api";

/** React errors may contain game data, so only send bounded diagnostics. */
const nativeErrorNames = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

export function reportRenderFailure(code: string, errorName: string) {
  reportClientEvent({
    level: "error",
    event: "app.render_failed",
    context: {
      code,
      errorName: nativeErrorNames.has(errorName) ? errorName : "Error",
    },
  });
}
