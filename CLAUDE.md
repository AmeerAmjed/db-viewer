# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DB Viewer: a web app that draws a Postgres/Supabase schema as an interactive ER diagram, hosted at https://ameeramjed.github.io/db-viewer/ (repo `AmeerAmjed/db-viewer`). Tables start collapsed and expand to show columns and types. Foreign keys are drawn as edges. Selecting a table opens a detail panel listing "references" and "referenced by". The diagram exports to PNG, SVG, SQL, Mermaid, DBML and JSON and has a light/dark theme. Stack: Vite + React 19 + TypeScript, `@xyflow/react` (React Flow 12) for the canvas, `@dagrejs/dagre` for auto-layout, `html-to-image` for export.

## Commands

- `npm run dev`: dev server (also serves `/api/introspect`, see below)
- `npm run build`: `tsc --noEmit` then `vite build`
- `npm run typecheck`
- `npm test`: Vitest, all tests
- Single test: `npx vitest run src/schema/sqlParser.test.ts -t "composite primary keys"`

Deployment: `.github/workflows/pages.yml` tests, builds with `VITE_STATIC_HOST=true` and publishes `dist/` to GitHub Pages on every push to `main`. `vite.config.ts` uses `base: './'` so the build works under any repo path. The static build has no server, so `src/env.ts` (`CAN_CONNECT`) hides the Connect tab there.

`vitest@5` declares a peer range that confuses npm 10 on a fresh resolve. If adding or upgrading dev dependencies fails with `Cannot read properties of null (reading 'edgesOut')`, use `--legacy-peer-deps`. A plain `npm install` from the lockfile works.

## Architecture

There are two schema sources, one model, and one renderer.

- `src/schema/model.ts`: the `Schema` / `Table` / `Column` / `Relation` model. Both sources collect tables plus `PendingForeignKey`s and call `buildSchema`. It resolves FK targets (an omitted target column means the target's PK) and creates **external** placeholder tables for referenced-but-undefined tables such as `auth.users`. It also sets each relation's `kind`: `one-to-one` when the FK columns are exactly the PK or a single UNIQUE column, otherwise `many-to-one`. The diagram draws this as crow's-foot markers (`src/diagram/RelationMarkers.tsx`). Table ids are `schema.name`. Unquoted identifiers are lower-cased (Postgres folding).
- `src/schema/sqlParser.ts`: a hand-written tolerant DDL reader (no SQL library). Pipeline: `splitStatements` (drops comments, respects quotes and `$tag$` bodies) → `CREATE TABLE` / `ALTER TABLE … ADD` only → items split on top-level commas → column clauses split at top-level keywords. Every lexical helper skips quoted text and treats `()`/`[]` as nesting. That is what keeps `CHECK (x = ANY (ARRAY['a', 'b']))` intact. Supabase's "schema for context" export uses placeholder types (`ARRAY`, `USER-DEFINED`) and duplicate constraint names; the tests cover both.
- `src/schema/openApi.ts`: the live-project source. It converts the PostgREST OpenAPI document. PK/FK info only exists as `<pk/>` and `<fk table='…' column='…'/>` markers inside column descriptions. It only sees the exposed schema and has no CHECKs.
- `src/schema/exporters.ts`: model → SQL DDL, Mermaid `erDiagram`, DBML and JSON. `toSql` must round-trip through `parseSql` (tested), which is why identity columns keep their `GENERATED …` text in `Column.generated`. The toolbar's Export menu (`src/ui/ExportMenu.tsx`) exports `subset(schema, focusSet)`, so focus mode exports only the visible tables; image export and copy live in `src/diagram/exportImage.ts`.
- `server/supabaseProxy.ts`: a Vite plugin adding `POST /api/introspect {url, key}` to the dev and preview servers. It fetches `{url}/rest/v1/` server-side because Supabase rejects secret/service_role keys on browser requests. Legacy JWT keys also go in `Authorization`; `sb_*` keys go only in `apikey`. There is no production backend: a static `dist/` build has paste-SQL only.
- `src/App.tsx`: holds all state. `nodes` (React Flow state) keeps only id, position and table. Per-render flags (expanded, active, dimmed, FK columns) are layered on in `viewNodes`, so highlight and expand changes don't reset dragged positions. Hover takes precedence over selection for highlighting. Toggling one table re-runs the layout, offset so that table stays put on screen.
- `src/diagram/layout.ts`: dagre LR layout (a referencing table sits left of its target). Tables with no relations go in a grid below. `NODE_WIDTH` / `HEADER_HEIGHT` / `ROW_HEIGHT` must match `.tn`, `.tn-header` and `.tn-row` in `src/styles.css`, or the layout overlaps.
- `src/diagram/TableNode.tsx`: every column always renders its source and target handles (`columnSource` / `columnTarget`). They sit in the header while the table is collapsed and on the row while it is expanded. Edges therefore always target column handles and never reference an unmounted handle. Expansion is toggled through `ToggleTableContext`, not a callback in node data.
- `src/schema/example.sql`: a small fictional schema in Supabase's "schema for context" export format, loaded via `?raw` by both the app's **Load example** button and the parser tests. Keep real project schemas out of the repo.

Phone layout (≤800px, `isPhone()` in `App.tsx` must match the `@media` breakpoint at the end of `styles.css`): the canvas fills the screen under a top nav bar (`src/ui/MobileNav.tsx`, which replaces the desktop toolbar and puts its actions and the export options in a ⋮ dropdown; App switches on `useMediaQuery(PHONE_QUERY)`), the sidebar is a drawer that starts closed and closes after picking a table or loading a schema, and the details panel is a bottom sheet (`phoneSheetPadding` fits the selection above it). Hover effects are gated on `canHover()` because touch screens fire hover on tap and never end it; taps pin relation cards instead.

Persistence is `localStorage` only, through `src/storage.ts` (`sv.sql`, `sv.url`, `sv.theme`). API keys are never stored. Theming uses CSS variables on `:root` / `:root[data-theme='dark']`. The PNG export background reads `--canvas`.
