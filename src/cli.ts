#!/usr/bin/env node
/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * CLI entry - parses args, determines mode, delegates to core APIs.
 *
 * Modes: url (from URL), interactive (config + prompts), quick (config + defaults), direct (config + output)
 * Owns: UX, defaults, exit codes. Does not own: generation logic.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  formatConfigWarning,
  getMcpServers,
  resolveConfigFiles,
} from "./config.js";
import { generateClient, writeGeneratedClient } from "./pipeline.js";
import { runInteractiveSetup, showGenerationProgress } from "./prompts.js";
import type { McpServerConfig } from "./types.js";

/**
 * CLI execution modes - explicitly modeled for clarity and extensibility.
 *
 * Mode selection priority:
 * 1. --help → help
 * 2. --url flag → URL mode
 * 3. First positional is URL (http/https) → URL mode
 * 4. Positional given (not URL) → direct mode (config-based, positional = output)
 * 5. -y flag → quick mode (config-based, defaults)
 * 6. No args → interactive mode (config-based, prompts)
 */
type CliMode =
  | { kind: "help" }
  | { kind: "url"; url: string; output?: string; name?: string }
  | { kind: "interactive"; configPath?: string }
  | { kind: "quick"; configPath?: string }
  | { kind: "direct"; output: string; configPath?: string };

function showHelp() {
  console.log(`
mcp-client-gen - Generate type-safe MCP client SDK

Usage:
  npx mcp-client-gen <url> [output]         # Generate from MCP server URL
  npx mcp-client-gen                        # Interactive mode (uses local configs)
  npx mcp-client-gen -y                     # Quick mode (uses local configs)

Arguments:
  <url>             MCP server URL (http:// or https://)
  [output]          Output file path (default: stdout for URL mode)

Options:
  --url <url>       Explicit URL source (escape hatch for edge cases)
  --name <name>     Override server name (URL mode only)
  -o, --output <file>  Output file path
  --config <file>   Path to MCP configuration file
  -y, --yes         Accept defaults, skip prompts
  -h, --help        Show this help message

Examples:
  # URL mode (primary)
  npx mcp-client-gen https://api.notion.com/mcp
  npx mcp-client-gen https://api.notion.com/mcp -o notion.ts
  npx mcp-client-gen https://api.notion.com/mcp notion.ts
  npx mcp-client-gen --url https://api.notion.com/mcp --name notion

  # Config mode (uses .mcp.json, .cursor/, .vscode/)
  npx mcp-client-gen                        # Interactive
  npx mcp-client-gen -y                     # Quick defaults
  npx mcp-client-gen -y client.ts           # Quick + output file
`);
}

/** Check if string looks like a URL */
function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/**
 * Parse CLI arguments and determine execution mode.
 * See CliMode for priority order.
 */
function parseArguments(): CliMode {
  try {
    const { values, positionals } = parseArgs({
      options: {
        url: { type: "string" },
        name: { type: "string" },
        output: { type: "string", short: "o" },
        config: { type: "string" },
        help: { type: "boolean", short: "h" },
        yes: { type: "boolean", short: "y" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      return { kind: "help" };
    }

    // Explicit --url flag takes priority
    if (values.url) {
      // Output: -o flag > second positional > first positional (if not URL)
      const output =
        values.output ??
        (positionals[0] && !isUrl(positionals[0]) ? positionals[0] : undefined);
      return { kind: "url", url: values.url, output, name: values.name };
    }

    // First positional is URL → URL mode
    if (positionals[0] && isUrl(positionals[0])) {
      // Output: -o flag > second positional
      const output = values.output ?? positionals[1];
      return { kind: "url", url: positionals[0], output, name: values.name };
    }

    // Positional given but not URL → direct mode (config-based, positional = output)
    if (positionals[0]) {
      return {
        kind: "direct",
        output: values.output ?? positionals[0],
        configPath: values.config,
      };
    }

    // -y flag → quick mode
    if (values.yes) {
      return { kind: "quick", configPath: values.config };
    }

    // No args → interactive
    return { kind: "interactive", configPath: values.config };
  } catch (error) {
    console.error("Error parsing arguments:", (error as Error).message);
    showHelp();
    process.exit(1);
  }
}

/**
 * Print usage instructions after generation.
 * Uses export names from codegen result (source of truth).
 */
function printUsage(outputFile: string, exports: string[]) {
  const factoryName = exports[0];
  if (!factoryName) return;

  // Ensure relative import path
  const importPath = outputFile.startsWith(".")
    ? outputFile.replace(/\.ts$/, ".js")
    : "./" + outputFile.replace(/\.ts$/, ".js");

  console.log(`\nGenerated client saved to ${outputFile}`);
  console.log("\nUsage:");
  console.log(`  import { ${factoryName} } from "${importPath}";`);
  console.log(`  import { createMcpConnection } from "mcp-client-gen";`);
  console.log(``);
  console.log(`  const connection = await createMcpConnection({`);
  console.log(`    type: "http",`);
  console.log(`    url: "https://your-mcp-server.com/mcp",`);
  console.log(`  });`);
  console.log(`  const client = ${factoryName}(connection);`);
}

/**
 * Run generation with progress display.
 */
async function runGeneration(servers: McpServerConfig[], outputFile: string) {
  const absoluteOutput = resolve(process.cwd(), outputFile);

  const result = await showGenerationProgress(servers, () =>
    generateClient(servers, {
      outputPath: absoluteOutput,
    }),
  );

  // Write to file
  await writeGeneratedClient(absoluteOutput, result.code);

  // Report failures
  if (result.failures.size > 0) {
    console.log(`\nWarnings:`);
    for (const [name, failure] of result.failures) {
      console.log(`  - ${name} (${failure.server.url}): ${failure.error}`);
    }
  }

  printUsage(outputFile, result.exports);
}

async function main() {
  const mode = parseArguments();

  switch (mode.kind) {
    case "help":
      showHelp();
      return;

    case "url": {
      // URL mode: generate from remote MCP server
      const server: McpServerConfig = {
        type: "http",
        url: mode.url,
        name: mode.name,
      };

      try {
        if (mode.output) {
          // File output: show progress + usage instructions
          await runGeneration([server], mode.output);
        } else {
          // Stdout: just output the code
          const result = await generateClient([server], {});
          process.stdout.write(result.code);
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      return;
    }

    case "interactive":
    case "quick": {
      try {
        const result = await runInteractiveSetup(process.cwd(), {
          useDefaults: mode.kind === "quick",
          configPath: mode.configPath,
        });
        await runGeneration(result.servers, result.outputFile);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      return;
    }

    case "direct": {
      try {
        const configFiles = await resolveConfigFiles({
          cwd: process.cwd(),
          configPath: mode.configPath,
        });

        const { servers, warnings } = getMcpServers(configFiles);
        if (servers.length === 0) {
          // Show warnings when no servers found to help debugging
          if (warnings.length > 0) {
            console.error("\nConfig warnings:");
            for (const warning of warnings) {
              console.error(`  - ${formatConfigWarning(warning)}`);
            }
          }
          console.error("No valid MCP servers found in configuration files.");
          process.exit(1);
        }

        await runGeneration(servers, mode.output);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      return;
    }
  }
}

main();
