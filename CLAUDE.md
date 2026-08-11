# budget-lab-charts

The Budget Lab's published-figures archive: chart/table specs + data, built and published by
CI. The chart engine is a pinned dependency; this repo is content only.

- **Adding or updating content** (articles, trackers, figures, tables, tracker data): use the
  `publishing-figures` skill (`.claude/skills/publishing-figures/`). It covers the interview,
  data reshaping, and verification workflow.
- **Schema authority**: figure fields (`chart.yaml`, `table.yaml`, colors, CSV) are in
  `ENGINE-CONFIG-SPEC.md` — the pinned engine's own spec, vendored verbatim; never edit it, and
  re-run `npm run vendor-spec` after a repin (`npm run validate` gates it). This repo's own config
  (`article.yaml`, `tracker.yaml`, ids, figure numbers) is in `CONFIG-REFERENCE.md`. The spec schema
  is strict — unknown fields fail the build. Never invent fields.
- **Identity is permanent**: collection slugs and figure folder names become public embed URLs;
  never rename them after merge.
- **Verify**: `npm run catalog` (regenerates the committed `catalog/index.json` — required after
  content changes; CI publishes the committed copy as-is), then `npm run validate` (merge gate;
  fails if that catalog is stale), `npm run dev` (live preview at localhost:5173).
- **Chart pages link a shared engine asset** (`_site/embed/v1/engine-<version>.js`) rather than
  inlining the engine. `npm run assets` writes it and must run before `npm run thumbs`; `npm run all`
  handles the order. Asset filenames carry the engine version, so an engine repin needs no other
  change — but never delete a published version's assets by hand; `prune.mjs` handles retention.
- PRs get an automatic live preview URL from CI; merging to `main` publishes.
- **No design docs or plans in this repo.** There is no `docs/` folder and adding one back for a
  spec or an implementation plan is wrong — a `docs/superpowers/` pair describing the (already
  shipped) incremental-build pipeline sat here for weeks with 36 unchecked task boxes, telling any
  agent that found it to re-implement working infrastructure. Rationale for a change goes in the PR
  description, transient plans stay in the session scratchpad, invariants go in a comment where they
  apply, and anything that must not drift gets a gate in `npm run validate` (as the catalog and the
  vendored engine spec do). See the global policy in `~/.claude/CLAUDE.md`.
