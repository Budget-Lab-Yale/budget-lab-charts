# budget-lab-charts

The Budget Lab's published-figures archive: chart/table specs + data, built and published by
CI. The chart engine is a pinned dependency; this repo is content only.

- **Adding or updating content** (articles, trackers, figures, tables, tracker data): use the
  `publishing-figures` skill (`.claude/skills/publishing-figures/`). It covers the interview,
  data reshaping, and verification workflow.
- **Schema authority**: `CONFIG-REFERENCE.md` (repo root). The spec schema is strict — unknown
  fields fail the build. Never invent fields.
- **Identity is permanent**: collection slugs and figure folder names become public embed URLs;
  never rename them after merge.
- **Verify**: `npm run validate` (merge gate), `npm run catalog` (regenerates the committed
  `catalog/index.json` — required after content changes), `npm run dev` (live preview at
  localhost:5173).
- PRs get an automatic live preview URL from CI; merging to `main` publishes.
