import { describe, expect, it } from "vitest";
import { computeCost, getModelPricing } from "../src/pricing/pricing-table";

describe("pricing table", () => {
  it("matches known current-generation model ids exactly", () => {
    const { pricing, matched } = getModelPricing("claude-sonnet-5");
    expect(matched).toBe(true);
    expect(pricing.input).toBe(2);
    expect(pricing.output).toBe(10);
  });

  it("strips a dated snapshot suffix to find the base model", () => {
    const { pricing, matched } = getModelPricing("claude-opus-4-5-20251101");
    expect(matched).toBe(true);
    expect(pricing.input).toBe(5);
    expect(pricing.output).toBe(25);
  });

  it("falls back to a labeled placeholder rate for a totally unknown model, without throwing", () => {
    const { matched, pricing } = getModelPricing("some-future-model-nobody-has-heard-of");
    expect(matched).toBe(false);
    expect(pricing.input).toBeGreaterThan(0);
    expect(pricing.output).toBeGreaterThan(0);
  });

  it("computes exact dollar cost for a fresh-input + output turn (claude-sonnet-5: $2/$10 per MTok)", () => {
    const result = computeCost(
      { inputTokens: 1_000_000, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: 1_000_000 },
      "claude-sonnet-5",
    );
    expect(result.inputCost).toBeCloseTo(2, 6);
    expect(result.outputCost).toBeCloseTo(10, 6);
    expect(result.totalCost).toBeCloseTo(12, 6);
  });

  it("applies the 1.25x 5-minute cache-write multiplier and 0.1x cache-read multiplier", () => {
    const result = computeCost(
      { inputTokens: 0, cacheCreation5mTokens: 1_000_000, cacheCreation1hTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 },
      "claude-sonnet-5",
    );
    // base input rate is $2/MTok -> write5m = 2 * 1.25 = $2.50, read = 2 * 0.1 = $0.20
    expect(result.cacheWriteCost).toBeCloseTo(2.5, 6);
    expect(result.cacheReadCost).toBeCloseTo(0.2, 6);
    expect(result.totalCost).toBeCloseTo(2.7, 6);
  });

  it("applies the 2x 1-hour cache-write multiplier", () => {
    const result = computeCost(
      { inputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
      "claude-opus-4-8",
    );
    // base input rate is $5/MTok -> write1h = 5 * 2.0 = $10
    expect(result.cacheWriteCost).toBeCloseTo(10, 6);
  });

  it("reproduces the exact fixture-1 first-turn cost by hand", () => {
    // Same numbers as test/fixtures/project-alpha/session-a.jsonl, first assistant line.
    const result = computeCost(
      { inputTokens: 1000, cacheCreation5mTokens: 2000, cacheCreation1hTokens: 0, cacheReadTokens: 3000, outputTokens: 500 },
      "claude-sonnet-5",
    );
    expect(result.totalCost).toBeCloseTo(0.0126, 8);
  });
});
