import { computeCost } from "./pricing/pricing-table";
import type { UsageEvent } from "./parsers/types";

export interface EventWithCost extends UsageEvent {
  cost: number;
  pricingMatched: boolean;
}

export interface Totals {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  eventCount: number;
  exactEventCount: number;
  estimatedEventCount: number;
  unmatchedPricingModelCount: number;
}

export interface GroupSummary {
  key: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  eventCount: number;
  estimatedEventCount: number;
}

export interface AggregateResult {
  totals: Totals;
  byDay: GroupSummary[];
  byProject: GroupSummary[];
  byModel: GroupSummary[];
  /** Model ids that fell back to the default placeholder pricing rate. */
  unmatchedModels: string[];
  events: EventWithCost[];
}

function dayKey(isoTimestamp: string): string {
  // Timestamps in the log are ISO-8601 UTC (e.g. "2026-09-10T10:00:05.000Z").
  // Slicing avoids Date/timezone conversion so the same log always buckets
  // the same way regardless of the machine running this tool.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(isoTimestamp);
  return match ? match[1] : "unknown-date";
}

function makeGrouper() {
  const groups = new Map<string, GroupSummary>();
  return {
    add(key: string, e: EventWithCost) {
      let g = groups.get(key);
      if (!g) {
        g = { key, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, eventCount: 0, estimatedEventCount: 0 };
        groups.set(key, g);
      }
      g.cost += e.cost;
      g.inputTokens += e.inputTokens;
      g.outputTokens += e.outputTokens;
      g.cacheReadTokens += e.cacheReadTokens;
      g.cacheCreationTokens += e.cacheCreation5mTokens + e.cacheCreation1hTokens;
      g.eventCount += 1;
      if (e.estimated) g.estimatedEventCount += 1;
    },
    values(): GroupSummary[] {
      return [...groups.values()];
    },
  };
}

/** Attach cost figures to raw usage events and roll them up by day/project/model. */
export function aggregate(events: UsageEvent[]): AggregateResult {
  const withCost: EventWithCost[] = events.map((e) => {
    const breakdown = computeCost(e, e.model);
    return { ...e, cost: breakdown.totalCost, pricingMatched: breakdown.matched };
  });

  const dayGrouper = makeGrouper();
  const projectGrouper = makeGrouper();
  const modelGrouper = makeGrouper();
  const unmatchedModels = new Set<string>();

  const totals: Totals = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    eventCount: 0,
    exactEventCount: 0,
    estimatedEventCount: 0,
    unmatchedPricingModelCount: 0,
  };

  for (const e of withCost) {
    dayGrouper.add(dayKey(e.timestamp), e);
    projectGrouper.add(e.projectDisplay, e);
    modelGrouper.add(e.model, e);

    totals.totalCost += e.cost;
    totals.totalInputTokens += e.inputTokens;
    totals.totalOutputTokens += e.outputTokens;
    totals.totalCacheReadTokens += e.cacheReadTokens;
    totals.totalCacheCreationTokens += e.cacheCreation5mTokens + e.cacheCreation1hTokens;
    totals.eventCount += 1;
    if (e.estimated) totals.estimatedEventCount += 1;
    else totals.exactEventCount += 1;
    if (!e.pricingMatched) unmatchedModels.add(e.model);
  }
  totals.unmatchedPricingModelCount = unmatchedModels.size;

  const byDay = dayGrouper.values().sort((a, b) => a.key.localeCompare(b.key));
  const byProject = projectGrouper.values().sort((a, b) => b.cost - a.cost);
  const byModel = modelGrouper.values().sort((a, b) => b.cost - a.cost);

  return { totals, byDay, byProject, byModel, unmatchedModels: [...unmatchedModels], events: withCost };
}
