// Fixture tool for capture-interactive.test.mjs: mounts two charts and one table, then re-mounts the
// first chart (as a tool does when a control changes) with the same spec and selections but new rows.
const engine = () => window.BudgetLabChart;
const el = (id) => document.getElementById(id);

const byCategory = {
  chartType: "bar",
  data: "rows.csv",
  title: "Change in Prices by {dimension}",
  title_selectors: {
    dimension: {
      default: "sector",
      options: [
        { id: "sector", label: "Sector", color: "blue" },
        { id: "country", label: "Trading Partner", color: "amber" },
      ],
    },
  },
  subtitle: "Percent change versus baseline.",
  value_suffix: "%",
  orientation: "vertical",
  xAxisType: "categorical",
  columns: { x: "category", value: "value" },
};
const selections = { dimension: "country" };

const firstRows = [
  { category: "Canada", value: 1.5 },
  { category: "Mexico", value: 2 },
];
// The re-mount's rows: the ones that must be captured. Commas, quotes, a line break, and a column
// only some rows carry exercise the CSV writer.
const finalRows = [
  { category: "Canada", value: 1.25, note: "Includes \"USMCA\" goods" },
  { category: "Mexico", value: -0.5 },
  { category: "EU, incl. UK", value: 0.75, note: "line one\nline two" },
  { category: "Rest of World", value: 3 },
];

const unknownField = {
  chartType: "line",
  xAxisType: "numeric",
  columns: { x: "year", value: "value" },
  title: "A Spec With an Unknown Field",
  colour_scheme: "blue",
  data: "data.csv",
};
const unknownRows = [
  { year: 2026, value: 1 },
  { year: 2027, value: 2 },
  { year: 2028, value: 3 },
];

const summaryTable = { title: "Summary Statistics", columns: [{ key: "label" }, { key: "value" }] };
const summaryRows = [{ label: "Revenue", value: 100 }];

engine().mountChart(el("by-category"), { spec: byCategory, rows: firstRows, selections, downloadName: "by-category" });
engine().mountChart(el("unknown-field"), { spec: unknownField, rows: unknownRows, downloadName: "unknown-field" });
engine().mountTable(el("summary-table"), { spec: summaryTable, rows: summaryRows, downloadName: "summary-table" });

// After the network is idle: the capture must wait for the page to settle, not stop at load.
setTimeout(() => {
  engine().mountChart(el("by-category"), { spec: byCategory, rows: finalRows, selections: { ...selections }, downloadName: "by-category" });
}, 700);
