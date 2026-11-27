import { portalFragment, portalVertex } from "./portal-entrance-shaders";

/** Bounded native WebGL scene: no renderer dependency on the game canvas. */
export function startPortalScene(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext("webgl", {
    alpha: false, antialias: false, depth: false,
    stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power",
  });
  if (!gl) return () => {};
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let frame = 0;
  let stopped = false;
  let observer: ResizeObserver | undefined;
  let lastFrame = 0;
  let clock = 0;
  let firstDraw = true;
  let targetX = 0;
  let targetY = 0;
  let pointerX = 0;
  let pointerY = 0;

  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    targetX = Math.max(-1, Math.min(1,
      ((event.clientX - rect.left) / rect.width - 0.28) * 3));
    targetY = Math.max(-1, Math.min(1,
      1 - 2 * (event.clientY - rect.top) / rect.height));
  };
  const leave = () => { targetX = 0; targetY = 0; };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("blur", leave);
    document.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", visibility);
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeAttribute("data-ready");
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  };
  const lost = () => { stop(); };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    // Bound fragment work independently of retina resolution.
    const scale = Math.min(1, Math.sqrt(180000 /
      Math.max(1, rect.width * rect.height)));
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  let draw: (time: number) => void;
  function visibility() {
    cancelAnimationFrame(frame);
    lastFrame = 0;
    if (!stopped && !document.hidden) frame = requestAnimationFrame(draw);
  }
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error("Optional scene shader unavailable");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("Optional scene shader unsupported");
    }
    return shader;
  };
  try {
    vertex = compile(gl.VERTEX_SHADER, portalVertex);
    fragment = compile(gl.FRAGMENT_SHADER, portalFragment);
    program = gl.createProgram();
    buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error("Optional scene unavailable");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Optional scene unsupported");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    if (position < 0) throw new Error("Optional scene position unavailable");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "uResolution");
    const pointer = gl.getUniformLocation(program, "uPointer");
    const timeUniform = gl.getUniformLocation(program, "uTime");
    draw = (now: number) => {
      if (stopped || document.hidden) return;
      frame = requestAnimationFrame(draw);
      if (lastFrame && now - lastFrame < 1000 / 30) return;
      const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      clock += dt;
      const inertia = 1 - Math.exp(-dt * 4);
      pointerX += (targetX - pointerX) * inertia;
      pointerY += (targetY - pointerY) * inertia;
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform2f(pointer, pointerX, pointerY);
      gl.uniform1f(timeUniform, clock);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (firstDraw) {
        firstDraw = false;
        if (gl.getError() !== gl.NO_ERROR) { stop(); return; }
        canvas.setAttribute("data-ready", "true");
      }
    };
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("blur", leave);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    canvas.addEventListener("webglcontextlost", lost);
    if (!document.hidden) frame = requestAnimationFrame(draw);
    return stop;
  } catch {
    stop();
    return () => {};
  }
}
