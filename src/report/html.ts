import type { AggregateResult, GroupSummary } from "../aggregate";
import { formatMoney, formatPercent, formatTokens } from "../format";

/**
 * Static HTML report renderer.
 *
 * Produces a single self-contained HTML file (inline CSS, no external
 * requests, no client-side framework) with real bars sized from computed
 * aggregate data - following the general "render real bars/SVG from
 * computed numbers, not decoration" approach used elsewhere in this
 * portfolio (e.g. meshmap's renderer), but written independently here: this
 * file shares no code with that project.
 *
 * Palette and mark choices follow the project's data-viz guidelines: a
 * fixed-order categorical palette for project/model identity, a single-hue
 * sequential ramp for the day-over-day magnitude chart, thin capped bars
 * with rounded data-ends, a 2px surface gap between bars, and value labels
 * at the bar tip rather than a color-only legend.
 */

const CATEGORICAL_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const CATEGORICAL_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OTHER_LIGHT = "#898781";
const OTHER_DARK = "#898781";
const SEQUENTIAL_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const SEQUENTIAL_DARK = ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse a sorted-desc group list to the top N entries plus a synthetic "Other". */
function topNWithOther(groups: GroupSummary[], n: number): GroupSummary[] {
  if (groups.length <= n) return groups;
  const top = groups.slice(0, n - 1);
  const rest = groups.slice(n - 1);
  const other: GroupSummary = {
    key: `Other (${rest.length} more)`,
    cost: rest.reduce((s, g) => s + g.cost, 0),
    inputTokens: rest.reduce((s, g) => s + g.inputTokens, 0),
    outputTokens: rest.reduce((s, g) => s + g.outputTokens, 0),
    cacheReadTokens: rest.reduce((s, g) => s + g.cacheReadTokens, 0),
    cacheCreationTokens: rest.reduce((s, g) => s + g.cacheCreationTokens, 0),
    eventCount: rest.reduce((s, g) => s + g.eventCount, 0),
    estimatedEventCount: rest.reduce((s, g) => s + g.estimatedEventCount, 0),
  };
  return [...top, other];
}

function categoricalBarChart(groups: GroupSummary[], idPrefix: string): string {
  const shown = topNWithOther(groups, 8);
  const max = Math.max(0, ...shown.map((g) => g.cost));
  const rows = shown
    .map((g, i) => {
      const isOther = g.key.startsWith("Other (");
      const lightColor = isOther ? OTHER_LIGHT : CATEGORICAL_LIGHT[i % CATEGORICAL_LIGHT.length];
      const darkColor = isOther ? OTHER_DARK : CATEGORICAL_DARK[i % CATEGORICAL_DARK.length];
      const pct = max > 0 ? Math.max(1.5, (g.cost / max) * 100) : 0;
      const estFlag = g.estimatedEventCount > 0 ? ` <span class="chip" title="${g.estimatedEventCount} of ${g.eventCount} turns used estimated token counts">~est</span>` : "";
      return `
      <div class="bar-row">
        <div class="bar-label" title="${escapeHtml(g.key)}">${escapeHtml(g.key)}${estFlag}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct.toFixed(2)}%; --bar-color-light:${lightColor}; --bar-color-dark:${darkColor};"></div>
        </div>
        <div class="bar-value">${formatMoney(g.cost)}</div>
      </div>`;
    })
    .join("\n");
  return `<div class="bar-chart" id="${idPrefix}">${rows}\n</div>`;
}

function sequentialDayChart(byDay: GroupSummary[]): string {
  const max = Math.max(0, ...byDay.map((d) => d.cost));
  const rows = byDay
    .map((d) => {
      const pct = max > 0 ? Math.max(1.5, (d.cost / max) * 100) : 0;
      // Map relative magnitude to a step in the sequential ramp (lighter = smaller).
      const step = max > 0 ? Math.min(SEQUENTIAL_LIGHT.length - 1, Math.floor((d.cost / max) * (SEQUENTIAL_LIGHT.length - 1))) : 0;
      const estFlag = d.estimatedEventCount > 0 ? ` <span class="chip" title="${d.estimatedEventCount} of ${d.eventCount} turns used estimated token counts">~est</span>` : "";
      return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(d.key)}${estFlag}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct.toFixed(2)}%; --bar-color-light:${SEQUENTIAL_LIGHT[step]}; --bar-color-dark:${SEQUENTIAL_DARK[SEQUENTIAL_DARK.length - 1 - step]};"></div>
        </div>
        <div class="bar-value">${formatMoney(d.cost)}</div>
      </div>`;
    })
    .join("\n");
  return `<div class="bar-chart" id="by-day">${rows}\n</div>`;
}

function statTile(label: string, value: string, sub?: string): string {
  return `
    <div class="stat-tile">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ""}
    </div>`;
}

export function renderHtmlReport(result: AggregateResult, filesScanned: number, filesUnrecognized: number, generatedAt = new Date()): string {
  const { totals, byDay, byProject, byModel, unmatchedModels } = result;

  const pricingWarning =
    totals.unmatchedPricingModelCount > 0
      ? `<p class="warning">${totals.unmatchedPricingModelCount} model(s) had no entry in the static pricing table and used a placeholder rate: ${escapeHtml(unmatchedModels.join(", "))}. Their cost figures are less trustworthy than the rest of this report - see src/pricing/pricing-table.ts.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent Cost Ledger - report</title>
<style>
  .viz-root {
    color-scheme: light;
    --page-plane:     #f9f9f7;
    --surface-1:      #fcfcfb;
    --text-primary:   #0b0b0b;
    --text-secondary: #52514e;
    --text-muted:     #898781;
    --gridline:       #e1e0d9;
    --baseline:       #c3c2b7;
    --border:         rgba(11,11,11,0.10);
  }
  @media (prefers-color-scheme: dark) {
    .viz-root {
      color-scheme: dark;
      --page-plane:     #0d0d0d;
      --surface-1:      #1a1a19;
      --text-primary:   #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted:     #898781;
      --gridline:       #2c2c2a;
      --baseline:       #383835;
      --border:         rgba(255,255,255,0.10);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page-plane);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: var(--text-secondary); font-size: 13px; margin: 0 0 28px; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 22px;
    margin-bottom: 20px;
  }
  .card h2 { font-size: 15px; margin: 0 0 14px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat-tile {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 20px;
    flex: 1 1 180px;
  }
  .stat-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 600; }
  .stat-sub { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .bar-chart { display: flex; flex-direction: column; gap: 2px; }
  .bar-row { display: grid; grid-template-columns: 200px 1fr 90px; align-items: center; gap: 10px; min-height: 26px; }
  .bar-label { font-size: 13px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { background: var(--gridline); border-radius: 4px; height: 20px; position: relative; }
  .bar-fill {
    background: var(--bar-color-light);
    height: 20px;
    border-radius: 4px;
    min-width: 4px;
  }
  @media (prefers-color-scheme: dark) {
    .bar-fill { background: var(--bar-color-dark); }
  }
  .bar-value { font-size: 13px; color: var(--text-primary); text-align: right; font-variant-numeric: tabular-nums; }
  .chip {
    display: inline-block;
    font-size: 10px;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 5px;
    margin-left: 4px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--gridline); font-variant-numeric: tabular-nums; }
  th { color: var(--text-secondary); font-weight: 600; }
  .warning { color: var(--text-secondary); background: rgba(237,161,0,0.12); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
  footer { color: var(--text-muted); font-size: 12px; margin-top: 24px; line-height: 1.5; }
  a { color: inherit; }
</style>
</head>
<body class="viz-root">
  <div class="wrap">
    <h1>Agent Cost Ledger</h1>
    <p class="meta">Generated ${escapeHtml(generatedAt.toISOString())} - ${filesScanned} log file(s) scanned, ${filesUnrecognized} unrecognized/skipped.</p>

    ${pricingWarning}

    <div class="stat-row">
      ${statTile("Total estimated spend", formatMoney(totals.totalCost), "Sum of every parsed model turn's estimated cost")}
      ${statTile("Model turns", String(totals.eventCount), `${formatPercent(totals.exactEventCount, totals.eventCount)} exact · ${formatPercent(totals.estimatedEventCount, totals.eventCount)} estimated`)}
      ${statTile("Input tokens", formatTokens(totals.totalInputTokens), "fresh, non-cached")}
      ${statTile("Output tokens", formatTokens(totals.totalOutputTokens), "generated")}
      ${statTile("Cache read tokens", formatTokens(totals.totalCacheReadTokens), "discounted ~0.1x")}
    </div>

    <div class="card">
      <h2>Spend by day</h2>
      ${sequentialDayChart(byDay)}
    </div>

    <div class="card">
      <h2>Spend by project</h2>
      ${categoricalBarChart(byProject, "by-project")}
    </div>

    <div class="card">
      <h2>Spend by model</h2>
      ${categoricalBarChart(byModel, "by-model")}
    </div>

    <footer>
      Figures are ESTIMATES computed from a static local pricing table (src/pricing/pricing-table.ts) that needs
      manual updates as vendor pricing changes. "~est" marks a bucket containing at least one model turn whose
      token counts were not present in the source log and were approximated with a chars/4 heuristic instead of
      the real usage metadata. This report never sends data anywhere - it was generated entirely from log files
      already on this machine.
    </footer>
  </div>
</body>
</html>
`;
}
