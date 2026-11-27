import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useMapTouch } from "../renderers/useMapTouch";

function Fixture() {
  const [preview, setPreview] = useState("none"),
    [moves, setMoves] = useState(0),
    [commits, setCommits] = useState(0);
  const [lastCommit, setLastCommit] = useState("none");
  const token = { id: "fixture", x: 0, y: 0, revision: 1 };
  const touch = useMapTouch({
    scope: "scene",
    enabled: true,
    camera: { position: { x: 0, y: 0 }, scale: 1 },
    hit: () => token,
    movable: () => true,
    select: () => {},
    preview: (_token, delta) =>
      setPreview(delta ? `${delta.x},${delta.y}` : "none"),
    commit: (_token, delta) => {
      setCommits((value) => value + 1);
      setLastCommit(`${delta.x},${delta.y}`);
    },
    cameraChange: () => setMoves((value) => value + 1),
  });
  return (
    <>
      <div
        tabIndex={0}
        onPointerDown={touch.down}
        onPointerMove={touch.move}
        onPointerUp={touch.up}
        onPointerCancel={touch.pointerCancel}
        onLostPointerCapture={touch.lostCapture}
        style={{ width: 300, height: 300, touchAction: "none" }}
      >
        <canvas aria-label="Карта" width="300" height="300" />
      </div>
      <output data-testid="preview">{preview}</output>
      <output data-testid="moves">{moves}</output>
      <output data-testid="commits">{commits}</output>
      <output data-testid="last-commit">{lastCommit}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
