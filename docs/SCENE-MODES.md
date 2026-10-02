# Scene modes

URL parameters, shots, pauses and the status objects used for review and captures. They select what the live scene shows; none of them bypasses a release gate. Terms such as dwell, resolution step and film are defined in the [Glossary](GLOSSARY.md).

## Parameters

Append them to the local preview, for example `http://127.0.0.1:4173/?view=tower&angle=1&tour=0`.

| Parameter    | Values                                      | Effect                                             |
| ------------ | ------------------------------------------- | -------------------------------------------------- |
| `view`       | `tower` (default), `tree`                   | Opening subject                                    |
| `angle`      | `1` to `4`                                  | Shot within the view                               |
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
| `view=tower&angle=1` | The watch        | 9 s   | yes, first   |
| `view=tower&angle=2` | Threshold        | 7 s   | yes          |
| `view=tower&angle=3` | Masonry study    | 7 s   | no, URL only |
| `view=tower&angle=4` | Gallery detail   | 7 s   | yes          |
| `view=tree&angle=1`  | Portrait         | 9 s   | yes          |
| `view=tree&angle=2`  | Lantern study    | 6 s   | yes          |
| `view=tree&angle=3`  | Close-up         | 6 s   | yes          |
| `view=tree&angle=4`  | Root and lantern | 6 s   | yes          |

The tour runs in table order, about 50 s a loop. Each shot drifts and pushes in, then dissolves into the next over 1 s (or 30% of a shorter dwell), staggered by depth. A missing subject's shots are skipped. Shot intent and dwells live in [directed-shots.js](../src/scene/directed-shots.js), fitting and drift in [cinematic.js](../src/scene/cinematic.js), pacing in [camera-tour.js](../src/scene/camera-tour.js) and the dissolve in [postprocess.js](../src/scene/postprocess.js).

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

`rocks` appears once the rocks start loading (after the reveal, with the film on and the tree settled), and `mountains` once the film requests the ranges. In `cinematic`, `selected` is `tower` or `tree`, `current` is `tower`, `tree`, `orbit` or `null` (nothing ready yet), and `tour` holds the tour's state and transition, or `null` when there is no tour (`tour` present with any value other than 3, 5 or 20).

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

Open `?quality=high|balanced&view=…&angle=…&tour=0&sceneDebug=1` (the explicit tier keeps the governor from stepping mid-capture) and wait until all of these hold:

- `#home-scene` has the `is-ready` class;
- `sceneDebug.cinematic.shot` names the shot;
- `sceneDebug.architecture.tower.status`, `.tree.status` and `.lantern.status` are `ready`, and `sceneDebug.lanternCommitted` is `true`;
- `sceneDebug.ground.status` is not `loading`;
- `sceneDebug.shaders.lantern` is `ready` or `unwarmed`;
- `sceneDebug.rocks.status` is `ready` or `fallback`.

Then advance a fixed number of frames before capturing. The flame, drips and cloud drift run on scene time, so a deterministic capture drives the frame clock itself.
