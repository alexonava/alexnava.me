# Scene modes

URL parameters, shots, pauses and the status objects used for review and captures. They select what the live scene shows; none of them bypasses a release gate. Terms such as dwell, resolution step and film are defined in the [Glossary](GLOSSARY.md).

## Parameters

Append them to the local preview, for example `http://127.0.0.1:4173/?view=tower&angle=1&tour=0`.

| Parameter    | Values                                      | Effect                                             |
| ------------ | ------------------------------------------- | -------------------------------------------------- |
| `view`       | `tower` (default), `tree`                   | Opening subject                                    |
| `angle`      | `1` to `6` (tower), `1` to `4` (tree)       | Shot within the view                               |
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
| `view=tower&angle=6` | Against the moon | 7 s   | no, URL only |
| `view=tree&angle=1`  | Portrait         | 9 s   | 2nd          |
| `view=tree&angle=2`  | Lantern study    | 6 s   | 3rd          |
| `view=tree&angle=3`  | Close-up         | 6 s   | 5th          |
| `view=tree&angle=4`  | Root and lantern | 6 s   | 6th          |

The tour alternates the lookout and the tree, while it can, in the order of the last column (camera-tour.js `TOUR_ORDER`), about 43 s a loop; Portrait then Lantern study and Close-up then Root and lantern are the two pairs of tree shots together. A shot outside the tour, opened by URL, is followed by The watch. Watch and tree left the tour on the owner's call of 2026-10-08, and Against the moon (the owner's pick of 2026-10-12, appended to the lookout's shots so earlier URLs keep their angles) on the owner's call of 2026-10-14; both keep their URLs and framings. Under the milky sky (the owner's direction of 2026-10-11, STYLE.md): the lookout's two tour shots look up at it from its foot (camera `height` 0.1, a 44° lens, the aim about a third down the safe area) and share one move, a dolly-in as the gaze lifts (directed-shots.js `GIANT`; The watch makes its push a dolly zoom); the tree's shots keep their own framings, which show the water (the owner's call of 2026-10-12). Watch and tree tilts up 3 degrees through its dwell (5 in squat windows, a third of a degree on letterboxed desktops), rising into its composition (the shot's `tilt`). A shot's `anchor` sets where its aim lands in the safe area, as shares of the area's width and height (its centre unless set), so a subject can stand on a third: The watch, Threshold, Watch and tree, Lantern study, Close-up and Root and lantern place theirs, Portrait on phones, and the kept frame of a dissolve pushes in about that point. A move's `tilt` pitches the camera about its own horizontal axis after it looks at its aim, on the move's eased path (`shotPose`), and the fit holds the tilted poses, so the lookout stays in the safe area as the gaze lifts. A shot's own `tilt` pitches the camera after the fit, so its aim moves off its anchor through the hold. A move's `pan` turns the lens in place, in degrees to the right (negative to the left), before it looks at its aim, the camera standing still, and the fit holds the panned poses (directed-shots.js `shotPose`, `fitShot`; cinematic.js `apply`). Every pan ends at 0, so the next cut composes on the shot's anchor: Threshold opens turned toward the star and pans onto the lookout, and Close-up turns to hold its crown as it trucks. Portrait and Watch and tree calm the plain about their subject (the shot's `ground`, mud-ground.js `slateCalmFor`); Portrait's `ground` also sets its look: a moonlit `clearing`, low `mist` (on the ranges' feet too), the `gloss` of rain and a softer crown `shadow` (mud-ground.js `SLATE_LOOK`); the other wide shots take a lighter, warm grey `mist` and the `gloss` untinted (its `cool` 0; directed-shots.js `AFTER_RAIN`). Each shot drifts and pushes in, then dissolves into the next over 1 s (or 30% of a shorter dwell), staggered by depth. A missing subject's shots are skipped. Shot intent and dwells live in [directed-shots.js](../src/scene/directed-shots.js), fitting and drift in [cinematic.js](../src/scene/cinematic.js), pacing in [camera-tour.js](../src/scene/camera-tour.js) and the dissolve in [postprocess.js](../src/scene/postprocess.js).

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

Every shot has a `portrait` variant; Portrait's changes its move (a push without the sideways truck, so the subject keeps its size on a narrow screen) and sets the tree on the lower third, turned toward the banks (the owner's pick of 2026-10-14, −38°, then −40°) so the tall frame reaches up into them, clear sky above the tree from −72°: on phones it stands at −41.75° with a quarter-degree orbit, the tree a little left of centre (anchor 0.39, margin 0.97), and looks from higher (camera `height` 0.38, the base's 0.12 elsewhere) over the root at the lantern, so the lantern's glass and flame stand clear of the root through the push (the owner's rule: the lantern first; directed-shots.js `PORTRAIT_PHONE`); its `tablet` and `tall` variants, wider frames that reach further round, orbit from −44° to −43° with the tree right of centre (anchor 0.6; `PORTRAIT_WIDE`), and its `squat` from −43.5° to −42.5° (anchor 0.58), so no edge cuts a snowy summit, a massif's or the backdrop rings', and the snowy horn stands whole beside the trunk, never behind the crown. On phones the far range's small snowy tips pass behind the trunk and the lower crown through the push. Lantern study's keeps the −115° axis; The watch's stands the lookout left of centre from −12° with the star whole to its right (its `tablet` variant a little further right, anchor 0.31, so the deck's end keeps 20 CSS px or more off a tablet's left edge), and Threshold's turns to 64° (nearer, the tree stood between the lens and the lookout), both fitting the lookout's core (a narrower `focus`); The watch's keeps the gentler dolly zoom (44 to 38 degrees, the wider one crops the star there), Threshold's pans 2 degrees rather than 5, and Against the moon's turns to −135 degrees, so the star overhead stays out of the tall frame. Every moving shot's `landscape` variant drops its move (`move: null`; the lookout's lose its tilt with it). Watch and tree's `portrait` (55 degrees) keeps the lookout on the left third with the tree whole to its right, fitted a little larger (margin 0.62), and tilts from 4 degrees down to half a degree down; its `landscape` turns further round (75 degrees) and tilts 3 degrees; its `squat` and `compact` (−15 degrees) see the pair mirrored, the tree left of the lookout and the star whole beyond it, clear of the name. The lantern shots' `landscape` keep a centred aim. The watch's and Threshold's `squat` hold still (The watch aimed further left, Threshold turned to 48 degrees), the star whole clear of the cab; both lookouts' `landscape` and `compact` fit from a little higher up, their footing below the short frame (Threshold's `compact` at 46 degrees); Watch and tree has a `compact` too. The `compact` variant is unrelated to the `compact` composition profile in `sceneDebug.composition`. The safe area the shot is fitted in follows the hero's layout too ([Contracts](CONTRACTS.md#hero-breakpoints)). Portrait monitors (over 1024 wide) set the name below the subject, where phones set it above, so a shot's `tall` variant reframes them alone: Threshold's stands the lookout right of the name (anchor 0.6, 0.6), fitted smaller (margin 0.78) and lower, its pan held to its last half degree (−2 to −1.5), so the cab keeps 40 CSS px or more off the right edge, the far leg 24 px or more off the intro and the ranges' crests out of the text, and Close-up's turns to −170.5° and looks from higher (`height` 0.46), the trunk a little larger (margin 0.96) and right of centre, the aim lower (anchor 0.6, 0.555), so the trunk keeps 24 px or more off the name and the intro through the push, the roots and the lantern stay below the frame and the ranges stand wholly above the name (the reviews of 2026-10-14 and 2026-10-15); The watch takes its portrait framing there. Tablets (stacked layouts from 600 wide, `TABLET_WIDTH`) take a shot's `tablet` variant over its portrait one in the same way: The watch's and Portrait's. Threshold's squat variant aims 1.5° up so the ranges' crests drop below the frame. Two URL-only shots have a `letterbox` variant: Masonry study's letterboxed desktops aim a degree lower (the snow clear of the name), and Watch and tree's hold about its base's mean pitch with a smaller swing, −4.8 to −4.5 degrees, so the star keeps 22 CSS px or more below the top bar at 1440×900 and the ranges' crests stay above the name's letters there through the whole breath of the URL view; its phones' half degree down at the top of that breath and their slightly larger fit keep the sky shell's faceted rim out of the top corner, on short phones with the browser's bars showing too.

The watch's variants also key the tower's stored outline, which places the loading line's star before the tower loads ([opening-outline.js](../src/scene/opening-outline.js), [Architecture](ARCHITECTURE.md#title-card-and-loading-line)). After a change to The watch's framing (`DIRECTED_SHOTS.tower[0]` or its variants), run `node tools/bake-opening-outline.mjs` ([Architecture](ARCHITECTURE.md#tools)); `test/opening-star.test.mjs` fails until you do.

## Tour and pauses

- Nothing on the page holds the scene, Contact included: the tour holds only for a visitor pause, reduced motion and the walk, and rendering stops only behind a visitor pause (below).
- A hidden tab or an off-screen canvas renders nothing. Reduced motion holds camera motion whenever the live scene runs with it: forced by `quality=high|balanced` or `sceneDebug`, or turned on after the scene loaded.
- `BabelSite.scene.setVisitorPaused(true)` holds the tour on its current shot, ends a dissolve in progress on its incoming shot, stops drift and cloud motion, and then stops rendering. `setVisitorPaused(false)` continues the same shot without a time jump. `BabelSite.scene.isVisitorPaused()` reads the state.
- A script may set `BabelSite.scene.visitorPausedPreference = true` before the scene loads; the pause applies at the reveal and keeps the first revealed frame.
- While paused, a resize, context restore or content change (model, map, shader, font) draws one still frame. Scroll never does.

## Walk

An unannounced visitor's mode ([walk.js](../src/scene/walk.js), a lazy chunk fetched on the first press; nothing on the page mentions it).

- **Start.** ` or ~ (the Backquote key, or a layout that types either) over the revealed live scene with its film ground in place. It never starts on a touch-primary or coarse pointer, under reduced motion, a visitor pause or forced colors ([walk-key.js](../src/scene/walk-key.js)). The press captures the mouse; where the browser refuses, a held button drags the view.
- **In.** The page fades off the canvas (`body.scene-walking`, `.scene-walk-hidden`; its boxes keep their layout), the tour finishes any dissolve and holds, and from the next cut the visitor stands on the ground under the shot's camera, facing its subject, under the film's dissolve; the bars ease out with it.
- **Controls.** The mouse looks around; W/S or the up and down arrows walk, A/D step aside, the left and right arrows turn, Shift jogs, Space jumps. The tower's base (posts, ladder feet and low braces), the trunk with its root flare, the lantern and every rock at least 0.5 tall are solid; the river and stream are wadeable. Outward motion fades between 76 and 86 units from the tower (`WALK.bound`).
- **Out.** The same key, or Esc twice (the first frees the mouse), dissolves back to the tour's held shot without a time jump, and the page fades back. A visitor pause, reduced motion or a lost GL context ends it at once, with a hard cut.
- **While walking** no shot is on screen: the light mood, lens, lens sources, mist share and ground calm rest at their defaults, the text guards rest (there is no text), and content that lands only unseen waits for the walk's cuts. The moon's shadow follows a snapped point ahead of the walker (`WALK.shadow`), so its map redraws only on a cell change.

## sceneDebug

With `sceneDebug=1`, `window.BabelSite.sceneDebug` is a plain, read-only status object. It adds no controls and loads no extra code.

| Field                                     | Meaning                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tier`, `initialTier`, `assetTier`        | Current profile tier, startup tier, and the tier models and maps were loaded for                                                                                                                                                                             |
| `requestedTier`, `overrideTier`           | From `quality`: the value read (`auto` when absent) and the fixed tier, or `null`                                                                                                                                                                            |
| `governorTier`, `reason`                  | Governor tier (its `low` is the resolution step) and why the profile last applied: `initial`, `resize` or `adaptive`                                                                                                                                         |
| `pixelRatio`, `caps`                      | Pixel ratio; the texture limits the startup tier was chosen from                                                                                                                                                                                             |
| `composition`, `compositionReason`        | Composition profile (`desktop`, `compact`, `tabletPortrait`, `portraitPhone`, `landscapePhone`); `resize`                                                                                                                                                    |
| `architecture.tower`, `.tree`, `.lantern` | `{ kind, status, tier }`, plus `reason: "asset-unavailable"` on a fallback                                                                                                                                                                                   |
| `lanternCommitted`                        | `true` once the supplied lantern is in the scene                                                                                                                                                                                                             |
| `ground`                                  | The slate maps: `{ status, tier, material }`, `material` naming their source                                                                                                                                                                                 |
| `groundTreatment`                         | `slate` while the film is on, else `baseline`                                                                                                                                                                                                                |
| `rocks`                                   | `{ status, tier }`                                                                                                                                                                                                                                           |
| `mountains`                               | A plain string: `loading`, `ready` or `fallback`                                                                                                                                                                                                             |
| `shaders`                                 | Warm-up per label (`scene`, `ground`, `tower`, `tree`, `lantern`): `ready` or `unwarmed`                                                                                                                                                                     |
| `cinematic`                               | `shot`, `selected`, `angle` (1-based), `current`, `film` and `tour`                                                                                                                                                                                          |
| `programs`, `renderFps`                   | Linked program count; frames drawn per second                                                                                                                                                                                                                |
| `environment`                             | The environment capture of the film sky: `status` (`none`, `ready` or `failed`) and `ms`, its time                                                                                                                                                           |
| `lightning`                               | The lightning's own clock (`time`, s), the flash's `level` and the lit `event` (`k`, `start`, `bolt` whether a bolt draws, `wanted` whether the event asked for one, `height` the share of its full height it kept, view `azimuth` and `altitude`) or `null` |
| `failure`                                 | `{ stage, message }` when the scene stopped for the title card; `stage` is `architecture:tower` or `architecture:tree`                                                                                                                                       |
| `walk`                                    | `null` until the first walk; then `phase` (`idle`, `arming`, `capture`, `walking`, `leaving`, `returning`), the feet's `x`, `y`, `z`, `yaw`, `pitch`, `grounded`, `locked` (mouse captured) and the solids' `hull` points and `circles`                      |

Status values:

| Field                | `status`                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `architecture.*`     | `procedural` until the first frame selects the startup tier's models, then `loading`, then `ready` or `fallback`                    |
| `ground`             | `procedural` (tier `low`) until the film starts, then `loading`, then `ready` or `fallback`; a fallback keeps the procedural ground |
| `rocks`, `mountains` | `loading`, then `ready` or `fallback`                                                                                               |

`rocks` appears once the rocks start loading (after the reveal, with the film on and the tree settled), and `mountains` once the film requests the ranges; its `fallback` means the ranges' chunk failed (the film shows no mountains) or a Meshy massif failed or did not arrive within 12 s (`MASSIFS.deadline`; the five procedural rings stand in). In `cinematic`, `selected` is `tower` or `tree`, `current` is `tower`, `tree`, `orbit` or `null` (nothing ready yet), and `tour` holds the tour's state and transition, or `null` when there is no tour (`tour` present with any value other than 3, 5 or 20).

## sceneLoader.state

On the live path, with or without `sceneDebug`, `window.BabelSite.sceneLoader.state` describes the loading line and its star.

| Field      | Meaning                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | `idle`, `loading`, `revealed`, `static` or `stalled`                                                                                                 |
| `progress` | 0 to 1; at most 0.96 before the reveal                                                                                                               |
| `tier`     | Startup tier                                                                                                                                         |
| `roles`    | `["tower"]`, or `["tower", "tree"]` with `view=tree`                                                                                                 |
| `bytes`    | Per role: `received`, `expected`, `done`                                                                                                             |
| `stages`   | `bundle` and `init`, each `true` once reached                                                                                                        |
| `built`    | Per role: `glb-parse`, `assembly`, `shaders`                                                                                                         |
| `star`     | The last valid star report, `{ x, y, radius, width, height }` in CSS px from the canvas's top-left, or `null` while the star is unknown or withdrawn |

## Capture recipe

Size the window first: the scene's size picks the shot's [variant](#viewport-variants) and safe area. Open `?quality=high|balanced&view=…&angle=…&tour=0&sceneDebug=1` (the explicit tier keeps the governor from stepping mid-capture) and wait until all of these hold:

- `#home-scene` has the `is-ready` class;
- `sceneDebug.cinematic.shot` names the shot;
- `sceneDebug.architecture.tower.status`, `.tree.status` and `.lantern.status` are `ready`, and `sceneDebug.lanternCommitted` is `true`;
- `sceneDebug.ground.status` is not `loading`;
- `sceneDebug.shaders.lantern` is `ready` or `unwarmed`;
- `sceneDebug.rocks.status` is `ready` or `fallback`.

Then advance a fixed number of frames before capturing. The flame, the cloud drift and the lightning run on scene time; the lightning's schedule is seeded, and a capture can force a flash to peak at a phase ([lightning.js](../src/scene/lightning.js) `LIGHTNING.forceAt`, empty in use). The drips keep their own clock, the `performance.now()` time between drawn ground frames ([terrain-build.js](../src/scene/terrain-build.js) `dripClock`). A deterministic capture therefore drives both the frame clock and `performance.now()` itself.
