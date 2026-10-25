// The opening's doors drawn as paper (src/doors/paper-doors.js), a script of its own that
// ui/scene-doors.js loads on the live path. On the page it starts the drawing: in a worker
// (this same script) that draws on the doors' canvas, an OffscreenCanvas, so no work of
// the page's, the scene's loading included, ever holds a frame of the opening; where a
// canvas cannot move to a worker it draws on the page instead. Either way it hands the
// doors a drawing (light, open, dispose) once the first frame is drawn, or says why not.
import { createPaperDoors } from "./doors/paper-doors.js";

const scope = globalThis;
// The paper's maps under their published, hashed names (build.mjs).
const PAPER =
  typeof __BABEL_PAPER_URLS__ !== "undefined"
    ? __BABEL_PAPER_URLS__
    : { detail: "/images/paper/paper-detail.webp", height: "/images/paper/paper-height.webp" };
const frame =
  typeof scope.requestAnimationFrame === "function"
    ? (callback) => scope.requestAnimationFrame(callback)
    : (callback) => scope.setTimeout(() => callback(scope.performance.now()), 16);
const cancel =
  typeof scope.cancelAnimationFrame === "function"
    ? (id) => scope.cancelAnimationFrame(id)
    : (id) => scope.clearTimeout(id);

if (typeof scope.document === "undefined") {
  // The worker: the page's messages drive the drawing; it answers drawn, parted or failed.
  let drawing = null;
  const say = (type, message) => scope.postMessage({ type, message });
  scope.onmessage = async ({ data }) => {
    try {
      if (data.type === "init") {
        drawing = await createPaperDoors(data.canvas, {
          ...data,
          frame,
          cancel,
          onLost: () => say("failed", "context lost"),
        });
        say(drawing ? "drawn" : "failed", drawing ? undefined : "no WebGL2");
      } else if (!drawing) {
        return;
      } else if (data.type === "light") {
        drawing.light(data);
      } else if (data.type === "resize") {
        drawing.resize(data.size, data.ratio);
      } else if (data.type === "open") {
        await drawing.open();
        say("parted");
      }
    } catch (error) {
      say("failed", String(error?.message || error));
    }
  };
} else {
  const site = (scope.BabelSite = scope.BabelSite || {});
  const own = scope.document.currentScript?.src;

  // The drawing in a worker, on the canvas handed over to it.
  function inWorker(canvas, options, drawn, failed) {
    const worker = new scope.Worker(own);
    let offscreen;
    try {
      offscreen = canvas.transferControlToOffscreen();
    } catch (error) {
      worker.terminate();
      throw error;
    }
    let parted = () => {};
    const done = new Promise((resolve) => (parted = resolve));
    const drawing = {
      light: ({ star, warm }) =>
        worker.postMessage({
          type: "light",
          star: star ? { x: star.x, y: star.y, radius: star.radius } : null,
          warm,
        }),
      resize: (size, ratio) => worker.postMessage({ type: "resize", size, ratio }),
      open: () => {
        worker.postMessage({ type: "open" });
        return done;
      },
      dispose: () => {
        worker.terminate();
        parted();
      },
    };
    worker.onmessage = ({ data }) => {
      if (data?.type === "drawn") drawn(drawing);
      else if (data?.type === "parted") parted();
      else if (data?.type === "failed") failed(drawing, data.message || "the drawing failed");
    };
    worker.onerror = () => failed(drawing, "the drawing's worker failed");
    worker.postMessage({ type: "init", canvas: offscreen, ...options }, [offscreen]);
  }

  // The drawing on the page.
  async function inPage(canvas, options, drawn, failed) {
    let drawing = null;
    drawing = await createPaperDoors(canvas, {
      ...options,
      frame,
      cancel,
      onLost: () => failed(drawing, "context lost"),
    });
    if (!drawing) throw new Error("no WebGL2");
    drawn(drawing);
  }

  // Starts the drawing on the doors: `tier` sets its device px per CSS px within the
  // scene's caps; `drawn(drawing)` once its first frame is up, `failed(drawing, why)`.
  site.paperDoors = {
    start(doors, { tier, drawn, failed }) {
      const ratio = () => Math.min(scope.devicePixelRatio || 1, tier === "high" ? 1.5 : 1.25);
      const size = () => [doors.clientWidth, doors.clientHeight];
      const canvas = scope.document.createElement("canvas");
      canvas.className = "scene-doors__canvas";
      doors.appendChild(canvas);
      // A worker resolves requests against its own script; these are whole URLs.
      const at = (path) => new URL(path, scope.location.href).href;
      const options = {
        urls: { height: at(PAPER.height), detail: at(PAPER.detail) },
        size: size(),
        ratio: ratio(),
      };
      let current = null;
      const onResize = () => current?.resize(size(), ratio());
      const done = (drawing) => {
        current = drawing;
        const dispose = drawing.dispose;
        drawing.dispose = () => {
          scope.removeEventListener("resize", onResize);
          dispose();
          canvas.remove();
        };
        scope.addEventListener("resize", onResize);
        drawn(drawing);
      };
      const lost = (drawing, why) => {
        canvas.remove();
        failed(drawing, why);
      };
      if (own && typeof canvas.transferControlToOffscreen === "function" && scope.Worker) {
        try {
          return inWorker(canvas, options, done, lost);
        } catch {
          // The page draws instead.
        }
      }
      inPage(canvas, options, done, lost).catch((error) => lost(null, error?.message || error));
    },
  };
}
