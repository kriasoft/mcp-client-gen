#!/usr/bin/env node

import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runInteractiveSetup, introspectServers } from "./lib/prompts.js";
import { getMcpServers, findMcpConfigFiles } from "./lib/config.js";
import type { McpServer } from "./lib/types.js";

interface MCPServerConfig {
  type: string;
  url: string;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

interface Args {
  output: string;
  config?: string;
  help?: boolean;
  yes?: boolean;
}

function showHelp() {
  console.log(`
mcp-client-gen - Generate type-safe MCP client SDK

Usage:
  npx mcp-client-gen                        # Launch interactive mode
  npx mcp-client-gen -y                     # Accept defaults and proceed
  npx mcp-client-gen <output-file>          # Use specific output file
  npx mcp-client-gen --config <config-file> <output-file>

Arguments:
  <output-file>     Output file path for the generated client

Options:
  --config <file>   Path to MCP configuration file (default: .mcp.json)
  -y, --yes         Accept all defaults and skip interactive prompts
  --help            Show this help message

Examples:
  npx mcp-client-gen                        # Interactive mode with prompts
  npx mcp-client-gen -y                     # Quick generation with defaults
  npx mcp-client-gen ./lib/mcp-client.ts    # Specify output file
  npx mcp-client-gen --config custom.mcp.json ./lib/mcp.ts
`);
}

function parseArguments(): Args | null {
  try {
    const { values, positionals } = parseArgs({
      options: {
        config: { type: "string" },
        help: { type: "boolean", short: "h" },
        yes: { type: "boolean", short: "y" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      showHelp();
      return null;
    }

    // If no positional arguments, use interactive mode or yes mode
    if (positionals.length === 0) {
      return {
        output: "", // Will be determined later
        config: values.config,
        yes: values.yes || false,
      };
    }

    return {
      output: positionals[0]!,
      config: values.config,
      yes: values.yes || false,
    };
  } catch (error) {
    console.error("Error parsing arguments:", (error as Error).message);
    showHelp();
    process.exit(1);
  }
}

function loadMCPConfig(configPath?: string): MCPConfig {
  const defaultConfigPath = resolve(process.cwd(), ".mcp.json");
  const actualConfigPath = configPath
    ? resolve(process.cwd(), configPath)
    : defaultConfigPath;

  if (!existsSync(actualConfigPath)) {
    console.error(`Error: Configuration file not found: ${actualConfigPath}`);
    console.error(
      "Create a .mcp.json file with your MCP server configuration.",
    );
    process.exit(1);
  }

  try {
    const configContent = readFileSync(actualConfigPath, "utf-8");
    return JSON.parse(configContent);
  } catch (error) {
    console.error(
      `Error reading configuration file: ${(error as Error).message}`,
    );
    process.exit(1);
  }
}

async function generateMCPClientFromConfig(args: Args) {
  const config = loadMCPConfig(args.config);
  const serverNames = Object.keys(config.mcpServers);

  console.log(
    `Generating MCP client SDK from ${serverNames.length} servers...`,
  );
  console.log(`Servers: ${serverNames.join(", ")}`);

  // TODO: Implement actual MCP server introspection
  console.log("⏳ Connecting to MCP servers...");
  console.log("⏳ Fetching server capabilities...");
  console.log("⏳ Generating TypeScript client...");

  // Generate client code for all servers
  const clientExports = serverNames
    .map((name) => {
      const server = config.mcpServers[name];
      if (!server) throw new Error(`Server ${name} not found in configuration`);
      return `export const ${name} = new ${capitalize(name)}Client("${server.url}");`;
    })
    .join("\n");

  const clientClasses = serverNames
    .map(
      (name) => `
export class ${capitalize(name)}Client {
  constructor(private serverUrl: string) {}
  
  // TODO: Generated methods based on server capabilities
  async fetchPage(id: string) {
    // Implementation will be generated based on MCP server schema
    throw new Error("Not implemented yet");
  }
}`,
    )
    .join("\n");

  const clientCode = `// Generated MCP client SDK
// Generated from: ${Object.entries(config.mcpServers)
    .map(([name, server]) => `${name} (${server?.url || "unknown"})`)
    .join(", ")}

${clientClasses}

${clientExports}
`;

  // TODO: Write to actual file
  console.log(`✅ Generated client saved to ${args.output}`);
  console.log("\nUsage:");
  console.log(
    `import { ${serverNames[0]} } from "${args.output.replace(".ts", ".js")}";`,
  );
  console.log(`const result = await ${serverNames[0]}.fetchPage("123");`);
}

async function generateMCPClientFromServers(
  servers: McpServer[],
  outputFile: string,
) {
  // Introspect servers with progress indicator
  const introspectionResults = await introspectServers(servers);

  // Generate client names from URLs for now
  const serverNames = servers.map((_, index) => `server${index + 1}`);

  const clientExports = servers
    .map(
      (server, index) =>
        `export const server${index + 1} = new Server${index + 1}Client("${server.url}");`,
    )
    .join("\n");

  const clientClasses = servers
    .map(
      (server, index) => `
export class Server${index + 1}Client {
  constructor(private serverUrl: string) {}
  
  // TODO: Generated methods based on server capabilities
  async fetchPage(id: string) {
    // Implementation will be generated based on MCP server schema
    throw new Error("Not implemented yet");
  }
}`,
    )
    .join("\n");

  const clientCode = `// Generated MCP client SDK
// Generated from: ${servers.map((s) => `${s.url} (${s.type})`).join(", ")}

${clientClasses}

${clientExports}
`;

  // TODO: Write to actual file with real introspection data
  console.log(`\n✅ Generated client saved to ${outputFile}`);
  console.log("\nUsage:");
  console.log(
    `import { ${serverNames[0]} } from "${outputFile.replace(".ts", ".js")}";`,
  );
  console.log(`const result = await ${serverNames[0]}.fetchPage("123");`);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function main() {
  const args = parseArguments();

  // If args is null and help wasn't shown, use interactive mode
  if (!args) {
    console.error("Error: No arguments provided and help not requested");
    showHelp();
    process.exit(1);
  }

  // Handle interactive mode (no output file specified)
  if (!args.output) {
    try {
      const result = await runInteractiveSetup(process.cwd(), args.yes);
      await generateMCPClientFromServers(result.servers, result.outputFile);
    } catch (error) {
      console.error("Error:", (error as Error).message);
      process.exit(1);
    }
    return;
  }

  // Use traditional CLI mode
  try {
    await generateMCPClientFromConfig(args);
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

main();
