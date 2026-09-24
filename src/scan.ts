import fs from "fs";
import os from "os";
import path from "path";
import { claudeCodeParser } from "./parsers/claude-code";
import type { TranscriptParser, UsageEvent } from "./parsers/types";

/** Parsers this tool knows about, tried in order via sniff(). */
const PARSERS: TranscriptParser[] = [claudeCodeParser];

/** Default location to scan when no path is given: the real Claude Code log root. */
export function defaultScanRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export interface DiscoveredFile {
  filePath: string;
  /** Top-level directory name directly under the scan root - the project bucket. */
  projectKey: string;
}

/**
 * Recursively find every *.jsonl file under `root`. The stable project key
 * for a file is the name of the first path segment under `root` - matching
 * how Claude Code lays out logs as one directory per project.
 */
export function discoverLogFiles(root: string): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];
  if (!fs.existsSync(root)) return results;

  const topLevelEntries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of topLevelEntries) {
    const projectKey = entry.name;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, projectKey, results);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      // A .jsonl file directly at the root (unexpected but harmless) - use
      // its own name as the project key.
      results.push({ filePath: entryPath, projectKey: entry.name });
    }
  }
  return results;
}

function walk(dir: string, projectKey: string, out: DiscoveredFile[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission error or race with deletion - skip, don't crash the scan
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, projectKey, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push({ filePath: entryPath, projectKey });
    }
  }
}

export interface ScanStats {
  filesScanned: number;
  filesUnrecognized: number;
  events: UsageEvent[];
}

/** Read and parse every discovered log file, skipping anything unrecognized. */
export function scanFiles(files: DiscoveredFile[]): ScanStats {
  let filesUnrecognized = 0;
  const events: UsageEvent[] = [];

  for (const { filePath, projectKey } of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      filesUnrecognized++;
      continue;
    }

    const sampleLines = content.split("\n").slice(0, 20).filter(Boolean);
    const parser = PARSERS.find((p) => p.sniff(sampleLines));
    if (!parser) {
      filesUnrecognized++;
      continue;
    }

    const parsed = parser.parse(content, filePath, projectKey);
    events.push(...parsed);
  }

  return { filesScanned: files.length, filesUnrecognized, events };
}
