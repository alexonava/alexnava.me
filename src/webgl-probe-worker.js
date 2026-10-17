// A separate same-origin entry keeps cold GPU context creation off the UI
// thread. The shared probe reads the same limits and releases its context.
import "./shared/webgl-probe.js";

globalThis.postMessage(globalThis.BabelSite.shared.getWebGLCapabilities());
