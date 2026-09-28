# Scene modes and camera review

The normal experience opens on **The watch** (tower, angle 1), with the tour: each shot holds 6 to 9 seconds, about 50 seconds a loop, and dissolves into the next over 1 second, staggered by depth: the sky changes first, then the mountains, the ground and the tower or tree, with no dip to black. The seven tour shots comprise three tower views and four tree views. Masonry study is excluded from the tour; its explicit comparison URL remains available. These controls are defined by source, not by the numeric orbit guidance in older notes.

## Directed views

Append a query to the local preview, for example:

    http://127.0.0.1:4173/?view=tower&angle=1&tour=0

| URL selection | Shot |
| --- | --- |
| view=tower&angle=1 | The watch |
| view=tower&angle=2 | Threshold (the ladder arriving at the gallery) |
| view=tower&angle=3 | Masonry study (comparison only; excluded from tour; the name is kept for a lattice structure study) |
| view=tower&angle=4 | Gallery detail (gallery floor to eave) |
| view=tree&angle=1 | Portrait |
| view=tree&angle=2 | Lantern study |
| view=tree&angle=3 | Close-up |
| view=tree&angle=4 | Root and lantern |

Explicit view/angle selects the opening composition; add tour=0 to hold it. Without a tour parameter each shot keeps its own hold (`hold` in directed-shots.js): The watch and Portrait 9 seconds, Threshold and Gallery detail 7, the other tree shots 6. tour=3, 5 and 20 are fixed review cadences for every shot; the dissolve takes 1 second, or 0.9 at tour=3. The tour has no shot label or control strip. Panels, developer camera control, reduced motion, and a visitor pause suspend automatic cycling; missing subjects are skipped.

The supplied lantern loads independently on high and balanced authored scenes. Its arrival updates Lantern study and Root and lantern from the new geometry while preserving the lantern's ground position and existing light. Model loading or failure retains the procedural lantern; low and legacy comparisons keep it. The internal flame module loads during preparation; if that module fails, the supplied lantern still appears with its static glow. A prepared replacement commits before reveal or at a tour cut, with a still-frame commit when the tour is paused. No visitor control is added.

A small flame stands on the wick inside the lantern's clear glass globe, with a blue base, a yellow-white core and an orange tip, while the metal stays dark. One draught sways the flame and moves the existing light within 12% of its current lighting base. The lantern's puddle is still, clear water that mirrors the lantern and its flame (at the flame's own height and lean), the trunk and the sky, more dimly than the flame itself, and rare drips send soft rings across the puddles that make the reflection wobble. The flame, the light's flicker and the drips all freeze during visitor or panel pauses and reduced motion. Around the roots, soil banks, baked occlusion, damp contacts and sparse dark litter seat the tree (the owner's realism pass, 2026-09-27). The film horizon has five moonlit mountain ranges, lit by the moon key, with gullies, snow tongues and valley mist between the layers, and fog confined to their feet so the silhouettes remain separate. Their geometry is a lazy chunk requested when the film activates on high or balanced (legacy film comparisons included, never on low); it lands at once before the reveal, on a tour cut or while the tour is not running, and otherwise fades in over the sky (briefly under the reveal's fade-in, over 1.8 s mid-shot on a slow phone); until it lands, or if it fails, no ranges show.

Light shafts follow the owner's hybrid, with visible rays (2026-09-26): warm star rays in The watch only, a stylised screen-space ray pattern fanning from the star through the cabin and down the lattice toward the eye, lit by the light the tower's gaps let through and shown only where the eye looks through the tower (sparser on phones, so the lattice keeps rays rather than a veil); cool moonbeams along the moon key light in Threshold, Gallery detail, Masonry study, Portrait and Close-up, as slim shafts through the crown (Portrait: fading in past its front, irregularly spaced and partly shaped by its gaps) or past the cabin (Gallery detail) and broken moonlight in patches on the bark and timber; none in Lantern study or Root and lantern. The air light keeps off the sky (the star's entirely, the moon's beyond the subject's silhouette) and off the mountains and far foothills beside the subject, and eases off behind the name and intro. They change with the shot on a tour cut (or while the scene first fades in), never mid-hold, except that a light still building when its shot opens, or one whose programs must link again after a quality step on its cut, fades in over a second; in a dissolve they arrive with the subject; they sway only slowly and within a small bound, freeze with pauses and reduced motion, and load only for high and balanced film scenes on WebGL2.

The tower's film material grade uses a 0.14 lift for dark atlas detail before lighting, retaining real cast shadows, dark recesses and ground contact. The tree grade, existing lights, exposure and retained comparison treatments keep their existing settings.

## Visitor pause

The owner retired the footer's Pause scene button on 2026-09-24; About sits alone at the left of the footer, and the scene always plays unless reduced motion, a hidden tab or an open dialog pauses it. For scripted review, `BabelSite.scene.setVisitorPaused()` still pauses the scene and `isVisitorPaused()` reads the state back. A pause holds the tour on its current shot, ends a dissolve in progress on its incoming shot, stops drift and clouds, and then stops rendering. A resize, context restore, or model, map, shader or font change draws one still frame; scroll does not. Resuming continues the same shot from that clear frame without a time jump; an interrupted dissolve is not replayed. A script may pre-set `scene.visitorPausedPreference` before the scene loads; it applies once the scene is revealed, so the first revealed frame stays on screen. The UI no longer stores a choice: it clears any legacy `babel:scene-paused` value and sets the preference to false. Without a quality or sceneDebug override, reduced-motion and reduced-data visitors, like other static poster paths, never load the scene.

The camera fits authored focal volumes into the responsive composition area. Portrait overrides, and The watch's landscape-phone variant, are intentional. Edit [directed-shots.js](../src/scene/directed-shots.js) for shot intent and holds, [cinematic.js](../src/scene/cinematic.js) for fitting and drift, [camera-tour.js](../src/scene/camera-tour.js) for timing, and [postprocess.js](../src/scene/postprocess.js) for the depth-staggered dissolve, whose layer codes are set in [depth-layers.js](../src/scene/depth-layers.js).

Close-up uses a 0.83 fitting margin on desktop and phone, gently pulling the camera back about 7–9% from its prior 0.91 margin while retaining the same branch study, 30-degree lens, target, azimuth and motion. Its portrait focal width stays narrower; the roots and lantern remain below the full viewport. Other directed shots and legacy framing keep their existing parameters.

## Retained comparisons

| Parameter | Purpose |
| --- | --- |
| view=orbit | Previous orbital camera |
| cinematography=baseline | Prior cinematic treatment |
| architecture=assembled | Earlier assembled architecture |
| architecture=classic | Procedural/classic architecture |
| setting=previous | Previous setting and orbit |
| setting=plinth | Raised platform comparison |
| ground=earth | Previous default film ground: Poly Haven earth and grass maps and the brown earth tone, in the otherwise unchanged authored scene (no legacy world) |
| ground=desert / ground=procedural | Earlier ground treatments |
| scale=baseline | Earlier prop proportions |
| stone=procedural / brick=boxes | Legacy material/brick comparisons where applicable |

[scene-modes.js](../src/scene/scene-modes.js) centralizes URL mode policy. The default film ground is the dark cracked slate (the seamless slate v2 maps with wetness, puddles and contact shading) with the owner's scattered rocks; `ground=earth` is the only comparison parameter that does not also build the legacy world, because it swaps just the film terrain maps. `rocks=off` hides the scattered rocks for review and never downloads their chunk or models. `shafts=off` hides the light shafts for review; their small chunk still loads. These combinations are compatibility and review controls, not separate current designs. Some comparisons apply only to their matching architecture mode. Defaults and fallback behavior must remain consistent when refactoring.

## Accessibility and diagnostics

Without overrides, reduced motion/data, unavailable WebGL, and software rendering retain the static poster path. An explicit quality=low, quality=balanced, quality=high, or sceneDebug=1 requests the diagnostic live path when WebGL is available; it is not a way to bypass release gates. A live reduced-motion review holds camera motion. With sceneDebug=1, the Backquote key activates the desktop developer camera and its debug HUD; the key does nothing for ordinary visits and is ignored while a panel is open. Its code loads as a separate chunk only for sceneDebug=1 sessions. The scene requests that chunk as soon as it reads the flag, so the download overlaps initialization, and the key responds once the chunk has arrived, normally by the time initialization finishes. The developer camera renders through a visitor pause, restores the held frame when it exits, and does not define visitor framing.

See [OPERATIONS.md](../OPERATIONS.md) for the exact delivery and release policy. Historical QA snapshots live in [history](history/README.md); their ports, scores, camera numbers, and publication claims refer to their original run.
