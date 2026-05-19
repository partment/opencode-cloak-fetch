# AGENTS.md

## Commands

- Use `pnpm@11.1.0`; CI uses Node 24 and `pnpm install --ignore-scripts`.
- CI order: `pnpm run typecheck`, `pnpm run test`, `pnpm run build`.
- Single test: `pnpm exec vitest run test/challenges.test.ts`. Focused test: `pnpm exec vitest run test/challenges.test.ts -t "low-confidence"`.
- No lint or formatter script exists. Do not invent one.
- `tsconfig.json` includes only `src/**/*.ts`; tests sit outside typecheck, so run affected Vitest files when editing `test/`.

## Map

- `src/index.ts`: plugin entry; replaces `webfetch`, starts background CloakBrowser prep, reloads config per call.
- `src/fetch.ts`: launch/navigation/extraction; runs `domcontentloaded` -> challenge wait -> post-load delay -> `markdown|text|html`.
- `src/session.ts`: opt-in per-origin persistent Chromium profiles; skips auto profiles when `cloakbrowser.launchOptions.userDataDir` is set; locks each profile dir.
- Config files are `cloakfetch.json` / `cloakfetch.jsonc`, not `opencode.json`. Load order: global OpenCode config dir -> `OPENCODE_CONFIG_DIR` -> nearest `.opencode`; `.jsonc` wins over `.json` in the same dir.
- Config shape lives in three places: `src/schema.ts`, `configSchema.json`, README. Change all three or change none.
- `dist/` is generated and ignored. Edit `src/`.

## Sharp Edges

- ESM `NodeNext`: relative TypeScript imports use `.js` extensions.
- Tool arg schemas use `@opencode-ai/plugin`'s `tool.schema.*`, not local `zod`. Keep `webFetchFormats` in `src/schema.ts` as the single format tuple for `WebFetchFormatSchema` and `tool.schema.enum(webFetchFormats)`.
- Challenge detection must stay language-independent. Do not inspect page title/body/prose; use only technical fingerprints: resource URLs, iframe/form/link/object/embed URLs, meta refresh targets, id/class/name/data-* markers, cookie names, and navigation response headers.
- Challenge rules are weighted. Provider `minScore` is `10`; low-confidence telemetry/cookies such as Akamai `_abck`/`bm_sz`, `/akam/` pixels, DataDome cookie, Imperva cookies, and PerimeterX collector/cookies must not wait alone.
- Challenge tests use fake pages and runtime hooks. Add detector regressions there; no live network/browser dependencies.
- Persistent sessions store cookies/site state. Keep `session.enabled` default false; profile paths must be origin-only and must not leak credentials, path, or query.
- Profile/preparation locks use heartbeat/stale cleanup; release locks in `finally` paths.
- CloakBrowser binary preparation is shared by `CloakBrowserBinaryPreparer`; notifications/log writes are best-effort and must not break fetches. Tests inject fake binary providers.

## Release Notes

- Release workflow publishes only `v*` tags where `v<package.json version>` matches the tag, then runs typecheck, test, build, `npm pack --dry-run`, and trusted `npm publish --provenance`.
