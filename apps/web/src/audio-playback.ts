export function isAudioConsentError(reason: unknown) {
  return (
    reason instanceof DOMException &&
    (reason.name === "NotAllowedError" || reason.name === "SecurityError")
  );
}
