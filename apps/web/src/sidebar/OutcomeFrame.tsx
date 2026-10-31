import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type DiceFrameChoice,
  type DiceFrameReference,
} from "@arken/contracts";

const FRAME_VISIBLE_BUDGET_MS = 2200;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CRITICAL_FRAME_KEYS = new Set(["critical-success", "critical-failure"]);

function readReducedMotion(): boolean | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return null;
  }
}

function ActiveFrameImage({
  src,
  registerSession,
  readBudget,
  chargeElapsed,
  onError,
}: {
  src: string;
  registerSession: () => number;
  readBudget: (session: number) => number;
  chargeElapsed: (session: number, elapsed: number, rerender: boolean) => void;
  onError: () => void;
}) {
  const sessionRef = useRef(0);
  const aliveRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const registerSessionRef = useRef(registerSession);
  const readBudgetRef = useRef(readBudget);
  const chargeElapsedRef = useRef(chargeElapsed);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    registerSessionRef.current = registerSession;
    readBudgetRef.current = readBudget;
    chargeElapsedRef.current = chargeElapsed;
    onErrorRef.current = onError;
  }, [registerSession, readBudget, chargeElapsed, onError]);

  useLayoutEffect(() => {
    aliveRef.current = true;
    sessionRef.current = registerSessionRef.current();
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!loaded) return;
    const session = sessionRef.current;
    const budget = readBudgetRef.current(session);
    if (budget <= 0) return;
    const startedAt = window.performance.now();
    const deadline = startedAt + budget;
    let timer: number | undefined;
    let settled = false;
    const settle = (rerender: boolean, allowUnmounted = false) => {
      if (settled) return;
      if (
        !allowUnmounted &&
        (!aliveRef.current || sessionRef.current !== session)
      ) {
        settled = true;
        return;
      }
      settled = true;
      chargeElapsedRef.current(
        session,
        Math.max(0, window.performance.now() - startedAt),
        rerender,
      );
    };
    const armUntilDeadline = () => {
      if (settled) return;
      const remaining = deadline - window.performance.now();
      if (remaining <= 0) {
        settle(true);
        return;
      }
      timer = window.setTimeout(armUntilDeadline, remaining);
    };
    armUntilDeadline();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      settle(false, true);
    };
  }, [loaded, src]);

  const markLoaded = () => {
    if (!aliveRef.current || loaded) return;
    setLoaded(true);
  };
  const markFailed = () => {
    if (!aliveRef.current) return;
    onErrorRef.current();
  };

  return (
    <img
      src={src}
      alt=""
      loading="eager"
      onLoad={markLoaded}
      onError={markFailed}
    />
  );
}

/** One mounted result/source owns its cumulative eligible playback budget. */
function FramePlayback({
  src,
  active,
  className,
  poster,
  source,
  enabled = true,
}: {
  src: string;
  active: boolean;
  className: string;
  poster?: string;
  source?: DiceFrameChoice["source"];
  enabled?: boolean;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const generationRef = useRef(0);
  const remainingRef = useRef(FRAME_VISIBLE_BUDGET_MS);
  const failedRef = useRef(false);
  const ownerAliveRef = useRef(true);
  const sessionIdRef = useRef(0);
  const activeSessionRef = useRef<number | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document !== "undefined" &&
      !document.hidden &&
      document.visibilityState === "visible",
  );
  const [pageActive, setPageActive] = useState(true);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [remaining, setRemaining] = useState(FRAME_VISIBLE_BUDGET_MS);
  const browserApisAvailable =
    reducedMotion !== null &&
    typeof IntersectionObserver !== "undefined" &&
    typeof document !== "undefined";

  useEffect(() => {
    const generation = ++generationRef.current;
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [src]);

  useEffect(() => {
    ownerAliveRef.current = true;
    return () => {
      ownerAliveRef.current = false;
      activeSessionRef.current = null;
    };
  }, [src]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setReducedMotion(null);
      return;
    }
    let query: MediaQueryList;
    try {
      query = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      setReducedMotion(null);
      return;
    }
    const update = () => setReducedMotion(query.matches);
    update();
    if (query.addEventListener) query.addEventListener("change", update);
    else query.addListener?.(update);
    return () => {
      if (query.removeEventListener)
        query.removeEventListener("change", update);
      else query.removeListener?.(update);
    };
  }, [src]);

  useEffect(() => {
    const target = wrapperRef.current;
    setIntersecting(false);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const generation = generationRef.current;
    let disposed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (disposed || generationRef.current !== generation) return;
        const entry = entries.find((candidate) => candidate.target === target);
        if (entry)
          setIntersecting(entry.isIntersecting && entry.intersectionRatio > 0);
      },
      { threshold: 0, rootMargin: "0px" },
    );
    observer.observe(target);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [active, src]);

  useEffect(() => {
    const updateVisibility = () =>
      setDocumentVisible(
        !document.hidden && document.visibilityState === "visible",
      );
    const onPageHide = () => setPageActive(false);
    const onPageShow = () => {
      setPageActive(true);
      updateVisibility();
    };
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [src]);

  const canMountImage =
    active &&
    browserApisAvailable &&
    !reducedMotion &&
    intersecting &&
    documentVisible &&
    pageActive &&
    !failed &&
    remaining > 0;

  const registerSession = () => {
    const session = ++sessionIdRef.current;
    activeSessionRef.current = session;
    return session;
  };
  const readBudget = (session: number) =>
    activeSessionRef.current === session ? remainingRef.current : 0;
  const chargeElapsed = (
    session: number,
    elapsed: number,
    rerender: boolean,
  ) => {
    if (
      !ownerAliveRef.current ||
      activeSessionRef.current !== session ||
      generationRef.current <= 0
    )
      return;
    const nextRemaining = Math.max(0, remainingRef.current - elapsed);
    remainingRef.current = nextRemaining;
    if (rerender || nextRemaining <= 0) setRemaining(nextRemaining);
  };
  const markFailed = () => {
    if (failedRef.current) return;
    failedRef.current = true;
    setFailed(true);
  };

  return (
    <span
      ref={wrapperRef}
      className={className}
      data-frame-source={source}
      aria-hidden="true"
    >
      {canMountImage && enabled ? (
        <ActiveFrameImage
          key="animated"
          src={src}
          registerSession={registerSession}
          readBudget={readBudget}
          chargeElapsed={chargeElapsed}
          onError={markFailed}
        />
      ) : poster && !posterFailed ? (
        <img
          key="poster"
          src={poster}
          alt=""
          loading="lazy"
          onError={() => setPosterFailed(true)}
        />
      ) : null}
    </span>
  );
}

function diceStyleFrameUrls(assetId: string) {
  const base = `/api/assets/${encodeURIComponent(assetId)}/content`;
  return { animated: base, poster: `${base}?variant=poster` };
}

export function OutcomeFrame({
  frame,
  styleFrame = null,
  active,
  identity = "",
}: {
  frame: DiceFrameReference | null;
  /** UIX-457: рамка игрока или навыка; при крите уступает критической. */
  styleFrame?: DiceFrameChoice | null;
  active: boolean;
  /** Stable message/result identity; a new result must not inherit a budget. */
  identity?: string;
}) {
  if (frame?.setKey === "ARKEN_CRITICAL_V1") {
    return (
      <FramePlayback
        key={`${identity}:${frame.setKey}:${frame.frameKey}`}
        src={`/assets/frames/${frame.frameKey}.png`}
        enabled={CRITICAL_FRAME_KEYS.has(frame.frameKey)}
        className={`outcome-frame outcome-frame--${frame.frameKey} ${active ? "outcome-frame--active" : "outcome-frame--inactive"}`}
        active={active}
      />
    );
  }

  if (styleFrame) {
    const urls = diceStyleFrameUrls(styleFrame.assetId);
    return (
      <FramePlayback
        key={`${identity}:style:${styleFrame.source}:${styleFrame.assetId}`}
        src={urls.animated}
        poster={urls.poster}
        source={styleFrame.source}
        className={`outcome-frame outcome-frame--style ${active ? "outcome-frame--style-active" : "outcome-frame--style-history"}`}
        active={active}
      />
    );
  }

  return null;
}
