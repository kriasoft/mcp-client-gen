/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "./types.js";

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
 * @returns Deduplicated servers (first URL occurrence wins)
 * @invariant Only returns http/sse servers, skips stdio/command servers
 * @supports Claude (.mcp.json), Cursor (.cursor/), VSCode (.vscode/) formats
 */
export function getMcpServers(paths: string[]): McpServer[] {
  const servers: McpServer[] = [];
  const seenUrls = new Set<string>();

  for (const path of paths) {
    try {
      const content = readFileSync(path, "utf8");
      const config = JSON.parse(content);

      // Claude/Cursor: mcpServers, VSCode: servers
      const isVSCodeFormat = !!config.servers;
      const serverConfigs = config.mcpServers || config.servers;

      if (serverConfigs && typeof serverConfigs === "object") {
        for (const [, serverConfig] of Object.entries(serverConfigs)) {
          if (typeof serverConfig === "object" && serverConfig !== null) {
            const server = serverConfig as any;
            const trimmedUrl =
              typeof server.url === "string" ? server.url.trim() : "";

            if (trimmedUrl && !seenUrls.has(trimmedUrl)) {
              // Infer type: explicit > format default (http)
              let serverType: "http" | "sse" | null = null;

              if (server.type === "http" || server.type === "sse") {
                serverType = server.type;
              } else if (server.type === "stdio" || server.command) {
                // stdio requires process spawning, not supported
                continue;
              } else if (!server.type) {
                // Missing type defaults to http for URL-based servers
                if (isVSCodeFormat || config.mcpServers) {
                  serverType = "http";
                }
              }

              if (serverType) {
                seenUrls.add(trimmedUrl);
                servers.push({
                  type: serverType,
                  url: trimmedUrl,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      // Invalid JSON ignored - user may have WIP configs
      continue;
    }
  }

  return servers;
}
