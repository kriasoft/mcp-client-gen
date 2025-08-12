/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "./types.js";

// Priority-ordered paths for MCP configuration discovery
// .local files override non-local variants
// https://code.visualstudio.com/docs/copilot/chat/mcp-servers
export const MCP_CONFIG_PATHS = [
  ".mcp.local.json",
  ".mcp.json",
  ".cursor/mcp.local.json",
  ".cursor/mcp.json",
  ".vscode/mcp.local.json",
  ".vscode/mcp.json",
];

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
 * Parses MCP configuration files and extracts server definitions.
 *
 * Requirements:
 * - Deduplicate by URL: the first occurrence wins; later duplicates are ignored (by URL).
 * - Returns servers compatible with @modelcontextprotocol/sdk transports ("http" | "sse").
 * - Support Claude, Cursor, and VSCode formats; see @docs/mcp-config-formats.md.
 */
export function getMcpServers(paths: string[]): McpServer[] {
  const servers: McpServer[] = [];
  const seenUrls = new Set<string>();

  for (const path of paths) {
    try {
      const content = readFileSync(path, "utf8");
      const config = JSON.parse(content);

      // Support both Claude/Cursor format (mcpServers) and VSCode format (servers)
      const isVSCodeFormat = !!config.servers;
      const serverConfigs = config.mcpServers || config.servers;

      if (serverConfigs && typeof serverConfigs === "object") {
        for (const [, serverConfig] of Object.entries(serverConfigs)) {
          if (typeof serverConfig === "object" && serverConfig !== null) {
            const server = serverConfig as any;
            const trimmedUrl =
              typeof server.url === "string" ? server.url.trim() : "";

            if (trimmedUrl && !seenUrls.has(trimmedUrl)) {
              // Determine server type: explicit type, or default based on format
              let serverType: "http" | "sse" | null = null;

              if (server.type === "http" || server.type === "sse") {
                serverType = server.type;
              } else if (server.type === "stdio" || server.command) {
                // Skip stdio servers
                continue;
              } else if (!server.type) {
                // Default to HTTP for both VSCode and Cursor formats when no type is specified
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
      // Skip invalid JSON files silently
      continue;
    }
  }

  return servers;
}
