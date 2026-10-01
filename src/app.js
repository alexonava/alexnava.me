// UI entry for esbuild.
//
// The Three.js scene is built as a separate hashed script and loaded after
// first paint by main.js. Keep this entry limited to fast UI behavior and the
// scene quality defaults the boot path needs before the renderer arrives.
import "./shared/webgl-probe.js";
import "./shared/motion.js";
import "./scene/quality.js";
import "./ui/hero.js";
import "./ui/panels.js";
import "./ui/scene-menu.js";
import "./ui/scene-controls.js";
import "./ui/deep-links.js";
import "./main.js";
