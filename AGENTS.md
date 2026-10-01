# Repository instructions

Source for alexnava.me: HTML, CSS, vanilla JavaScript, Three.js r160 and esbuild on Node.js 22. Every coding agent (Claude Code, Codex, Copilot, Cursor) follows this file. Commands are in the [README's table](README.md#work-locally).

- Edit readable source: `src/`, `index.html`, `404.html`, `styles.css`, `images/`, `fonts/` and `public/` (hosting, icon and discovery files copied to the site root). `dist/` is generated; never hand-edit or commit it.
- Read [docs/STYLE.md](docs/STYLE.md) before visual changes, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for ownership and lifecycle, [docs/SCENE-MODES.md](docs/SCENE-MODES.md) for the camera and status objects, and [docs/OPERATIONS.md](docs/OPERATIONS.md) for release gates and delivery.

## Rules

1. Keep the UI independent of the scene. The title card (CSS night sky, identity and About; no picture) and the text must stand alone when scripts, models or WebGL fail, and on the low tier. The loading line appears only on the live path and never sticks: it completes at the reveal or retires.
2. Respect the subsystem hooks (`applyQuality`, `resize`, `update`, `dispose`). Restore borrowed resources before freeing derived ones, and land visible changes on a tour cut.
3. Before finishing, run `npm run format`, `npm run verify` and `npm test`; changes to published output also need `npm run build:dist`. Shared test helpers live in `test/support/`; source checks use its `flat()` so they survive formatting.
4. Keep the public discovery files (`public/site-agents.md`, `public/llms.txt`, `public/sitemap.md`, `public/index.md`) accurate and non-sensitive. This file is internal and is never published.
5. Update the docs when ownership, behaviour or commands change; describe the current state, not its history.
6. Preserve other worktrees, original artwork and uncommitted work. No push, merge, deploy, secret or CI change, or new dependency without the owner's authorization.
