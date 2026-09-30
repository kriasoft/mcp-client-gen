/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Interactive prompts - wizard for config/server selection and output path.
 *
 * Contract: runInteractiveSetup(cwd, useDefaults?) → PromptsResult
 * Owns: User interaction via @clack/prompts. Does not own: validation rules.
 */

import {
  cancel,
  intro,
  isCancel,
  multiselect,
  outro,
  spinner,
  text,
} from "@clack/prompts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  findMcpConfigFiles,
  formatConfigWarning,
  getMcpServers,
  resolveConfigFiles,
} from "./config.js";
import type { GenerationResult } from "./pipeline.js";
import type { McpServerConfig } from "./types.js";

export interface PromptsResult {
  configFiles: string[];
  servers: McpServerConfig[];
  outputFile: string;
}

/**
 * Discover and select MCP config files.
 * @returns Selected absolute paths
 * @throws If no configs found
 */
export async function promptForConfigFiles(
  cwd: string = process.cwd(),
): Promise<string[]> {
  const availableFiles = await findMcpConfigFiles(cwd);

  if (availableFiles.length === 0) {
    throw new Error(
      "No MCP configuration files found. Create a .mcp.json file with your MCP server configuration.",
    );
  }

  const configSelection = await multiselect({
    message: "Select MCP configuration files to use:",
    options: availableFiles.map((file) => ({
      value: file,
      label: file.replace(cwd + "/", ""),
      hint: `Found at ${file}`,
    })),
    initialValues: availableFiles, // Select all by default
    required: true,
  });

  if (isCancel(configSelection)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return configSelection as string[];
}

/**
 * Select servers from parsed configs.
 * @param configFiles Paths to parse for servers
 * @returns Deduplicated server list
 */
export async function promptForServers(
  configFiles: string[],
): Promise<McpServerConfig[]> {
  const { servers, warnings } = getMcpServers(configFiles);

  // Show warnings in interactive mode
  if (warnings.length > 0) {
    console.log("\nConfig warnings:");
    for (const warning of warnings) {
      console.log(`  - ${formatConfigWarning(warning)}`);
    }
    console.log();
  }

  if (servers.length === 0) {
    throw new Error(
      "No valid MCP servers found in configuration files. Check your .mcp.json configuration.",
    );
  }

  const serverSelection = await multiselect({
    message: "Select MCP servers to include:",
    options: servers.map((server) => ({
      value: server,
      label: `${server.url}`,
      hint: `Type: ${server.type}`,
    })),
    initialValues: servers, // Select all by default
    required: true,
  });

  if (isCancel(serverSelection)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return serverSelection as McpServerConfig[];
}

/**
 * Get output path for generated client.
 * @returns Validated TypeScript file path
 */
export async function promptForOutputFile(
  cwd: string = process.cwd(),
): Promise<string> {
  // Smart default: src/ if exists, otherwise root
  const srcExists = existsSync(resolve(cwd, "src"));
  const defaultPath = srcExists ? "src/mcp-client.ts" : "mcp-client.ts";

  const outputPath = await text({
    message: "Enter output file path:",
    placeholder: defaultPath,
    defaultValue: defaultPath,
    validate: (value) => {
      if (!value || value.trim() === "") {
        return "Output file path is required";
      }
      if (!value.endsWith(".ts")) {
        return "Output file must have .ts extension";
      }
      return undefined;
    },
  });

  if (isCancel(outputPath)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return outputPath.trim();
}

export interface SetupOptions {
  /** Skip prompts, use defaults */
  useDefaults?: boolean;
  /** Explicit config file path (skips config discovery/selection) */
  configPath?: string;
}

/**
 * Interactive wizard or quick mode with defaults.
 * @param cwd Working directory
 * @param options Setup options
 * @returns Complete generation config
 */
export async function runInteractiveSetup(
  cwd: string = process.cwd(),
  options: SetupOptions = {},
): Promise<PromptsResult> {
  const { useDefaults = false, configPath } = options;

  if (useDefaults) {
    // Quick mode: all servers, default output path
    const configFiles = await resolveConfigFiles({ cwd, configPath });
    const { servers, warnings } = getMcpServers(configFiles);

    if (servers.length === 0) {
      // Show warnings when no servers found to help debugging
      if (warnings.length > 0) {
        console.log("\nConfig warnings:");
        for (const warning of warnings) {
          console.log(`  - ${formatConfigWarning(warning)}`);
        }
      }
      throw new Error(
        "No valid MCP servers found in configuration files. Check your .mcp.json configuration.",
      );
    }

    // Auto-detect src/ directory for better project structure
    const srcExists = existsSync(resolve(cwd, "src"));
    const outputFile = srcExists ? "src/mcp-client.ts" : "mcp-client.ts";

    console.log(
      `🚀 Using defaults: ${servers.length} server${servers.length !== 1 ? "s" : ""} → ${outputFile}`,
    );

    return {
      configFiles,
      servers,
      outputFile,
    };
  }

  intro("🧩 MCP Client Generator");

  try {
    // Step 1: Choose config files (skip prompt if --config provided)
    let configFiles: string[];
    if (configPath) {
      configFiles = await resolveConfigFiles({ cwd, configPath });
    } else {
      configFiles = await promptForConfigFiles(cwd);
    }

    // Step 2: Pick servers to generate client for
    const servers = await promptForServers(configFiles);

    // Step 3: Destination for generated TypeScript
    const outputFile = await promptForOutputFile(cwd);

    outro(
      `🎉 Configuration complete! Generating client for ${servers.length} server${servers.length !== 1 ? "s" : ""}`,
    );

    return {
      configFiles,
      servers,
      outputFile,
    };
  } catch (error) {
    cancel(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Show progress spinner while generating client.
 * @param servers Servers being processed
 * @param generateFn The generate function to run
 * @returns Generation result
 */
export async function showGenerationProgress(
  servers: McpServerConfig[],
  generateFn: () => Promise<GenerationResult>,
): Promise<GenerationResult> {
  const s = spinner();
  s.start(
    `Introspecting ${servers.length} MCP server${servers.length !== 1 ? "s" : ""}...`,
  );

  try {
    const result = await generateFn();

    const totalTools = Array.from(result.servers.values()).reduce(
      (sum, r) => sum + r.tools.length,
      0,
    );
    const totalResources = Array.from(result.servers.values()).reduce(
      (sum, r) => sum + r.resources.length,
      0,
    );

    s.stop(
      `Introspected ${result.servers.size} server${result.servers.size !== 1 ? "s" : ""}: ${totalTools} tools, ${totalResources} resources`,
    );

    return result;
  } catch (error) {
    s.error(`Failed to introspect servers`);
    throw error;
  }
}
