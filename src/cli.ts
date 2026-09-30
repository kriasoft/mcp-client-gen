#!/usr/bin/env node
/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * CLI entry - parses args, determines mode, delegates to core APIs.
 *
 * Modes: url (from URL), interactive (config + prompts), quick (config + defaults/output)
 * Owns: UX, defaults, exit codes. Does not own: generation logic.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { redactSecrets } from "./config.js";
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
 * 4. -y flag or output (-o or positional) → quick mode (config-based, all servers)
 * 5. Otherwise → interactive mode (config-based, prompts)
 *
 * An output path means "no prompts" in config mode, so `-o file` and a
 * positional `file` behave the same, as they do in URL mode.
 */
type CliMode =
  | { kind: "help" }
  | { kind: "url"; url: string; output?: string; name?: string }
  | { kind: "interactive"; configPath?: string }
  | { kind: "quick"; output?: string; configPath?: string };

function showHelp(write: (text: string) => void = console.log) {
  write(`
mcp-client-gen - Generate type-safe MCP client SDK

Usage:
  npx mcp-client-gen <url> [output]         # Generate from MCP server URL
  npx mcp-client-gen                        # Interactive mode (uses local configs)
  npx mcp-client-gen -y [output]            # Quick mode (uses local configs)

Arguments:
  <url>             MCP server URL (http:// or https://)
  [output]          Output file path (default: stdout for URL mode;
                    in config mode, implies -y)

Options:
  --url <url>       Explicit URL source (escape hatch for edge cases)
  --name <name>     Override server name (URL mode only)
  -o, --output <file>  Output file path (same as [output])
  --config <file>   Path to MCP configuration file
  -y, --yes         Accept defaults (all servers), skip prompts
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
  npx mcp-client-gen -y -o client.ts        # Quick + output file
  npx mcp-client-gen client.ts              # Same as above
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

    // Config mode: output path or -y → quick, otherwise interactive
    const output = values.output ?? positionals[0];
    if (output || values.yes) {
      return { kind: "quick", output, configPath: values.config };
    }
    return { kind: "interactive", configPath: values.config };
  } catch (error) {
    // stderr keeps stdout code-only for piped URL-mode output
    console.error("Error parsing arguments:", (error as Error).message);
    showHelp(console.error);
    process.exit(1);
  }
}

/**
 * Print usage instructions after generation.
 * Uses export names from codegen result (source of truth).
 */
function printUsage(
  outputFile: string,
  exports: string[],
  server: McpServerConfig | undefined,
  fromConfig: boolean,
) {
  const factoryName = exports[0];
  if (!factoryName || !server) return;

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
  console.log(`    type: ${JSON.stringify(server.type)},`);
  // Config URLs may embed expanded secrets anywhere (host, path, query): point to
  // the entry instead. A command-line URL is the user's own input.
  if (fromConfig) {
    console.log(
      `    url: "...", // "${server.name}" in your MCP config, plus its headers`,
    );
  } else {
    console.log(`    url: ${JSON.stringify(server.url)},`);
  }
  console.log(`  });`);
  console.log(`  const client = ${factoryName}(connection);`);
}

/**
 * Run generation with progress display.
 */
async function runGeneration(
  servers: McpServerConfig[],
  outputFile: string,
  fromConfig: boolean,
) {
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
      console.log(`  - ${name}: ${redactSecrets(failure.error)}`);
    }
  }

  // exports follow the servers map order: the first factory belongs to the first server
  const [first] = result.servers.values();
  printUsage(outputFile, result.exports, first?.server, fromConfig);
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
          await runGeneration([server], mode.output, false);
        } else {
          // Stdout: just output the code
          const result = await generateClient([server], {});
          process.stdout.write(result.code);
        }
      } catch (error) {
        console.error("Error:", redactSecrets((error as Error).message));
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
          outputFile: mode.kind === "quick" ? mode.output : undefined,
        });
        await runGeneration(result.servers, result.outputFile, true);
      } catch (error) {
        console.error("Error:", redactSecrets((error as Error).message));
        process.exit(1);
      }
      return;
    }
  }
}

main();
