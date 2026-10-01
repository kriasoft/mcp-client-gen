/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Interactive prompts - wizard for config/server selection and output path.
 *
 * Contract: runInteractiveSetup(cwd, options?) → PromptsResult
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
import { relative, resolve } from "node:path";
import {
  findMcpConfigFiles,
  formatConfigWarning,
  getMcpServers,
  printable,
  resolveConfigFiles,
  type ConfiguredServer,
} from "./config.js";

export interface PromptsResult {
  configFiles: string[];
  servers: ConfiguredServer[];
  /** Directory for the generated modules, one per server */
  outputDir: string;
}

/** `src/mcp` when the project has a `src/` directory, else `mcp`. */
function defaultOutputDir(cwd: string): string {
  return existsSync(resolve(cwd, "src")) ? "src/mcp" : "mcp";
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
      label: relative(cwd, file),
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
 * Parse servers, printing every config warning to stderr, even when some
 * servers remain: a silently skipped server is harder to debug than a missing one.
 */
function loadServers(configFiles: string[]): ConfiguredServer[] {
  const { servers, warnings } = getMcpServers(configFiles);
  if (warnings.length > 0) {
    console.error("\nConfig warnings:");
    for (const warning of warnings) {
      console.error(`  - ${printable(formatConfigWarning(warning))}`);
    }
    console.error();
  }
  return servers;
}

/**
 * Select servers from parsed configs.
 * @param configFiles Paths to parse for servers
 * @returns Deduplicated server list
 */
export async function promptForServers(
  configFiles: string[],
): Promise<ConfiguredServer[]> {
  const servers = loadServers(configFiles);
  if (servers.length === 0) {
    throw new Error(
      "No valid MCP servers found in configuration files. Check your .mcp.json configuration.",
    );
  }

  const serverSelection = await multiselect({
    message: "Select MCP servers to include:",
    options: servers.map((server) => ({
      value: server,
      label: printable(server.name),
      // Config URLs may hold expanded secrets
      hint: `${server.transport} · ${printable(server.url)}`,
    })),
    initialValues: servers, // Select all by default
    required: true,
  });

  if (isCancel(serverSelection)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return serverSelection as ConfiguredServer[];
}

/**
 * Get the output directory for generated modules.
 * @returns Directory path (relative to cwd as entered)
 */
export async function promptForOutputDir(
  cwd: string = process.cwd(),
): Promise<string> {
  const defaultDir = defaultOutputDir(cwd);
  const outputDir = await text({
    message: "Output directory (one module per server):",
    placeholder: defaultDir,
    defaultValue: defaultDir,
    validate: (value) =>
      value?.trim().endsWith(".ts")
        ? "Enter a directory; each server gets its own .ts file"
        : undefined,
  });

  if (isCancel(outputDir)) {
    cancel("Operation cancelled");
    process.exit(0);
  }

  return outputDir.trim() || defaultDir;
}

export interface SetupOptions {
  /** Skip prompts, use defaults */
  useDefaults?: boolean;
  /** Explicit config file path (skips config discovery/selection) */
  configPath?: string;
  /** Output directory for quick mode (default: src/mcp or mcp) */
  outputDir?: string;
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
    // Quick mode: all servers, given or default output path
    const configFiles = await resolveConfigFiles({ cwd, configPath });
    const servers = loadServers(configFiles);

    if (servers.length === 0) {
      throw new Error(
        "No valid MCP servers found in configuration files. Check your .mcp.json configuration.",
      );
    }

    const outputDir = options.outputDir ?? defaultOutputDir(cwd);

    console.log(
      `🚀 Using defaults: ${servers.length} server${servers.length !== 1 ? "s" : ""} → ${outputDir}/`,
    );

    return { configFiles, servers, outputDir };
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
    const outputDir = await promptForOutputDir(cwd);

    outro(
      `🎉 Configuration complete! Generating ${servers.length} client${servers.length !== 1 ? "s" : ""}`,
    );

    return { configFiles, servers, outputDir };
  } catch (error) {
    cancel(`Error: ${printable(error)}`);
    process.exit(1);
  }
}

/** Run `task` behind a spinner labeled `message`. */
export async function withSpinner<T>(
  message: string,
  task: () => Promise<T>,
): Promise<T> {
  const s = spinner();
  s.start(`${message}...`);
  try {
    const result = await task();
    s.stop(message);
    return result;
  } catch (error) {
    s.error(`${message} failed`);
    throw error;
  }
}
