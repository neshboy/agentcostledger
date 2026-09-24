import type { TranscriptParser, UsageEvent } from "./types";

/**
 * Parser for Claude Code's own session transcript format.
 *
 * Format notes (gathered by inspecting real, closed session files on disk
 * under `~/.claude/projects/<project-dir>/<session-uuid>.jsonl` - read-only
 * inspection, no transcript content copied here, and the live/in-progress
 * session file was never touched):
 *
 * Each line is a standalone JSON object. Relevant line `type`s:
 *
 *   - "user"      { message: { role: "user", content }, timestamp, sessionId, cwd }
 *   - "assistant" { message: { role: "assistant", content, model, usage }, timestamp, sessionId, cwd }
 *   - everything else ("attachment", "queue-operation", "file-history-snapshot",
 *     "atis-latch", "last-prompt", "ai-title", "summary", ...) is plumbing/
 *     bookkeeping, not a billable model turn, and is skipped.
 *
 * The billing-relevant part is `message.usage` on assistant lines, observed
 * with this real shape:
 *
 *   usage: {
 *     input_tokens: number,                 // fresh (non-cached) prompt tokens
 *     cache_creation_input_tokens: number,  // total prompt tokens written to cache
 *     cache_read_input_tokens: number,      // prompt tokens served from cache
 *     output_tokens: number,                // generated tokens
 *     cache_creation: {                     // breakdown of the write above by TTL
 *       ephemeral_5m_input_tokens: number,
 *       ephemeral_1h_input_tokens: number
 *     },
 *     ...
 *   }
 *
 * Every one of those fields is optional in principle (older/odd lines, or a
 * future format change, might omit `usage` entirely) - when `usage` is
 * missing or has no usable numeric fields, this parser falls back to an
 * honest chars/4 heuristic estimate and marks the resulting UsageEvent
 * `estimated: true`. It never presents a heuristic guess as an exact count.
 *
 * `cwd` (the real absolute working directory Claude Code was run from) is
 * used as the human-friendly project label when present; the containing log
 * directory name is always used as the stable grouping key, matching how
 * Claude Code itself organizes sessions (one directory per project).
 *
 * This parser is deliberately tolerant: unrecognized line types, unknown
 * block shapes, and malformed JSON lines are skipped rather than throwing,
 * since the live format keeps growing new attachment/bookkeeping variants.
 */

interface AnyRecord {
  [key: string]: unknown;
}

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Honest chars/4 fallback estimator, used only when exact usage is absent. */
function estimateTokensFromChars(charCount: number): number {
  return Math.round(charCount / 4);
}

/** Flatten a message.content value (string or block array) into plain text. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = asString(block.type);
    if (type === "text") {
      const text = asString(block.text);
      if (text) parts.push(text);
    } else if (type === "tool_result") {
      const c = block.content;
      if (typeof c === "string") parts.push(c);
    }
    // thinking/tool_use/image blocks are intentionally excluded from the
    // char-count heuristic: thinking tokens are billed as output tokens by
    // the API but are not reliably reconstructable char-for-char here, and
    // counting tool_use JSON would double-count against real usage data.
  }
  return parts.join("\n");
}

export const claudeCodeParser: TranscriptParser = {
  id: "claude-code-jsonl",
  label: "Claude Code session transcript (JSONL)",

  sniff(sampleLines: string[]): boolean {
    for (const line of sampleLines) {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(obj)) continue;
      const type = asString(obj.type);
      const hasSessionId = typeof obj.sessionId === "string";
      const looksLikeMessageEnvelope =
        (type === "user" || type === "assistant") &&
        isRecord(obj.message) &&
        (asString((obj.message as AnyRecord).role) === "user" ||
          asString((obj.message as AnyRecord).role) === "assistant");
      if (hasSessionId && looksLikeMessageEnvelope) return true;
    }
    return false;
  },

  parse(rawContent: string, filePath: string, projectKey: string, projectDisplayHint?: string): UsageEvent[] {
    const lines = rawContent.split("\n");
    const events: UsageEvent[] = [];

    let sessionId: string | undefined;
    let projectDisplay = projectDisplayHint ?? projectKey;
    let pendingUserText = "";

    for (const raw of lines) {
      if (!raw || !raw.trim()) continue;

      let obj: unknown;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue; // tolerate a corrupt/truncated trailing line
      }
      if (!isRecord(obj)) continue;

      const type = asString(obj.type);
      const ts = asString(obj.timestamp);
      const cwd = asString(obj.cwd);
      if (typeof obj.sessionId === "string") sessionId = obj.sessionId;
      if (cwd) projectDisplay = cwd; // most recent real cwd wins

      if (type === "user") {
        const message = obj.message;
        if (isRecord(message) && message.role === "user" && obj.isMeta !== true) {
          pendingUserText = extractText(message.content);
        }
        continue;
      }

      if (type !== "assistant") continue; // plumbing/bookkeeping line, skip

      const message = obj.message;
      if (!isRecord(message) || message.role !== "assistant") continue;

      const model = asString(message.model) ?? "unknown";
      const usage = message.usage;

      let inputTokens = 0;
      let cacheCreation5m = 0;
      let cacheCreation1h = 0;
      let cacheReadTokens = 0;
      let outputTokens = 0;
      let estimated = false;

      if (isRecord(usage) && (typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number")) {
        inputTokens = asNumber(usage.input_tokens);
        outputTokens = asNumber(usage.output_tokens);
        cacheReadTokens = asNumber(usage.cache_read_input_tokens);

        const totalCacheCreation = asNumber(usage.cache_creation_input_tokens);
        const breakdown = usage.cache_creation;
        if (isRecord(breakdown)) {
          cacheCreation5m = asNumber(breakdown.ephemeral_5m_input_tokens);
          cacheCreation1h = asNumber(breakdown.ephemeral_1h_input_tokens);
          // If the breakdown doesn't fully account for the total (older/odd
          // lines), attribute the remainder to the 5-minute tier since that
          // is the API default TTL.
          const accountedFor = cacheCreation5m + cacheCreation1h;
          if (totalCacheCreation > accountedFor) {
            cacheCreation5m += totalCacheCreation - accountedFor;
          }
        } else {
          // No per-TTL breakdown available: assume the default 5-minute TTL.
          cacheCreation5m = totalCacheCreation;
        }
      } else {
        // No usable exact usage metadata on this line - fall back to an
        // honest chars/4 heuristic and label the event as estimated.
        estimated = true;
        const assistantText = extractText(message.content);
        outputTokens = estimateTokensFromChars(assistantText.length);
        inputTokens = estimateTokensFromChars(pendingUserText.length);
      }

      events.push({
        format: claudeCodeParser.id,
        sourceFile: filePath,
        sessionId,
        timestamp: ts ?? new Date(0).toISOString(),
        projectKey,
        projectDisplay,
        model,
        inputTokens,
        cacheCreation5mTokens: cacheCreation5m,
        cacheCreation1hTokens: cacheCreation1h,
        cacheReadTokens,
        outputTokens,
        estimated,
      });

      // Each user turn's text is consumed by the first assistant reply that
      // follows it. Multi-step tool loops may emit several assistant lines
      // per user turn - reusing the same pending text for all of them is an
      // approximation, only relevant for the no-usage heuristic fallback.
    }

    return events;
  },
};
