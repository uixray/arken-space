let sessionKey: string | undefined;
const listeners = new Set<() => void>();
export function setPerformanceSession(key: string | undefined) {
  if (key === sessionKey) return;
  sessionKey = key;
  for (const listener of listeners) listener();
}
export function getPerformanceSession() {
  return sessionKey;
}
export function subscribePerformanceSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
