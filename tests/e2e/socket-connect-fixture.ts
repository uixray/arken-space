/** Engine.IO message with a Socket.IO CONNECT packet for the default namespace. */
export function isGameSocketConnect(packet: string): boolean {
  if (packet === "40") return true;
  if (!packet.startsWith("40{")) return false;
  try {
    const auth: unknown = JSON.parse(packet.slice(2));
    return typeof auth === "object" && auth !== null && !Array.isArray(auth);
  } catch {
    return false;
  }
}
