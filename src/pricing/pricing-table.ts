/**
 * Static, manually-maintained per-model pricing table.
 *
 * PRICING CHANGES OVER TIME AND THIS FILE DOES NOT AUTO-UPDATE. These numbers
 * were last checked against Anthropic's published API pricing as of
 * 2026-09-24. Before trusting a dollar figure this tool prints, cross-check
 * https://www.anthropic.com/pricing (or the equivalent page for whichever
 * vendor a future parser covers) and update the table below if it has
 * changed. Cost figures produced by this tool are ESTIMATES computed from
 * this table, not real invoices - they will not match a vendor's billing UI
 * exactly (billing may apply batch discounts, promo credits, org-level
 * tiers, or a pricing revision this file hasn't caught up to yet).
 *
 * Units: dollars per 1,000,000 tokens.
 */
export interface ModelPricing {
  /** $ per 1M fresh (non-cached) input tokens. */
  input: number;
  /** $ per 1M output tokens. */
  output: number;
  /** Where these numbers came from / any caveats. */
  note: string;
}

/**
 * Prompt-cache pricing multipliers, applied to the base input rate above.
 * These are the generally-documented Anthropic prompt-caching multipliers:
 * cache writes cost more than a fresh input token (you pay to populate the
 * cache), cache reads cost much less (a discounted hit). They apply to every
 * model in this table except where a model's own docs state a different
 * cache-read rate (noted per-model below when known); this tool uses the
 * general-case multipliers uniformly as a documented approximation.
 */
export const CACHE_MULTIPLIERS = {
  /** Writing to the 5-minute-TTL prompt cache. */
  write5m: 1.25,
  /** Writing to the 1-hour-TTL prompt cache. */
  write1h: 2.0,
  /** Reading a cache hit. */
  read: 0.1,
};

/**
 * Current-generation models. Source: Anthropic API pricing / model catalog,
 * checked 2026-09-24.
 */
const CURRENT_GEN: Record<string, ModelPricing> = {
  "claude-fable-5-1": { input: 10, output: 50, note: "Checked 2026-09-24. Cache reads documented at $0.25/MTok (0.025x), not the generic 0.1x used by this table - treat this model's cost as a rough underestimate until modelled explicitly." },
  "claude-mythos-5-1": { input: 10, output: 50, note: "Same pricing tier as claude-fable-5-1. Checked 2026-09-24." },
  "claude-fable-5": { input: 10, output: 50, note: "Checked 2026-09-24. Cache reads documented at $1/MTok (0.1x) - matches this table's generic multiplier." },
  "claude-mythos-5": { input: 10, output: 50, note: "Same pricing tier as claude-fable-5. Checked 2026-09-24." },
  "claude-opus-5-5": { input: 4, output: 20, note: "Launching / early tier pricing as documented 2026-09-24; confirm before relying on it." },
  "claude-opus-5": { input: 5, output: 25, note: "Checked 2026-09-24." },
  "claude-opus-4-8": { input: 5, output: 25, note: "Checked 2026-09-24." },
  "claude-opus-4-7": { input: 5, output: 25, note: "Checked 2026-09-24." },
  "claude-opus-4-6": { input: 5, output: 25, note: "Checked 2026-09-24." },
  "claude-sonnet-5": { input: 2, output: 10, note: "Checked 2026-09-24." },
  "claude-sonnet-4-6": { input: 3, output: 15, note: "Checked 2026-09-24." },
  "claude-haiku-4-5": { input: 1, output: 5, note: "Checked 2026-09-24." },
};

/**
 * Legacy / deprecated / retired models that may still show up in historical
 * logs. Prices below reflect Anthropic's last publicly listed rate for each
 * model before this file was written; these models are no longer being
 * actively price-checked, so treat them as more likely to be stale than the
 * current-generation table above.
 */
const LEGACY: Record<string, ModelPricing> = {
  "claude-opus-4-5": { input: 5, output: 25, note: "Legacy model, not re-checked recently." },
  "claude-opus-4-1": { input: 15, output: 75, note: "Deprecated model, last known published rate." },
  "claude-opus-4-0": { input: 15, output: 75, note: "Deprecated model, last known published rate." },
  "claude-sonnet-4-5": { input: 3, output: 15, note: "Legacy model, not re-checked recently." },
  "claude-sonnet-4-0": { input: 3, output: 15, note: "Deprecated model, last known published rate." },
  "claude-3-7-sonnet": { input: 3, output: 15, note: "Retired model, last known published rate." },
  "claude-3-5-sonnet": { input: 3, output: 15, note: "Retired model, last known published rate (both dated snapshots)." },
  "claude-3-5-haiku": { input: 0.8, output: 4, note: "Retired model, last known published rate." },
  "claude-3-sonnet": { input: 3, output: 15, note: "Retired model, last known published rate." },
  "claude-3-opus": { input: 15, output: 75, note: "Retired model, last known published rate." },
  "claude-3-haiku": { input: 0.25, output: 1.25, note: "Deprecated model, last known published rate." },
};

export const PRICING_TABLE: Record<string, ModelPricing> = { ...CURRENT_GEN, ...LEGACY };

export const DEFAULT_UNKNOWN_MODEL_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  note: "Model not found in the static pricing table - using a Sonnet-tier placeholder rate. Edit src/pricing/pricing-table.ts to add this model's real price.",
};

export interface PricingLookupResult {
  pricing: ModelPricing;
  /** false when the model id had no entry and the default placeholder was used. */
  matched: boolean;
}

/**
 * Look up pricing for a model id. Tries an exact match first, then strips a
 * trailing dated snapshot suffix (e.g. "claude-opus-4-5-20251101" ->
 * "claude-opus-4-5") since logs sometimes record the dated form, then a
 * prefix match against known families. Falls back to a labeled placeholder
 * rate rather than throwing, so an unrecognized/future model never breaks a
 * scan - it just gets flagged as using an unmatched default.
 */
export function getModelPricing(modelId: string): PricingLookupResult {
  if (PRICING_TABLE[modelId]) {
    return { pricing: PRICING_TABLE[modelId], matched: true };
  }

  const dateSuffixStripped = modelId.replace(/-\d{8}$/, "");
  if (PRICING_TABLE[dateSuffixStripped]) {
    return { pricing: PRICING_TABLE[dateSuffixStripped], matched: true };
  }

  const prefixMatch = Object.keys(PRICING_TABLE)
    .filter((key) => modelId.startsWith(key) || key.startsWith(modelId))
    .sort((a, b) => b.length - a.length)[0];
  if (prefixMatch) {
    return { pricing: PRICING_TABLE[prefixMatch], matched: true };
  }

  return { pricing: DEFAULT_UNKNOWN_MODEL_PRICING, matched: false };
}

export interface CostBreakdown {
  totalCost: number;
  inputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  outputCost: number;
  matched: boolean;
}

/** Compute the estimated dollar cost of one usage event's token counts. */
export function computeCost(
  tokens: {
    inputTokens: number;
    cacheCreation5mTokens: number;
    cacheCreation1hTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
  },
  modelId: string,
): CostBreakdown {
  const { pricing, matched } = getModelPricing(modelId);
  const perTokenInput = pricing.input / 1_000_000;
  const perTokenOutput = pricing.output / 1_000_000;

  const inputCost = tokens.inputTokens * perTokenInput;
  const cacheWriteCost =
    tokens.cacheCreation5mTokens * perTokenInput * CACHE_MULTIPLIERS.write5m +
    tokens.cacheCreation1hTokens * perTokenInput * CACHE_MULTIPLIERS.write1h;
  const cacheReadCost = tokens.cacheReadTokens * perTokenInput * CACHE_MULTIPLIERS.read;
  const outputCost = tokens.outputTokens * perTokenOutput;

  return {
    totalCost: inputCost + cacheWriteCost + cacheReadCost + outputCost,
    inputCost,
    cacheWriteCost,
    cacheReadCost,
    outputCost,
    matched,
  };
}
