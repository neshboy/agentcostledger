import fs from "fs";
import path from "path";
import { Command } from "commander";
import { aggregate } from "../aggregate";
import { renderHtmlReport } from "../report/html";
import { renderTerminalReport } from "../report/terminal";
import { defaultScanRoot, discoverLogFiles, scanFiles } from "../scan";

const program = new Command();

program.name("agentcostledger").description("Turn real local AI coding-agent usage logs into an estimated spend dashboard.").version("0.1.0");

program
  .command("scan")
  .argument("[path]", "directory to scan for logs (defaults to ~/.claude/projects)")
  .description("Scan local coding-agent logs and print an estimated spend summary to the terminal.")
  .action((scanPath?: string) => {
    const root = scanPath ? path.resolve(scanPath) : defaultScanRoot();
    if (!fs.existsSync(root)) {
      console.error(`No such path: ${root}`);
      if (!scanPath) {
        console.error("(This is the default Claude Code log location. Pass a path explicitly to scan somewhere else.)");
      }
      process.exitCode = 1;
      return;
    }

    const files = discoverLogFiles(root);
    const { filesScanned, filesUnrecognized, events } = scanFiles(files);

    if (events.length === 0) {
      console.log(`\nScanned ${filesScanned} file(s) under ${root} - found no recognized usage events.`);
      console.log("Nothing to report yet. See README Limitations for which log formats this tool understands.\n");
      return;
    }

    const result = aggregate(events);
    console.log(renderTerminalReport(result, filesScanned, filesUnrecognized));
  });

program
  .command("report")
  .argument("[path]", "directory to scan for logs (defaults to ~/.claude/projects)")
  .option("-o, --output <file>", "output HTML file path", "report.html")
  .description("Scan local coding-agent logs and write a static HTML spend report.")
  .action((scanPath?: string, options?: { output: string }) => {
    const root = scanPath ? path.resolve(scanPath) : defaultScanRoot();
    const outputPath = path.resolve(options?.output ?? "report.html");

    if (!fs.existsSync(root)) {
      console.error(`No such path: ${root}`);
      process.exitCode = 1;
      return;
    }

    const files = discoverLogFiles(root);
    const { filesScanned, filesUnrecognized, events } = scanFiles(files);
    const result = aggregate(events);
    const html = renderHtmlReport(result, filesScanned, filesUnrecognized);

    fs.writeFileSync(outputPath, html, "utf8");
    console.log(`Wrote ${outputPath} (${filesScanned} file(s) scanned, ${events.length} model turn(s), total estimated spend ${result.totals.totalCost.toFixed(2)} USD).`);
  });

program.parse(process.argv);
