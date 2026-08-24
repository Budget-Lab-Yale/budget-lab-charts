# Config reference

Authoritative list of fields you can set in this repo's config files. Defaults are applied
implicitly — **only declare what differs**.

There are two halves, and they are maintained differently:

| | Where | Who owns it |
|---|---|---|
| **Figure config** — `chart.yaml`, `table.yaml`, colors, CSV format | [ENGINE-CONFIG-SPEC.md](ENGINE-CONFIG-SPEC.md) | the **engine**; vendored here verbatim at the pinned version |
| **Collection config** — `article.yaml`, `tracker.yaml`, ids, figure numbers | this file | **this repo** |

`ENGINE-CONFIG-SPEC.md` is a copy of the pinned engine's own spec, so you never need to open the
engine repo to write a figure — and writing a figure never involves editing the engine. Do not edit
that file: `npm run validate` fails when it drifts from the pinned version. After changing the
engine pin, run `npm run vendor-spec` and commit the result.

The figure schema is **strict** (`additionalProperties: false` at every level), so a typo like
`xAxisTpye` or `serires_order` **fails the build** rather than being silently ignored. Never invent
a field — if it isn't in `ENGINE-CONFIG-SPEC.md` for the pinned engine, it doesn't exist.

## Files

```
charts/
  articles/<year>/<month>/<collection-slug>/
    article.yaml                # one-off collection metadata
    <figure-folder>/
      chart.yaml                # ChartSpec — or table.yaml (TableSpec)
      data.csv                  # tidy/long-format data
  trackers/<collection-slug>/
    tracker.yaml                # living-collection metadata
    <figure-folder>/
      chart.yaml                # or table.yaml
      data.csv
```

A figure's durable id is **`<collection-slug>/<figure-folder-name>`** — no date, no tree. The
figure segment is the **folder name** (there is no `slug` field in `chart.yaml` or `table.yaml`);
the collection slug is declared in the collection file. Set both once and don't rename them.

`<year>/<month>` under `articles/` should match the collection's `date`. It is an on-disk
convenience, not part of the id, but keeping it honest is how the tree stays browsable.

---

## `article.yaml` (one-off collection)

```yaml
title: "Article title"
slug: "collection-slug"      # durable; lowercase/ASCII/hyphenated; unique repo-wide
date: "YYYY-MM-DD"           # publication date — a real property of a one-off
url: "https://..."           # leave empty until published
figures:                     # optional: figure-number eyebrows, in presentation order
  chart-folder-slug: "Figure 1"
```

| field | required | notes |
|---|---|---|
| `title` | yes | Collection / article title. Should match the published article's title exactly — it is the heading each publication gets in the gallery. |
| `slug` | yes | First segment of every chart id under it. Lowercase/ASCII/hyphenated, unique repo-wide. Never a date. |
| `date` | recommended | Publication date. Orders publications in the gallery and is shown on each one. |
| `url` | optional | Canonical article URL. When set, the gallery shows a link-out on that publication; when empty, no link. Prefer the canonical URL over one that redirects. |
| `figures` | optional | Map of **chart-folder slug → eyebrow label** (see [Figure numbers](#figure-numbers)). |

## `tracker.yaml` (living collection)

```yaml
title: "Tracker title"
slug: "collection-slug"
url: "https://..."
created: "YYYY-MM-DD"        # optional: immutable first-publication date
cadence: "monthly"           # optional human note; not part of identity
figures:
  chart-folder-slug: "Figure 1"
```

| field | required | notes |
|---|---|---|
| `title` | yes | Tracker title. |
| `slug` | yes | Same rules as above. |
| `url` | optional | Canonical tracker URL; same link-out behaviour as above. |
| `created` | optional | Immutable first-publication date (trackers are dateless in identity; versioned in place via git). Used where a one-off would use `date`. |
| `cadence` | optional | Human note (e.g. `"monthly"`); not part of identity. Shown as a label beside the tracker's title in the gallery. |
| `figures` | optional | Same as above. |

### Figure numbers

A figure number ("Figure 1", "Appendix Figure 2") is a property of the **article a chart is
embedded in**, not the chart — so it is **not** a `chart.yaml` field. The collection file's
optional `figures:` map keys each chart-folder slug to a label. `build-all` passes the matching
label to the engine (`--eyebrow`); the embed can suppress it at view time with `?eyebrow=off`.
A chart omitted from the map renders with no eyebrow. Validation fails if a `figures` key matches
no chart folder in the collection.

**The order you write the map in is the order figures appear** under that publication in the
gallery. Nothing parses the labels — so "Appendix Figure A1" and "Table 2" sort exactly where you
put them, and reordering a publication means reordering these lines. A chart missing from the map
sorts last.

---

## Verifying

```sh
npm run vendor-spec  # only after changing the engine pin
npm run validate     # the merge gate: structure, engine schema, catalog build, vendored spec
npm run dev          # live preview at localhost:5173
```

`catalog/index.json` is generated rather than committed — CI rebuilds it on every publish, so
retitling or renumbering a figure is a one-file change. `npm run all` regenerates the vendored spec
before the gate, so it self-heals a stale one; `npm run validate` on its own reports it as a
failure, which is what CI does.
