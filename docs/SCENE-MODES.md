# Scene modes

URL parameters, shots, pauses and the status objects used for review and captures. They select what the live scene shows; none of them bypasses a release gate. Terms such as dwell, resolution step and film are defined in the [Glossary](GLOSSARY.md).

## Parameters

Append them to the local preview, for example `http://127.0.0.1:4173/?view=tower&angle=1&tour=0`.

| Parameter    | Values                                      | Effect                                             |
| ------------ | ------------------------------------------- | -------------------------------------------------- |
| `view`       | `tower` (default), `tree`                   | Opening subject                                    |
| `angle`      | `1` to `5` (tower), `1` to `4` (tree)       | Shot within the view                               |
| `tour`       | absent, `3`, `5`, `20`, `0`                 | Per-shot dwells, a fixed dwell in seconds, or none |
| `quality`    | `auto` (default), `high`, `balanced`, `low` | Startup tier; an explicit tier pins the governor   |
| `sceneDebug` | `1` or `true`                               | Publishes `BabelSite.sceneDebug`                   |

- Any other `view` opens the tower, and a missing or invalid `angle` the first shot. A `tour` value other than 3, 5 or 20 stays on the opening shot. At `tour=3` the dissolve takes 0.9 s. Any other `quality` value reads as `auto`.
- `quality=high|balanced` loads the live scene past the reduced-motion, reduced-data and software-renderer gates, never without WebGL, and pins the tier: the governor takes no adaptive step, not even the resolution step (pixel ratio only).
- `sceneDebug` loads the live scene past the reduced-motion and software-renderer gates only: with a reduced-data preference the startup tier is still low, which keeps the title card (when the probe could not read the texture limits, main.js downloads the scene bundle first and `initHomeScene()` declines). It keeps the detected tier and the governor. With `sceneDebug`, main.js installs no preference listeners, so a title card kept by reduced data stays when the preference clears, until a reload.
- `quality=low` keeps the title card, with or without `sceneDebug`.

## Shots

| URL                  | Shot             | Dwell | In the tour  |
| -------------------- | ---------------- | ----- | ------------ |
| `view=tower&angle=1` | The watch        | 9 s   | 1st          |
| `view=tower&angle=2` | Threshold        | 7 s   | 4th          |
| `view=tower&angle=3` | Masonry study    | 7 s   | no, URL only |
| `view=tower&angle=4` | Gallery detail   | 7 s   | no, URL only |
| `view=tower&angle=5` | Watch and tree   | 7 s   | no, URL only |
| `view=tree&angle=1`  | Portrait         | 9 s   | 2nd          |
| `view=tree&angle=2`  | Lantern study    | 6 s   | 3rd          |
| `view=tree&angle=3`  | Close-up         | 6 s   | 5th          |
| `view=tree&angle=4`  | Root and lantern | 6 s   | 6th          |

The tour alternates the lookout and the tree, while it can, in the order of the last column (camera-tour.js `TOUR_ORDER`), about 43 s a loop; Portrait then Lantern study and Close-up then Root and lantern are the two pairs of tree shots together. A shot outside the tour, opened by URL, is followed by The watch. Watch and tree left the tour on the owner's call of 2026-10-08 and keeps its URL and framing. Watch and tree tilts up 3 degrees through its dwell (5 in squat windows), rising into its composition (the shot's `tilt`). A shot's `anchor` sets where its aim lands in the safe area, as shares of the area's width and height (its centre unless set), so a subject can stand on a third: Threshold, Watch and tree, Lantern study, Close-up and Root and lantern place theirs, Portrait on phones, and the kept frame of a dissolve pushes in about that point. A `tilt` pitches the camera after the fit, so a tilted shot's aim moves off its anchor through the hold. A shot's `grade` scales the grade's cel step on the subjects (`subjects`), and its `shafts.gobo` sets the moon's catch on its subject over the subject's own (light-shafts.js); Portrait sets both. Portrait and Watch and tree calm the plain about their subject (the shot's `ground`, mud-ground.js `slateCalmFor`); Portrait's `ground` also sets its look: a moonlit `clearing`, low `mist` (on the ranges' feet too), the `gloss` of rain and a softer crown `shadow` (mud-ground.js `SLATE_LOOK`); the other wide shots take a lighter, warm grey `mist` and the `gloss` untinted (its `cool` 0; directed-shots.js `AFTER_RAIN`). Each shot drifts and pushes in, then dissolves into the next over 1 s (or 30% of a shorter dwell), staggered by depth. A missing subject's shots are skipped. Shot intent and dwells live in [directed-shots.js](../src/scene/directed-shots.js), fitting and drift in [cinematic.js](../src/scene/cinematic.js), pacing in [camera-tour.js](../src/scene/camera-tour.js) and the dissolve in [postprocess.js](../src/scene/postprocess.js).

### Viewport variants

The scene's size picks each shot's variant (directed-shots.js `resolveDirectedShot`), so set the window size before a capture. Each variant overrides some of the shot's framing; a shot without the chosen variant keeps its own.

| Scene size (CSS px)                                                                                                                          | Variant                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Taller than wide, or a stacked layout (`isStackedLayout`: portrait or square up to 1024 wide, or landscape under 600 wide and over 500 tall) | `portrait`                  |
| Landscape up to 500 tall and narrower than 1.55:1 (`SQUAT_LANDSCAPE`), such as 599×499 or 700×480                                            | `squat`, else `portrait`    |
| Landscape up to 500 tall, at least 1.55:1 and under 600 wide, such as 568×320                                                                | `compact`, else `landscape` |
| Landscape up to 500 tall, at least 1.55:1, from 600 wide, such as 844×390                                                                    | `landscape`                 |
| Landscape from 1000 wide and over 500 tall, bars over 2% (narrower than about 2.29:1), such as 1440×900 (letterboxed)                        | `letterbox`, else the shot  |
| Anything else, such as 2560×1080 or a square over 1024                                                                                       | None: the shot itself       |

Every shot has a `portrait` variant; Portrait's changes its move (a push without the sideways truck, so the subject keeps its size on a narrow screen) and sets the tree on the lower third, and Lantern study's keeps the −115° axis. Every moving shot's `landscape` variant drops its move (`move: null`), and only The watch has a `letterbox` variant for desktops with widescreen bars. Watch and tree's `portrait` (55 degrees) keeps the lookout on the left third with the tree whole to its right, and tilts −1 to 2 degrees; its `landscape` turns further round (75 degrees) and tilts 3 degrees; its `squat` and `compact` (−15 degrees; it is the only shot with `squat`) see the pair mirrored, the tree left of the lookout and the star whole beyond it, clear of the name. The lantern shots' and Threshold's `landscape` keep a centred aim. The watch has `landscape` (lower and further round, so the snowy range runs between the intro and the tower) and `compact` (lower again, below the intro); Watch and tree has a `compact` too. The `compact` variant is unrelated to the `compact` composition profile in `sceneDebug.composition`. The safe area the shot is fitted in follows the hero's layout too ([Contracts](CONTRACTS.md#hero-breakpoints)).

## Tour and pauses

- An open dialog holds the tour at once; 450 ms later, after the dim overlay has faded in, rendering stops until the last dialog closes (a render hold).
- A hidden tab or an off-screen canvas renders nothing. Reduced motion holds camera motion whenever the live scene runs with it: forced by `quality=high|balanced` or `sceneDebug`, or turned on after the scene loaded.
- `BabelSite.scene.setVisitorPaused(true)` holds the tour on its current shot, ends a dissolve in progress on its incoming shot, stops drift and cloud motion, and then stops rendering. `setVisitorPaused(false)` continues the same shot without a time jump. `BabelSite.scene.isVisitorPaused()` reads the state.
- A script may set `BabelSite.scene.visitorPausedPreference = true` before the scene loads; the pause applies at the reveal and keeps the first revealed frame.
- While paused, a resize, context restore or content change (model, map, shader, font) draws one still frame. Behind an open dialog only a resize does. Scroll never does.

## sceneDebug

With `sceneDebug=1`, `window.BabelSite.sceneDebug` is a plain, read-only status object. It adds no controls and loads no extra code.

| Field                                     | Meaning                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tier`, `initialTier`, `assetTier`        | Current profile tier, startup tier, and the tier models and maps were loaded for                                       |
| `requestedTier`, `overrideTier`           | From `quality`: the value read (`auto` when absent) and the fixed tier, or `null`                                      |
| `governorTier`, `reason`                  | Governor tier (its `low` is the resolution step) and why the profile last applied: `initial`, `resize` or `adaptive`   |
| `pixelRatio`, `caps`                      | Pixel ratio; the texture limits the startup tier was chosen from                                                       |
| `composition`, `compositionReason`        | Composition profile (`desktop`, `compact`, `tabletPortrait`, `portraitPhone`, `landscapePhone`); `resize`              |
| `architecture.tower`, `.tree`, `.lantern` | `{ kind, status, tier }`, plus `reason: "asset-unavailable"` on a fallback                                             |
| `lanternCommitted`                        | `true` once the supplied lantern is in the scene                                                                       |
| `ground`                                  | The slate maps: `{ status, tier, material }`, `material` naming their source                                           |
| `groundTreatment`                         | `slate` while the film is on, else `baseline`                                                                          |
| `rocks`                                   | `{ status, tier }`                                                                                                     |
| `mountains`                               | A plain string: `loading`, `ready` or `fallback`                                                                       |
| `shaders`                                 | Warm-up per label (`scene`, `ground`, `tower`, `tree`, `lantern`): `ready` or `unwarmed`                               |
| `cinematic`                               | `shot`, `selected`, `angle` (1-based), `current`, `film` and `tour`                                                    |
| `programs`, `renderFps`                   | Linked program count; frames drawn per second                                                                          |
| `environment`                             | The environment capture of the film sky: `status` (`none`, `ready` or `failed`) and `ms`, its time                     |
| `failure`                                 | `{ stage, message }` when the scene stopped for the title card; `stage` is `architecture:tower` or `architecture:tree` |

Status values:

| Field                | `status`                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `architecture.*`     | `procedural` until the first frame selects the startup tier's models, then `loading`, then `ready` or `fallback`                    |
| `ground`             | `procedural` (tier `low`) until the film starts, then `loading`, then `ready` or `fallback`; a fallback keeps the procedural ground |
| `rocks`, `mountains` | `loading`, then `ready` or `fallback`                                                                                               |

`rocks` appears once the rocks start loading (after the reveal, with the film on and the tree settled), and `mountains` once the film requests the ranges; its `fallback` means the ranges' chunk failed (the film shows no mountains) or a Meshy massif failed or did not arrive within 12 s (`MASSIFS.deadline`; the five procedural rings stand in). In `cinematic`, `selected` is `tower` or `tree`, `current` is `tower`, `tree`, `orbit` or `null` (nothing ready yet), and `tour` holds the tour's state and transition, or `null` when there is no tour (`tour` present with any value other than 3, 5 or 20).

## sceneLoader.state

On the live path, with or without `sceneDebug`, `window.BabelSite.sceneLoader.state` describes the loading line.

| Field      | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `status`   | `idle`, `loading`, `revealed`, `static` or `stalled` |
| `progress` | 0 to 1; at most 0.96 before the reveal               |
| `tier`     | Startup tier                                         |
| `roles`    | `["tower"]`, or `["tower", "tree"]` with `view=tree` |
| `bytes`    | Per role: `received`, `expected`, `done`             |
| `stages`   | `bundle` and `init`, each `true` once reached        |
| `built`    | Per role: `glb-parse`, `assembly`, `shaders`         |

## Capture recipe

Size the window first: the scene's size picks the shot's [variant](#viewport-variants) and safe area. Open `?quality=high|balanced&view=…&angle=…&tour=0&sceneDebug=1` (the explicit tier keeps the governor from stepping mid-capture) and wait until all of these hold:

- `#home-scene` has the `is-ready` class;
- `sceneDebug.cinematic.shot` names the shot;
- `sceneDebug.architecture.tower.status`, `.tree.status` and `.lantern.status` are `ready`, and `sceneDebug.lanternCommitted` is `true`;
- `sceneDebug.ground.status` is not `loading`;
- `sceneDebug.shaders.lantern` is `ready` or `unwarmed`;
- `sceneDebug.rocks.status` is `ready` or `fallback`.

Then advance a fixed number of frames before capturing. The flame and the cloud drift run on scene time. The drips keep their own clock, the `performance.now()` time between drawn ground frames ([terrain-build.js](../src/scene/terrain-build.js) `dripClock`). A deterministic capture therefore drives both the frame clock and `performance.now()` itself.
