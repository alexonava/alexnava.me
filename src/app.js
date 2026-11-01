// UI entry for esbuild.
//
// The Three.js scene is built as a separate hashed script and loaded after
// first paint by main.js. Keep this entry limited to fast UI behavior and the
// startup tier the boot path needs before the renderer arrives. The scene reads
// the probe and the tier choice from this bundle's BabelSite namespace.
import "./shared/webgl-probe.js";
import "./shared/motion.js";
import "./shared/quality-tier.js";
import "./ui/hero.js";
import "./ui/contact.js";
import "./ui/scene-doors.js";
import "./ui/scene-loader.js";
import "./main.js";
