import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { claudeCodeParser } from "../src/parsers/claude-code";

const FIXTURES = path.resolve(process.cwd(), "test/fixtures");

function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(FIXTURES, relPath), "utf8");
}

describe("claudeCodeParser", () => {
  it("sniffs a real-shaped Claude Code JSONL file as its own format", () => {
    const content = readFixture("project-alpha/session-a.jsonl");
    const sampleLines = content.split("\n").filter(Boolean);
    expect(claudeCodeParser.sniff(sampleLines)).toBe(true);
  });

  it("does not sniff an unrelated JSON file", () => {
    expect(claudeCodeParser.sniff(['{"hello":"world"}', '{"foo":1}'])).toBe(false);
  });

  it("extracts exact token counts from real usage metadata, skips plumbing lines and malformed JSON", () => {
    const content = readFixture("project-alpha/session-a.jsonl");
    const events = claudeCodeParser.parse(content, "session-a.jsonl", "project-alpha");

    // Two assistant turns; the "attachment" line and the malformed trailing
    // line must both be skipped without throwing.
    expect(events).toHaveLength(2);

    const [first, second] = events;
    expect(first.model).toBe("claude-sonnet-5");
    expect(first.estimated).toBe(false);
    expect(first.inputTokens).toBe(1000);
    expect(first.cacheCreation5mTokens).toBe(2000);
    expect(first.cacheCreation1hTokens).toBe(0);
    expect(first.cacheReadTokens).toBe(3000);
    expect(first.outputTokens).toBe(500);
    expect(first.projectDisplay).toBe("C:\\Users\\demo\\projects\\alpha");
    expect(first.projectKey).toBe("project-alpha");

    // Second assistant line omits cache_creation_input_tokens entirely -
    // must default to 0, not throw or leave it undefined.
    expect(second.estimated).toBe(false);
    expect(second.inputTokens).toBe(500);
    expect(second.cacheCreation5mTokens).toBe(0);
    expect(second.cacheCreation1hTokens).toBe(0);
    expect(second.cacheReadTokens).toBe(1000);
    expect(second.outputTokens).toBe(200);
  });

  it("splits cache_creation_input_tokens into 5m/1h buckets from the real cache_creation breakdown", () => {
    const content = readFixture("project-alpha/session-b.jsonl");
    const events = claudeCodeParser.parse(content, "session-b.jsonl", "project-alpha");
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe("claude-opus-4-8");
    expect(events[0].cacheCreation5mTokens).toBe(0);
    expect(events[0].cacheCreation1hTokens).toBe(1000);
  });

  it("falls back to an honest chars/4 estimate and flags the event as estimated when usage metadata is absent", () => {
    const content = readFixture("project-beta/session-c.jsonl");
    const events = claudeCodeParser.parse(content, "session-c.jsonl", "project-beta");
    expect(events).toHaveLength(1);

    const [event] = events;
    expect(event.estimated).toBe(true);
    // user turn was 200 chars -> 200/4 = 50 estimated input tokens
    expect(event.inputTokens).toBe(50);
    // assistant turn was 400 chars -> 400/4 = 100 estimated output tokens
    expect(event.outputTokens).toBe(100);
    expect(event.cacheReadTokens).toBe(0);
    expect(event.cacheCreation5mTokens).toBe(0);
    expect(event.cacheCreation1hTokens).toBe(0);
  });
});
