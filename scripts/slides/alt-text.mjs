// Plain-text title and alt text for a slide chart. resolveTitle mirrors the engine's own
// resolveTitleText (src/spec/title.ts) so alt_text names the same option the exported title shows.

const TYPE_NAMES = {
  line: "Line",
  area: "Area",
  bar: "Bar",
  stacked: "Stacked bar",
  scatter: "Scatter",
  dotplot: "Dot plot",
  waterfall: "Waterfall",
  histogram: "Histogram",
  dumbbell: "Dumbbell",
  timeline: "Timeline",
  treemap: "Treemap",
};

// Per key, the selected option wins only when it names a real option (as in the engine's
// resolveSelections); else the selector's valid default; else its first option.
function activeOption(selector, selected) {
  const options = selector?.options ?? [];
  const byId = (id) => (id == null ? undefined : options.find((o) => o.id === id));
  return byId(selected) ?? byId(selector?.default) ?? options[0];
}

export const typeName = (chartType) => (Object.hasOwn(TYPE_NAMES, chartType) ? TYPE_NAMES[chartType] : null);

export function resolveTitle(spec, selections = {}) {
  const title = spec?.title ?? "";
  const selectors = spec?.title_selectors;
  if (!selectors || !Object.keys(selectors).length) return title;
  return title.replace(/\{([A-Za-z0-9_-]+)\}/g, (token, key) => {
    if (!Object.hasOwn(selectors, key)) return token;
    const option = activeOption(selectors[key], selections?.[key]);
    return option ? String(option.label ?? option.id) : token;
  });
}

export function altText(spec, selections = {}) {
  const type = typeName(spec?.chartType) ? `${typeName(spec.chartType)} chart` : "Chart";
  const title = resolveTitle(spec, selections).trim();
  const subtitle = String(spec?.subtitle ?? "").trim();
  return [`${type}:`, title && `${title}.`, subtitle].filter(Boolean).join(" ");
}
