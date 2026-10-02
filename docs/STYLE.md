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

- Keep the supplied silhouettes, UVs and map resolutions. The timber lookout keeps its colour and baked normal maps at full strength, roughness 0.90, graded as pale weathered wood, with dark atlas detail lifted by 0.14. The bare twisted tree keeps its normal map with roughness in 0.84–0.97, but for its base, wet after the rain: below about 1.5 units above the soil its roughness eases to 0.55, so it mirrors the night sky, and where the roots and the trunk enter the soil the bark is muddy, darker (about 0.53) and wetter (0.35). Add no leaves.
- Keep the cool fill and hemisphere light with warm sun and lantern accents, real cast shadows (the moon key's, on high and balanced) and dark recesses. Add no lights and no flattening ambient.
- The film's night sky is the scene's environment: one prefiltered capture of the sky shell's own film sky and clouds, with the moon's soft glow about the key, the ranges' dark crest and the dark ground below, taken when the film starts and never per frame. It lights the bark (1.8×) and the rocks (2×) from above, darker beneath, in place of a third of their flat ambient, and the wet bark (1.3×), the rocks (1.8×) and the lantern's iron and glass (0.7) mirror it. The tower keeps its look exactly.
- On the film ground the moon key leads, so the tree's moon shadow and the relief read: the key at 1.35×, the unshadowed cool fill at 35% and the crown's point fill at 15% (it models the bark; there is no light up there), the flat ambient at 30%, and the night sky's own light (3.4× the sky as shown) for the rest. The lantern's light also comes back off its pool (18% of it from all about), so its warm pool spreads to its reach.
- The lantern's flame is small and realistic: 0.30 units tall in the lantern's 2.48, on a charred wick, with a blue cup, a yellow-white core and an orange-red tip that flutters, behind clear glass with crisp moon glints and a warm rim that keeps the globe legible on every tier. The metal stays dark, with the sky's cool glints on it. In film its light reaches 14 units (decay 1.0): a warm pool of about seven units on the wet soil.
- One draught moves the flame and the lantern light, which stays within 12% of its base. Flame, flicker and drips freeze for pauses, dialogs and reduced motion; without the flame module the lantern keeps its static glow.
- The rocks are the two supplied stones: 22 instances in two draws, clustered at the tower base, behind the tree (two of them right of the trunk in Portrait, behind the lantern) and at the lantern, out of every shot's view of its subject. They are pale and wet from the rain (roughness 0.5, so the moon and the lantern glint on their edges, and the night sky shows on their tops), and read clearly on the slate without glowing through the fog.

## Sky, mountains and haze

- A lifted blue night with slowly drifting moonlit cloud banks (lavender bodies, blue-grey undersides), a clear lane over the roof and open sky around the name; stars show between the banks.
- The nebula is still and restrained (blue-violet, dark dust, a faint peach core): three noise octaves on high, two on balanced, always behind the identity and architecture.
- Five moonlit ranges with asymmetric summits, shoulders, crest teeth and spurs. Faces toward the moon read neutral grey, faces away deeper blue; each range sits in its own air, its rock below the average sky behind it, with valley mist between layers and no comb of streaks or echo bands.
- Snow follows a level, noisy snowline with tongues down the gullies; lit snow reads about 2.2 times the sky behind it, shadowed snow is blue, edges never stair-step, the nearest range stays bare and no snow sits behind the name. Each crest draws an ink line of about 1.4 px; the ranges skip the grade's cel banding (except their fogged feet) and the post ink.
- Haze stays in the distance (155–190 world units), sharing a dark slate tone with the mountain feet: never a pale veil or a black band.

## Ground, puddles and roots

- Dark cracked slate: maps at 1024 on high and 512 on balanced on a 22-unit tile at 0.45 normal strength, blended so no repeat or seam shows, with a shared 512 detail map near the lens. It reads dark slate grey under the cool light, lifted 1.2× so shadowed ground keeps visible detail.
- It has just rained: water stands in the cracks and hollows, and a wide halo about the tree, the root area, the path and the lantern clearing among it, is wet; only the tower footing stays dry. Wet ground is glossier, never darker (it keeps the ground's brightness): a film of water lies on it (50% everywhere but the tower footing and 45% more with the wet mask, in broad drained and glossy patches) and mirrors the night sky with water's Fresnel at 1.5× the sky as shown, fading with view distance (full within 70 units, none beyond 130), so distant ground never lifts into a pale veil and the far plain behind the intro stays calm. The moon and the lantern glint on the film under luminance knees (0.06 and 0.35): the moon's sheen toward its side, the lantern's glints in streaks toward the eye. Like the air light, the water's mirror and glints ease off behind the name and intro and behind About (by 30%, over a fifth of the screen's smaller side), and there all the ground reflects passes a luminance knee (0.035), as do the lantern's and the crown fill's highlights on the bark beside About, so the text keeps its contrast.
- Puddles are still, clear water with soft shores that follow the cracks, full after the rain, with one more in Portrait's right foreground. They mirror the night sky as level water (1.8× the sky as shown), the trunk standing dark in it; the lantern puddle's mirror adds the lantern with its flame, and the lantern's image stays at most about three quarters of the flame's peak and never slices into strips. The lantern puddle's highlight uses roughness 0.20 and specular gain 0.8 and keeps 22% of it; the others keep roughness 0.12 and gain 4. Drips 4 to 9 s apart ring a puddle and tilt only the mirror.
- Rain also stands in the knoll's low spots, where the soil lies 2–3 cm below its local mean (a 3.75-unit box): pools with a faint undulation near the lens, wet mud about them (darker, a little warmer and more saturated, smoother), the crests above them a little drier and paler; where the roots enter the soil the damp crease is mud too. None reaches the lantern clearing or the puddles.
- Keep the lantern clearing and front puddle at their heights and slopes: no mound, bowl, cutout or rim.
- The tree is set 0.45 into the soil below its lowest toe, so its resting roots enter the ground about 0.1–0.15 deep and none hovers; small lips of soil form where they leave it, and nothing but that toe is buried more than about 0.2. East of the trunk, where the dune falls away, an irregular knoll brings the soil up toward the footing where the roots touch down, never above it: lobed along the roots, lower in the crooks between them, rising a little to the trunk's collar, with a broken rim, a low relief and slopes of at most about 1.2. It is never a level plate. The arches stay open and the south-east spur stays an open aerial root.
- The cracked slate continues under the roots: settled soil only lightly softens it (15%). Baked occlusion shades just the near-root ground and the cavities under the arches, which stay grounded but never a black hole, disc or ring. Shadowed ground keeps a cool moonlit tint, and the grade's cel band fades out in the ground's deepest shade (luma below about .03–.08), so that shade keeps its detail instead of crushing flat. The band's step at luma .1 stays on the ground because it keeps the cracks crisp. About fifty pieces of dark litter lie in the root crooks and sixteen small grey stones (1.1–2.3 times the soil's grey, so none reads as an egg) among the roots and about the trunk's base, all clear of the lantern and puddles; grit and dark flecks (12% of 9 cm cells each) show in the soil near the lens.

## Light shafts

- The watch alone takes warm star rays: distinct streaks from the star through the cabin and down the lattice, never a wash; sparser on phones.
- Threshold, Gallery detail, Masonry study, Portrait and Close-up take cool moonbeams along the moon key: slim shafts and soft broken patches on bark and timber, never a spotlight. The two lantern shots have none.
- The air light stays off the sky beyond the subject and off the mountains, and eases off behind the name and intro over a fifth of the screen's smaller side. Text stays at 4.5:1 or better, tour shots at 5:1.
- Treatments change on a cut or during the reveal's fade-in, never mid-hold (a light still building fades in over a second), sway only slowly, hold still for pauses and reduced motion, and need WebGL2.

## Static images

- The share card, `public/og.png`, is rendered from `tools/og-card.html` over `tools/og-card-backdrop.webp`, a still of the live scene. It must match the accepted live appearance: compare live views before refreshing either, and regenerate the card when the backdrop changes.

## Guardrails

- No frameworks, extra fonts or decorative assets without approval.
- No new lights, render passes or texture downloads for an effect. The film's environment is one prefiltered capture at the film's start (again only after a lost context), not a pass.
- Changes that would pop mid-shot land on a tour cut.
- Recheck desktop and portrait frames, motion extremes and reduced motion after any visual change.
