# Content

Every place the site's words live, the checks that hold them in step, and how to change them. Visual rules for text are in [Style](STYLE.md); accessible names and semantics are in [Accessibility](ACCESSIBILITY.md). The no-JS fallback, the estate map and the other terms used here are defined in the [Glossary](GLOSSARY.md).

## index.html

| Element                                                                | Text                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<title>`, `og:title`, `twitter:title`, `apple-mobile-web-app-title`   | Alex Nava                                                                    |
| `description`, `og:description`, `twitter:description`                 | Alex Nava’s personal website                                                 |
| `og:image:alt`, `twitter:image:alt`                                    | Alex Nava — a timber lookout tower under a moonlit sky                       |
| `.skip-link`                                                           | Skip to main content                                                         |
| `.hero h1` (two `.hero-word` spans)                                    | Alex, Nava                                                                   |
| `.hero-intro`                                                          | A little about me and what I’m working on.                                   |
| `#scene-loader`                                                        | Loading the estate · N%                                                      |
| Footer link and button                                                 | About                                                                        |
| `#panel-about`                                                         | About; the × button is named Close About                                     |
| `#panel-profile`, `#panel-experience`, `#panel-contact`: eyebrow, `h2` | Profile, A little about me.; Experience, My background.; Contact, Say hello. |
| Each category's Back button                                            | Back, named Back to About                                                    |

Each category sentence appears twice: in the no-JS fallback (`#profile-text`, `#experience-text`, `#contact-text`) and in its dialog's `.panel-body`.

- Profile: This is my personal corner of the web.
- Experience: Analytics, reporting, remediation, and controls, across banking and health.
- Contact: You can reach me at alexonava@gmail.com, a `mailto:` link inside `<!--email_off-->` … `<!--/email_off-->`.

The no-JavaScript About (`#about-text`, inside `main`) has the heading About, a nav named Categories that links the three sections, and one `h3` section per category.

The structured data (`script[type="application/ld+json"]`) is a `ProfilePage`: `headline` Alex Nava, the description, `url` and `dateModified`. Its `mainEntity` is a `Person` with `name`, `url` and the `description` "Background in analytics, reporting, remediation, and controls across banking and health." The canonical link, `og:url` and both `url`s name https://alexnava.me/.

The description and the intro use a typographic apostrophe (’, U+2019), and the tests match it exactly. The buttons' `aria-label`s are About, Profile, Experience and Contact (as shown), Close About (the ×) and Back to About (Back); the estate map's nav is named Site categories.

## Other files

| File                                                                      | Copy                                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [404.html](../404.html)                                                   | Title Not found — Alex Nava; eyebrow 404; heading That page isn't here. (straight apostrophe); The way back is just below.; link Home |
| [public/index.md](../public/index.md)                                     | Front matter `title`, `description`, `url`, `dateModified`; the name, intro and three categories                                      |
| [public/llms.txt](../public/llms.txt)                                     | The name, the description, and links to the homepage, its Markdown, the site map and the agent guide                                  |
| [public/site-agents.md](../public/site-agents.md), served as `/AGENTS.md` | Purpose, attribution guidance for AI agents, resource links                                                                           |
| [public/sitemap.md](../public/sitemap.md)                                 | The public pages and machine-readable resources                                                                                       |
| [public/manifest.webmanifest](../public/manifest.webmanifest)             | `name`, `short_name` and `description`                                                                                                |
| [public/robots.txt](../public/robots.txt)                                 | Comments stating the crawler policy                                                                                                   |
| [public/.well-known/security.txt](../public/.well-known/security.txt)     | `Contact: mailto:alexonava@gmail.com`                                                                                                 |
| [tools/og-card.html](../tools/og-card.html)                               | The share card: Alex / Nava, the intro over two lines, and alexnava.me; rendered into `public/og.png`                                 |

[build.mjs](../build.mjs) writes `sitemap.xml` with one URL, `https://alexnava.me/`, whose `lastmod` is `public/index.md`'s `dateModified` (the build date when the front matter has none). The repository's own `AGENTS.md` is internal and never published; `public/site-agents.md` is the published guide.

## What the tests hold in step

From `test/markup-accessibility.test.mjs` unless named:

- Each category's no-JS fallback paragraph reads the same as its dialog's `.panel-body`, tags stripped and spaces collapsed; Contact included.
- The Profile and Experience sentences appear verbatim in the no-JS fallback, the dialog and `public/index.md`. The intro appears exactly once in index.html, and the Experience dialog is titled My background.
- The JSON-LD `dateModified` equals `public/index.md`'s `dateModified` (two tests).
- The JSON-LD is a `ProfilePage` whose `description` is the site description; its `Person` has exactly `@type`, `name`, `description` and `url`, with the description above.
- "Alex Nava’s personal website" appears at least three times in index.html, and the title is `<title>Alex Nava</title>`.
- Both image alt texts read Alex Nava — a timber lookout tower under a moonlit sky.
- index.html has exactly two `mailto:` links, each wrapped in `<!--email_off-->`, and no address outside the markers.
- The no-JS fallback's headings are About (`h2`), then Profile, Experience and Contact (`h3`); the 404 heading is That page isn't here.
- The loading line's markup, label included, appears once, verbatim.
- Three dialogs carry Back to About, About's close button is named Close About, and the destinations read Profile, Experience and Contact.
- `test/hosting.test.mjs`: `security.txt`'s `Contact` is `mailto:alexonava@gmail.com`.
- `test/bundle-output.test.mjs` and `test/build.test.mjs`: `sitemap.xml`'s `lastmod` comes from `public/index.md`'s `dateModified`.

Nothing checks the share card's text against the page, `public/index.md`'s Contact line, `title` or `description`, the contents of `llms.txt`, `site-agents.md` and `sitemap.md`, the manifest's `name` and `description`, or the 404 page beyond its heading. Keep them in step by hand.

## Copy that CI and the audit scripts read

| File                                                                     | Reads                                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/smoke-pages.sh`                                         | `<title>Alex Nava</title>` on the deployment and the apex; `That page isn't here.` on the 404; `id="home-scene"` |
| `.github/scripts/cloudflare-audit.sh`                                    | `<title>Alex Nava</title>` on the apex and on `pages.dev`                                                        |
| `.github/scripts/cloudflare-edge-settings.sh`                            | `<title>Alex Nava</title>` and `href="mailto:alexonava@gmail.com"`                                               |
| `.github/workflows/ci.yml`, the `preview` job's Smoke-check preview step | `<title>Alex Nava</title>` on the preview deployment                                                             |

With `--rollback`, `smoke-pages.sh` also accepts `<title>Nava Designs — Alex Nava</title>`. `test/smoke-pages.test.mjs` mocks the title and the 404 heading. The title is in all four files; the 404 heading only in `smoke-pages.sh`; the address only in `cloudflare-edge-settings.sh`. Changing any of the three therefore changes a CI file, which needs the owner's authorization ([AGENTS.md](../AGENTS.md) rule 6).

## Where each piece repeats

| Copy                   | Every place it lives                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The name               | index.html (title, share titles, `apple-mobile-web-app-title`, JSON-LD `name` and `headline`, `h1`, both alt texts); the 404 title; index.md; llms.txt; the manifest; og-card.html; the title checks in the CI scripts and `ci.yml`; `test/markup-accessibility.test.mjs` (the `h1`'s two words, the title twice, the alt text, and the description twice); the title in `test/smoke-pages.test.mjs` |
| The description        | index.html (three meta tags and the JSON-LD); index.md front matter; llms.txt; site-agents.md; sitemap.md; the manifest; `test/markup-accessibility.test.mjs` (the count and the JSON-LD `description`)                                                                                                                                                                                              |
| The intro              | index.html `.hero-intro`; index.md; og-card.html; `test/markup-accessibility.test.mjs` (exactly once in index.html)                                                                                                                                                                                                                                                                                  |
| Profile and Experience | index.html no-JS fallback and dialog body; index.md; Experience is restated in the JSON-LD `Person` description; `test/markup-accessibility.test.mjs` (both sentences verbatim in the fallback, the dialog and index.md; the `Person` description; the Experience dialog's heading, My background.)                                                                                                  |
| The address            | index.html (two links); index.md; security.txt; `test/hosting.test.mjs`; the contact-link fixture in `test/panels.test.mjs`; `cloudflare-edge-settings.sh`                                                                                                                                                                                                                                           |

## Change the copy

1. Edit the words in every place the table above lists. Keep the no-JS fallback, the dialog and `public/index.md` identical, and each `mailto:` link inside its `email_off` markers.
2. When the homepage's content changes, set the same date (`YYYY-MM-DD`) in the JSON-LD `dateModified` and in `public/index.md`'s front matter. `sitemap.xml` follows on the next build.
3. Update the tests that pin the old wording in the same change (`test/markup-accessibility.test.mjs`, `test/hosting.test.mjs`, and `test/smoke-pages.test.mjs` for the title and the 404 heading), and the address in the `test/panels.test.mjs` fixture. A change to the strings the CI scripts and `ci.yml` read needs authorization first.
4. When the name, intro or domain changes, edit `tools/og-card.html` and regenerate `public/og.png` ([Assets](ASSETS.md#refresh-the-share-card)).
5. Keep `public/index.md`, `llms.txt`, `site-agents.md` and `sitemap.md` accurate and free of anything private ([AGENTS.md](../AGENTS.md) rule 4).
6. Run `npm run format`, `npm run verify`, `npm test` and `npm run build:dist`.
7. After the release, purge each changed stable-named file (`/index.md`, `/robots.txt`, `/llms.txt`, `/AGENTS.md`, `/sitemap.md`, `/sitemap.xml`, `/manifest.webmanifest`, `/og.png`, `/.well-known/security.txt`); HTML revalidates on every request ([Operations](OPERATIONS.md#headers-and-caching)).
