/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Config discovery & parsing - finds and normalizes MCP server definitions.
 *
 * Contract: getMcpServers(paths) → McpServerConfig[]
 * Invariant: Only returns http/sse servers; first URL occurrence wins (dedup).
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { resolve } from "node:path";
import type {
  ConfigWarning,
  McpServerConfig,
  ParseServersResult,
} from "./types.js";

/**
 * Format a config warning for display.
 */
export function formatConfigWarning(warning: ConfigWarning): string {
  const file = basename(warning.path);
  switch (warning.kind) {
    case "malformed_json":
      return `${file}: Invalid JSON - ${warning.error}`;
    case "skipped_stdio":
      return `${file}: Skipped "${warning.name}" (stdio servers not supported)`;
    case "missing_url":
      return `${file}: Skipped "${warning.name}" (missing url)`;
    case "unknown_type":
      return `${file}: Skipped "${warning.name}" (unknown type "${warning.type}")`;
  }
}

export interface ResolveConfigOptions {
  /** Working directory */
  cwd?: string;
  /** Explicit config path (skips discovery) */
  configPath?: string;
}

/**
 * Resolve config file paths: explicit path OR discovery.
 * Single source of truth for --config handling across all CLI modes.
 * @throws If explicit configPath doesn't exist or discovery finds nothing
 */
export async function resolveConfigFiles(
  options: ResolveConfigOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();

  if (options.configPath) {
    const absolutePath = resolve(cwd, options.configPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Configuration file not found: ${options.configPath}`);
    }
    return [absolutePath];
  }

  const configFiles = await findMcpConfigFiles(cwd);
  if (configFiles.length === 0) {
    throw new Error(
      "No MCP configuration files found. Create a .mcp.json file with your MCP server configuration.",
    );
  }
  return configFiles;
}

/**
 * Priority-ordered paths for MCP configuration discovery.
 * .local files override non-local variants for local overrides.
 * @see https://code.visualstudio.com/docs/copilot/chat/mcp-servers
 */
export const MCP_CONFIG_PATHS = [
  ".mcp.local.json",
  ".mcp.json",
  ".cursor/mcp.local.json",
  ".cursor/mcp.json",
  ".vscode/mcp.local.json",
  ".vscode/mcp.json",
];

/**
 * Scan filesystem for MCP config files in priority order.
 * @param cwd Working directory to search from
 * @returns Absolute paths of existing config files
 */
export async function findMcpConfigFiles(
  cwd: string = process.cwd(),
): Promise<string[]> {
  const foundFiles: string[] = [];

  for (const configPath of MCP_CONFIG_PATHS) {
    const fullPath = resolve(cwd, configPath);
    if (existsSync(fullPath)) {
      foundFiles.push(fullPath);
    }
  }

  return foundFiles;
}

/**
 * Parse MCP configs and extract unique server definitions.
 * @param paths Config file paths to parse (in priority order)
 * @returns Deduplicated servers and any warnings encountered
 * @invariant Only returns http/sse servers, skips stdio/command servers
 * @supports Claude (.mcp.json), Cursor (.cursor/), VSCode (.vscode/) formats
 */
export function getMcpServers(paths: string[]): ParseServersResult {
  const servers: McpServerConfig[] = [];
  const warnings: ConfigWarning[] = [];
  const seenUrls = new Set<string>();

  for (const path of paths) {
    let config: unknown;
    try {
      const content = readFileSync(path, "utf8");
      config = JSON.parse(content);
    } catch (error) {
      warnings.push({
        kind: "malformed_json",
        path,
        error: (error as Error).message,
      });
      continue;
    }

    // Claude/Cursor: mcpServers, VSCode: servers or mcp.servers
    const serverConfigs =
      (config as any).mcpServers ||
      (config as any).servers ||
      (config as any).mcp?.servers;

    if (serverConfigs && typeof serverConfigs === "object") {
      for (const [name, serverConfig] of Object.entries(serverConfigs)) {
        if (typeof serverConfig === "object" && serverConfig !== null) {
          const server = serverConfig as any;
          const trimmedUrl =
            typeof server.url === "string" ? server.url.trim() : "";

          // Check for stdio servers (unsupported)
          if (server.type === "stdio" || server.command) {
            warnings.push({ kind: "skipped_stdio", path, name });
            continue;
          }

          // Check for missing URL
          if (!trimmedUrl) {
            warnings.push({ kind: "missing_url", path, name });
            continue;
          }

          // Skip duplicates silently (first URL wins is expected behavior)
          if (seenUrls.has(trimmedUrl)) {
            continue;
          }

          // Determine server type
          let serverType: "http" | "sse";
          if (server.type === "http" || server.type === "sse") {
            serverType = server.type;
          } else if (!server.type) {
            // Missing type defaults to http for URL-based servers
            serverType = "http";
          } else {
            warnings.push({
              kind: "unknown_type",
              path,
              name,
              type: String(server.type),
            });
            continue;
          }

          seenUrls.add(trimmedUrl);
          const result: McpServerConfig = {
            type: serverType,
            url: trimmedUrl,
            name,
          };

          // Extract headers if present
          if (
            server.headers &&
            typeof server.headers === "object" &&
            !Array.isArray(server.headers)
          ) {
            result.headers = server.headers as Record<string, string>;
          }

          servers.push(result);
        }
      }
    }
  }

  return { servers, warnings };
}
