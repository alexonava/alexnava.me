# Scene modes

URL parameters, shots, pauses and the status objects used for review and captures. They select what the live scene shows; none of them bypasses a release gate. Terms such as dwell, resolution step and film are defined in the [Glossary](GLOSSARY.md).

## Parameters

Append them to the local preview, for example `http://127.0.0.1:4173/?view=tree&angle=1&tour=0`.

| Parameter    | Values                                      | Effect                                             |
| ------------ | ------------------------------------------- | -------------------------------------------------- |
| `view`       | `watch`, `tree`                             | Opening subject                                    |
| `angle`      | `1` (watch), `1` to `4` (tree)              | Shot within the view                               |
| `tour`       | absent, `3`, `5`, `20`, `0`                 | Per-shot dwells, a fixed dwell in seconds, or none |
| `quality`    | `auto` (default), `high`, `balanced`, `low` | Startup tier; an explicit tier pins the governor   |
| `sceneDebug` | `1` or `true`                               | Publishes `BabelSite.sceneDebug`                   |

- With neither `view` nor `angle`, an ordinary live visit opens Lantern study (`tree`, public angle 2) or The watch, by chance: main.js `chooseOpening()` rolls once, before the loading line begins, unless a script has chosen first (the owner's pick of 2026-10-26). An explicit `view=watch` or `view=tree` with a missing or invalid `angle` opens that subject's first shot. Any other explicit `view` opens the watch (`view=tower`, from before the owner left the lookout out, among them); a bare `angle` retains that same legacy Watch fallback. A `tour` value other than 3, 5 or 20 stays on the opening shot. At `tour=3` the dissolve takes 0.9 s. Any other `quality` value reads as `auto`.
- `quality=high|balanced` loads the live scene past the reduced-motion, reduced-data and software-renderer gates, never without WebGL or while forced colours are active, and pins the tier: the governor takes no adaptive step, not even the resolution step (pixel ratio only).
- `sceneDebug` loads the live scene past the reduced-motion and software-renderer gates only: with a reduced-data preference the startup tier is still low, which keeps the title card (when the probe could not read the texture limits, main.js downloads the scene bundle first and `initHomeScene()` declines). It keeps the detected tier and the governor. Clearing reduced data alone does not recover a static startup selected under `sceneDebug`. Forced colours always block startup, including explicit quality or debug overrides; when they clear, main.js rechecks the remaining gates and starts once if eligible.
- `quality=low` keeps the title card, with or without `sceneDebug`.

## Shots

| URL                  | Shot             | Dwell | In the tour |
| -------------------- | ---------------- | ----- | ----------- |
| `view=watch&angle=1` | The watch        | 9 s   | 6th         |
| `view=tree&angle=1`  | Portrait         | 9 s   | 7th         |
| `view=tree&angle=2`  | Lantern study    | 6 s   | 1st         |
| `view=tree&angle=3`  | Close-up         | 6 s   | 3rd         |
| `view=tree&angle=4`  | Root and lantern | 6 s   | 4th         |
| none, with the sea   | The broken coast | 7 s   | 8th         |
| none, with the sea   | The falls        | 7 s   | 2nd         |
| none, with the sea   | Over the fault   | 7 s   | 5th         |

The static `TOUR_ORDER` in camera-tour.js rotates the five anchors to Lantern study, Close-up, Root and lantern, The watch and Portrait, about 36 s a loop. Public angle addresses and circular adjacency retain their meanings. The fault's three shots (`COAST_SHOTS`, in the terrain's lazy chunk) join the tree list when the sea lands and leave it with the sea: The broken coast after Portrait, The falls after Lantern study and Over the fault after Root and lantern. The complete eight-shot order appears in the table, about 57 s a loop; the coast shots have no URL. Their own `measure` and `fit` place their camera and aim in the estate frame, and the fit's `shadow` centres the film shadow on the visible land. All eight cameras retain the preferred before framing, including their viewport variants.

### Viewport variants

The scene's size picks each shot's variant (directed-shots.js `resolveDirectedShot`), so set the window size before a capture. Each variant overrides some of the shot's framing; a shot without the chosen variant keeps its own.

| Scene size (CSS px)                                                                                                                          | Variant                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Taller than wide, or a stacked layout (`isStackedLayout`: portrait or square up to 1024 wide, or landscape under 600 wide and over 500 tall) | `portrait`                                |
| Taller than wide and over 1024 wide (a portrait monitor, the name below the subject), such as 1080×1920                                      | `tall` over `portrait`                    |
| Stacked from 600 wide (`TABLET_WIDTH`: portrait tablets, and squares up to 1024 wide), such as 820×1180                                      | `tablet` over `portrait`, else `portrait` |
| Landscape up to 500 tall and narrower than 1.55:1 (`SQUAT_LANDSCAPE`), such as 599×499 or 700×480                                            | `squat`, else `portrait`                  |
| Landscape up to 500 tall, at least 1.55:1 and under 600 wide, such as 568×320                                                                | `compact`, else `landscape`               |
| Landscape up to 500 tall, at least 1.55:1, from 600 wide, such as 844×390                                                                    | `landscape`                               |
| Landscape from 1000 wide and over 500 tall, bars over 2% (narrower than about 2.29:1), such as 1440×900 (letterboxed)                        | `letterbox`, else the shot                |
| Anything else, such as 2560×1080 or a square over 1024                                                                                       | None: the shot itself                     |

Every shot has a `portrait` variant; Portrait's changes its move (a push without the sideways truck, so the subject keeps its size on a narrow screen) and sets the tree on the lower third, turned toward the banks (the owner's pick of 2026-10-14, −38°, then −40°) so the tall frame reaches up into them, clear sky above the tree from −72°: on phones it stands at −41.75° with a quarter-degree orbit, the tree a little left of centre (anchor 0.39, margin 0.97), and looks from higher (camera `height` 0.38, the base's 0.12 elsewhere) over the root at the lantern, so the lantern's glass and flame stand clear of the root through the push (the owner's rule: the lantern first; directed-shots.js `PORTRAIT_PHONE`); its `tablet` and `tall` variants, wider frames that reach further round, orbit from −44° to −43° with the tree right of centre (anchor 0.6; `PORTRAIT_WIDE`), and its `squat` from −43.5° to −42.5° (anchor 0.58), so no edge cuts a snowy summit, a massif's or the backdrop rings', and the snowy horn stands whole beside the trunk, never behind the crown. On phones the far range's small snowy tips pass behind the trunk and the lower crown through the push. Lantern study's keeps the −115° axis; The watch's aims left of centre from −12° with the star whole to its right (its `tablet` variant a little further right, anchor 0.31), fitting the stored outline's core (a narrower `focus`), and keeps the gentler dolly zoom (44 to 38 degrees, the wider one crops the star there). Every moving shot's `landscape` variant drops its move (`move: null`; The watch loses its tilt with it). The lantern shots' `landscape` keep a centred aim. The watch's `squat` holds still, aimed further left, the star whole; its `landscape` and `compact` fit from a little higher up. The `compact` variant is unrelated to the `compact` composition profile in `sceneDebug.composition`. The safe area the shot is fitted in follows the hero's layout too ([Contracts](CONTRACTS.md#hero-breakpoints)). Portrait monitors (over 1024 wide) set the name below the subject, where phones set it above, so a shot's `tall` variant reframes them alone: Close-up's turns to −170.5° and looks from higher (`height` 0.46), the trunk a little larger (margin 0.96) and right of centre, the aim lower (anchor 0.6, 0.555), so the trunk keeps 24 px or more off the name and the intro through the push, the roots and the lantern stay below the frame and the ranges stand wholly above the name (the reviews of 2026-10-14 and 2026-10-15); The watch takes its portrait framing there. Tablets (stacked layouts from 600 wide, `TABLET_WIDTH`) take a shot's `tablet` variant over its portrait one in the same way: The watch's and Portrait's.

The falls' portrait variant uses azimuth −55°, reach 44, rise 24 and a 62° lens cap. Tablets, tall monitors and squat windows resolve that same portrait preset; there are no separate overrides. Desktop uses azimuth −44°, reach 33, rise 10.25 and a 48° cap; short landscape phones hold still from −55°, reach 42 and rise 15. Its fit includes the delivered falling volume and pool/spray envelope and keeps one stable lens throughout the move. Over the fault retains its separate wide view down the bay, with aim [90, −8.75, 90], azimuth −125°, reach 45, rise 23.25 and a 58° lens. Dwells, tour order, transitions and visitor controls retain their meanings.

Lantern study's `portrait` variant fits wider (margin 0.5) and aims up and right (anchor 0.62, 0.62), so on phones the root arching over the lantern stands in the frame with it (the owner's ask of 2026-10-27). The broken coast pans 18° right through its move (`pan` [18, 18]) to take in the river and its falls; its `portrait` variant keeps its aim, the dolly alone, and the coast's own exposure.

Besides its framing a shot can carry, applied on the cut: `light` (its mood), `look` (its grade's exposure, contrast and mid and its sky light's shares, film-light.js `shotLook()`), `sun` (Close-up, Root and lantern and The broken coast: the star, the key and the sky's plate come from that direction), `fill` (Close-up's warm fill from the lens's side) and `growth` (Lantern study: the plain's growth shows; [Style](STYLE.md#materials-and-lighting)).

Lantern study's light is placed by the supplied lantern's stored outline ([opening-lantern.js](../src/scene/opening-lantern.js)), which needs no key: every form of the shot frames the whole lantern, all `measureShot()` reads of it.

The watch's variants also key its stored outline, the lookout's, which frames it and places the loading line's star before the scene commits it ([opening-outline.js](../src/scene/opening-outline.js), [Architecture](ARCHITECTURE.md#title-card-and-loading-line)). The outline is fixed data now the lookout is gone: a change to The watch's region, focus, azimuth, height or target height (`DIRECTED_SHOTS.watch[0]` or its variants) finds no outline, and `test/opening-star.test.mjs` fails.

## Tour and pauses

A Lantern study opening is prepared behind the title card. Its subjects, supplied or fallback lantern, coastal terrain, material maps, root and bank detail, foreground through the complete current move, rocks and final program preparation settle before reveal. Independent of the loading line, 15 s without progress fails the opening, and one 30 s visible-time budget covers entry/shared downloads, setup and preparation together. Hidden tabs and static-preference pauses spend no time; an eligible preference recovery keeps the time already spent. A timed-out download cannot initialize the scene later. Failure returns to the title card and cleans pending scene resources. Camera and tour phase stay at zero until reveal, then the existing 6 s Lantern study hold begins. A preselected visitor pause keeps that complete prepared first frame. The other native dwells remain unchanged.

- Nothing on the page holds the revealed scene, Contact included: its tour holds only for a visitor pause, reduced motion and the walk, and rendering stops only behind a visitor pause (below). Before reveal, the independent preparation gate keeps the opening camera at phase zero and resets the tour for its complete visible dwell.
- A hidden tab or an off-screen canvas renders nothing. Reduced motion holds camera motion whenever the live scene runs with it: forced by `quality=high|balanced` or `sceneDebug`, or turned on after the scene loaded.
- `BabelSite.scene.setVisitorPaused(true)` holds the tour on its current shot, ends a dissolve in progress on its incoming shot, stops drift and cloud motion, and then stops rendering. `setVisitorPaused(false)` continues the same shot without a time jump. `BabelSite.scene.isVisitorPaused()` reads the state.
- A script may set `BabelSite.scene.visitorPausedPreference = true` before the scene loads; the pause applies at the reveal and keeps the first revealed frame.
- While paused, a resize, context restore or content change (model, map, shader, font) draws one still frame. Scroll never does.

## Walk

An unannounced visitor's mode ([walk.js](../src/scene/walk.js), a lazy chunk fetched on the first press; nothing on the page mentions it).

- **Start.** ` or ~ (the Backquote key, or a layout that types either) over the revealed live scene with its film ground in place. It never starts on a touch-primary or coarse pointer, under reduced motion, a visitor pause or forced colors ([walk-key.js](../src/scene/walk-key.js)). The press captures the mouse; where the browser refuses, a held button drags the view.
- **In.** The page fades off the canvas (`body.scene-walking`, `.scene-walk-hidden`; its boxes keep their layout), the tour finishes any dissolve and holds, and from the next cut the visitor stands on the ground under the shot's camera, facing its subject, under the film's dissolve; the bars ease out with it.
- **Controls.** The mouse looks around; W/S or the up and down arrows walk, A/D step aside, the left and right arrows turn, Shift jogs, Space jumps. The trunk with its root flare, the lantern and every rock at least 0.5 tall are solid; the river and stream are wadeable. The main film river has a metre-deep centre away from protected supports, shoaling to half a metre at the falls, with a separate visible water surface. The feet follow only the solid bed triangles, so the upper water cap does not become a walking floor; the existing eye height and landing dip retain clearance above the water. Elsewhere the feet stand on the film terrain's own surface out to its edge (terrain-build.js `settleRoots()`'s height). Outward motion fades between 104 and 114 units from the watch's terrace, inside the sky's shell, and toward the sea from 6 units of the cliffs' lip, so the visitor can walk out along the cliffs and look down at the surf, the stacks and the river's falls but stops 1.2 units short of the edge (`WALK.bound`, against the fault's distance index.js lends from the terrain).
- **Out.** The same key, or Esc twice (the first frees the mouse), dissolves back to the tour's held shot without a time jump, and the page fades back. A visitor pause, reduced motion, forced colours or a lost GL context ends it at once, with a hard cut. Forced colours restore the page and release mouse capture even while the walk is arming; if its module is still downloading, the entry guard declines the walk and releases capture when that import settles.
- **While walking** no shot is on screen: the light mood, look and fill, lens, lens sources, mist share and ground calm rest at their defaults (the film's own grade), the text guards rest (there is no text), and content that lands only unseen waits for the walk's cuts. The key's shadow follows a snapped point ahead of the walker (`WALK.shadow`), so its map redraws only on a cell change.

## sceneDebug

With `sceneDebug=1`, `window.BabelSite.sceneDebug` is a plain, read-only status object. It adds no controls and loads no extra code.

Its `opening` snapshot reports the preparation gate's `{ status, completed, total, stage, reason }`; the required close-opening work and independent visible-time deadlines are described above. The final `shaders.opening` warm-up must be ready with parallel linking; a renderer without that extension prepares the same final materials through a real hidden draw before reveal.

| Field                                     | Meaning                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tier`, `initialTier`, `assetTier`        | Current profile tier, startup tier, and the tier models and maps were loaded for                                                                                                                                                                             |
| `requestedTier`, `overrideTier`           | From `quality`: the value read (`auto` when absent) and the fixed tier, or `null`                                                                                                                                                                            |
| `governorTier`, `reason`                  | Governor tier (its `low` is the resolution step) and why the profile last applied: `initial`, `resize` or `adaptive`                                                                                                                                         |
| `pixelRatio`, `caps`                      | Pixel ratio; the texture limits the startup tier was chosen from                                                                                                                                                                                             |
| `composition`, `compositionReason`        | Composition profile (`desktop`, `compact`, `tabletPortrait`, `portraitPhone`, `landscapePhone`); `resize`                                                                                                                                                    |
| `architecture.watch`, `.tree`, `.lantern` | `{ kind, status, tier }`, plus a fallback `reason` such as `asset-unavailable` or an opening deadline                                                                                                                                                        |
| `lanternCommitted`                        | `true` once the supplied lantern is in the scene                                                                                                                                                                                                             |
| `ground`                                  | The slate maps: `{ status, tier, material }`, `material` naming their source                                                                                                                                                                                 |
| `groundTreatment`                         | `slate` while the film is on, else `baseline`                                                                                                                                                                                                                |
| `rocks`                                   | `{ status, tier }`                                                                                                                                                                                                                                           |
| `mountains`                               | A plain string: `loading`, `ready` or `fallback`                                                                                                                                                                                                             |
| `sea`                                     | `ready` once the sea, the cliffs and the falls have landed with the film terrain ([ocean.js](../src/scene/ocean.js)); absent before landing and while film is inactive                                                                                       |
| `shaders`                                 | Warm-up per label (`scene`, `ground`, `watch`, `tree`, `lantern`, `opening`): `ready` or `unwarmed`                                                                                                                                                          |
| `cinematic`                               | `shot`, `selected`, `angle` (1-based), `current`, `film` and `tour`                                                                                                                                                                                          |
| `programs`, `renderFps`                   | Linked program count; frames drawn per second                                                                                                                                                                                                                |
| `environment`                             | The environment capture of the film sky: `status` (`none`, `ready` or `failed`) and `ms`, its time                                                                                                                                                           |
| `lightning`                               | The lightning's own clock (`time`, s), the flash's `level` and the lit `event` (`k`, `start`, `bolt` whether a bolt draws, `wanted` whether the event asked for one, `height` the share of its full height it kept, view `azimuth` and `altitude`) or `null` |
| `failure`                                 | `{ stage, message }` when the scene stopped for the title card; `stage` is `architecture:watch`, `architecture:tree`, `opening`, `terrain` or `shaders`                                                                                                      |
| `walk`                                    | `null` until the first walk; then `phase` (`idle`, `arming`, `capture`, `walking`, `leaving`, `returning`), the feet's `x`, `y`, `z`, `yaw`, `pitch`, `grounded`, `locked` (mouse captured) and the solids' `circles`                                        |

Status values:

| Field                | `status`                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `architecture.*`     | `procedural` until the first frame selects the startup tier's models, then `loading`, then `ready` or `fallback`                    |
| `ground`             | `procedural` (tier `low`) until the film starts, then `loading`, then `ready` or `fallback`; a fallback keeps the procedural ground |
| `rocks`, `mountains` | `loading`, then `ready` or `fallback`                                                                                               |

`rocks` appears once the rocks start loading (during preparation for a close tree opening, otherwise after reveal with the film on and the tree settled), and `mountains` once the film requests the ranges; its `fallback` means the ranges' chunk failed (the film shows no mountains) or a massif failed or did not arrive within 12 s (`MASSIFS.deadline`; the five procedural rings stand in). In `cinematic`, `selected` is `watch` or `tree`, `current` is `watch`, `tree`, `orbit` or `null` (nothing ready yet), and `tour` holds the tour's state and transition, or `null` when there is no tour (`tour` present with any value other than 3, 5 or 20).

## sceneLoader.state

On the live path, with or without `sceneDebug`, `window.BabelSite.sceneLoader.state` describes the loading line and its star.

| Field         | Meaning                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`      | `idle`, `loading`, `revealed`, `static` or `stalled`                                                                                                                                                         |
| `progress`    | 0 to 1; at most 0.96 before the reveal                                                                                                                                                                       |
| `tier`        | Startup tier                                                                                                                                                                                                 |
| `roles`       | `["watch"]`, or `["watch", "tree"]` for a resolved tree opening, including a rolled Lantern study and script selection                                                                                       |
| `bytes`       | Per required model role (the tree for a tree opening): `received`, `expected`, `done`                                                                                                                        |
| `stages`      | `bundle` and `init`, each `true` once reached                                                                                                                                                                |
| `preparation` | `null` before the scene gate reports, otherwise `{ status, completed, total, stage, reason }`; ready preparation still waits for reveal, while fallback or failure retires the line                          |
| `built`       | Per role: `glb-parse`, `assembly`, `shaders`                                                                                                                                                                 |
| `star`        | The last valid star report, `{ x, y, radius, width, height }` in CSS px from the canvas's top-left, with `kind: "lantern"` when it is the lantern's light, or `null` while the light is unknown or withdrawn |

## Capture recipe

Size the window first: the scene's size picks the shot's [variant](#viewport-variants) and safe area. Open `?quality=high|balanced&view=…&angle=…&tour=0&sceneDebug=1` (the explicit tier keeps the governor from stepping mid-capture) and wait until all of these hold:

- `#home-scene` has the `is-ready` class;
- `sceneDebug.cinematic.shot` names the shot;
- `sceneDebug.architecture.watch.status`, `.tree.status` and `.lantern.status` are `ready`, and `sceneDebug.lanternCommitted` is `true`;
- `sceneDebug.ground.status` is not `loading`;
- `sceneDebug.shaders.lantern` is `ready` or `unwarmed`;
- `sceneDebug.rocks.status` is `ready` or `fallback`.

Then advance a fixed number of frames before capturing. The flame, the cloud drift and the lightning run on scene time; the lightning's schedule is seeded, and a capture can force a flash to peak at a phase ([lightning.js](../src/scene/lightning.js) `LIGHTNING.forceAt`, empty in use). The drips keep their own clock, the `performance.now()` time between drawn ground frames ([terrain-build.js](../src/scene/terrain-build.js) `dripClock`). A deterministic capture therefore drives both the frame clock and `performance.now()` itself.

Automatic per-frame quality may reach DPR 1 or 0.85 while retaining balanced
materials; downloaded assets remain pinned to the initial tier. Explicit `quality`
overrides remain fixed. Hidden presentation renders can request relief before
reveal; each accepted change resets final preparation and its fresh draw window.
The tour and first-shot move start only when the paper actually begins parting.
