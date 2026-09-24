import path from "path";
import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate";
import { discoverLogFiles, scanFiles } from "../src/scan";

const FIXTURES_ROOT = path.resolve(process.cwd(), "test/fixtures");

describe("end-to-end aggregation over the synthetic fixture tree", () => {
  const files = discoverLogFiles(FIXTURES_ROOT);
  const { filesScanned, filesUnrecognized, events } = scanFiles(files);
  const result = aggregate(events);

  it("discovers both fixture project directories and every jsonl file in them", () => {
    expect(filesScanned).toBe(3); // session-a, session-b, session-c
    expect(filesUnrecognized).toBe(0);
  });

  it("counts exactly 4 model turns total (2 + 1 + 1), 3 exact and 1 estimated", () => {
    expect(result.totals.eventCount).toBe(4);
    expect(result.totals.exactEventCount).toBe(3);
    expect(result.totals.estimatedEventCount).toBe(1);
  });

  it("sums total estimated spend arithmetically correctly across all fixtures", () => {
    // 0.0126 + 0.0032 (session-a) + 0.04 (session-b) + 0.0011 (session-c, estimated)
    expect(result.totals.totalCost).toBeCloseTo(0.0569, 6);
  });

  it("sums raw token totals correctly", () => {
    expect(result.totals.totalInputTokens).toBe(1000 + 500 + 2000 + 50);
    expect(result.totals.totalOutputTokens).toBe(500 + 200 + 800 + 100);
    expect(result.totals.totalCacheReadTokens).toBe(3000 + 1000 + 0 + 0);
    expect(result.totals.totalCacheCreationTokens).toBe(2000 + 0 + 1000 + 0);
  });

  it("every model id used in the fixtures is in the static pricing table", () => {
    expect(result.totals.unmatchedPricingModelCount).toBe(0);
    expect(result.unmatchedModels).toHaveLength(0);
  });

  it("groups by day correctly: 2026-09-10 combines project-alpha's first session and project-beta, 2026-09-11 is project-alpha's second session alone", () => {
    const byDayMap = new Map(result.byDay.map((d) => [d.key, d]));
    expect(byDayMap.get("2026-09-10")!.cost).toBeCloseTo(0.0158 + 0.0011, 6);
    expect(byDayMap.get("2026-09-11")!.cost).toBeCloseTo(0.04, 6);
    expect(byDayMap.get("2026-09-10")!.estimatedEventCount).toBe(1);
    expect(byDayMap.get("2026-09-11")!.estimatedEventCount).toBe(0);
  });

  it("groups by project correctly using the real cwd path seen in the logs", () => {
    const byProjectMap = new Map(result.byProject.map((p) => [p.key, p]));
    expect(byProjectMap.get("C:\\Users\\demo\\projects\\alpha")!.cost).toBeCloseTo(0.0158 + 0.04, 6);
    expect(byProjectMap.get("/home/demo/projects/beta")!.cost).toBeCloseTo(0.0011, 6);
  });

  it("groups by model correctly, combining both sonnet-5 turns across sessions/projects", () => {
    const byModelMap = new Map(result.byModel.map((m) => [m.key, m]));
    expect(byModelMap.get("claude-sonnet-5")!.cost).toBeCloseTo(0.0126 + 0.0032 + 0.0011, 6);
    expect(byModelMap.get("claude-opus-4-8")!.cost).toBeCloseTo(0.04, 6);
    expect(byModelMap.get("claude-sonnet-5")!.eventCount).toBe(3);
    expect(byModelMap.get("claude-opus-4-8")!.eventCount).toBe(1);
  });

  it("sorts byProject and byModel descending by cost", () => {
    for (let i = 1; i < result.byProject.length; i++) {
      expect(result.byProject[i - 1].cost).toBeGreaterThanOrEqual(result.byProject[i].cost);
    }
    for (let i = 1; i < result.byModel.length; i++) {
      expect(result.byModel[i - 1].cost).toBeGreaterThanOrEqual(result.byModel[i].cost);
    }
  });

  it("sorts byDay chronologically ascending", () => {
    for (let i = 1; i < result.byDay.length; i++) {
      expect(result.byDay[i - 1].key.localeCompare(result.byDay[i].key)).toBeLessThan(0);
    }
  });
});
