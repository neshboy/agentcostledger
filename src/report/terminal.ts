import type { AggregateResult } from "../aggregate";
import { asciiBar, formatMoney, formatPercent, formatTokens } from "../format";

export function renderTerminalReport(result: AggregateResult, filesScanned: number, filesUnrecognized: number): string {
  const { totals, byDay, byProject, byModel, unmatchedModels } = result;
  const lines: string[] = [];

  lines.push("");
  lines.push("Agent Cost Ledger - scan summary");
  lines.push("=".repeat(60));
  lines.push(`Log files scanned:      ${filesScanned} (${filesUnrecognized} unrecognized/skipped)`);
  lines.push(`Model turns counted:    ${totals.eventCount}`);
  lines.push(
    `Token counts:           ${totals.exactEventCount} exact (from log usage data), ${totals.estimatedEventCount} estimated (chars/4 fallback)`,
  );
  if (totals.unmatchedPricingModelCount > 0) {
    lines.push(
      `Pricing warning:        ${totals.unmatchedPricingModelCount} model(s) not in the pricing table, using placeholder rate: ${unmatchedModels.join(", ")}`,
    );
  }
  lines.push("");
  lines.push(`TOTAL ESTIMATED SPEND:  ${formatMoney(totals.totalCost)}`);
  lines.push(
    `  input ${formatTokens(totals.totalInputTokens)} tok, output ${formatTokens(totals.totalOutputTokens)} tok, ` +
      `cache read ${formatTokens(totals.totalCacheReadTokens)} tok, cache write ${formatTokens(totals.totalCacheCreationTokens)} tok`,
  );
  lines.push(
    `  ${formatPercent(totals.exactEventCount, totals.eventCount)} of turns used exact token counts from the log; ` +
      `${formatPercent(totals.estimatedEventCount, totals.eventCount)} used the chars/4 estimate.`,
  );

  lines.push("");
  lines.push("By day");
  lines.push("-".repeat(60));
  const maxDayCost = Math.max(0, ...byDay.map((d) => d.cost));
  for (const d of byDay) {
    const flag = d.estimatedEventCount > 0 ? "~" : " ";
    lines.push(`${d.key} ${flag} ${asciiBar(d.cost, maxDayCost)} ${formatMoney(d.cost).padStart(10)}`);
  }

  lines.push("");
  lines.push("By project");
  lines.push("-".repeat(60));
  const maxProjectCost = Math.max(0, ...byProject.map((p) => p.cost));
  for (const p of byProject) {
    const label = p.key.length > 34 ? "..." + p.key.slice(-31) : p.key;
    lines.push(`${label.padEnd(34)} ${asciiBar(p.cost, maxProjectCost, 20)} ${formatMoney(p.cost).padStart(10)}`);
  }

  lines.push("");
  lines.push("By model");
  lines.push("-".repeat(60));
  const maxModelCost = Math.max(0, ...byModel.map((m) => m.cost));
  for (const m of byModel) {
    lines.push(`${m.key.padEnd(34)} ${asciiBar(m.cost, maxModelCost, 20)} ${formatMoney(m.cost).padStart(10)}`);
  }

  lines.push("");
  lines.push("(~ = day includes turns with estimated, not exact, token counts)");
  lines.push("Figures are ESTIMATES from a static local pricing table - see README Limitations.");
  lines.push("");

  return lines.join("\n");
}
