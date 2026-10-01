# Repository instructions

Source for alexnava.me: HTML, CSS, vanilla JavaScript, Three.js r160 and esbuild, on Node.js 22+. Every coding agent (Claude Code, Codex, Copilot, Cursor) follows this file.

- Edit readable source in src, index.html, styles.css, images and fonts. dist is generated publish output; never hand-edit or commit it.
- The build keeps the UI separate from the deferred `scripts/scene.HASH.js` bundle; published CSS, scripts and runtime images are content-hashed.
- Read [STYLE.md](STYLE.md) before visual changes, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for file ownership, and [docs/SCENE-MODES.md](docs/SCENE-MODES.md) for the camera. [OPERATIONS.md](OPERATIONS.md) owns release gates and delivery.

## Commands

| Action | Command |
| --- | --- |
| Develop with watch and preview | npm run dev |
| Build once | npm run build:dist |
| Preview once-built output | npm run preview |
| Verify compilation | npm run verify |
| Regression tests | npm test |
| Dependency audit | npm run audit:ci |

## Rules

1. Keep the UI independent of the optional scene. The static poster and text must stand alone when scripts, models or WebGL fail, and on the low quality tier.
2. Respect applyQuality, resize, update and dispose ownership. Restore borrowed resources before freeing derived ones.
3. Keep the public discovery files (site-agents.md, llms.txt, sitemap.md, index.md) accurate and non-sensitive. This file is internal and must not be published.
4. JavaScript changes need verify and tests; published-output changes need a build. Update docs when ownership or commands change.
5. Preserve other worktrees, original artwork and uncommitted work. No push, merge, deploy, secret/CI change or new dependency without the owner's authorization.
