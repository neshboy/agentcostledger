# Agent Cost Ledger

Agent Cost Ledger parses the usage logs that AI coding-agent tools already leave on
your disk and turns them into one local dashboard of **estimated** spend over time,
broken down by day, project, and model - without relying on a vendor's own billing UI.

It runs entirely locally. No network calls, no accounts, no cloud sync. It reads
files already on your machine and writes a terminal summary or a static HTML file.

## What log format this reads

This tool parses **Claude Code's own session transcript format**: the JSONL files
Claude Code writes under `~/.claude/projects/<project-dir>/<session-uuid>.jsonl`
(on Windows: `C:\Users\<you>\.claude\projects\...`).

This format was reverse-engineered by inspecting **real, closed session log files
already on the development machine** (never the live/in-progress session) - not
designed from documentation or guesswork. Concretely:

- Each line is a standalone JSON object with a `type` field. Conversation turns
  are `"user"` and `"assistant"`; everything else (`"attachment"`,
  `"queue-operation"`, `"file-history-snapshot"`, `"atis-latch"`, `"last-prompt"`,
  `"ai-title"`, `"summary"`, ...) is internal bookkeeping and is skipped.
- Assistant lines carry `message.model` (e.g. `"claude-sonnet-5"`) and
  `message.usage`, which on this machine's real logs consistently included exact
  token accounting: `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens`, and a per-TTL breakdown
  `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`.
- Each line also carries `cwd` - the real absolute working directory the session
  ran in - which this tool uses as the human-readable "project" label. The
  containing log directory (one per project, as Claude Code lays them out) is
  used as the stable grouping key underneath that label.

The parser (`src/parsers/claude-code.ts`) was written independently against that
observed shape - it does not import or copy code from anywhere else. If a future
Claude Code release adds fields or line types, unrecognized ones are skipped
rather than causing a crash.

**If a log line doesn't carry `usage` data** (hypothetically, an older or
unusual line), this tool falls back to an honest heuristic: it estimates tokens
as `characters / 4` from the actual message text, and marks that event
`estimated: true` everywhere - in the aggregation, the terminal report (`~est`),
and the HTML report (`~est` chip). It never presents a heuristic guess as an
exact count.

## Install / quick start

```bash
git clone <this repo>
cd agentcostledger
npm install
npm run build

# Terminal summary of your real local Claude Code usage
node dist/cli/index.js scan

# ...or scan somewhere else
node dist/cli/index.js scan ./test/fixtures

# Static HTML report
node dist/cli/index.js report -o report.html
```

If you install it as a package (`npm link` or `npm install -g .`), the same
commands are available as:

```bash
agentcostledger scan [path]
agentcostledger report -o report.html [path]
```

`scan` with no path defaults to `~/.claude/projects` (the real Claude Code log
location). `report` writes a self-contained HTML file (inline CSS, no external
requests) with real bars sized from your computed data.

## Example output

Running `scan` against a real (closed) session log on the development machine:

```
Agent Cost Ledger - scan summary
============================================================
Log files scanned:      1 (0 unrecognized/skipped)
Model turns counted:    96
Token counts:           96 exact (from log usage data), 0 estimated (chars/4 fallback)

TOTAL ESTIMATED SPEND:  $3.56
  input 192 tok, output 80.9K tok, cache read 5.80M tok, cache write 636.5K tok
  100% of turns used exact token counts from the log; 0% used the chars/4 estimate.

By day
------------------------------------------------------------
2026-09-17   ############################--      $1.46
2026-09-21   ##############################      $1.59
2026-09-22   ##########--------------------      $0.51

By project
------------------------------------------------------------
C:\Users\SERVER1\horizon-grid      ####################      $2.90
C:\Users\SERVER1                   #####---------------      $0.66

By model
------------------------------------------------------------
claude-sonnet-5                    ####################      $3.56
```

## How cost is computed

1. Extract, per assistant turn: fresh input tokens, cache-write tokens (split by
   5-minute/1-hour TTL when the log breaks that down), cache-read tokens, and
   output tokens - exact from `usage` when present, chars/4-estimated otherwise.
2. Look up the model id in the static pricing table
   (`src/pricing/pricing-table.ts`, $ per 1M tokens).
3. Apply the documented prompt-cache multipliers: cache writes at 1.25x (5-minute
   TTL) or 2x (1-hour TTL) the base input rate; cache reads at 0.1x the base input
   rate. Fresh input and output tokens are billed at the table's base rates.
4. Sum per day / per project (`cwd`) / per model across every parsed event.

## Limitations (read this before trusting a dollar figure)

- **Only one log format is implemented**: Claude Code's JSONL session transcripts.
  Other coding-agent tools (Cursor, Aider, Copilot, etc.) are not covered - a
  `scan` will simply find nothing for them.
- **The pricing table is static and needs manual updates.** It was checked
  against Anthropic's published API pricing as of 2026-09-24
  (`src/pricing/pricing-table.ts`). Pricing changes over time; this file does
  not fetch anything live. An unrecognized model id falls back to a labeled
  placeholder rate rather than failing, but that fallback is a guess, not a
  real price - it's flagged in both reports.
- **Cache pricing uses generic multipliers** (1.25x / 2x / 0.1x) for every
  model. At least one current model family documents a different (lower)
  cache-read multiplier; this tool does not special-case it yet, so costs for
  that family are a slight overestimate. See the per-model `note` fields in
  `pricing-table.ts`.
- **Token counts are exact only when the source log exposes them.** When they
  aren't present, this tool falls back to a chars/4 heuristic and always labels
  the result as estimated (never silently exact) - but a heuristic is still a
  guess, not a measurement.
- **These are estimates, not invoices.** They won't match a vendor's billing UI
  exactly - it may apply batch discounts, promotional credits, org-level tiers,
  or a pricing revision this file hasn't caught up to.
- **No de-duplication across overlapping scan roots.** Pointing `scan` at two
  paths that both contain the same log file (e.g. via a symlink) would double
  count it.
- This is a focused MVP: no cloud sync, no accounts, no scheduling/watching -
  run it manually whenever you want a fresh snapshot.

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # run the vitest suite against synthetic fixtures
```

Tests (`test/*.test.ts`) use hand-built synthetic JSONL fixtures under
`test/fixtures/` shaped like the real format described above, with known token
counts, so the aggregation math (sums, per-day/per-project/per-model grouping)
and the cost formula can be checked arithmetically rather than just "it ran
without crashing."

## License

MIT - see [LICENSE](LICENSE).
