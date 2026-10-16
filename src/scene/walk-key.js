// The walk's key and when it may start (walk.js; docs/SCENE-MODES.md). Backquote
// is the key's place on the board (` and ~ on a US keyboard, a dead key on
// some layouts); `key` covers layouts that type ` or ~ elsewhere, AltGr
// included (Windows reports AltGr as Ctrl and Alt).
export function isWalkKey(event) {
  if (!event || event.repeat || event.isComposing || event.defaultPrevented) return false;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ""))
    return false;
  const altGraph = event.getModifierState?.("AltGraph") === true;
  if (event.metaKey || ((event.ctrlKey || event.altKey) && !altGraph)) return false;
  if (event.code === "Backquote" && !altGraph) return true;
  return event.key === "`" || event.key === "~";
}

// The walk starts only over the revealed live scene with its film ground in
// place, on a desktop's fine pointer, and never under reduced motion, a
// visitor pause or forced colors (which hide the scene).
export function walkAllowed({
  shown = false,
  failed = false,
  ground = false,
  reducedMotion = false,
  paused = false,
  finePointer = false,
  forcedColors = false,
} = {}) {
  return shown && !failed && ground && finePointer && !reducedMotion && !paused && !forcedColors;
}
