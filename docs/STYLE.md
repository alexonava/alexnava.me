# Style

The rules for visual, motion and typographic changes. Read them before changing how the site looks or moves.

## Principles

- Calm by design: quiet on load, clear on click. Atmospheric, never generic dark UI or visual noise.
- Depth comes from gradients, light and procedural texture, not UI chrome.
- Keep the current alignment and composition unless a task calls for a layout change.

## Palette and type

- Deep navy, soot, twilight stone and warm parchment backgrounds; warm off-white text, never pure white; amber, brass and soft peach accents with an occasional cool twilight lift. No flat black, neon or saturated rainbow colour.
- Display type is Cormorant Garamond, body and UI type Instrument Sans: the two self-hosted variable fonts and no others.
- The name is Cormorant 700, `#f7f1ea`, with its soft halo, from the font's true 700 master with synthetic bold disabled. Parchment headings use 500. Eyebrows are uppercase, tracked and restrained.
- Hierarchy: warm-white name, soft off-white intro, pale stone navigation, neutral-grey metadata. Gold belongs to the sun and materials, not secondary text. Controls use the shared surface, line and focus tokens; no bright blue chrome or glossy buttons.

## Motion and accessibility

- Motion is structural. Hover and focus may brighten or lift slightly; nothing spins or jitters.
- Reduced motion removes movement: panels open at once and the live scene is not loaded.
- Text keeps 4.5:1 contrast or better on the night, on paper and over every tour shot. No text below 12px; interactive targets at least 44px.
- Safe-area insets pad the footer, About bar and dialogs. `main` clips horizontal overflow without becoming a scroll container. Forced-colors and increased-contrast modes keep system colours and cursor.

## Homepage, title card and footer

- The page opens on the title card: night gradient, a quiet CSS star field and the vignette under the name, a short intro and About. There is no picture.
- On the live path one line above the footer reads "Loading the estate" over a thin sun-coloured bar. It shows real progress, never a timed animation; it holds below 100% until the reveal, reads 100% as the canvas fades in over 480 ms, and fades within that fade. It never moves or covers the identity or About, and retires rather than stalls. Static visitors never see it.
- The hero backdrop is a soft oval centred on the name that fades to transparent before every edge of its element: no straight edge across the sky.
- The footer is quiet meta text with About alone at the left (44px target); no corner button, icon or plaque. Email lives in Contact.
- Hero and footer bounds feed the scene's framing; recheck phone and desktop framing when text metrics or spacing change. From 1681px wide the hero and footer share a viewport-relative gutter; the 1600×900 reference composition is fixed.
- On touch WebKit the decorative layers extend beneath Safari's bottom toolbar (`100lvh` from the existing top origin). Keep Safari's top fill; do not shift the scene or force a scroll.

## Dialogs

- About opens the illustrated estate as a menu over the dimmed scene. Keep its desktop and portrait proportions, transparent paper edge and aligned Profile, Experience and Contact landmarks.
- Category dialogs are quiet cotton paper with crisp, selectable dark ink: no ruled lines, monograms or seals. Back sits fully on the paper; Close and Back targets are at least 44px.
- Back, Escape and backdrop dismissal return to the estate, then About returns to the scene. Focus is trapped and restored at each step; the no-JavaScript links keep working.
- Panels lift into light over 440ms, rising 18px with a shallow tilt, and close over 240ms.

## Camera and tour

- The tour opens on The watch and shows seven shots: The watch and Portrait hold 9 s, Threshold and Gallery detail 7 s, Lantern study, Close-up and Root and lantern 6 s. Masonry study opens only from its URL.
- Shots join by a 1 s dissolve staggered by depth (sky, mountains, ground, subject) with no dip to black. Drift never stops before a cut. No shot label, control strip or visible pause control.
- Dialogs, reduced motion and a visitor pause hold the tour.
- Close-up is an intimate branch study: fitting margin 0.83, 30° lens, roots and lantern below the frame. Root and lantern keeps camera height 0.14 so the skyline stays low on landscape phones.
- The sun is either wholly out of frame or whole, clear of the name and unoccluded.

## Materials and lighting

- Keep the supplied silhouettes, UVs and map resolutions. The timber lookout keeps its colour and baked normal maps at full strength, roughness 0.90, graded as pale weathered wood, with dark atlas detail lifted by 0.14. The bare twisted tree keeps its normal map with roughness in 0.84–0.97; add no leaves.
- Keep the cool fill and hemisphere light with warm sun and lantern accents, real cast shadows and dark recesses. Add no lights and no flattening ambient.
- The lantern's flame is small and realistic: 0.30 units tall in the lantern's 2.48, on a charred wick, with a blue cup, a yellow-white core and an orange-red tip that flutters, behind clear glass with crisp moon glints and a warm rim that keeps the globe legible on every tier. The metal stays dark.
- One draught moves the flame and the lantern light, which stays within 12% of its base. Flame, flicker and drips freeze for pauses, dialogs and reduced motion; without the flame module the lantern keeps its static glow.
- The rocks are the two supplied stones: 20 instances in two draws, clustered at the tower base, behind the tree and at the lantern, out of every shot's view of its subject, darker than the timber.

## Sky, mountains and haze

- A lifted blue night with slowly drifting moonlit cloud banks (lavender bodies, blue-grey undersides), a clear lane over the roof and open sky around the name; stars show between the banks.
- The nebula is still and restrained (blue-violet, dark dust, a faint peach core): three noise octaves on high, two on balanced, always behind the identity and architecture.
- Five moonlit ranges with asymmetric summits, shoulders, crest teeth and spurs. Faces toward the moon read neutral grey, faces away deeper blue; each range sits in its own air, its rock below the average sky behind it, with valley mist between layers and no comb of streaks or echo bands.
- Snow follows a level, noisy snowline with tongues down the gullies; lit snow reads about 2.2 times the sky behind it, shadowed snow is blue, edges never stair-step, the nearest range stays bare and no snow sits behind the name. Each crest draws an ink line of about 1.4 px; the ranges skip the grade's cel banding (except their fogged feet) and the post ink.
- Haze stays in the distance (155–190 world units), sharing a dark slate tone with the mountain feet: never a pale veil or a black band.

## Ground, puddles and roots

- Dark cracked slate: maps at 1024 on high and 512 on balanced on a 22-unit tile at 0.45 normal strength, blended so no repeat or seam shows, with a shared 512 detail map near the lens. It reads dark slate grey under the cool light, lifted 1.2× so shadowed ground keeps visible detail.
- A calm wet sheen gathers in hollows, cracks and under the drip line; distant ground never lifts into a pale veil, and the tower footing, root plate and path stay dry.
- Puddles are still, clear water with soft shores that follow the cracks. Their analytic mirror shows only the sky, the trunk and the lantern with its flame; the lantern's image stays at most about three quarters of the flame's peak and never slices into strips. The lantern puddle's highlight uses roughness 0.20 and specular gain 0.8 and keeps 22% of it; the others keep roughness 0.12 and gain 4. Drips 4 to 9 s apart ring a puddle and tilt only the mirror.
- Keep the lantern clearing and front puddle at their heights and slopes: no mound, bowl, cutout or rim.
- The tree sits on a level plate east of the trunk, never above its footing; root ends rest on low berms (slope at most about 1.2) and soil banks bury no root by more than 0.2. The south-east spur stays an open aerial root.
- The cracked slate continues under the roots: settled soil only lightly softens it (15%). Baked occlusion shades just the near-root ground and the cavities under the arches, which stay grounded but never a black hole, disc or ring. Shadowed ground keeps a cool moonlit tint, and the grade's cel band fades out in the ground's deepest shade (luma below about .03–.08), so the tree's shadow has no hard edge. About fifty pieces of dark litter lie in the root crooks, clear of the lantern and puddles.

## Light shafts

- The watch alone takes warm star rays: distinct streaks from the star through the cabin and down the lattice, never a wash; sparser on phones.
- Threshold, Gallery detail, Masonry study, Portrait and Close-up take cool moonbeams along the moon key: slim shafts and soft broken patches on bark and timber, never a spotlight. The two lantern shots have none.
- The air light stays off the sky beyond the subject and off the mountains, and eases off behind the name and intro over a fifth of the screen's smaller side. Text stays at 4.5:1 or better, tour shots at 5:1.
- Treatments change on a cut or during the reveal's fade-in, never mid-hold (a light still building fades in over a second), sway only slowly, hold still for pauses and reduced motion, and need WebGL2.

## Static images

- The share card, `public/og.png`, is rendered from `tools/og-card.html` over `tools/og-card-backdrop.webp`, a still of the live scene. It must match the accepted live appearance: compare live views before refreshing either, and regenerate the card when the backdrop changes.

## Guardrails

- No frameworks, extra fonts or decorative assets without approval.
- No new lights, render passes or texture downloads for an effect.
- Changes that would pop mid-shot land on a tour cut.
- Recheck desktop and portrait frames, motion extremes and reduced motion after any visual change.
