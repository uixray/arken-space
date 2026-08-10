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

export function reportRenderFailure(code: string, error: Error) {
  const errorName = nativeErrorNames.has(error.name) ? error.name : "Error";
  reportClientEvent({
    level: "error",
    event: "app.render_failed",
    errorName,
    // The stack describes code (file/line/function), not the component's
    // data, so it is safe to send in full — the render error's message and
    // React's componentStack (which can embed props/state text) are not.
    stack: error.stack,
    context: { code, errorName },
  });
}
