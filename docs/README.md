# Documentation

The documents that describe alexnava.me, and where to start for a task. They describe the site as it is now; [AGENTS.md](../AGENTS.md) rule 5 keeps them current.

## Index

| Document                              | Covers                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)       | Startup, the module map, the scene lifecycle, quality tiers, assets and budgets, the build pipeline                                         |
| [Contracts](CONTRACTS.md)             | The interface between the pages, the UI bundle and the scene bundle: `window.BabelSite`, DOM hooks, events, meta tags, User Timing, defines |
| [Scene modes](SCENE-MODES.md)         | URL parameters, shots, pauses, the `sceneDebug` and `sceneLoader.state` fields, the capture recipe                                          |
| [Style](STYLE.md)                     | Visual, motion and typographic rules                                                                                                        |
| [UI](UI.md)                           | The page's interface: title card, footer, About menu, dialogs and the 404 page                                                              |
| [Content](CONTENT.md)                 | The site's words and where each piece lives                                                                                                 |
| [Assets](ASSETS.md)                   | Models, maps, artwork, fonts, icons and the share card                                                                                      |
| [Accessibility](ACCESSIBILITY.md)     | How the page meets its accessibility rules                                                                                                  |
| [Testing](TESTING.md)                 | Running the suite, what each test file guards, locked values, visual review, Lighthouse                                                     |
| [Troubleshooting](TROUBLESHOOTING.md) | Symptom, cause and fix for recurring failures                                                                                               |
| [Operations](OPERATIONS.md)           | Release gates, CI, deploy, rollback, headers, Cloudflare                                                                                    |
| [Glossary](GLOSSARY.md)               | The terms the code and docs use, and the preferred word for each                                                                            |
| [Credits](CREDITS.md)                 | Rights, third-party code, fonts and the provenance of the supplied artwork                                                                  |

Outside `docs/`:

- [README.md](../README.md): what the site is, local commands, the repository layout and the license.
- [AGENTS.md](../AGENTS.md): the rules every coding agent follows. Internal; never published (`public/site-agents.md` is the published agent guide).
- [SECURITY.md](../SECURITY.md): how to report a vulnerability. The published `/.well-known/security.txt` gives an email contact.

## Start here

**Changing words.** [Content](CONTENT.md) says where each piece of copy lives. Each category's copy appears in its dialog and in the no-JS fallback, and the Profile and Experience sentences in `public/index.md` too; tests hold the copies equal and pin the words, so change every copy and the test together ([Testing](TESTING.md#locked-values)). Keep the JSON-LD `dateModified` in `index.html` equal to `public/index.md`'s, and keep the discovery files accurate (AGENTS.md rule 4).

**Changing the look.** Read [Style](STYLE.md) first, then [UI](UI.md) for the page and [Assets](ASSETS.md) for artwork and models. Review the scene with the [capture recipe](SCENE-MODES.md#capture-recipe) and the [visual review](TESTING.md#visual-review) protocol. Changes that would pop mid-shot land on a tour cut.

**Working on the scene.** [Architecture](ARCHITECTURE.md) for ownership and lifecycle, [Contracts](CONTRACTS.md) for what the bundles promise each other, [Scene modes](SCENE-MODES.md) for URLs and status objects, and the [Glossary](GLOSSARY.md) for the vocabulary. Keep to the subsystem hooks and restore borrowed resources before freeing derived ones (AGENTS.md rule 2).

**Releasing.** [Operations](OPERATIONS.md) for the gates, CI, deploy and rollback; [Testing](TESTING.md) for the suite and the per-release Lighthouse passes on GPU hardware; [Troubleshooting](TROUBLESHOOTING.md) when a gate fails.

**Reviewing a pull request.**

- CI is green: build, audit and, for a same-repository branch, the preview.
- The diff holds no `dist/` output, no new dependency and no workflow or secret change without the owner's authorization (AGENTS.md rule 6).
- Every changed test value is a deliberate lock change with its reason ([Testing](TESTING.md#locked-values)).
- Docs that state a changed behaviour, value or command are updated in the same pull request.
- Visual changes come with captures reviewed by the [visual review](TESTING.md#visual-review) protocol, on desktop and portrait.
- The discovery files stay accurate and non-sensitive.

## Contributing

**Flow.** Work on a branch and open a pull request to `main`. [ci.yml](../.github/workflows/ci.yml) then runs:

1. `build`: `npm ci`, `audit:ci`, `format:check`, `verify`, `npm test` and `build:dist`, uploading `dist/` as the `site-dist` artifact.
2. `audit`: Lighthouse on that artifact ([Testing](TESTING.md#lighthouse)).
3. `preview`, for branches in this repository only: once the `preview` environment's approval is given, deploys the artifact to the Pages alias `preview-SLUG` and smoke-checks it; `comment` posts the URL on the pull request. `SLUG` is the branch name in lower case, with each character outside `a–z`, `0–9` and `-` replaced by `-`, runs of `-` collapsed to one and leading and trailing `-` removed, then cut to 20 characters (a trailing `-` removed again); if nothing remains it is `run-` and the run's id.

Merging the approved pull request releases through [deploy.yml](../.github/workflows/deploy.yml) ([Operations](OPERATIONS.md#deploy-and-smoke-checks)).

**Local gates.** Before pushing, run `npm run format`, `npm run verify` and `npm test`, and `npm run build:dist` when the published output changes (AGENTS.md rule 3). The [README's table](../README.md#work-locally) lists the commands; [Operations](OPERATIONS.md#release-gates) gives the full CI-equivalent sequence.

**Formatting.** Prettier 3.9.9 (pinned in `package.json`, configured in `.prettierrc.json`) formats the repository, Markdown included; `.prettierignore` leaves out `package-lock.json`, and `.gitattributes` keeps LF line endings. `.git-blame-ignore-revs` lists the commit that formatted the whole repository; GitHub's blame view skips it, and `git config blame.ignoreRevsFile .git-blame-ignore-revs` makes local blame do the same.

**Dependencies.** No new dependency without the owner's authorization (AGENTS.md rule 6). Dependabot proposes npm and GitHub Actions updates weekly ([dependabot.yml](../.github/dependabot.yml)), except `three`, which `package.json` pins at exactly 0.160.1 for r160's legacy light units; a test holds that version, and upgrading it needs a deliberate visual review.
