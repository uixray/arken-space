import { useEffect, useRef } from "react";
import "./portal-entrance.css";

/** Decorative only: authentication remains an ordinary accessible HTML form. */
export function PortalEntrance() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window.matchMedia !== "function") return;
    const eligible = window.matchMedia(
      "(min-width: 900px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    const device = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    let disposed = false;
    let generation = 0;
    let stop: (() => void) | undefined;
    async function refresh() {
      const ownGeneration = ++generation;
      stop?.();
      stop = undefined;
      if (!canvas || !eligible.matches || device.connection?.saveData ||
          (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 2) ||
          (device.deviceMemory !== undefined && device.deviceMemory <= 2)) return;
      try {
        const { startPortalScene } = await import("./portal-entrance-runtime");
        if (disposed || ownGeneration !== generation) return;
        stop = startPortalScene(canvas);
      } catch {
        // A failed optional chunk or GPU context never blocks account access.
        if (!disposed && ownGeneration === generation)
          canvas.removeAttribute("data-ready");
      }
    }
    const update = () => { void refresh(); };
    eligible.addEventListener("change", update);
    update();
    return () => {
      disposed = true;
      generation += 1;
      eligible.removeEventListener("change", update);
      stop?.();
    };
  }, []);
  return (
    <div className="portal-entrance" aria-hidden="true">
      <canvas ref={canvasRef} className="portal-entrance__canvas" />
      <div className="portal-entrance__shade" />
      <div className="portal-entrance__caption">
        <p>Аркспейс</p>
        <h2>Между мирами —<br />к одному столу.</h2>
      </div>
    </div>
  );
}
