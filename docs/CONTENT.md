# Content

Every place the site's words live, the checks that hold them in step, and how to change them. Visual rules for text are in [Style](STYLE.md); accessible names and semantics are in [Accessibility](ACCESSIBILITY.md). The no-JS fallback and the other terms used here are defined in the [Glossary](GLOSSARY.md).

## index.html

| Element                                                              | Text                                                                                                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`, `og:title`, `twitter:title`, `apple-mobile-web-app-title` | Alex Nava                                                                                                                                       |
| `description`, `og:description`, `twitter:description`               | Alex Nava’s personal website                                                                                                                    |
| `og:image:alt`, `twitter:image:alt`                                  | Alex Nava — a timber lookout tower under a moonlit sky                                                                                          |
| `.skip-link`                                                         | Skip to main content                                                                                                                            |
| `.hero h1` (two `.hero-word` spans)                                  | Alex, Nava                                                                                                                                      |
| `.hero-intro`                                                        | A little about me and what I’m working on.                                                                                                      |
| `#scene-loader`                                                      | Loading · N%                                                                                                                                    |
| `.site-footer__contact`                                              | Contact                                                                                                                                         |
| `#contact-links`                                                     | alexonava@gmail.com, a `mailto:` link inside `<!--email_off-->` … `<!--/email_off-->`; LinkedIn, linking https://www.linkedin.com/in/alex-nava/ |

The footer's two links are the page's only contact copy: with scripts Contact shows and hides them, and without scripts they stand alone ([UI](UI.md#footer-and-contact)).

The structured data (`script[type="application/ld+json"]`) is a `ProfilePage`: `headline` Alex Nava, the description, `url` and `dateModified`. Its `mainEntity` is a `Person` with `name` and `url`. The canonical link, `og:url` and both `url`s name https://alexnava.me/.

The description and the intro use a typographic apostrophe (’, U+2019), and the tests match it exactly. Contact's button carries no `aria-label`: its text names it.

## Other files

| File                                                                      | Copy                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [404.html](../404.html)                                                   | Title Not found — Alex Nava; description Alex Nava’s personal website (the homepage's); eyebrow 404; heading That page isn't here. (straight apostrophe); The way back is just below.; link Home |
| [public/index.md](../public/index.md)                                     | Front matter `title`, `description`, `url`, `dateModified`; the name, the intro and a Contact section with the email address and LinkedIn                                                        |
| [public/llms.txt](../public/llms.txt)                                     | The name, the description, and links to the homepage, its Markdown, the site map and the agent guide                                                                                             |
| [public/site-agents.md](../public/site-agents.md), served as `/AGENTS.md` | Purpose, attribution guidance for AI agents, resource links                                                                                                                                      |
| [public/sitemap.md](../public/sitemap.md)                                 | The public pages and machine-readable resources                                                                                                                                                  |
| [public/manifest.webmanifest](../public/manifest.webmanifest)             | `name`, `short_name` and `description`                                                                                                                                                           |
| [public/robots.txt](../public/robots.txt)                                 | Comments stating the crawler policy                                                                                                                                                              |
| [public/.well-known/security.txt](../public/.well-known/security.txt)     | `Contact: mailto:alexonava@gmail.com`                                                                                                                                                            |
| [tools/og-card.html](../tools/og-card.html)                               | The share card: Alex / Nava, the intro over two lines, and alexnava.me; rendered into `public/og.png`                                                                                            |

[build.mjs](../build.mjs) writes `sitemap.xml` with one URL, `https://alexnava.me/`, whose `lastmod` is `public/index.md`'s `dateModified` (the build date when the front matter has none). The repository's own `AGENTS.md` is internal and never published; `public/site-agents.md` is the published guide.

## What the tests hold in step

From `test/markup-accessibility.test.mjs` unless named:

- The intro appears exactly once in index.html, and in `public/index.md` too; the email link and LinkedIn appear in both, and neither mentions Experience, analytics or banking.
- The JSON-LD `dateModified` equals `public/index.md`'s `dateModified` (two tests).
- The JSON-LD is a `ProfilePage` whose `description` is the site description; its `Person` has exactly `@type`, `name` and `url`.
- "Alex Nava’s personal website" appears at least three times in index.html, and the title is `<title>Alex Nava</title>`.
- Both image alt texts read Alex Nava — a timber lookout tower under a moonlit sky.
- index.html has exactly one `mailto:` link, Contact's, wrapped in `<!--email_off-->`, and no address outside the markers.
- The footer holds Contact and its two links; the 404's `main` is verbatim: the eyebrow 404, the heading That page isn't here., the text The way back is just below. and Home.
- The 404's meta description equals index.html's.
- The loading line's markup, its label and bar included, appears once, verbatim.
- `test/hosting.test.mjs`: `security.txt`'s `Contact` is `mailto:alexonava@gmail.com`.
- `test/bundle-output.test.mjs` and `test/build.test.mjs`: `sitemap.xml`'s `lastmod` comes from `public/index.md`'s `dateModified`.

Nothing checks the share card's text against the page, `public/index.md`'s `title` or `description`, the contents of `llms.txt`, `site-agents.md` and `sitemap.md`, the manifest's `name` and `description`, or the 404 page's title. Keep them in step by hand.

## Copy that CI and the audit scripts read

| File                                                                     | Reads                                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/smoke-pages.sh`                                         | `<title>Alex Nava</title>` on the deployment and the apex; `That page isn't here.` on the 404; `id="home-scene"` |
| `.github/scripts/cloudflare-audit.sh`                                    | `<title>Alex Nava</title>` on the apex and on `pages.dev`                                                        |
| `.github/scripts/cloudflare-edge-settings.sh`                            | `<title>Alex Nava</title>` and `href="mailto:alexonava@gmail.com"`                                               |
| `.github/workflows/ci.yml`, the `preview` job's Smoke-check preview step | `<title>Alex Nava</title>` on the preview deployment                                                             |

With `--rollback`, `smoke-pages.sh` also accepts `<title>Nava Designs — Alex Nava</title>`. `test/smoke-pages.test.mjs` mocks the title and the 404 heading. The title is in all four files; the 404 heading only in `smoke-pages.sh`; the address only in `cloudflare-edge-settings.sh`. Changing any of the three therefore changes a CI file, which needs the owner's authorization ([AGENTS.md](../AGENTS.md) rule 6).

## Where each piece repeats

| Copy            | Every place it lives                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The name        | index.html (title, share titles, `apple-mobile-web-app-title`, JSON-LD `name` and `headline`, `h1`, both alt texts); the 404 title; index.md; llms.txt; the manifest; og-card.html; the title checks in the CI scripts and `ci.yml`; `test/markup-accessibility.test.mjs` (the `h1`'s two words, the title twice, the alt text, and the description twice); the title in `test/smoke-pages.test.mjs` |
| The description | index.html (three meta tags and the JSON-LD); 404.html (its meta description); index.md front matter; llms.txt; site-agents.md; sitemap.md; the manifest; `test/markup-accessibility.test.mjs` (the count, the JSON-LD `description`, and the 404's description held equal to the homepage's)                                                                                                        |
| The intro       | index.html `.hero-intro`; index.md; og-card.html; `test/markup-accessibility.test.mjs` (exactly once in index.html, and in index.md)                                                                                                                                                                                                                                                                 |
| The address     | index.html (one link, in `#contact-links`); index.md; security.txt; `test/hosting.test.mjs`; the address fixture in `test/contact.test.mjs` and the markup tests in `test/markup-accessibility.test.mjs`; `cloudflare-edge-settings.sh`                                                                                                                                                              |
| LinkedIn        | index.html (`#contact-links`, opening in a new tab with `rel="noopener"`); index.md; `test/markup-accessibility.test.mjs` (in both)                                                                                                                                                                                                                                                                  |

## Change the copy

1. Edit the words in every place the table above lists. Keep the footer's links and `public/index.md`'s Contact section in step, and the `mailto:` link inside its `email_off` markers.
2. When the homepage's content changes, set the same date (`YYYY-MM-DD`) in the JSON-LD `dateModified` and in `public/index.md`'s front matter. `sitemap.xml` follows on the next build.
3. Update the tests that pin the old wording in the same change (`test/markup-accessibility.test.mjs`, `test/hosting.test.mjs`, and `test/smoke-pages.test.mjs` for the title and the 404 heading), and the address in the `test/contact.test.mjs` fixture. A change to the strings the CI scripts and `ci.yml` read needs authorization first.
4. When the name, intro or domain changes, edit `tools/og-card.html`, regenerate `public/og.png` and update the `?card=` hash in `index.html`'s `og:image` and `twitter:image` ([Assets](ASSETS.md#refresh-the-share-card)).
5. Keep `public/index.md`, `llms.txt`, `site-agents.md` and `sitemap.md` accurate and free of anything private ([AGENTS.md](../AGENTS.md) rule 4).
6. Run `npm run format`, `npm run verify`, `npm test` and `npm run build:dist`.
7. After the release, purge each changed stable-named file (`/index.md`, `/robots.txt`, `/llms.txt`, `/AGENTS.md`, `/sitemap.md`, `/sitemap.xml`, `/manifest.webmanifest`, `/og.png`, `/.well-known/security.txt`); HTML revalidates on every request ([Operations](OPERATIONS.md#headers-and-caching)).
