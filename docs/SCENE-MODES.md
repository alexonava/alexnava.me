# Scene modes

URL parameters, shots, pauses and the status objects used for review and captures. They select what the live scene shows; none of them bypasses a release gate.

## Parameters

Append them to the local preview, for example `http://127.0.0.1:4173/?view=tower&angle=1&tour=0`.

| Parameter    | Values                                      | Effect                                           |
| ------------ | ------------------------------------------- | ------------------------------------------------ |
| `view`       | `tower` (default), `tree`                   | Opening subject                                  |
| `angle`      | `1` to `4`                                  | Shot within the view                             |
| `tour`       | absent, `3`, `5`, `20`, `0`                 | Per-shot holds, a fixed hold in seconds, or none |
| `quality`    | `auto` (default), `high`, `balanced`, `low` | Startup tier                                     |
| `sceneDebug` | `1` or `true`                               | Publishes `BabelSite.sceneDebug`                 |

- Any other `view` opens the tower, and a missing or invalid `angle` the first shot. A `tour` value other than 3, 5 or 20 holds the opening shot. At `tour=3` the dissolve takes 0.9 s.
- `quality=high|balanced` and `sceneDebug` load the live scene past the reduced-motion, reduced-data and software-renderer gates, never without WebGL; `sceneDebug` keeps the detected tier. `quality=low` keeps the title card.

## Shots

| URL                  | Shot             | Hold | In the tour  |
| -------------------- | ---------------- | ---- | ------------ |
| `view=tower&angle=1` | The watch        | 9 s  | yes, first   |
| `view=tower&angle=2` | Threshold        | 7 s  | yes          |
| `view=tower&angle=3` | Masonry study    | 7 s  | no, URL only |
| `view=tower&angle=4` | Gallery detail   | 7 s  | yes          |
| `view=tree&angle=1`  | Portrait         | 9 s  | yes          |
| `view=tree&angle=2`  | Lantern study    | 6 s  | yes          |
| `view=tree&angle=3`  | Close-up         | 6 s  | yes          |
| `view=tree&angle=4`  | Root and lantern | 6 s  | yes          |

The tour runs in table order, about 50 s a loop. Each shot drifts and pushes in, then dissolves into the next over 1 s (or 30% of a shorter hold), staggered by depth. A missing subject's shots are skipped. Shot intent and holds live in [directed-shots.js](../src/scene/directed-shots.js), fitting and drift in [cinematic.js](../src/scene/cinematic.js), pacing in [camera-tour.js](../src/scene/camera-tour.js) and the dissolve in [postprocess.js](../src/scene/postprocess.js).

## Tour and pauses

- An open dialog holds the tour at once; 450 ms later, after the dim overlay has faded in, rendering stops until the last dialog closes.
- A hidden tab or an off-screen canvas renders nothing. Reduced motion holds camera motion when the live scene runs at all (only with `quality` or `sceneDebug`).
- `BabelSite.scene.setVisitorPaused(true)` holds the tour on its current shot, ends a dissolve in progress on its incoming shot, stops drift and cloud motion, and then stops rendering. `setVisitorPaused(false)` continues the same shot without a time jump. `BabelSite.scene.isVisitorPaused()` reads the state.
- A script may set `BabelSite.scene.visitorPausedPreference = true` before the scene loads; the pause applies at the reveal and keeps the first revealed frame.
- While paused or held, a resize, context restore or content change (model, map, shader, font) draws one still frame; scroll does not.

## sceneDebug

With `sceneDebug=1`, `window.BabelSite.sceneDebug` is a plain, read-only status object. It adds no controls and loads no extra code.

| Field                                     | Meaning                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `tier`, `initialTier`, `assetTier`        | Current profile tier, startup tier, and the tier models and maps were loaded for           |
| `requestedTier`, `overrideTier`           | From `quality`                                                                             |
| `governorTier`, `reason`                  | Governor tier (`low`: pixel ratio only) and last change                                    |
| `pixelRatio`, `caps`                      | Pixel ratio; the probe's limits                                                            |
| `composition`, `compositionReason`        | Composition profile and why it was chosen                                                  |
| `architecture.tower`, `.tree`, `.lantern` | Each with `status`: `loading`, `ready` or `fallback`                                       |
| `lanternCommitted`                        | `true` once the supplied lantern is in the scene                                           |
| `ground`, `groundTreatment`               | Slate map status (`status` field); `slate` or `baseline`                                   |
| `rocks`, `mountains`                      | Rock status (`status` field); `loading`, `ready` or `fallback`                             |
| `shaders`                                 | Warm-up per label (`scene`, `ground`, `tower`, `tree`, `lantern`): `ready` or `unwarmed`   |
| `cinematic`                               | `shot`, `selected`, `angle` (1-based), `current`, `film` and `tour` (state and transition) |
| `programs`, `renderFps`                   | Linked program count; frames drawn per second                                              |
| `environment`                             | The film sky's capture: `status` (`none`, `ready` or `failed`) and `ms`, its time          |
| `failure`                                 | `{ stage, message }` when the scene stopped for the title card                             |

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

Open `?quality=high|balanced&view=…&angle=…&tour=0&sceneDebug=1` and wait until all of these hold:

- `#home-scene` has the `is-ready` class;
- `sceneDebug.cinematic.shot` names the shot;
- `sceneDebug.architecture.tower.status`, `.tree.status` and `.lantern.status` are `ready`, and `sceneDebug.lanternCommitted` is `true`;
- `sceneDebug.ground.status` is not `loading`;
- `sceneDebug.shaders.lantern` is `ready` or `unwarmed`;
- `sceneDebug.rocks.status` is `ready` or `fallback`.

Then advance a fixed number of frames before capturing. The flame, drips and cloud drift run on scene time, so a deterministic capture drives the frame clock itself.
