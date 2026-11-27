/** Transport reachability never grants authority to a second writer. */
import type { LocalAuthority } from "@arken/contracts";
export type SessionAuthority = Readonly<LocalAuthority>;
export type SessionRoute = "CLOUD" | "DIRECT" | "RELAY" | "LAN";
export type RouteEvidence = Readonly<{
  route: SessionRoute;
  authority: SessionAuthority;
  /** Set by an authenticated application handshake, never by ICE/open alone. */
  authenticated: boolean;
  ready: boolean;
  checkpoint: number;
}>;
export type RouteDecision =
  | { state: "CONNECTED"; route: SessionRoute; authority: SessionAuthority }
  | { state: "WAITING"; reason: "NO_AUTHORITY" | "NO_ROUTE" | "RESYNC_REQUIRED" };

export function sameAuthority(a: SessionAuthority, b: SessionAuthority): boolean {
  return a.campaignId===b.campaignId && a.sessionId===b.sessionId &&
    a.hostId===b.hostId && a.epoch===b.epoch;
}

/** No cloud-return preference: keep a working route to avoid route flapping. */
export function selectSessionRoute(
  authority: SessionAuthority | null,
  appliedCheckpoint: number,
  evidence: readonly RouteEvidence[],
  current?: SessionRoute,
): RouteDecision {
  if (!authority) return {state:"WAITING",reason:"NO_AUTHORITY"};
  if (!Number.isSafeInteger(authority.epoch) || authority.epoch<1 ||
      !Number.isSafeInteger(appliedCheckpoint) || appliedCheckpoint<0)
    return {state:"WAITING",reason:"RESYNC_REQUIRED"};
  const ready=evidence.filter(e=>e.authenticated&&e.ready&&sameAuthority(e.authority,authority));
  const synchronized=ready.filter(e=>e.checkpoint===appliedCheckpoint);
  const order:SessionRoute[]=["LAN","DIRECT","CLOUD","RELAY"];
  const selected=synchronized.find(e=>e.route===current) ??
    order.flatMap(route=>synchronized.filter(e=>e.route===route))[0];
  if (selected) return {state:"CONNECTED",route:selected.route,authority};
  return {state:"WAITING",reason:ready.length?"RESYNC_REQUIRED":"NO_ROUTE"};
}

export const routeStatusText=(decision:RouteDecision):string=>{
  if(decision.state==="WAITING") return decision.reason==="RESYNC_REQUIRED"
    ? "Согласуем состояние с мастером" : decision.reason==="NO_AUTHORITY"
      ? "Ожидаем подтверждение игровой сессии" : "Мастер недоступен: ожидаем рабочий маршрут";
  return {CLOUD:"Соединение через облако",DIRECT:"Прямое соединение с мастером",
    RELAY:"Соединение с мастером через relay",LAN:"Соединение с мастером по локальной сети"}[decision.route];
};
