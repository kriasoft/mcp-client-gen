/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Pipeline coordinator - introspection → codegen → formatting, for one server.
 *
 * Contract: generateClient(server, options?) → code
 * Invariant: No file I/O; output depends only on the server's capabilities.
 */

import { format as prettierFormat, resolveConfig } from "prettier";
import { generateClientFile } from "./codegen/index.js";
import { introspectServer } from "./introspection.js";
import type { McpClientConfig } from "./mcp-client.js";
import type { McpServerConfig } from "./types.js";

/** Connection settings used while introspecting the server. */
export type GenerateClientOptions = McpClientConfig;

/**
 * Generate a typed client module for one MCP server.
 * @param server Server URL (Streamable HTTP), or its config; `name` sets the client name
 *   (default: derived from the URL, e.g. `notion` → `createNotionClient`)
 * @returns Formatted TypeScript source
 * @throws When the server can't be reached or introspected (SDK errors pass through)
 */
export async function generateClient(
  server: string | URL | McpServerConfig,
  options?: GenerateClientOptions,
): Promise<string> {
  const config: McpServerConfig =
    typeof server === "string" || server instanceof URL
      ? { type: "http", url: String(server) }
      : server;
  const introspection = await introspectServer(config, options);
  return formatTypeScript(
    generateClientFile(extractServerName(config), introspection),
  );
}

/**
 * Extract a meaningful name from server config or URL.
 * Priority: explicit name > URL hostname > URL path segment > "server"
 */
export function extractServerName(server: McpServerConfig): string {
  // An empty config key still means "named": deriving from a config URL could
  // copy an expanded secret into generated identifiers
  if (server.name !== undefined) return server.name || "server";

  try {
    const url = new URL(server.url);
    // Extract subdomain or first path segment as name
    const hostname = url.hostname;
    const parts = hostname.split(".");
    // IP addresses and localhost name nothing (127.0.0.1 would yield "0")
    const namedHost =
      hostname !== "localhost" &&
      !hostname.startsWith("[") &&
      !/^\d+(\.\d+){3}$/.test(hostname);

    // Handle subdomains like "api.notion.com" -> "notion"
    if (namedHost && parts.length >= 2) {
      const name = parts.length > 2 ? parts[parts.length - 2] : parts[0];
      if (name && name !== "www" && name !== "api") {
        return name;
      }
    }

    // Try first path segment
    const pathSegment = url.pathname.split("/").filter(Boolean)[0];
    if (pathSegment && pathSegment !== "mcp" && pathSegment !== "v1") {
      return pathSegment;
    }

    return "server";
  } catch {
    return "server";
  }
}

/**
 * Format TypeScript code with Prettier.
 * @param filePath Destination whose Prettier config applies (searched upward); without
 *   it, Prettier's defaults, so output doesn't depend on the working directory
 * @returns Formatted code, or the input if formatting fails
 */
export async function formatTypeScript(
  code: string,
  filePath?: string,
): Promise<string> {
  try {
    const prettierConfig = filePath
      ? ((await resolveConfig(filePath)) ?? {})
      : {};
    return await prettierFormat(code, {
      ...prettierConfig,
      parser: "typescript",
    });
  } catch {
    return code;
  }
}
