import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import {
  createStoneDetailController,
  GROUND_DETAIL_SETTINGS,
  slateMaterialUrl,
} from "./stone-detail.js";
import { SLATE_TILING } from "./mud-ground.js";

export const EARTH = Object.freeze({ width: 384, subdivisions: 128 });

// The film terrain's map set, "slate": the seamless slate v2 tile, repeated
// every 22 units at the classic ground's normal strength, with no roughness
// map, plus a 512 detail map shared by both tiers and the close soil's grit and
// relief maps at the tier's size (mud-ground.js samples these at their own
// scales).
export const FILM_GROUND_PRESETS = Object.freeze({
  slate: Object.freeze({
    kinds: Object.freeze(["color", "normal", "detail", "grit", "relief"]),
    urlFor: slateMaterialUrl,
    sizeFor: (kind, size) => (kind === "detail" ? 512 : size),
    tile: SLATE_TILING.tile,
    wrap: RepeatWrapping,
    normalScale: GROUND_DETAIL_SETTINGS.normalScale,
    material: "Cracked Desert Ground",
  }),
});

export function createEarthDetail({
  preset: presetName = "slate",
  profile,
  disabled,
  anisotropy,
  publish,
  restore,
  report,
  loadImage,
  createCanvas = () => document.createElement("canvas"),
}) {
  const preset = FILM_GROUND_PRESETS[presetName];
  if (!preset) throw new Error(`Unknown film ground preset: ${presetName}`);
  let active = false,
    disposed = false,
    current = profile,
    context = {},
    maps = null;
  function sync() {
    detail.applyQuality(active ? current : { tier: "low" }, active ? context : {});
  }
  function clear() {
    restore(); // Restore material bindings before disposing their resources.
    if (maps) Object.values(maps).forEach((texture) => texture.dispose());
    maps = null;
  }
  const detail = createStoneDetailController({
    profile: { tier: "low" },
    disabled,
    loadImage,
    report,
    kinds: preset.kinds,
    urlFor: preset.urlFor,
    sizeFor: preset.sizeFor,
    apply(sources) {
      const next = {};
      try {
        for (const kind of preset.kinds) {
          const source = sources[kind],
            canvas = createCanvas();
          canvas.width = source.width;
          canvas.height = source.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Film ground canvas unavailable");
          ctx.drawImage(source, 0, 0);
          const texture = (next[kind] = new CanvasTexture(canvas));
          texture.wrapS = texture.wrapT = preset.wrap;
          texture.repeat.setScalar(EARTH.width / preset.tile);
          texture.anisotropy = anisotropy;
          if (kind === "color") texture.colorSpace = SRGBColorSpace;
        }
        clear();
        maps = next;
        // filmTiled: the repeat already spans the 384-unit film terrain, so
        // index.js must not rescale it from the 176-unit ground disc.
        publish({
          colorMap: maps.color,
          normalMap: maps.normal,
          roughnessMap: maps.roughness ?? null,
          detailMap: maps.detail ?? null,
          gritMap: maps.grit ?? null,
          reliefMap: maps.relief ?? null,
          bumpMap: null,
          normalScale: preset.normalScale,
          filmTiled: true,
        });
      } catch (error) {
        if (maps !== next) Object.values(next).forEach((texture) => texture.dispose());
        throw error;
      }
    },
    reset: clear,
  });
  return {
    setActive(next) {
      if (disposed) return;
      active = Boolean(next);
      sync();
    },
    applyQuality(next, nextContext = {}) {
      if (disposed) return;
      current = next;
      context = nextContext;
      sync();
    },
    dispose() {
      if (disposed) return false;
      detail.dispose();
      disposed = true;
      return true;
    },
  };
}
