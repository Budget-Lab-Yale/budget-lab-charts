# Reshaping input data into the engine's CSV contract

Target shape (CONFIG-REFERENCE.md § CSV format): **long/tidy**, header row, one row per
observation. Any column names — map them in the spec's `columns:` block (`x`, `value`,
`series`, plus `facet`/`shape`/`section` when used). The x column must parse for the chosen
`xAxisType` (temporal = strict `YYYY-MM-DD`; quarterly = strict `YYYYQ#`; numeric = plain
number; categorical = any non-empty string). Value columns are numeric or empty (empty =
missing observation). Extra columns are tolerated. Tables are also tidy: one row per cell.

## The anomaly gate — ask, don't fix

While reshaping you will hit judgment calls. **Stop and ask the user before writing the file**
whenever you would alter, drop, or reinterpret a value:

- Accounting negatives — `(0.5)` means −0.5, but if −0.5 is wildly out of line with
  neighboring values it may be a corrupted cell. Options to present: keep as negative /
  treat as missing / user supplies the correct value.
- `NA`, `—`, `..`, blanks — usually missing (write as empty), but confirm when a whole
  series or period is affected.
- Outliers, sign conventions (is negative a deficit or a decline?), ambiguous units
  (dollars vs thousands vs percent), duplicate (x, series) rows with different values.

Mechanical cleanups need no question — do them and list them in your final summary:
strip `$`, thousands separators, `%`; normalize `M/D/YYYY` (and Excel serial dates) to
`YYYY-MM-DD`; normalize `Q1 2025` / `2025-Q1` to `2025Q1`; strip a UTF-8 BOM; unify series
names that differ only by punctuation (e.g. `High–income` with an en-dash vs `Low income`) —
renaming to plain ASCII words is safer than carrying unicode into config keys.

## Wide → long

Typical input: first column is x, each remaining column is a series.

```
Date,Low income,High income          time,series,value
1/15/2024,"$1,234","$5,890"     →    2024-01-15,Low income,1234
2/15/2024,"$1,290","$6,012"          2024-01-15,High income,5890
                                     2024-02-15,Low income,1290 ...
```

Write a throwaway script (Node ≥20 is guaranteed by this repo's `engines`; a scratch `.mjs`
or Python if available — never commit the script). Parse CSV properly (quoted fields contain
commas); write UTF-8 **without BOM**, LF endings, straight into the figure folder as `data.csv`.

## Excel input

1. First choice: ask the user for a CSV export when they can do it faster than you.
2. Otherwise read the workbook directly: Python + `openpyxl` if available, else
   `npx -y xlsx "<file.xlsx>" [SheetName]` dumps a sheet as CSV to stdout.
3. Convert Excel serial dates and formatted numbers during the melt, not by hand-editing.
Never fabricate values you could not actually read out of the file.

## Multiple files → one figure

Melt each file, tag rows with a `series` value (from the filename or by asking), concatenate,
sort by x then series.

## Sanity checks before writing data.csv

- Every x value parses under the chosen `xAxisType` (spot-check first/last rows).
- No duplicate (x, series) pairs.
- Any series/category names you reference in the spec (`series_order`, `series_colors`,
  `x_order`, `pane_order`…) must match the CSV values **byte-for-byte** — print
  `JSON.stringify` of the unique values to expose en-dashes, non-breaking spaces, and
  trailing whitespace before you type them into YAML.
